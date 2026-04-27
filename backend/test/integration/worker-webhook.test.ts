import { createServer, type IncomingMessage, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { createApiKey, notify, subscriberToken } from '../helpers/api.js';
import { resetDatabase, testPool } from '../helpers/db.js';
import { createEndpoint } from '../../src/modules/webhooks/webhooks.repository.js';
import { processWebhookJob } from '../../src/jobs/webhook.worker.js';
import { processEscalationJob } from '../../src/jobs/escalation.worker.js';
import { EmailChannel } from '../../src/delivery/email.channel.js';
import { verifyWebhookSignature } from '../../src/shared/crypto.js';
import type { WorkerContext } from '../../src/jobs/context.js';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

interface Captured {
  path: string;
  headers: IncomingMessage['headers'];
  body: string;
}

let requested: Captured[];
let server: Server;
let serverUrl: string;

function contextFor(tested: TestApp): WorkerContext {
  return {
    db: tested.app.db,
    redis: tested.app.redis,
    config: tested.app.config,
    logger: silentLogger,
    queues: tested.app.queues,
    metrics: tested.app.metrics,
  };
}

async function webhookDeliveryId(appId: string): Promise<string> {
  const { rows } = await testPool().query<{ id: string }>(
    `SELECT id FROM deliveries WHERE app_id = $1 AND channel = 'webhook' ORDER BY created_at DESC LIMIT 1`,
    [appId],
  );
  if (!rows[0]) throw new Error('no webhook delivery');
  return rows[0].id;
}

beforeEach(async () => {
  await resetDatabase();
  requested = [];
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      requested.push({
        path: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('webhook channel', () => {
  it('signs the payload, delivers it and marks the delivery sent', async () => {
    const tested = await createTestApp({
      WEBHOOK_ALLOW_HTTP: true,
      WEBHOOK_ALLOW_PRIVATE_IPS: true,
    });
    try {
      const key = await createApiKey(tested.app, { appId: 'webhook-app' });
      const secret = 'whsec_test_secret';
      await createEndpoint(tested.app.db, {
        appId: key.appId,
        url: `${serverUrl}/hook`,
        secret,
      });

      const response = await notify(tested, key.key, {
        userIds: ['user-1'],
        title: 'signed webhook',
        channels: ['webhook'],
      });
      expect(response.status).toBe(201);

      const deliveryId = await webhookDeliveryId(key.appId);
      await processWebhookJob(contextFor(tested), { deliveryId });

      expect(requested).toHaveLength(1);
      const captured = requested[0]!;
      const signature = String(captured.headers['x-signature']);
      expect(verifyWebhookSignature(secret, signature, captured.body)).toBe(true);
      expect(captured.headers['x-notification-id']).toBeTruthy();
      expect(captured.path).toBe('/hook');

      const delivery = await testPool().query<{ status: string; attempt_count: number }>(
        'SELECT status, attempt_count FROM deliveries WHERE id = $1',
        [deliveryId],
      );
      expect(delivery.rows[0]?.status).toBe('sent');
      expect(delivery.rows[0]?.attempt_count).toBe(1);
    } finally {
      await tested.close();
    }
  });

  it('refuses private targets when the SSRF guard is on', async () => {
    const tested = await createTestApp({
      WEBHOOK_ALLOW_HTTP: true,
      WEBHOOK_ALLOW_PRIVATE_IPS: false,
    });
    try {
      const key = await createApiKey(tested.app, { appId: 'blocked-app' });
      await createEndpoint(tested.app.db, {
        appId: key.appId,
        url: `${serverUrl}/blocked`,
        secret: 'whsec',
      });

      await notify(tested, key.key, {
        userIds: ['user-1'],
        title: 'blocked webhook',
        channels: ['webhook'],
      });

      const deliveryId = await webhookDeliveryId(key.appId);
      await processWebhookJob(contextFor(tested), { deliveryId });

      expect(requested).toHaveLength(0);

      const delivery = await testPool().query<{ status: string; last_error: string }>(
        'SELECT status, last_error FROM deliveries WHERE id = $1',
        [deliveryId],
      );
      expect(delivery.rows[0]?.status).toBe('failed');
      expect(delivery.rows[0]?.last_error).toContain('private_address');
    } finally {
      await tested.close();
    }
  });
});

describe('escalation', () => {
  it('sends the email only while the notification is still unread', async () => {
    const tested = await createTestApp();
    try {
      const key = await createApiKey(tested.app, { appId: 'escalation-app' });
      const channel = new EmailChannel({
        from: 'test@example.test',
        logger: silentLogger,
      });
      const ctx = contextFor(tested);
      const responses = await Promise.all([
        notify(tested, key.key, { userIds: ['user-1'], title: 'unread one' }),
        notify(tested, key.key, { userIds: ['user-2'], title: 'read one' }),
      ]);
      expect(responses.every((response) => response.status === 201)).toBe(true);

      const { rows } = await testPool().query<{ id: string; notification_id: string; user_id: string }>(
        `SELECT id, notification_id, user_id FROM deliveries
         WHERE app_id = $1 AND channel = 'in_app' ORDER BY user_id`,
        [key.appId],
      );

      const readDelivery = rows.find((row) => row.user_id === 'user-2')!;
      await fetch(`${tested.url}/v1/notifications/${readDelivery.notification_id}/read`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${subscriberToken(tested.app, key.appId, 'user-2')}`,
        },
      });

      for (const row of rows) {
        await processEscalationJob(ctx, channel, { deliveryId: row.id });
      }

      const emails = await testPool().query<{ user_id: string; status: string }>(
        `SELECT user_id, status FROM deliveries WHERE app_id = $1 AND channel = 'email'`,
        [key.appId],
      );
      expect(emails.rows).toEqual([{ user_id: 'user-1', status: 'sent' }]);

      channel.close();
    } finally {
      await tested.close();
    }
  });
});

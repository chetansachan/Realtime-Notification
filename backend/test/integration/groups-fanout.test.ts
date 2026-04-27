import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { authHeader, createApiKey, notify } from '../helpers/api.js';
import { resetDatabase, testPool } from '../helpers/db.js';
import { processFanoutJob } from '../../src/jobs/fanout.worker.js';
import type { WorkerContext } from '../../src/jobs/context.js';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

let tested: TestApp;
let appId: string;
let key: { key: string };

function contextFor(app: TestApp): WorkerContext {
  return {
    db: app.app.db,
    redis: app.app.redis,
    config: app.app.config,
    logger: silentLogger,
    queues: app.app.queues,
    metrics: app.app.metrics,
  };
}

beforeEach(async () => {
  await resetDatabase();
  // Anything above 2 recipients goes through the fanout worker.
  tested = await createTestApp({ INLINE_RECIPIENT_LIMIT: 2, FANOUT_CHUNK_SIZE: 2 });
  const created = await createApiKey(tested.app);
  appId = created.appId;
  key = { key: created.key };
});

afterEach(async () => {
  await tested.close();
});

describe('large group fan-out', () => {
  it('returns 202 and expands the group in chunks, idempotently', async () => {
    const created = await fetch(`${tested.url}/v1/groups`, {
      method: 'POST',
      headers: { ...authHeader(key.key), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'everyone' }),
    });
    expect(created.status).toBe(201);
    const group = (await created.json()) as { id: string };

    const members = await fetch(`${tested.url}/v1/groups/${group.id}/members`, {
      method: 'PUT',
      headers: { ...authHeader(key.key), 'content-type': 'application/json' },
      body: JSON.stringify({ userIds: ['user-3', 'user-1', 'user-2'] }),
    });
    expect(members.status).toBe(200);
    expect(((await members.json()) as { memberCount: number }).memberCount).toBe(3);

    const response = await notify(tested, key.key, {
      groupId: group.id,
      title: 'fanout',
    });
    expect(response.status).toBe(202);
    const body = (await response.json()) as { id: string; status: string; recipients: number };
    expect(body.status).toBe('fanout_queued');
    expect(body.recipients).toBe(3);

    const before = await testPool().query('SELECT id FROM deliveries WHERE notification_id = $1', [
      body.id,
    ]);
    expect(before.rowCount).toBe(0);

    const processed = await processFanoutJob(contextFor(tested), {
      notificationId: body.id,
      appId,
      groupId: group.id,
    });
    expect(processed.processed).toBe(3);

    const deliveries = await testPool().query<{ user_id: string; seq: number; status: string }>(
      `SELECT user_id, seq, status FROM deliveries
       WHERE notification_id = $1 AND channel = 'in_app' ORDER BY user_id`,
      [body.id],
    );
    expect(deliveries.rows).toEqual([
      { user_id: 'user-1', seq: 1, status: 'queued' },
      { user_id: 'user-2', seq: 1, status: 'queued' },
      { user_id: 'user-3', seq: 1, status: 'queued' },
    ]);

    // Re-running the job must not allocate more sequence numbers.
    await processFanoutJob(contextFor(tested), {
      notificationId: body.id,
      appId,
      groupId: group.id,
    });

    const after = await testPool().query<{ user_id: string; seq: number }>(
      `SELECT user_id, seq FROM deliveries
       WHERE notification_id = $1 AND channel = 'in_app' ORDER BY user_id`,
      [body.id],
    );
    expect(after.rows).toEqual([
      { user_id: 'user-1', seq: 1 },
      { user_id: 'user-2', seq: 1 },
      { user_id: 'user-3', seq: 1 },
    ]);

    const streams = await testPool().query<{ last_seq: string }>(
      'SELECT last_seq FROM user_streams WHERE app_id = $1 ORDER BY user_id',
      [appId],
    );
    expect(streams.rows.map((row) => Number(row.last_seq))).toEqual([1, 1, 1]);
  });
});

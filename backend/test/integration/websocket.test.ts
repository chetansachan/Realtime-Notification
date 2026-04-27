import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { authHeader, createApiKey, notify, sleep, streamTicket } from '../helpers/api.js';
import { TestWsClient } from '../helpers/ws.js';
import { resetDatabase, testPool } from '../helpers/db.js';

let tested: TestApp;
let appId: string;
let key: { key: string };

function wsUrl(ticket: string, lastSeq = 0): string {
  const base = tested.url.replace('http://', 'ws://');
  return `${base}/v1/ws?ticket=${encodeURIComponent(ticket)}&lastSeq=${lastSeq}`;
}

async function newestId(): Promise<string> {
  const { rows } = await testPool().query<{ id: string }>(
    `SELECT notification_id AS id FROM deliveries
     WHERE app_id = $1 AND channel = 'in_app' ORDER BY seq DESC LIMIT 1`,
    [appId],
  );
  return rows[0]!.id;
}

beforeEach(async () => {
  await resetDatabase();
  tested = await createTestApp();
  const created = await createApiKey(tested.app);
  appId = created.appId;
  key = { key: created.key };
});

afterEach(async () => {
  await tested.close();
});

describe('websocket transport', () => {
  it('streams notifications, accepts read/ack messages and replays a resume cursor', async () => {
    const client = await TestWsClient.connect(wsUrl(await streamTicket(tested.app, appId, 'user-1')));

    await notify(tested, key.key, { userIds: ['user-1'], title: 'first' });
    await notify(tested, key.key, { userIds: ['user-1'], title: 'second' });

    const firstEvent = await client.waitForSeq(1);
    const secondEvent = await client.waitForSeq(2);
    expect(firstEvent.payload.title).toBe('first');
    expect(secondEvent.payload.title).toBe('second');

    const firstId = await newestId();

    // read over the socket publishes a `read` event back to every tab
    client.send({ type: 'read', id: firstId });
    const readEvent = await client.waitFor((message) => message?.type === 'read');
    expect(readEvent.notificationId).toBe(firstId);
    expect(readEvent.unreadCount).toBe(1);

    // a late ack must not downgrade the read status
    client.send({ type: 'ack', id: firstId });
    await sleep(100);

    const status = await testPool().query<{ status: string }>(
      `SELECT status FROM deliveries WHERE notification_id = $1 AND channel = 'in_app'`,
      [firstId],
    );
    expect(status.rows[0]?.status).toBe('read');

    client.close();

    const resumed = await TestWsClient.connect(
      wsUrl(await streamTicket(tested.app, appId, 'user-1'), 1),
    );
    await resumed.waitForSeq(2);
    await sleep(50);
    const seqs = resumed.messages
      .filter((message) => message?.type === 'notification')
      .map((message) => message.seq);
    expect(seqs).toEqual([2]);

    resumed.close();
  });

  it('ignores malformed client messages', async () => {
    const client = await TestWsClient.connect(wsUrl(await streamTicket(tested.app, appId, 'user-1')));

    client.send({ type: 'nonsense' });
    client.send({ type: 'ack', id: 'not-a-uuid' });
    client.send({ type: 'ack' });

    await notify(tested, key.key, { userIds: ['user-1'], title: 'still works' });
    const event = await client.waitForSeq(1);
    expect(event.payload.title).toBe('still works');

    client.close();
  });
});

describe('websocket auth', () => {
  it('rejects a missing ticket', async () => {
    await expect(TestWsClient.connect(`${tested.url.replace('http://', 'ws://')}/v1/ws`)).rejects.toThrow();
  });

  it('accepts a subscriber token through the Authorization header', async () => {
    const key2 = await createApiKey(tested.app);
    const minted = await fetch(`${tested.url}/v1/subscriber-tokens`, {
      method: 'POST',
      headers: { ...authHeader(key2.key), 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'user-1' }),
    });
    const { token } = (await minted.json()) as { token: string };

    const { WebSocket: WsClient } = await import('ws');
    const socket = new WsClient(`${tested.url.replace('http://', 'ws://')}/v1/ws`, {
      headers: { authorization: `Bearer ${token}` },
    });

    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    socket.close();
  });
});

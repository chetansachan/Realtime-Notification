import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app.js';
import {
  authHeader,
  createApiKey,
  notify,
  sleep,
  streamTicket,
  subscriberToken,
} from '../helpers/api.js';
import { SseTestClient, expectNoEvent, streamUrl } from '../helpers/sse.js';
import { resetDatabase, testPool } from '../helpers/db.js';

let tested: TestApp;
let appId: string;
let key: { key: string };
let token: string;

beforeEach(async () => {
  await resetDatabase();
  tested = await createTestApp();
  const created = await createApiKey(tested.app);
  appId = created.appId;
  key = { key: created.key };
  token = subscriberToken(tested.app, appId, 'user-1');
});

afterEach(async () => {
  await tested.close();
});

async function setPreferences(preferences: unknown[]): Promise<void> {
  const response = await fetch(`${tested.url}/v1/preferences`, {
    method: 'PUT',
    headers: { ...authHeader(token), 'content-type': 'application/json' },
    body: JSON.stringify({ preferences }),
  });
  expect(response.status).toBe(200);
}

async function addCategory(category: string, mandatory = false): Promise<void> {
  await tested.app.db
    .insertInto('categories')
    .values({
      app_id: appId,
      key: category,
      mandatory,
      default_channels: ['in_app'],
    })
    .execute();
}

describe('preferences', () => {
  it('suppresses a muted category: no sequence, no push, no unread bump', async () => {
    await addCategory('marketing');
    await setPreferences([{ category: 'marketing', muted: true }]);

    const client = await SseTestClient.connect(
      streamUrl(tested.url, await streamTicket(tested.app, appId, 'user-1')),
    );

    const response = await notify(tested, key.key, {
      userIds: ['user-1'],
      category: 'marketing',
      title: 'muted',
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { accepted: number; suppressed: number };
    expect(body.accepted).toBe(0);
    expect(body.suppressed).toBe(1);

    await expectNoEvent(client, (event) => event.event === 'notification');

    const delivery = await testPool().query<{ status: string; seq: string | null }>(
      `SELECT status, seq FROM deliveries WHERE user_id = 'user-1' AND channel = 'in_app'`,
    );
    expect(delivery.rows[0]?.status).toBe('suppressed');
    expect(delivery.rows[0]?.seq).toBeNull();

    const state = await testPool().query<{ unread_count: number }>(
      'SELECT unread_count FROM user_streams WHERE app_id = $1 AND user_id = $2',
      [appId, 'user-1'],
    );
    expect(state.rows[0]?.unread_count ?? 0).toBe(0);

    client.close();
  });

  it('ignores mute for mandatory categories', async () => {
    await addCategory('security', true);
    await setPreferences([{ category: 'security', muted: true }]);

    const client = await SseTestClient.connect(
      streamUrl(tested.url, await streamTicket(tested.app, appId, 'user-1')),
    );

    const response = await notify(tested, key.key, {
      userIds: ['user-1'],
      category: 'security',
      title: 'password changed',
    });
    expect(response.status).toBe(201);

    const event = await client.waitForSeq(1);
    expect(event.data.title).toBe('password changed');

    const delivery = await testPool().query<{ status: string; seq: string }>(
      `SELECT status, seq FROM deliveries WHERE user_id = 'user-1' AND channel = 'in_app'`,
    );
    expect(delivery.rows[0]?.status).toBe('queued');
    expect(Number(delivery.rows[0]?.seq)).toBe(1);

    client.close();
  });

  it('keeps channels independent: muted in-app still allows email', async () => {
    await addCategory('billing');
    await setPreferences([{ category: 'billing', muted: true }]);

    await notify(tested, key.key, {
      userIds: ['user-1'],
      category: 'billing',
      title: 'invoice',
      channels: ['in_app', 'email'],
    });

    const deliveries = await testPool().query<{ channel: string; status: string }>(
      `SELECT channel, status FROM deliveries WHERE user_id = 'user-1' ORDER BY channel`,
    );

    expect(deliveries.rows).toEqual([
      { channel: 'in_app', status: 'suppressed' },
      { channel: 'email', status: 'queued' },
    ]);

    await sleep(10);
  });
});

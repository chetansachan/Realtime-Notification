import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { createApiKey, notify } from '../helpers/api.js';
import { resetDatabase, testPool } from '../helpers/db.js';

let tested: TestApp;

beforeEach(async () => {
  await resetDatabase();
  tested = await createTestApp();
});

afterEach(async () => {
  await tested.close();
});

describe('Idempotency-Key', () => {
  it('returns the original notification instead of creating a duplicate', async () => {
    const key = await createApiKey(tested.app);

    const first = await notify(tested, key.key, { userIds: ['user-1'], title: 'once' }, 'key-1');
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { id: string; status: string };

    const second = await notify(tested, key.key, { userIds: ['user-1'], title: 'once' }, 'key-1');
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { id: string; status: string };

    expect(secondBody.id).toBe(firstBody.id);
    expect(secondBody.status).toBe('duplicate');
    expect(firstBody.status).toBe('created');

    const notifications = await testPool().query('SELECT id FROM notifications');
    expect(notifications.rowCount).toBe(1);

    const deliveries = await testPool().query('SELECT id FROM deliveries');
    expect(deliveries.rowCount).toBe(1);

    const state = await testPool().query<{ last_seq: string }>(
      'SELECT last_seq FROM user_streams WHERE app_id = $1 AND user_id = $2',
      [key.appId, 'user-1'],
    );
    // The duplicate must not consume a sequence number.
    expect(Number(state.rows[0]?.last_seq)).toBe(1);
  });

  it('rejects the same key with a different payload', async () => {
    const key = await createApiKey(tested.app);

    await notify(tested, key.key, { userIds: ['user-1'], title: 'first' }, 'key-2');
    const conflict = await notify(
      tested,
      key.key,
      { userIds: ['user-1'], title: 'different' },
      'key-2',
    );

    expect(conflict.status).toBe(409);
    const body = (await conflict.json()) as { code: string };
    expect(body.code).toBe('idempotency_conflict');
  });

  it('requires exactly one of userIds or groupId', async () => {
    const key = await createApiKey(tested.app);

    const missing = await notify(tested, key.key, {});
    expect(missing.status).toBe(400);

    const both = await fetch(`${tested.url}/v1/notify`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        userIds: ['a'],
        groupId: '00000000-0000-7000-8000-000000000000',
        category: 'test',
        title: 'x',
      }),
    });
    expect(both.status).toBe(400);
  });
});

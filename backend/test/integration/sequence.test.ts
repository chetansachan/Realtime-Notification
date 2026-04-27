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

describe('per-user sequence integrity', () => {
  it('allocates 1..50 with no gaps under 50 parallel notifications', async () => {
    const key = await createApiKey(tested.app);

    const responses = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        notify(tested, key.key, { userIds: ['user-1'], title: `notification ${index}` }),
      ),
    );

    expect(responses.every((response) => response.status === 201)).toBe(true);

    const { rows } = await testPool().query<{ seq: number }>(
      `SELECT seq FROM deliveries
       WHERE app_id = $1 AND user_id = $2 AND channel = 'in_app'
       ORDER BY seq ASC`,
      [key.appId, 'user-1'],
    );

    const seqs = rows.map((row) => Number(row.seq));
    expect(seqs).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));

    const state = await testPool().query<{ last_seq: string; unread_count: number }>(
      'SELECT last_seq, unread_count FROM user_streams WHERE app_id = $1 AND user_id = $2',
      [key.appId, 'user-1'],
    );
    expect(Number(state.rows[0]?.last_seq)).toBe(50);
    expect(state.rows[0]?.unread_count).toBe(50);
  });

  it('keeps separate sequences per user and app', async () => {
    const appA = await createApiKey(tested.app, { appId: 'tenant-a' });
    const appB = await createApiKey(tested.app, { appId: 'tenant-b' });

    await notify(tested, appA.key, { userIds: ['user-1'] });
    await notify(tested, appA.key, { userIds: ['user-1'] });
    await notify(tested, appB.key, { userIds: ['user-1'] });
    await notify(tested, appA.key, { userIds: ['user-2'] });

    const { rows } = await testPool().query<{ app_id: string; user_id: string; seq: string }>(
      `SELECT app_id, user_id, seq FROM deliveries WHERE channel = 'in_app' ORDER BY seq`,
    );

    expect(rows.map((row) => `${row.app_id}:${row.user_id}:${row.seq}`).sort()).toEqual([
      'tenant-a:user-1:1',
      'tenant-a:user-1:2',
      'tenant-a:user-2:1',
      'tenant-b:user-1:1',
    ]);
  });
});

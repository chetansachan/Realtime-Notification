import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { authHeader, createApiKey, notify, subscriberToken } from '../helpers/api.js';
import { resetDatabase, testPool } from '../helpers/db.js';

let tested: TestApp;
let token: string;
let appId: string;

interface InboxItem {
  id: string;
  seq: number;
  title: string;
  readAt: string | null;
}

interface InboxPage {
  items: InboxItem[];
  nextCursor: string | null;
  unreadCount: number;
}

async function history(query: string): Promise<InboxPage> {
  const response = await fetch(`${tested.url}/v1/notifications${query}`, {
    headers: authHeader(token),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as InboxPage;
}

beforeEach(async () => {
  await resetDatabase();
  tested = await createTestApp();
  const key = await createApiKey(tested.app);
  appId = key.appId;
  token = subscriberToken(tested.app, appId, 'user-1');

  for (let index = 1; index <= 5; index++) {
    const response = await notify(tested, key.key, {
      userIds: ['user-1'],
      title: `notification ${index}`,
    });
    expect(response.status).toBe(201);
  }
});

afterEach(async () => {
  await tested.close();
});

describe('inbox', () => {
  it('paginates with a keyset cursor', async () => {
    const page1 = await history('?limit=2');
    expect(page1.items.map((item) => item.seq)).toEqual([5, 4]);
    expect(page1.nextCursor).toBe('4');
    expect(page1.unreadCount).toBe(5);

    const page2 = await history(`?limit=2&before=${page1.nextCursor}`);
    expect(page2.items.map((item) => item.seq)).toEqual([3, 2]);
    expect(page2.nextCursor).toBe('2');

    const page3 = await history(`?limit=2&before=${page2.nextCursor}`);
    expect(page3.items.map((item) => item.seq)).toEqual([1]);
    expect(page3.nextCursor).toBeNull();
  });

  it('filters by unread and category', async () => {
    const unread = await history('?unread=true&limit=10');
    expect(unread.items).toHaveLength(5);

    const other = await history('?category=security&limit=10');
    expect(other.items).toHaveLength(0);
  });

  it('marks read once, keeps counters consistent and publishes the change', async () => {
    const [newest] = (await history('?limit=1')).items;
    expect(newest).toBeDefined();

    const first = await fetch(`${tested.url}/v1/notifications/${newest!.id}/read`, {
      method: 'POST',
      headers: authHeader(token),
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { changed: boolean; unreadCount: number };
    expect(firstBody.changed).toBe(true);
    expect(firstBody.unreadCount).toBe(4);

    const again = await fetch(`${tested.url}/v1/notifications/${newest!.id}/read`, {
      method: 'POST',
      headers: authHeader(token),
    });
    const againBody = (await again.json()) as { changed: boolean; unreadCount: number };
    expect(againBody.changed).toBe(false);
    expect(againBody.unreadCount).toBe(4);

    const count = await fetch(`${tested.url}/v1/notifications/unread-count`, {
      headers: authHeader(token),
    });
    expect(((await count.json()) as { unreadCount: number }).unreadCount).toBe(4);

    const stored = await testPool().query<{ status: string; read_at: Date | null }>(
      `SELECT status, read_at FROM deliveries WHERE notification_id = $1 AND channel = 'in_app'`,
      [newest!.id],
    );
    expect(stored.rows[0]?.status).toBe('read');
    expect(stored.rows[0]?.read_at).not.toBeNull();
  });

  it('never downgrades a read delivery when a late ack arrives', async () => {
    const [newest] = (await history('?limit=1')).items;

    await fetch(`${tested.url}/v1/notifications/${newest!.id}/read`, {
      method: 'POST',
      headers: authHeader(token),
    });

    const ack = await fetch(`${tested.url}/v1/notifications/${newest!.id}/ack`, {
      method: 'POST',
      headers: authHeader(token),
    });
    expect(ack.status).toBe(200);
    expect(((await ack.json()) as { status: string }).status).toBe('read');

    const stored = await testPool().query<{ status: string }>(
      `SELECT status FROM deliveries WHERE notification_id = $1`,
      [newest!.id],
    );
    expect(stored.rows[0]?.status).toBe('read');
  });

  it('marks everything read up to a sequence', async () => {
    const response = await fetch(`${tested.url}/v1/notifications/read-all`, {
      method: 'POST',
      headers: { ...authHeader(token), 'content-type': 'application/json' },
      body: JSON.stringify({ upToSeq: 3 }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { updated: number; unreadCount: number };
    expect(body.updated).toBe(3);
    expect(body.unreadCount).toBe(2);

    const unread = await history('?unread=true&limit=10');
    expect(unread.items.map((item) => item.seq)).toEqual([5, 4]);
  });

  it('returns 404 when marking a notification that is not yours', async () => {
    const response = await fetch(
      `${tested.url}/v1/notifications/00000000-0000-7000-8000-000000000000/read`,
      { method: 'POST', headers: authHeader(token) },
    );
    expect(response.status).toBe(404);
  });
});

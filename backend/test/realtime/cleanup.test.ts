import { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { createApiKey, streamTicket, waitFor } from '../helpers/api.js';
import { SseTestClient, streamUrl } from '../helpers/sse.js';
import { resetDatabase } from '../helpers/db.js';
import { infra } from '../helpers/infra.js';
import { userChannel } from '../../src/shared/redis-keys.js';

let tested: TestApp;
let redis: Redis;

beforeEach(async () => {
  await resetDatabase();
  tested = await createTestApp();
  redis = new Redis(infra().redisUrl, { maxRetriesPerRequest: null });
});

afterEach(async () => {
  await redis.quit();
  await tested.close();
});

async function subscriberCount(channel: string): Promise<number> {
  const result = (await redis.pubsub('NUMSUB', channel)) as unknown[];
  return Number(result[1] ?? 0);
}

describe('connection cleanup', () => {
  it('unsubscribes from Redis when the last local connection closes', async () => {
    const key = await createApiKey(tested.app);
    const channel = userChannel(key.appId, 'user-1');

    const client = await SseTestClient.connect(
      streamUrl(tested.url, await streamTicket(tested.app, key.appId, 'user-1')),
    );

    expect(tested.app.realtime.size).toBe(1);
    expect(tested.app.realtime.connectionCountFor(key.appId, 'user-1')).toBe(1);
    expect(tested.app.realtime.isSubscribed(key.appId, 'user-1')).toBe(true);
    expect(tested.app.realtime.subscriptionRefs(key.appId, 'user-1')).toBe(1);
    expect(await subscriberCount(channel)).toBe(1);

    client.close();

    await waitFor(async () => tested.app.realtime.size === 0);
    expect(tested.app.realtime.connectionCountFor(key.appId, 'user-1')).toBe(0);
    expect(tested.app.realtime.isSubscribed(key.appId, 'user-1')).toBe(false);

    await waitFor(async () => (await subscriberCount(channel)) === 0);
  });

  it('refcounts subscriptions across multiple tabs of the same user', async () => {
    const key = await createApiKey(tested.app);
    const channel = userChannel(key.appId, 'user-1');

    const first = await SseTestClient.connect(
      streamUrl(tested.url, await streamTicket(tested.app, key.appId, 'user-1')),
    );
    const second = await SseTestClient.connect(
      streamUrl(tested.url, await streamTicket(tested.app, key.appId, 'user-1')),
    );

    expect(tested.app.realtime.subscriptionRefs(key.appId, 'user-1')).toBe(2);
    expect(await subscriberCount(channel)).toBe(1);

    first.close();
    await waitFor(async () => tested.app.realtime.connectionCountFor(key.appId, 'user-1') === 1);
    // One tab leaving drops one ref, but the Redis subscription stays.
    expect(tested.app.realtime.subscriptionRefs(key.appId, 'user-1')).toBe(1);
    expect(await subscriberCount(channel)).toBe(1);

    second.close();
    await waitFor(async () => (await subscriberCount(channel)) === 0);
    expect(tested.app.realtime.size).toBe(0);
    expect(tested.app.realtime.subscriptionRefs(key.appId, 'user-1')).toBe(0);
  });

  it('evicts the oldest connection beyond the per-user limit', async () => {
    const limited = await createTestApp({ MAX_CONNECTIONS_PER_USER: 2 });
    try {
      const key = await createApiKey(limited.app);
      const clients = [];
      for (let index = 0; index < 3; index++) {
        clients.push(
          await SseTestClient.connect(
            streamUrl(limited.url, await streamTicket(limited.app, key.appId, 'user-1')),
          ),
        );
      }

      await waitFor(async () => limited.app.realtime.connectionCountFor(key.appId, 'user-1') === 2);
      expect(limited.app.realtime.size).toBe(2);

      for (const client of clients) client.close();
    } finally {
      await limited.close();
    }
  });
});

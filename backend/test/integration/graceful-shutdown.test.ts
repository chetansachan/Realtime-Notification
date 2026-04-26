import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { createApiKey, streamTicket } from '../helpers/api.js';
import { SseTestClient, streamUrl } from '../helpers/sse.js';
import { resetDatabase } from '../helpers/db.js';

let tested: TestApp;

beforeEach(async () => {
  await resetDatabase();
  tested = await createTestApp();
});

afterEach(async () => {
  if (tested.app.server.listening) await tested.close();
});

describe('graceful shutdown', () => {
  it('sends `reconnect` and then closes, so clients can move instances', async () => {
    const key = await createApiKey(tested.app);
    const client = await SseTestClient.connect(
      streamUrl(tested.url, await streamTicket(tested.app, key.appId, 'user-1')),
    );

    expect(tested.app.realtime.size).toBe(1);

    const closing = tested.close();
    const reconnect = await client.waitFor((event) => event.event === 'reconnect', 5000);

    expect(typeof reconnect.data.retryAfterMs).toBe('number');
    expect(reconnect.data.retryAfterMs).toBeGreaterThan(0);

    await closing;
    expect(tested.app.realtime.size).toBe(0);

    client.close();
  });
});

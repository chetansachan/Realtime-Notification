import { beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers/app.js';
import { createApiKey, notify, streamTicket } from './helpers/api.js';
import { resetDatabase } from './helpers/db.js';
import { SseTestClient, streamUrl } from './helpers/sse.js';

describe('debug live delivery via helper', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('probe', async () => {
    const tested = await createTestApp({ REPLAY_LIMIT: 10 });
    const key = await createApiKey(tested.app);
    const client = await SseTestClient.connect(
      streamUrl(tested.url, await streamTicket(tested.app, key.appId, 'user-1')),
    );

    for (let index = 1; index <= 3; index++) {
      const response = await notify(tested, key.key, {
        userIds: ['user-1'],
        title: `n${index}`,
      });
      console.log('notify', index, response.status);
    }

    await new Promise((r) => setTimeout(r, 1000));
    console.log('events', JSON.stringify(client.events));
    console.log('lastEventId', client.lastEventId);

    client.close();
    await tested.close();
    expect(client.sequences()).toEqual([1, 2, 3]);
  });
});

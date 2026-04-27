import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { createApiKey, notify, streamTicket } from '../helpers/api.js';
import { SseTestClient, streamUrl } from '../helpers/sse.js';
import { resetDatabase } from '../helpers/db.js';

let instanceA: TestApp;
let instanceB: TestApp;

beforeEach(async () => {
  await resetDatabase();
  instanceA = await createTestApp({ INSTANCE_ID: 'instance-a' });
  instanceB = await createTestApp({ INSTANCE_ID: 'instance-b' });
});

afterEach(async () => {
  await Promise.all([instanceA.close(), instanceB.close()]);
});

describe('cross-instance delivery', () => {
  it('delivers a notification created on A to a client connected to B', async () => {
    const key = await createApiKey(instanceA.app, { appId: 'app-shared' });
    const ticket = await streamTicket(instanceB.app, key.appId, 'user-1');

    const client = await SseTestClient.connect(streamUrl(instanceB.url, ticket));
    const hello = client.events.find((event) => event.event === 'hello');
    expect(hello?.data.instanceId).toBe('instance-b');
    expect(hello?.data.resumeFrom).toBe(0);

    const response = await notify(instanceA, key.key, {
      userIds: ['user-1'],
      title: 'created on instance A',
    });
    expect(response.status).toBe(201);

    const event = await client.waitForSeq(1);
    expect(event.data.title).toBe('created on instance A');
    expect(event.id).toBe('1');

    // The connection lives on B only; A never subscribed to this user.
    expect(instanceB.app.realtime.connectionCountFor(key.appId, 'user-1')).toBe(1);
    expect(instanceA.app.realtime.connectionCountFor(key.appId, 'user-1')).toBe(0);
    expect(instanceA.app.realtime.isSubscribed(key.appId, 'user-1')).toBe(false);

    client.close();
  });

  it('fans out to the same user on both instances', async () => {
    const key = await createApiKey(instanceA.app, { appId: 'app-shared' });

    const clientA = await SseTestClient.connect(
      streamUrl(instanceA.url, await streamTicket(instanceA.app, key.appId, 'user-1')),
    );
    const clientB = await SseTestClient.connect(
      streamUrl(instanceB.url, await streamTicket(instanceB.app, key.appId, 'user-1')),
    );

    await notify(instanceA, key.key, { userIds: ['user-1'], title: 'both tabs' });

    const [eventA, eventB] = await Promise.all([clientA.waitForSeq(1), clientB.waitForSeq(1)]);
    expect(eventA.data.title).toBe('both tabs');
    expect(eventB.data.title).toBe('both tabs');

    clientA.close();
    clientB.close();
  });
});

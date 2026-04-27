import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { createApiKey, notify, sleep, streamTicket } from '../helpers/api.js';
import { SseTestClient, streamUrl } from '../helpers/sse.js';
import { resetDatabase } from '../helpers/db.js';

let tested: TestApp;

beforeEach(async () => {
  await resetDatabase();
  tested = await createTestApp();
});

afterEach(async () => {
  await tested.close();
});

describe('replay handoff race', () => {
  it('stays gapless and duplicate-free while notifications arrive during reconnects', async () => {
    const key = await createApiKey(tested.app);
    const total = 30;

    // Keep writing while the client churns its connection.
    const sender = (async () => {
      for (let index = 1; index <= total; index++) {
        const response = await notify(tested, key.key, {
          userIds: ['user-1'],
          title: `race ${index}`,
        });
        expect(response.status).toBe(201);
        await sleep(8);
      }
    })();

    let lastSeq = 0;
    const seen = new Set<number>();

    for (let attempt = 0; attempt < 5; attempt++) {
      const client = await SseTestClient.connect(
        streamUrl(tested.url, await streamTicket(tested.app, key.appId, 'user-1'), lastSeq),
      );
      await sleep(90);

      const sequences = client.sequences();
      // No event may be repeated within a single connection.
      expect(new Set(sequences).size).toBe(sequences.length);
      for (const seq of sequences) seen.add(seq);

      lastSeq = Math.max(lastSeq, ...sequences, 0);
      client.close();
      await sleep(25);
    }

    const finalClient = await SseTestClient.connect(
      streamUrl(tested.url, await streamTicket(tested.app, key.appId, 'user-1'), lastSeq),
    );
    await finalClient.waitForSeq(total, 15_000);
    await sleep(50);
    for (const seq of finalClient.sequences()) seen.add(seq);
    finalClient.close();

    await sender;

    expect([...seen].sort((a, b) => a - b)).toEqual(
      Array.from({ length: total }, (_, index) => index + 1),
    );
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { createApiKey, notify, sleep, streamTicket, waitFor } from '../helpers/api.js';
import { SseTestClient, streamUrl, type RecordedEvent } from '../helpers/sse.js';
import { resetDatabase } from '../helpers/db.js';

let tested: TestApp;

beforeEach(async () => {
  await resetDatabase();
  tested = await createTestApp({ REPLAY_LIMIT: 10 });
});

afterEach(async () => {
  await tested.close();
});

interface Frame {
  event: string;
  data: any;
  id?: string;
}

/** Reads raw SSE frames so the Last-Event-ID header path is exercised too. */
async function readFramesUntil(
  url: string,
  headers: Record<string, string>,
  predicate: (frames: Frame[]) => boolean,
  timeoutMs = 8000,
): Promise<Frame[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    expect(response.status).toBe(200);
    if (!response.body) throw new Error('missing body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const frames: Frame[] = [];
    let buffer = '';

    while (!predicate(frames)) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const eventLine = block.split('\n').find((line) => line.startsWith('event:'));
        const dataLine = block.split('\n').find((line) => line.startsWith('data:'));
        const idLine = block.split('\n').find((line) => line.startsWith('id:'));

        if (eventLine && dataLine) {
          frames.push({
            event: eventLine.slice('event:'.length).trim(),
            data: JSON.parse(dataLine.slice('data:'.length).trim()),
            ...(idLine ? { id: idLine.slice('id:'.length).trim() } : {}),
          });
        }
        boundary = buffer.indexOf('\n\n');
      }
    }

    await reader.cancel().catch(() => undefined);
    return frames;
  } finally {
    clearTimeout(timer);
  }
}

describe('replay', () => {
  it('replays exactly the missed notifications when reconnecting with a cursor', async () => {
    const key = await createApiKey(tested.app);

    const first = await SseTestClient.connect(
      streamUrl(tested.url, await streamTicket(tested.app, key.appId, 'user-1')),
    );
    for (let index = 1; index <= 3; index++) {
      const response = await notify(tested, key.key, {
        userIds: ['user-1'],
        title: `notification ${index}`,
      });
      expect(response.status).toBe(201);
    }
    await first.waitForSeq(3);
    expect(first.sequences()).toEqual([1, 2, 3]);
    first.close();

    await waitFor(async () => tested.app.realtime.size === 0);

    for (let index = 4; index <= 6; index++) {
      const response = await notify(tested, key.key, {
        userIds: ['user-1'],
        title: `notification ${index}`,
      });
      expect(response.status).toBe(201);
    }

    const resumed = await SseTestClient.connect(
      streamUrl(tested.url, await streamTicket(tested.app, key.appId, 'user-1'), 3),
    );
    const hello = resumed.events.find((event) => event.event === 'hello');
    expect(hello?.data.resumeFrom).toBe(3);
    expect(hello?.data.lastSeq).toBe(6);

    await resumed.waitForSeq(6);
    expect(resumed.sequences()).toEqual([4, 5, 6]);
    expect(
      resumed.events.find((event) => event.event === 'notification' && event.data.seq === 4)?.id,
    ).toBe('4');

    resumed.close();
  });

  it('honors the Last-Event-ID header', async () => {
    const key = await createApiKey(tested.app);
    for (let index = 1; index <= 5; index++) {
      await notify(tested, key.key, { userIds: ['user-1'], title: `n${index}` });
    }

    const frames = await readFramesUntil(
      `${tested.url}/v1/stream?ticket=${await streamTicket(tested.app, key.appId, 'user-1')}`,
      { accept: 'text/event-stream', 'last-event-id': '3' },
      (seen) => seen.filter((frame) => frame.event === 'notification').length >= 2,
    );

    const notifications = frames.filter((frame) => frame.event === 'notification');
    expect(notifications.map((frame) => frame.data.seq)).toEqual([4, 5]);
    expect(notifications.map((frame) => frame.id)).toEqual(['4', '5']);
  });

  it('asks for a REST resync when the backlog exceeds the replay limit', async () => {
    const small = await createTestApp({ REPLAY_LIMIT: 2 });
    try {
      const key = await createApiKey(small.app);
      for (let index = 1; index <= 5; index++) {
        await notify(small, key.key, { userIds: ['user-1'], title: `n${index}` });
      }

      const client = await SseTestClient.connect(
        streamUrl(small.url, await streamTicket(small.app, key.appId, 'user-1'), 1),
      );

      const resync = await client.waitFor(
        (event: RecordedEvent) => event.event === 'resync',
        5000,
      );
      expect(resync.data.reason).toBe('replay_limit_exceeded');

      await sleep(150);
      expect(client.sequences()).toEqual([]);
      client.close();
    } finally {
      await small.close();
    }
  });

  it('does not replay notifications that have already expired', async () => {
    const key = await createApiKey(tested.app);
    await notify(tested, key.key, { userIds: ['user-1'], title: 'fresh' });
    await notify(tested, key.key, {
      userIds: ['user-1'],
      title: 'expired',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    // Cursor at 1, so replay would normally deliver seq 2 — but it has expired.
    const client = await SseTestClient.connect(
      streamUrl(tested.url, await streamTicket(tested.app, key.appId, 'user-1'), 1),
    );
    await sleep(300);

    expect(client.sequences()).toEqual([]);
    client.close();
  });
});

import { describe, expect, it } from 'vitest';
import { parseStreamEvent } from './events.js';

describe('parseStreamEvent', () => {
  it('parses a notification payload and fills optional fields', () => {
    const parsed = parseStreamEvent(
      'notification',
      JSON.stringify({
        id: 'n1',
        seq: 4,
        category: 'billing',
        title: 'Invoice paid',
        body: null,
        data: { url: 'https://example.com' },
        priority: 'high',
        createdAt: '2026-01-01T00:00:00.000Z',
        readAt: null,
      }),
    );

    expect(parsed).toEqual({
      type: 'notification',
      seq: 4,
      payload: expect.objectContaining({ id: 'n1', title: 'Invoice paid', seq: 4 }),
    });
  });

  it('rejects malformed JSON and missing required fields', () => {
    expect(parseStreamEvent('notification', 'not json')).toBeNull();
    expect(parseStreamEvent('notification', JSON.stringify({ id: 1 }))).toBeNull();
    expect(parseStreamEvent('hello', JSON.stringify({ instanceId: 'x' }))).toBeNull();
    expect(parseStreamEvent('read', JSON.stringify({ notificationId: 'n1' }))).toBeNull();
  });

  it('parses control events', () => {
    expect(
      parseStreamEvent(
        'hello',
        JSON.stringify({ instanceId: 'api-1', lastSeq: 9, unreadCount: 2, resumeFrom: 4 }),
      ),
    ).toEqual({ type: 'hello', instanceId: 'api-1', lastSeq: 9, unreadCount: 2, resumeFrom: 4 });

    expect(parseStreamEvent('read_all', JSON.stringify({ unreadCount: 0 }))).toEqual({
      type: 'read_all',
      unreadCount: 0,
    });

    expect(parseStreamEvent('reconnect', JSON.stringify({ retryAfterMs: 800 }))).toEqual({
      type: 'reconnect',
      retryAfterMs: 800,
    });

    expect(parseStreamEvent('unknown', '{}')).toBeNull();
  });
});

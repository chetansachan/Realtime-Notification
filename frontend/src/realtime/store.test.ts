import { beforeEach, describe, expect, it } from 'vitest';
import { useRealtimeStore } from './store.js';

beforeEach(() => {
  useRealtimeStore.getState().reset();
});

describe('realtime store', () => {
  it('clamps unread counts and never moves the cursor backwards', () => {
    const store = useRealtimeStore.getState();
    store.setUnread(-5);
    expect(useRealtimeStore.getState().unreadCount).toBe(0);

    store.setUnread(7);
    store.setLastSeq(3);
    store.setLastSeq(1);
    expect(useRealtimeStore.getState().lastSeq).toBe(3);
  });

  it('caps the event log at 200 newest-first entries', () => {
    for (let index = 0; index < 240; index += 1) {
      useRealtimeStore.getState().logEvent({
        id: String(index),
        at: index,
        kind: 'notification',
        label: `event ${index}`,
      });
    }
    const events = useRealtimeStore.getState().events;
    expect(events).toHaveLength(200);
    expect(events[0]?.id).toBe('239');
  });

  it('clears retry metadata once live', () => {
    useRealtimeStore.getState().setRetry(Date.now() + 5000, 5000);
    useRealtimeStore.getState().setStatus('live');
    expect(useRealtimeStore.getState().nextRetryAt).toBeNull();
    expect(useRealtimeStore.getState().retryDelayMs).toBeNull();
  });
});

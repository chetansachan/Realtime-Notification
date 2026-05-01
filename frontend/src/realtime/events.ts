import type { NotificationItem } from '../lib/types.js';

export type StreamEvent =
  | { type: 'notification'; seq: number; payload: NotificationItem }
  | { type: 'read'; notificationId: string; unreadCount: number }
  | { type: 'read_all'; unreadCount: number }
  | { type: 'unread_count'; unreadCount: number }
  | { type: 'resync'; reason: string }
  | { type: 'reconnect'; retryAfterMs: number }
  | {
      type: 'hello';
      instanceId: string;
      lastSeq: number;
      unreadCount: number;
      resumeFrom: number;
    };

export type StreamEventType = StreamEvent['type'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isNotificationEvent(
  event: StreamEvent,
): event is Extract<StreamEvent, { type: 'notification' }> {
  return event.type === 'notification';
}

/**
 * Mirrors the backend's SSE encoding: `notification` frames carry the payload
 * itself, control frames carry a small object. Malformed data is dropped, never
 * rendered.
 */
export function parseStreamEvent(event: string, raw: string): StreamEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;

  switch (event) {
    case 'notification': {
      if (
        typeof data.id !== 'string' ||
        typeof data.seq !== 'number' ||
        typeof data.title !== 'string'
      ) {
        return null;
      }
      const payload: NotificationItem = {
        id: data.id,
        seq: data.seq,
        category: typeof data.category === 'string' ? data.category : 'general',
        title: data.title,
        body: typeof data.body === 'string' ? data.body : null,
        data: isRecord(data.data) ? data.data : null,
        priority: typeof data.priority === 'string' ? data.priority : 'normal',
        createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
        readAt: typeof data.readAt === 'string' ? data.readAt : null,
      };
      return { type: 'notification', seq: payload.seq, payload };
    }
    case 'hello': {
      if (
        typeof data.instanceId !== 'string' ||
        typeof data.lastSeq !== 'number' ||
        typeof data.unreadCount !== 'number' ||
        typeof data.resumeFrom !== 'number'
      ) {
        return null;
      }
      return {
        type: 'hello',
        instanceId: data.instanceId,
        lastSeq: data.lastSeq,
        unreadCount: data.unreadCount,
        resumeFrom: data.resumeFrom,
      };
    }
    case 'read': {
      if (typeof data.notificationId !== 'string' || typeof data.unreadCount !== 'number') {
        return null;
      }
      return {
        type: 'read',
        notificationId: data.notificationId,
        unreadCount: data.unreadCount,
      };
    }
    case 'read_all':
    case 'unread_count': {
      if (typeof data.unreadCount !== 'number') return null;
      return { type: event, unreadCount: data.unreadCount };
    }
    case 'resync': {
      return { type: 'resync', reason: typeof data.reason === 'string' ? data.reason : 'unknown' };
    }
    case 'reconnect': {
      if (typeof data.retryAfterMs !== 'number') return null;
      return { type: 'reconnect', retryAfterMs: data.retryAfterMs };
    }
    default:
      return null;
  }
}

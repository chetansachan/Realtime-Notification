// [initial module draft]
import type { NotificationDto } from '../shared/schemas.js';

export type NotificationPayload = NotificationDto;

export type StreamEvent =
  | { type: 'notification'; seq: number; payload: NotificationPayload }
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

/**
 * What travels through Redis. Deliberately separate from StreamEvent: a dropped
 * or malformed hint must never corrupt the connection state.
 */
export type PublishedEvent =
  | { v: 1; kind: 'notification'; ts: number; seq: number; notification: NotificationPayload }
  | { v: 1; kind: 'read'; ts: number; notificationId: string; unreadCount: number }
  | { v: 1; kind: 'read_all'; ts: number; unreadCount: number }
  | { v: 1; kind: 'unread_count'; ts: number; unreadCount: number };

function sseFrame(eventName: string, data: unknown, id?: number): string {
  const lines: string[] = [];
  if (id !== undefined) lines.push(`id: ${id}`);
  lines.push(`event: ${eventName}`);
  // JSON.stringify never emits a raw newline, so one `data:` line is always valid.
  lines.push(`data: ${JSON.stringify(data)}`);
  return `${lines.join('\n')}\n\n`;
}

export const SSE_COMMENT_FRAME = ': ping\n\n';

export function encodeSseEvent(event: StreamEvent): string {
  switch (event.type) {
    case 'notification':
      return sseFrame('notification', event.payload, event.seq);
    case 'read':
      return sseFrame('read', {
        notificationId: event.notificationId,
        unreadCount: event.unreadCount,
      });
    case 'read_all':
      return sseFrame('read_all', { unreadCount: event.unreadCount });
    case 'unread_count':
      return sseFrame('unread_count', { unreadCount: event.unreadCount });
    case 'resync':
      return sseFrame('resync', { reason: event.reason });
    case 'reconnect':
      return sseFrame('reconnect', { retryAfterMs: event.retryAfterMs });
    case 'hello':
      return sseFrame('hello', {
        instanceId: event.instanceId,
        lastSeq: event.lastSeq,
        unreadCount: event.unreadCount,
        resumeFrom: event.resumeFrom,
      });
  }
}

export function encodePublished(event: PublishedEvent): string {
  return JSON.stringify(event);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function decodePublished(raw: string): PublishedEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.v !== 1 || typeof parsed.kind !== 'string') return null;
  if (typeof parsed.ts !== 'number') return null;

  switch (parsed.kind) {
    case 'notification': {
      const notification = parsed.notification;
      if (typeof parsed.seq !== 'number' || !isRecord(notification)) return null;
      if (typeof notification.id !== 'string' || typeof notification.title !== 'string') {
        return null;
      }
      return {
        v: 1,
        kind: 'notification',
        ts: parsed.ts,
        seq: parsed.seq,
        notification: notification as unknown as NotificationPayload,
      };
    }
    case 'read': {
      if (typeof parsed.notificationId !== 'string' || typeof parsed.unreadCount !== 'number') {
        return null;
      }
      return {
        v: 1,
        kind: 'read',
        ts: parsed.ts,
        notificationId: parsed.notificationId,
        unreadCount: parsed.unreadCount,
      };
    }
    case 'read_all':
    case 'unread_count': {
      if (typeof parsed.unreadCount !== 'number') return null;
      return {
        v: 1,
        kind: parsed.kind,
        ts: parsed.ts,
        unreadCount: parsed.unreadCount,
      };
    }
    default:
      return null;
  }
}

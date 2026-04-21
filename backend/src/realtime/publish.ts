import type { Redis } from 'ioredis';
import { userChannel } from '../shared/redis-keys.js';
import { encodePublished, type NotificationPayload, type PublishedEvent } from './events.js';
import type { AppLogger } from '../shared/logger.js';

/**
 * Publishing happens strictly after the transaction commits. A failure here is
 * logged but never fails the request: the row is durable and replay covers it.
 */
export async function publishEvent(
  redis: Redis,
  appId: string,
  userId: string,
  event: PublishedEvent,
  logger?: AppLogger,
): Promise<number> {
  try {
    return await redis.publish(userChannel(appId, userId), encodePublished(event));
  } catch (err) {
    logger?.warn({ err, appId, userId }, 'redis publish failed; relying on replay');
    return 0;
  }
}

export function notificationEvent(seq: number, notification: NotificationPayload): PublishedEvent {
  return { v: 1, kind: 'notification', ts: Date.now(), seq, notification };
}

export function readEvent(notificationId: string, unreadCount: number): PublishedEvent {
  return { v: 1, kind: 'read', ts: Date.now(), notificationId, unreadCount };
}

export function readAllEvent(unreadCount: number): PublishedEvent {
  return { v: 1, kind: 'read_all', ts: Date.now(), unreadCount };
}

export function unreadCountEvent(unreadCount: number): PublishedEvent {
  return { v: 1, kind: 'unread_count', ts: Date.now(), unreadCount };
}

import type { NotificationPayload } from '../../realtime/events.js';

export interface NotificationRowLike {
  id: string;
  category: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  priority: 'low' | 'normal' | 'high';
  created_at: Date;
}

export function toNotificationPayload(
  row: NotificationRowLike,
  seq: number,
  readAt: Date | null = null,
): NotificationPayload {
  return {
    id: row.id,
    seq,
    category: row.category,
    title: row.title,
    body: row.body,
    data: row.data,
    priority: row.priority,
    createdAt: row.created_at.toISOString(),
    readAt: readAt ? readAt.toISOString() : null,
  };
}

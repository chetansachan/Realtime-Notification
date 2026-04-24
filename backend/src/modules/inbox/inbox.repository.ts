import type { DbExecutor } from '../../db/types.js';
import type { NotificationPayload } from '../../realtime/events.js';

export interface ListInboxInput {
  appId: string;
  userId: string;
  before?: number | undefined;
  limit: number;
  unread?: boolean | undefined;
  category?: string | undefined;
}

export interface InboxRow {
  id: string;
  seq: number | null;
  category: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  priority: 'low' | 'normal' | 'high';
  created_at: Date;
  read_at: Date | null;
}

export async function listInbox(
  db: DbExecutor,
  input: ListInboxInput,
): Promise<{ items: NotificationPayload[]; hasMore: boolean }> {
  let query = db
    .selectFrom('deliveries as d')
    .innerJoin('notifications as n', 'n.id', 'd.notification_id')
    .select([
      'n.id as id',
      'd.seq as seq',
      'n.category as category',
      'n.title as title',
      'n.body as body',
      'n.data as data',
      'n.priority as priority',
      'n.created_at as created_at',
      'd.read_at as read_at',
    ])
    .where('d.app_id', '=', input.appId)
    .where('d.user_id', '=', input.userId)
    .where('d.channel', '=', 'in_app')
    .where('d.seq', 'is not', null)
    .orderBy('d.seq', 'desc')
    .limit(input.limit + 1);

  if (input.before !== undefined) {
    query = query.where('d.seq', '<', input.before);
  }
  if (input.unread === true) {
    query = query.where('d.read_at', 'is', null);
  }
  if (input.category !== undefined) {
    query = query.where('n.category', '=', input.category);
  }

  const rows = (await query.execute()) as InboxRow[];
  const hasMore = rows.length > input.limit;
  const visible = rows.slice(0, input.limit);

  return {
    items: visible
      .filter((row): row is InboxRow & { seq: number } => row.seq !== null)
      .map((row) => ({
        id: row.id,
        seq: row.seq,
        category: row.category,
        title: row.title,
        body: row.body,
        data: row.data,
        priority: row.priority,
        createdAt: row.created_at.toISOString(),
        readAt: row.read_at ? row.read_at.toISOString() : null,
      })),
    hasMore,
  };
}

export async function getUnreadCount(
  db: DbExecutor,
  appId: string,
  userId: string,
): Promise<number> {
  const row = await db
    .selectFrom('user_streams')
    .select('unread_count')
    .where('app_id', '=', appId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return row?.unread_count ?? 0;
}

export async function findDelivery(
  db: DbExecutor,
  appId: string,
  userId: string,
  notificationId: string,
) {
  return db
    .selectFrom('deliveries')
    .selectAll()
    .where('app_id', '=', appId)
    .where('user_id', '=', userId)
    .where('notification_id', '=', notificationId)
    .where('channel', '=', 'in_app')
    .executeTakeFirst();
}

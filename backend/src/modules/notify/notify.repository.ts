import { sql } from 'kysely';
import type { DbExecutor, DeliveryChannel, DeliveryStatus } from '../../db/types.js';
import { newId } from '../../shared/ids.js';

export interface InsertNotificationInput {
  appId: string;
  category: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  priority: 'low' | 'normal' | 'high';
  channels: DeliveryChannel[];
  idempotencyKey: string | null;
  expiresAt: Date | null;
}

export async function insertNotification(db: DbExecutor, input: InsertNotificationInput) {
  return db
    .insertInto('notifications')
    .values({
      id: newId(),
      app_id: input.appId,
      category: input.category,
      title: input.title,
      body: input.body,
      data: input.data ? JSON.stringify(input.data) : null,
      priority: input.priority,
      channels: input.channels,
      idempotency_key: input.idempotencyKey,
      expires_at: input.expiresAt,
    })
    .onConflict((oc) => oc.doNothing())
    .returningAll()
    .executeTakeFirst();
}

export async function findNotificationByIdempotencyKey(
  db: DbExecutor,
  appId: string,
  idempotencyKey: string,
) {
  return db
    .selectFrom('notifications')
    .selectAll()
    .where('app_id', '=', appId)
    .where('idempotency_key', '=', idempotencyKey)
    .executeTakeFirst();
}

export async function findNotification(db: DbExecutor, appId: string, id: string) {
  return db
    .selectFrom('notifications')
    .selectAll()
    .where('app_id', '=', appId)
    .where('id', '=', id)
    .executeTakeFirst();
}

/**
 * Allocates the next per-user sequence number and bumps the unread counter in
 * one statement. The row lock this takes serialises concurrent notifications
 * for the same user until commit, which is what makes the sequence gapless:
 * order of allocation == order of commit, and a rollback rolls the counter back.
 */
export async function allocateSequence(
  db: DbExecutor,
  appId: string,
  userId: string,
): Promise<number> {
  const result = await sql<{ last_seq: number }>`
    INSERT INTO user_streams (app_id, user_id, last_seq, unread_count)
    VALUES (${appId}, ${userId}, 1, 1)
    ON CONFLICT (app_id, user_id)
    DO UPDATE SET last_seq   = user_streams.last_seq + 1,
                  unread_count = user_streams.unread_count + 1,
                  updated_at = now()
    RETURNING last_seq
  `.execute(db);

  const seq = result.rows[0]?.last_seq;
  if (typeof seq !== 'number') {
    throw new Error('failed to allocate sequence number');
  }
  return seq;
}

export interface InsertDeliveryInput {
  notificationId: string;
  appId: string;
  userId: string;
  channel: DeliveryChannel;
  seq: number | null;
  status: DeliveryStatus;
}

export async function insertDelivery(db: DbExecutor, input: InsertDeliveryInput) {
  return db
    .insertInto('deliveries')
    .values({
      id: newId(),
      notification_id: input.notificationId,
      app_id: input.appId,
      user_id: input.userId,
      channel: input.channel,
      seq: input.seq,
      status: input.status,
    })
    .returning(['id', 'channel', 'status', 'seq'])
    .executeTakeFirstOrThrow();
}

export async function listDeliveries(
  db: DbExecutor,
  appId: string,
  notificationId: string,
) {
  return db
    .selectFrom('deliveries')
    .selectAll()
    .where('app_id', '=', appId)
    .where('notification_id', '=', notificationId)
    .orderBy('user_id', 'asc')
    .orderBy('channel', 'asc')
    .execute();
}

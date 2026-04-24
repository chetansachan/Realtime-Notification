// [initial module draft]
import type { AppServer } from '../../types/app.js';
import { sql } from 'kysely';
import { notFound } from '../../shared/errors.js';
import { readAllEvent, readEvent, publishEvent } from '../../realtime/publish.js';
import { findDelivery, getUnreadCount, listInbox } from './inbox.repository.js';
import type { InboxQuery, ReadAllBody } from './inbox.schemas.js';

export class InboxService {
  readonly #app: AppServer;

  constructor(app: AppServer) {
    this.#app = app;
  }

  async list(appId: string, userId: string, query: InboxQuery) {
    const limit = query.limit ?? 30;
    const { items, hasMore } = await listInbox(this.#app.db, {
      appId,
      userId,
      before: query.before,
      limit,
      unread: query.unread,
      category: query.category,
    });

    const unreadCount = await getUnreadCount(this.#app.db, appId, userId);
    // The cursor is the smallest seq in the page: keyset pagination stays O(limit).
    const smallest = items.at(-1)?.seq;
    return {
      items,
      nextCursor: hasMore && smallest !== undefined ? String(smallest) : null,
      unreadCount,
    };
  }

  async unreadCount(appId: string, userId: string) {
    return { unreadCount: await getUnreadCount(this.#app.db, appId, userId) };
  }

  async markRead(appId: string, userId: string, notificationId: string) {
    const result = await this.#app.withTransaction(async (trx) => {
      const updated = await trx
        .updateTable('deliveries')
        .set({ status: 'read', read_at: new Date() })
        .where('app_id', '=', appId)
        .where('user_id', '=', userId)
        .where('notification_id', '=', notificationId)
        .where('channel', '=', 'in_app')
        .where('read_at', 'is', null)
        .returning(['id'])
        .executeTakeFirst();

      if (!updated) {
        const existing = await findDelivery(trx, appId, userId, notificationId);
        if (!existing) throw notFound('Notification not found for this user');
        return { changed: false, unreadCount: await getUnreadCount(trx, appId, userId) };
      }

      // Only decrement when a row actually flipped: idempotent by construction.
      const state = await trx
        .updateTable('user_streams')
        .set({
          unread_count: sql<number>`greatest(unread_count - 1, 0)`,
          updated_at: new Date(),
        })
        .where('app_id', '=', appId)
        .where('user_id', '=', userId)
        .returning('unread_count')
        .executeTakeFirst();

      return { changed: true, unreadCount: state?.unread_count ?? 0 };
    });

    if (result.changed) {
      await publishEvent(
        this.#app.redis,
        appId,
        userId,
        readEvent(notificationId, result.unreadCount),
        this.#app.log,
      );
    }

    return { id: notificationId, ...result };
  }

  async readAll(appId: string, userId: string, input: ReadAllBody) {
    const result = await this.#app.withTransaction(async (trx) => {
      let update = trx
        .updateTable('deliveries')
        .set({ status: 'read', read_at: new Date() })
        .where('app_id', '=', appId)
        .where('user_id', '=', userId)
        .where('channel', '=', 'in_app')
        .where('read_at', 'is', null);

      if (input.upToSeq !== undefined) {
        update = update.where('seq', '<=', input.upToSeq);
      }
      if (input.category !== undefined) {
        update = update.where(
          'notification_id',
          'in',
          trx
            .selectFrom('notifications')
            .select('id')
            .where('app_id', '=', appId)
            .where('category', '=', input.category),
        );
      }

      const updated = await update.returning('id').execute();
      if (updated.length === 0) {
        return { updated: 0, unreadCount: await getUnreadCount(trx, appId, userId) };
      }

      const state = await trx
        .updateTable('user_streams')
        .set({
          unread_count: sql<number>`greatest(unread_count - ${updated.length}, 0)`,
          updated_at: new Date(),
        })
        .where('app_id', '=', appId)
        .where('user_id', '=', userId)
        .returning('unread_count')
        .executeTakeFirst();

      return { updated: updated.length, unreadCount: state?.unread_count ?? 0 };
    });

    if (result.updated > 0) {
      await publishEvent(
        this.#app.redis,
        appId,
        userId,
        readAllEvent(result.unreadCount),
        this.#app.log,
      );
    }

    return result;
  }

  async ack(appId: string, userId: string, notificationId: string) {
    const updated = await this.#app.db
      .updateTable('deliveries')
      .set({ status: 'delivered', delivered_at: new Date() })
      .where('app_id', '=', appId)
      .where('user_id', '=', userId)
      .where('notification_id', '=', notificationId)
      .where('channel', '=', 'in_app')
      .where('status', 'in', ['queued', 'sent'])
      .where('delivered_at', 'is', null)
      .returning(['id', 'status'])
      .executeTakeFirst();

    if (updated) return { id: notificationId, status: updated.status };

    // A late ack must never move `read` back to `delivered`.
    const existing = await findDelivery(this.#app.db, appId, userId, notificationId);
    if (!existing) throw notFound('Notification not found for this user');
    return { id: notificationId, status: existing.status };
  }
}

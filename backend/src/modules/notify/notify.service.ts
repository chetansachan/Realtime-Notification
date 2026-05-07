import type { AppServer } from '../../types/app.js';
import type { DbExecutor, DeliveryChannel } from '../../db/types.js';
import { planDelivery } from '../../delivery/router.js';
import { notificationEvent, publishEvent } from '../../realtime/publish.js';
import { badRequest, conflict, idempotencyConflict, notFound } from '../../shared/errors.js';
import { countGroupMembers, findGroup, listGroupMembersPage } from '../groups/groups.repository.js';
import { toNotificationPayload } from './notify.mapper.js';
import {
  allocateSequence,
  findNotificationByIdempotencyKey,
  insertDelivery,
  insertNotification,
} from './notify.repository.js';
import type { NotifyBody, NotifyResponse } from './notify.schemas.js';
import { enqueueDeliveryJobs } from '../../jobs/queues.js';

interface PersistedNotification {
  row: Awaited<ReturnType<typeof insertNotification>>;
  duplicate: boolean;
}

interface NotificationRow {
  id: string;
  category: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  priority: 'low' | 'normal' | 'high';
  channels: DeliveryChannel[];
  created_at: Date;
  expires_at: Date | null;
}

export interface NotifyOutcome {
  statusCode: number;
  body: NotifyResponse;
}

export class NotifyService {
  readonly #app: AppServer;

  constructor(app: AppServer) {
    this.#app = app;
  }

  async notify(
    appId: string,
    input: NotifyBody,
    idempotencyKey: string | null,
  ): Promise<NotifyOutcome> {
    const hasUsers = Array.isArray(input.userIds) && input.userIds.length > 0;
    const hasGroup = typeof input.groupId === 'string' && input.groupId.length > 0;
    if (hasUsers === hasGroup) {
      throw badRequest('Provide exactly one of "userIds" or "groupId"');
    }

    const userIds = hasUsers ? [...new Set(input.userIds ?? [])].sort() : null;
    const groupId = hasGroup ? (input.groupId as string) : null;

    let recipients = userIds?.length ?? 0;
    if (groupId !== null) {
      const group = await findGroup(this.#app.db, appId, groupId);
      if (!group) throw notFound('Group not found');
      recipients = await countGroupMembers(this.#app.db, groupId);
    }

    // Large fan-outs return 202 and let a worker expand them in chunks, so the
    // API request never holds a transaction across thousands of rows.
    if (recipients > this.#app.config.INLINE_RECIPIENT_LIMIT) {
      return this.#enqueueFanout(appId, input, idempotencyKey, { userIds, groupId, recipients });
    }

    const result = await this.#app.withTransaction(async (trx) => {
      const persisted = await this.#persistNotification(trx, appId, input, idempotencyKey);
      const row = persisted.row as unknown as NotificationRow;

      if (persisted.duplicate) {
        return {
          row,
          duplicate: true,
          outputs: [] as { userId: string; seq: number }[],
          deliveries: [] as { id: string; channel: DeliveryChannel }[],
          accepted: 0,
          suppressed: 0,
          recipientCount: recipients,
        };
      }

      const targets =
        userIds ?? (await this.#loadAllGroupMembers(trx, groupId as string));

      // Consistent lock order: two overlapping group notifications can never
      // deadlock on user_streams.
      const sorted = [...targets].sort();

      const outputs: { userId: string; seq: number }[] = [];
      const deliveries: { id: string; channel: DeliveryChannel }[] = [];
      let suppressed = 0;

      for (const userId of sorted) {
        const plan = await planDelivery(trx, appId, userId, row.category, input.channels);

        if (plan.inApp) {
          const seq = await allocateSequence(trx, appId, userId);
          const delivery = await insertDelivery(trx, {
            notificationId: row.id,
            appId,
            userId,
            channel: 'in_app',
            seq,
            status: 'queued',
          });
          outputs.push({ userId, seq });
          deliveries.push({ id: delivery.id, channel: 'in_app' });
        } else {
          const delivery = await insertDelivery(trx, {
            notificationId: row.id,
            appId,
            userId,
            channel: 'in_app',
            seq: null,
            status: 'suppressed',
          });
          deliveries.push({ id: delivery.id, channel: 'in_app' });
          suppressed++;
        }

        if (plan.email) {
          const delivery = await insertDelivery(trx, {
            notificationId: row.id,
            appId,
            userId,
            channel: 'email',
            seq: null,
            status: 'queued',
          });
          deliveries.push({ id: delivery.id, channel: 'email' });
        }

        if (plan.webhook) {
          const delivery = await insertDelivery(trx, {
            notificationId: row.id,
            appId,
            userId,
            channel: 'webhook',
            seq: null,
            status: 'queued',
          });
          deliveries.push({ id: delivery.id, channel: 'webhook' });
        }
      }

      return {
        row,
        duplicate: false,
        outputs,
        deliveries,
        accepted: outputs.length,
        suppressed,
        recipientCount: sorted.length,
      };
    });

    const { row } = result;

    if (result.duplicate) {
      return {
        statusCode: 200,
        body: {
          id: row.id,
          status: 'duplicate',
          recipients: result.recipientCount,
          accepted: 0,
          suppressed: 0,
          createdAt: row.created_at.toISOString(),
        },
      };
    }

    // Only now, after COMMIT, do we tell anyone. Publishing earlier would let a
    // client receive an event whose row is not yet visible.
    await Promise.all(
      result.outputs.map((output) =>
        publishEvent(
          this.#app.redis,
          appId,
          output.userId,
          notificationEvent(output.seq, toNotificationPayload(row, output.seq)),
          this.#app.log,
        ),
      ),
    );

    this.#app.metrics.notificationsCreated.inc();

    await enqueueDeliveryJobs(this.#app.queues, this.#app, result.deliveries, {
      escalationDelayMs: this.#app.config.ESCALATION_DELAY_MS,
      escalationEnabled: !row.channels.includes('email'),
    });

    return {
      statusCode: 201,
      body: {
        id: row.id,
        status: 'created',
        recipients: result.recipientCount,
        accepted: result.accepted,
        suppressed: result.suppressed,
        createdAt: row.created_at.toISOString(),
      },
    };
  }

  async #enqueueFanout(
    appId: string,
    input: NotifyBody,
    idempotencyKey: string | null,
    target: { userIds: string[] | null; groupId: string | null; recipients: number },
  ): Promise<NotifyOutcome> {
    const persisted = await this.#persistNotification(this.#app.db, appId, input, idempotencyKey);
    const row = persisted.row as unknown as NotificationRow;

    const body: NotifyResponse = {
      id: row.id,
      status: persisted.duplicate ? 'duplicate' : 'fanout_queued',
      recipients: target.recipients,
      accepted: 0,
      suppressed: 0,
      createdAt: row.created_at.toISOString(),
    };

    if (persisted.duplicate) {
      return { statusCode: 200, body };
    }

    await this.#app.queues.fanout.add('fanout', {
      notificationId: row.id,
      appId,
      ...(target.groupId ? { groupId: target.groupId } : {}),
      ...(target.userIds ? { userIds: target.userIds } : {}),
      ...(input.channels ? { channels: input.channels } : {}),
    });

    this.#app.metrics.notificationsCreated.inc();
    return { statusCode: 202, body };
  }

  async #persistNotification(
    db: DbExecutor,
    appId: string,
    input: NotifyBody,
    idempotencyKey: string | null,
  ): Promise<PersistedNotification> {
    const values = {
      appId,
      category: input.category,
      title: input.title,
      body: input.body ?? null,
      data: input.data ?? null,
      priority: input.priority ?? ('normal' as const),
      channels: input.channels ?? (['in_app'] as DeliveryChannel[]),
      idempotencyKey,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    };

    if (idempotencyKey === null) {
      const row = await insertNotification(db, values);
      if (!row) throw conflict('Notification could not be created');
      return { row, duplicate: false };
    }

    const inserted = await insertNotification(db, values);
    if (inserted) return { row: inserted, duplicate: false };

    const existing = await findNotificationByIdempotencyKey(db, appId, idempotencyKey);
    if (!existing) {
      throw conflict('Idempotency key was used concurrently; retry the request');
    }

    if (
      existing.category !== values.category ||
      existing.title !== values.title ||
      (existing.body ?? null) !== values.body
    ) {
      throw idempotencyConflict(
        'This Idempotency-Key was already used for a different notification',
      );
    }

    return { row: existing, duplicate: true };
  }

  async #loadAllGroupMembers(db: DbExecutor, groupId: string): Promise<string[]> {
    const pageSize = 1000;
    const members: string[] = [];
    let cursor: string | null = null;

    for (;;) {
      const page = await listGroupMembersPage(db, groupId, cursor, pageSize);
      members.push(...page);
      if (page.length < pageSize) break;
      cursor = page[page.length - 1] ?? null;
      if (cursor === null) break;
    }

    return members;
  }
}

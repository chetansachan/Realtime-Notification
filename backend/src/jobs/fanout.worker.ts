import type { DeliveryChannel } from '../db/types.js';
import { planDelivery } from '../delivery/router.js';
import { toNotificationPayload } from '../modules/notify/notify.mapper.js';
import {
  allocateSequence,
  insertDelivery,
} from '../modules/notify/notify.repository.js';
import { findNotification } from '../modules/notify/notify.repository.js';
import { listGroupMembersPage } from '../modules/groups/groups.repository.js';
import { notificationEvent, publishEvent } from '../realtime/publish.js';
import { enqueueDeliveryJobs, type FanoutJob } from './queues.js';
import { errorMessage, type WorkerContext } from './context.js';

/**
 * Expands a large audience outside the request transaction: one transaction per
 * chunk of recipients, publishing after each chunk commits.
 *
 * Retries are safe: a recipient that already has an in_app delivery row is
 * skipped *before* a sequence number is allocated, so a re-run cannot create
 * gaps in the per-user sequence.
 */
export async function processFanoutJob(
  ctx: WorkerContext,
  data: FanoutJob,
): Promise<{ processed: number }> {
  const notification = await findNotification(ctx.db, data.appId, data.notificationId);
  if (!notification) {
    ctx.logger.warn(
      { notificationId: data.notificationId, appId: data.appId },
      'fanout target notification no longer exists',
    );
    return { processed: 0 };
  }

  const channels = data.channels ?? notification.channels;
  const chunkSize = ctx.config.FANOUT_CHUNK_SIZE;
  let processed = 0;

  const handleChunk = async (members: string[]): Promise<void> => {
    const result = await ctx.db.transaction().execute(async (trx) => {
      const outputs: { userId: string; seq: number }[] = [];
      const deliveries: { id: string; channel: DeliveryChannel }[] = [];

      for (const userId of [...members].sort()) {
        const existing = await trx
          .selectFrom('deliveries')
          .select('id')
          .where('notification_id', '=', notification.id)
          .where('user_id', '=', userId)
          .where('channel', '=', 'in_app')
          .executeTakeFirst();
        if (existing) continue;

        const plan = await planDelivery(trx, data.appId, userId, notification.category, channels);

        if (plan.inApp) {
          const seq = await allocateSequence(trx, data.appId, userId);
          const delivery = await insertDelivery(trx, {
            notificationId: notification.id,
            appId: data.appId,
            userId,
            channel: 'in_app',
            seq,
            status: 'queued',
          });
          outputs.push({ userId, seq });
          deliveries.push({ id: delivery.id, channel: 'in_app' });
        } else {
          const delivery = await insertDelivery(trx, {
            notificationId: notification.id,
            appId: data.appId,
            userId,
            channel: 'in_app',
            seq: null,
            status: 'suppressed',
          });
          deliveries.push({ id: delivery.id, channel: 'in_app' });
        }

        if (plan.email) {
          const delivery = await insertDelivery(trx, {
            notificationId: notification.id,
            appId: data.appId,
            userId,
            channel: 'email',
            seq: null,
            status: 'queued',
          });
          deliveries.push({ id: delivery.id, channel: 'email' });
        }
        if (plan.webhook) {
          const delivery = await insertDelivery(trx, {
            notificationId: notification.id,
            appId: data.appId,
            userId,
            channel: 'webhook',
            seq: null,
            status: 'queued',
          });
          deliveries.push({ id: delivery.id, channel: 'webhook' });
        }
      }

      return { outputs, deliveries };
    });

    await Promise.all(
      result.outputs.map((output) =>
        publishEvent(
          ctx.redis,
          data.appId,
          output.userId,
          notificationEvent(output.seq, toNotificationPayload(notification, output.seq)),
          ctx.logger,
        ),
      ),
    );

    await enqueueDeliveryJobs(
      ctx.queues,
      { log: { warn: (obj, msg) => ctx.logger.warn(obj, msg) } },
      result.deliveries,
      {
        escalationDelayMs: ctx.config.ESCALATION_DELAY_MS,
        escalationEnabled: !notification.channels.includes('email'),
      },
    );

    processed += members.length;
  };

  try {
    if (data.userIds) {
      for (let offset = 0; offset < data.userIds.length; offset += chunkSize) {
        await handleChunk(data.userIds.slice(offset, offset + chunkSize));
      }
    } else if (data.groupId) {
      let cursor: string | null = null;
      for (;;) {
        const members = await listGroupMembersPage(ctx.db, data.groupId, cursor, chunkSize);
        if (members.length === 0) break;
        await handleChunk(members);
        cursor = members[members.length - 1] ?? null;
        if (cursor === null || members.length < chunkSize) break;
      }
    }
  } catch (err) {
    ctx.logger.error(
      { err, notificationId: data.notificationId },
      `fanout chunk failed: ${errorMessage(err)}`,
    );
    throw err;
  }

  ctx.logger.info({ notificationId: data.notificationId, processed }, 'fanout complete');
  return { processed };
}

import { emailForUser, type EmailChannel } from '../delivery/email.channel.js';
import { planDelivery } from '../delivery/router.js';
import { newId } from '../shared/ids.js';
import type { EscalationJob } from './queues.js';
import { errorMessage, type WorkerContext } from './context.js';

/**
 * "Email me if it is still unread after N minutes": a delayed job that checks
 * the delivery before sending, so reading the notification cancels it.
 */
export async function processEscalationJob(
  ctx: WorkerContext,
  channel: EmailChannel,
  data: EscalationJob,
): Promise<void> {
  const delivery = await ctx.db
    .selectFrom('deliveries')
    .selectAll()
    .where('id', '=', data.deliveryId)
    .executeTakeFirst();

  if (!delivery) return;
  if (delivery.read_at !== null || delivery.status === 'read' || delivery.status === 'suppressed') {
    return;
  }

  const notification = await ctx.db
    .selectFrom('notifications')
    .selectAll()
    .where('id', '=', delivery.notification_id)
    .executeTakeFirst();
  if (!notification) return;

  const alreadyEmailed = await ctx.db
    .selectFrom('deliveries')
    .select('id')
    .where('notification_id', '=', delivery.notification_id)
    .where('user_id', '=', delivery.user_id)
    .where('channel', '=', 'email')
    .executeTakeFirst();
  if (alreadyEmailed) return;

  const plan = await planDelivery(ctx.db, delivery.app_id, delivery.user_id, notification.category, [
    'email',
  ]);
  if (!plan.email) return;

  const emailDelivery = await ctx.db
    .insertInto('deliveries')
    .values({
      id: newId(),
      notification_id: notification.id,
      app_id: delivery.app_id,
      user_id: delivery.user_id,
      channel: 'email',
      seq: null,
      status: 'queued',
    })
    .onConflict((oc) => oc.doNothing())
    .returning(['id'])
    .executeTakeFirst();
  if (!emailDelivery) return;

  try {
    await channel.send({
      to: emailForUser(delivery.user_id),
      subject: `Still unread: ${notification.title}`,
      text: notification.body ?? notification.title,
    });
    await ctx.db
      .updateTable('deliveries')
      .set({ status: 'sent', sent_at: new Date(), last_error: null })
      .where('id', '=', emailDelivery.id)
      .execute();
    ctx.metrics.deliveries.inc({ channel: 'email', status: 'sent' });
  } catch (err) {
    await ctx.db
      .updateTable('deliveries')
      .set({ status: 'failed', last_error: errorMessage(err).slice(0, 1000) })
      .where('id', '=', emailDelivery.id)
      .execute();
    ctx.metrics.deliveries.inc({ channel: 'email', status: 'failed' });
    throw err;
  }
}

import { emailForUser, type EmailChannel } from '../delivery/email.channel.js';
import type { EmailJob } from './queues.js';
import { errorMessage, type WorkerContext } from './context.js';

const TERMINAL_STATUSES = new Set(['sent', 'delivered', 'read', 'suppressed', 'failed']);

export async function processEmailJob(
  ctx: WorkerContext,
  channel: EmailChannel,
  data: EmailJob,
): Promise<void> {
  const delivery = await ctx.db
    .selectFrom('deliveries')
    .selectAll()
    .where('id', '=', data.deliveryId)
    .executeTakeFirst();

  if (!delivery) {
    ctx.logger.warn({ deliveryId: data.deliveryId }, 'email delivery no longer exists');
    return;
  }
  if (TERMINAL_STATUSES.has(delivery.status)) return;

  const notification = await ctx.db
    .selectFrom('notifications')
    .selectAll()
    .where('id', '=', delivery.notification_id)
    .executeTakeFirst();
  if (!notification) return;

  try {
    await channel.send({
      to: emailForUser(delivery.user_id),
      subject: notification.title,
      text: notification.body ?? notification.title,
    });

    await ctx.db
      .updateTable('deliveries')
      .set({
        status: 'sent',
        sent_at: new Date(),
        attempt_count: delivery.attempt_count + 1,
        last_error: null,
        next_retry_at: null,
      })
      .where('id', '=', delivery.id)
      .execute();

    ctx.metrics.deliveries.inc({ channel: 'email', status: 'sent' });
  } catch (err) {
    const attempt = delivery.attempt_count + 1;
    await ctx.db
      .updateTable('deliveries')
      .set({
        attempt_count: attempt,
        last_error: errorMessage(err).slice(0, 1000),
        next_retry_at: new Date(Date.now() + Math.min(60_000, 1000 * 2 ** attempt)),
      })
      .where('id', '=', delivery.id)
      .execute();

    ctx.metrics.deliveries.inc({ channel: 'email', status: 'failed' });
    ctx.logger.warn({ err, deliveryId: delivery.id, attempt }, 'email delivery failed');
    throw err;
  }
}

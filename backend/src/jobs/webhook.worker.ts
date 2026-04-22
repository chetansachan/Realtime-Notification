import { deliverWebhook, WebhookSecurityError } from '../delivery/webhook.channel.js';
import { listActiveEndpoints, recordEndpointResult } from '../modules/webhooks/webhooks.repository.js';
import type { WebhookJob } from './queues.js';
import { errorMessage, type WorkerContext } from './context.js';

const TERMINAL_STATUSES = new Set(['sent', 'delivered', 'read', 'suppressed', 'failed']);

export async function processWebhookJob(
  ctx: WorkerContext,
  data: WebhookJob,
): Promise<void> {
  const delivery = await ctx.db
    .selectFrom('deliveries')
    .selectAll()
    .where('id', '=', data.deliveryId)
    .executeTakeFirst();
  if (!delivery || TERMINAL_STATUSES.has(delivery.status)) return;

  const notification = await ctx.db
    .selectFrom('notifications')
    .selectAll()
    .where('id', '=', delivery.notification_id)
    .executeTakeFirst();
  if (!notification) return;

  const endpoints = await listActiveEndpoints(ctx.db, delivery.app_id);
  if (endpoints.length === 0) {
    await ctx.db
      .updateTable('deliveries')
      .set({ status: 'failed', last_error: 'no_active_webhook_endpoints' })
      .where('id', '=', delivery.id)
      .execute();
    return;
  }

  const body = JSON.stringify({
    id: notification.id,
    seq: delivery.seq,
    userId: delivery.user_id,
    category: notification.category,
    title: notification.title,
    body: notification.body,
    data: notification.data,
    createdAt: notification.created_at.toISOString(),
  });

  const errors: string[] = [];
  let succeeded = false;
  let securityRejections = 0;

  for (const endpoint of endpoints) {
    try {
      const result = await deliverWebhook(
        {
          url: endpoint.url,
          secret: endpoint.secret,
          notificationId: notification.id,
          body,
        },
        {
          allowHttp: ctx.config.WEBHOOK_ALLOW_HTTP,
          allowPrivateIps: ctx.config.WEBHOOK_ALLOW_PRIVATE_IPS,
          timeoutMs: ctx.config.WEBHOOK_TIMEOUT_MS,
          maxResponseBytes: ctx.config.WEBHOOK_MAX_RESPONSE_BYTES,
        },
      );
      await recordEndpointResult(ctx.db, endpoint.id, { ok: result.ok });
      if (result.ok) succeeded = true;
      else errors.push(`${endpoint.id}: HTTP ${result.statusCode}`);
    } catch (err) {
      if (err instanceof WebhookSecurityError) securityRejections++;
      await recordEndpointResult(ctx.db, endpoint.id, { ok: false });
      errors.push(`${endpoint.id}: ${errorMessage(err)}`);
    }
  }

  if (succeeded) {
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
    ctx.metrics.deliveries.inc({ channel: 'webhook', status: 'sent' });
    return;
  }

  const lastError = errors.join('; ').slice(0, 1000);
  const attempt = delivery.attempt_count + 1;

  // A rejected target is a permanent failure; retrying it would never help.
  if (securityRejections === endpoints.length) {
    await ctx.db
      .updateTable('deliveries')
      .set({ status: 'failed', attempt_count: attempt, last_error: lastError })
      .where('id', '=', delivery.id)
      .execute();
    ctx.metrics.deliveries.inc({ channel: 'webhook', status: 'failed' });
    ctx.logger.warn({ deliveryId: delivery.id, errors }, 'webhook target rejected (ssrf guard)');
    return;
  }

  await ctx.db
    .updateTable('deliveries')
    .set({
      attempt_count: attempt,
      last_error: lastError,
      next_retry_at: new Date(Date.now() + Math.min(60_000, 1000 * 2 ** attempt)),
    })
    .where('id', '=', delivery.id)
    .execute();

  ctx.metrics.deliveries.inc({ channel: 'webhook', status: 'failed' });
  throw new Error(`webhook delivery failed: ${lastError}`);
}

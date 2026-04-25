import type { AppServer } from '../../types/app.js';
import { Type } from '@sinclair/typebox';
import { ErrorResponse, Uuid } from '../../shared/schemas.js';
import { notFound } from '../../shared/errors.js';
import { NotifyBody, NotifyHeaders, NotifyResponse, NotificationStatusResponse } from './notify.schemas.js';
import { NotifyService } from './notify.service.js';
import { findNotification, listDeliveries } from './notify.repository.js';

export default async function notifyRoutes(app: AppServer) {
  const service = new NotifyService(app);

  app.post(
    '/v1/notify',
    {
      onRequest: app.requireApiKey('notify:write'),
      schema: {
        tags: ['notify'],
        summary: 'Create a notification for a user, users or a group',
        headers: NotifyHeaders,
        body: NotifyBody,
        response: {
          200: NotifyResponse,
          201: NotifyResponse,
          202: NotifyResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const header = req.headers['idempotency-key'];
      const idempotencyKey =
        (Array.isArray(header) ? header[0] : header)?.trim() || null;

      const outcome = await service.notify(req.apiClient!.appId, req.body, idempotencyKey);
      return reply.status(outcome.statusCode as 200 | 201 | 202).send(outcome.body);
    },
  );

  // Admin view of a single notification: delivery status per recipient/channel.
  app.get(
    '/v1/notifications/:id',
    {
      onRequest: app.requireApiKey('notify:write'),
      schema: {
        tags: ['notify'],
        params: Type.Object({ id: Uuid }),
        response: {
          200: NotificationStatusResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req) => {
      const appId = req.apiClient!.appId;
      const notification = await findNotification(app.db, appId, req.params.id);
      if (!notification) throw notFound('Notification not found');

      const deliveries = await listDeliveries(app.db, appId, notification.id);
      const totals: Record<string, number> = {};
      for (const delivery of deliveries) {
        totals[delivery.status] = (totals[delivery.status] ?? 0) + 1;
      }

      return {
        id: notification.id,
        category: notification.category,
        title: notification.title,
        createdAt: notification.created_at.toISOString(),
        expiresAt: notification.expires_at ? notification.expires_at.toISOString() : null,
        deliveries: deliveries.map((delivery) => ({
          userId: delivery.user_id,
          channel: delivery.channel,
          status: delivery.status,
          seq: delivery.seq,
          sentAt: delivery.sent_at ? delivery.sent_at.toISOString() : null,
          deliveredAt: delivery.delivered_at ? delivery.delivered_at.toISOString() : null,
          readAt: delivery.read_at ? delivery.read_at.toISOString() : null,
          attemptCount: delivery.attempt_count,
          lastError: delivery.last_error,
        })),
        totals,
      };
    },
  );
}

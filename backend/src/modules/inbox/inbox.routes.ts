import type { AppServer } from '../../types/app.js';
import { ErrorResponse } from '../../shared/schemas.js';
import {
  AckResponse,
  InboxQuery,
  InboxResponse,
  NotificationIdParams,
  ReadAllBody,
  ReadAllResponse,
  ReadResponse,
  UnreadCountResponse,
} from './inbox.schemas.js';
import { InboxService } from './inbox.service.js';

export default async function inboxRoutes(app: AppServer) {
  const service = new InboxService(app);

  app.get(
    '/v1/notifications',
    {
      onRequest: app.authenticateSubscriber,
      schema: {
        tags: ['inbox'],
        summary: 'Keyset-paginated notification history',
        querystring: InboxQuery,
        response: { 200: InboxResponse, 401: ErrorResponse },
      },
    },
    async (req) => {
      const { appId, userId } = req.subscriber!;
      return service.list(appId, userId, req.query);
    },
  );

  app.get(
    '/v1/notifications/unread-count',
    {
      onRequest: app.authenticateSubscriber,
      schema: {
        tags: ['inbox'],
        querystring: InboxQuery,
        response: { 200: UnreadCountResponse, 401: ErrorResponse },
      },
    },
    async (req) => {
      const { appId, userId } = req.subscriber!;
      return service.unreadCount(appId, userId);
    },
  );

  app.post(
    '/v1/notifications/:id/read',
    {
      onRequest: app.authenticateSubscriber,
      schema: {
        tags: ['inbox'],
        params: NotificationIdParams,
        response: { 200: ReadResponse, 401: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (req) => {
      const { appId, userId } = req.subscriber!;
      return service.markRead(appId, userId, req.params.id);
    },
  );

  app.post(
    '/v1/notifications/read-all',
    {
      onRequest: app.authenticateSubscriber,
      schema: {
        tags: ['inbox'],
        body: ReadAllBody,
        response: { 200: ReadAllResponse, 401: ErrorResponse },
      },
    },
    async (req) => {
      const { appId, userId } = req.subscriber!;
      return service.readAll(appId, userId, req.body);
    },
  );

  app.post(
    '/v1/notifications/:id/ack',
    {
      onRequest: app.authenticateSubscriber,
      schema: {
        tags: ['inbox'],
        params: NotificationIdParams,
        response: { 200: AckResponse, 401: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (req) => {
      const { appId, userId } = req.subscriber!;
      return service.ack(appId, userId, req.params.id);
    },
  );
}

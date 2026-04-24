import type { AppServer } from '../../types/app.js';
import { Type, type Static } from '@sinclair/typebox';
import { ErrorResponse, UserId } from '../../shared/schemas.js';
import { issueStreamTicket, issueSubscriberToken } from '../../plugins/subscriber-auth.js';
import { NotifyService } from '../notify/notify.service.js';

const DemoNotifyBody = Type.Object({
  userId: UserId,
  title: Type.String({ minLength: 1, maxLength: 200 }),
  body: Type.Optional(Type.String({ maxLength: 2000 })),
  category: Type.Optional(Type.String({ pattern: '^[a-z0-9_.-]{1,64}$', default: 'demo' })),
});
type DemoNotifyBody = Static<typeof DemoNotifyBody>;

const DemoTokenBody = Type.Object({ userId: UserId });

/**
 * Demo-only surface, gated by DEMO_ENABLED. The API key never reaches the
 * browser: the server holds it and calls the notify service in-process.
 */
export default async function demoRoutes(app: AppServer) {
  const service = new NotifyService(app);

  app.get(
    '/demo/config',
    {
      schema: {
        tags: ['demo'],
        response: {
          200: Type.Object({
            appId: Type.String(),
            instanceId: Type.String(),
            subscriberTokenTtlSeconds: Type.Integer(),
          }),
        },
      },
    },
    async () => ({
      appId: app.config.DEMO_APP_ID,
      instanceId: app.config.INSTANCE_ID,
      subscriberTokenTtlSeconds: app.config.SUBSCRIBER_TOKEN_TTL_SECONDS,
    }),
  );

  app.post(
    '/demo/token',
    {
      schema: {
        tags: ['demo'],
        body: DemoTokenBody,
        response: {
          200: Type.Object({
            token: Type.String(),
            ticket: Type.String(),
            expiresIn: Type.Integer(),
            userId: Type.String(),
            appId: Type.String(),
          }),
        },
      },
    },
    async (req) => {
      const appId = app.config.DEMO_APP_ID;
      const { token, expiresIn } = issueSubscriberToken(app, appId, req.body.userId);
      const ticket = await issueStreamTicket(app, appId, req.body.userId);
      return {
        token,
        ticket: ticket.ticket,
        expiresIn,
        userId: req.body.userId,
        appId,
      };
    },
  );

  app.post(
    '/demo/notify',
    {
      schema: {
        tags: ['demo'],
        body: DemoNotifyBody,
        response: { 201: Type.Unknown(), 400: ErrorResponse },
      },
    },
    async (req, reply) => {
      const outcome = await service.notify(
        app.config.DEMO_APP_ID,
        {
          userIds: [req.body.userId],
          category: req.body.category ?? 'demo',
          title: req.body.title,
          ...(req.body.body === undefined ? {} : { body: req.body.body }),
          channels: ['in_app'],
        },
        null,
      );
      return reply.status(outcome.statusCode as 201).send(outcome.body);
    },
  );
}

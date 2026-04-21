// [initial module draft]
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { sql } from 'kysely';
import { loadConfig, type Config } from './config/env.js';
import dbPlugin from './plugins/db.js';
import redisPlugin from './plugins/redis.js';
import metricsPlugin from './plugins/metrics.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import securityPlugin from './plugins/security.js';
import swaggerPlugin from './plugins/swagger.js';
import apiKeyAuthPlugin from './plugins/api-key-auth.js';
import subscriberAuthPlugin from './plugins/subscriber-auth.js';
import queuesPlugin from './plugins/queues.js';
import realtimePlugin from './plugins/realtime.js';
import notifyRoutes from './modules/notify/notify.routes.js';
import inboxRoutes from './modules/inbox/inbox.routes.js';
import groupsRoutes from './modules/groups/groups.routes.js';
import preferencesRoutes from './modules/preferences/preferences.routes.js';
import tokenRoutes from './modules/tokens/tokens.routes.js';
import webhookRoutes from './modules/webhooks/webhooks.routes.js';
import apiKeyRoutes from './modules/api-keys/api-keys.routes.js';
import sseRoutes from './modules/stream/sse.routes.js';
import wsRoutes from './modules/stream/ws.routes.js';
import demoRoutes from './modules/demo/demo.routes.js';
import { HealthResponse, ReadyResponse } from './shared/schemas.js';

export interface BuildAppOptions {
  config?: Config;
  dbConnectionString?: string;
  redisUrl?: string;
  logger?: FastifyServerOptions['logger'];
  /** Skip swagger/docs and demo static assets (useful in tests). */
  minimal?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const config = options.config ?? loadConfig();

  const defaultLogger: FastifyServerOptions['logger'] = config.NODE_ENV === 'test'
    ? false
    : {
        level: config.LOG_LEVEL,
        base: { instanceId: config.INSTANCE_ID, service: 'notification-service' },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.query.ticket',
            'req.query.token',
            'res.headers["set-cookie"]',
          ],
          censor: '[redacted]',
        },
        ...(config.NODE_ENV === 'production'
          ? {}
          : {
              transport: {
                target: 'pino-pretty',
                options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
              },
            }),
      };

  const app = Fastify({
    logger: options.logger ?? defaultLogger,
    bodyLimit: config.BODY_LIMIT,
    trustProxy: true,
    genReqId: () => randomUUID(),
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.decorate('config', config);

  await app.register(dbPlugin, {
    connectionString: options.dbConnectionString ?? config.DATABASE_URL,
  });
  await app.register(redisPlugin, { url: options.redisUrl ?? config.REDIS_URL });
  await app.register(metricsPlugin, {});
  await app.register(errorHandlerPlugin);
  await app.register(securityPlugin);
  if (!options.minimal) {
    await app.register(swaggerPlugin);
  }
  await app.register(apiKeyAuthPlugin);
  await app.register(subscriberAuthPlugin);
  await app.register(queuesPlugin);
  await app.register(realtimePlugin);
  await app.register(websocket, { options: { maxPayload: config.BODY_LIMIT } });

  app.get(
    '/health',
    {
      logLevel: 'silent',
      schema: { tags: ['ops'], response: { 200: HealthResponse } },
    },
    async () => ({
      status: 'ok',
      instanceId: config.INSTANCE_ID,
      uptimeSeconds: Math.round(process.uptime()),
    }),
  );

  app.get(
    '/ready',
    {
      logLevel: 'silent',
      schema: {
        tags: ['ops'],
        response: { 200: ReadyResponse, 503: ReadyResponse },
      },
    },
    async (_req, reply) => {
      const checks = { postgres: 'ok', redis: 'ok' };
      try {
        await sql`select 1`.execute(app.db);
      } catch {
        checks.postgres = 'error';
      }
      try {
        await app.redis.ping();
      } catch {
        checks.redis = 'error';
      }
      const ready = checks.postgres === 'ok' && checks.redis === 'ok';
      return reply.status(ready ? 200 : 503).send({
        status: ready ? 'ready' : 'not_ready',
        instanceId: config.INSTANCE_ID,
        checks,
      });
    },
  );

  await app.register(notifyRoutes);
  await app.register(inboxRoutes);
  await app.register(groupsRoutes);
  await app.register(preferencesRoutes);
  await app.register(tokenRoutes);
  await app.register(webhookRoutes);
  await app.register(apiKeyRoutes);
  await app.register(sseRoutes);
  await app.register(wsRoutes);

  if (config.DEMO_ENABLED) {
    await app.register(fastifyStatic, {
      root: resolve(process.cwd(), 'public'),
      prefix: '/demo/',
      index: ['demo.html'],
    });
    app.get('/demo', async (_req, reply) => reply.redirect('/demo/', 302));
    await app.register(demoRoutes);
  }

  return app;
}

export type AppInstance = Awaited<ReturnType<typeof buildApp>>;

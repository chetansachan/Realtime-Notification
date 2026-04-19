import type { Kysely, Transaction } from 'kysely';
import type { preHandlerHookHandler } from 'fastify';
import type { Redis } from 'ioredis';
import type { DB } from '../db/types.js';
import type { Config } from '../config/env.js';
import type { ConnectionRegistry } from '../realtime/registry.js';
import type { Metrics } from '../plugins/metrics.js';
import type { ApiClientContext, ApiScope, SubscriberContext } from '../shared/auth.js';
import type { Queues } from '../jobs/queues.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Kysely<DB>;
    redis: Redis;
    redisSub: Redis;
    queues: Queues;
    withTransaction: <T>(fn: (trx: Transaction<DB>) => Promise<T>) => Promise<T>;
    requireApiKey: (scope: ApiScope) => preHandlerHookHandler;
    requireApiKeyOrSubscriber: (scope: ApiScope) => preHandlerHookHandler;
    authenticateSubscriber: preHandlerHookHandler;
    realtime: ConnectionRegistry;
    metrics: Metrics;
  }

  interface FastifyRequest {
    apiClient?: ApiClientContext;
    subscriber?: SubscriberContext;
  }
}

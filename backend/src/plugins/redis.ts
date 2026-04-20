import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { createRedis } from '../redis/client.js';

export interface RedisPluginOptions {
  url?: string;
}

/**
 * Two connections on purpose: a client in subscriber mode cannot issue normal
 * commands, so publishing and subscribing must not share one.
 */
export default fp<RedisPluginOptions>(
  async function redisPlugin(app: FastifyInstance, opts: RedisPluginOptions) {
    const url = opts.url ?? app.config.REDIS_URL;

    const redis = createRedis(url, `${app.config.INSTANCE_ID}:commands`, (err) =>
      app.log.error({ err, client: 'redis' }, 'redis error'),
    );
    const redisSub = createRedis(url, `${app.config.INSTANCE_ID}:subscriber`, (err) =>
      app.log.error({ err, client: 'redisSub' }, 'redis error'),
    );

    for (const [name, client] of [
      ['redis', redis],
      ['redisSub', redisSub],
    ] as const) {
      client.on('reconnecting', () => app.log.warn({ client: name }, 'redis reconnecting'));
      client.on('end', () => app.log.warn({ client: name }, 'redis connection closed'));
    }

    app.decorate('redis', redis);
    app.decorate('redisSub', redisSub);

    app.addHook('onReady', async () => {
      await Promise.all([redis.ping(), redisSub.ping()]);
    });

    app.addHook('onClose', async () => {
      await Promise.allSettled([redis.quit(), redisSub.quit()]);
    });
  },
  { name: 'redis' },
);

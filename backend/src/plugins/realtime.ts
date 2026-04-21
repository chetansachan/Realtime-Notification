import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { ConnectionRegistry } from '../realtime/registry.js';
import { PubSubBridge } from '../realtime/pubsub-bridge.js';
import { Heartbeat } from '../realtime/heartbeat.js';

export default fp(
  async function realtimePlugin(app: FastifyInstance) {
    const registry = new ConnectionRegistry({
      redisSub: app.redisSub,
      logger: app.log,
      metrics: app.metrics,
      maxPerUser: app.config.MAX_CONNECTIONS_PER_USER,
      maxTotal: app.config.MAX_CONNECTIONS_PER_INSTANCE,
    });

    const bridge = new PubSubBridge({
      redisSub: app.redisSub,
      registry,
      logger: app.log,
      metrics: app.metrics,
    });

    const heartbeat = new Heartbeat({
      registry,
      intervalMs: app.config.HEARTBEAT_INTERVAL_MS,
      logger: app.log,
    });

    app.decorate('realtime', registry);

    bridge.start();
    heartbeat.start();

    // MUST run before the HTTP server closes: Fastify's close waits for open
    // sockets, and an SSE stream never finishes on its own.
    app.addHook('preClose', async () => {
      await registry.shutdown('shutdown');
    });

    app.addHook('onClose', async () => {
      heartbeat.stop();
      bridge.stop();
      // Idempotent: preClose already emptied the registry in the normal path.
      await registry.shutdown('shutdown');
    });
  },
  { name: 'realtime', dependencies: ['redis', 'metrics'] },
);

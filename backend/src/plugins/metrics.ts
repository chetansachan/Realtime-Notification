import fp from 'fastify-plugin';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';
import type { FastifyInstance } from 'fastify';

export class Metrics {
  readonly registry = new Registry();

  readonly connectionsOpen = new Gauge({
    name: 'ntf_connections_open',
    help: 'Currently open realtime connections',
    labelNames: ['transport'] as const,
    registers: [this.registry],
  });

  readonly connectionsTotal = new Counter({
    name: 'ntf_connections_total',
    help: 'Realtime connections accepted since start',
    labelNames: ['transport'] as const,
    registers: [this.registry],
  });

  readonly notificationsCreated = new Counter({
    name: 'ntf_notifications_created_total',
    help: 'Notifications persisted',
    registers: [this.registry],
  });

  readonly deliveries = new Counter({
    name: 'ntf_deliveries_total',
    help: 'Delivery state transitions',
    labelNames: ['channel', 'status'] as const,
    registers: [this.registry],
  });

  /** Publish-to-write latency: how long a Redis hint took to reach a client. */
  readonly publishLatency = new Histogram({
    name: 'ntf_publish_to_write_seconds',
    help: 'Seconds between Redis publish and local dispatch',
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
    registers: [this.registry],
  });

  readonly replaySize = new Histogram({
    name: 'ntf_replay_events',
    help: 'Events replayed per reconnecting client',
    buckets: [0, 1, 5, 10, 25, 50, 100, 250, 500],
    registers: [this.registry],
  });

  readonly slowConsumerDropped = new Counter({
    name: 'ntf_slow_consumer_dropped_total',
    help: 'Connections closed because their outbound queue overflowed',
    labelNames: ['transport'] as const,
    registers: [this.registry],
  });

  readonly queueDepth = new Gauge({
    name: 'ntf_queue_depth',
    help: 'Jobs waiting per BullMQ queue',
    labelNames: ['queue'] as const,
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }
}

export interface MetricsPluginOptions {
  enabled?: boolean;
}

export default fp<MetricsPluginOptions>(
  async function metricsPlugin(app: FastifyInstance, opts: MetricsPluginOptions) {
    const enabled = opts.enabled ?? app.config.METRICS_ENABLED;
    const metrics = new Metrics();
    app.decorate('metrics', metrics);

    if (enabled) {
      app.get('/metrics', { logLevel: 'silent' }, async (_req, reply) => {
        reply.header('content-type', metrics.registry.contentType);
        return metrics.registry.metrics();
      });
    }
  },
  { name: 'metrics' },
);

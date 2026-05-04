import { createServer } from 'node:http';
import { Worker, type Job } from 'bullmq';
import pino from 'pino';
import { loadConfig } from './config/env.js';
import { createDb } from './db/client.js';
import { createRedis } from './redis/client.js';
import { Metrics } from './plugins/metrics.js';
import { EmailChannel } from './delivery/email.channel.js';
import {
  QUEUE,
  connectionFromUrl,
  createQueues,
  type EmailJob,
  type EscalationJob,
  type FanoutJob,
  type MaintenanceJob,
  type WebhookJob,
} from './jobs/queues.js';
import type { WorkerContext } from './jobs/context.js';
import { processFanoutJob } from './jobs/fanout.worker.js';
import { processEmailJob } from './jobs/email.worker.js';
import { processWebhookJob } from './jobs/webhook.worker.js';
import { processEscalationJob } from './jobs/escalation.worker.js';
import { reconcileUnreadCounts } from './jobs/reconcile.job.js';
import { pruneExpired } from './jobs/retention.job.js';

const config = loadConfig();

const logger = pino({
  level: config.LOG_LEVEL,
  base: { instanceId: config.INSTANCE_ID, service: 'notification-worker' },
  ...(config.NODE_ENV === 'production'
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
});

const { db } = createDb({
  connectionString: config.DATABASE_URL,
  maxConnections: 10,
  applicationName: `${config.INSTANCE_ID}:worker`,
  onError: (err) => logger.error({ err }, 'postgres pool error'),
  onQueryError: (err, querySql) => logger.error({ err, sql: querySql }, 'query failed'),
});
const redis = createRedis(config.REDIS_URL, `${config.INSTANCE_ID}:worker`, (err) =>
  logger.error({ err }, 'redis error'),
);
const queues = createQueues(config.REDIS_URL);
const metrics = new Metrics();
const emailChannel = new EmailChannel({
  smtpUrl: config.SMTP_URL,
  from: config.EMAIL_FROM,
  logger,
});

const ctx: WorkerContext = { db, redis, config, logger, queues, metrics };
const connection = connectionFromUrl(config.REDIS_URL);

async function markDeliveryFailed(job: Job | undefined, attempts: number): Promise<void> {
  if (!job || job.attemptsMade < attempts) return;
  const deliveryId = (job.data as { deliveryId?: string }).deliveryId;
  if (!deliveryId) return;
  await db
    .updateTable('deliveries')
    .set({ status: 'failed' })
    .where('id', '=', deliveryId)
    .where('status', 'in', ['queued', 'sent'])
    .execute();
}

function events(worker: Worker, attemptsFor: (job: Job) => number): void {
  worker.on('failed', (job, err) => {
    logger.warn({ err, jobId: job?.id }, 'job failed');
    if (job) void markDeliveryFailed(job, attemptsFor(job));
  });
  worker.on('error', (err) => logger.error({ err }, 'worker error'));
}

const workers: Worker[] = [];

const fanoutWorker = new Worker<FanoutJob>(
  QUEUE.fanout,
  (job) => processFanoutJob(ctx, job.data),
  { connection, concurrency: 2 },
);
workers.push(fanoutWorker);

const emailWorker = new Worker<EmailJob>(
  QUEUE.email,
  (job) => processEmailJob(ctx, emailChannel, job.data),
  { connection, concurrency: config.WORKER_CONCURRENCY },
);
workers.push(emailWorker);

const webhookWorker = new Worker<WebhookJob>(
  QUEUE.webhook,
  (job) => processWebhookJob(ctx, job.data),
  { connection, concurrency: config.WORKER_CONCURRENCY },
);
workers.push(webhookWorker);

const escalationWorker = new Worker<EscalationJob>(
  QUEUE.escalation,
  (job) => processEscalationJob(ctx, emailChannel, job.data),
  { connection, concurrency: config.WORKER_CONCURRENCY },
);
workers.push(escalationWorker);

const maintenanceWorker = new Worker<MaintenanceJob>(
  QUEUE.maintenance,
  async (job) => {
    if (job.data.task === 'reconcile') return reconcileUnreadCounts(ctx);
    if (job.data.task === 'retention') return pruneExpired(ctx);
    return undefined;
  },
  { connection, concurrency: 1 },
);
workers.push(maintenanceWorker);

for (const worker of workers) events(worker, (job) => job.opts.attempts ?? 1);

// Scheduled maintenance. Re-adding with the same jobId is idempotent.
await queues.maintenance.add(
  'reconcile',
  { task: 'reconcile' },
  { jobId: 'reconcile', repeat: { pattern: '0 */6 * * *' } },
);
await queues.maintenance.add(
  'retention',
  { task: 'retention' },
  { jobId: 'retention', repeat: { pattern: '30 3 * * *' } },
);

const depthSampler = setInterval(() => {
  void (async () => {
    try {
      for (const [name, queue] of Object.entries({
        fanout: queues.fanout,
        email: queues.email,
        webhook: queues.webhook,
        escalation: queues.escalation,
        maintenance: queues.maintenance,
      })) {
        const counts = await queue.getJobCounts('wait', 'active', 'delayed');
        metrics.queueDepth.set(
          { queue: name },
          (counts.wait ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0),
        );
      }
    } catch (err) {
      logger.warn({ err }, 'failed to sample queue depth');
    }
  })();
}, 15_000);
depthSampler.unref();

const metricsServer = createServer((req, res) => {
  void (async () => {
    if (req.url === '/metrics') {
      res.writeHead(200, { 'content-type': metrics.registry.contentType });
      res.end(await metrics.registry.metrics());
      return;
    }
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', instanceId: config.INSTANCE_ID }));
      return;
    }
    res.writeHead(404).end();
  })();
});
metricsServer.listen(config.WORKER_METRICS_PORT, config.HOST, () => {
  logger.info({ port: config.WORKER_METRICS_PORT }, 'worker metrics server listening');
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'worker shutting down');

  clearInterval(depthSampler);
  metricsServer.close();
  await Promise.allSettled(workers.map((worker) => worker.close()));
  emailChannel.close();
  await queues.close();
  await Promise.allSettled([redis.quit(), db.destroy()]);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

logger.info({ queues: Object.values(QUEUE) }, 'notification worker started');

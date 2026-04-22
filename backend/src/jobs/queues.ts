// [initial module draft]
import { Queue, type JobsOptions } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import type { DeliveryChannel } from '../db/types.js';

export const QUEUE = {
  fanout: 'ntf-fanout',
  email: 'ntf-email',
  webhook: 'ntf-webhook',
  escalation: 'ntf-escalation',
  maintenance: 'ntf-maintenance',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

export interface FanoutJob {
  notificationId: string;
  appId: string;
  groupId?: string;
  userIds?: string[];
  channels?: DeliveryChannel[];
}

export interface EmailJob {
  deliveryId: string;
}

export interface WebhookJob {
  deliveryId: string;
}

export interface EscalationJob {
  deliveryId: string;
}

export interface MaintenanceJob {
  task: 'reconcile' | 'retention';
}

export interface Queues {
  fanout: Queue<FanoutJob>;
  email: Queue<EmailJob>;
  webhook: Queue<WebhookJob>;
  escalation: Queue<EscalationJob>;
  maintenance: Queue<MaintenanceJob>;
  close(): Promise<void>;
}

export function connectionFromUrl(raw: string): RedisOptions {
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.pathname.length > 1 ? { db: Number(url.pathname.slice(1)) } : {}),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}

const channelJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

export function createQueues(redisUrl: string): Queues {
  const connection = connectionFromUrl(redisUrl);

  const fanout = new Queue<FanoutJob>(QUEUE.fanout, { connection });
  const email = new Queue<EmailJob>(QUEUE.email, { connection, defaultJobOptions: channelJobOptions });
  const webhook = new Queue<WebhookJob>(QUEUE.webhook, {
    connection,
    defaultJobOptions: channelJobOptions,
  });
  const escalation = new Queue<EscalationJob>(QUEUE.escalation, {
    connection,
    defaultJobOptions: { attempts: 3, removeOnComplete: { count: 1000 } },
  });
  const maintenance = new Queue<MaintenanceJob>(QUEUE.maintenance, { connection });

  return {
    fanout,
    email,
    webhook,
    escalation,
    maintenance,
    async close() {
      await Promise.allSettled([
        fanout.close(),
        email.close(),
        webhook.close(),
        escalation.close(),
        maintenance.close(),
      ]);
    },
  };
}

export async function enqueueDeliveryJobs(
  queues: Queues,
  app: { log: { warn: (obj: object, msg: string) => void } },
  deliveries: { id: string; channel: DeliveryChannel }[],
  options: { escalationDelayMs: number; escalationEnabled: boolean },
): Promise<void> {
  await Promise.all(
    deliveries.map(async (delivery) => {
      try {
        if (delivery.channel === 'email') {
          await queues.email.add('send', { deliveryId: delivery.id });
        } else if (delivery.channel === 'webhook') {
          await queues.webhook.add('send', { deliveryId: delivery.id });
        } else if (delivery.channel === 'in_app' && options.escalationEnabled) {
          await queues.escalation.add(
            'check',
            { deliveryId: delivery.id },
            { delay: options.escalationDelayMs },
          );
        }
      } catch (err) {
        app.log.warn({ err, deliveryId: delivery.id }, 'failed to enqueue delivery job');
      }
    }),
  );
}

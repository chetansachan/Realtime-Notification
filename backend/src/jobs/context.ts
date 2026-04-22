import type { Kysely } from 'kysely';
import type { Redis } from 'ioredis';
import type { AppLogger } from '../shared/logger.js';
import type { DB } from '../db/types.js';
import type { Config } from '../config/env.js';
import type { Queues } from './queues.js';
import type { Metrics } from '../plugins/metrics.js';

export interface WorkerContext {
  db: Kysely<DB>;
  redis: Redis;
  config: Config;
  logger: AppLogger;
  queues: Queues;
  metrics: Metrics;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

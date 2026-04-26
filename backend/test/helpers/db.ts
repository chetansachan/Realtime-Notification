import { Redis } from 'ioredis';
import { Pool } from 'pg';
import { infra } from './infra.js';
import { invalidateApiKeyCache } from '../../src/plugins/api-key-auth.js';

let pool: Pool | null = null;

export function testPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: infra().dbUrl, max: 6 });
  }
  return pool;
}

/**
 * Full reset between tests. Truncating everything (including the BullMQ keys in
 * Redis) keeps each test independent of ordering.
 */
export async function resetDatabase(): Promise<void> {
  await testPool().query(
    `TRUNCATE api_clients, groups, group_members, notifications, user_streams,
              deliveries, preferences, categories, webhook_endpoints
     RESTART IDENTITY CASCADE`,
  );
  invalidateApiKeyCache();

  const redis = new Redis(infra().redisUrl, { maxRetriesPerRequest: null });
  try {
    await redis.flushdb();
  } finally {
    await redis.quit();
  }
}

export async function closeTestPool(): Promise<void> {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}

import { writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait } from 'testcontainers';
import { runner } from 'node-pg-migrate';

/**
 * Real Postgres and Redis, because the things under test (row-lock sequencing,
 * cross-instance pub/sub, replay) cannot be proven against mocks.
 */
export default async function setup(): Promise<() => Promise<void>> {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine').withStartupTimeout(180_000).start(),
    new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .withStartupTimeout(180_000)
      .start(),
  ]);

  const dbUrl = postgres.getConnectionUri();
  const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;

  await runner({
    databaseUrl: dbUrl,
    dir: resolve(process.cwd(), 'src/db/migrations'),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    verbose: false,
    log: () => undefined,
  });

  writeFileSync(resolve(process.cwd(), 'test/.infra.json'), JSON.stringify({ dbUrl, redisUrl }));

  return async () => {
    rmSync(resolve(process.cwd(), 'test/.infra.json'), { force: true });
    await Promise.allSettled([postgres.stop(), redis.stop()]);
  };
}

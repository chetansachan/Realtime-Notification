import { loadConfig, type Config, type EnvOverrides } from '../../src/config/env.js';
import { buildApp, type AppInstance } from '../../src/app.js';
import { infra } from './infra.js';

export interface TestApp {
  app: AppInstance;
  url: string;
  config: Config;
  close(): Promise<void>;
}

let counter = 0;

export async function createTestApp(overrides: EnvOverrides = {}): Promise<TestApp> {
  counter += 1;
  const { dbUrl, redisUrl } = infra();

  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: dbUrl,
    REDIS_URL: redisUrl,
    JWT_SECRET: 'test-secret-value-that-is-long-enough-123456',
    LOG_LEVEL: 'silent',
    INSTANCE_ID: `test-${counter}-${Math.random().toString(16).slice(2, 8)}`,
    HEARTBEAT_INTERVAL_MS: 60_000,
    ...overrides,
  });

  const app = await buildApp({
    config,
    minimal: true,
    logger: process.env.TEST_LOG === '1' ? { level: 'debug' } : false,
  });
  await app.listen({ port: 0, host: '127.0.0.1' });

  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('expected a TCP address');

  return {
    app,
    url: `http://127.0.0.1:${address.port}`,
    config,
    close: () => app.close(),
  };
}

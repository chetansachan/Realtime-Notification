// [initial module draft]
import { hostname } from 'node:os';
import { envSchema } from 'env-schema';
import { Type, type Static } from '@sinclair/typebox';

const EnvSchema = Type.Object({
  NODE_ENV: Type.String({ default: 'development' }),
  HOST: Type.String({ default: '0.0.0.0' }),
  PORT: Type.Integer({ default: 3000, minimum: 0, maximum: 65535 }),
  INSTANCE_ID: Type.Optional(Type.String({ maxLength: 128 })),
  DATABASE_URL: Type.String({ minLength: 1 }),
  REDIS_URL: Type.String({ minLength: 1 }),
  JWT_SECRET: Type.String({ minLength: 32 }),
  LOG_LEVEL: Type.String({ default: 'info' }),
  BODY_LIMIT: Type.Integer({ default: 16384, minimum: 1024 }),

  INLINE_RECIPIENT_LIMIT: Type.Integer({ default: 100, minimum: 1 }),
  FANOUT_CHUNK_SIZE: Type.Integer({ default: 500, minimum: 1 }),

  MAX_CONNECTIONS_PER_USER: Type.Integer({ default: 5, minimum: 1 }),
  MAX_CONNECTIONS_PER_INSTANCE: Type.Integer({ default: 10000, minimum: 1 }),
  CONNECTION_QUEUE_MAX: Type.Integer({ default: 100, minimum: 1 }),
  CONNECTION_QUEUE_BYTES: Type.Integer({ default: 1_000_000, minimum: 1024 }),
  REPLAY_LIMIT: Type.Integer({ default: 500, minimum: 1 }),
  HEARTBEAT_INTERVAL_MS: Type.Integer({ default: 20_000, minimum: 1000 }),
  STREAM_TICKET_TTL_SECONDS: Type.Integer({ default: 30, minimum: 1 }),
  SUBSCRIBER_TOKEN_TTL_SECONDS: Type.Integer({ default: 900, minimum: 60 }),

  RATE_LIMIT_MAX: Type.Integer({ default: 600, minimum: 1 }),
  RATE_LIMIT_WINDOW: Type.String({ default: '1 minute' }),
  STREAM_RATE_LIMIT_MAX: Type.Integer({ default: 30, minimum: 1 }),
  STREAM_RATE_LIMIT_WINDOW: Type.String({ default: '1 minute' }),

  SMTP_URL: Type.String({ default: '' }),
  EMAIL_FROM: Type.String({ default: 'notifications@example.test' }),
  WORKER_CONCURRENCY: Type.Integer({ default: 10, minimum: 1 }),
  WEBHOOK_TIMEOUT_MS: Type.Integer({ default: 5000, minimum: 100 }),
  WEBHOOK_MAX_RESPONSE_BYTES: Type.Integer({ default: 8192, minimum: 64 }),
  WEBHOOK_ALLOW_HTTP: Type.Boolean({ default: false }),
  WEBHOOK_ALLOW_PRIVATE_IPS: Type.Boolean({ default: false }),
  ESCALATION_DELAY_MS: Type.Integer({ default: 600_000, minimum: 0 }),
  RETENTION_DAYS: Type.Integer({ default: 30, minimum: 1 }),

  DEMO_ENABLED: Type.Boolean({ default: false }),
  DEMO_APP_ID: Type.String({ default: 'demo' }),
  CORS_ORIGIN: Type.String({ default: '*' }),

  METRICS_ENABLED: Type.Boolean({ default: true }),
  WORKER_METRICS_PORT: Type.Integer({ default: 9464, minimum: 0 }),
});

type RawEnv = Static<typeof EnvSchema>;

export type EnvOverrides = Partial<
  Record<keyof RawEnv, string | number | boolean | undefined>
>;

export type Config = Omit<RawEnv, 'INSTANCE_ID' | 'SMTP_URL'> & {
  readonly INSTANCE_ID: string;
  readonly SMTP_URL?: string;
  /** `true` means "reflect any origin"; otherwise an explicit allow-list. */
  readonly corsOrigins: true | string[];
  readonly isProduction: boolean;
};

/**
 * Everything is validated (and coerced) at startup; a bad env kills the process
 * instead of surfacing as a confusing runtime error later.
 */
export function loadConfig(overrides: EnvOverrides = {}): Config {
  const raw = envSchema<RawEnv>({
    schema: EnvSchema,
    dotenv: true,
    data: overrides,
  });

  const origin = raw.CORS_ORIGIN.trim();
  return {
    ...raw,
    INSTANCE_ID: raw.INSTANCE_ID?.trim() || `${hostname()}-${process.pid}`,
    SMTP_URL: raw.SMTP_URL?.trim() ? raw.SMTP_URL.trim() : undefined,
    corsOrigins:
      origin === '*' || origin === ''
        ? true
        : origin
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
    isProduction: raw.NODE_ENV === 'production',
  };
}

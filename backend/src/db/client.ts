// [initial module draft]
import { Kysely, PostgresDialect } from 'kysely';
import { Pool, types as pgTypes } from 'pg';
import type { DB } from './types.js';

// bigint columns (the per-user sequence) come back as strings by default. Every
// seq here is far below Number.MAX_SAFE_INTEGER, so number is the better type.
pgTypes.setTypeParser(20, (value: string) => Number.parseInt(value, 10));

export interface DbHandle {
  db: Kysely<DB>;
  pool: Pool;
}

export interface CreateDbOptions {
  connectionString: string;
  maxConnections?: number;
  applicationName?: string;
  onError?: (err: Error) => void;
  onQueryError?: (err: unknown, sql: string) => void;
}

export function createDb(opts: CreateDbOptions): DbHandle {
  const pool = new Pool({
    connectionString: opts.connectionString,
    max: opts.maxConnections ?? 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: opts.applicationName,
  });

  pool.on('error', (err) => opts.onError?.(err));

  const db = new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
    log: (event) => {
      if (event.level === 'error') opts.onQueryError?.(event.error, event.query.sql);
    },
  });

  return { db, pool };
}

import fp from 'fastify-plugin';
import { sql, type Transaction } from 'kysely';
import type { FastifyInstance } from 'fastify';
import type { DB } from '../db/types.js';
import { createDb } from '../db/client.js';

export interface DbPluginOptions {
  /** Override for tests; defaults to config.DATABASE_URL. */
  connectionString?: string;
  maxConnections?: number;
}

export default fp<DbPluginOptions>(
  async function dbPlugin(app: FastifyInstance, opts: DbPluginOptions) {
    const { db, pool } = createDb({
      connectionString: opts.connectionString ?? app.config.DATABASE_URL,
      maxConnections: opts.maxConnections ?? (app.config.NODE_ENV === 'test' ? 5 : 20),
      applicationName: `${app.config.INSTANCE_ID}:api`,
      onError: (err) => app.log.error({ err }, 'postgres pool error'),
      onQueryError: (err, querySql) => app.log.error({ err, sql: querySql }, 'query failed'),
    });

    app.decorate('db', db);
    app.decorate('withTransaction', async <T>(fn: (trx: Transaction<DB>) => Promise<T>) =>
      db.transaction().execute(fn),
    );

    app.addHook('onReady', async () => {
      await sql`select 1`.execute(db);
    });

    app.addHook('onClose', async () => {
      await db.destroy();
      void pool;
    });
  },
  { name: 'db' },
);

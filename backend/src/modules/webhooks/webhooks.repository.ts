import { sql } from 'kysely';
import type { DbExecutor } from '../../db/types.js';
import { newId } from '../../shared/ids.js';

export const MAX_WEBHOOK_FAILURES = 10;

export async function createEndpoint(
  db: DbExecutor,
  input: { appId: string; url: string; secret: string },
) {
  return db
    .insertInto('webhook_endpoints')
    .values({ id: newId(), app_id: input.appId, url: input.url, secret: input.secret })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function listEndpoints(db: DbExecutor, appId: string) {
  return db
    .selectFrom('webhook_endpoints')
    .selectAll()
    .where('app_id', '=', appId)
    .orderBy('created_at', 'desc')
    .execute();
}

export async function findEndpoint(db: DbExecutor, appId: string, id: string) {
  return db
    .selectFrom('webhook_endpoints')
    .selectAll()
    .where('app_id', '=', appId)
    .where('id', '=', id)
    .executeTakeFirst();
}

export async function listActiveEndpoints(db: DbExecutor, appId: string) {
  return db
    .selectFrom('webhook_endpoints')
    .selectAll()
    .where('app_id', '=', appId)
    .where('active', '=', true)
    .where('disabled_at', 'is', null)
    .execute();
}

export async function updateEndpoint(
  db: DbExecutor,
  appId: string,
  id: string,
  patch: { url?: string; active?: boolean },
) {
  return db
    .updateTable('webhook_endpoints')
    .set({
      ...(patch.url === undefined ? {} : { url: patch.url }),
      ...(patch.active === undefined
        ? {}
        : { active: patch.active, disabled_at: patch.active ? null : new Date() }),
      ...(patch.active === true ? { failure_count: 0 } : {}),
    })
    .where('app_id', '=', appId)
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst();
}

export async function deleteEndpoint(db: DbExecutor, appId: string, id: string) {
  const deleted = await db
    .deleteFrom('webhook_endpoints')
    .where('app_id', '=', appId)
    .where('id', '=', id)
    .returning('id')
    .executeTakeFirst();
  return deleted !== undefined;
}

/** Per-endpoint circuit breaker: repeated failures disable the endpoint. */
export async function recordEndpointResult(
  db: DbExecutor,
  id: string,
  result: { ok: boolean },
): Promise<void> {
  if (result.ok) {
    await db
      .updateTable('webhook_endpoints')
      .set({ failure_count: 0, disabled_at: null, active: true })
      .where('id', '=', id)
      .execute();
    return;
  }

  await db
    .updateTable('webhook_endpoints')
    .set({
      failure_count: sql<number>`failure_count + 1`,
      active: sql<boolean>`(failure_count + 1) < ${MAX_WEBHOOK_FAILURES}`,
      disabled_at: sql<Date | null>`case when (failure_count + 1) >= ${MAX_WEBHOOK_FAILURES} then now() else disabled_at end`,
    })
    .where('id', '=', id)
    .execute();
}

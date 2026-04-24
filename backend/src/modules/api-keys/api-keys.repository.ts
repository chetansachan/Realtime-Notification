import { newId } from '../../shared/ids.js';
import type { DbExecutor } from '../../db/types.js';

export interface ApiClientRow {
  id: string;
  app_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  scopes: string[];
  active: boolean;
  last_used_at: Date | null;
}

export async function findApiClientByPrefix(
  db: DbExecutor,
  prefix: string,
): Promise<ApiClientRow | undefined> {
  return db
    .selectFrom('api_clients')
    .select(['id', 'app_id', 'name', 'key_prefix', 'key_hash', 'scopes', 'active', 'last_used_at'])
    .where('key_prefix', '=', prefix)
    .executeTakeFirst();
}

export async function insertApiClient(
  db: DbExecutor,
  input: {
    appId: string;
    name: string;
    prefix: string;
    hash: string;
    scopes: string[];
  },
) {
  return db
    .insertInto('api_clients')
    .values({
      id: newId(),
      app_id: input.appId,
      name: input.name,
      key_prefix: input.prefix,
      key_hash: input.hash,
      scopes: input.scopes,
      active: true,
    })
    .returning(['id', 'app_id', 'name', 'key_prefix', 'scopes', 'active', 'created_at'])
    .executeTakeFirstOrThrow();
}

export async function touchApiClient(db: DbExecutor, id: string): Promise<void> {
  await db.updateTable('api_clients').set({ last_used_at: new Date() }).where('id', '=', id).execute();
}

export async function listApiClients(db: DbExecutor, appId: string) {
  return db
    .selectFrom('api_clients')
    .select(['id', 'app_id', 'name', 'key_prefix', 'scopes', 'active', 'created_at', 'last_used_at'])
    .where('app_id', '=', appId)
    .orderBy('created_at', 'desc')
    .execute();
}

export async function revokeApiClient(db: DbExecutor, appId: string, id: string) {
  return db
    .updateTable('api_clients')
    .set({ active: false })
    .where('app_id', '=', appId)
    .where('id', '=', id)
    .returning(['id', 'key_prefix'])
    .executeTakeFirst();
}

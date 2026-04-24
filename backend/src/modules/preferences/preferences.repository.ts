import type { DbExecutor } from '../../db/types.js';

export interface PreferenceRow {
  category: string;
  muted: boolean;
  channels: Record<string, boolean>;
}

export async function getPreference(
  db: DbExecutor,
  appId: string,
  userId: string,
  category: string,
): Promise<PreferenceRow | undefined> {
  return db
    .selectFrom('preferences')
    .select(['category', 'muted', 'channels'])
    .where('app_id', '=', appId)
    .where('user_id', '=', userId)
    .where('category', '=', category)
    .executeTakeFirst();
}

export async function listPreferences(
  db: DbExecutor,
  appId: string,
  userId: string,
): Promise<PreferenceRow[]> {
  return db
    .selectFrom('preferences')
    .select(['category', 'muted', 'channels'])
    .where('app_id', '=', appId)
    .where('user_id', '=', userId)
    .orderBy('category', 'asc')
    .execute();
}

export async function upsertPreference(
  db: DbExecutor,
  input: {
    appId: string;
    userId: string;
    category: string;
    muted: boolean;
    channels: Record<string, boolean>;
  },
): Promise<void> {
  await db
    .insertInto('preferences')
    .values({
      app_id: input.appId,
      user_id: input.userId,
      category: input.category,
      muted: input.muted,
      channels: JSON.stringify(input.channels),
      updated_at: new Date(),
    })
    .onConflict((oc) =>
      oc.columns(['app_id', 'user_id', 'category']).doUpdateSet({
        muted: input.muted,
        channels: JSON.stringify(input.channels),
        updated_at: new Date(),
      }),
    )
    .execute();
}

export async function getCategory(db: DbExecutor, appId: string, key: string) {
  return db
    .selectFrom('categories')
    .select(['key', 'mandatory', 'default_channels'])
    .where('app_id', '=', appId)
    .where('key', '=', key)
    .executeTakeFirst();
}

export async function listCategories(db: DbExecutor, appId: string) {
  return db
    .selectFrom('categories')
    .select(['key', 'mandatory', 'default_channels'])
    .where('app_id', '=', appId)
    .orderBy('key', 'asc')
    .execute();
}

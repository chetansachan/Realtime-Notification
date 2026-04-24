import type { DbExecutor } from '../../db/types.js';
import { newId } from '../../shared/ids.js';

export async function createGroup(db: DbExecutor, appId: string, name: string) {
  return db
    .insertInto('groups')
    .values({ id: newId(), app_id: appId, name })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function findGroup(db: DbExecutor, appId: string, id: string) {
  return db
    .selectFrom('groups')
    .selectAll()
    .where('app_id', '=', appId)
    .where('id', '=', id)
    .executeTakeFirst();
}

export async function listGroups(db: DbExecutor, appId: string) {
  const groups = await db
    .selectFrom('groups')
    .selectAll()
    .where('app_id', '=', appId)
    .orderBy('created_at', 'desc')
    .execute();

  if (groups.length === 0) return [];

  const counts = await db
    .selectFrom('group_members')
    .select('group_id')
    .select((eb) => eb.fn.countAll<string>().as('member_count'))
    .where(
      'group_id',
      'in',
      groups.map((group) => group.id),
    )
    .groupBy('group_id')
    .execute();

  const byGroup = new Map(counts.map((row) => [row.group_id, Number(row.member_count)]));
  return groups.map((group) => ({ ...group, member_count: byGroup.get(group.id) ?? 0 }));
}

export async function countGroupMembers(db: DbExecutor, groupId: string): Promise<number> {
  const row = await db
    .selectFrom('group_members')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('group_id', '=', groupId)
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

export async function listGroupMembersPage(
  db: DbExecutor,
  groupId: string,
  afterUserId: string | null,
  limit: number,
): Promise<string[]> {
  let query = db
    .selectFrom('group_members')
    .select('user_id')
    .where('group_id', '=', groupId)
    .orderBy('user_id', 'asc')
    .limit(limit);

  if (afterUserId !== null) {
    query = query.where('user_id', '>', afterUserId);
  }

  const rows = await query.execute();
  return rows.map((row) => row.user_id);
}

export async function addGroupMembers(
  db: DbExecutor,
  groupId: string,
  userIds: string[],
): Promise<number> {
  if (userIds.length === 0) return 0;
  const inserted = await db
    .insertInto('group_members')
    .values(userIds.map((userId) => ({ group_id: groupId, user_id: userId })))
    .onConflict((oc) => oc.doNothing())
    .returning('user_id')
    .execute();
  return inserted.length;
}

export async function removeGroupMembers(
  db: DbExecutor,
  groupId: string,
  userIds: string[],
): Promise<number> {
  if (userIds.length === 0) return 0;
  const removed = await db
    .deleteFrom('group_members')
    .where('group_id', '=', groupId)
    .where('user_id', 'in', userIds)
    .returning('user_id')
    .execute();
  return removed.length;
}

export async function deleteGroup(db: DbExecutor, appId: string, id: string): Promise<boolean> {
  const deleted = await db
    .deleteFrom('groups')
    .where('app_id', '=', appId)
    .where('id', '=', id)
    .returning('id')
    .executeTakeFirst();
  return deleted !== undefined;
}

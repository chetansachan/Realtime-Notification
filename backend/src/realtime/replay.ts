import type { Kysely } from 'kysely';
import type { DB, DbExecutor } from '../db/types.js';
import type { Connection } from './connection.js';
import type { NotificationPayload } from './events.js';
import type { Metrics } from '../plugins/metrics.js';

export interface StreamState {
  lastSeq: number;
  unreadCount: number;
}

export async function getStreamState(
  db: DbExecutor,
  appId: string,
  userId: string,
): Promise<StreamState> {
  const row = await db
    .selectFrom('user_streams')
    .select(['last_seq', 'unread_count'])
    .where('app_id', '=', appId)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  return { lastSeq: row?.last_seq ?? 0, unreadCount: row?.unread_count ?? 0 };
}

interface ReplayRow {
  id: string;
  seq: number | null;
  category: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  priority: 'low' | 'normal' | 'high';
  created_at: Date;
  read_at: Date | null;
}

export interface ReplayResult {
  events: NotificationPayload[];
  hasMore: boolean;
}

export async function fetchReplayEvents(
  db: Kysely<DB>,
  appId: string,
  userId: string,
  afterSeq: number,
  limit: number,
): Promise<ReplayResult> {
  const now = new Date();
  const rows = (await db
    .selectFrom('deliveries as d')
    .innerJoin('notifications as n', 'n.id', 'd.notification_id')
    .select([
      'n.id as id',
      'd.seq as seq',
      'n.category as category',
      'n.title as title',
      'n.body as body',
      'n.data as data',
      'n.priority as priority',
      'n.created_at as created_at',
      'd.read_at as read_at',
    ])
    .where('d.app_id', '=', appId)
    .where('d.user_id', '=', userId)
    .where('d.channel', '=', 'in_app')
    .where('d.seq', '>', afterSeq)
    .where((eb) => eb.or([eb('n.expires_at', 'is', null), eb('n.expires_at', '>', now)]))
    .orderBy('d.seq', 'asc')
    .limit(limit + 1)
    .execute()) as ReplayRow[];

  const hasMore = rows.length > limit;
  const events = rows
    .slice(0, limit)
    .filter((row): row is ReplayRow & { seq: number } => row.seq !== null)
    .map((row) => ({
      id: row.id,
      seq: row.seq,
      category: row.category,
      title: row.title,
      body: row.body,
      data: row.data,
      priority: row.priority,
      createdAt: row.created_at.toISOString(),
      readAt: row.read_at ? row.read_at.toISOString() : null,
    }));

  return { events, hasMore };
}

/**
 * Replays everything newer than the client's cursor. If the backlog is larger
 * than the limit we tell the client to resync over REST rather than ship an
 * unbounded burst, which keeps a reconnect cheap for both sides.
 */
export async function replayToConnection(args: {
  db: Kysely<DB>;
  conn: Connection;
  afterSeq: number;
  limit: number;
  metrics: Metrics;
}): Promise<number> {
  const { db, conn, afterSeq, limit, metrics } = args;

  if (afterSeq > 0) {
    const { events, hasMore } = await fetchReplayEvents(db, conn.appId, conn.userId, afterSeq, limit);

    if (hasMore) {
      conn.sendReplay({ type: 'resync', reason: 'replay_limit_exceeded' });
      metrics.replaySize.observe(0);
      return afterSeq;
    }

    for (const payload of events) {
      // A WS `resume` can ask for rows this connection already wrote.
      if (payload.seq <= conn.lastSequence) continue;
      // Straight through: these are the authoritative catch-up frames. Live
      // hints are buffered by the connection and de-duplicated afterwards.
      conn.sendReplay({ type: 'notification', seq: payload.seq, payload });
    }
    metrics.replaySize.observe(events.length);

    const last = events.at(-1);
    return last ? last.seq : afterSeq;
  }

  metrics.replaySize.observe(0);
  return afterSeq;
}

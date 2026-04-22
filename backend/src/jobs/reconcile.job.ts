import { sql } from 'kysely';
import type { WorkerContext } from './context.js';

/**
 * The cached unread counter is an optimisation, never the truth. This nightly
 * pass repairs any drift (a crashed request, a manual DB edit) against a real
 * COUNT(*) of unread in_app deliveries.
 */
export async function reconcileUnreadCounts(
  ctx: WorkerContext,
): Promise<{ corrected: number; zeroed: number }> {
  const corrected = await sql`
    WITH actual AS (
      SELECT d.app_id, d.user_id, count(*)::int AS unread
      FROM deliveries d
      WHERE d.channel = 'in_app'
        AND d.seq IS NOT NULL
        AND d.read_at IS NULL
        AND d.status <> 'suppressed'
      GROUP BY d.app_id, d.user_id
    )
    UPDATE user_streams us
    SET unread_count = actual.unread,
        updated_at = now()
    FROM actual
    WHERE us.app_id = actual.app_id
      AND us.user_id = actual.user_id
      AND us.unread_count <> actual.unread
  `.execute(ctx.db);

  const zeroed = await sql`
    UPDATE user_streams us
    SET unread_count = 0,
        updated_at = now()
    WHERE us.unread_count > 0
      AND NOT EXISTS (
        SELECT 1 FROM deliveries d
        WHERE d.app_id = us.app_id
          AND d.user_id = us.user_id
          AND d.channel = 'in_app'
          AND d.seq IS NOT NULL
          AND d.read_at IS NULL
          AND d.status <> 'suppressed'
      )
  `.execute(ctx.db);

  const result = {
    corrected: Number(corrected.numAffectedRows ?? 0),
    zeroed: Number(zeroed.numAffectedRows ?? 0),
  };
  ctx.logger.info(result, 'unread counter reconciliation complete');
  return result;
}

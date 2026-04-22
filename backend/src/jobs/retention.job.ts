import { sql } from 'kysely';
import type { WorkerContext } from './context.js';

/**
 * Expired notifications disappear (so they can never be replayed), and anything
 * older than the retention window goes with its deliveries via ON DELETE CASCADE.
 */
export async function pruneExpired(ctx: WorkerContext): Promise<{ deleted: number }> {
  const days = ctx.config.RETENTION_DAYS;
  const result = await sql`
    DELETE FROM notifications
    WHERE (expires_at IS NOT NULL AND expires_at < now())
       OR created_at < now() - (${days} * interval '1 day')
  `.execute(ctx.db);

  const deleted = Number(result.numAffectedRows ?? 0);
  ctx.logger.info({ deleted, retentionDays: days }, 'retention sweep complete');
  return { deleted };
}

// [initial module draft]
import type { DbExecutor, DeliveryChannel } from '../db/types.js';
import { getCategory, getPreference } from '../modules/preferences/preferences.repository.js';

export interface DeliveryPlan {
  inApp: boolean;
  email: boolean;
  webhook: boolean;
}

/**
 * Preferences are consulted at ingest, never at delivery: a suppressed
 * notification is stored that way and never becomes a gap in the sequence.
 */
export async function planDelivery(
  db: DbExecutor,
  appId: string,
  userId: string,
  category: string,
  requested: DeliveryChannel[] | undefined,
): Promise<DeliveryPlan> {
  const [preference, categoryRow] = await Promise.all([
    getPreference(db, appId, userId, category),
    getCategory(db, appId, category),
  ]);

  const mandatory = categoryRow?.mandatory ?? false;
  const muted = (preference?.muted ?? false) && !mandatory;
  const overrides = preference?.channels ?? {};

  const base: DeliveryChannel[] =
    requested && requested.length > 0
      ? requested
      : (categoryRow?.default_channels ?? ['in_app']);

  const inApp = base.includes('in_app') && !muted && overrides.in_app !== false;
  const email = base.includes('email') && overrides.email !== false;
  const webhook = base.includes('webhook') && overrides.webhook !== false;

  return { inApp, email, webhook };
}

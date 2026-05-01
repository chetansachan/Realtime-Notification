export interface BackoffConfig {
  baseMs?: number;
  maxMs?: number;
  random?: () => number;
}

/**
 * Exponential backoff with full jitter: the delay is uniform in [0, cap].
 * Jitter matters more than the curve here: after a deploy, thousands of tabs
 * must not reconnect in the same instant.
 */
export function backoffDelay(attempt: number, config: BackoffConfig = {}): number {
  const baseMs = config.baseMs ?? 1000;
  const maxMs = config.maxMs ?? 30_000;
  const random = config.random ?? Math.random;
  const safeAttempt = Math.max(0, Math.min(attempt, 16));
  const cap = Math.min(maxMs, baseMs * 2 ** safeAttempt);
  return Math.floor(random() * cap);
}

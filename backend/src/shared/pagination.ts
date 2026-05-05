export const DEFAULT_PAGE_SIZE = 30;
export const MAX_PAGE_SIZE = 100;

export function parseLimit(raw: unknown, fallback = DEFAULT_PAGE_SIZE, max = MAX_PAGE_SIZE): number {
  const value = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) return fallback;
  return Math.min(value, max);
}

export function parseSeq(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0) return raw;
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

export function parseBoolean(raw: unknown): boolean {
  return raw === true || raw === 'true' || raw === '1' || raw === 1;
}

/** Keyset pagination cursor: the smallest seq the client already has. */
export function encodeCursor(seq: number): string {
  return String(seq);
}

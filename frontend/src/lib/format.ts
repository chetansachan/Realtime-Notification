const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const absolute = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

/** Relative time for the item timestamp; the absolute value lives in a tooltip/title. */
export function formatRelative(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const seconds = Math.round((then - now) / 1000);
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size || unit === 'second') {
      return relative.format(Math.round(seconds / size), unit);
    }
  }
  return '';
}

export function formatAbsolute(iso: string): string {
  const then = Date.parse(iso);
  return Number.isNaN(then) ? '' : absolute.format(then);
}

export function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour12: false });
}

/**
 * Notification content is untrusted. Only https and same-origin relative links
 * are allowed; anything else (javascript:, data:, protocol-relative) is dropped.
 */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const candidate = value.trim();
  if (candidate.startsWith('/') && !candidate.startsWith('//')) return candidate;
  try {
    const url = new URL(candidate, 'https://example.invalid');
    if (url.protocol !== 'https:') return null;
    if (!/^https?:/.test(candidate)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function payloadPreview(value: unknown, max = 120): string {
  if (value === null || value === undefined) return '';
  try {
    const rendered = typeof value === 'string' ? value : JSON.stringify(value);
    return rendered.length > max ? `${rendered.slice(0, max)}…` : rendered;
  } catch {
    return '';
  }
}

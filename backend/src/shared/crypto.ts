import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** API keys are high-entropy random strings, so a plain SHA-256 is sufficient (no stretching). */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export interface GeneratedApiKey {
  /** Full key, shown exactly once to the caller. */
  plaintext: string;
  prefix: string;
  hash: string;
}

export function generateApiKey(env: 'live' | 'test' = 'live'): GeneratedApiKey {
  const prefix = randomBytes(6).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  const plaintext = `ntf_${env}_${prefix}_${secret}`;
  return { plaintext, prefix, hash: sha256Hex(plaintext) };
}

export function parseApiKey(value: string): { prefix: string } | null {
  const match = /^ntf_(?:live|test)_([0-9a-f]{12})_[A-Za-z0-9_-]{20,}$/.exec(value.trim());
  if (!match?.[1]) return null;
  return { prefix: match[1] };
}

export function generateSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function generateTicket(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

export function signWebhook(secret: string, timestampSeconds: number, body: string): string {
  const digest = createHmac('sha256', secret).update(`${timestampSeconds}.${body}`).digest('hex');
  return `t=${timestampSeconds},v1=${digest}`;
}

export function verifyWebhookSignature(
  secret: string,
  header: string,
  body: string,
  toleranceSeconds = 300,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const parts = new Map(
    header
      .split(',')
      .map((part) => part.split('=', 2))
      .filter((pair): pair is [string, string] => pair.length === 2),
  );
  const t = Number(parts.get('t'));
  const v1 = parts.get('v1');
  if (!Number.isFinite(t) || v1 === undefined) return false;
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  if (expected.length !== v1.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(v1, 'utf8'));
}

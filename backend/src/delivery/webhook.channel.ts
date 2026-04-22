// [initial module draft]
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { LookupFunction } from 'node:net';
import { Agent, request } from 'undici';
import { signWebhook } from '../shared/crypto.js';

export interface WebhookGuardOptions {
  allowHttp: boolean;
  allowPrivateIps: boolean;
}

export interface WebhookDeliveryOptions extends WebhookGuardOptions {
  timeoutMs: number;
  maxResponseBytes: number;
}

export class WebhookSecurityError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`webhook target rejected: ${reason}`);
    this.name = 'WebhookSecurityError';
    this.reason = reason;
  }
}

/** Loopback, link-local, RFC1918, CGNAT, multicast and IPv6 ULA. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a = -1, b = -1] = address.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('fe80')) return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice('::ffff:'.length));
    return false;
  }
  return true;
}

export interface ResolvedWebhookTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

/**
 * Users register these URLs, so treat them as hostile: https only, and the
 * hostname must not resolve anywhere private. The resolved address is pinned
 * for the request so DNS rebinding cannot swap it after the check.
 */
export async function resolveWebhookTarget(
  rawUrl: string,
  opts: WebhookGuardOptions,
): Promise<ResolvedWebhookTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WebhookSecurityError('invalid_url');
  }

  if (url.protocol !== 'https:' && !(opts.allowHttp && url.protocol === 'http:')) {
    throw new WebhookSecurityError('insecure_scheme');
  }
  if (!url.hostname) throw new WebhookSecurityError('invalid_url');

  let records;
  try {
    records = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new WebhookSecurityError('dns_resolution_failed');
  }
  if (records.length === 0) throw new WebhookSecurityError('dns_resolution_failed');

  if (!opts.allowPrivateIps) {
    for (const record of records) {
      if (isPrivateAddress(record.address)) {
        throw new WebhookSecurityError('private_address');
      }
    }
  }

  const first = records[0];
  if (!first) throw new WebhookSecurityError('dns_resolution_failed');

  return { url, address: first.address, family: first.family as 4 | 6 };
}

export interface WebhookPayload {
  url: string;
  secret: string;
  notificationId: string;
  body: string;
}

export interface WebhookResult {
  statusCode: number;
  ok: boolean;
  durationMs: number;
}

export async function deliverWebhook(
  payload: WebhookPayload,
  opts: WebhookDeliveryOptions,
): Promise<WebhookResult> {
  const target = await resolveWebhookTarget(payload.url, opts);

  const pinnedLookup: LookupFunction = (_hostname, _options, callback) => {
    callback(null, target.address, target.family);
  };

  const agent = new Agent({
    connect: {
      servername: target.url.hostname,
      lookup: pinnedLookup,
    },
  });

  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const timestamp = Math.floor(startedAt / 1000);

  try {
    const response = await request(target.url, {
      method: 'POST',
      body: payload.body,
      signal: controller.signal,
      dispatcher: agent,
      headersTimeout: opts.timeoutMs,
      bodyTimeout: opts.timeoutMs,
      headers: {
        'content-type': 'application/json',
        'user-agent': 'notification-service/1.0',
        'x-notification-id': payload.notificationId,
        'x-signature': signWebhook(payload.secret, timestamp, payload.body),
      },
    });

    let bytes = 0;
    try {
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > opts.maxResponseBytes) {
          response.body.destroy();
          break;
        }
      }
    } catch {
      // A truncated body does not change the status code's meaning.
    }

    const ok = response.statusCode >= 200 && response.statusCode < 300;
    return { statusCode: response.statusCode, ok, durationMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
    await agent.close().catch(() => undefined);
  }
}

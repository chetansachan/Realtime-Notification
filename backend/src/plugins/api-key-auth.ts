import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { findApiClientByPrefix, touchApiClient } from '../modules/api-keys/api-keys.repository.js';
import { parseApiKey, safeEqualHex, sha256Hex } from '../shared/crypto.js';
import { forbidden, unauthorized } from '../shared/errors.js';
import { hasScope, type ApiScope } from '../shared/auth.js';

interface CachedClient {
  id: string;
  appId: string;
  name: string;
  scopes: string[];
  active: boolean;
  keyHash: string;
  lastUsedAt: Date | null;
}

interface CacheEntry {
  client: CachedClient | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000;
const NEGATIVE_TTL_MS = 5_000;
const TOUCH_INTERVAL_MS = 60_000;

export function invalidateApiKeyCache(prefix?: string): void {
  if (prefix === undefined) cache.clear();
  else cache.delete(prefix);
}

async function resolveClient(app: FastifyInstance, prefix: string): Promise<CachedClient | null> {
  const now = Date.now();
  const cached = cache.get(prefix);
  if (cached && cached.expiresAt > now) return cached.client;

  const row = await findApiClientByPrefix(app.db, prefix);
  const client: CachedClient | null = row
    ? {
        id: row.id,
        appId: row.app_id,
        name: row.name,
        scopes: row.scopes,
        active: row.active,
        keyHash: row.key_hash,
        lastUsedAt: row.last_used_at,
      }
    : null;

  cache.set(prefix, { client, expiresAt: now + (client ? CACHE_TTL_MS : NEGATIVE_TTL_MS) });
  return client;
}

function extractBearer(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const [scheme, ...rest] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer') return null;
  const token = rest.join(' ').trim();
  return token.length > 0 ? token : null;
}

export async function authenticateApiKey(
  app: FastifyInstance,
  req: FastifyRequest,
  scope: ApiScope,
): Promise<void> {
  const token = extractBearer(req);
  if (!token) throw unauthorized('Missing Authorization: Bearer <api-key> header');

  const parsed = parseApiKey(token);
  if (!parsed) throw unauthorized('Malformed API key');

  const client = await resolveClient(app, parsed.prefix);
  if (!client || !client.active) throw unauthorized('Invalid or revoked API key');

  if (!safeEqualHex(client.keyHash, sha256Hex(token))) {
    throw unauthorized('Invalid or revoked API key');
  }

  if (!hasScope(client.scopes, scope)) {
    throw forbidden(`API key is missing the required scope "${scope}"`);
  }

  req.apiClient = {
    id: client.id,
    appId: client.appId,
    name: client.name,
    scopes: client.scopes,
  };

  // last_used_at is best-effort telemetry, never on the request's critical path.
  if (!client.lastUsedAt || Date.now() - client.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    client.lastUsedAt = new Date();
    touchApiClient(app.db, client.id).catch((err) =>
      app.log.warn({ err }, 'failed to update api client last_used_at'),
    );
  }
}

export function bearerToken(req: FastifyRequest): string | null {
  return extractBearer(req);
}

export default fp(
  async function apiKeyAuthPlugin(app: FastifyInstance) {
    app.decorate('requireApiKey', (scope: ApiScope): preHandlerHookHandler => {
      return async (req: FastifyRequest, _reply: FastifyReply) => {
        await authenticateApiKey(app, req, scope);
      };
    });
  },
  { name: 'api-key-auth', dependencies: ['db'] },
);

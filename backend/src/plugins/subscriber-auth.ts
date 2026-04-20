import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { authenticateApiKey, bearerToken } from './api-key-auth.js';
import { generateTicket, parseApiKey } from '../shared/crypto.js';
import { streamTicketKey } from '../shared/redis-keys.js';
import { unauthorized } from '../shared/errors.js';
import type { ApiScope } from '../shared/auth.js';

interface TicketPayload {
  appId: string;
  userId: string;
}

interface JwtPayload {
  appId?: unknown;
  sub?: unknown;
}

function queryTicket(req: FastifyRequest): string | null {
  const value = (req.query as { ticket?: unknown } | undefined)?.ticket;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function resolveTicket(app: FastifyInstance, ticket: string): Promise<TicketPayload> {
  // GETDEL: a ticket is valid for exactly one connection attempt.
  const raw = await app.redis.getdel(streamTicketKey(ticket));
  if (!raw) throw unauthorized('Invalid, expired or already used stream ticket');

  try {
    const parsed = JSON.parse(raw) as Partial<TicketPayload>;
    if (typeof parsed.appId !== 'string' || typeof parsed.userId !== 'string') {
      throw new Error('malformed ticket payload');
    }
    return { appId: parsed.appId, userId: parsed.userId };
  } catch {
    throw unauthorized('Invalid stream ticket');
  }
}

export async function authenticateSubscriber(
  app: FastifyInstance,
  req: FastifyRequest,
): Promise<void> {
  const ticket = queryTicket(req);
  if (ticket) {
    const resolved = await resolveTicket(app, ticket);
    req.subscriber = { ...resolved, source: 'ticket' };
    return;
  }

  const token = bearerToken(req);
  if (!token) throw unauthorized('Missing subscriber token or stream ticket');
  if (parseApiKey(token)) {
    throw unauthorized('API keys cannot authenticate subscriber endpoints');
  }

  let payload: JwtPayload;
  try {
    payload = await req.jwtVerify<JwtPayload>();
  } catch {
    throw unauthorized('Invalid or expired subscriber token');
  }

  if (typeof payload.appId !== 'string' || typeof payload.sub !== 'string') {
    throw unauthorized('Subscriber token is missing appId or sub');
  }

  req.subscriber = { appId: payload.appId, userId: payload.sub, source: 'jwt' };
}

export async function issueStreamTicket(
  app: FastifyInstance,
  appId: string,
  userId: string,
): Promise<{ ticket: string; expiresIn: number }> {
  const ticket = generateTicket();
  const ttl = app.config.STREAM_TICKET_TTL_SECONDS;
  await app.redis.set(streamTicketKey(ticket), JSON.stringify({ appId, userId }), 'EX', ttl);
  return { ticket, expiresIn: ttl };
}

export function issueSubscriberToken(
  app: FastifyInstance,
  appId: string,
  userId: string,
  ttlSeconds?: number,
): { token: string; expiresIn: number } {
  const expiresIn = ttlSeconds ?? app.config.SUBSCRIBER_TOKEN_TTL_SECONDS;
  const token = app.jwt.sign({ appId, sub: userId }, { expiresIn: `${expiresIn}s` });
  return { token, expiresIn };
}

export default fp(
  async function subscriberAuthPlugin(app: FastifyInstance) {
    await app.register(jwt, {
      secret: app.config.JWT_SECRET,
      sign: { expiresIn: `${app.config.SUBSCRIBER_TOKEN_TTL_SECONDS}s` },
    });

    app.decorate('authenticateSubscriber', (async (req: FastifyRequest, _reply: FastifyReply) => {
      await authenticateSubscriber(app, req);
    }) as preHandlerHookHandler);

    app.decorate('requireApiKeyOrSubscriber', (scope: ApiScope): preHandlerHookHandler => {
      return async (req: FastifyRequest, _reply: FastifyReply) => {
        const token = bearerToken(req);
        const looksLikeApiKey = token !== null && parseApiKey(token) !== null;
        if (!queryTicket(req) && !looksLikeApiKey && token !== null) {
          await authenticateSubscriber(app, req);
          return;
        }
        await authenticateApiKey(app, req, scope);
      };
    });
  },
  { name: 'subscriber-auth', dependencies: ['db', 'redis', 'api-key-auth'] },
);

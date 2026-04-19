import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import underPressure from '@fastify/under-pressure';
import type { FastifyInstance } from 'fastify';
import { sha256Hex } from '../shared/crypto.js';

export default fp(
  async function securityPlugin(app: FastifyInstance) {
    const { config } = app;

    await app.register(helmet, {
      // Swagger UI and the demo page rely on inline assets.
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    });

    await app.register(cors, {
      origin: config.corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: false,
    });

    await app.register(rateLimit, {
      global: true,
      max: config.RATE_LIMIT_MAX,
      timeWindow: config.RATE_LIMIT_WINDOW,
      redis: app.redis,
      nameSpace: 'ntf:rl:',
      // Key by API key when present so one noisy tenant cannot exhaust another's
      // budget from the same egress IP. Auth has not run yet, so parse the header.
      keyGenerator: (req) => {
        const header = req.headers.authorization;
        if (typeof header === 'string' && header.startsWith('Bearer ')) {
          return `key:${sha256Hex(header.slice(7))}`;
        }
        return `ip:${req.ip}`;
      },
      errorResponseBuilder: (req, context) => ({
        type: 'https://errors.notification-service.dev/rate_limited',
        title: 'Too Many Requests',
        status: 429,
        detail: `Rate limit exceeded, retry in ${context.after}`,
        code: 'rate_limited',
        requestId: req.id,
      }),
    });

    await app.register(underPressure, {
      maxEventLoopDelay: config.NODE_ENV === 'test' ? 0 : 1000,
      maxHeapUsedBytes: 0,
      maxRssBytes: 0,
      retryAfter: 5,
      exposeStatusRoute: false,
      message: 'Service is under heavy load, retry shortly',
    });
  },
  { name: 'security', dependencies: ['redis'] },
);

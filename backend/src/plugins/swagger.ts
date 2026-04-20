import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';

export default fp(
  async function swaggerPlugin(app: FastifyInstance) {
    await app.register(swagger, {
      openapi: {
        openapi: '3.1.0',
        info: {
          title: 'Notification Service',
          description:
            'Multi-tenant realtime notifications: Postgres is the source of truth, Redis Pub/Sub is a lossy hint, and a per-user sequence makes replay gapless.',
          version: '1.0.0',
        },
        servers: [{ url: 'http://localhost:3000' }],
        components: {
          securitySchemes: {
            apiKey: { type: 'apiKey', in: 'header', name: 'Authorization' },
            subscriberToken: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          },
        },
      },
    });

    await app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: { persistAuthorization: true, docExpansion: 'list' },
    });
  },
  { name: 'swagger' },
);

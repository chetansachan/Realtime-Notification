import type { AppServer } from '../../types/app.js';
import { Type } from '@sinclair/typebox';
import { ErrorResponse } from '../../shared/schemas.js';
import { badRequest, notFound } from '../../shared/errors.js';
import { ALL_SCOPES } from '../../shared/auth.js';
import { generateApiKey } from '../../shared/crypto.js';
import { invalidateApiKeyCache } from '../../plugins/api-key-auth.js';
import {
  insertApiClient,
  listApiClients,
  revokeApiClient,
} from './api-keys.repository.js';
import {
  ApiKeyCreatedResponse,
  ApiKeyListResponse,
  ApiKeyParams,
  CreateApiKeyBody,
} from './api-keys.schemas.js';

interface ApiClientRow {
  id: string;
  app_id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  active: boolean;
  created_at: Date;
  last_used_at: Date | null;
}

function toResponse(client: ApiClientRow) {
  return {
    id: client.id,
    appId: client.app_id,
    name: client.name,
    keyPrefix: client.key_prefix,
    scopes: client.scopes,
    active: client.active,
    createdAt: client.created_at.toISOString(),
    lastUsedAt: client.last_used_at ? client.last_used_at.toISOString() : null,
  };
}

export default async function apiKeyRoutes(app: AppServer) {
  app.post(
    '/v1/api-keys',
    {
      onRequest: app.requireApiKey('api-keys:admin'),
      schema: {
        tags: ['api-keys'],
        summary: 'Create another key for the same app (shown once)',
        body: CreateApiKeyBody,
        response: { 201: ApiKeyCreatedResponse, 400: ErrorResponse },
      },
    },
    async (req, reply) => {
      const caller = req.apiClient!;
      const requested = req.body.scopes ?? ['notify:write', 'tokens:create'];
      const invalid = requested.filter(
        (scope) => scope !== '*' && !(ALL_SCOPES as readonly string[]).includes(scope),
      );
      if (invalid.length > 0) {
        throw badRequest(`Unknown scopes: ${invalid.join(', ')}`);
      }

      const generated = generateApiKey(app.config.NODE_ENV === 'test' ? 'test' : 'live');
      const client = await insertApiClient(app.db, {
        appId: caller.appId,
        name: req.body.name,
        prefix: generated.prefix,
        hash: generated.hash,
        scopes: requested,
      });

      invalidateApiKeyCache(generated.prefix);

      return reply.status(201).send({
        ...toResponse(client as unknown as ApiClientRow),
        key: generated.plaintext,
      });
    },
  );

  app.get(
    '/v1/api-keys',
    {
      onRequest: app.requireApiKey('api-keys:admin'),
      schema: { tags: ['api-keys'], response: { 200: ApiKeyListResponse } },
    },
    async (req) => {
      const clients = await listApiClients(app.db, req.apiClient!.appId);
      return { items: clients.map((client) => toResponse(client as unknown as ApiClientRow)) };
    },
  );

  app.delete(
    '/v1/api-keys/:id',
    {
      onRequest: app.requireApiKey('api-keys:admin'),
      schema: {
        tags: ['api-keys'],
        params: ApiKeyParams,
        response: { 204: Type.Null(), 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      const revoked = await revokeApiClient(app.db, req.apiClient!.appId, req.params.id);
      if (!revoked) throw notFound('API key not found');
      invalidateApiKeyCache(revoked.key_prefix);
      return reply.status(204).send(null);
    },
  );
}

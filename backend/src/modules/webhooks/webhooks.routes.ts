import type { AppServer } from '../../types/app.js';
import { Type } from '@sinclair/typebox';
import { ErrorResponse } from '../../shared/schemas.js';
import { badRequest, notFound } from '../../shared/errors.js';
import { generateSecret } from '../../shared/crypto.js';
import {
  CreateWebhookBody,
  UpdateWebhookBody,
  WebhookCreatedResponse,
  WebhookListResponse,
  WebhookParams,
  WebhookResponse,
} from './webhooks.schemas.js';
import {
  createEndpoint,
  deleteEndpoint,
  findEndpoint,
  listEndpoints,
  updateEndpoint,
} from './webhooks.repository.js';

interface EndpointRow {
  id: string;
  url: string;
  active: boolean;
  failure_count: number;
  disabled_at: Date | null;
  created_at: Date;
}

function toResponse(endpoint: EndpointRow) {
  return {
    id: endpoint.id,
    url: endpoint.url,
    active: endpoint.active,
    failureCount: endpoint.failure_count,
    disabledAt: endpoint.disabled_at ? endpoint.disabled_at.toISOString() : null,
    createdAt: endpoint.created_at.toISOString(),
  };
}

function assertUrlSyntax(raw: string, allowHttp: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw badRequest('Invalid webhook URL');
  }
  if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) {
    throw badRequest('Webhook URLs must use https');
  }
  return parsed.toString();
}

export default async function webhookRoutes(app: AppServer) {
  app.post(
    '/v1/webhook-endpoints',
    {
      onRequest: app.requireApiKey('webhooks:write'),
      schema: {
        tags: ['webhooks'],
        body: CreateWebhookBody,
        response: { 201: WebhookCreatedResponse, 400: ErrorResponse },
      },
    },
    async (req, reply) => {
      const appId = req.apiClient!.appId;
      const url = assertUrlSyntax(req.body.url, app.config.WEBHOOK_ALLOW_HTTP);
      const secret = generateSecret();
      const endpoint = await createEndpoint(app.db, { appId, url, secret });
      return reply.status(201).send({ ...toResponse(endpoint), secret });
    },
  );

  app.get(
    '/v1/webhook-endpoints',
    {
      onRequest: app.requireApiKey('webhooks:write'),
      schema: { tags: ['webhooks'], response: { 200: WebhookListResponse } },
    },
    async (req) => {
      const endpoints = await listEndpoints(app.db, req.apiClient!.appId);
      return { items: endpoints.map(toResponse) };
    },
  );

  app.get(
    '/v1/webhook-endpoints/:id',
    {
      onRequest: app.requireApiKey('webhooks:write'),
      schema: {
        tags: ['webhooks'],
        params: WebhookParams,
        response: { 200: WebhookResponse, 404: ErrorResponse },
      },
    },
    async (req) => {
      const endpoint = await findEndpoint(app.db, req.apiClient!.appId, req.params.id);
      if (!endpoint) throw notFound('Webhook endpoint not found');
      return toResponse(endpoint);
    },
  );

  app.patch(
    '/v1/webhook-endpoints/:id',
    {
      onRequest: app.requireApiKey('webhooks:write'),
      schema: {
        tags: ['webhooks'],
        params: WebhookParams,
        body: UpdateWebhookBody,
        response: { 200: WebhookResponse, 404: ErrorResponse },
      },
    },
    async (req) => {
      const appId = req.apiClient!.appId;
      const url =
        req.body.url === undefined
          ? undefined
          : assertUrlSyntax(req.body.url, app.config.WEBHOOK_ALLOW_HTTP);

      const endpoint = await updateEndpoint(app.db, appId, req.params.id, {
        ...(url === undefined ? {} : { url }),
        ...(req.body.active === undefined ? {} : { active: req.body.active }),
      });
      if (!endpoint) throw notFound('Webhook endpoint not found');
      return toResponse(endpoint);
    },
  );

  app.delete(
    '/v1/webhook-endpoints/:id',
    {
      onRequest: app.requireApiKey('webhooks:write'),
      schema: {
        tags: ['webhooks'],
        params: WebhookParams,
        response: { 204: Type.Null(), 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      const deleted = await deleteEndpoint(app.db, req.apiClient!.appId, req.params.id);
      if (!deleted) throw notFound('Webhook endpoint not found');
      return reply.status(204).send(null);
    },
  );
}

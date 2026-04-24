import type { AppServer } from '../../types/app.js';
import { ErrorResponse } from '../../shared/schemas.js';
import { badRequest } from '../../shared/errors.js';
import { issueStreamTicket, issueSubscriberToken } from '../../plugins/subscriber-auth.js';
import {
  StreamTicketBody,
  StreamTicketResponse,
  SubscriberTokenBody,
  SubscriberTokenResponse,
} from './tokens.schemas.js';

export default async function tokenRoutes(app: AppServer) {
  app.post(
    '/v1/subscriber-tokens',
    {
      onRequest: app.requireApiKey('tokens:create'),
      schema: {
        tags: ['tokens'],
        summary: 'Mint a short-lived subscriber JWT for a browser or device',
        body: SubscriberTokenBody,
        response: { 200: SubscriberTokenResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req) => {
      const appId = req.apiClient!.appId;
      const { token, expiresIn } = issueSubscriberToken(
        app,
        appId,
        req.body.userId,
        req.body.ttlSeconds,
      );
      return { token, expiresIn, appId, userId: req.body.userId };
    },
  );

  app.post(
    '/v1/stream-tickets',
    {
      // Host backends mint tickets for users; a subscriber may mint their own.
      onRequest: app.requireApiKeyOrSubscriber('tokens:create'),
      schema: {
        tags: ['tokens'],
        summary: 'Mint a single-use, short-lived SSE/WebSocket ticket',
        body: StreamTicketBody,
        response: { 200: StreamTicketResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req) => {
      const subscriber = req.subscriber;
      const appId = subscriber?.appId ?? req.apiClient!.appId;
      const userId = subscriber?.userId ?? req.body.userId;

      if (!userId) throw badRequest('"userId" is required when authenticating with an API key');

      const { ticket, expiresIn } = await issueStreamTicket(app, appId, userId);
      return {
        ticket,
        expiresIn,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
        appId,
        userId,
      };
    },
  );
}

import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { AppServer } from '../../types/app.js';
import type { RawData, WebSocket } from 'ws';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { WsConnection } from '../../realtime/connection.js';
import { getStreamState, replayToConnection } from '../../realtime/replay.js';
import { parseSeq } from '../../shared/pagination.js';
import { ensureTypeBoxFormats } from '../../shared/typebox-formats.js';
import { ErrorResponse } from '../../shared/schemas.js';
import { InboxService } from '../inbox/inbox.service.js';

// Value.Check treats an unregistered `format` as a validation failure.
ensureTypeBoxFormats();

const WsQuery = Type.Object({
  ticket: Type.Optional(Type.String({ maxLength: 256 })),
  lastSeq: Type.Optional(Type.String({ maxLength: 32 })),
  lastEventId: Type.Optional(Type.String({ maxLength: 32 })),
});

const ClientMessage = Type.Union([
  Type.Object({ type: Type.Literal('resume'), lastSeq: Type.Integer({ minimum: 0 }) }),
  Type.Object({ type: Type.Literal('ack'), id: Type.String({ format: 'uuid' }) }),
  Type.Object({ type: Type.Literal('read'), id: Type.String({ format: 'uuid' }) }),
  Type.Object({ type: Type.Literal('ping') }),
]);

export default async function wsRoutes(app: AppServer) {
  const inbox = new InboxService(app);

  app.get(
    '/v1/ws',
    {
      websocket: true,
      onRequest: app.authenticateSubscriber,
      config: {
        rateLimit: {
          max: app.config.STREAM_RATE_LIMIT_MAX,
          timeWindow: app.config.STREAM_RATE_LIMIT_WINDOW,
        },
      },
      schema: {
        tags: ['stream'],
        summary: 'WebSocket transport with the same replay protocol',
        querystring: WsQuery,
        response: { 401: ErrorResponse },
      },
    },
    (socket: WebSocket, req: FastifyRequest) => {
      void handleSocket(app, inbox, socket, req);
    },
  );

  async function handleSocket(
    instance: AppServer,
    inboxService: InboxService,
    socket: WebSocket,
    req: FastifyRequest,
  ): Promise<void> {
    const subscriber = req.subscriber;
    if (!subscriber) {
      socket.close(1008, 'unauthorized');
      return;
    }

    const { appId, userId } = subscriber;
    const query = req.query as { lastSeq?: string; lastEventId?: string };
    const lastSeq = parseSeq(query.lastSeq ?? query.lastEventId) ?? 0;

    const conn = new WsConnection(
      {
        id: randomUUID(),
        appId,
        userId,
        instanceId: instance.config.INSTANCE_ID,
        maxQueue: instance.config.CONNECTION_QUEUE_MAX,
        maxQueueBytes: instance.config.CONNECTION_QUEUE_BYTES,
        maxBuffered: instance.config.REPLAY_LIMIT + instance.config.CONNECTION_QUEUE_MAX,
        logger: instance.log,
        metrics: instance.metrics,
      },
      socket,
    );

    socket.on('close', () => {
      void instance.realtime.detach(conn);
    });
    socket.on('error', () => {
      void instance.realtime.detach(conn);
    });
    socket.on('message', (raw: RawData, isBinary: boolean) => {
      if (isBinary) {
        socket.close(1003, 'text frames only');
        return;
      }
      void handleMessage(raw.toString());
    });

    async function handleMessage(text: string): Promise<void> {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return;
      }
      if (!Value.Check(ClientMessage, parsed)) return;

      try {
        if (parsed.type === 'resume') {
          await replayToConnection({
            db: instance.db,
            conn,
            afterSeq: parsed.lastSeq,
            limit: instance.config.REPLAY_LIMIT,
            metrics: instance.metrics,
          });
        } else if (parsed.type === 'ack') {
          await inboxService.ack(appId, userId, parsed.id);
        } else if (parsed.type === 'read') {
          await inboxService.markRead(appId, userId, parsed.id);
        }
      } catch (err) {
        instance.log.warn({ err, appId, userId }, 'websocket message failed');
      }
    }

    try {
      const state = await getStreamState(instance.db, appId, userId);

      await instance.realtime.attach(conn, (target) =>
        replayToConnection({
          db: instance.db,
          conn: target,
          afterSeq: lastSeq,
          limit: instance.config.REPLAY_LIMIT,
          metrics: instance.metrics,
        }),
      );

      conn.send({
        type: 'hello',
        instanceId: instance.config.INSTANCE_ID,
        lastSeq: state.lastSeq,
        unreadCount: state.unreadCount,
        resumeFrom: lastSeq,
      });
    } catch (err) {
      instance.log.warn({ err, appId, userId }, 'websocket attach failed');
      socket.close(1011, 'internal error');
    }
  }
}

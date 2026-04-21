import { randomUUID } from 'node:crypto';
import type { AppServer } from '../../types/app.js';
import { Type } from '@sinclair/typebox';
import { SseConnection } from '../../realtime/connection.js';
import { getStreamState, replayToConnection } from '../../realtime/replay.js';
import { parseSeq } from '../../shared/pagination.js';
import { ErrorResponse } from '../../shared/schemas.js';

const StreamQuery = Type.Object({
  ticket: Type.Optional(Type.String({ maxLength: 256 })),
  lastEventId: Type.Optional(Type.String({ maxLength: 32 })),
});

export default async function sseRoutes(app: AppServer) {
  app.get(
    '/v1/stream',
    {
      onRequest: app.authenticateSubscriber,
      config: {
        rateLimit: {
          max: app.config.STREAM_RATE_LIMIT_MAX,
          timeWindow: app.config.STREAM_RATE_LIMIT_WINDOW,
        },
      },
      schema: {
        tags: ['stream'],
        summary: 'Server-Sent Events stream, honors Last-Event-ID',
        querystring: StreamQuery,
        response: { 401: ErrorResponse },
      },
    },
    async (req, reply) => {
      const { appId, userId } = req.subscriber!;
      const headerValue = req.headers['last-event-id'];
      const headerSeq = Array.isArray(headerValue) ? headerValue[0] : headerValue;
      const lastSeq = parseSeq(headerSeq ?? req.query.lastEventId) ?? 0;

      // Read the authoritative counters before taking over the socket, so a DB
      // failure still produces a normal JSON error.
      const state = await getStreamState(app.db, appId, userId);

      reply.hijack();
      const res = reply.raw;
      const headers: Record<string, string | number | string[]> = {};
      for (const [key, value] of Object.entries(reply.getHeaders())) {
        if (value !== undefined) headers[key] = value;
      }
      Object.assign(headers, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.writeHead(200, headers);
      res.write('retry: 3000\n\n');

      const socket = res.socket;
      socket?.setKeepAlive(true, 30_000);
      socket?.setNoDelay(true);

      const conn = new SseConnection(
        {
          id: randomUUID(),
          appId,
          userId,
          instanceId: app.config.INSTANCE_ID,
          maxQueue: app.config.CONNECTION_QUEUE_MAX,
          maxQueueBytes: app.config.CONNECTION_QUEUE_BYTES,
          maxBuffered: app.config.REPLAY_LIMIT + app.config.CONNECTION_QUEUE_MAX,
          logger: app.log,
          metrics: app.metrics,
        },
        res,
      );

      res.on('close', () => {
        void app.realtime.detach(conn);
      });

      await app.realtime.attach(conn, (target) =>
        replayToConnection({
          db: app.db,
          conn: target,
          afterSeq: lastSeq,
          limit: app.config.REPLAY_LIMIT,
          metrics: app.metrics,
        }),
      );

      // Only now is the connection actually subscribed, replayed and live.
      // `hello` carries no `id:`, so it never moves the replay cursor.
      conn.send({
        type: 'hello',
        instanceId: app.config.INSTANCE_ID,
        lastSeq: state.lastSeq,
        unreadCount: state.unreadCount,
        resumeFrom: lastSeq,
      });

      // The socket belongs to us now; Fastify must not touch the reply.
      return reply;
    },
  );
}

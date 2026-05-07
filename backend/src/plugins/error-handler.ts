import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, fromPgError, isPgError } from '../shared/errors.js';

interface ErrorLike extends Error {
  validation?: unknown;
  statusCode?: number;
  code?: string;
}

const SAFE_STATUS_CODES = new Set([400, 401, 403, 404, 405, 409, 413, 415, 422, 429, 503]);

export default fp(
  async function errorHandlerPlugin(app: FastifyInstance) {
    app.setErrorHandler((error: unknown, req: FastifyRequest, reply: FastifyReply) => {
      const requestId = req.id;

      if (error instanceof AppError) {
        return reply.status(error.statusCode).send(error.toProblem(requestId));
      }

      const err = error as ErrorLike;

      if (err.validation || err.code === 'FST_ERR_VALIDATION') {
        return reply.status(400).send({
          type: 'https://errors.notification-service.dev/validation_failed',
          title: 'Validation Failed',
          status: 400,
          detail: 'Request does not match the schema',
          code: 'validation_failed',
          errors: err.validation,
          requestId,
        });
      }

      if (isPgError(error)) {
        const mapped = fromPgError(error);
        if (mapped.statusCode >= 500) {
          req.log.error({ err }, 'database error');
        }
        return reply.status(mapped.statusCode).send(mapped.toProblem(requestId));
      }

      if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
        return reply.status(413).send({
          type: 'https://errors.notification-service.dev/payload_too_large',
          title: 'Payload Too Large',
          status: 413,
          detail: `Request body exceeds ${app.config.BODY_LIMIT} bytes`,
          code: 'payload_too_large',
          requestId,
        });
      }

      const status = err.statusCode ?? 500;
      if (SAFE_STATUS_CODES.has(status)) {
        return reply.status(status).send({
          type: `https://errors.notification-service.dev/${status}`,
          title: err.name || 'Error',
          status,
          detail: err.message,
          requestId,
        });
      }

      req.log.error({ err }, 'unhandled error');
      return reply.status(500).send({
        type: 'https://errors.notification-service.dev/internal_error',
        title: 'Internal Server Error',
        status: 500,
        detail: 'An unexpected error occurred',
        code: 'internal_error',
        requestId,
      });
    });

    app.setNotFoundHandler((req, reply) => {
      reply.status(404).send({
        type: 'https://errors.notification-service.dev/not_found',
        title: 'Not Found',
        status: 404,
        detail: `Route ${req.method} ${req.url} does not exist`,
        code: 'not_found',
        requestId: req.id,
      });
    });
  },
  { name: 'error-handler' },
);

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { RawServerDefault } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';

/**
 * A Fastify instance whose route schemas drive TypeScript types. Route modules
 * must use this (not the bare FastifyInstance) or `req.body` degrades to
 * `unknown`.
 */
export type AppServer = FastifyInstance<
  RawServerDefault,
  IncomingMessage,
  ServerResponse,
  FastifyBaseLogger,
  TypeBoxTypeProvider
>;

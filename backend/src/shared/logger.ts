/**
 * The logger surface the framework-agnostic layers need. Both pino's Logger and
 * Fastify's base logger satisfy it, which keeps `realtime/` free of Fastify.
 */
export interface AppLogger {
  debug(payload: object, message?: string): void;
  info(payload: object, message?: string): void;
  warn(payload: object, message?: string): void;
  error(payload: object, message?: string): void;
}

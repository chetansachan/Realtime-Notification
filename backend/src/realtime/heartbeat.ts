import type { AppLogger } from '../shared/logger.js';
import type { ConnectionRegistry } from './registry.js';

export interface HeartbeatOptions {
  registry: ConnectionRegistry;
  intervalMs: number;
  logger: AppLogger;
}

/**
 * One timer for every connection on the instance, not one per connection.
 * The ping both keeps proxies from idling the stream out and surfaces sockets
 * that died without a FIN.
 */
export class Heartbeat {
  readonly #registry: ConnectionRegistry;
  readonly #intervalMs: number;
  readonly #logger: AppLogger;
  #timer: NodeJS.Timeout | null = null;

  constructor(opts: HeartbeatOptions) {
    this.#registry = opts.registry;
    this.#intervalMs = opts.intervalMs;
    this.#logger = opts.logger;
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => this.sweep(), this.#intervalMs);
    this.#timer.unref();
  }

  stop(): void {
    if (!this.#timer) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  /** Returns the number of connections closed because the peer looked dead. */
  sweep(): number {
    let closed = 0;
    for (const conn of this.#registry.connections()) {
      let alive = false;
      try {
        alive = conn.ping();
      } catch {
        alive = false;
      }
      if (!alive) {
        conn.close('dead');
        void this.#registry.detach(conn);
        closed++;
      }
    }
    if (closed > 0) {
      this.#logger.warn({ closed }, 'heartbeat closed dead connections');
    }
    return closed;
  }
}

import type { AppLogger } from '../shared/logger.js';
import type { Redis } from 'ioredis';
import { parseUserChannel } from '../shared/redis-keys.js';
import { decodePublished } from './events.js';
import type { ConnectionRegistry } from './registry.js';
import type { Metrics } from '../plugins/metrics.js';

export interface PubSubBridgeOptions {
  redisSub: Redis;
  registry: ConnectionRegistry;
  logger: AppLogger;
  metrics: Metrics;
}

/**
 * Turns Redis messages into local dispatch calls. Messages are hints, never
 * truth: an unparseable one is logged and dropped, because Postgres still has
 * the row and clients can always replay.
 */
export class PubSubBridge {
  readonly #opts: PubSubBridgeOptions;
  #listener: ((channel: string, message: string) => void) | null = null;

  constructor(opts: PubSubBridgeOptions) {
    this.#opts = opts;
  }

  start(): void {
    if (this.#listener) return;
    this.#listener = (channel, message) => this.handle(channel, message);
    this.#opts.redisSub.on('message', this.#listener);
  }

  stop(): void {
    if (!this.#listener) return;
    this.#opts.redisSub.off('message', this.#listener);
    this.#listener = null;
  }

  handle(channel: string, message: string): void {
    const target = parseUserChannel(channel);
    if (!target) return;

    const event = decodePublished(message);
    if (!event) {
      this.#opts.logger.warn({ channel }, 'dropping malformed pub/sub payload');
      return;
    }

    this.#opts.metrics.publishLatency.observe(Math.max(0, Date.now() - event.ts) / 1000);

    switch (event.kind) {
      case 'notification':
        this.#opts.registry.dispatch(target.appId, target.userId, {
          type: 'notification',
          seq: event.seq,
          payload: event.notification,
        });
        break;
      case 'read':
        this.#opts.registry.dispatch(target.appId, target.userId, {
          type: 'read',
          notificationId: event.notificationId,
          unreadCount: event.unreadCount,
        });
        break;
      case 'read_all':
        this.#opts.registry.dispatch(target.appId, target.userId, {
          type: 'read_all',
          unreadCount: event.unreadCount,
        });
        break;
      case 'unread_count':
        this.#opts.registry.dispatch(target.appId, target.userId, {
          type: 'unread_count',
          unreadCount: event.unreadCount,
        });
        break;
    }
  }
}

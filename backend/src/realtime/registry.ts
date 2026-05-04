import type { AppLogger } from '../shared/logger.js';
import type { Redis } from 'ioredis';
import { userChannel } from '../shared/redis-keys.js';
import type { Connection, CloseReason } from './connection.js';
import type { StreamEvent } from './events.js';
import type { Metrics } from '../plugins/metrics.js';

export interface RegistryOptions {
  redisSub: Redis;
  logger: AppLogger;
  metrics: Metrics;
  maxPerUser: number;
  maxTotal: number;
}

export type ReplayFn = (conn: Connection) => Promise<number>;

/**
 * Owns every live connection on this instance and the refcounted Redis
 * subscriptions that feed them.
 *
 * A user is subscribed exactly while they have at least one local connection,
 * so an instance only receives traffic for users it can actually serve.
 */
export class ConnectionRegistry {
  readonly #byUser = new Map<string, Set<Connection>>();
  readonly #subscriptions = new Map<string, number>();
  readonly #pendingSubscriptions = new Map<string, Promise<void>>();
  readonly #all = new Set<Connection>();
  readonly #opts: RegistryOptions;

  constructor(opts: RegistryOptions) {
    this.#opts = opts;
  }

  static userKey(appId: string, userId: string): string {
    return `${appId}\u0000${userId}`;
  }

  get size(): number {
    return this.#all.size;
  }

  get subscriptionCount(): number {
    return this.#subscriptions.size;
  }

  connections(): Connection[] {
    return [...this.#all];
  }

  connectionCountFor(appId: string, userId: string): number {
    return this.#byUser.get(ConnectionRegistry.userKey(appId, userId))?.size ?? 0;
  }

  isSubscribed(appId: string, userId: string): boolean {
    return this.#subscriptions.has(userChannel(appId, userId));
  }

  subscriptionRefs(appId: string, userId: string): number {
    return this.#subscriptions.get(userChannel(appId, userId)) ?? 0;
  }

  /**
   * The three-phase handoff. The order is the whole point:
   * subscribe (and wait for the ack) before replaying, otherwise anything
   * committed during the DB read would be lost.
   */
  async attach(conn: Connection, replay: ReplayFn): Promise<boolean> {
    if (this.#all.size >= this.#opts.maxTotal) {
      this.#opts.logger.warn(
        { appId: conn.appId, instanceId: conn.instanceId },
        'connection limit reached, rejecting stream',
      );
      conn.close('evicted');
      return false;
    }

    conn.beginBuffering();

    const key = ConnectionRegistry.userKey(conn.appId, conn.userId);
    let set = this.#byUser.get(key);
    if (!set) {
      set = new Set();
      this.#byUser.set(key, set);
    }
    set.add(conn);
    this.#all.add(conn);
    this.#opts.metrics.connectionsOpen.inc({ transport: conn.transport });
    this.#opts.metrics.connectionsTotal.inc({ transport: conn.transport });

    if (set.size > this.#opts.maxPerUser) {
      const oldest = set.values().next().value;
      if (oldest && oldest !== conn) {
        this.#opts.logger.info(
          { appId: conn.appId, userId: conn.userId, connectionId: oldest.id },
          'evicting oldest connection for user',
        );
        this.evict(oldest);
      }
    }

    try {
      await this.#retainSubscription(conn.appId, conn.userId);
    } catch (err) {
      this.#opts.logger.error(
        { err, appId: conn.appId, userId: conn.userId },
        'redis subscribe failed, dropping connection',
      );
      await this.detach(conn);
      conn.close('evicted');
      return false;
    }

    let replayed = 0;
    try {
      replayed = await replay(conn);
    } catch (err) {
      this.#opts.logger.error(
        { err, appId: conn.appId, userId: conn.userId },
        'replay failed, dropping connection',
      );
      await this.detach(conn);
      conn.close('evicted');
      return false;
    }

    conn.finishReplay(replayed);
    return true;
  }

  evict(conn: Connection): void {
    conn.close('evicted');
    void this.detach(conn);
  }

  async detach(conn: Connection): Promise<void> {
    const key = ConnectionRegistry.userKey(conn.appId, conn.userId);
    const set = this.#byUser.get(key);
    const wasTracked = this.#all.delete(conn);
    const removedFromUser = set?.delete(conn) ?? false;
    if (!wasTracked && !removedFromUser) return;

    if (wasTracked) {
      this.#opts.metrics.connectionsOpen.dec({ transport: conn.transport });
    }

    if (!removedFromUser) return;

    if (set && set.size === 0) this.#byUser.delete(key);
    // One ref per connection: the last detach is what unsubscribes.
    await this.#releaseSubscription(conn.appId, conn.userId);
  }

  /** Synchronous fan-out to local connections; never awaits a slow client. */
  dispatch(appId: string, userId: string, event: StreamEvent): number {
    const set = this.#byUser.get(ConnectionRegistry.userKey(appId, userId));
    if (!set) return 0;

    let delivered = 0;
    for (const conn of [...set]) {
      const result = conn.send(event);
      if (result === 'closed') {
        void this.detach(conn);
        continue;
      }
      delivered++;
    }
    return delivered;
  }

  async shutdown(reason: CloseReason = 'shutdown'): Promise<void> {
    for (const conn of [...this.#all]) conn.close(reason);
    this.#all.clear();
    this.#byUser.clear();

    const channels = [...this.#subscriptions.keys()];
    this.#subscriptions.clear();
    if (channels.length > 0) {
      try {
        await this.#opts.redisSub.unsubscribe(...channels);
      } catch (err) {
        this.#opts.logger.warn({ err }, 'failed to unsubscribe on shutdown');
      }
    }
  }

  async #retainSubscription(appId: string, userId: string): Promise<void> {
    const channel = userChannel(appId, userId);
    await this.#ensureSubscribed(channel);
    this.#subscriptions.set(channel, (this.#subscriptions.get(channel) ?? 0) + 1);
  }

  async #ensureSubscribed(channel: string): Promise<void> {
    if ((this.#subscriptions.get(channel) ?? 0) > 0) return;

    let pending = this.#pendingSubscriptions.get(channel);
    if (!pending) {
      pending = this.#opts.redisSub
        .subscribe(channel)
        .then(() => undefined)
        .finally(() => {
          this.#pendingSubscriptions.delete(channel);
        });
      this.#pendingSubscriptions.set(channel, pending);
    }
    await pending;
  }

  async #releaseSubscription(appId: string, userId: string): Promise<void> {
    const channel = userChannel(appId, userId);
    const pending = this.#pendingSubscriptions.get(channel);
    if (pending) await pending.catch(() => undefined);

    const count = this.#subscriptions.get(channel) ?? 0;
    if (count <= 1) {
      this.#subscriptions.delete(channel);
      try {
        await this.#opts.redisSub.unsubscribe(channel);
      } catch (err) {
        this.#opts.logger.warn({ err, channel }, 'redis unsubscribe failed');
      }
    } else {
      this.#subscriptions.set(channel, count - 1);
    }
  }
}

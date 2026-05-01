// [initial module draft]
import { fetchEventSource, type EventSourceMessage } from '@microsoft/fetch-event-source';
import { backoffDelay } from './backoff.js';
import { parseStreamEvent, type StreamEvent } from './events.js';
import type { StreamStatus } from './store.js';

export interface StreamStateUpdate {
  status: StreamStatus;
  nextRetryAt: number | null;
  retryDelayMs: number | null;
  attempt: number;
}

export interface StreamClientOptions {
  baseUrl?: string;
  /** Called before every (re)connect. Must return a fresh, valid JWT. */
  getToken: () => Promise<string>;
  /** Called once after a 401; should invalidate any cached token. */
  refreshToken?: () => Promise<string>;
  onEvent: (event: StreamEvent) => void;
  onStateChange?: (update: StreamStateUpdate) => void;
  initialLastSeq?: number;
  random?: () => number;
  now?: () => number;
  stableAfterMs?: number;
}

class UnauthorizedError extends Error {}
class StreamClosedError extends Error {}
class ReconnectRequested extends Error {
  readonly delayMs: number;

  constructor(delayMs: number) {
    super('server requested a reconnect');
    this.delayMs = delayMs;
  }
}

/**
 * Owns reconnection. That is deliberate: the backend's stream tickets are
 * single-use and a JWT expires, so native EventSource auto-reconnect would
 * either replay a consumed URL or fail silently. Every attempt fetches a token,
 * sends Last-Event-ID, and backs off with full jitter.
 */
export class StreamClient {
  readonly #options: StreamClientOptions;
  #started = false;
  #manualClose = false;
  #controller: AbortController | null = null;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #attempt = 0;
  #lastEventId: number;
  #offlineUntil = 0;
  #simulatingOffline = false;
  #lastConnectedAt = 0;
  #authRefreshed = false;
  #retryDelayMs: number | null = null;

  constructor(options: StreamClientOptions) {
    this.#options = options;
    this.#lastEventId = Math.max(0, options.initialLastSeq ?? 0);
  }

  get lastEventId(): number {
    return this.#lastEventId;
  }

  get started(): boolean {
    return this.#started;
  }

  /** The hook keeps the cursor in sync when REST or storage advances it. */
  notifyLastSeq(seq: number): void {
    if (seq > this.#lastEventId) this.#lastEventId = seq;
  }

  connect(): void {
    if (this.#started) return;
    this.#started = true;
    this.#manualClose = false;
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.#onOnline);
      window.addEventListener('offline', this.#onBrowserOffline);
    }
    void this.#run();
  }

  disconnect(): void {
    this.#manualClose = true;
    this.#started = false;
    this.#clearTimer();
    this.#abort();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.#onOnline);
      window.removeEventListener('offline', this.#onBrowserOffline);
    }
    this.#emit('idle', null, null);
  }

  /** Simulates a network drop: abort now, reconnect with backoff. */
  drop(): void {
    if (!this.#started) return;
    this.#abort();
    if (this.#retryTimer) return;
    this.#attempt += 1;
    const delay = backoffDelay(this.#attempt - 1, { random: this.#options.random });
    this.#retryDelayMs = delay;
    this.#emit('reconnecting', this.#now() + delay, delay);
    this.#schedule(delay);
  }

  /** Keeps the socket closed for `ms`, then resumes (used by the playground). */
  simulateOffline(ms: number): void {
    if (!this.#started) return;
    this.#simulatingOffline = true;
    this.#offlineUntil = this.#now() + ms;
    this.#abort();
    this.#clearTimer();
    this.#emit('offline', this.#offlineUntil, ms);
    this.#schedule(ms);
  }

  reconnectNow(): void {
    if (!this.#started) return;
    this.#clearTimer();
    this.#offlineUntil = 0;
    this.#simulatingOffline = false;
    this.#attempt = 0;
    this.#abort();
    this.#emit('connecting', null, null);
    void this.#run();
  }

  #now(): number {
    return this.#options.now?.() ?? Date.now();
  }

  #emit(status: StreamStatus, nextRetryAt: number | null, retryDelayMs: number | null): void {
    this.#options.onStateChange?.({
      status,
      nextRetryAt,
      retryDelayMs,
      attempt: this.#attempt,
    });
  }

  #clearTimer(): void {
    if (this.#retryTimer) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
    }
  }

  #schedule(delayMs: number): void {
    this.#clearTimer();
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      void this.#run();
    }, Math.max(0, delayMs));
  }

  #abort(): void {
    this.#controller?.abort();
    this.#controller = null;
  }

  #onOnline = (): void => {
    if (this.#started) this.reconnectNow();
  };

  #onBrowserOffline = (): void => {
    if (!this.#started) return;
    this.#abort();
    this.#emit('offline', null, null);
  };

  async #run(): Promise<void> {
    if (!this.#started || this.#manualClose) return;

    const now = this.#now();
    if (now < this.#offlineUntil) {
      this.#emit('offline', this.#offlineUntil, this.#offlineUntil - now);
      this.#schedule(this.#offlineUntil - now);
      return;
    }
    this.#simulatingOffline = false;

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.#emit('offline', null, null);
      return;
    }

    this.#emit(this.#attempt > 0 ? 'reconnecting' : 'connecting', null, this.#retryDelayMs);

    let token: string;
    try {
      token = await this.#options.getToken();
    } catch (err: unknown) {
      const isExplicitAuthError =
        typeof err === 'object' &&
        err !== null &&
        'status' in err &&
        ((err as { status: number }).status === 401 || (err as { status: number }).status === 403);

      if (isExplicitAuthError) {
        this.#emit('unauthorized', null, null);
        return;
      }

      // If it's a network glitch, server wake-up, or 404/500, retry with backoff instead of falsely halting with unauthorized
      this.#attempt += 1;
      const delay = backoffDelay(this.#attempt - 1, { random: this.#options.random });
      this.#retryDelayMs = delay;
      this.#emit('reconnecting', this.#now() + delay, delay);
      this.#schedule(delay);
      return;
    }

    const controller = new AbortController();
    this.#controller = controller;
    const base = (this.#options.baseUrl ?? '').replace(/\/$/, '');
    const headers: Record<string, string> = {
      accept: 'text/event-stream',
      authorization: `Bearer ${token}`,
    };
    if (this.#lastEventId > 0) headers['Last-Event-ID'] = String(this.#lastEventId);

    try {
      await fetchEventSource(`${base}/v1/stream`, {
        method: 'GET',
        headers,
        signal: controller.signal,
        // Do not pause the stream when the tab is hidden: the demo shows
        // catch-up, and notification delivery should not depend on visibility.
        openWhenHidden: true,
        onopen: async (response) => {
          if (response.status === 401) throw new UnauthorizedError('unauthorized');
          if (!response.ok) throw new Error(`stream failed with ${response.status}`);
          this.#lastConnectedAt = this.#now();
          this.#authRefreshed = false;
          this.#emit('live', null, null);
        },
        onmessage: (message: EventSourceMessage) => {
          if (message.event === 'reconnect') {
            const parsed = parseStreamEvent('reconnect', message.data);
            throw new ReconnectRequested(parsed?.type === 'reconnect' ? parsed.retryAfterMs : 0);
          }

          if (message.id) {
            const value = Number(message.id);
            if (Number.isFinite(value) && value > this.#lastEventId) this.#lastEventId = value;
          }

          const event = parseStreamEvent(message.event ?? 'message', message.data);
          if (!event) return;
          if (event.type === 'notification' && event.seq > this.#lastEventId) {
            this.#lastEventId = event.seq;
          }
          this.#options.onEvent(event);
        },
        onclose: () => {
          throw new StreamClosedError('stream closed by server');
        },
        onerror: (error) => {
          throw error;
        },
      });
      throw new StreamClosedError('stream ended');
    } catch (error) {
      if (this.#manualClose || !this.#started) return;
      if (this.#simulatingOffline) return;

      if (error instanceof ReconnectRequested) {
        this.#emit('reconnecting', this.#now() + error.delayMs, error.delayMs);
        this.#schedule(error.delayMs);
        return;
      }

      if (error instanceof UnauthorizedError) {
        if (!this.#authRefreshed && this.#options.refreshToken) {
          this.#authRefreshed = true;
          try {
            await this.#options.refreshToken();
            void this.#run();
            return;
          } catch {
            this.#emit('unauthorized', null, null);
            return;
          }
        }
        this.#emit('unauthorized', null, null);
        return;
      }

      // A connection that stayed up long enough resets the backoff ladder.
      if (this.#now() - this.#lastConnectedAt > (this.#options.stableAfterMs ?? 10_000)) {
        this.#attempt = 0;
      }

      this.#attempt += 1;
      const delay = backoffDelay(this.#attempt - 1, { random: this.#options.random });
      this.#retryDelayMs = delay;
      this.#emit('reconnecting', this.#now() + delay, delay);
      this.#schedule(delay);
    } finally {
      if (this.#controller === controller) this.#controller = null;
    }
  }
}

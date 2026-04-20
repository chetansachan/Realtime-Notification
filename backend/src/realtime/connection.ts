// [initial module draft]
import type { AppLogger } from '../shared/logger.js';
import type { ServerResponse } from 'node:http';
import type { WebSocket } from 'ws';
import {
  SSE_COMMENT_FRAME,
  encodeSseEvent,
  type StreamEvent,
} from './events.js';
import type { Metrics } from '../plugins/metrics.js';

/** ws readyState for OPEN; avoids depending on the instance-level constant. */
const WS_OPEN = 1;

export type CloseReason = 'shutdown' | 'overflow' | 'evicted' | 'client' | 'dead';

export type SendResult = 'ok' | 'backpressure' | 'closed';

export interface Connection {
  readonly id: string;
  readonly appId: string;
  readonly userId: string;
  readonly transport: 'sse' | 'ws';
  /** Which API instance owns this connection (shown in the SSE hello event). */
  readonly instanceId: string;
  readonly closed: boolean;
  /** While buffering, sends are captured instead of written (replay handoff). */
  beginBuffering(): void;
  /** Switches to live mode, dropping buffered events the replay already covered. */
  finishReplay(lastSentSeq: number): void;
  send(event: StreamEvent): SendResult;
  /**
   * Writes a replayed event straight through without buffering it. Live hints
   * that arrive while the replay runs stay buffered, so write order is
   * replay-then-live and duplicate suppression only ever drops live copies.
   */
  sendReplay(event: StreamEvent): SendResult;
  /** Highest sequence number already written to this connection. */
  readonly lastSequence: number;
  /** Returns false when the transport is known to be dead. */
  ping(): boolean;
  close(reason: CloseReason): void;
}

export interface ConnectionOptions {
  id: string;
  appId: string;
  userId: string;
  instanceId: string;
  maxQueue: number;
  maxQueueBytes: number;
  /**
   * Bound for sends captured during the replay handoff. Must comfortably cover
   * REPLAY_LIMIT plus anything that arrives live while the replay runs.
   */
  maxBuffered?: number;
  maxBufferedBytes?: number;
  logger: AppLogger;
  metrics: Metrics;
}

interface QueuedFrame {
  frame: string;
  bytes: number;
  seq?: number;
}

/**
 * Shared machinery for both transports: the three-phase replay handoff, a
 * bounded outbound queue and duplicate suppression after replay.
 *
 * Phase 1 (buffering): live Redis hints are captured, never written.
 * Phase 2 (replay): the caller pushes DB rows through send() — still buffered.
 * Phase 3 (live): buffered frames with seq <= last replayed seq are dropped,
 * the rest are flushed, and everything afterwards writes straight through.
 */
export abstract class BaseConnection implements Connection {
  readonly id: string;
  readonly appId: string;
  readonly userId: string;
  readonly transport: 'sse' | 'ws';
  readonly #instanceId: string;
  readonly #logger: AppLogger;
  readonly #metrics: Metrics;
  readonly #maxQueue: number;
  readonly #maxQueueBytes: number;
  readonly #maxBuffered: number;
  readonly #maxBufferedBytes: number;

  /**
   * Starts live. attach() explicitly switches to buffering before subscribing,
   * so a connection that is created but never attached still behaves sanely.
   */
  protected mode: 'buffering' | 'live' | 'closed' = 'live';
  protected lastSentSeq = 0;

  #queue: QueuedFrame[] = [];
  #queueBytes = 0;
  #backpressured = false;

  constructor(transport: 'sse' | 'ws', opts: ConnectionOptions) {
    this.transport = transport;
    this.id = opts.id;
    this.appId = opts.appId;
    this.userId = opts.userId;
    this.#instanceId = opts.instanceId;
    this.#logger = opts.logger;
    this.#metrics = opts.metrics;
    this.#maxQueue = opts.maxQueue;
    this.#maxQueueBytes = opts.maxQueueBytes;
    this.#maxBuffered = opts.maxBuffered ?? Math.max(opts.maxQueue * 5, 500);
    this.#maxBufferedBytes = opts.maxBufferedBytes ?? Math.max(opts.maxQueueBytes * 5, 5_000_000);
  }

  get closed(): boolean {
    return this.mode === 'closed';
  }

  get instanceId(): string {
    return this.#instanceId;
  }

  get lastSequence(): number {
    return this.lastSentSeq;
  }

  get queuedFrames(): number {
    return this.#queue.length;
  }

  beginBuffering(): void {
    if (this.mode === 'closed') return;
    this.mode = 'buffering';
  }

  finishReplay(lastSentSeq: number): void {
    if (this.mode === 'closed') return;
    this.lastSentSeq = Math.max(this.lastSentSeq, lastSentSeq);
    this.mode = 'live';

    const buffered = this.#queue;
    this.#queue = [];
    this.#queueBytes = 0;

    for (const item of buffered) {
      if (this.closed) return;
      if (item.seq !== undefined && item.seq <= this.lastSentSeq) continue;
      this.#writeNow(item);
    }
  }

  send(event: StreamEvent): SendResult {
    if (this.mode === 'closed') return 'closed';

    const frame = this.encode(event);
    const seq = event.type === 'notification' ? event.seq : undefined;
    const item: QueuedFrame = {
      frame,
      bytes: Buffer.byteLength(frame, 'utf8'),
      ...(seq === undefined ? {} : { seq }),
    };

    if (this.mode === 'buffering') {
      if (!this.#enqueue(item)) {
        this.#overflow();
        return 'closed';
      }
      return 'ok';
    }

    // A hint can arrive just after a replay already wrote the same notification
    // (commit -> replay -> publish). Suppress anything at or below the cursor.
    if (seq !== undefined && seq <= this.lastSentSeq) return 'ok';

    return this.#writeNow(item);
  }

  sendReplay(event: StreamEvent): SendResult {
    if (this.mode === 'closed') return 'closed';

    const frame = this.encode(event);
    const seq = event.type === 'notification' ? event.seq : undefined;
    return this.#writeNow({
      frame,
      bytes: Buffer.byteLength(frame, 'utf8'),
      ...(seq === undefined ? {} : { seq }),
    });
  }

  ping(): boolean {
    return this.writeHeartbeat();
  }

  close(reason: CloseReason): void {
    if (this.mode === 'closed') return;
    this.mode = 'closed';
    this.#queue = [];
    this.#queueBytes = 0;

    if (reason === 'overflow') {
      this.#metrics.slowConsumerDropped.inc({ transport: this.transport });
      this.#logger.warn(
        { connectionId: this.id, appId: this.appId, userId: this.userId, transport: this.transport },
        'closing slow consumer',
      );
    }
    this.finalize(reason);
  }

  protected abstract encode(event: StreamEvent): string;

  /** Must return false when the kernel/socket buffer is full. */
  protected abstract write(frame: string): boolean;

  protected abstract writeHeartbeat(): boolean;

  protected abstract finalize(reason: CloseReason): void;

  protected get maxQueueLimit(): number {
    return this.#maxQueue;
  }

  protected get maxQueueBytesLimit(): number {
    return this.#maxQueueBytes;
  }

  /** Hooked to the transport's drain event. */
  protected handleDrain(): void {
    if (this.mode === 'closed' || !this.#backpressured) return;
    this.#backpressured = false;

    while (this.#queue.length > 0) {
      const item = this.#queue.shift();
      if (!item) return;
      this.#queueBytes -= item.bytes;
      if (item.seq !== undefined && item.seq <= this.lastSentSeq) continue;

      const result = this.#writeNow(item);
      if (result !== 'ok') return;
    }
  }

  #writeNow(item: QueuedFrame): SendResult {
    if (this.mode === 'closed') return 'closed';

    if (this.#backpressured) {
      if (!this.#enqueue(item)) {
        this.#overflow();
        return 'closed';
      }
      return 'backpressure';
    }

    const wrote = this.write(item.frame);
    if (item.seq !== undefined) {
      this.lastSentSeq = Math.max(this.lastSentSeq, item.seq);
    }
    if (!wrote) this.#backpressured = true;
    return wrote ? 'ok' : 'backpressure';
  }

  #enqueue(item: QueuedFrame): boolean {
    const maxItems = this.mode === 'buffering' ? this.#maxBuffered : this.#maxQueue;
    const maxBytes =
      this.mode === 'buffering' ? this.#maxBufferedBytes : this.#maxQueueBytes;

    if (this.#queue.length >= maxItems) return false;
    if (this.#queueBytes + item.bytes > maxBytes) return false;
    this.#queue.push(item);
    this.#queueBytes += item.bytes;
    return true;
  }

  #overflow(): void {
    // finalize() emits the transport-appropriate "resync" hint before closing.
    this.close('overflow');
  }
}

// Windows/macOS rel note: `#` private fields keep the queue sealed off from
// subclasses, which only ever need the transport primitives above.

export class SseConnection extends BaseConnection {
  readonly #res: ServerResponse;

  constructor(opts: ConnectionOptions, res: ServerResponse) {
    super('sse', opts);
    this.#res = res;

    res.on('drain', () => this.handleDrain());
    res.on('error', () => this.close('dead'));
    res.on('close', () => {
      if (!this.closed) this.close('client');
    });
  }

  protected override encode(event: StreamEvent): string {
    return encodeSseEvent(event);
  }

  protected override write(frame: string): boolean {
    if (this.#res.writableEnded || this.#res.destroyed) return false;
    return this.#res.write(frame);
  }

  protected override writeHeartbeat(): boolean {
    try {
      if (this.#res.writableEnded || this.#res.destroyed) return false;
      this.#res.write(SSE_COMMENT_FRAME);
      return true;
    } catch {
      return false;
    }
  }

  protected override finalize(reason: CloseReason): void {
    const res = this.#res;
    if (res.writableEnded || res.destroyed) return;

    try {
      if (reason === 'shutdown') {
        // Jitter spreads reconnect storms after a deploy.
        const retryAfterMs = 500 + Math.floor(Math.random() * 2000);
        res.write(encodeSseEvent({ type: 'reconnect', retryAfterMs }));
      } else if (reason === 'overflow') {
        res.write(encodeSseEvent({ type: 'resync', reason: 'slow_consumer' }));
      }
    } catch {
      // ignore: we are closing anyway
    }
    res.end();
  }
}

export class WsConnection extends BaseConnection {
  readonly #socket: WebSocket;
  #awaitingPong = false;
  #drainTimer: NodeJS.Timeout | null = null;

  constructor(opts: ConnectionOptions, socket: WebSocket) {
    super('ws', opts);
    this.#socket = socket;

    socket.on('pong', () => {
      this.#awaitingPong = false;
    });
    socket.on('close', () => {
      if (!this.closed) this.close('client');
    });
    socket.on('error', () => this.close('dead'));
  }

  get socket(): WebSocket {
    return this.#socket;
  }

  protected override encode(event: StreamEvent): string {
    return JSON.stringify(event);
  }

  protected override write(frame: string): boolean {
    if (this.#socket.readyState !== WS_OPEN) return false;
    this.#socket.send(frame);
    if (this.#socket.bufferedAmount >= this.maxQueueBytesLimit) {
      this.#scheduleDrain();
      return false;
    }
    return true;
  }

  protected override writeHeartbeat(): boolean {
    if (this.#socket.readyState !== WS_OPEN) return false;
    // No pong since the previous sweep means the peer is gone.
    if (this.#awaitingPong) return false;
    this.#awaitingPong = true;
    try {
      this.#socket.ping();
      return true;
    } catch {
      return false;
    }
  }

  protected override finalize(reason: CloseReason): void {
    if (this.#drainTimer) {
      clearTimeout(this.#drainTimer);
      this.#drainTimer = null;
    }
    try {
      if (reason === 'shutdown') {
        this.#socket.send(
          encodeSseEvent({ type: 'reconnect', retryAfterMs: 500 + Math.floor(Math.random() * 2000) }),
        );
      }
      this.#socket.close(reason === 'overflow' ? 1013 : 1000, reason);
    } catch {
      this.#socket.terminate();
    }
  }

  #scheduleDrain(): void {
    if (this.#drainTimer || this.closed) return;
    this.#drainTimer = setTimeout(() => {
      this.#drainTimer = null;
      this.handleDrain();
      if (this.#socket.bufferedAmount > 0 && !this.closed) this.#scheduleDrain();
    }, 10);
    this.#drainTimer.unref();
  }
}

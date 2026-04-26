import { describe, expect, it } from 'vitest';
import { BaseConnection, type CloseReason, type ConnectionOptions } from '../../src/realtime/connection.js';
import type { StreamEvent } from '../../src/realtime/events.js';
import { Metrics } from '../../src/plugins/metrics.js';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function options(overrides: Partial<ConnectionOptions> = {}): ConnectionOptions {
  return {
    id: 'conn-1',
    appId: 'app',
    userId: 'user',
    instanceId: 'test-instance',
    maxQueue: 2,
    maxQueueBytes: 10_000,
    logger: silentLogger,
    metrics: new Metrics(),
    ...overrides,
  };
}

function notification(seq: number): StreamEvent {
  return {
    type: 'notification',
    seq,
    payload: {
      id: `notification-${seq}`,
      seq,
      category: 'test',
      title: `title ${seq}`,
      body: null,
      data: null,
      priority: 'normal',
      createdAt: new Date().toISOString(),
      readAt: null,
    },
  };
}

class FakeConnection extends BaseConnection {
  readonly written: string[] = [];
  readonly closedReasons: CloseReason[] = [];
  failWrites = false;

  constructor(opts: ConnectionOptions) {
    super('sse', opts);
  }

  protected override encode(event: StreamEvent): string {
    return JSON.stringify(event);
  }

  protected override write(frame: string): boolean {
    this.written.push(frame);
    return !this.failWrites;
  }

  protected override writeHeartbeat(): boolean {
    return true;
  }

  protected override finalize(reason: CloseReason): void {
    this.closedReasons.push(reason);
  }

  drain(): void {
    this.handleDrain();
  }
}

describe('BaseConnection replay handoff', () => {
  it('buffers live events until replay finishes, then writes them', () => {
    const conn = new FakeConnection(options());
    conn.beginBuffering();

    conn.send(notification(5));
    expect(conn.written).toHaveLength(0);

    conn.finishReplay(4);
    expect(conn.written).toHaveLength(1);
    expect(conn.written[0]).toContain('"seq":5');
    expect(conn.lastSequence).toBe(5);
  });

  it('writes replayed events immediately, even in buffering mode', () => {
    const conn = new FakeConnection(options());
    conn.beginBuffering();

    conn.sendReplay(notification(1));
    conn.sendReplay(notification(2));
    conn.sendReplay(notification(3));

    expect(conn.written).toHaveLength(3);
    expect(conn.lastSequence).toBe(3);

    conn.finishReplay(3);
    expect(conn.written).toHaveLength(3);
  });

  it('drops buffered LIVE events the replay already covered (no duplicates)', () => {
    const conn = new FakeConnection(options());
    conn.beginBuffering();

    // Replay delivers 1 and 2; live hints for 1 (duplicate), 2 and 3 arrive meanwhile.
    conn.sendReplay(notification(1));
    conn.sendReplay(notification(2));
    conn.send(notification(1));
    conn.send(notification(2));
    conn.send(notification(3));

    conn.finishReplay(2);

    const seqs = conn.written.map(
      (frame) => (JSON.parse(frame) as { seq: number }).seq,
    );
    expect(seqs).toEqual([1, 2, 3]);
    expect(conn.lastSequence).toBe(3);
  });
});

describe('BaseConnection backpressure', () => {
  it('queues after the kernel buffer fills, then closes on overflow', () => {
    const conn = new FakeConnection(options({ maxQueue: 2 }));
    conn.failWrites = true;

    expect(conn.send(notification(1))).toBe('backpressure');
    expect(conn.send(notification(2))).toBe('backpressure');
    expect(conn.send(notification(3))).toBe('backpressure');
    expect(conn.queuedFrames).toBe(2);

    expect(conn.send(notification(4))).toBe('closed');
    expect(conn.closed).toBe(true);
    expect(conn.closedReasons).toEqual(['overflow']);
  });

  it('flushes the queue in order on drain', () => {
    const conn = new FakeConnection(options({ maxQueue: 5 }));
    conn.failWrites = true;

    conn.send(notification(1));
    conn.send(notification(2));
    conn.send(notification(3));
    expect(conn.queuedFrames).toBe(2);

    conn.failWrites = false;
    conn.drain();

    const seqs = conn.written.map((frame) => (JSON.parse(frame) as StreamEvent & { seq: number }).seq);
    expect(seqs).toEqual([1, 2, 3]);
    expect(conn.queuedFrames).toBe(0);
    expect(conn.lastSequence).toBe(3);
  });

  it('refuses to send after close', () => {
    const conn = new FakeConnection(options());
    conn.close('client');
    expect(conn.send(notification(1))).toBe('closed');
    expect(conn.closedReasons).toEqual(['client']);
  });
});

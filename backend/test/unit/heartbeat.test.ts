import { afterEach, describe, expect, it, vi } from 'vitest';
import { Heartbeat } from '../../src/realtime/heartbeat.js';
import type { ConnectionRegistry } from '../../src/realtime/registry.js';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function fakeRegistry(connections: unknown[]) {
  return {
    connections: () => connections,
    detach: vi.fn(async () => undefined),
  } as unknown as ConnectionRegistry;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Heartbeat', () => {
  it('closes and detaches connections that fail their ping', () => {
    const dead = { ping: () => false, close: vi.fn() };
    const alive = { ping: () => true, close: vi.fn() };
    const registry = fakeRegistry([dead, alive]);

    const heartbeat = new Heartbeat({ registry, intervalMs: 20_000, logger: silentLogger });
    const closed = heartbeat.sweep();

    expect(closed).toBe(1);
    expect(dead.close).toHaveBeenCalledWith('dead');
    expect(alive.close).not.toHaveBeenCalled();
    expect(registry.detach).toHaveBeenCalledTimes(1);
  });

  it('uses a single shared timer', () => {
    vi.useFakeTimers();
    const registry = fakeRegistry([]);
    const heartbeat = new Heartbeat({ registry, intervalMs: 20_000, logger: silentLogger });
    const sweep = vi.spyOn(heartbeat, 'sweep');

    heartbeat.start();
    vi.advanceTimersByTime(40_000);
    expect(sweep).toHaveBeenCalledTimes(2);

    heartbeat.stop();
    vi.advanceTimersByTime(60_000);
    expect(sweep).toHaveBeenCalledTimes(2);
  });
});

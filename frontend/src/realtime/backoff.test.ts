import { describe, expect, it } from 'vitest';
import { backoffDelay } from './backoff.js';

describe('backoffDelay', () => {
  it('uses full jitter within [0, cap]', () => {
    for (const attempt of [0, 1, 2, 3, 4]) {
      const cap = 1000 * 2 ** attempt;
      expect(backoffDelay(attempt, { baseMs: 1000, maxMs: 60_000, random: () => 0 })).toBe(0);
      expect(backoffDelay(attempt, { baseMs: 1000, maxMs: 60_000, random: () => 0.999 })).toBeLessThan(
        cap,
      );
      expect(
        backoffDelay(attempt, { baseMs: 1000, maxMs: 60_000, random: () => 1 }),
      ).toBeLessThanOrEqual(cap);
    }
  });

  it('caps the delay at maxMs', () => {
    expect(backoffDelay(20, { baseMs: 1000, maxMs: 30_000, random: () => 1 })).toBeLessThanOrEqual(
      30_000,
    );
    expect(backoffDelay(3, { baseMs: 500, maxMs: 2000, random: () => 1 })).toBeLessThanOrEqual(2000);
  });

  it('is deterministic when a random source is injected', () => {
    const config = { baseMs: 1000, maxMs: 30_000, random: () => 0.5 };
    expect(backoffDelay(2, config)).toBe(backoffDelay(2, config));
    expect(backoffDelay(2, config)).toBe(2000);
  });
});

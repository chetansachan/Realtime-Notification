import { describe, expect, it } from 'vitest';
import { SequenceTracker } from './reconcile.js';

describe('SequenceTracker', () => {
  it('applies the next sequence and ignores duplicates', () => {
    const tracker = new SequenceTracker(3);

    expect(tracker.apply(4)).toEqual({ kind: 'apply' });
    expect(tracker.lastSeq).toBe(4);

    expect(tracker.apply(4)).toEqual({ kind: 'duplicate' });
    expect(tracker.apply(2)).toEqual({ kind: 'duplicate' });
    expect(tracker.lastSeq).toBe(4);
  });

  it('reports a gap without advancing until the refetch is scheduled', () => {
    const tracker = new SequenceTracker(4);

    expect(tracker.apply(7)).toEqual({ kind: 'gap', from: 5, to: 6 });
    expect(tracker.lastSeq).toBe(4);

    tracker.accept(7);
    expect(tracker.lastSeq).toBe(7);
    expect(tracker.apply(8)).toEqual({ kind: 'apply' });
  });

  it('never moves backwards when seeded from hello or session storage', () => {
    const tracker = new SequenceTracker(10);
    tracker.seed(4);
    expect(tracker.lastSeq).toBe(10);
    tracker.seed(12);
    expect(tracker.lastSeq).toBe(12);
  });

  it('treats a fresh tracker as expecting seq 1', () => {
    const tracker = new SequenceTracker();
    expect(tracker.apply(1)).toEqual({ kind: 'apply' });
    expect(tracker.apply(3)).toEqual({ kind: 'gap', from: 2, to: 2 });
  });
});

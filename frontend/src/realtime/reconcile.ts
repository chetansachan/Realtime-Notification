export type SeqDecision =
  | { kind: 'apply' }
  | { kind: 'duplicate' }
  | { kind: 'gap'; from: number; to: number };

/**
 * Per-user sequence tracking. The backend guarantees one gapless sequence per
 * user, so the client can be strict: anything at or below the cursor is a
 * replay/live overlap, anything above +1 is a gap worth a REST refetch.
 */
export class SequenceTracker {
  #last: number;

  constructor(initial = 0) {
    this.#last = Math.max(0, initial);
  }

  get lastSeq(): number {
    return this.#last;
  }

  /** Used by `hello`/session restore: never moves the cursor backwards. */
  seed(seq: number): void {
    this.#last = Math.max(this.#last, seq);
  }

  reset(seq = 0): void {
    this.#last = Math.max(0, seq);
  }

  inspect(seq: number): SeqDecision {
    if (seq <= this.#last) return { kind: 'duplicate' };
    if (seq === this.#last + 1) return { kind: 'apply' };
    return { kind: 'gap', from: this.#last + 1, to: seq - 1 };
  }

  /** Call after scheduling a refetch: the server now owns the missing range. */
  accept(seq: number): void {
    if (seq > this.#last) this.#last = seq;
  }

  apply(seq: number): SeqDecision {
    const decision = this.inspect(seq);
    if (decision.kind === 'apply') this.accept(seq);
    return decision;
  }
}

import { EventSource } from 'eventsource';

export interface RecordedEvent {
  event: string;
  data: any;
  id?: string;
}

interface RawSseEvent {
  data: string;
  lastEventId?: string;
}

interface Waiter {
  predicate: (event: RecordedEvent) => boolean;
  resolve: (event: RecordedEvent) => void;
  timer: NodeJS.Timeout;
}

const EVENT_NAMES = [
  'hello',
  'notification',
  'read',
  'read_all',
  'unread_count',
  'resync',
  'reconnect',
] as const;

/**
 * Thin wrapper over the real `eventsource` client so tests exercise the actual
 * wire protocol (ids, Last-Event-ID, reconnects) rather than a mock.
 */
export class SseTestClient {
  readonly events: RecordedEvent[] = [];
  readonly #source: any;
  #waiters: Waiter[] = [];
  #closed = false;

  private constructor(source: any) {
    this.#source = source;

    for (const name of EVENT_NAMES) {
      this.#source.addEventListener(name, (event: RawSseEvent) => {
        let data: unknown = event.data;
        try {
          data = JSON.parse(event.data);
        } catch {
          // comment lines and unknown payloads stay raw
        }
        const record: RecordedEvent = {
          event: name,
          data,
          ...(event.lastEventId ? { id: event.lastEventId } : {}),
        };
        this.events.push(record);
        this.#flush(record);
      });
    }

    this.#source.onerror = () => {
      // Tests fail on their own timeouts; reconnection is the caller's job.
    };
  }

  static async connect(url: string, timeoutMs = 8000): Promise<SseTestClient> {
    const source = new EventSource(url);
    const client = new SseTestClient(source);
    await client.waitFor((event) => event.event === 'hello', timeoutMs);
    return client;
  }

  waitFor(predicate: (event: RecordedEvent) => boolean, timeoutMs = 8000): Promise<RecordedEvent> {
    const existing = this.events.find(predicate);
    if (existing) return Promise.resolve(existing);

    return new Promise<RecordedEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiters = this.#waiters.filter((waiter) => waiter.timer !== timer);
        reject(
          new Error(
            `timed out waiting for SSE event; saw: [${this.events.map((e) => e.event).join(', ')}]`,
          ),
        );
      }, timeoutMs);
      this.#waiters.push({ predicate, resolve, timer });
    });
  }

  waitForSeq(seq: number, timeoutMs = 8000): Promise<RecordedEvent> {
    return this.waitFor(
      (event) => event.event === 'notification' && event.data?.seq === seq,
      timeoutMs,
    );
  }

  notifications(): RecordedEvent[] {
    return this.events.filter((event) => event.event === 'notification');
  }

  sequences(): number[] {
    return this.notifications().map((event) => Number(event.data.seq));
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#source.close();
  }

  get lastEventId(): string | undefined {
    return this.#source.lastEventId;
  }

  #flush(record: RecordedEvent): void {
    for (const waiter of [...this.#waiters]) {
      if (!waiter.predicate(record)) continue;
      clearTimeout(waiter.timer);
      this.#waiters = this.#waiters.filter((candidate) => candidate !== waiter);
      waiter.resolve(record);
    }
  }
}

/** Resolves once the stream is observed to be silent for `durationMs`. */
export async function expectNoEvent(
  client: SseTestClient,
  predicate: (event: RecordedEvent) => boolean,
  durationMs = 400,
): Promise<void> {
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    if (client.events.some(predicate)) throw new Error('expected no matching SSE event');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export function streamUrl(
  baseUrl: string,
  ticket: string,
  lastEventId?: number | string,
): string {
  const query = new URLSearchParams({ ticket });
  if (lastEventId !== undefined) query.set('lastEventId', String(lastEventId));
  return `${baseUrl}/v1/stream?${query.toString()}`;
}

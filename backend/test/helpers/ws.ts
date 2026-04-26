import { WebSocket } from 'ws';

interface Waiter {
  predicate: (message: any) => boolean;
  resolve: (message: any) => void;
  timer: NodeJS.Timeout;
}

export class TestWsClient {
  readonly messages: any[] = [];
  readonly #socket: WebSocket;
  #waiters: Waiter[] = [];
  #closed = false;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.on('message', (raw) => {
      let data: unknown;
      try {
        data = JSON.parse(String(raw));
      } catch {
        return;
      }
      this.messages.push(data);
      for (const waiter of [...this.#waiters]) {
        if (!waiter.predicate(data)) continue;
        clearTimeout(waiter.timer);
        this.#waiters = this.#waiters.filter((candidate) => candidate !== waiter);
        waiter.resolve(data);
      }
    });
  }

  static connect(url: string, timeoutMs = 8000): Promise<TestWsClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const client = new TestWsClient(socket);
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new Error('timed out connecting websocket'));
      }, timeoutMs);

      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      socket.once('open', () => {
        client
          .waitFor((message) => message?.type === 'hello', timeoutMs)
          .then(() => {
            clearTimeout(timer);
            resolve(client);
          })
          .catch(reject);
      });
    });
  }

  waitFor(predicate: (message: any) => boolean, timeoutMs = 8000): Promise<any> {
    const existing = this.messages.find(predicate);
    if (existing !== undefined) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiters = this.#waiters.filter((waiter) => waiter.timer !== timer);
        reject(new Error(`timed out waiting for websocket message; saw ${this.messages.length}`));
      }, timeoutMs);
      this.#waiters.push({ predicate, resolve, timer });
    });
  }

  waitForSeq(seq: number, timeoutMs = 8000): Promise<any> {
    return this.waitFor(
      (message) => message?.type === 'notification' && message?.seq === seq,
      timeoutMs,
    );
  }

  send(message: unknown): void {
    this.#socket.send(JSON.stringify(message));
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#socket.close();
  }
}

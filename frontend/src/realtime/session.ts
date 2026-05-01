import type { ApiClient } from '../lib/api.js';
import type { DemoSession } from '../lib/types.js';

export interface SessionProvider {
  getToken(): Promise<string>;
  refreshToken(): Promise<string>;
}

/**
 * The demo host's equivalent of "my backend mints a token for this user".
 * The real API key never reaches the browser; /demo/token is a server-held key.
 */
export class DemoSessionProvider implements SessionProvider {
  readonly #api: ApiClient;
  readonly #userId: string;
  #token: string | null = null;
  #expiresAt = 0;

  constructor(api: ApiClient, userId: string) {
    this.#api = api;
    this.#userId = userId;
  }

  async getToken(): Promise<string> {
    if (this.#token && Date.now() < this.#expiresAt - 60_000) return this.#token;
    return this.refreshToken();
  }

  async refreshToken(): Promise<string> {
    const session = await this.#api.post<DemoSession>('/demo/token', { userId: this.#userId });
    this.#token = session.token;
    this.#expiresAt = Date.now() + session.expiresIn * 1000;
    return session.token;
  }
}

export interface ApiErrorInit {
  status: number;
  code?: string | undefined;
  requestId?: string | undefined;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly requestId: string | undefined;

  constructor(message: string, init: ApiErrorInit) {
    super(message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  token?: string | null;
  body?: unknown;
  signal?: AbortSignal | undefined;
}

interface ProblemBody {
  detail?: string;
  code?: string;
  requestId?: string;
}

export class ApiClient {
  readonly baseUrl: string;

  constructor(baseUrl = '') {
    // '' means same origin: Vite proxies in dev, nginx in production.
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    if (options.body !== undefined) headers['content-type'] = 'application/json';

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    let payload: unknown = null;
    if (text.length > 0) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const problem = (payload ?? {}) as ProblemBody;
      throw new ApiError(problem.detail ?? `${response.status} ${response.statusText}`, {
        status: response.status,
        code: problem.code,
        requestId: problem.requestId,
      });
    }

    return payload as T;
  }

  get<T>(path: string, token?: string | null, signal?: AbortSignal): Promise<T> {
    return this.request<T>(path, { token, ...(signal ? { signal } : {}) });
  }

  post<T>(path: string, body?: unknown, token?: string | null): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, token });
  }

  put<T>(path: string, body?: unknown, token?: string | null): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body, token });
  }
}

export const api = new ApiClient(import.meta.env.VITE_API_BASE ?? '');

export function queryString(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const rendered = search.toString();
  return rendered ? `?${rendered}` : '';
}

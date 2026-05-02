import { queryString, type ApiClient } from '../../lib/api.js';
import type {
  InboxPage,
  ReadAllResult,
  ReadResult,
  UnreadCount,
} from '../../lib/types.js';

export interface HistoryParams {
  before?: string | null;
  limit?: number;
  unread?: boolean;
  category?: string;
}

export interface InboxApi {
  history(token: string, params?: HistoryParams): Promise<InboxPage>;
  unreadCount(token: string): Promise<UnreadCount>;
  markRead(token: string, id: string): Promise<ReadResult>;
  markAllRead(token: string, body?: { upToSeq?: number; category?: string }): Promise<ReadAllResult>;
  ack(token: string, id: string): Promise<void>;
}

export function createInboxApi(api: ApiClient): InboxApi {
  return {
    history(token, params = {}) {
      const search = queryString({
        before: params.before ?? undefined,
        limit: params.limit ?? 30,
        unread: params.unread ? 'true' : undefined,
        category: params.category,
      });
      return api.get<InboxPage>(`/v1/notifications${search}`, token);
    },
    unreadCount(token) {
      return api.get<UnreadCount>('/v1/notifications/unread-count', token);
    },
    markRead(token, id) {
      return api.post<ReadResult>(
        `/v1/notifications/${encodeURIComponent(id)}/read`,
        undefined,
        token,
      );
    },
    markAllRead(token, body = {}) {
      return api.post<ReadAllResult>('/v1/notifications/read-all', body, token);
    },
    async ack(token, id) {
      await api.post<unknown>(`/v1/notifications/${encodeURIComponent(id)}/ack`, undefined, token);
    },
  };
}

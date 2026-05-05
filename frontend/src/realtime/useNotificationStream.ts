import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ApiClient } from '../lib/api.js';
import { announce, announceNotifications, announceUrgent } from '../lib/a11y/announcer.js';
import { createInboxApi, type InboxApi } from '../features/inbox/api.js';
import { inboxKeys } from '../features/inbox/keys.js';
import {
  clearItemsInCache,
  insertNotification,
  markAllReadInCache,
  markReadInCache,
  removeFromCache,
  type InboxData,
} from '../features/inbox/optimistic.js';
import { useToastStore } from '../sdk/toast-store.js';
import { StreamClient } from './client.js';
import type { StreamEvent } from './events.js';
import { SequenceTracker } from './reconcile.js';
import type { SessionProvider } from './session.js';
import { useRealtimeStore } from './store.js';

const STORAGE_PREFIX = 'ntf:lastSeq';

function storageKey(appId: string, userId: string): string {
  return `${STORAGE_PREFIX}:${appId}:${userId}`;
}

function readStoredSeq(key: string): number {
  try {
    const raw = sessionStorage.getItem(key);
    const value = raw === null ? 0 : Number(raw);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function writeStoredSeq(key: string, seq: number): void {
  try {
    sessionStorage.setItem(key, String(seq));
  } catch {
    // Storage can be unavailable (private mode); replay from hello/REST instead.
  }
}

function newEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export interface UseNotificationStreamOptions {
  api: ApiClient;
  session: SessionProvider;
  appId: string;
  userId: string;
  autoConnect?: boolean;
}

export interface StreamController {
  connect: () => void;
  disconnect: () => void;
  drop: () => void;
  simulateOffline: (ms: number) => void;
}

/**
 * The bridge: stream events never render anything themselves. They advance the
 * sequence cursor, write into the Query cache, and update the store. The server
 * remains authoritative for unread counts, so a notification triggers a refetch
 * rather than an optimistic +1.
 */
export function useNotificationStream(options: UseNotificationStreamOptions): StreamController {
  const { api, session, appId, userId } = options;
  const queryClient = useQueryClient();
  const clientRef = useRef<StreamClient | null>(null);
  const tracker = useRef(new SequenceTracker());
  const inboxApiRef = useRef<InboxApi>(createInboxApi(api));

  useEffect(() => {
    inboxApiRef.current = createInboxApi(api);
  }, [api]);

  const key = storageKey(appId, userId);

  const unreadKey = inboxKeys.unread(appId, userId);
  const allKey = inboxKeys.list(appId, userId, 'all');
  const unreadListKey = inboxKeys.list(appId, userId, 'unread');

  const setUnreadEverywhere = useCallback(
    (count: number) => {
      useRealtimeStore.getState().setUnread(count);
      queryClient.setQueryData(unreadKey, { unreadCount: count });
    },
    [queryClient, unreadKey],
  );

  const refreshUnread = useCallback(async () => {
    try {
      const token = await session.getToken();
      const result = await inboxApiRef.current.unreadCount(token);
      setUnreadEverywhere(result.unreadCount);
    } catch {
      // Transient: the next event or reconnect will retry.
    }
  }, [session, setUnreadEverywhere]);

  const handleEvent = useCallback(
    (event: StreamEvent) => {
      const store = useRealtimeStore.getState();
      const log = (kind: string, label: string, detail?: string, seq?: number) => {
        store.logEvent({
          id: newEventId(),
          at: Date.now(),
          kind,
          label,
          ...(seq === undefined ? {} : { seq }),
          ...(detail ? { detail } : {}),
        });
      };

      switch (event.type) {
        case 'hello': {
          store.setInstance(event.instanceId);
          store.setResumeFrom(event.resumeFrom);
          setUnreadEverywhere(event.unreadCount);
          tracker.current.seed(event.resumeFrom);
          const isResume = event.resumeFrom > 0;
          log(isResume ? 'reconnected' : 'hello', `connected to ${event.instanceId}`, `server lastSeq ${event.lastSeq}`, event.lastSeq);

          if (event.lastSeq > tracker.current.lastSeq) {
            // We are behind the server (fresh tab or a long disconnect).
            void queryClient.invalidateQueries({ queryKey: inboxKeys.all(appId, userId) });
          }
          tracker.current.seed(event.lastSeq);
          useRealtimeStore.getState().setLastSeq(tracker.current.lastSeq);
          writeStoredSeq(key, tracker.current.lastSeq);
          break;
        }

        case 'notification': {
          const decision = tracker.current.inspect(event.seq);

          if (decision.kind === 'duplicate') {
            log('duplicate', `seq ${event.seq} ignored`, 'already applied');
            return;
          }

          tracker.current.accept(event.seq);
          useRealtimeStore.getState().setLastSeq(tracker.current.lastSeq);
          writeStoredSeq(key, tracker.current.lastSeq);

          if (decision.kind === 'gap') {
            log('gap', `missed ${decision.from}–${decision.to}`, undefined, event.seq);
            announce('Notifications arrived out of order. Reloading the inbox.');
            void queryClient.invalidateQueries({ queryKey: inboxKeys.all(appId, userId) });
            void refreshUnread();
            return;
          }

          log('notification', event.payload.title, `seq ${event.seq}`, event.seq);
          queryClient.setQueryData<InboxData>(allKey, (data) =>
            insertNotification(data, event.payload),
          );
          queryClient.setQueryData<InboxData>(unreadListKey, (data) =>
            insertNotification(data, { ...event.payload, readAt: null }),
          );

          // The event carries no unread count, and the server's counter is truth.
          void refreshUnread();
          announceNotifications(1);

          if (!useRealtimeStore.getState().inboxOpen) {
            useToastStore.getState().push({
              kind: 'notification',
              title: event.payload.title,
              ...(event.payload.body ? { body: event.payload.body } : {}),
            });
          }

          // Delivery ack is best-effort telemetry, never UI-blocking.
          void (async () => {
            try {
              const token = await session.getToken();
              await inboxApiRef.current.ack(token, event.payload.id);
            } catch {
              // ignore
            }
          })();
          break;
        }

        case 'read': {
          log('read', 'marked one read', `unread ${event.unreadCount}`);
          queryClient.setQueryData<InboxData>(allKey, (data) =>
            markReadInCache(data, event.notificationId),
          );
          queryClient.setQueryData<InboxData>(unreadListKey, (data) =>
            removeFromCache(data, event.notificationId),
          );
          setUnreadEverywhere(event.unreadCount);
          break;
        }

        case 'read_all': {
          log('read_all', 'marked all read', `unread ${event.unreadCount}`);
          queryClient.setQueryData<InboxData>(allKey, (data) => markAllReadInCache(data));
          queryClient.setQueryData<InboxData>(unreadListKey, (data) => clearItemsInCache(data));
          setUnreadEverywhere(event.unreadCount);
          announce('All notifications marked as read');
          break;
        }

        case 'unread_count': {
          setUnreadEverywhere(event.unreadCount);
          break;
        }

        case 'resync': {
          log('resync', 'server asked for a resync', event.reason);
          announce('Inbox refreshed after a resync');
          void queryClient.invalidateQueries({ queryKey: inboxKeys.all(appId, userId) });
          void refreshUnread();
          break;
        }

        case 'reconnect': {
          log('reconnect', 'server is shutting down', `${event.retryAfterMs}ms`);
          break;
        }
      }
    },
    [
      allKey,
      appId,
      key,
      queryClient,
      refreshUnread,
      session,
      setUnreadEverywhere,
      unreadListKey,
      userId,
    ],
  );

  useEffect(() => {
    useRealtimeStore.getState().reset();
    const stored = readStoredSeq(key);
    tracker.current.reset(stored);
    useRealtimeStore.getState().setLastSeq(stored);

    // React StrictMode mounts effects twice in development. A stale client must
    // never write state while the replacement connects.
    let active = true;

    const client = new StreamClient({
      baseUrl: api.baseUrl,
      initialLastSeq: stored,
      getToken: () => session.getToken(),
      refreshToken: () => session.refreshToken(),
      onEvent: (event) => {
        if (!active) return;
        handleEvent(event);
      },
      onStateChange: (update) => {
        if (!active) return;
        const store = useRealtimeStore.getState();
        const previous = store.status;
        store.setStatus(update.status);
        store.setRetry(update.nextRetryAt, update.retryDelayMs);

        if (update.status === previous) return;
        if (update.status === 'live') announce('Notifications live');
        else if (update.status === 'offline') {
          announce('Notifications offline. Reconnecting when the network returns.');
        } else if (update.status === 'reconnecting' && previous === 'live') {
          announce('Reconnecting to notifications');
        } else if (update.status === 'unauthorized') {
          announceUrgent('Session expired. Sign in again to see new notifications.');
        }
      },
    });

    clientRef.current = client;
    if (options.autoConnect ?? true) client.connect();
    void refreshUnread();

    return () => {
      active = false;
      client.disconnect();
      if (clientRef.current === client) clientRef.current = null;
    };
  }, [api, handleEvent, key, options.autoConnect, refreshUnread, session]);

  const connect = useCallback(() => {
    clientRef.current?.reconnectNow();
    clientRef.current?.connect();
  }, []);

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
  }, []);

  const drop = useCallback(() => {
    clientRef.current?.drop();
  }, []);

  const simulateOffline = useCallback((ms: number) => {
    clientRef.current?.simulateOffline(ms);
  }, []);

  return { connect, disconnect, drop, simulateOffline };
}

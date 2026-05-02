// [initial module draft]
import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import { ApiClient } from '../lib/api.js';
import { useNotificationStream } from '../realtime/useNotificationStream.js';
import { DemoSessionProvider, type SessionProvider } from '../realtime/session.js';
import type { StreamClient } from '../realtime/client.js';

export interface NotificationContextValue {
  appId: string;
  userId: string;
  api: ApiClient;
  session: SessionProvider;
  client: StreamClient | null;
  connect: () => void;
  disconnect: () => void;
  drop: () => void;
  simulateOffline: (ms: number) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export interface NotificationProviderProps {
  userId: string;
  appId?: string;
  apiBase?: string;
  /** Override for a real host app; defaults to the demo token route. */
  session?: SessionProvider;
  autoConnect?: boolean;
  children: ReactNode;
}

export function NotificationProvider({
  userId,
  appId = 'demo',
  apiBase,
  session,
  autoConnect = true,
  children,
}: NotificationProviderProps) {
  const api = useMemo(
    () => new ApiClient(apiBase ?? import.meta.env.VITE_API_BASE ?? ''),
    [apiBase],
  );

  const activeSession = useMemo(
    () => session ?? new DemoSessionProvider(api, userId),
    [session, api, userId],
  );

  const { connect, disconnect, drop, simulateOffline } = useNotificationStream({
    api,
    session: activeSession,
    appId,
    userId,
    autoConnect,
  });

  const value = useMemo<NotificationContextValue>(
    () => ({
      appId,
      userId,
      api,
      session: activeSession,
      client: null,
      connect,
      disconnect,
      drop,
      simulateOffline,
    }),
    [appId, userId, api, activeSession, connect, disconnect, drop, simulateOffline],
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications(): NotificationContextValue {
  const value = useContext(NotificationContext);
  if (!value) {
    throw new Error('useNotifications must be used inside a NotificationProvider');
  }
  return value;
}

import { create } from 'zustand';

export type StreamStatus =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'offline'
  | 'unauthorized';

export interface LoggedEvent {
  id: string;
  at: number;
  kind: string;
  label: string;
  seq?: number;
  detail?: string;
}

export interface RealtimeState {
  status: StreamStatus;
  lastSeq: number;
  unreadCount: number;
  instanceId: string | null;
  lastEventAt: number | null;
  nextRetryAt: number | null;
  retryDelayMs: number | null;
  resumeFrom: number | null;
  inboxOpen: boolean;
  events: LoggedEvent[];

  setStatus: (status: StreamStatus) => void;
  setRetry: (nextRetryAt: number | null, retryDelayMs: number | null) => void;
  setLastSeq: (seq: number) => void;
  setUnread: (count: number) => void;
  setInstance: (instanceId: string) => void;
  setResumeFrom: (seq: number) => void;
  setInboxOpen: (open: boolean) => void;
  logEvent: (event: LoggedEvent) => void;
  reset: () => void;
}

const MAX_EVENTS = 200;

const initial = {
  status: 'idle' as StreamStatus,
  lastSeq: 0,
  unreadCount: 0,
  instanceId: null as string | null,
  lastEventAt: null as number | null,
  nextRetryAt: null as number | null,
  retryDelayMs: null as number | null,
  resumeFrom: null as number | null,
  inboxOpen: false,
  events: [] as LoggedEvent[],
};

export const useRealtimeStore = create<RealtimeState>()((set) => ({
  ...initial,

  setStatus: (status) =>
    set((state) => ({
      status,
      ...(status === 'live' ? { nextRetryAt: null, retryDelayMs: null } : {}),
      lastEventAt: status === 'live' ? Date.now() : state.lastEventAt,
    })),

  setRetry: (nextRetryAt, retryDelayMs) => set({ nextRetryAt, retryDelayMs }),

  setLastSeq: (lastSeq) =>
    set((state) => (lastSeq > state.lastSeq ? { lastSeq } : {})),

  setUnread: (unreadCount) => set({ unreadCount: Math.max(0, unreadCount) }),

  setInstance: (instanceId) => set({ instanceId }),

  setResumeFrom: (resumeFrom) => set({ resumeFrom }),

  setInboxOpen: (inboxOpen) => set({ inboxOpen }),

  logEvent: (event) =>
    set((state) => ({ events: [event, ...state.events].slice(0, MAX_EVENTS) })),

  reset: () => set({ ...initial, events: [] }),
}));

export function resetRealtimeStore(): void {
  useRealtimeStore.getState().reset();
}

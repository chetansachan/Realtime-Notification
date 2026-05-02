import { create } from 'zustand';

export interface Toast {
  id: string;
  kind: 'notification' | 'error' | 'info';
  title: string;
  body?: string;
  count: number;
  createdAt: number;
}

export interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id' | 'createdAt' | 'count'> & { count?: number }) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Errors survive the three-toast cap; the oldest non-error is evicted first. */
function trim(list: Toast[]): Toast[] {
  if (list.length <= 3) return list;
  const oldestNonError = [...list]
    .map((toast, index) => ({ toast, index }))
    .reverse()
    .find(({ toast }) => toast.kind !== 'error');
  if (!oldestNonError) return list.slice(0, 3);
  return list.filter((_, index) => index !== oldestNonError.index);
}

/**
 * A burst must never produce seven stacked toasts. Notification toasts that
 * arrive close together coalesce into one "N new notifications" card.
 */
export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],

  push: (input) =>
    set((state) => {
      const now = Date.now();
      if (input.kind === 'notification') {
        const recent = state.toasts.find(
          (toast) => toast.kind === 'notification' && now - toast.createdAt < 700,
        );
        if (recent) {
          const count = recent.count + (input.count ?? 1);
          return {
            toasts: state.toasts.map((toast) =>
              toast.id === recent.id
                ? {
                    ...toast,
                    count,
                    title: count === 1 ? input.title : `${count} new notifications`,
                  }
                : toast,
            ),
          };
        }
      }

      const toast: Toast = {
        ...input,
        id: newId(),
        count: input.count ?? 1,
        createdAt: now,
      };
      return { toasts: trim([toast, ...state.toasts]) };
    }),

  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),

  clear: () => set({ toasts: [] }),
}));

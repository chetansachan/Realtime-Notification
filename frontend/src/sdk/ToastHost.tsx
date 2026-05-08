import { useEffect, useState } from 'react';
import { useToastStore, type Toast } from './toast-store.js';
import { XIcon } from '../components/icons.js';

const AUTO_DISMISS_MS = 6000;

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [paused, onDismiss]);

  const isError = toast.kind === 'error';

  return (
    <div
      className={`toast ${
        isError
          ? 'border-[#ef4444]/40 bg-[#160b0b] shadow-[0_12px_36px_rgba(239,68,68,0.15)]'
          : 'border-[#27272a] bg-[#111113] shadow-[0_16px_40px_rgba(0,0,0,0.8)]'
      }`}
      role="group"
      aria-label={isError ? 'Error notification' : 'New notification'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onDismiss();
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${
              isError ? 'bg-[#ef4444] shadow-[0_0_8px_#ef4444]' : 'bg-[#22c55e] shadow-[0_0_8px_#22c55e]'
            }`}
          />
          <p className="toast-title font-semibold text-[#f2f2f2]">{toast.title}</p>
        </div>
        <button
          type="button"
          className="btn btn-sm btn-ghost p-1 text-[#a1a1aa] hover:text-[#f2f2f2]"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          style={{ minHeight: 22, padding: '0 4px' }}
        >
          <XIcon width={13} height={13} />
        </button>
      </div>
      {toast.body ? <p className="toast-body text-xs text-[#a1a1aa] pl-4">{toast.body}</p> : null}
    </div>
  );
}

export function ToastHost() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-host" role="region" aria-label="Notifications Live Feed">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
      ))}
    </div>
  );
}

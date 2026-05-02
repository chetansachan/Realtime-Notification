import { useEffect, useState } from 'react';
import { useNotifications } from './NotificationProvider.js';
import { useRealtimeStore } from '../realtime/store.js';
import { Button } from '../components/ui/Button.js';

const LABELS: Record<string, string> = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  live: 'Live Stream',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
  unauthorized: 'Session expired',
};

/**
 * Design Notification Service - Connection Status Pill
 *
 * Rules:
 * - Status is always represented by both visual icon/dot AND descriptive text (never color alone).
 * - Target: WCAG 2.2 AA.
 * - Countdown updates at most once per second and is not spam-announced to screen readers.
 */
export function ConnectionPill({ className }: { className?: string }) {
  const status = useRealtimeStore((state) => state.status);
  const nextRetryAt = useRealtimeStore((state) => state.nextRetryAt);
  const instanceId = useRealtimeStore((state) => state.instanceId);
  const lastEventAt = useRealtimeStore((state) => state.lastEventAt);
  const { connect } = useNotifications();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (status !== 'reconnecting' || !nextRetryAt) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [status, nextRetryAt]);

  const secondsLeft = nextRetryAt ? Math.max(0, Math.ceil((nextRetryAt - now) / 1000)) : null;
  const label =
    status === 'reconnecting' && secondsLeft !== null
      ? `Reconnecting in ${secondsLeft}s`
      : (LABELS[status] ?? status);

  const canRetry = status === 'reconnecting' || status === 'offline' || status === 'unauthorized';
  const detail = [
    instanceId ? `Instance: ${instanceId}` : null,
    lastEventAt ? `Last Event: ${new Date(lastEventAt).toLocaleTimeString()}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={className}>
      <span
        className="pill border border-[#27272a] bg-[#0c0a09] text-xs text-[#a1a1aa]"
        title={detail || undefined}
      >
        <span className="status-dot" data-status={status} aria-hidden="true" />
        <span className="font-mono text-[11px] text-[#f2f2f2]">{label}</span>
        {canRetry ? (
          <Button size="sm" className="ml-1 py-0 h-5 text-[10px]" onClick={connect}>
            Retry Now
          </Button>
        ) : null}
      </span>
    </div>
  );
}

import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useShallow } from 'zustand/react/shallow';
import { NotificationProvider, useNotifications } from '../sdk/NotificationProvider.js';
import { Bell } from '../sdk/Bell.js';
import { InboxPanel } from '../sdk/InboxPanel.js';
import { ConnectionPill } from '../sdk/ConnectionPill.js';
import { PipelineDiagram } from '../components/motion/PipelineDiagram.js';
import { Button } from '../components/ui/Button.js';
import { useRealtimeStore, type LoggedEvent } from '../realtime/store.js';
import { formatClock } from '../lib/format.js';
import { ApiError } from '../lib/api.js';
import type { NotifyResult } from '../lib/types.js';

const STATUS_LABEL: Record<string, string> = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  live: 'Live Stream',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
  unauthorized: 'Session expired',
};

const PRESET_USERS = ['user-42', 'alice-eng', 'bob-ops', 'charlie-lead'] as const;

const PRESET_TEMPLATES = [
  {
    title: 'Invoice Paid',
    body: 'Invoice #94821 of $1,450 has been settled successfully via Stripe.',
    category: 'billing',
  },
  {
    title: 'Deploy Completed',
    body: 'Release v2.4.0 deployed to production cluster across 4 regions.',
    category: 'ops',
  },
  {
    title: 'Security Notice',
    body: 'New login detected from IP 192.168.1.100 via API Key ntf_live_***.',
    category: 'security',
  },
  {
    title: 'Pull Request Approved',
    body: 'PR #128 "feat: monotonic sequence allocation" approved by lead reviewer.',
    category: 'team',
  },
] as const;

function StateStrip() {
  const { status, lastSeq, unreadCount, instanceId, retryDelayMs } = useRealtimeStore(
    useShallow((state) => ({
      status: state.status,
      lastSeq: state.lastSeq,
      unreadCount: state.unreadCount,
      instanceId: state.instanceId,
      retryDelayMs: state.retryDelayMs,
    })),
  );

  return (
    <dl className="grid grid-cols-2 gap-2.5 rounded-[6px] border border-[#27272a] bg-[#000000] p-3 text-xs">
      <div>
        <dt className="text-[11px] font-mono text-[#a1a1aa] uppercase">Stream Status</dt>
        <dd className="mt-0.5 flex items-center gap-1.5 font-mono text-[#f2f2f2]">
          <span className="status-dot" data-status={status} />
          <span>{STATUS_LABEL[status] ?? status}</span>
        </dd>
      </div>

      <div>
        <dt className="text-[11px] font-mono text-[#a1a1aa] uppercase">Monotonic Sequence</dt>
        <dd className="mt-0.5 font-mono font-semibold text-[#22c55e] tnum">
          {lastSeq}
        </dd>
      </div>

      <div>
        <dt className="text-[11px] font-mono text-[#a1a1aa] uppercase">Server Unread Count</dt>
        <dd className="mt-0.5 font-mono text-[#f2f2f2] tnum">{unreadCount}</dd>
      </div>

      <div>
        <dt className="text-[11px] font-mono text-[#a1a1aa] uppercase">Serving Instance</dt>
        <dd className="mt-0.5 font-mono text-[#a1a1aa] truncate">{instanceId ?? 'Auto'}</dd>
      </div>

      <div className="col-span-2 border-t border-[#27272a]/60 pt-2">
        <dt className="text-[11px] font-mono text-[#a1a1aa] uppercase">Backoff Next Delay</dt>
        <dd className="mt-0.5 font-mono text-[#a1a1aa] tnum">
          {retryDelayMs === null ? '0ms (Active or Clean Disconnect)' : `${retryDelayMs}ms with full jitter`}
        </dd>
      </div>
    </dl>
  );
}

const FILTERS = ['all', 'notification', 'control'] as const;
type Filter = (typeof FILTERS)[number];

function EventLog() {
  const events = useRealtimeStore((state) => state.events);
  const [filter, setFilter] = useState<Filter>('all');

  const visible = events.filter((event) => {
    if (filter === 'all') return true;
    if (filter === 'notification') return event.kind === 'notification';
    return event.kind !== 'notification';
  });

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-1 border-b border-[#27272a] pb-2">
        <div className="flex gap-1" role="group" aria-label="Filter event stream log">
          {FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              className={`btn btn-sm rounded-[4px] text-[11px] ${
                filter === value
                  ? 'bg-[#18181b] border-[#3f3f46] text-[#22c55e]'
                  : 'border-transparent text-[#a1a1aa] hover:text-[#f2f2f2]'
              }`}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value.toUpperCase()}
            </button>
          ))}
        </div>

        <span className="font-mono text-[11px] text-[#a1a1aa]">
          {visible.length} event{visible.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="event-log" role="log" aria-label="Stream events, newest first">
        {visible.length === 0 ? (
          <p className="p-3 text-xs text-[#a1a1aa]">
            No stream events recorded yet. Connect and send a notification.
          </p>
        ) : (
          visible.map((event: LoggedEvent) => (
            <div key={event.id} className="event-log-row text-[11px]" data-kind={event.kind}>
              <span className="font-mono text-[#a1a1aa]">{formatClock(event.at)}</span>
              <span className="font-mono font-medium">{event.kind}</span>
              <span className="font-mono text-[#22c55e] tnum">
                {event.seq !== null ? `#${event.seq}` : '—'}
              </span>
              <span
                className="truncate text-[#f2f2f2]"
                title={event.detail ? `${event.label} · ${event.detail}` : event.label}
              >
                {event.label}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function PlaygroundContent({ user }: { user: string }) {
  const { api, connect, disconnect, drop, simulateOffline } = useNotifications();
  const status = useRealtimeStore((state) => state.status);
  const lastSeq = useRealtimeStore((state) => state.lastSeq);
  const navigate = useNavigate({ from: '/playground' });

  const [userInput, setUserInput] = useState(user);
  const [title, setTitle] = useState('Invoice Paid');
  const [body, setBody] = useState('Your March invoice #94821 of $1,450 was paid.');
  const [category, setCategory] = useState('billing');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [runId, setRunId] = useState(0);

  const connected = status === 'live' || status === 'connecting' || status === 'reconnecting';

  async function sendBatch(count: number) {
    setSending(true);
    setSendError(null);
    try {
      for (let index = 0; index < count; index += 1) {
        await api.post<NotifyResult>('/demo/notify', {
          userId: user,
          title: count === 1 ? title : `${title} (${index + 1}/${count})`,
          ...(body ? { body } : {}),
          category,
        });
      }
      setRunId((value) => value + 1);
    } catch (error) {
      setSendError(
        error instanceof ApiError
          ? `${error.status}: ${error.message}`
          : error instanceof Error
            ? error.message
            : 'Send failed',
      );
    } finally {
      setSending(false);
    }
  }

  function switchUser(targetUser: string) {
    const next = targetUser.trim();
    if (!next || next === user) return;
    setUserInput(next);
    void navigate({ search: { user: next }, replace: true });
  }

  function handleUserSubmit(event: FormEvent) {
    event.preventDefault();
    switchUser(userInput);
  }

  const sendDisabled = sending || !user;

  return (
    <div className="min-h-dvh bg-[#000000] text-[#f2f2f2]">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 py-6 sm:px-6">
        {/* Mission Control Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-[8px] border border-[#27272a] bg-[#0c0a09] p-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-[#22c55e] shadow-[0_0_8px_#22c55e]" />
              <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#22c55e]">
                Live Engineering Console
              </span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-[#f2f2f2]">
              Watch a notification travel
            </h1>
            <p className="max-w-[700px] text-xs leading-relaxed text-[#a1a1aa]">
              Simulate subscriber connections, observe monotonic sequence allocation in PostgreSQL,
              induce network drops, and watch gapless replay catch up cleanly.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <ConnectionPill />
            <Bell />
          </div>
        </header>

        {/* 3-Column Technical Grid */}
        <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)_360px]">
          {/* Column 1: Connection & Dispatch Controls */}
          <section className="flex flex-col gap-4 rounded-[8px] border border-[#27272a] bg-[#0c0a09] p-4">
            <div>
              <h2 className="text-xs font-mono font-semibold uppercase tracking-wider text-[#a1a1aa]">
                Subscriber Identity
              </h2>

              <form className="mt-2.5 field" onSubmit={handleUserSubmit}>
                <label htmlFor="playground-user">Active User ID</label>
                <input
                  id="playground-user"
                  value={userInput}
                  onChange={(event) => setUserInput(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="e.g. user-42"
                />

                <div className="mt-1 flex flex-wrap gap-1">
                  {PRESET_USERS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => switchUser(preset)}
                      className={`btn btn-sm rounded-[4px] text-[10px] font-mono ${
                        user === preset
                          ? 'border-[#22c55e] bg-[#22c55e]/10 text-[#22c55e]'
                          : 'border-[#27272a] bg-[#111113] text-[#a1a1aa]'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>

                <div className="mt-2 flex gap-2">
                  <Button size="sm" type="submit" disabled={connected}>
                    Switch User
                  </Button>
                  {connected ? (
                    <Button size="sm" onClick={disconnect}>
                      Disconnect
                    </Button>
                  ) : (
                    <Button size="sm" variant="primary" onClick={connect}>
                      Connect SSE
                    </Button>
                  )}
                </div>
              </form>
            </div>

            {/* Failure Injection Suite */}
            <div className="border-t border-[#27272a] pt-3.5">
              <h2 className="text-xs font-mono font-semibold uppercase tracking-wider text-[#ef4444]">
                Failure Injection &amp; Replay Lab
              </h2>
              <div className="mt-2.5 grid gap-2">
                <Button size="sm" onClick={() => drop()} disabled={!connected}>
                  Drop Connection (Sever TCP)
                </Button>
                <Button
                  size="sm"
                  onClick={() => simulateOffline(10_000)}
                  disabled={!connected}
                >
                  Go Offline for 10s
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    simulateOffline(10_000);
                    void sendBatch(5);
                  }}
                  disabled={sendDisabled}
                >
                  Go offline + send 5
                </Button>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-[#a1a1aa]">
                Simulate tunnel drop: events written while offline commit durably to Postgres. On reconnect,
                the client provides its Last-Event-ID and receives the missed 5 gapless.
              </p>
            </div>

            {/* Notification Dispatch Form */}
            <div className="border-t border-[#27272a] pt-3.5">
              <h2 className="text-xs font-mono font-semibold uppercase tracking-wider text-[#a1a1aa]">
                Ingest Simulator (Host App API)
              </h2>

              <div className="mt-2 flex flex-wrap gap-1">
                {PRESET_TEMPLATES.map((tmpl) => (
                  <button
                    key={tmpl.title}
                    type="button"
                    onClick={() => {
                      setTitle(tmpl.title);
                      setBody(tmpl.body);
                      setCategory(tmpl.category);
                    }}
                    className="btn btn-sm rounded-[4px] text-[10px] text-[#a1a1aa] hover:text-[#f2f2f2]"
                  >
                    {tmpl.title}
                  </button>
                ))}
              </div>

              <form
                className="mt-2.5 field"
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendBatch(1);
                }}
              >
                <div>
                  <label htmlFor="notify-title">Title</label>
                  <input
                    id="notify-title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    maxLength={200}
                    required
                  />
                </div>

                <div>
                  <label htmlFor="notify-body">Body</label>
                  <textarea
                    id="notify-body"
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    rows={2}
                    maxLength={2000}
                  />
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  loading={sending}
                  disabled={sendDisabled}
                  className="mt-1"
                >
                  Send to {user}
                </Button>

                {sendError ? (
                  <p className="error text-xs" role="alert">
                    {sendError}
                  </p>
                ) : null}
              </form>
            </div>

            {/* Multi-Tab Sync Note */}
            <div className="border-t border-[#27272a] pt-3">
              <Button
                size="sm"
                className="w-full"
                onClick={() => {
                  window.open(window.location.href, '_blank', 'noopener');
                }}
              >
                Spawn Second Tab (Cross-Instance Test)
              </Button>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[#a1a1aa]">
                Both tabs subscribe to the same Redis channel. If Nginx balances them to different API
                replicas, both tabs still update synchronously.
              </p>
            </div>
          </section>

          {/* Column 2: Pipeline Diagram & Inbox Panel */}
          <section className="flex flex-col gap-4">
            <PipelineDiagram runId={runId} lastSeq={lastSeq} />

            <div className="rounded-[8px] border border-[#27272a] bg-[#0c0a09] p-4">
              <div className="mb-3 flex items-center justify-between border-b border-[#27272a] pb-2">
                <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#a1a1aa]">
                  Integrated Inbox Surface
                </span>
                <span className="text-[11px] font-mono text-[#22c55e]">
                  Active Subscriber Feed
                </span>
              </div>
              <div className="max-w-[440px]">
                <InboxPanel variant="inline" />
              </div>
            </div>
          </section>

          {/* Column 3: Real-Time Telemetry & Event Log */}
          <section className="flex flex-col gap-4 rounded-[8px] border border-[#27272a] bg-[#0c0a09] p-4">
            <div>
              <h2 className="mb-2 text-xs font-mono font-semibold uppercase tracking-wider text-[#a1a1aa]">
                Stream Telemetry
              </h2>
              <StateStrip />
            </div>

            <div className="border-t border-[#27272a] pt-3.5">
              <h2 className="mb-2 text-xs font-mono font-semibold uppercase tracking-wider text-[#a1a1aa]">
                Raw Event Stream
              </h2>
              <EventLog />
            </div>

            {lastSeq > 0 ? (
              <div className="rounded-[6px] border border-[#27272a] bg-[#000000] p-2.5 text-[11px] leading-relaxed text-[#a1a1aa]">
                <span className="font-semibold text-[#22c55e]">Monotonic Guard:</span> Sequence #{lastSeq} confirmed in PostgreSQL.
                Late duplicates with seq &le; {lastSeq} are ignored deterministically.
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

export function PlaygroundPage() {
  const search = useSearch({ from: '/playground' });
  const user = useMemo(() => search.user, [search.user]);

  return (
    <NotificationProvider userId={user} autoConnect>
      <PlaygroundContent user={user} />
    </NotificationProvider>
  );
}

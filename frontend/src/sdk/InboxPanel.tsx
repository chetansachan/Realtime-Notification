// [initial module draft]
import { useLayoutEffect, useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { useInbox, useMarkAllRead, useMarkRead } from '../features/inbox/queries.js';
import { useRealtimeStore } from '../realtime/store.js';
import { useNotifications } from './NotificationProvider.js';
import { NotificationItem } from './NotificationItem.js';
import { ConnectionPill } from './ConnectionPill.js';
import { PreferencesPanel } from './PreferencesPanel.js';
import { Button } from '../components/ui/Button.js';
import { BackIcon, RefreshIcon, SettingsIcon } from '../components/icons.js';
import { motion } from '../motion/tokens.js';
import { Flip } from '../motion/gsap.js';
import { useReducedMotion } from '../motion/useReducedMotion.js';
import { ApiError } from '../lib/api.js';

function Skeleton() {
  return (
    <div aria-hidden="true" className="grid gap-2">
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          className="h-[84px] animate-pulse rounded-[6px] border border-[#27272a] bg-[#111113]"
        />
      ))}
    </div>
  );
}

export function InboxPanel({ variant = 'popover' }: { variant?: 'popover' | 'inline' }) {
  const { connect } = useNotifications();
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [view, setView] = useState<'inbox' | 'preferences'>('inbox');
  const [newCount, setNewCount] = useState(0);
  const reduced = useReducedMotion();

  const inbox = useInbox(tab);
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();
  const unreadCount = useRealtimeStore((state) => state.unreadCount);

  const scrollRef = useRef<HTMLDivElement>(null);
  const flipState = useRef<Flip.FlipState | null>(null);
  const previousCount = useRef(0);
  const previousScrollHeight = useRef(0);
  const burst = useRef({ at: 0, added: 0 });

  const items = inbox.data?.pages.flatMap((page) => page.items) ?? [];

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const added = items.length - previousCount.current;

    // Preserve the reader's scroll position when items are prepended.
    if (added > 0 && previousScrollHeight.current > 0 && element.scrollTop > 8) {
      element.scrollTop += element.scrollHeight - previousScrollHeight.current;
      setNewCount((count) => count + added);
    } else if (added > 0) {
      setNewCount(0);
    }

    // GSAP Flip animation for layout transitions
    const nodes = Array.from(element.querySelectorAll<HTMLElement>('[data-flip-id]'));
    if (!reduced && flipState.current && nodes.length > 0 && added > 0) {
      const now = Date.now();
      if (now - burst.current.at > 500) burst.current = { at: now, added: 0 };
      burst.current.added += added;
      if (burst.current.added <= 5) {
        try {
          Flip.from(flipState.current, {
            duration: motion.normal,
            ease: motion.ease.standard,
            nested: true,
          });
        } catch {
          // Flip failure must never break the notification list
        }
      }
    }
    flipState.current = nodes.length > 0 ? Flip.getState(nodes) : null;
    previousCount.current = items.length;
    previousScrollHeight.current = element.scrollHeight;
  }, [items.length, reduced]);

  const loading = inbox.isPending;
  const error = inbox.error instanceof ApiError ? inbox.error : null;
  const pendingId = markRead.isPending ? markRead.variables : undefined;

  function refresh() {
    void inbox.refetch();
    connect();
  }

  return (
    <section
      className="inbox-panel border border-[#27272a] bg-[#0c0a09] text-[#f2f2f2]"
      data-inline={variant === 'inline'}
      aria-label="Notification Center"
    >
      <header className="flex flex-col gap-2.5 border-b border-[#27272a] bg-[#0c0a09] px-4 pb-3 pt-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {view === 'preferences' ? (
              <button
                type="button"
                className="btn btn-sm btn-ghost p-1"
                onClick={() => setView('inbox')}
                aria-label="Back to notifications"
              >
                <BackIcon width={14} height={14} />
              </button>
            ) : null}
            <h2 className="text-sm font-semibold tracking-tight text-[#f2f2f2]">
              {view === 'inbox' ? 'Notification Center' : 'Notification Preferences'}
            </h2>
            {view === 'inbox' && unreadCount > 0 ? (
              <span className="rounded-[4px] border border-[#22c55e]/40 bg-[#22c55e]/15 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-[#22c55e]">
                {unreadCount} unread
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5">
            {view === 'inbox' ? (
              <>
                <Button
                  size="sm"
                  onClick={() => markAllRead.mutate()}
                  disabled={unreadCount === 0 || markAllRead.isPending}
                  loading={markAllRead.isPending}
                >
                  Mark all read
                </Button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost p-1.5 text-[#a1a1aa] hover:text-[#f2f2f2]"
                  onClick={() => setView('preferences')}
                  aria-label="Notification preferences"
                >
                  <SettingsIcon width={15} height={15} />
                </button>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 text-xs">
          <ConnectionPill />
          {view === 'inbox' ? (
            <button
              type="button"
              className="btn btn-sm btn-ghost p-1 text-[#a1a1aa] hover:text-[#f2f2f2]"
              onClick={refresh}
              aria-label="Reload notifications"
              disabled={inbox.isFetching}
              aria-busy={inbox.isFetching || undefined}
            >
              <RefreshIcon width={13} height={13} />
            </button>
          ) : null}
        </div>
      </header>

      {view === 'preferences' ? (
        <div className="inbox-scroll" style={{ maxHeight: 460 }}>
          <PreferencesPanel />
        </div>
      ) : (
        <Tabs.Root value={tab} onValueChange={(value) => setTab(value as 'all' | 'unread')}>
          <Tabs.List
            aria-label="Filter notifications"
            className="flex gap-1.5 border-b border-[#27272a] bg-[#000000]/40 px-4 py-2"
          >
            {(['all', 'unread'] as const).map((value) => (
              <Tabs.Trigger
                key={value}
                value={value}
                className="btn btn-sm rounded-[4px] border-transparent text-[#a1a1aa] data-[state=active]:border-[#27272a] data-[state=active]:bg-[#18181b] data-[state=active]:text-[#22c55e] data-[state=active]:font-semibold"
              >
                {value === 'all' ? 'All Activity' : 'Unread Only'}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          <div className="relative">
            {newCount > 0 ? (
              <div className="absolute inset-x-0 top-2 z-10 flex justify-center">
                <button
                  type="button"
                  className="btn btn-sm btn-primary shadow-lg"
                  onClick={() => {
                    scrollRef.current?.scrollTo({
                      top: 0,
                      behavior: reduced ? 'auto' : 'smooth',
                    });
                    setNewCount(0);
                  }}
                >
                  {newCount} new event{newCount === 1 ? '' : 's'}
                </button>
              </div>
            ) : null}

            <div
              ref={scrollRef}
              className="inbox-scroll"
              aria-busy={loading || undefined}
              tabIndex={0}
              aria-label={tab === 'unread' ? 'Unread notifications' : 'All notifications'}
            >
              {loading ? <Skeleton /> : null}

              {error ? (
                <div className="grid gap-2 rounded-[6px] border border-[#ef4444]/30 bg-[#7f1d1d]/10 p-4 text-[#fca5a5]">
                  <p className="text-xs">
                    Failed to fetch notifications.{' '}
                    {error.requestId ? `(Request ID: ${error.requestId})` : ''}
                  </p>
                  <div>
                    <Button size="sm" onClick={() => void inbox.refetch()}>
                      Retry
                    </Button>
                  </div>
                </div>
              ) : null}

              {!loading && !error && items.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-8 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#27272a] bg-[#111113] text-[#22c55e]">
                    ✓
                  </div>
                  <p className="mt-3 text-sm font-medium text-[#f2f2f2]">
                    {tab === 'unread' ? "You're all caught up" : 'No notifications recorded yet'}
                  </p>
                  <p className="mt-1 text-xs text-[#a1a1aa]">
                    {tab === 'unread'
                      ? 'New notifications will appear here and ping your browser tab in real time.'
                      : 'Send a test notification from the playground to see live delivery.'}
                  </p>
                </div>
              ) : null}

              {!error
                ? items.map((item) => (
                    <NotificationItem
                      key={item.id}
                      item={item}
                      onRead={(id) => markRead.mutate(id)}
                      reading={pendingId === item.id}
                    />
                  ))
                : null}

              {inbox.hasNextPage && !error ? (
                <div className="flex justify-center pt-2 pb-1">
                  <Button
                    size="sm"
                    onClick={() => void inbox.fetchNextPage()}
                    loading={inbox.isFetchingNextPage}
                  >
                    Load older events
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </Tabs.Root>
      )}
    </section>
  );
}

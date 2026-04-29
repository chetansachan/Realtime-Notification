import { useEffect, useRef } from 'react';

/**
 * One polite region and one assertive region for the whole app. Notification
 * lists must never be live regions: a flood would be unreadable.
 */
let politeRegion: HTMLElement | null = null;
let assertiveRegion: HTMLElement | null = null;

const MIN_INTERVAL_MS = 3000;
const BATCH_DELAY_MS = 350;

let queue: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let batchTimer: ReturnType<typeof setTimeout> | null = null;
let pendingCount = 0;
let lastSpokeAt = 0;
let toggle = false;

function write(region: HTMLElement | null, message: string): void {
  if (!region) return;
  // Identical text is not re-announced by screen readers.
  toggle = !toggle;
  region.textContent = toggle ? message : `${message}\u200b`;
}

function scheduleFlush(delayMs: number): void {
  if (flushTimer) return;
  flushTimer = setTimeout(
    () => {
      flushTimer = null;
      if (queue.length === 0) return;
      const message = queue.join('. ');
      queue = [];
      lastSpokeAt = Date.now();
      write(politeRegion, message);
    },
    Math.max(0, delayMs),
  );
}

function queuePolite(message: string): void {
  queue.push(message);
  scheduleFlush(MIN_INTERVAL_MS - (Date.now() - lastSpokeAt));
}

export function setAnnouncerRegions(
  polite: HTMLElement | null,
  assertive: HTMLElement | null,
): void {
  politeRegion = polite;
  assertiveRegion = assertive;
}

export function announce(message: string): void {
  queuePolite(message);
}

export function announceUrgent(message: string): void {
  write(assertiveRegion, message);
}

/** Coalesces a burst into one batch announcement ("5 new notifications"). */
export function announceNotifications(count: number): void {
  if (count <= 0) return;
  pendingCount += count;
  if (batchTimer) clearTimeout(batchTimer);
  batchTimer = setTimeout(() => {
    const total = pendingCount;
    pendingCount = 0;
    batchTimer = null;
    queuePolite(total === 1 ? '1 new notification' : `${total} new notifications`);
  }, BATCH_DELAY_MS);
}

export function resetAnnouncer(): void {
  if (flushTimer) clearTimeout(flushTimer);
  if (batchTimer) clearTimeout(batchTimer);
  flushTimer = null;
  batchTimer = null;
  queue = [];
  pendingCount = 0;
  lastSpokeAt = 0;
  toggle = false;
  if (politeRegion) politeRegion.textContent = '';
  if (assertiveRegion) assertiveRegion.textContent = '';
}

export function AnnouncerHost() {
  const polite = useRef<HTMLDivElement>(null);
  const assertive = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAnnouncerRegions(polite.current, assertive.current);
    return () => setAnnouncerRegions(null, null);
  }, []);

  return (
    <>
      <div ref={polite} role="status" aria-live="polite" aria-atomic="true" className="sr-only" />
      <div ref={assertive} role="alert" aria-live="assertive" aria-atomic="true" className="sr-only" />
    </>
  );
}

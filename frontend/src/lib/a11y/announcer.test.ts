import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  announce,
  announceNotifications,
  announceUrgent,
  resetAnnouncer,
  setAnnouncerRegions,
} from './announcer.js';

let polite: HTMLDivElement;
let assertive: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  polite = document.createElement('div');
  assertive = document.createElement('div');
  document.body.append(polite, assertive);
  setAnnouncerRegions(polite, assertive);
  resetAnnouncer();
});

afterEach(() => {
  resetAnnouncer();
  polite.remove();
  assertive.remove();
  vi.useRealTimers();
});

describe('announcer', () => {
  it('coalesces a burst of notifications into one message', () => {
    announceNotifications(1);
    announceNotifications(1);
    announceNotifications(3);

    vi.advanceTimersByTime(400);
    vi.advanceTimersByTime(10);

    expect(polite.textContent).toContain('5 new notifications');
  });

  it('throttles polite announcements to one per window', () => {
    announce('one');
    vi.advanceTimersByTime(10);
    expect(polite.textContent).toContain('one');

    announce('two');
    vi.advanceTimersByTime(200);
    expect(polite.textContent).not.toContain('two');

    vi.advanceTimersByTime(3000);
    expect(polite.textContent).toContain('two');
  });

  it('sends urgent messages to the assertive region immediately', () => {
    announceUrgent('Session expired. Sign in again.');
    expect(assertive.textContent).toContain('Session expired');
    expect(polite.textContent).toBe('');
  });

  it('does not announce connection countdown ticks', () => {
    announce('Notifications live');
    vi.advanceTimersByTime(10);
    expect(polite.textContent).toContain('Notifications live');

    // A countdown tick would call announce(); the window swallows it.
    announce('Notifications live');
    vi.advanceTimersByTime(100);
    expect(polite.textContent?.split('Notifications live').length).toBeLessThanOrEqual(2);
  });
});

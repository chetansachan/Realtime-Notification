// [initial module draft]
import type { InfiniteData } from '@tanstack/react-query';
import type { InboxPage, NotificationItem } from '../../lib/types.js';

export type InboxData = InfiniteData<InboxPage, string | null>;

function mapPages(
  data: InboxData | undefined,
  fn: (page: InboxPage) => InboxPage,
): InboxData | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map(fn) };
}

/** Inserts a streamed notification at the top of page 1, ignoring duplicates. */
export function insertNotification(
  data: InboxData | undefined,
  item: NotificationItem,
): InboxData | undefined {
  if (!data) return data;
  if (data.pages.some((page) => page.items.some((existing) => existing.id === item.id))) {
    return data;
  }
  const [first, ...rest] = data.pages;
  if (!first) return data;
  return {
    ...data,
    pages: [{ ...first, items: [item, ...first.items] }, ...rest],
  };
}

export function markReadInCache(
  data: InboxData | undefined,
  id: string,
): InboxData | undefined {
  return mapPages(data, (page) => ({
    ...page,
    items: page.items.map((item) =>
      item.id === id ? { ...item, readAt: item.readAt ?? new Date().toISOString() } : item,
    ),
  }));
}

/** The unread tab drops an item the moment it is read. */
export function removeFromCache(
  data: InboxData | undefined,
  id: string,
): InboxData | undefined {
  return mapPages(data, (page) => ({
    ...page,
    items: page.items.filter((item) => item.id !== id),
  }));
}

export function markAllReadInCache(data: InboxData | undefined): InboxData | undefined {
  const now = new Date().toISOString();
  return mapPages(data, (page) => ({
    ...page,
    items: page.items.map((item) => ({ ...item, readAt: item.readAt ?? now })),
  }));
}

export function clearItemsInCache(data: InboxData | undefined): InboxData | undefined {
  return mapPages(data, (page) => ({ ...page, items: [] }));
}

export function setUnreadCountInCache(
  data: InboxData | undefined,
  unreadCount: number,
): InboxData | undefined {
  return mapPages(data, (page) => ({ ...page, unreadCount }));
}

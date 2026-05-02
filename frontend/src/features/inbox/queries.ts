import { useMemo } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNotifications } from '../../sdk/NotificationProvider.js';
import { useRealtimeStore } from '../../realtime/store.js';
import { useToastStore } from '../../sdk/toast-store.js';
import { announceUrgent } from '../../lib/a11y/announcer.js';
import { createInboxApi } from './api.js';
import { inboxKeys } from './keys.js';
import {
  clearItemsInCache,
  markAllReadInCache,
  markReadInCache,
  removeFromCache,
  type InboxData,
} from './optimistic.js';

export function useInbox(tab: 'all' | 'unread') {
  const { api, appId, userId, session } = useNotifications();
  const inboxApi = useMemo(() => createInboxApi(api), [api]);

  return useInfiniteQuery({
    queryKey: inboxKeys.list(appId, userId, tab),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const token = await session.getToken();
      return inboxApi.history(token, {
        before: pageParam,
        limit: 20,
        unread: tab === 'unread',
      });
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 15_000,
  });
}

export function useMarkRead() {
  const { appId, userId, session, api } = useNotifications();
  const queryClient = useQueryClient();
  const inboxApi = useMemo(() => createInboxApi(api), [api]);

  return useMutation({
    mutationFn: async (id: string) => {
      const token = await session.getToken();
      return inboxApi.markRead(token, id);
    },
    onMutate: async (id) => {
      const allKey = inboxKeys.list(appId, userId, 'all');
      const unreadKey = inboxKeys.list(appId, userId, 'unread');
      await queryClient.cancelQueries({ queryKey: inboxKeys.all(appId, userId) });

      const previousEntries = queryClient.getQueriesData<InboxData>({
        queryKey: inboxKeys.all(appId, userId),
      });
      const previousUnread = useRealtimeStore.getState().unreadCount;

      queryClient.setQueryData<InboxData>(allKey, (data) => markReadInCache(data, id));
      queryClient.setQueryData<InboxData>(unreadKey, (data) => removeFromCache(data, id));
      useRealtimeStore.getState().setUnread(Math.max(0, previousUnread - 1));

      return { previousEntries, previousUnread };
    },
    onError: (_error, _id, context) => {
      for (const [key, data] of context?.previousEntries ?? []) {
        queryClient.setQueryData(key, data);
      }
      if (context) useRealtimeStore.getState().setUnread(context.previousUnread);
      const message = "Couldn't mark as read. Try again.";
      useToastStore.getState().push({ kind: 'error', title: message });
      announceUrgent(message);
    },
    onSuccess: (result) => {
      useRealtimeStore.getState().setUnread(result.unreadCount);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: inboxKeys.all(appId, userId) });
    },
  });
}

export function useMarkAllRead() {
  const { appId, userId, session, api } = useNotifications();
  const queryClient = useQueryClient();
  const inboxApi = useMemo(() => createInboxApi(api), [api]);

  return useMutation({
    mutationFn: async () => {
      const token = await session.getToken();
      return inboxApi.markAllRead(token, {});
    },
    onMutate: async () => {
      const allKey = inboxKeys.list(appId, userId, 'all');
      const unreadKey = inboxKeys.list(appId, userId, 'unread');
      await queryClient.cancelQueries({ queryKey: inboxKeys.all(appId, userId) });

      const previousEntries = queryClient.getQueriesData<InboxData>({
        queryKey: inboxKeys.all(appId, userId),
      });
      const previousUnread = useRealtimeStore.getState().unreadCount;

      queryClient.setQueryData<InboxData>(allKey, (data) => markAllReadInCache(data));
      queryClient.setQueryData<InboxData>(unreadKey, (data) => clearItemsInCache(data));
      useRealtimeStore.getState().setUnread(0);

      return { previousEntries, previousUnread };
    },
    onError: (_error, _variables, context) => {
      for (const [key, data] of context?.previousEntries ?? []) {
        queryClient.setQueryData(key, data);
      }
      if (context) useRealtimeStore.getState().setUnread(context.previousUnread);
      const message = "Couldn't mark everything as read. Try again.";
      useToastStore.getState().push({ kind: 'error', title: message });
      announceUrgent(message);
    },
    onSuccess: (result) => {
      useRealtimeStore.getState().setUnread(result.unreadCount);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: inboxKeys.all(appId, userId) });
    },
  });
}

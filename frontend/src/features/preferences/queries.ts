import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNotifications } from '../../sdk/NotificationProvider.js';
import type { PreferenceItem, PreferencesResponse } from '../../lib/types.js';
import { createPreferencesApi } from './api.js';
import { inboxKeys } from '../inbox/keys.js';

export function usePreferences(enabled = true) {
  const { api, appId, userId, session } = useNotifications();
  const preferencesApi = useMemo(() => createPreferencesApi(api), [api]);

  return useQuery({
    queryKey: inboxKeys.preferences(appId, userId),
    queryFn: async () => {
      const token = await session.getToken();
      return preferencesApi.list(token);
    },
    enabled,
    staleTime: 60_000,
  });
}

export function useCategories(enabled = true) {
  const { api, appId, session } = useNotifications();
  const preferencesApi = useMemo(() => createPreferencesApi(api), [api]);

  return useQuery({
    queryKey: inboxKeys.categories(appId),
    queryFn: async () => {
      const token = await session.getToken();
      return preferencesApi.categories(token);
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useUpdatePreferences() {
  const { api, appId, userId, session } = useNotifications();
  const queryClient = useQueryClient();
  const preferencesApi = useMemo(() => createPreferencesApi(api), [api]);
  const key = inboxKeys.preferences(appId, userId);

  return useMutation({
    mutationFn: async (preferences: PreferenceItem[]) => {
      const token = await session.getToken();
      return preferencesApi.update(token, preferences);
    },
    onMutate: async (preferences) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<PreferencesResponse>(key);
      queryClient.setQueryData<PreferencesResponse>(key, { items: preferences });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

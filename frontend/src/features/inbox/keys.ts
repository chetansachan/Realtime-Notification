export const inboxKeys = {
  all: (appId: string, userId: string) => ['inbox', appId, userId] as const,
  list: (appId: string, userId: string, tab: 'all' | 'unread') =>
    ['inbox', appId, userId, tab] as const,
  unread: (appId: string, userId: string) => ['unread', appId, userId] as const,
  preferences: (appId: string, userId: string) => ['preferences', appId, userId] as const,
  categories: (appId: string) => ['categories', appId] as const,
};

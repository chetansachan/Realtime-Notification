export const ALL_SCOPES = [
  'notify:write',
  'inbox:read',
  'tokens:create',
  'groups:write',
  'groups:read',
  'preferences:read',
  'preferences:write',
  'webhooks:write',
  'api-keys:admin',
] as const;

export type ApiScope = (typeof ALL_SCOPES)[number];

export interface ApiClientContext {
  id: string;
  appId: string;
  name: string;
  scopes: string[];
}

export interface SubscriberContext {
  appId: string;
  userId: string;
  source: 'jwt' | 'ticket';
}

export function hasScope(granted: string[], required: ApiScope): boolean {
  return granted.includes('*') || granted.includes(required);
}

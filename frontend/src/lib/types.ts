// [initial module draft]
export type DeliveryChannel = 'in_app' | 'email' | 'webhook';

export interface NotificationItem {
  id: string;
  seq: number;
  category: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  priority: 'low' | 'normal' | 'high' | string;
  createdAt: string;
  readAt: string | null;
}

export interface InboxPage {
  items: NotificationItem[];
  nextCursor: string | null;
  unreadCount: number;
}

export interface UnreadCount {
  unreadCount: number;
}

export interface ReadResult {
  id: string;
  changed: boolean;
  unreadCount: number;
}

export interface ReadAllResult {
  updated: number;
  unreadCount: number;
}

export interface PreferenceItem {
  category: string;
  muted: boolean;
  channels: Record<string, boolean>;
}

export interface PreferencesResponse {
  items: PreferenceItem[];
}

export interface Category {
  key: string;
  mandatory: boolean;
  defaultChannels: DeliveryChannel[];
}

export interface CategoriesResponse {
  items: Category[];
}

export interface DemoSession {
  token: string;
  ticket: string;
  expiresIn: number;
  userId: string;
  appId: string;
}

export interface DemoConfig {
  appId: string;
  instanceId: string;
  subscriberTokenTtlSeconds: number;
}

export interface NotifyResult {
  id: string;
  status: 'created' | 'fanout_queued' | 'duplicate';
  recipients: number;
  accepted: number;
  suppressed: number;
  createdAt: string;
}

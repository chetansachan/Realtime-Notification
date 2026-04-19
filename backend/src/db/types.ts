import type { ColumnType, Kysely, Transaction } from 'kysely';

export type DeliveryChannel = 'in_app' | 'email' | 'webhook';
export type DeliveryStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'suppressed';
export type NotificationPriority = 'low' | 'normal' | 'high';

export interface ApiClientsTable {
  id: string;
  app_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  scopes: string[];
  active: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  last_used_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

export interface GroupsTable {
  id: string;
  app_id: string;
  name: string;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface GroupMembersTable {
  group_id: string;
  user_id: string;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface NotificationsTable {
  id: string;
  app_id: string;
  category: string;
  title: string;
  body: string | null;
  data: ColumnType<Record<string, unknown> | null, string | null, string | null>;
  priority: ColumnType<NotificationPriority, NotificationPriority | undefined, NotificationPriority>;
  channels: ColumnType<DeliveryChannel[], DeliveryChannel[] | undefined, DeliveryChannel[]>;
  idempotency_key: string | null;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  expires_at: Date | null;
}

export interface UserStreamsTable {
  app_id: string;
  user_id: string;
  last_seq: ColumnType<number, number | undefined, number>;
  unread_count: ColumnType<number, number | undefined, number>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface DeliveriesTable {
  id: string;
  notification_id: string;
  app_id: string;
  user_id: string;
  channel: DeliveryChannel;
  seq: number | null;
  status: ColumnType<DeliveryStatus, DeliveryStatus | undefined, DeliveryStatus>;
  sent_at: Date | null;
  delivered_at: Date | null;
  read_at: Date | null;
  attempt_count: ColumnType<number, number | undefined, number>;
  last_error: string | null;
  next_retry_at: Date | null;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface PreferencesTable {
  app_id: string;
  user_id: string;
  category: string;
  muted: ColumnType<boolean, boolean | undefined, boolean>;
  channels: ColumnType<Record<string, boolean>, string | undefined, string>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface CategoriesTable {
  app_id: string;
  key: string;
  mandatory: ColumnType<boolean, boolean | undefined, boolean>;
  default_channels: ColumnType<DeliveryChannel[], DeliveryChannel[] | undefined, DeliveryChannel[]>;
}

export interface WebhookEndpointsTable {
  id: string;
  app_id: string;
  url: string;
  secret: string;
  active: ColumnType<boolean, boolean | undefined, boolean>;
  failure_count: ColumnType<number, number | undefined, number>;
  disabled_at: Date | null;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface DB {
  api_clients: ApiClientsTable;
  groups: GroupsTable;
  group_members: GroupMembersTable;
  notifications: NotificationsTable;
  user_streams: UserStreamsTable;
  deliveries: DeliveriesTable;
  preferences: PreferencesTable;
  categories: CategoriesTable;
  webhook_endpoints: WebhookEndpointsTable;
}

export type DbTransaction = Transaction<DB>;
/** Kysely's Transaction extends Kysely<DB>, so repositories accept either. */
export type DbExecutor = Kysely<DB>;

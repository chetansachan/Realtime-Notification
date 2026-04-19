-- Up Migration

CREATE TABLE api_clients (
  id           uuid PRIMARY KEY,
  app_id       text NOT NULL,
  name         text NOT NULL,
  key_prefix   text NOT NULL UNIQUE,
  key_hash     text NOT NULL,
  scopes       text[] NOT NULL DEFAULT '{}',
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX api_clients_app_idx ON api_clients (app_id) WHERE active;

CREATE TABLE groups (
  id         uuid PRIMARY KEY,
  app_id     text NOT NULL,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_id, name)
);

CREATE TABLE group_members (
  group_id   uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_members_user_idx ON group_members (user_id);

CREATE TABLE notifications (
  id              uuid PRIMARY KEY,
  app_id          text NOT NULL,
  category        text NOT NULL,
  title           text NOT NULL,
  body            text,
  data            jsonb,
  priority        notification_priority NOT NULL DEFAULT 'normal',
  channels        delivery_channel[] NOT NULL DEFAULT '{in_app}',
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  CONSTRAINT notifications_title_len CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT notifications_body_len CHECK (body IS NULL OR char_length(body) <= 2000),
  CONSTRAINT notifications_category_len CHECK (char_length(category) BETWEEN 1 AND 64),
  CONSTRAINT notifications_data_size CHECK (data IS NULL OR octet_length(data::text) <= 16384)
);
-- NULL idempotency keys are distinct in Postgres, so rows without a key never collide.
CREATE UNIQUE INDEX notifications_idempotency_key ON notifications (app_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX notifications_app_created_idx ON notifications (app_id, created_at DESC);
CREATE INDEX notifications_expires_idx ON notifications (expires_at) WHERE expires_at IS NOT NULL;

-- Per-user sequence + unread counter. The row lock on this table serialises
-- concurrent notifications for a single user, which is what makes seq gapless.
CREATE TABLE user_streams (
  app_id       text NOT NULL,
  user_id      text NOT NULL,
  last_seq     bigint NOT NULL DEFAULT 0,
  unread_count integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, user_id),
  CONSTRAINT user_streams_seq_non_negative CHECK (last_seq >= 0),
  CONSTRAINT user_streams_unread_non_negative CHECK (unread_count >= 0)
);

CREATE TABLE deliveries (
  id              uuid PRIMARY KEY,
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  app_id          text NOT NULL,
  user_id         text NOT NULL,
  channel         delivery_channel NOT NULL,
  seq             bigint,
  status          delivery_status NOT NULL DEFAULT 'queued',
  sent_at         timestamptz,
  delivered_at    timestamptz,
  read_at         timestamptz,
  attempt_count   integer NOT NULL DEFAULT 0,
  last_error      text,
  next_retry_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notification_id, user_id, channel),
  CONSTRAINT deliveries_seq_only_in_app CHECK (seq IS NULL OR channel = 'in_app')
);

-- One sequence number per (app, user): the guarantee the replay protocol rests on.
CREATE UNIQUE INDEX deliveries_user_seq_key ON deliveries (app_id, user_id, seq)
  WHERE seq IS NOT NULL;

-- History, keyset pagination and replay all ride this index.
CREATE INDEX deliveries_history_idx ON deliveries (app_id, user_id, seq DESC)
  WHERE channel = 'in_app' AND seq IS NOT NULL;

CREATE INDEX deliveries_unread_idx ON deliveries (app_id, user_id)
  WHERE channel = 'in_app' AND read_at IS NULL AND seq IS NOT NULL;

CREATE INDEX deliveries_notification_idx ON deliveries (notification_id);
CREATE INDEX deliveries_retry_idx ON deliveries (next_retry_at)
  WHERE status IN ('queued', 'failed');

CREATE TABLE preferences (
  app_id     text NOT NULL,
  user_id    text NOT NULL,
  category   text NOT NULL,
  muted      boolean NOT NULL DEFAULT false,
  channels   jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, user_id, category)
);

CREATE TABLE categories (
  app_id           text NOT NULL,
  key              text NOT NULL,
  mandatory        boolean NOT NULL DEFAULT false,
  default_channels delivery_channel[] NOT NULL DEFAULT '{in_app}',
  PRIMARY KEY (app_id, key)
);

CREATE TABLE webhook_endpoints (
  id            uuid PRIMARY KEY,
  app_id        text NOT NULL,
  url           text NOT NULL,
  secret        text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  failure_count integer NOT NULL DEFAULT 0,
  disabled_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_url_len CHECK (char_length(url) BETWEEN 8 AND 2048)
);
CREATE INDEX webhook_endpoints_app_idx ON webhook_endpoints (app_id) WHERE active;

-- Down Migration

DROP TABLE IF EXISTS webhook_endpoints;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS preferences;
DROP TABLE IF EXISTS deliveries;
DROP TABLE IF EXISTS user_streams;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS group_members;
DROP TABLE IF EXISTS groups;
DROP TABLE IF EXISTS api_clients;

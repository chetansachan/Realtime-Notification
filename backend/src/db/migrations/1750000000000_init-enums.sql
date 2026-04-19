-- Up Migration

CREATE TYPE delivery_channel AS ENUM ('in_app', 'email', 'webhook');
CREATE TYPE delivery_status AS ENUM ('queued', 'sent', 'delivered', 'read', 'failed', 'suppressed');
CREATE TYPE notification_priority AS ENUM ('low', 'normal', 'high');

-- Down Migration

DROP TYPE IF EXISTS notification_priority;
DROP TYPE IF EXISTS delivery_status;
DROP TYPE IF EXISTS delivery_channel;

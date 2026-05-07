# Real-time Notification Service

A standalone, multi-tenant service that other applications call to say *"tell this user (or group)
something"*. It stores every notification durably, pushes it to every open browser or device in
real time — even when that connection lives on a different API instance — optionally emails or
calls a webhook, and lets offline clients catch up **exactly** where they left off.

The whole design rests on two rules:

1. **PostgreSQL is the source of truth. Redis Pub/Sub is only a fast, lossy hint.** Pub/Sub is
   at-most-once; a dropped message is gone. Every missed event can be recovered from Postgres by
   replaying from the client's last seen sequence number.
2. **Every user has their own gapless, monotonically increasing sequence number.** It is the SSE
   `id`, the pagination cursor, the replay cursor, and how clients detect a missed event.

---

## Repository layout

```
backend/    Fastify API + BullMQ workers (Postgres, Redis)
frontend/   React + GSAP widget, live playground, landing/docs
docker-compose.yml, nginx.conf   two API replicas + worker + SPA
```

---

## Quick start

### Docker Compose (two API replicas + worker + nginx + SPA)

```bash
docker compose up --build
```

That brings up Postgres, Redis, a one-shot migration job, `api-1`, `api-2`, the BullMQ worker,
nginx in front of the API, and the built SPA.

- **Playground / SPA:** <http://localhost:8081/playground?user=user-42>
- **API behind nginx:** <http://localhost:8080> (`/docs` for Swagger, `/demo` for the legacy
  server-rendered demo page)

The playground uses demo-only server routes, so no key is needed there. For your own host backend:

```bash
docker compose run --rm api-1 node dist/scripts/seed-key.js --app demo --name demo --scopes "*"
```

Open the playground, send a notification, then open a second tab as the same user: nginx
round-robins the tabs onto different API instances and both update instantly. Press
**Go offline + send 5** and watch the tab reconnect and replay exactly the five it missed.

### Local development

```bash
# infrastructure
docker compose up -d postgres redis

# backend
cd backend
cp .env.example .env
npm install
npm run migrate
npm run seed:key -- --app demo --name local --scopes "*"
npm run dev          # API on :3000, docs at /docs
npm run worker       # BullMQ workers + metrics on :9464

# frontend (new terminal)
cd frontend
npm install
npm run dev          # http://localhost:5173/playground?user=user-42
```

The frontend README (`frontend/README.md`) covers the realtime client, motion rules and
accessibility decisions. `VITE_API_BASE` can point the SPA at another API; by default Vite proxies
`/v1`, `/demo` and `/health` to `localhost:3000`.

`DEMO_ENABLED=true` also serves the legacy demo page at <http://localhost:3000/demo>.

---

## Architecture

```
 Host apps (billing, chat, ...)                 Browsers / devices
        │  POST /v1/notify  (API key)                  ▲  SSE / WebSocket
        ▼                                              │
 ┌──────────────── nginx / load balancer ─────────────────┐
 │                                                        │
 ▼                                                        ▼
API instance A                                    API instance B
 ├─ notify module ──► PostgreSQL (commit)           ├─ ConnectionRegistry
 ├─ PUBLISH ntf:app:user ──► Redis Pub/Sub ──────►  ├─ PubSubBridge (SUBSCRIBE)
 └─ enqueue email/webhook ──► BullMQ (Redis)        └─ SseConnection → browser tab
                                    │
                              Worker process(es) → SMTP / webhook endpoints
```

### Ingest flow (`POST /v1/notify`)

```
auth (API key + scope) → rate limit → TypeBox validation
→ service: resolve recipients → check preferences
→ transaction:
    insert notification (ON CONFLICT idempotency key)
    for each recipient (sorted, stable lock order):
      plan channels → allocate per-user seq → insert deliveries
→ COMMIT
→ PUBLISH to Redis → enqueue email/webhook/escalation jobs
→ 201 (200 if idempotent duplicate, 202 for a large fan-out)
```

### Why the per-user sequence exists

A global `bigserial` has a subtle replay bug: transaction A takes id 10, transaction B takes 11, B
commits first, the client sees 11, disconnects, reconnects with `Last-Event-ID: 11` — and row 10
commits later and is never replayed.

Allocating the number from a per-user counter row inside the same transaction fixes it:

```sql
INSERT INTO user_streams (app_id, user_id, last_seq, unread_count)
VALUES ($1, $2, 1, 1)
ON CONFLICT (app_id, user_id)
DO UPDATE SET last_seq = user_streams.last_seq + 1,
              unread_count = user_streams.unread_count + 1
RETURNING last_seq;
```

The row lock serialises concurrent notifications for one user until commit, so **sequence order
equals commit order**, and a rollback rolls back the increment (no gaps). Muted notifications get
`status = 'suppressed'` and `seq = NULL`, so they never create visible gaps either.

### The three-phase replay handoff

`registry.attach(conn, replay)` closes the race between "events I am replaying from the DB" and
"live events arriving from Redis right now":

1. Register the connection in **buffering** mode and await the Redis `SUBSCRIBE` acknowledgement.
   From here on, live events for this user are captured per connection.
2. **Replay from Postgres** (`WHERE seq > $lastEventId ORDER BY seq LIMIT n`).
3. **Drain the buffer**, dropping anything with `seq <= lastSentSeq`, then switch to live mode.

The order matters. Querying the DB before subscribing would lose anything committed in between.
If the backlog exceeds `REPLAY_LIMIT`, the server sends `event: resync` instead and the client
refetches over REST, so a reconnect can never produce an unbounded burst.

### Stream events

| Event | Has `id:`? | Purpose |
|---|---|---|
| `notification` | yes (`seq`) | A new notification |
| `read` / `read_all` | no | Another tab marked something read; badge stays in sync |
| `unread_count` | no | Authoritative badge value |
| `resync` | no | "You missed too much, refetch via REST" |
| `reconnect` | no | Server is shutting down; reconnect after `retryAfterMs` |
| `hello` | no | `instanceId`, server `lastSeq`, `unreadCount`, client `resumeFrom` |
| `: ping` | no | Heartbeat comment every 20 s |

Events without an `id:` never move the browser's stored last event ID, so the replay cursor only
advances on real notifications.

### Backpressure and cleanup

- Each connection has a bounded outbound queue (count and bytes) plus the kernel's own buffer.
- `res.write()` returning `false` means "slow down": further events are queued and flushed on
  `drain`. Queue overflow closes **that** connection with a final `resync` hint — safe precisely
  because replay exists.
- One shared heartbeat timer sweeps every connection (not one timer per connection) and closes
  sockets that stopped answering.
- `registry.detach` removes the connection, and the last local connection for a user issues
  `UNSUBSCRIBE` (refcounted), so instances only receive traffic for users they can serve.
- On `app.close()` every stream receives `event: reconnect` with jitter, then ends, so a rolling
  deploy is invisible to users.

---

## API surface (v1)

```
# Service API (API key: Authorization: Bearer ntf_live_<prefix>_<secret>)
POST   /v1/notify                     # Idempotency-Key header supported
GET    /v1/notifications/:id          # delivery status per recipient/channel (admin view)
POST   /v1/groups                     # create
GET    /v1/groups                     # list + member counts
GET    /v1/groups/:id                 # one group
PUT    /v1/groups/:id/members         # add/remove members
DELETE /v1/groups/:id
POST   /v1/subscriber-tokens          # mint a short-lived JWT for a browser/device
POST   /v1/stream-tickets             # single-use SSE/WS ticket (API key or subscriber JWT)
CRUD   /v1/webhook-endpoints
POST   /v1/api-keys                   # admin: mint another key (shown once)
GET    /v1/api-keys
DELETE /v1/api-keys/:id               # revoke

# Subscriber API (subscriber JWT, or a stream ticket for /v1/stream and /v1/ws)
GET    /v1/stream                     # SSE, honors Last-Event-ID and ?lastEventId=
GET    /v1/ws                         # WebSocket, {type:"resume",lastSeq}
GET    /v1/notifications              # keyset-paginated history
GET    /v1/notifications/unread-count
POST   /v1/notifications/:id/ack
POST   /v1/notifications/:id/read
POST   /v1/notifications/read-all
GET|PUT /v1/preferences
GET    /v1/categories                 # category defaults + mandatory flag

# Ops
GET /health   GET /ready   GET /metrics   GET /docs   GET /demo
```

Errors are RFC 7807-shaped: `{ type, title, status, detail, code, requestId }`, with Postgres
`23505 → 409`, `23503 → 422`, `23514 → 409`.

### Authentication

| Caller | Credential | Used for |
|---|---|---|
| Host app backend | API key (`ntf_live_<prefix>_<secret>`) | ingest, groups, token minting, webhooks |
| Browser / device | short-lived JWT (`appId`, `sub`) | stream, inbox, preferences |


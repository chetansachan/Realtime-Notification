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

Only a key's prefix and SHA-256 hash are stored (keys are high-entropy, so no password stretching
is needed); lookup is by prefix, comparison is `timingSafeEqual`, and results are cached for 30 s.
`EventSource` cannot send headers, so streams authenticate with a **single-use ticket** consumed
atomically with `GETDEL`, or with a subscriber JWT for the WebSocket/non-native clients.
Tickets and tokens are redacted from logs.

---

## Testing

```bash
npm test          # backend first (Testcontainers), then frontend (Vitest + jsdom)
```

The backend suite uses **real infrastructure** via Testcontainers (`postgres:16-alpine`,
`redis:7-alpine`) and real clients (`eventsource`, `ws`), because mocks cannot prove cross-instance
delivery. Docker must be running.

Coverage highlights:

- **Cross-instance delivery** — client on B, notify on A, event arrives on B.
- **Replay** — receive 1–3, disconnect, write 4–6, reconnect with `Last-Event-ID: 3`, get 4, 5, 6
  exactly once (both the header and `?lastEventId=` paths are exercised).
- **Handoff race** — notifications written continuously while the client reconnects repeatedly;
  final sequence must be gapless and duplicate-free.
- **Sequence integrity** — 50 parallel notifications to one user yield seq 1–50.
- **Backpressure** — deterministic fake transport fills the queue, overflow closes the connection.
- **Cleanup** — registry empties and the Redis `UNSUBSCRIBE` actually happens (verified with
  `PUBSUB NUMSUB`).
- **Heartbeat** — fake timers verify the sweep cadence and dead-peer closure.
- **Auth/tenancy** — scopes, single-use tickets, app A cannot read app B's data.
- **Idempotency** — same key twice returns the original; different payload returns 409.
- **Preferences** — muted category is suppressed (no seq, no push, no unread); mandatory categories
  ignore mute.
- **Workers** — HMAC-signed webhook delivery, SSRF rejection, escalation skipped when already read,
  chunked group fan-out that stays idempotent on retry.
- **Graceful shutdown** — clients receive `reconnect` and `app.close()` resolves.

The replay/backpressure/cleanup tests are the ones worth reading first: they encode the failure
model that makes Redis-as-a-hint safe.

The frontend suite covers the pieces that make the UI correct under reconnects: sequence
classification (apply/duplicate/gap), full-jitter backoff, hostile SSE payload parsing, the store,
the live-region announcer (batching and throttling), toast coalescing, and notification rendering
(untrusted markup, unsafe URLs). A dependency-free browser check drives Chrome over CDP against the
real stack:

```bash
# with the backend and `npm run dev` running
cd frontend && node scripts/browser-check.mjs
```

It asserts the stream goes live, a send arrives in the inbox, five offline sends replay on
reconnect (seq 6, six items, one hello, no duplicates), and the console stays clean.

---

## Project layout

```
backend/
  src/
    app.ts            buildApp(): plugins + modules, used by the server and by tests
    server.ts         API entrypoint (listen, graceful shutdown)
    worker.ts         BullMQ workers + metrics, scales independently
    config/env.ts     TypeBox-validated environment
    plugins/          db, redis, auth, realtime, security, swagger, metrics, queues
    modules/          notify, inbox, groups, stream (SSE/WS), tokens, preferences,
                      webhooks, api-keys, demo
    realtime/         framework-agnostic heart: connection, registry, pubsub bridge,
                      replay, heartbeat, events, publish
    delivery/         channel routing, email, signed webhooks with SSRF guard
    jobs/             queues and fan-out / email / webhook / escalation / maintenance
    db/               Kysely types, client factory, plain-SQL migrations
  public/             legacy demo.html/demo.js/demo.css (DEMO_ENABLED)
  test/               setup, helpers, unit, integration, realtime
frontend/
  src/
    app/              router + root layout (route focus, skip link)
    realtime/         StreamClient, sequence tracker, backoff, Zustand store, event bridge
    sdk/              NotificationProvider, Bell, InboxPanel, NotificationItem,
                      PreferencesPanel, ConnectionPill, ToastHost
    features/         inbox + preferences queries, cache updates, mutations
    pages/            landing, playground, docs
    motion/           GSAP registration, motion tokens, reveal/count hooks
    components/       ui primitives, icons, pipeline diagram
    styles/           tokens.css (the only place raw values live), base.css
  scripts/            browser-check.mjs (CDP smoke test)
  docs/               playground screenshot
```

`backend/src/realtime/` deliberately knows nothing about Fastify: it deals with connections, a
registry and a bridge, so it can be unit-tested with fake connections. On the frontend,
`src/realtime/` knows nothing about React components for the same reason.

---

## Design notes and trade-offs

**Redis Pub/Sub, not `LISTEN/NOTIFY`.** `NOTIFY` has an 8 KB payload limit and ties up dedicated
database connections; Pub/Sub is built for fan-out and Redis is already required for rate limiting
and queues.

**Refcounted per-user subscriptions, not `PSUBSCRIBE ntf:*`.** A pattern subscription makes every
instance receive every message and filter locally — fine at small scale, wasteful at large scale.
The first local connection for a user issues `SUBSCRIBE ntf:{appId}:{userId}`; the last to leave
issues `UNSUBSCRIBE`. On Redis Cluster, use sharded Pub/Sub (`SSUBSCRIBE`/`SPUBLISH`).

**SSE by default, WebSocket available.** Notifications are one-way; the only upstream traffic is
occasional ack/read, which plain `POST`s handle. SSE gives reconnect, resume and HTTP/2/proxy
compatibility for free. WebSocket earns its place for frequent client→server messages, binary data
or chat-like workloads. Both implement the same `Connection` interface, so registry, replay and
dispatch are written once.

**Idempotent, monotonic delivery transitions.** `UPDATE ... WHERE read_at IS NULL RETURNING` and
`WHERE status IN ('queued','sent')` mean a late ack can never move `read` back to `delivered`, and
a repeated read never decrements the unread counter twice. A nightly reconcile job compares
`unread_count` with a real `COUNT(*)` and repairs drift.

**Webhook SSRF guard.** Users register these URLs, so they are treated as hostile: https only,
DNS resolved and every address checked against loopback/RFC1918/link-local/CGNAT/ULA ranges, the
resolved IP pinned for the request (defeating DNS rebinding), redirects not followed, 5 s timeout,
response size capped. Repeated failures trip a per-endpoint circuit breaker and disable it.

**Known deviations / not done:** quiet hours for email, monthly partitioning of `deliveries`, and
sharded Pub/Sub are described in the design but not implemented. Escalation emails are addressed by
`userId` (treated as an email when it contains `@`, otherwise `userId@notifications.local`) because
this service has no user directory.

---

## Configuration

All environment variables are validated at startup (see `.env.example`). The important ones:

| Variable | Meaning |
|---|---|
| `DATABASE_URL`, `REDIS_URL` | Infrastructure |
| `JWT_SECRET` | Subscriber token signing key (≥ 32 chars) |
| `INSTANCE_ID` | Attached to logs and to the `hello` event |
| `INLINE_RECIPIENT_LIMIT` | Above this, ingest returns 202 and a worker fans out |
| `REPLAY_LIMIT` | Max events replayed before sending `resync` |
| `MAX_CONNECTIONS_PER_USER` / `_PER_INSTANCE` | Connection caps |
| `CONNECTION_QUEUE_MAX` / `_BYTES` | Slow-consumer bounds |
| `HEARTBEAT_INTERVAL_MS` | Shared heartbeat cadence |
| `STREAM_TICKET_TTL_SECONDS` | Single-use stream ticket lifetime |
| `WEBHOOK_ALLOW_PRIVATE_IPS` | Only for local testing; keep false in production |
| `DEMO_ENABLED` | Serves `/demo` and the demo-only routes |

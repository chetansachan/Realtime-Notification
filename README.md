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


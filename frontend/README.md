# Frontend: realtime notification widget + live playground

React 19 + TypeScript, Vite, TanStack Router/Query, Zustand, Radix primitives and GSAP.
It talks to the service in `../backend` and is built around the client side of the
replay protocol rather than around decorations.

## Run it

```bash
# terminal 1 (backend + Postgres + Redis)
docker compose up -d postgres redis        # from the repo root
cd backend && npm run migrate && npm run dev

# terminal 2
cd frontend && npm install && npm run dev
```

Open <http://localhost:5173/playground?user=user-42>. Vite proxies `/v1`, `/demo` and
`/health` to `http://localhost:3000`, so there is no CORS in development and the SSE
stream passes straight through. For a different backend, set `VITE_API_BASE`.

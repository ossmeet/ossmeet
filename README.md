# OSSMeet

Source code for [ossmeet.com](https://ossmeet.com) — an open-source video meeting platform built on LiveKit. Self-hostable.

## Architecture

```
                          ┌──────────────────────────────────────┐
  Browser ── HTTP/SSR ──▶ │           Cloudflare                 │
                          │  Workers (TanStack Start)            │
                          │  D1  — SQLite database               │
                          │  R2  — file & recording storage      │
                          └──────────────────────────────────────┘

                          ┌──────────────────────────────────────┐
  Browser ── WebRTC  ───▶ │         VPS  (Docker Compose)        │
             WebSocket    │                                      │
                          │  Caddy L4   TLS termination + TURN   │
                          │  LiveKit    video rooms              │
                          │  Egress     recording → R2           │
                          │  Whiteboard Bun sync server          │
                          │  Redis      LiveKit state            │
                          └──────────────────────────────────────┘
```

## Monorepo

```
ossmeet/
├── apps/
│   └── web/              TanStack Start (React 19 + Vite) → Cloudflare Worker
├── packages/
│   ├── whiteboard/       tldraw canvas + Bun sync server + web-app glue
│   ├── db/               Drizzle ORM schema + D1/SQLite migrations
│   └── shared/           Zod schemas, plan limits, utilities
└── infra/
    └── vps/              Docker Compose: LiveKit, Egress, Redis, Caddy L4, Whiteboard
```

## Features

- **Video meetings** — WebRTC via LiveKit; screen sharing, recording, live streaming egress
- **Collaborative whiteboard** — tldraw canvas with real-time sync (Bun server) and an AI assistant
- **Background blur & virtual backgrounds** — MediaPipe WASM, self-hosted assets, no CDN dependency
- **Live captions** — Web Speech API transcription flushed to the database on leave
- **AI meeting recap** — post-meeting summary, topics, action items, and decisions; shareable public URL
- **Spaces** — team workspaces with owner / admin / member roles and invite links
- **Guest access** — unauthenticated participants via signed cookie; optional host approval gate
- **Auth** — OTP email, Google OAuth, and WebAuthn passkeys; token-rotated sessions
- **Billing** — Paddle-integrated Free / Pro / Org plans enforced at the server function level

---

## Getting started

### Prerequisites

- Node.js ≥ 20 + [pnpm](https://pnpm.io)
- [Bun](https://bun.sh) (whiteboard sync server)
- Cloudflare account (Workers + D1 + R2)
- LiveKit server — self-hosted or [LiveKit Cloud](https://livekit.io)

### Install and run

```bash
pnpm install

pnpm dev              # web app → http://localhost:3000
pnpm dev:whiteboard   # whiteboard sync → http://localhost:8787  (requires Bun)
```

Copy the example env files and fill in your values:

```bash
cp apps/web/.dev.vars.example apps/web/.dev.vars
cp apps/web/wrangler.jsonc.example apps/web/wrangler.jsonc
```

See [`apps/web/.dev.vars.example`](apps/web/.dev.vars.example) for all web-app secrets and [`apps/web/wrangler.jsonc.example`](apps/web/wrangler.jsonc.example) for Cloudflare bindings. VPS-side secrets are in [`infra/vps/.env.example`](infra/vps/.env.example).

### All commands

```bash
pnpm dev                   # web app dev server (port 3000)
pnpm dev:whiteboard        # whiteboard sync server (port 8787, requires Bun)
pnpm build                 # production build
pnpm deploy                # wrangler deploy to Cloudflare Workers
pnpm typecheck             # TypeScript across all packages
pnpm test                  # vitest across all packages

pnpm db:generate           # generate Drizzle migration from schema changes
pnpm db:migrate:local      # apply migrations locally
pnpm db:migrate:remote     # apply migrations to production D1
```

---

## Deploying

### Cloudflare Workers

```bash
pnpm build && pnpm deploy
```

### VPS (LiveKit · Egress · Redis · Caddy · Whiteboard)

```bash
# Push from your machine (rsync + SSH)
bash infra/vps/provision.sh root@your-vps.example

# Or on the VPS directly after a git pull
bash infra/vps/provision.sh --local
```

`provision.sh` templates config files from `.env`, writes Docker secrets, applies sysctl tunings, opens firewall ports, and runs `docker compose up -d --build`. See [`infra/vps/README.md`](infra/vps/README.md) for the full walkthrough.

---

## Code notes

**Route split** — Each TanStack Start route pairs a `.tsx` (loader, server functions) with a `.lazy.tsx` (client-only UI). The `_authed` layout enforces session checks before any authenticated route loads.

**Worker constraints** — The Worker bundle cannot include DOM or WebRTC APIs. The `ssrClientStubs` Vite plugin replaces `livekit-client`, `@livekit/components-react`, `@simplewebauthn/browser`, and `@base-ui/react` with empty stubs for the SSR build.

**Whiteboard** — Accessed through six virtual Vite aliases (`@whiteboard/runtime`, `@whiteboard/server`, etc.) resolved by `build-profile.mjs`. The Bun sync server must run alongside the web app locally. In production the whiteboard API handler is embedded in the same Worker.

**Meeting room hooks** — `use-meeting-room.ts` orchestrates seven sub-hooks in `apps/web/src/lib/meeting/` (lifecycle, token refresh, screen share, recording, streaming, captions, camera, leave/end). Extend via the relevant sub-hook, not the orchestrator.

**LiveKit webhook** — `apps/web/src/routes/api/livekit/-webhook.server.ts` validates the `WebhookReceiver` signature then dispatches to domain functions in `apps/web/src/server/meetings/`.

**AI** — Google Gemini via a custom `@tanstack/ai` adapter at `apps/web/src/server/ai/gemini.ts`. The model and fallback are configured via `AI_MODEL` / `AI_MODEL_FALLBACK` env vars.

**Scheduled cron** — The Worker handles two cron triggers (every 5 min + 2 AM UTC daily) via `runCleanup` for expired sessions, stale tokens, and meeting data past its retention window.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to get involved — issues, pull requests, and coding conventions.

## License

[MIT](LICENSE)

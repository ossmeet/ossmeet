# OSSMeet

OSSMeet is an open-source meeting platform built for small teams that want a simple hosted stack they can run themselves.

It includes:

- browser-based video meetings
- reusable rooms and invite flows
- live captions and transcripts
- meeting summaries and artifacts
- spaces, members, and access control
- self-hosted realtime infrastructure

## Stack

- `apps/web`: TanStack Start + React 19 + Vite + Cloudflare Workers
- `packages/db`: Drizzle ORM schema and migrations for Cloudflare D1
- `packages/shared`: shared schemas, constants, and utilities
- `infra/vps`: LiveKit, Caddy, HAProxy, and Redis deployment files

## Getting Started

Requirements:

- Node.js
- `pnpm`
- Cloudflare account for Workers/D1/R2
- A VPS if you want the self-hosted realtime stack

Install dependencies:

```bash
pnpm install
```

Start local development:

```bash
pnpm dev
```

Typecheck:

```bash
pnpm typecheck
```

Run tests:

```bash
pnpm test
```

Build:

```bash
pnpm build
```

## Database

Generate migrations from the current schema:

```bash
pnpm db:generate
```

Apply migrations locally:

```bash
pnpm db:migrate:local
```

Apply migrations remotely:

```bash
pnpm db:migrate:remote
```

Schema lives in [`packages/db/src/schema.ts`](packages/db/src/schema.ts).

## Repo Layout

```text
apps/web        Main web application
packages/db     Database schema and migrations
packages/shared Shared types, schemas, and helpers
infra/vps       Self-hosted infrastructure config
scripts         Build and sync helpers
```

## Notes

- Environment examples are committed as `.dev.vars.example` files.
- Some optional internal extensions are intentionally not part of this public repository.
- The open-source build works without those extensions.

## License

See [`LICENSE`](LICENSE).

# Contributing to OSSMeet

Thanks for your interest in contributing! This guide covers how to get started.

## Reporting issues

Open an issue on GitHub. Include:

- What you expected vs. what happened
- Steps to reproduce
- Browser/OS if it's a frontend issue

## Pull requests

1. Fork the repo and create a branch from `main`.
2. Run `pnpm install`, then `pnpm typecheck && pnpm test` to make sure everything passes.
3. Make your changes. Add tests for new behavior.
4. Run `pnpm typecheck && pnpm test` again before pushing.
5. Open a PR against `main`. Keep the title short and describe _why_ in the body.

CI runs typecheck, tests, and a full build on every PR.

## Local development

```bash
pnpm install
pnpm dev              # web app on http://localhost:3000
pnpm dev:whiteboard   # whiteboard sync server on http://localhost:8787 (requires Bun)
```

Copy the example config files before starting:

```bash
cp apps/web/.dev.vars.example apps/web/.dev.vars
cp apps/web/wrangler.jsonc.example apps/web/wrangler.jsonc
```

## Project structure

| Path | What it is |
|---|---|
| `apps/web/` | TanStack Start web app (Cloudflare Workers) |
| `packages/whiteboard/` | tldraw whiteboard + Bun sync server |
| `packages/db/` | Drizzle ORM schema and D1 migrations |
| `packages/shared/` | Shared Zod schemas, constants, utilities |
| `infra/vps/` | Docker Compose stack for LiveKit, Egress, Redis, Caddy |

## Conventions

- **Route files** come in pairs: `*.tsx` (loader/server) and `*.lazy.tsx` (client UI).
- **Server-only code** is suffixed `.server.ts` and imports `@tanstack/react-start/server-only`.
- **Meeting features** go in the relevant sub-hook under `apps/web/src/lib/meeting/`, not in the orchestrator (`use-meeting-room.ts`).
- **Database changes** require `pnpm db:generate` after editing the schema, and the generated migration must be committed with the PR.
- Run `pnpm typecheck` before pushing — the Worker build is strict about what can be imported on the server side.

## Code style

- TypeScript everywhere. No `any` unless unavoidable.
- Prefer small, focused changes over large refactors.
- No comments explaining _what_ the code does — use clear names. Comments for _why_ only.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be respectful.

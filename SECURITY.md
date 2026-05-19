# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in OSSMeet, please report it responsibly.

**Do not open a public issue.** Instead, email the maintainers directly or use GitHub's private vulnerability reporting feature (Security tab > "Report a vulnerability").

We will acknowledge your report within 48 hours and aim to provide a fix or mitigation plan within 7 days.

## Scope

This policy covers the OSSMeet codebase:

- `apps/web/` — the TanStack Start web application
- `packages/` — shared libraries (db, whiteboard, shared)
- `infra/vps/` — Docker Compose infrastructure templates

Third-party dependencies are out of scope, but we appreciate reports if you find a vulnerable dependency we should update.

## Supported versions

Only the latest release on the `main` branch is actively maintained.

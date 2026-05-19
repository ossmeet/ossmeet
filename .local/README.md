# Private Overlay

This directory is intentionally gitignored. Keep local-only binary assets here.
Do not put product behavior here.

Expected layout:

```text
.local/
  assets/              Private runtime asset source files
    krisp/             Krisp models and allowlists
```

Runtime preparation copies needed files into `apps/web/public` before dev/build.
Run `pnpm --filter @ossmeet/web run setup:runtime` to refresh runtime assets.

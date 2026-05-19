# VPS Infrastructure

Self-contained Docker Compose stack that runs LiveKit, the LiveKit Egress
recorder, Redis, Caddy (with the layer-4 plugin for SNI-routed TURN/TLS),
and the OSSMeet whiteboard service.

## Files

| File                     | Purpose                                      |
| ------------------------ | -------------------------------------------- |
| `docker-compose.yaml`    | All services, networks, volumes              |
| `caddy/Dockerfile`       | Caddy + caddy-l4 plugin build                |
| `caddy/Caddyfile.tmpl`   | Reverse-proxy + TURN/TLS routing (template)  |
| `livekit.yaml.tmpl`      | LiveKit config template (env-substituted)    |
| `egress.yaml.tmpl`       | LiveKit Egress config template               |
| `redis.conf`             | Redis baseline config                        |
| `sysctl/`                | Kernel tunings for WebRTC                    |
| `provision.sh`           | One-shot deploy — see below                  |
| `.env.example`           | Required environment for both modes          |

## Deploying

`provision.sh` runs in two modes:

```bash
# Push from your laptop (rsync + ssh):
bash infra/vps/provision.sh root@your-vps.example
bash infra/vps/provision.sh                          # uses $VPS_HOST

# Run on the VPS itself, after pulling latest:
ssh root@your-vps.example
cd /opt/ossmeet
git pull
bash infra/vps/provision.sh --local
```

The remote mode rsyncs `infra/vps/` to `/opt/ossmeet/infra/vps/` then SSHs in
and re-invokes the script with `--local`. All the actual provisioning steps
live in the `--local` branch, so the deploy logic is single-sourced.

`infra/vps/.env` is intentionally **never** rsynced — it's per-host secret
material. Copy `.env.example` to `.env` on the VPS the first time and fill
in the LiveKit / Redis / R2 / whiteboard secrets.

## What `provision.sh --local` does

1. Templates `livekit.yaml` and `egress.yaml` from `.env`.
2. Writes Redis, R2, and whiteboard secret files to `secrets/` from `.env`.
   Whiteboard-readable files are owned by the whiteboard-container UID (10001).
3. Validates the compose config.
4. Applies sysctl tunings from `sysctl/*.conf`.
5. Ensures `ufw` rules for HTTP/HTTPS/TURN/WebRTC ports.
6. `docker compose up -d --build --remove-orphans`.
7. Cleans up legacy artifacts (the previous HAProxy / acme setup).
8. Re-chowns the whiteboard data volume.
9. Polls the whiteboard health-check until it reports `healthy`
   (12 × 5s = 60s budget).

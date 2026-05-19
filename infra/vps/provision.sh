#!/bin/bash
# Provision/update VPS infrastructure: sync infra configs, template service
# configs, apply sysctl tuning, configure firewall, and restart Docker
# Compose services.
#
# Two ways to run:
#
#   1. From your laptop (pushes the local working tree to the VPS over SSH):
#        bash infra/vps/provision.sh root@your-vps.example
#        bash infra/vps/provision.sh                    # uses $VPS_HOST
#
#   2. On the VPS itself, after `git pull` in /opt/ossmeet:
#        cd /opt/ossmeet
#        bash infra/vps/provision.sh --local
#
# The --local mode is what the laptop mode SSHs into, so any change you need
# in the deploy flow only needs to live in one place.

set -euo pipefail

REMOTE_DIR="/opt/ossmeet"
COMPOSE_PROJECT=vps
WHITEBOARD_UID=10001

# ────────────────────────────────────────────────────────────────────────────
# Mode selection
# ────────────────────────────────────────────────────────────────────────────
MODE="remote"
ARG="${1:-${VPS_HOST:-}}"

if [[ "$ARG" == "--local" ]]; then
  MODE="local"
elif [[ -z "$ARG" ]]; then
  echo "Usage:"
  echo "  bash infra/vps/provision.sh <user@host>   # push from laptop"
  echo "  bash infra/vps/provision.sh --local       # run on the VPS itself"
  exit 1
fi

# ────────────────────────────────────────────────────────────────────────────
# Local mode — runs the actual provisioning steps on the current machine.
# ────────────────────────────────────────────────────────────────────────────
if [[ "$MODE" == "local" ]]; then
  cd "$REMOTE_DIR/infra/vps" 2>/dev/null \
    || cd "$(dirname "$0")" \
    || { echo "Cannot locate infra/vps directory"; exit 1; }

  if [[ "$EUID" -eq 0 ]]; then
    SUDO=""
  else
    SUDO="${SUDO:-sudo}"
  fi

  for cmd in docker envsubst; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      echo "Missing required command: $cmd"
      echo "Install Docker Compose and gettext/envsubst before running provision.sh --local."
      exit 1
    fi
  done

  if [[ ! -f .env ]]; then
    echo "Missing infra/vps/.env"
    echo "Copy infra/vps/.env.example to infra/vps/.env on this VPS and fill in the required secrets."
    exit 1
  fi

  echo "[provision] Provisioning whiteboard secrets from .env..."
  mkdir -p secrets
  chmod 700 secrets
  chmod 600 .env
  set -a; source .env; set +a
  : "${WHITEBOARD_INTERNAL_SECRET:?Missing WHITEBOARD_INTERNAL_SECRET in infra/vps/.env}"
  : "${WHITEBOARD_JWT_SECRET:?Missing WHITEBOARD_JWT_SECRET in infra/vps/.env}"
  : "${LIVEKIT_API_KEY:?Missing LIVEKIT_API_KEY}"
  : "${LIVEKIT_API_SECRET:?Missing LIVEKIT_API_SECRET}"
  : "${REDIS_PASSWORD:?Missing REDIS_PASSWORD}"
  : "${APP_URL:?Missing APP_URL}"
  : "${R2_ACCESS_KEY_ID:?Missing R2_ACCESS_KEY_ID}"
  : "${R2_SECRET_ACCESS_KEY:?Missing R2_SECRET_ACCESS_KEY}"
  : "${R2_ACCOUNT_ID:?Missing R2_ACCOUNT_ID}"
  : "${R2_ENDPOINT:?Missing R2_ENDPOINT}"
  : "${R2_BUCKET_NAME:?Missing R2_BUCKET_NAME}"
  : "${LIVEKIT_WS_URL:?Missing LIVEKIT_WS_URL}"
  : "${WHITEBOARD_ALLOWED_ORIGINS:?Missing WHITEBOARD_ALLOWED_ORIGINS (e.g. https://your-domain.example,https://www.your-domain.example)}"
  umask 177
  printf '%s' "$WHITEBOARD_INTERNAL_SECRET" > secrets/whiteboard_internal_secret
  printf '%s' "$WHITEBOARD_JWT_SECRET"      > secrets/whiteboard_jwt_secret
  printf '%s' "$R2_ACCESS_KEY_ID"           > secrets/r2_access_key_id
  printf '%s' "$R2_SECRET_ACCESS_KEY"       > secrets/r2_secret_access_key
  printf '%s' "$R2_ACCOUNT_ID"              > secrets/r2_account_id
  printf '%s' "$R2_BUCKET_NAME"             > secrets/r2_bucket_name
  printf '%s' "$REDIS_PASSWORD"             > secrets/redis_password
  chmod 600 \
    secrets/whiteboard_internal_secret \
    secrets/whiteboard_jwt_secret \
    secrets/r2_access_key_id \
    secrets/r2_secret_access_key \
    secrets/r2_account_id \
    secrets/r2_bucket_name \
    secrets/redis_password
  $SUDO chown $WHITEBOARD_UID:$WHITEBOARD_UID \
    secrets/whiteboard_internal_secret \
    secrets/whiteboard_jwt_secret \
    secrets/r2_access_key_id \
    secrets/r2_secret_access_key \
    secrets/r2_account_id \
    secrets/r2_bucket_name

  : "${LIVEKIT_DOMAIN:?Missing LIVEKIT_DOMAIN (e.g. livekit.your-domain.example)}"
  : "${LIVEKIT_TURN_DOMAIN:?Missing LIVEKIT_TURN_DOMAIN (e.g. livekit-turn.your-domain.example)}"
  : "${WHITEBOARD_DOMAIN:?Missing WHITEBOARD_DOMAIN (e.g. whiteboard.your-domain.example)}"

  echo "[provision] Templating livekit.yaml / egress.yaml / Caddyfile from .env..."
  umask 077
  envsubst '${REDIS_PASSWORD} ${LIVEKIT_API_KEY} ${LIVEKIT_API_SECRET} ${APP_URL} ${LIVEKIT_TURN_DOMAIN}' \
    < livekit.yaml.tmpl > livekit.yaml.tmp
  envsubst '${REDIS_PASSWORD} ${LIVEKIT_API_KEY} ${LIVEKIT_API_SECRET} ${LIVEKIT_WS_URL} ${R2_ACCESS_KEY_ID} ${R2_SECRET_ACCESS_KEY} ${R2_ENDPOINT} ${R2_BUCKET_NAME}' \
    < egress.yaml.tmpl > egress.yaml.tmp
  envsubst '${LIVEKIT_DOMAIN} ${LIVEKIT_TURN_DOMAIN} ${WHITEBOARD_DOMAIN}' \
    < caddy/Caddyfile.tmpl > caddy/Caddyfile
  mv livekit.yaml.tmp livekit.yaml
  mv egress.yaml.tmp  egress.yaml
  chmod 600 livekit.yaml
  chmod 640 egress.yaml
  chmod 644 caddy/Caddyfile

  echo "[provision] Validating docker compose config..."
  docker compose config --quiet

  echo "[provision] Applying sysctl tuning..."
  $SUDO cp sysctl/*.conf /etc/sysctl.d/
  $SUDO modprobe tcp_bbr || true
  $SUDO sysctl --system

  echo "[provision] Ensuring firewall rules..."
  if command -v ufw >/dev/null 2>&1; then
    $SUDO ufw allow 80/tcp   comment 'HTTP'
    $SUDO ufw allow 443/tcp  comment 'HTTPS'
    $SUDO ufw allow 3478/udp comment 'TURN/UDP'
    $SUDO ufw allow 7881/tcp comment 'WebRTC TCP fallback'
    $SUDO ufw allow 7882/udp comment 'WebRTC UDP mux'
    $SUDO ufw --force delete allow 443/udp  >/dev/null 2>&1 || true
    $SUDO ufw --force delete allow 5349/tcp >/dev/null 2>&1 || true
    $SUDO ufw allow from 172.16.0.0/12 to any port 7880 comment 'LiveKit signal from Docker bridges'
    $SUDO ufw allow from 172.16.0.0/12 to any port 5350 comment 'LiveKit TURN TLS from Docker bridges'
    $SUDO ufw allow from 127.0.0.1     to any port 6789 comment 'LiveKit Prometheus localhost'
    $SUDO ufw allow from 172.16.0.0/12 to any port 6789 comment 'LiveKit Prometheus Docker bridges'
    $SUDO ufw reload
  else
    echo "[provision] ufw not installed; skipping firewall configuration"
  fi

  echo "[provision] Restarting services..."
  docker compose up -d --build --remove-orphans

  echo "[provision] Fixing deployment directory ownership..."
  chown root:root "$REMOTE_DIR/infra/vps" "$REMOTE_DIR/packages/whiteboard"

  echo "[provision] Cleaning up old deployment artifacts..."
  $SUDO rm -f /etc/cron.d/ossmeet-haproxy-certs
  $SUDO rm -rf "$REMOTE_DIR/infra/vps/acme-home" \
              "$REMOTE_DIR/infra/vps/acme-webroot" \
              "$REMOTE_DIR/infra/vps/haproxy"
  # The VPS only needs infra/vps and packages/whiteboard. Older deployments
  # synced more of the monorepo; remove those stale source leftovers so the
  # host layout matches the current minimal build context.
  rm -rf "$REMOTE_DIR/packages/db" \
         "$REMOTE_DIR/packages/shared" \
         "$REMOTE_DIR/package.json" \
         "$REMOTE_DIR/pnpm-workspace.yaml" \
         "$REMOTE_DIR/packages/whiteboard/dist" \
         "$REMOTE_DIR/packages/whiteboard/node_modules" \
         "$REMOTE_DIR/packages/whiteboard/src/web" \
         "$REMOTE_DIR/packages/whiteboard/src/overrides" \
         "$REMOTE_DIR/packages/whiteboard/src/components"
  if command -v ufw >/dev/null 2>&1; then
    for net in 172.17.0.0/16 172.19.0.0/16; do
      for port in 7880 5350 6789; do
        $SUDO ufw --force delete allow from "$net" to any port "$port" 2>/dev/null || true
      done
    done
  fi

  echo "[provision] Fixing whiteboard volume ownership..."
  $SUDO chown -R $WHITEBOARD_UID:$WHITEBOARD_UID \
    "/var/lib/docker/volumes/${COMPOSE_PROJECT}_whiteboard_data/_data" 2>/dev/null || true

  echo "[provision] Waiting for whiteboard to become healthy..."
  for i in $(seq 1 12); do
    status=$(docker inspect --format '{{.State.Health.Status}}' "${COMPOSE_PROJECT}-whiteboard-1" 2>/dev/null || echo "unknown")
    if [[ "$status" == "healthy" ]]; then
      echo "[provision] Whiteboard is healthy."
      echo "[provision] Done!"
      exit 0
    fi
    echo "  attempt $i/12 (status: $status)..."
    sleep 5
  done
  echo "[provision] ERROR: whiteboard did not become healthy after 60s"
  exit 1
fi

# ────────────────────────────────────────────────────────────────────────────
# Remote mode — pushes the local working tree to the VPS, then re-invokes
# this same script with --local on the other side.
# ────────────────────────────────────────────────────────────────────────────
VPS_HOST="$ARG"
cd "$(dirname "$0")/../.." || { echo "Run from repo root"; exit 1; }

for cmd in ssh rsync; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    exit 1
  fi
done

echo "[provision:remote] Ensuring remote directories exist on $VPS_HOST..."
ssh "$VPS_HOST" "mkdir -p '$REMOTE_DIR/infra/vps' '$REMOTE_DIR/packages/whiteboard'"

echo "[provision:remote] Syncing infra configs to $VPS_HOST:$REMOTE_DIR..."
rsync -rlvtz --delete --no-owner --no-group \
  infra/vps/ \
  "$VPS_HOST:$REMOTE_DIR/infra/vps/" \
  --exclude caddy_data \
  --exclude secrets \
  --exclude .env \
  --exclude '.env.bak.*'

# Sync the whiteboard package — the only app code the VPS needs (for the
# Docker build of the tldraw sync server). Exclude client-only source trees
# that are not imported by the Bun server and should not land on the VPS.
echo "[provision:remote] Syncing whiteboard package..."
rsync -rlvtz --delete --no-owner --no-group \
  packages/whiteboard/ \
  "$VPS_HOST:$REMOTE_DIR/packages/whiteboard/" \
  --exclude node_modules \
  --exclude dist \
  --exclude bun.lockb \
  --exclude src/web \
  --exclude src/overrides \
  --exclude src/components

echo "[provision:remote] Invoking provision.sh --local on $VPS_HOST..."
ssh "$VPS_HOST" "cd $REMOTE_DIR && bash infra/vps/provision.sh --local"

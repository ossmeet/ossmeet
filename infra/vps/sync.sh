#!/bin/bash
# Sync infra/vps to VPS, template configs, validate compose, then restart services.
# When packages/whiteboard is present, also syncs the whiteboard server and secrets.
# Usage: bash infra/vps/sync.sh [VPS_HOST]

set -euo pipefail

cd "$(dirname "$0")/../.." || { echo "Run from repo root (e.g. ossmeet/)"; exit 1; }

# Use env var instead of hardcoded IP.
VPS_HOST="${1:-${VPS_HOST:?Set VPS_HOST env var (e.g. deploy@your-server-ip)}}"
REMOTE_DIR="/opt/ossmeet"

for cmd in ssh rsync; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    exit 1
  fi
done

# Root can run privileged commands directly; other users must have passwordless sudo.
if [[ "$VPS_HOST" == root || "$VPS_HOST" == root@* ]]; then
  REMOTE_SUDO=""
else
  REMOTE_SUDO="${REMOTE_SUDO:-sudo}"
fi

run_remote() {
  ssh "$VPS_HOST" "$1"
}

run_privileged_remote() {
  local cmd="$1"
  if [[ -n "$REMOTE_SUDO" ]]; then
    # Pass command via stdin to avoid quoting issues with special characters.
    printf '%s' "$cmd" | ssh "$VPS_HOST" "$REMOTE_SUDO bash -s"
  else
    run_remote "$cmd"
  fi
}

echo "Syncing to $VPS_HOST:$REMOTE_DIR..."

# Sync infrastructure configs (templates + compose)
rsync -avz --delete \
  infra/vps/ \
  "$VPS_HOST:$REMOTE_DIR/infra/vps/" \
  --exclude caddy_data \
  --exclude secrets \
  --exclude .env

# Whiteboard (only when the private package is present)
if [ -d "packages/whiteboard" ]; then
  echo "Provisioning whiteboard secrets..."
  run_remote "cd $REMOTE_DIR/infra/vps && \
    mkdir -p secrets && \
    chmod 700 secrets && \
    chmod 600 .env && \
    set -a && source .env && set +a && \
    : \"\${WHITEBOARD_INTERNAL_SECRET:?Missing WHITEBOARD_INTERNAL_SECRET in infra/vps/.env}\" && \
    : \"\${WHITEBOARD_JWT_SECRET:?Missing WHITEBOARD_JWT_SECRET in infra/vps/.env}\" && \
    umask 177 && \
    printf '%s' \"\$WHITEBOARD_INTERNAL_SECRET\" > secrets/whiteboard_internal_secret && \
    printf '%s' \"\$WHITEBOARD_JWT_SECRET\" > secrets/whiteboard_jwt_secret && \
    chmod 604 secrets/whiteboard_internal_secret secrets/whiteboard_jwt_secret"

  echo "Syncing whiteboard server source..."
  rsync -avz --delete \
    packages/whiteboard/ \
    "$VPS_HOST:$REMOTE_DIR/packages/whiteboard/" \
    --exclude node_modules \
    --exclude bun.lockb
else
  echo "Skipping whiteboard sync (packages/whiteboard not present)"
fi

# Template YAML configs with values from .env on the VPS
# Uses .tmpl source files so templates survive multiple runs
echo "Templating config files from .env..."
run_remote "cd $REMOTE_DIR/infra/vps && \
  chmod 600 .env && \
  set -a && source .env && set +a && \
  : \"\${LIVEKIT_API_KEY:?Missing LIVEKIT_API_KEY in infra/vps/.env}\" && \
  : \"\${LIVEKIT_API_SECRET:?Missing LIVEKIT_API_SECRET in infra/vps/.env}\" && \
  : \"\${REDIS_PASSWORD:?Missing REDIS_PASSWORD in infra/vps/.env}\" && \
  : \"\${R2_ACCESS_KEY_ID:?Missing R2_ACCESS_KEY_ID in infra/vps/.env}\" && \
  : \"\${R2_SECRET_ACCESS_KEY:?Missing R2_SECRET_ACCESS_KEY in infra/vps/.env}\" && \
  : \"\${R2_ENDPOINT:?Missing R2_ENDPOINT in infra/vps/.env}\" && \
  : \"\${R2_BUCKET_NAME:?Missing R2_BUCKET_NAME in infra/vps/.env}\" && \
  : \"\${LIVEKIT_WS_URL:?Missing LIVEKIT_WS_URL in infra/vps/.env}\" && \
  umask 077 && \
  envsubst '\${REDIS_PASSWORD} \${LIVEKIT_API_KEY} \${LIVEKIT_API_SECRET}' < livekit.yaml.tmpl > livekit.yaml.tmp && \
  envsubst '\${REDIS_PASSWORD} \${LIVEKIT_API_KEY} \${LIVEKIT_API_SECRET} \${LIVEKIT_WS_URL} \${R2_ACCESS_KEY_ID} \${R2_SECRET_ACCESS_KEY} \${R2_ENDPOINT} \${R2_BUCKET_NAME}' < egress.yaml.tmpl > egress.yaml.tmp && \
  mv livekit.yaml.tmp livekit.yaml && \
  mv egress.yaml.tmp egress.yaml && \
  chmod 600 .env && \
  chmod 644 livekit.yaml && \
  chmod 644 egress.yaml"

# Validate rendered compose before touching running services
echo "Validating docker compose config..."
run_remote "cd $REMOTE_DIR/infra/vps && \
  set -a && source .env && set +a && \
  docker compose config --quiet"

# Deploy sysctl tuning (requires root or passwordless sudo on VPS)
echo "Applying sysctl tuning..."
rsync -avz infra/vps/sysctl/ "$VPS_HOST:$REMOTE_DIR/infra/vps/sysctl/"
run_privileged_remote "cp $REMOTE_DIR/infra/vps/sysctl/*.conf /etc/sysctl.d/ && modprobe tcp_bbr && sysctl --system"

echo "Ensuring firewall rules..."
run_privileged_remote "if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp comment 'HTTP'
  ufw allow 443/tcp comment 'HTTPS'
  ufw allow 3478/udp comment 'TURN/UDP'
  ufw allow 7881/tcp comment 'WebRTC TCP fallback'
  ufw allow 7882/udp comment 'WebRTC UDP mux'
  ufw --force delete allow 443/udp >/dev/null 2>&1 || true
  ufw --force delete allow 5349/tcp >/dev/null 2>&1 || true
  # Allow Docker bridge networks to reach LiveKit (host networking) on the signal and TURN TLS ports
  ufw allow from 172.17.0.0/16 to any port 7880 comment 'LiveKit signal from Docker bridge'
  ufw allow from 172.19.0.0/16 to any port 7880 comment 'LiveKit signal from vps_internal bridge'
  ufw allow from 172.17.0.0/16 to any port 5350 comment 'LiveKit TURN TLS from Docker bridge'
  ufw allow from 172.19.0.0/16 to any port 5350 comment 'LiveKit TURN TLS from vps_internal bridge'
  # Prometheus metrics: internal access only — localhost + Docker subnets
  ufw allow from 127.0.0.1 to any port 6789 comment 'LiveKit Prometheus localhost'
  ufw allow from 172.17.0.0/16 to any port 6789 comment 'LiveKit Prometheus Docker bridge'
  ufw allow from 172.19.0.0/16 to any port 6789 comment 'LiveKit Prometheus vps_internal'
  ufw reload
else
  echo 'ufw not installed; skipping firewall configuration'
fi"

echo "Restarting services..."
run_remote "cd $REMOTE_DIR/infra/vps && \
  set -a && source .env && set +a && \
  docker compose up -d --build --remove-orphans"

echo "Done!"

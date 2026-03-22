#!/usr/bin/env bash
# Example fleet health check.
# Configure environment variables locally before using this script.

set -euo pipefail

LOG_DIR="${LOG_DIR:-$PWD/logs}"
LOG_FILE="${LOG_FILE:-$LOG_DIR/fleet-health.log}"
mkdir -p "$LOG_DIR"

ALERT_URL="${ALERT_URL:-}"
API_KEY="${API_KEY:-}"
GCP_PROJECT="${GCP_PROJECT:-}"
VM_TARGETS="${VM_TARGETS:-}"
GATEWAY_TARGETS="${GATEWAY_TARGETS:-}"
GATEWAY_HEALTH_URL="${GATEWAY_HEALTH_URL:-http://localhost:18789/}"
API_HEALTH_URL="${API_HEALTH_URL:-http://localhost:3000/}"
PM2_PROCESSES="${PM2_PROCESSES:-blather-api blather-web cognee-service}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-blather-db}"
POSTGRES_USER="${POSTGRES_USER:-blather}"
FAILURES=()
TIMESTAMP=$(date -u '+%Y-%m-%d %H:%M:%S UTC')

log() { echo "[$TIMESTAMP] $1" >> "$LOG_FILE"; }
fail() { FAILURES+=("$1"); log "FAIL: $1"; }
ok() { log "OK: $1"; }

# VM_TARGETS and GATEWAY_TARGETS should be space-separated entries in
# name:user:zone form, for example:
#   VM_TARGETS="api-box:deploy:us-central1-a"
check_vm() {
  local name="$1" user="$2" zone="$3"
  if [ -z "$GCP_PROJECT" ]; then
    fail "GCP_PROJECT is not configured for VM checks"
    return
  fi

  if gcloud compute ssh "${user}@${name}" --zone="$zone" --project="$GCP_PROJECT" \
    --command="echo OK" --ssh-flag="-o ConnectTimeout=5" --ssh-flag="-o StrictHostKeyChecking=no" \
    &>/dev/null; then
    ok "VM $name"
  else
    fail "VM $name unreachable (${zone})"
  fi
}

if [ -n "$VM_TARGETS" ]; then
  for target in $VM_TARGETS; do
    IFS=':' read -r name user zone <<EOF
$target
EOF
    check_vm "$name" "$user" "$zone"
  done
fi

check_gateway() {
  local name="$1" user="$2" zone="$3"
  local attempts=3 delay=5

  if [ -z "$GCP_PROJECT" ]; then
    fail "GCP_PROJECT is not configured for gateway checks"
    return
  fi

  for i in $(seq 1 $attempts); do
    if gcloud compute ssh "${user}@${name}" --zone="$zone" --project="$GCP_PROJECT" \
      --command="curl -sf --max-time 10 $GATEWAY_HEALTH_URL >/dev/null 2>&1" \
      --ssh-flag="-o ConnectTimeout=5" --ssh-flag="-o StrictHostKeyChecking=no" \
      &>/dev/null; then
      ok "Gateway $name"
      return
    fi
    [ $i -lt $attempts ] && sleep $delay
  done
  fail "Gateway $name not responding (after $attempts attempts)"
}

if [ -n "$GATEWAY_TARGETS" ]; then
  for target in $GATEWAY_TARGETS; do
    IFS=':' read -r name user zone <<EOF
$target
EOF
    check_gateway "$name" "$user" "$zone"
  done
fi

if curl -sf --max-time 10 "$API_HEALTH_URL" > /dev/null 2>&1; then
  ok "Blather API"
else
  fail "Blather API not responding"
fi

for proc in $PM2_PROCESSES; do
  status=$(pm2 jlist 2>/dev/null | jq -r ".[] | select(.name==\"$proc\") | .pm2_env.status" 2>/dev/null || echo "unknown")
  if [ "$status" = "online" ]; then
    ok "PM2 $proc"
  else
    fail "PM2 $proc status: $status"
  fi
done

if docker exec "$POSTGRES_CONTAINER" pg_isready -U "$POSTGRES_USER" &>/dev/null; then
  ok "Postgres"
else
  fail "Postgres not ready"
fi

# Disk usage
disk_pct=$(df / | awk 'NR==2 {gsub(/%/,""); print $5}')
if [ "$disk_pct" -gt 85 ]; then
  fail "Disk usage at ${disk_pct}%"
else
  ok "Disk ${disk_pct}%"
fi

# Memory
mem_avail=$(free -m | awk '/^Mem:/ {print $7}')
if [ "$mem_avail" -lt 500 ]; then
  fail "Low memory: ${mem_avail}MB available"
else
  ok "Memory ${mem_avail}MB available"
fi

# --- 3. Alert on failures ---
if [ ${#FAILURES[@]} -gt 0 ]; then
  if [ -n "$ALERT_URL" ] && [ -n "$API_KEY" ]; then
    summary=$(printf '• %s\\n' "${FAILURES[@]}")
    payload=$(jq -n --arg content "🚨 Fleet Alert (${TIMESTAMP}):\n${summary}" '{content: $content}')
    curl -sf -X POST "$ALERT_URL" \
      -H "X-API-Key: $API_KEY" \
      -H "Content-Type: application/json" \
      -d "$payload" > /dev/null 2>&1 || true
    log "ALERT SENT: ${#FAILURES[@]} failures"
  else
    log "Failures detected, but alert credentials are not configured"
  fi
else
  log "All checks passed"
fi

log "--- check complete ---"

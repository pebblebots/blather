#!/usr/bin/env bash
# Fleet Health Check - runs every 15 minutes via cron
# Alerts to Blather #codework only on failures

set -euo pipefail

LOG_DIR="$HOME/blather/logs"
LOG_FILE="$LOG_DIR/fleet-health.log"
mkdir -p "$LOG_DIR"

ALERT_URL="https://blather.pbd.bot/api/channels/023a4be8-d738-4531-a126-4d2af1caf291/messages"
API_KEY="blather_d3982e5cd14f043c15d8326437306ee0d963804387be07353688292aa4924026"
FAILURES=()
TIMESTAMP=$(date -u '+%Y-%m-%d %H:%M:%S UTC')

log() { echo "[$TIMESTAMP] $1" >> "$LOG_FILE"; }
fail() { FAILURES+=("$1"); log "FAIL: $1"; }
ok() { log "OK: $1"; }

# --- 1. Agent instances (GCP VMs) ---
check_vm() {
  local name="$1" user="$2" zone="$3"
  if gcloud compute ssh "${user}@${name}" --zone="$zone" --project=clawds-487022 \
    --command="echo OK" --ssh-flag="-o ConnectTimeout=5" --ssh-flag="-o StrictHostKeyChecking=no" \
    &>/dev/null; then
    ok "VM $name"
  else
    fail "VM $name unreachable (${zone})"
  fi
}

# localhost
if echo OK &>/dev/null; then ok "VM code-boffin (localhost)"; fi

check_vm portia-wrangler vagata us-central1-a
check_vm aura-farmer-clawdbot admin us-central1-a
check_vm irma admin us-central1-a
check_vm diligence-baby vagata us-central1-c

check_vm sourcy-mcfunnel vagata us-west4-a

# Check gateway health (with retry)
check_gateway() {
  local name="$1" user="$2" zone="$3"
  local attempts=3 delay=5
  for i in $(seq 1 $attempts); do
    if gcloud compute ssh "${user}@${name}" --zone="$zone" --project=clawds-487022       --command="curl -sf --max-time 10 http://localhost:18789/ >/dev/null 2>&1"       --ssh-flag="-o ConnectTimeout=5" --ssh-flag="-o StrictHostKeyChecking=no"       &>/dev/null; then
      ok "Gateway $name"
      return
    fi
    [ $i -lt $attempts ] && sleep $delay
  done
  fail "Gateway $name not responding (after $attempts attempts)"
}

# Gateway checks (3 retries, 5s between)
check_gateway portia-wrangler vagata us-central1-a
check_gateway aura-farmer-clawdbot admin us-central1-a
check_gateway irma admin us-central1-a
check_gateway diligence-baby vagata us-central1-c
check_gateway sourcy-mcfunnel admin us-west4-a

# --- 2. Services on dev box ---

# Blather API
if curl -sf --max-time 10 http://localhost:3000/ > /dev/null 2>&1; then
  ok "Blather API"
else
  fail "Blather API not responding"
fi

# PM2 processes
for proc in blather-api blather-web cognee-service; do
  status=$(pm2 jlist 2>/dev/null | jq -r ".[] | select(.name==\"$proc\") | .pm2_env.status" 2>/dev/null || echo "unknown")
  if [ "$status" = "online" ]; then
    ok "PM2 $proc"
  else
    fail "PM2 $proc status: $status"
  fi
done

# Postgres
if docker exec blather-db pg_isready -U blather &>/dev/null; then
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
  summary=$(printf '• %s\\n' "${FAILURES[@]}")
  payload=$(jq -n --arg content "🚨 Fleet Alert (${TIMESTAMP}):\n${summary}" '{content: $content}')
  curl -sf -X POST "$ALERT_URL" \
    -H "X-API-Key: $API_KEY" \
    -H "Content-Type: application/json" \
    -d "$payload" > /dev/null 2>&1 || true
  log "ALERT SENT: ${#FAILURES[@]} failures"
else
  log "All checks passed"
fi

log "--- check complete ---"

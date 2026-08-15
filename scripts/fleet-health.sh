#!/usr/bin/env bash
# Fleet Health Check - runs every 15 minutes via cron
# Alerts to Blather #codework only on failures

set -euo pipefail

LOG_DIR="$HOME/blather/logs"
LOG_FILE="$LOG_DIR/fleet-health.log"
mkdir -p "$LOG_DIR"

ALERT_URL="https://blather.pbd.bot/api/channels/023a4be8-d738-4531-a126-4d2af1caf291/messages"
API_KEY="${BLATHER_API_KEY:?BLATHER_API_KEY environment variable is required}"
FAILURES=()
TIMESTAMP=$(date -u '+%Y-%m-%d %H:%M:%S UTC')
START_S=$(date +%s)
SCRIPT_VERSION="$(git -C "$HOME/blather" rev-parse --short HEAD 2>/dev/null || stat -c %Y "$0" 2>/dev/null || echo unknown)"
LAST_GOOD_FILE="$LOG_DIR/fleet-health.last-good"
LAST_GOOD="$(cat "$LAST_GOOD_FILE" 2>/dev/null || echo never)"


# --- Snooze support ---
# Touch /home/code/blather/snooze/<host>.until with a YYYY-MM-DDTHH:MM:SSZ to suppress
# that host's checks until then. Posts ONE notice when starting a snooze window.
SNOOZE_DIR="/home/code/blather/snooze"
mkdir -p "$SNOOZE_DIR"
snoozed() {
  local host="$1"
  local f="$SNOOZE_DIR/$host.until"
  [ -f "$f" ] || return 1
  local until_ts="$(cat "$f" 2>/dev/null)"
  [ -z "$until_ts" ] && return 1
  local until_s now_s
  until_s=$(date -d "$until_ts" +%s 2>/dev/null) || return 1
  now_s=$(date -u +%s)
  if [ "$now_s" -lt "$until_s" ]; then
    log "SNOOZED: $host (until $until_ts)"
    return 0
  else
    # expired — remove and resume
    rm -f "$f"
    log "SNOOZE EXPIRED: $host (resuming checks)"
    return 1
  fi
}

snooze_state() {
  local out="" f host ts
  for f in "$SNOOZE_DIR"/*.until; do
    [ -f "$f" ] || { echo "none"; return; }
    host="${f##*/}"; host="${host%.until}"
    ts="$(cat "$f" 2>/dev/null)"
    out+="${host}->${ts} "
  done
  [ -n "$out" ] && echo "$out" || echo "none"
}

log() { echo "[$TIMESTAMP] $1" >> "$LOG_FILE"; }
fail() { FAILURES+=("$1"); log "FAIL: $1"; }
ok() { log "OK: $1"; }

# --- 1. Agent instances (GCP VMs) ---
# Retry with backoff: 3 attempts, 5s delay between.
# Rationale: single transient gcloud-ssh blips were pageing #alerts as false positives
# (e.g. aura-farmer 2026-04-29 incident: VM was healthy 53 days, paged 3x over 30min
# for a single-shot probe timeout). Matches check_gateway's pattern below.
check_vm() {
  local name="$1" user="$2" zone="$3"
  local attempts=3 delay=5
  for i in $(seq 1 $attempts); do
    if gcloud compute ssh "${user}@${name}" --zone="$zone" --project=clawds-487022 \
      --command="echo OK" --ssh-flag="-o ConnectTimeout=5" --ssh-flag="-o StrictHostKeyChecking=no" \
      &>/dev/null; then
      ok "VM $name"
      return
    fi
    [ $i -lt $attempts ] && sleep $delay
  done
  fail "VM $name unreachable (${zone}) after $attempts attempts"
}

# localhost
if echo OK &>/dev/null; then ok "VM code-boffin (localhost)"; fi

snoozed portia-wrangler || check_vm portia-wrangler vagata us-central1-a
check_vm aura-farmer-clawdbot admin us-central1-a
snoozed irma || check_vm irma admin us-central1-a
snoozed diligence-baby || check_vm diligence-baby vagata us-central1-c

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
snoozed portia-wrangler || check_gateway portia-wrangler vagata us-central1-a
check_gateway aura-farmer-clawdbot admin us-central1-a
snoozed irma || check_gateway irma admin us-central1-a
snoozed diligence-baby || check_gateway diligence-baby vagata us-central1-c
check_gateway sourcy-mcfunnel admin us-west4-a

# --- 2. Services on dev box ---

# Blather API (retry: 3 attempts, 3s delay — probe is local, keep it snappy)
check_blather_api() {
  local attempts=3 delay=3
  for i in $(seq 1 $attempts); do
    if curl -sf --max-time 10 http://localhost:3000/ > /dev/null 2>&1; then
      ok "Blather API"
      return
    fi
    [ $i -lt $attempts ] && sleep $delay
  done
  fail "Blather API not responding after $attempts attempts"
}
check_blather_api

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
  snooze_info="$(snooze_state)"
  duration_s=$(( $(date +%s) - START_S ))
  content="🚨 Fleet Alert (${TIMESTAMP})\nscript: ${SCRIPT_VERSION}\nlast-good: ${LAST_GOOD}\nsnoozed: ${snooze_info}\nduration: ${duration_s}s\n${summary}"
  payload=$(jq -n --arg content "$content" '{content: $content}')
  curl -sf -X POST "$ALERT_URL" \
    -H "X-API-Key: $API_KEY" \
    -H "Content-Type: application/json" \
    -d "$payload" > /dev/null 2>&1 || true
  log "ALERT SENT: ${#FAILURES[@]} failures"
else
  date -u '+%Y-%m-%d %H:%M:%S UTC' > "$LAST_GOOD_FILE"
  log "All checks passed"
fi

log "--- check complete ---"

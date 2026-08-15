#!/usr/bin/env bash
# Regression guard: fails if fleet-health.sh lacks required subsystems.
# T#204 — snooze was "only ever in the working tree" and was lost to a git-stash
# mislabel on 2026-07-31, silently disabling snooze for ~4 days (false alerts).
# T#203 — spec was marked done without shipping: attempts stayed at 3, no
# consecutive-failed-tick gate, no per-attempt status capture. This guard now
# encodes the FULL spec so `@tasks done` can't close what didn't land.
set -euo pipefail

SCRIPT="${1:-scripts/fleet-health.sh}"
MIN_GUARDS=6
MIN_ATTEMPTS=5

[ -f "$SCRIPT" ] || { echo "REG-GUARD FAIL: missing $SCRIPT" >&2; exit 1; }

fail() { echo "REG-GUARD FAIL: $1" >&2; exit 1; }

# 1. snoozed() function definition must exist
grep -Eq '^snoozed\(\)[[:space:]]*\{' "$SCRIPT" \
  || fail "snoozed() function definition not found in $SCRIPT"

# 2. At least MIN_GUARDS 'snoozed <host> ||' guards
guards="$(grep -Ec 'snoozed[[:space:]][a-z0-9-]+[[:space:]]*\|\|' "$SCRIPT" || true)"
[ "$guards" -ge "$MIN_GUARDS" ] \
  || fail "$guards snoozed guards (need >= $MIN_GUARDS) in $SCRIPT"

# 3. Probe retry budget must be >= MIN_ATTEMPTS attempts (T#203)
#    Catches 'attempts=3' regressions. check_blather_api legitimately uses 3
#    (local probe), so this only asserts the remote probes (check_vm/check_gateway).
vm_attempts="$(sed -n '/^check_vm()/,/^}/p' "$SCRIPT" | grep -oE 'local attempts=[0-9]+' | grep -oE '[0-9]+' | head -1)"
gw_attempts="$(sed -n '/^check_gateway()/,/^}/p' "$SCRIPT" | grep -oE 'local attempts=[0-9]+' | grep -oE '[0-9]+' | head -1)"
[ -n "$vm_attempts" ] && [ "$vm_attempts" -ge "$MIN_ATTEMPTS" ] \
  || fail "check_vm retry budget ${vm_attempts:-missing} (need >= $MIN_ATTEMPTS)"
[ -n "$gw_attempts" ] && [ "$gw_attempts" -ge "$MIN_ATTEMPTS" ] \
  || fail "check_gateway retry budget ${gw_attempts:-missing} (need >= $MIN_ATTEMPTS)"

# 4. Consecutive-failed-tick gate must be present (T#203)
grep -Eq 'CONSEC_FILE|consecutive' "$SCRIPT" \
  || fail "consecutive-failed-tick gate not found (T#203)"

# 5. Per-attempt HTTP status capture must be present (T#203)
grep -Eq 'http_code|time_total' "$SCRIPT" \
  || fail "per-attempt HTTP status capture not found (T#203)"

echo "REG-GUARD OK: snoozed() + $guards guards, attempts=$vm_attempts/$gw_attempts, consecutive gate, status capture"

#!/usr/bin/env bash
# Regression guard: fails if fleet-health.sh lacks the snooze subsystem.
# T#204 — snooze was "only ever in the working tree" and was lost to a git-stash
# mislabel on 2026-07-31, silently disabling snooze for ~4 days (false alerts).
set -euo pipefail

SCRIPT="${1:-scripts/fleet-health.sh}"
MIN_GUARDS=6

[ -f "$SCRIPT" ] || { echo "REG-GUARD FAIL: missing $SCRIPT" >&2; exit 1; }

# 1. snoozed() function definition must exist
if ! grep -Eq '^snoozed\(\)[[:space:]]*\{' "$SCRIPT"; then
  echo "REG-GUARD FAIL: snoozed() function definition not found in $SCRIPT" >&2
  exit 1
fi

# 2. At least MIN_GUARDS 'snoozed <host> ||' guards
guards="$(grep -Ec 'snoozed[[:space:]][a-z0-9-]+[[:space:]]*\|\|' "$SCRIPT" || true)"
if [ "$guards" -lt "$MIN_GUARDS" ]; then
  echo "REG-GUARD FAIL: $guards snoozed guards (need >= $MIN_GUARDS) in $SCRIPT" >&2
  exit 1
fi

echo "REG-GUARD OK: snoozed() present, $guards snoozed guards (>= $MIN_GUARDS)"

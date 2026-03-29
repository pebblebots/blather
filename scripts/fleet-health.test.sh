#!/usr/bin/env bash
# Tests for fleet-health.sh — verifies no hardcoded secrets
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$SCRIPT_DIR/fleet-health.sh"
FAILURES=0

fail() { echo "FAIL: $1"; FAILURES=$((FAILURES + 1)); }
pass() { echo "PASS: $1"; }

# Test 1: No hardcoded API key in the script
if grep -qE 'API_KEY="blather_[0-9a-f]' "$SCRIPT"; then
  fail "Script contains a hardcoded API key"
else
  pass "No hardcoded API key found"
fi

# Test 2: Script reads API key from environment variable
if grep -q 'BLATHER_API_KEY' "$SCRIPT"; then
  pass "Script references BLATHER_API_KEY env var"
else
  fail "Script does not reference BLATHER_API_KEY env var"
fi

# Test 3: Script fails when BLATHER_API_KEY is not set
unset BLATHER_API_KEY 2>/dev/null || true
if output=$(bash "$SCRIPT" 2>&1); then
  fail "Script should fail when BLATHER_API_KEY is not set"
else
  pass "Script exits with error when BLATHER_API_KEY is not set"
fi

if [ "$FAILURES" -gt 0 ]; then
  echo "$FAILURES test(s) failed"
  exit 1
fi

echo "All tests passed"

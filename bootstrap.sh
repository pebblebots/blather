#!/usr/bin/env bash
set -euo pipefail

# ─── Colors & helpers ────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

log()  { printf "${BLUE}[%s]${RESET} %s\n" "$(date '+%H:%M:%S')" "$*"; }
ok()   { printf "${GREEN}[%s] ✓${RESET} %s\n" "$(date '+%H:%M:%S')" "$*"; }
warn() { printf "${YELLOW}[%s] ⚠${RESET} %s\n" "$(date '+%H:%M:%S')" "$*"; }
err()  { printf "${RED}[%s] ✗${RESET} %s\n" "$(date '+%H:%M:%S')" "$*"; }
step() { printf "\n${BOLD}${CYAN}── %s ──${RESET}\n\n" "$*"; }

bail() { err "$*"; exit 1; }

# ─── Preamble ────────────────────────────────────────────────────────────────

printf "\n${BOLD}${CYAN}"
cat << 'BANNER'
  ____  _       _   _
 | __ )| | __ _| |_| |__   ___ _ __
 |  _ \| |/ _` | __| '_ \ / _ \ '__|
 | |_) | | (_| | |_| | | |  __/ |
 |____/|_|\__,_|\__|_| |_|\___|_|

BANNER
printf "${RESET}"
log "Starting Blather bootstrap..."
log "Working directory: $(pwd)"
log "Date: $(date)"
log "User: $(whoami)"
log "Shell: $SHELL"
echo ""

# ─── Check Node.js ───────────────────────────────────────────────────────────

step "Checking Node.js"

if command -v node &>/dev/null; then
  NODE_VERSION=$(node --version)
  ok "Node.js found: $NODE_VERSION"
  NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_MAJOR" -lt 22 ]; then
    warn "Node.js 22+ is recommended (found $NODE_VERSION)"
    warn "Things may still work, but you're on your own"
  else
    ok "Node.js version is 22+ — good"
  fi
else
  bail "Node.js is not installed. Please install Node.js 22+ and try again."
fi

# ─── Check/install pnpm ─────────────────────────────────────────────────────

step "Checking pnpm"

if command -v pnpm &>/dev/null; then
  PNPM_VERSION=$(pnpm --version)
  ok "pnpm found: v$PNPM_VERSION"
else
  warn "pnpm is not installed"
  log "Attempting to install pnpm via npm..."
  if npm install -g pnpm 2>&1; then
    ok "pnpm installed via npm: v$(pnpm --version)"
  elif command -v corepack &>/dev/null; then
    log "npm install failed — trying corepack as fallback..."
    if corepack enable && corepack prepare pnpm@latest --activate 2>&1; then
      ok "pnpm installed via corepack: v$(pnpm --version)"
    else
      bail "Could not install pnpm via npm or corepack. Install it manually: npm i -g pnpm"
    fi
  else
    bail "Could not install pnpm. Install it manually: npm i -g pnpm"
  fi
fi

# ─── Install dependencies ───────────────────────────────────────────────────

step "Installing dependencies"

log "Running pnpm install..."
log "This may take a minute on first run (downloading packages)"
echo ""

if pnpm install; then
  ok "All dependencies installed successfully"
else
  bail "pnpm install failed — check the output above"
fi

echo ""
log "Listing workspace packages:"
pnpm ls --depth 0 -r 2>/dev/null | while IFS= read -r line; do
  printf "  %s\n" "$line"
done

# ─── Build ───────────────────────────────────────────────────────────────────

step "Building all packages"

for pkg in types db api web; do
  log "Building @blather/$pkg..."
  if pnpm --filter "@blather/$pkg" run build 2>&1; then
    ok "@blather/$pkg built"
  else
    bail "@blather/$pkg build failed — check the output above"
  fi
done

ok "All packages built successfully"

# ─── Summary ─────────────────────────────────────────────────────────────────

step "Bootstrap complete"

printf "${GREEN}${BOLD}"
cat << 'DONE'
  Node environment is ready!
DONE
printf "${RESET}\n"

log "Node.js:  $(node --version)"
log "pnpm:     v$(pnpm --version)"
log "Packages: types, db, api, web — all built"
echo ""
log "Next: run /setup to configure database, environment, and optional services"
log "Done! Total bootstrap time: ${SECONDS}s"

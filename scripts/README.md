# Blather Scripts

This directory contains automation scripts and utilities for Blather.

## Available Scripts

### Attio Portfolio Sync
Automated sync from Attio CRM to portfolio_metrics table.

- `attio-sync.ts` - Main sync script
- `setup-attio-sync.sh` - Installation and setup
- `attio-sync.service` - Systemd service file
- `attio-sync.timer` - Systemd timer for scheduling

**Usage:**
```bash
# One-time setup
./setup-attio-sync.sh

# Manual sync
npm run attio-sync
npm run attio-sync:dry-run
```

See [../docs/attio-sync.md](../docs/attio-sync.md) for detailed documentation.

### Fleet Health Check
System health monitoring script.

- `fleet-health.sh` - Health check script
- `fleet-health.test.sh` - Tests for health check

## Adding New Scripts

1. Create executable script in this directory
2. Add npm script in `package.json` if needed
3. Document in this README
4. Create systemd service/timer if automated
5. Add setup instructions
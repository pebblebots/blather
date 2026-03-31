#!/bin/bash

#
# Attio Sync Setup Script
# Sets up automated portfolio sync from Attio to Blather
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "🔧 Setting up Attio Portfolio Sync automation..."

# Check if running as root for systemd installation
if [[ $EUID -eq 0 ]]; then
    SUDO=""
else
    SUDO="sudo"
fi

# Check prerequisites
if ! command -v npm &> /dev/null; then
    echo "❌ npm is required but not installed"
    exit 1
fi

if ! command -v systemctl &> /dev/null; then
    echo "❌ systemd is required for automated scheduling"
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
cd "$PROJECT_ROOT"
npm install

# Check for environment variables
echo "🔍 Checking configuration..."
ENV_FILE="$PROJECT_ROOT/.env"

if [[ ! -f "$ENV_FILE" ]]; then
    echo "⚠️  Creating .env file template..."
    cat > "$ENV_FILE" << EOF
# Attio API Configuration
ATTIO_API_KEY=your_attio_api_key_here
ATTIO_API_URL=https://api.attio.com/v2
ATTIO_WORKSPACE_ID=your_workspace_id
ATTIO_PORTFOLIO_LIST_ID=your_portfolio_list_id

# Database Configuration
DATABASE_URL=postgresql://user:password@localhost:5432/blather

# Sync Configuration
SYNC_BATCH_SIZE=50
# SYNC_DRY_RUN=true  # Uncomment for dry run mode
EOF
    echo "📝 Created .env file template at $ENV_FILE"
    echo "⚠️  Please update the .env file with your actual Attio API credentials"
fi

# Test the sync script
echo "🧪 Testing sync script..."
if npm run attio-sync:dry-run; then
    echo "✅ Sync script test passed"
else
    echo "❌ Sync script test failed - please check your configuration"
    exit 1
fi

# Install systemd service and timer
echo "⚙️  Installing systemd service and timer..."

# Copy service files
$SUDO cp "$SCRIPT_DIR/attio-sync.service" /etc/systemd/system/
$SUDO cp "$SCRIPT_DIR/attio-sync.timer" /etc/systemd/system/

# Set proper permissions
$SUDO chmod 644 /etc/systemd/system/attio-sync.service
$SUDO chmod 644 /etc/systemd/system/attio-sync.timer

# Reload systemd and enable timer
$SUDO systemctl daemon-reload
$SUDO systemctl enable attio-sync.timer
$SUDO systemctl start attio-sync.timer

echo "✅ Setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Update .env file with your Attio API credentials"
echo "2. Test the sync manually: npm run attio-sync:dry-run"
echo "3. Run first sync: npm run attio-sync"
echo ""
echo "🔧 Management commands:"
echo "  Check timer status: sudo systemctl status attio-sync.timer"
echo "  View sync logs:    sudo journalctl -u attio-sync.service -f"
echo "  Stop automation:   sudo systemctl stop attio-sync.timer"
echo "  Start automation:  sudo systemctl start attio-sync.timer"
echo ""
echo "⏰ Sync will run automatically every 6 hours at 00:00, 06:00, 12:00, and 18:00"
# Attio Portfolio Sync Automation

This documentation describes the automated sync pipeline that replaces manual portfolio.json synchronization by pulling data directly from Attio CRM into Blather's portfolio_metrics table.

## Overview

The Attio sync automation consists of:
- **Sync script** (`scripts/attio-sync.ts`) - Core sync logic
- **Systemd service** - Automated scheduling every 6 hours
- **Setup script** (`scripts/setup-attio-sync.sh`) - One-time installation
- **API integration** - Direct connection to Attio CRM

## Quick Start

1. **Get Attio API credentials** from Boss/Pam
2. **Run setup script**:
   ```bash
   ./scripts/setup-attio-sync.sh
   ```
3. **Configure credentials** in `.env` file
4. **Test sync**:
   ```bash
   npm run attio-sync:dry-run
   ```
5. **Run first sync**:
   ```bash
   npm run attio-sync
   ```

## Configuration

### Environment Variables

Create or update `.env` file in project root:

```bash
# Attio API Configuration
ATTIO_API_KEY=your_attio_api_key_here
ATTIO_API_URL=https://api.attio.com/v2
ATTIO_WORKSPACE_ID=your_workspace_id
ATTIO_PORTFOLIO_LIST_ID=your_portfolio_list_id

# Database Configuration
DATABASE_URL=postgresql://user:password@localhost:5432/blather

# Sync Configuration
SYNC_BATCH_SIZE=50                # Records to process per batch
# SYNC_DRY_RUN=true              # Uncomment for dry run mode
```

### Required Attio Credentials

Contact Boss or Pam for:
- **API Key**: Authentication token for Attio API
- **Workspace ID**: Your organization's Attio workspace
- **Portfolio List ID**: The specific list/table containing portfolio company data

## Usage

### Manual Sync Commands

```bash
# Preview changes without modifying data
npm run attio-sync:dry-run

# Run full sync
npm run attio-sync

# Run sync with custom environment
SYNC_BATCH_SIZE=10 npm run attio-sync
```

### Automation Management

The sync runs automatically every 6 hours. Use these commands to manage:

```bash
# Check automation status
sudo systemctl status attio-sync.timer

# View sync logs
sudo journalctl -u attio-sync.service -f

# Stop automation
sudo systemctl stop attio-sync.timer

# Start automation
sudo systemctl start attio-sync.timer

# Run sync manually (outside schedule)
sudo systemctl start attio-sync.service
```

## Data Mapping

The sync transforms Attio company records to portfolio_metrics format:

| Attio Field | Portfolio Metrics Field | Notes |
|-------------|-------------------------|-------|
| Company Name | `company_name` | Primary identifier |
| Fund | `fund` | Fund/portfolio association |
| ARR | `revenue_arr_usd` | Annual recurring revenue |
| Headcount | `headcount` | Employee count |
| Runway | `runway_months` | Cash runway in months |
| Growth Rate | `yoy_growth_pct` | Year-over-year growth |
| Last Round Size | `last_round_size_usd` | Funding round amount |
| Valuation | `last_round_valuation_usd` | Company valuation |
| Round Date | `last_round_date` | Date of last funding |
| Round Type | `last_round_type` | Series A, B, Seed, etc. |

## Error Handling

### Common Issues

**Missing API credentials**:
```
Error: ATTIO_API_KEY environment variable is required
```
→ Update `.env` file with valid credentials

**Database connection failure**:
```
Error: Could not connect to database
```
→ Check `DATABASE_URL` in `.env`

**Attio API errors**:
```
Attio API error: 401 Unauthorized
```
→ Verify API key is valid and has proper permissions

### Monitoring

View sync logs in real-time:
```bash
sudo journalctl -u attio-sync.service -f
```

Check last sync results:
```bash
sudo journalctl -u attio-sync.service --since "1 day ago"
```

## Development

### Testing

Run dry-run mode to test without modifying data:
```bash
npm run attio-sync:dry-run
```

### Modifying Sync Logic

1. Edit `scripts/attio-sync.ts`
2. Test changes with dry-run
3. Update data mapping in `transformAttioToPortfolioMetrics()`
4. Restart automation: `sudo systemctl restart attio-sync.timer`

### Debugging

Enable verbose logging by setting `DEBUG=true` in environment.

Check sync status:
```sql
-- View recent sync results
SELECT 
  source, 
  COUNT(*) as records,
  MAX(updated_at) as last_sync
FROM portfolio_metrics 
WHERE source = 'attio-sync'
GROUP BY source;
```

## Security

- API credentials are stored in `.env` file (not committed to git)
- Systemd service runs as `code` user (not root)
- Database connections use environment variables
- All API requests use HTTPS

## Maintenance

### Regular Tasks

- Monitor sync logs for errors
- Verify data accuracy monthly
- Update Attio API credentials as needed
- Review sync frequency (currently 6 hours)

### Troubleshooting

If sync stops working:
1. Check systemd timer status
2. Verify Attio API credentials
3. Test database connection
4. Review error logs
5. Run manual dry-run to diagnose

For urgent issues during LP draft week, run manual sync:
```bash
npm run attio-sync
```

## Migration Notes

This automation replaces Pam's manual portfolio.json sync process:
- ✅ Eliminates manual copy/paste work
- ✅ Reduces data staleness from days to hours
- ✅ Provides audit trail in database
- ✅ Supports rollback and error recovery
- ✅ Scales with portfolio growth

The old manual process can be retired once this automation is stable and validated.
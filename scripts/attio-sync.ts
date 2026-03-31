#!/usr/bin/env tsx

/**
 * Attio Portfolio Sync Script
 * 
 * Replaces manual portfolio.json sync by automatically pulling data from Attio CRM
 * and inserting/updating records in the portfolio_metrics table.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, and } from 'drizzle-orm';

// Configuration from environment variables
const config = {
  attio: {
    apiUrl: process.env.ATTIO_API_URL || 'https://api.attio.com/v2',
    apiKey: process.env.ATTIO_API_KEY,
    workspaceId: process.env.ATTIO_WORKSPACE_ID,
    listId: process.env.ATTIO_PORTFOLIO_LIST_ID, // The list/table containing portfolio companies
  },
  database: {
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/blather',
  },
  sync: {
    dryRun: process.env.SYNC_DRY_RUN === 'true',
    batchSize: parseInt(process.env.SYNC_BATCH_SIZE || '50'),
    source: 'attio-sync' as const,
  }
};

// Attio API client
class AttioClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  private async request(endpoint: string, options: RequestInit = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`Attio API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async getPortfolioCompanies(listId: string) {
    // TODO: Replace with actual Attio API endpoint once we get the docs
    return this.request(`/objects/lists/${listId}/records`);
  }

  async getCompanyDetails(companyId: string) {
    return this.request(`/objects/companies/${companyId}`);
  }
}

// Data transformation utilities
interface AttioCompanyRecord {
  // TODO: Define based on actual Attio response structure
  id: string;
  name: string;
  fund: string;
  // Add other fields as needed
}

interface PortfolioMetricsData {
  companyName: string;
  fund: string;
  reportingDate: string;
  revenueArrUsd: string;
  revenueAsOfDate?: string | null;
  headcount?: number | null;
  runwayMonths?: string | null;
  yoyGrowthPct?: string | null;
  lastRoundSizeUsd?: string | null;
  lastRoundValuationUsd?: string | null;
  lastRoundDate?: string | null;
  lastRoundType?: string | null;
  keyMilestoneText?: string | null;
  nextFundraiseTiming?: string | null;
  contactEmail?: string | null;
  permissionToShare: boolean;
  source: string;
  confidence?: string | null;
}

function transformAttioToPortfolioMetrics(attioRecord: AttioCompanyRecord): PortfolioMetricsData {
  // TODO: Implement transformation based on Attio data structure
  return {
    companyName: attioRecord.name,
    fund: attioRecord.fund,
    reportingDate: new Date().toISOString().split('T')[0], // Today's date as placeholder
    revenueArrUsd: '0', // Will need to map from Attio fields
    permissionToShare: false,
    source: config.sync.source,
    confidence: '1.0',
  };
}

// Simplified portfolio metrics schema for the script
// This avoids complex import path issues
const portfolioMetrics = {
  // Table reference - we'll use raw SQL for now until proper imports work
}

// Main sync logic
async function syncPortfolioData() {
  console.log('🔄 Starting Attio portfolio sync...');

  // Validate configuration
  if (!config.attio.apiKey) {
    throw new Error('ATTIO_API_KEY environment variable is required');
  }

  // Initialize clients
  const attioClient = new AttioClient(config.attio.apiKey, config.attio.apiUrl);
  const sql = postgres(config.database.connectionString);
  const db = drizzle(sql);

  try {
    // Fetch portfolio companies from Attio
    console.log('📥 Fetching portfolio companies from Attio...');
    const portfolioList = await attioClient.getPortfolioCompanies(config.attio.listId || 'default');
    
    // TODO: Handle pagination if Attio returns paginated results
    const companies = portfolioList.records || portfolioList.data || portfolioList;
    console.log(`Found ${companies.length} portfolio companies`);

    let insertedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    // Process companies in batches
    for (let i = 0; i < companies.length; i += config.sync.batchSize) {
      const batch = companies.slice(i, i + config.sync.batchSize);
      console.log(`Processing batch ${Math.floor(i / config.sync.batchSize) + 1}/${Math.ceil(companies.length / config.sync.batchSize)}`);

      for (const attioCompany of batch) {
        try {
          // Transform Attio data to our portfolio metrics format
          const metricsData = transformAttioToPortfolioMetrics(attioCompany);

          if (config.sync.dryRun) {
            console.log(`[DRY RUN] Would sync: ${metricsData.companyName} (${metricsData.fund})`);
            continue;
          }

          // Check if record already exists (using raw SQL for now)
          const existingResult = await sql`
            SELECT id FROM portfolio_metrics 
            WHERE company_name = ${metricsData.companyName} 
            AND fund = ${metricsData.fund} 
            AND reporting_date = ${metricsData.reportingDate}
            LIMIT 1
          `;

          if (existingResult.length > 0) {
            // Update existing record
            await sql`
              UPDATE portfolio_metrics 
              SET 
                revenue_arr_usd = ${metricsData.revenueArrUsd},
                revenue_as_of_date = ${metricsData.revenueAsOfDate},
                headcount = ${metricsData.headcount},
                runway_months = ${metricsData.runwayMonths},
                yoy_growth_pct = ${metricsData.yoyGrowthPct},
                last_round_size_usd = ${metricsData.lastRoundSizeUsd},
                last_round_valuation_usd = ${metricsData.lastRoundValuationUsd},
                last_round_date = ${metricsData.lastRoundDate},
                last_round_type = ${metricsData.lastRoundType},
                key_milestone_text = ${metricsData.keyMilestoneText},
                next_fundraise_timing = ${metricsData.nextFundraiseTiming},
                contact_email = ${metricsData.contactEmail},
                permission_to_share = ${metricsData.permissionToShare},
                confidence = ${metricsData.confidence},
                updated_at = NOW()
              WHERE id = ${existingResult[0].id}
            `;
            
            updatedCount++;
            console.log(`✅ Updated: ${metricsData.companyName}`);
          } else {
            // Insert new record
            await sql`
              INSERT INTO portfolio_metrics (
                company_name, fund, reporting_date, revenue_arr_usd, revenue_as_of_date,
                headcount, runway_months, yoy_growth_pct, last_round_size_usd, 
                last_round_valuation_usd, last_round_date, last_round_type,
                key_milestone_text, next_fundraise_timing, contact_email,
                permission_to_share, source, confidence
              ) VALUES (
                ${metricsData.companyName}, ${metricsData.fund}, ${metricsData.reportingDate},
                ${metricsData.revenueArrUsd}, ${metricsData.revenueAsOfDate}, ${metricsData.headcount},
                ${metricsData.runwayMonths}, ${metricsData.yoyGrowthPct}, ${metricsData.lastRoundSizeUsd},
                ${metricsData.lastRoundValuationUsd}, ${metricsData.lastRoundDate}, ${metricsData.lastRoundType},
                ${metricsData.keyMilestoneText}, ${metricsData.nextFundraiseTiming}, ${metricsData.contactEmail},
                ${metricsData.permissionToShare}, ${metricsData.source}, ${metricsData.confidence}
              )
            `;
            
            insertedCount++;
            console.log(`🆕 Inserted: ${metricsData.companyName}`);
          }
        } catch (error) {
          console.error(`❌ Error processing company ${attioCompany.name}:`, error);
          skippedCount++;
        }
      }

      // Small delay between batches to be API-friendly
      if (i + config.sync.batchSize < companies.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log('✅ Sync completed!');
    console.log(`📊 Results: ${insertedCount} inserted, ${updatedCount} updated, ${skippedCount} skipped`);
    
  } catch (error) {
    console.error('💥 Sync failed:', error);
    throw error;
  } finally {
    await sql.end();
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Attio Portfolio Sync Script

Usage: npm run attio-sync [options]

Options:
  --dry-run     Show what would be synced without making changes
  --help, -h    Show this help message

Environment Variables:
  ATTIO_API_KEY              Attio API key (required)
  ATTIO_API_URL              Attio API base URL (default: https://api.attio.com/v2)
  ATTIO_WORKSPACE_ID         Attio workspace ID
  ATTIO_PORTFOLIO_LIST_ID    Attio list/table ID containing portfolio companies
  DATABASE_URL               PostgreSQL connection string
  SYNC_DRY_RUN              Set to 'true' for dry run mode
  SYNC_BATCH_SIZE           Number of records to process at once (default: 50)

Examples:
  npm run attio-sync              # Run full sync
  npm run attio-sync --dry-run    # Preview what would be synced
`);
    return;
  }

  if (args.includes('--dry-run')) {
    config.sync.dryRun = true;
    console.log('🔍 Running in DRY RUN mode - no data will be modified');
  }

  try {
    await syncPortfolioData();
  } catch (error) {
    console.error('💥 Sync failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { syncPortfolioData, AttioClient };
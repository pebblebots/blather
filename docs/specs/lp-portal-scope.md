# T#112: LP Portal / Reporting Layer — Scope

**Status:** Scoping  
**Author:** Code Boffin  
**Date:** 2026-04-08  

## Context

Portfolio metrics API already merged to main (branch `feature/portfolio-metrics`). Current endpoints:
- `GET /api/metrics` — list with filters (fund, company_name, date_from, date_to)
- `GET /api/metrics/:id` — single metric
- `GET /api/metrics/export` — export with summary stats (JSON, CSV, Markdown formats)
- `POST /api/metrics` — create
- `POST /api/metrics/upsert` — upsert by (companyName, fund, reportingDate)
- `PATCH /api/metrics/:id` — update
- `DELETE /api/metrics/:id` — delete

Additionally, a deals index API was shipped (T#114):
- `GET/POST/PATCH/DELETE /api/deals` with D#N short IDs
- Tracks deal flow: sourcing → dd → pass/move → portfolio

## What "LP Portal" Means

A reporting surface for Limited Partners (LPs) that surfaces portfolio data in a polished, access-controlled way. Not a full SaaS product — a lightweight view layer on existing data.

---

## 1. Data Fields

### Already Available (portfolio_metrics table)
| Field | Type | LP-Relevant? |
|-------|------|-------------|
| companyName | text | ✅ Primary |
| fund | text | ✅ Filter/group by |
| reportingDate | date | ✅ Time-series |
| revenueArrUsd | decimal | ✅ Core KPI |
| revenueAsOfDate | date | ✅ Freshness indicator |
| headcount | int | ✅ Growth signal |
| runwayMonths | decimal | ⚠️ Sensitive — maybe restricted |
| yoyGrowthPct | decimal | ✅ Core KPI |
| lastRoundSizeUsd | decimal | ✅ Context |
| lastRoundValuationUsd | decimal | ⚠️ Sensitive for some companies |
| lastRoundDate | date | ✅ Context |
| lastRoundType | text | ✅ Context |
| keyMilestoneText | text | ✅ Narrative |
| nextFundraiseTiming | text | ⚠️ Very sensitive — restricted |
| contactEmail | text | ❌ Internal only |
| permissionToShare | bool | ✅ Controls LP visibility |
| source | text | ❌ Internal |
| confidence | decimal | ❌ Internal |

### Missing Fields (LP-Facing)
| Field | Why |
|-------|-----|
| `sector` / `vertical` | LPs want sector breakdowns (AI/infra, fintech, health, etc.) |
| `geography` | HQ location for portfolio geo distribution |
| `fund_ownership_pct` | What % of the company does the fund own |
| `invested_amount_usd` | Total capital deployed into this company |
| `current_valuation_usd` | Latest estimated fair value (for MOIC calc) |
| `moic` | Multiple on Invested Capital — derived |
| `irr_pct` | Internal Rate of Return — derived |
| `board_seat` | Boolean — does the fund have a board seat |
| `lead_investor` | Boolean — did the fund lead the round |
| `co_investors` | Text — notable co-investors (social proof) |
| `company_logo_url` | For polished PDF/canvas rendering |
| `one_liner` | 1-sentence company description |
| `status` | active / exited / written_off |

### Derived/Computed (export-time)
- **MOIC**: `current_valuation_usd * fund_ownership_pct / invested_amount_usd`
- **Aggregate portfolio MOIC**: weighted sum
- **DPI** (Distributions to Paid-In): requires exit/distribution tracking
- **TVPI** (Total Value to Paid-In): MOIC at portfolio level
- **Fund-level IRR**: requires cashflow dates — probably Phase 2

---

## 2. Access Controls

### Tiers
| Tier | Who | Sees |
|------|-----|------|
| **Admin** | Pam, Keith | Everything — all fields, all companies, internal notes |
| **LP (Committed)** | Fund LPs | Portfolio data where `permissionToShare=true`, filtered by their fund |
| **LP (Prospect)** | Potential LPs | Aggregate stats only — total companies, median ARR, sector distribution, no per-company data |
| **Founder** | Portfolio founders | Their own company's data only |

### Implementation Options
1. **Token-scoped exports** (simplest): Generate a signed, expiring URL per LP/fund. No login required. Link opens a read-only page or downloads a PDF.
   - Pro: No auth system needed for LPs
   - Con: Links can be shared (mitigated by expiry + audit log)

2. **Magic link auth** (Blather-native): LPs get magic link login → see their portal view
   - Pro: Reuses existing auth, session-based
   - Con: Requires LP user management, onboarding friction

3. **API key per LP** (programmatic): For LPs who want to pull data into their own systems
   - Pro: Machine-friendly
   - Con: Overkill for most LPs

**Recommendation:** Start with **Option 1** (token-scoped exports) for v1. It's the lowest friction for both us and LPs. Add magic link portal as v2 if LPs request interactive access.

---

## 3. Export Formats

### Already Built
- **JSON** — raw data + summary stats
- **CSV** — flat table export
- **Markdown** — formatted portfolio summary

### Needed for LP-Facing
| Format | Use Case | Priority |
|--------|----------|----------|
| **PDF** | Quarterly LP letters, board packets | P0 — this is what LPs expect |
| **Interactive Canvas** | Real-time portfolio dashboard | P1 — differentiator |
| **Slide deck (PPTX)** | GP annual meeting presentations | P2 — nice to have |

### PDF Generation
- Use Puppeteer or Playwright to render HTML → PDF
- Template: Blather canvas message rendered as full-page HTML
- Include: fund summary header, per-company cards, charts (ARR trends, sector breakdown)
- Branding: Pebble Fund logo, professional layout

### Interactive Canvas
- Blather already supports canvas messages (HTML in iframe)
- Build a portfolio dashboard canvas:
  - Fund overview card (total deployed, MOIC, company count)
  - Per-company cards (expandable)
  - Charts: ARR distribution, sector pie, vintage year scatter
  - Filter by fund, sector, status
- Serve via token-scoped URL or embedded in Blather channel

---

## 4. Architecture

```
[Agents write data]
    ↓
[portfolio_metrics table + deals table]
    ↓
[LP Export API]  ──→  GET /api/lp/report?token=<signed>&fund=<name>&format=<pdf|html|json>
    ↓
[Renderer]
    ├── HTML template (canvas-style)
    ├── PDF via Puppeteer
    └── JSON/CSV (existing)
```

### New Endpoints
| Endpoint | Purpose |
|----------|---------|
| `POST /api/lp/tokens` | Generate scoped export token (admin only) |
| `GET /api/lp/report` | Fetch LP report (token-authed, no login required) |
| `GET /api/lp/dashboard` | Interactive HTML dashboard (token-authed) |

### Token Schema
```typescript
{
  fund: string;           // which fund's data
  tier: 'lp' | 'prospect' | 'founder';
  companyFilter?: string; // for founder tier - their company only
  expiresAt: Date;        // 30 days default
  createdBy: string;      // admin who generated it
  accessLog: boolean;     // track views
}
```

---

## 5. Phasing

### Phase 1 (v1 — scope of this task)
- [ ] Add missing schema fields (sector, geography, invested_amount, current_valuation, status, one_liner)
- [ ] `POST /api/lp/tokens` — admin endpoint to generate scoped tokens
- [ ] `GET /api/lp/report?token=X&format=json` — token-authed JSON export
- [ ] `GET /api/lp/report?token=X&format=markdown` — polished markdown (Irma's LP letter format)
- [ ] Access logging (who viewed what, when)

### Phase 2
- [ ] PDF generation (HTML → PDF via Puppeteer)
- [ ] Interactive canvas dashboard
- [ ] MOIC/IRR derived calculations
- [ ] Per-company deep-dive pages

### Phase 3
- [ ] Magic link auth for LP login
- [ ] LP user management (invite, revoke)
- [ ] Historical trend charts
- [ ] Comparison views (QoQ, YoY)
- [ ] PPTX export

---

## 6. Open Questions

1. **Who generates LP reports?** Irma manually triggers via @tasks? Automated quarterly? Pam approves before send?
2. **Branding?** Pebble Fund branding or fund-specific? Need logo assets.
3. **Frequency?** Quarterly standard, but some LPs want monthly updates.
4. **Sensitivity defaults?** Should `permissionToShare` default to `false` (opt-in) or `true` (opt-out)?
5. **Deals index integration?** Should LP reports include pipeline data (deal flow velocity) or just portfolio?
6. **Canvas vs PDF preference?** Need LP feedback — some prefer static documents they can archive.

---

## Irma's Input (from channel discussions)
- LP format expectations: standard quarterly letter + portfolio summary appendix
- Access tiers: prospects vs committed LPs see different data
- Contact ownership tracking important (who's the LP relationship owner)
- `investor_contacts` table may be needed alongside metrics

## Dependencies
- None blocking — portfolio_metrics already on main
- PDF rendering: need Puppeteer/Playwright installed on dev/prod
- Branding assets: need from Pam/Keith

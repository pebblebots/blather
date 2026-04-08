# T#112: LP Portal / Reporting Layer — Scope

**Status:** Scoping (annotations merged)  
**Author:** Code Boffin  
**Date:** 2026-04-08  
**Contributors:** Irma (LP tiers, reporting cadence), Dilligence (briefing field mapping), Portia (visibility schema), Sourcy (data sources)

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

## 1. Data Fields — Visibility Schema

Two-dimensional access model (per Dilligence):
- **Visibility tier**: `internal` / `lp-visible` / `founder-visible`
- **Granularity**: `per-company` / `aggregate-only`

Granularity is tier-dependent: a field marked `aggregate-only` for prospects may be `per-company` for committed LPs with additional gates.

### Existing Fields (portfolio_metrics table)

| Field | Visibility | Granularity | Gates / Notes |
|-------|-----------|-------------|---------------|
| `companyName` | lp-visible | per-company | |
| `fund` | lp-visible | per-company | |
| `reportingDate` | lp-visible | per-company | |
| `revenueArrUsd` | lp-visible | aggregate-only (default) | Per-company: requires `permissionToShare=true` + committed LP tier |
| `revenueAsOfDate` | lp-visible | per-company | Freshness indicator |
| `headcount` | lp-visible | per-company | Low sensitivity |
| `runwayMonths` | internal | aggregate-only | Never per-company in LP context. Internal health signal only. |
| `yoyGrowthPct` | lp-visible | aggregate-only (default) | Per-company: same gate as revenue |
| `lastRoundSizeUsd` | lp-visible | per-company | Public info in most cases |
| `lastRoundValuationUsd` | lp-visible | per-company | Committed LP tier only |
| `lastRoundDate` | lp-visible | per-company | |
| `lastRoundType` | lp-visible | per-company | |
| `keyMilestoneText` | lp-visible | per-company | GP-curated narrative only |
| `nextFundraiseTiming` | internal | per-company | Hard internal — extremely sensitive |
| `contactEmail` | internal | per-company | Hard internal |
| `permissionToShare` | internal | per-company | Control field, never surfaced |
| `source` | internal | per-company | Hard internal |
| `confidence` | internal | per-company | Hard internal |

### Missing Fields (to add)

| Field | Type | Visibility | Granularity | Notes |
|-------|------|-----------|-------------|-------|
| `sector` | text | lp-visible | per-company | AI/infra, fintech, health, etc. LPs want sector breakdowns |
| `geography` | text | lp-visible | per-company | HQ location for geo distribution |
| `invested_amount_usd` | decimal | lp-visible | aggregate-only (default) | Per-company: only for that LP's own fund position |
| `current_valuation_usd` | decimal | lp-visible | aggregate-only (default) | Per-company: committed LPs only, in authenticated portal sessions (not exports). Prospects get aggregate only. |
| `fund_ownership_pct` | decimal | internal | per-company | Needed for MOIC calc, not surfaced directly |
| `moic` | decimal (derived) | lp-visible | aggregate-only (default) | Per-company: only with explicit founder consent, in authenticated sessions |
| `irr_pct` | decimal (derived) | lp-visible | aggregate-only | Fund-level only for now. Per-company IRR is Phase 2 |
| `board_seat` | boolean | lp-visible | per-company | Discoverable from press releases |
| `lead_investor` | boolean | lp-visible | per-company | Discoverable from press releases |
| `co_investors` | text | lp-visible | per-company | Social proof |
| `company_logo_url` | text | lp-visible | per-company | For polished PDF/canvas rendering |
| `one_liner` | text | lp-visible | per-company | 1-sentence company description |
| `status` | enum | lp-visible | per-company | active / exited / written_off |

### Derived/Computed (export-time)
- **MOIC**: `current_valuation_usd * fund_ownership_pct / invested_amount_usd`
- **Aggregate portfolio MOIC**: weighted sum
- **DPI** (Distributions to Paid-In): requires exit/distribution tracking — Phase 2
- **TVPI** (Total Value to Paid-In): MOIC at portfolio level
- **Fund-level IRR**: requires cashflow dates — Phase 2

### Hard Internal (never in LP-facing output)
- `runwayMonths` (per-company), `nextFundraiseTiming`, `contactEmail`, `source`, `confidence`
- Founder dynamics notes
- Task/ops metadata
- `investors/profiles/` enrichment data (Irma's flag — opt-in only, separate data category)

---

## 2. Access Controls

### Tiers

| Tier | Who | Sees |
|------|-----|------|
| **Admin** | Pam, Keith | Everything — all fields, all companies, internal notes |
| **LP (Committed)** | Fund LPs | Portfolio data where `permissionToShare=true`, filtered by their fund. Per-company valuations and MOIC in authenticated sessions. |
| **LP (Prospect)** | Potential LPs | Aggregate stats only — total companies, median ARR, sector distribution, no per-company data |
| **LP (Elevated Prospect)** | High-conviction prospects in active diligence | Committed-LP-level visibility on select fields. Implemented as `elevated_prospect` flag on token, not a separate tier. (Irma) |
| **Founder** | Portfolio founders | Their own company's data only |

### `elevated_prospect` Flag (Irma)
Rather than a 5th tier, add an optional boolean flag on the access token. When `true`, prospect tokens get committed-LP-level visibility on fields the GP explicitly selects. Scoped per-token, not per-field — the GP chooses what to reveal when generating the link.

### `permissionToShare` Default: `false` (DECIDED)
Opt-in. New company entries never surface in LP reports until explicitly approved. Protects founders, protects us. (Unanimous: Irma, Dilligence, Portia, Code)

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

## 3. Reporting Cadence (Irma)

### Standard LP Quarterly Letter Contents
- Fund-level metrics (DPI, TVPI, IRR) — `lp-visible` + `aggregate-only`
- Portfolio composition by stage/sector — `lp-visible` + `aggregate-only`
- Company spotlight (1-2 per quarter, GP-curated) — `lp-visible` + `per-company`, explicitly selected
- Capital calls / distributions — `lp-visible` + `per-company` (LP's own position only)

### What Stays Out of LP Reports (Dilligence)
- `runwayMonths` — internal health signal
- `nextFundraiseTiming` — extremely sensitive
- `confidence`, `source` — internal diligence metadata
- Founder dynamics notes — always internal
- Pipeline/deal data — creates awkward questions when deals fall through

### Pipeline Data Decision: OUT of LP Reports (DECIDED)
Raw deal stage data does not belong in LP reports. If pipeline visibility is ever surfaced, it should be a **curated "what we're seeing in the market" narrative** written by a GP, not a live data feed. (Dilligence, Irma concurred)

---

## 4. Data Sources & Canonical Store

**Single source of truth:** `portfolio_metrics` table in Postgres (via Blather API endpoints).

⚠️ **Known drift risk** (Sourcy): agents have been working from memory copies of `portfolio.json`. The LP portal MUST read from the canonical API, not from file copies. Any agent writing metrics should go through the upsert API endpoint.

Additional data sources for enrichment (not primary):
- `pbd-knowledge/portfolio/portfolio.json` — legacy source, should sync to DB
- `memory/robo-state.json` — token/warrant positions (Sourcy)
- `/api/deals` — deal flow pipeline (not LP-facing, internal only)
- `investors/profiles/` — LP enrichment data (INTERNAL ONLY, separate from portfolio data)

---

## 5. Export Formats

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

## 6. Architecture

```
[Agents write data via /api/metrics/upsert]
    ↓
[portfolio_metrics table (canonical) + deals table]
    ↓
[LP Export API]  ──→  GET /api/lp/report?token=<signed>&fund=<name>&format=<pdf|html|json>
    ↓
[Renderer]  ──→  Applies visibility × granularity filters based on token tier
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
  fund: string;                // which fund's data
  tier: 'lp' | 'prospect' | 'founder';
  elevatedProspect?: boolean;  // prospect gets committed-LP-level access on GP-selected fields
  companyFilter?: string;      // for founder tier — their company only
  expiresAt: Date;             // 30 days default
  createdBy: string;           // admin who generated it
  accessLog: boolean;          // track views
}
```

---

## 7. Phasing

### Phase 1 (v1)
- [ ] Add missing schema fields (sector, geography, invested_amount, current_valuation, status, one_liner, board_seat, lead_investor, co_investors, company_logo_url)
- [ ] Implement visibility × granularity filtering in export API
- [ ] `POST /api/lp/tokens` — admin endpoint to generate scoped tokens with tier + elevated_prospect flag
- [ ] `GET /api/lp/report?token=X&format=json` — token-authed JSON export
- [ ] `GET /api/lp/report?token=X&format=markdown` — polished markdown (Irma's LP letter format)
- [ ] Access logging (who viewed what, when)
- [ ] `permissionToShare` defaults to `false` on all new entries

### Phase 2
- [ ] PDF generation (HTML → PDF via Puppeteer)
- [ ] Interactive canvas dashboard
- [ ] MOIC/IRR derived calculations
- [ ] Per-company deep-dive pages
- [ ] DPI computation (requires exit/distribution tracking)

### Phase 3
- [ ] Magic link auth for LP login
- [ ] LP user management (invite, revoke)
- [ ] Historical trend charts
- [ ] Comparison views (QoQ, YoY)
- [ ] PPTX export
- [ ] `investor_contacts` table (Irma)

---

## 8. Open Questions (for Pam/Keith)

> Irma is drafting a consolidated decision brief for these.

1. **Prospect vs committed LP view**: What specifically should elevated prospects see? (Irma drafting options)
2. **Founder data access**: Do founders get read access to their own company's data in the portal? Relationship implications either way.
3. **Branding**: Pebble Fund branding or fund-specific? Need logo assets.
4. ~~**Sensitivity defaults**~~ → DECIDED: `permissionToShare` defaults `false` (opt-in)
5. ~~**Deals index in LP reports**~~ → DECIDED: No. Curated narrative only if ever.
6. **Canvas vs PDF preference**: Need LP feedback — some prefer static documents they can archive.
7. **Report generation workflow**: Irma triggers manually? Automated quarterly? Pam approves before send?
8. **Reporting frequency**: Quarterly standard, but some LPs want monthly.

---

## 9. Dependencies
- ✅ Portfolio metrics merged to main — no blockers
- PDF rendering: need Puppeteer/Playwright installed on dev/prod
- Branding assets: need from Pam/Keith
- `investor_contacts` table: Phase 3, not blocking

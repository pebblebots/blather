# LP Portal Requirements & Scope

## Current State Analysis

### Portfolio Metrics Feature (from portfolio-metrics branch)
The portfolio-metrics branch contains:
- Full CRUD API for portfolio company metrics
- Database schema with comprehensive fields:
  - Basic company info (name, fund, reporting date)
  - Financial metrics (ARR, headcount, runway, YoY growth)
  - Fundraising data (last round size, valuation, type, date)
  - Forward-looking info (next fundraise timing, key milestones)
  - Privacy controls (permission to share, confidence levels)
- Export functionality (JSON, CSV, Markdown formats)
- Data aggregation (median ARR, headcount, aggregate growth)

### Current Export Capabilities
- **JSON**: Full structured data with summary statistics
- **CSV**: Raw data export for spreadsheet analysis 
- **Markdown**: Formatted portfolio summary with company details
- Filtering by fund, company name, date ranges
- Privacy controls (includeAll flag for internal vs LP views)

## LP Portal Requirements

### Core Requirements

#### Data Access Controls
- **LP-Only View**: Only companies with `permissionToShare: true`
- **Fund-Specific Access**: LPs should only see their specific fund's portfolio
- **Role-Based Permissions**: 
  - Fund LP: See their fund's shared companies only
  - General Partner: See all companies in all funds
  - Limited Internal: See aggregate metrics only

#### Data Fields for LP Consumption
**Must Have:**
- Company name
- Current ARR 
- Headcount
- YoY growth percentage
- Last round information (type, size, date)
- Key milestone text
- Next fundraise timing

**Nice to Have:**
- Runway months (if shared)
- Valuation information (if shared)
- Contact email (for LP intros)
- Confidence indicators

#### Export Formats
**Required:**
- **Interactive Dashboard**: Web-based view with charts/filters
- **PDF Report**: Static snapshot for LP meetings
- **Excel/CSV**: For LP's own analysis

**Format-Specific Requirements:**
- PDF must include fund-level summary statistics
- Interactive dashboard needs date range filtering
- All exports must respect permission flags

#### Presentation Formats

**Dashboard View:**
- Summary cards (total companies, median metrics, aggregate growth)
- Sortable/filterable company table
- Visual charts (growth trends, distribution charts)
- Export buttons for PDF/CSV

**PDF Report:**
- Executive summary page
- Individual company pages
- Charts and visualizations
- Fund performance benchmarking

**API Access:**
- RESTful endpoints for programmatic access
- Authentication via API keys
- Rate limiting and usage monitoring

### Technical Implementation Scope

#### Phase 1: Foundation Merge
- [ ] Resolve conflicts between portfolio-metrics branch and main
- [ ] Generate and run database migrations
- [ ] Add portfolio metrics routes to main API
- [ ] Create basic authentication middleware for LP access

#### Phase 2: LP-Specific Features
- [ ] Fund-based access controls
- [ ] LP user role management
- [ ] Privacy-respecting export endpoints
- [ ] PDF generation functionality

#### Phase 3: Interactive Portal
- [ ] React components for LP dashboard
- [ ] Charts/visualization components
- [ ] Filtering and sorting interfaces  
- [ ] Export UI controls

#### Phase 4: Advanced Features
- [ ] Email report delivery
- [ ] Historical trend analysis
- [ ] Benchmark comparisons
- [ ] Custom LP branding

### Security & Privacy Considerations

#### Data Protection
- All LP access must respect company privacy settings
- Audit logging for data access/exports
- Secure authentication (preferably SSO)
- HTTPS enforcement for all LP-facing endpoints

#### Company Consent Management
- Clear opt-in/opt-out mechanisms for data sharing
- Granular permissions (share financials but not fundraising status)
- Ability to retroactively revoke sharing permissions
- Notification to companies when data is accessed by LPs

### Integration Requirements

#### Existing Systems
- Must integrate with current Blather authentication
- Should leverage existing API patterns and middleware
- Compatible with current database schema and migrations
- Maintain backward compatibility with existing endpoints

#### External Tools
- Support for connecting to common LP tools (CRM systems)
- API integrations for automated reporting
- Calendar integration for quarterly reporting cycles
- Email delivery for regular reports

## Recommended Implementation Priority

### Immediate (Next Sprint)
1. **Merge portfolio-metrics branch** with conflict resolution
2. **Create LP authentication layer** with fund-specific access
3. **Implement privacy controls** in existing export endpoints
4. **Build basic LP dashboard** with company table and filters

### Short Term (1-2 Sprints)  
1. **PDF report generation** with fund summary
2. **Enhanced visualization** with charts and graphs
3. **Automated report scheduling** via email
4. **Admin interface** for managing LP access and permissions

### Medium Term (3-6 Sprints)
1. **Advanced analytics** and trend analysis
2. **Benchmark reporting** against industry standards  
3. **Company portal** for self-service data updates
4. **Mobile-responsive** LP interface

### Long Term (Future)
1. **Third-party integrations** (Salesforce, HubSpot, etc.)
2. **AI-powered insights** and recommendations
3. **Custom LP branding** and white-labeling
4. **Real-time notifications** for portfolio updates

## Technical Debt & Migration Considerations

### Database Schema
- Current portfolio_metrics table is well-designed for LP needs
- May need additional indexing for large portfolios
- Consider partitioning by fund for performance
- Add audit logging table for compliance

### API Design
- Current REST API patterns are suitable
- May need GraphQL for complex LP dashboard queries
- Rate limiting essential for LP-facing endpoints
- Consider caching layer for expensive aggregations

### Frontend Architecture
- Current React/TypeScript setup can support LP portal
- Need component library for consistent LP experience  
- Consider separate LP subdomain for branding
- Mobile-first design for executive accessibility

## Success Metrics

### Usage Metrics
- LP engagement rates (logins, report downloads)
- Data export frequency and formats
- Dashboard interaction patterns
- Mobile vs desktop usage

### Business Metrics  
- Reduced time spent on manual LP reporting
- Increased LP satisfaction scores
- Faster response to LP data requests
- Improved fund marketing effectiveness

### Technical Metrics
- API response times for LP endpoints
- Export generation speed
- System availability/uptime
- Security audit compliance scores

## Conclusion

The portfolio-metrics branch provides a solid foundation for LP portal functionality. The immediate focus should be on merging this branch safely, implementing proper access controls, and creating a minimal viable LP dashboard. The phased approach allows for iterative delivery while building toward a comprehensive LP experience.
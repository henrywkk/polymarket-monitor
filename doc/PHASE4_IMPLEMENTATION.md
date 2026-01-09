# Phase 4: New Market/Outcome Detection - Implementation Summary

## Overview

Phase 4 implements detection and alerting for new markets and outcomes on Polymarket. This allows users to be notified immediately when new markets are created or when new outcomes are added to existing markets.

## Implementation Details

### 1. New Market Detector Service (`new-market-detector.ts`)

**Key Features:**
- Tracks known market IDs in Redis using a SET (`known_markets`)
- Tracks known outcomes per market using Redis SETs (`known_outcomes:{marketId}`)
- Keyword filtering for high-interest markets (War, Launch, Hack, Election, IPO, etc.)
- Detects new markets during sync
- Detects new outcomes in existing markets

**Redis Keys:**
- `known_markets`: SET of all known market IDs (30-day TTL)
- `known_outcomes:{marketId}`: SET of outcome IDs for each market (30-day TTL)

**Keyword Filters:**
- War/Conflict: war, conflict, attack, invasion
- Launches: launch, release, announcement
- Security: hack, breach, exploit, vulnerability
- Politics: election, vote, poll
- Finance: ipo, merger, acquisition
- Regulation: regulation, ban, approval
- Events: disaster, crisis, emergency

### 2. Integration with Market Sync Service

**Changes:**
- Added `NewMarketDetector` as a dependency
- Detects new markets before syncing (compares against Redis set)
- Detects new outcomes after syncing each market
- Generates alerts for new markets/outcomes

**Flow:**
1. Market sync fetches markets from Polymarket API
2. New market detector checks each market against `known_markets` set
3. New markets generate alerts and are marked as known
4. After syncing outcomes, detector checks for new outcomes
5. New outcomes generate alerts and are marked as known

### 3. Alert Types

**New Alert Types Added:**
- `new_market`: Alert for newly discovered markets
- `new_outcome`: Alert for newly added outcomes in existing markets

**Alert Severity:**
- `high`: Markets/outcomes matching keyword filters
- `medium`: All other new markets/outcomes

### 4. Alert Formatting

**New Market Alert:**
- Title: "🆕 NEW MARKET" or "🆕 NEW MARKET (High Interest)"
- Message: Market title and category
- Includes Polymarket URL

**New Outcome Alert:**
- Title: "➕ NEW OUTCOME" or "➕ NEW OUTCOME (High Interest)"
- Message: Outcome name, market title, and category
- Includes Polymarket URL

### 5. Initialization

**On Startup:**
1. Initialize known markets from database (populates Redis set)
2. Initialize known outcomes from database (populates Redis sets per market)
3. This ensures we don't generate alerts for existing markets on first run

## Usage

### Automatic Detection

New markets and outcomes are automatically detected during:
- Initial market sync (on startup)
- Periodic market sync (every 5 minutes by default)
- Manual sync triggers

### Alert Delivery

Alerts are delivered through the same channels as other alerts:
- WebSocket (frontend)
- Webhook (Discord, etc.)
- Email (if configured)

## Configuration

### Keyword Filters

Keyword filters can be customized in `new-market-detector.ts`:

```typescript
private readonly KEYWORD_FILTERS = [
  'war', 'conflict', 'attack', 'invasion',
  'launch', 'release', 'announcement',
  // ... add more keywords
];
```

### Cooldown

Currently, there's no cooldown for new market/outcome alerts (unlike price alerts). This can be added if needed to prevent spam.

## Testing

### Manual Testing

1. **Test New Market Detection:**
   - Create a test market on Polymarket
   - Wait for next sync cycle (or trigger manual sync)
   - Verify alert is generated

2. **Test New Outcome Detection:**
   - Add a new outcome to an existing market
   - Wait for next sync cycle
   - Verify alert is generated

3. **Test Keyword Filtering:**
   - Create a market with keyword in title (e.g., "War in...")
   - Verify alert has `high` severity

### Database Verification

```sql
-- Check known markets count
SELECT COUNT(*) FROM markets;

-- Check known outcomes count
SELECT COUNT(*) FROM outcomes;
```

## Future Enhancements

1. **Configurable Keyword Filters**: Allow users to customize keyword filters
2. **Category-Based Filtering**: Filter by market category
3. **Volume-Based Filtering**: Only alert on markets with initial volume > threshold
4. **Cooldown Mechanism**: Prevent duplicate alerts for same market/outcome
5. **Market Preview**: Include market description/image in alerts

## Related Files

- `backend/src/services/new-market-detector.ts` - Main detection service
- `backend/src/services/market-sync.ts` - Integration point
- `backend/src/services/anomaly-detector.ts` - Alert type definitions
- `backend/src/services/alert-dispatcher.ts` - Alert formatting
- `backend/src/index.ts` - Initialization

## Status

✅ **Phase 4 Complete**
- New market detection implemented
- New outcome detection implemented
- Keyword filtering implemented
- Alert formatting implemented
- Integration with sync service complete
- Initialization on startup complete

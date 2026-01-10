import { MarketIngestionService } from './market-ingestion';
import { PolymarketRestClient, PolymarketMarket } from './polymarket-rest';
import { Market, Outcome } from '../models/Market';
import { query } from '../config/database';
import { NewMarketDetector } from './new-market-detector';

export class MarketSyncService {
  private restClient: PolymarketRestClient;
  public ingestionService: MarketIngestionService;
  private newMarketDetector: NewMarketDetector;

  constructor(
    restClient: PolymarketRestClient,
    ingestionService: MarketIngestionService,
    newMarketDetector?: NewMarketDetector
  ) {
    this.restClient = restClient;
    this.ingestionService = ingestionService;
    // Use provided detector or create new one
    if (newMarketDetector) {
      this.newMarketDetector = newMarketDetector;
    } else {
      this.newMarketDetector = new NewMarketDetector();
    }
  }

  /**
   * Detect category from market data
   */
  private detectCategory(market: PolymarketMarket): string {
    const question = String(market.question || '').toLowerCase();
    // Handle tags - they might be strings, numbers, or objects
    const tags = (market.tags || []).map((t: any) => {
      if (typeof t === 'string') return t.toLowerCase();
      if (typeof t === 'number') return String(t);
      if (t && typeof t === 'object') {
        // Handle tag objects like {id, label, slug}
        return (t.label || t.slug || String(t.id || '')).toLowerCase();
      }
      return String(t || '').toLowerCase();
    });
    // Handle category - might be string, number, object, or null
    let category = '';
    if (market.category) {
      if (typeof market.category === 'string') {
        category = market.category.toLowerCase();
      } else if (typeof market.category === 'object' && market.category !== null) {
        const catObj = market.category as any;
        category = (catObj.label || catObj.slug || String(catObj.id || '')).toLowerCase();
      } else {
        category = String(market.category).toLowerCase();
      }
    }
    
    // Crypto keywords
    const cryptoKeywords = ['bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'cryptocurrency', 
                           'token', 'coin', 'defi', 'nft', 'blockchain', 'solana', 'sol',
                           'price of $', 'will $', 'token price', 'coin price'];
    
    // Politics keywords
    const politicsKeywords = ['president', 'election', 'biden', 'trump', 'democrat', 'republican',
                             'senate', 'congress', 'vote', 'candidate', 'nomination'];
    
    // Sports keywords
    const sportsKeywords = ['nba', 'nfl', 'nhl', 'mlb', 'ufc', 'soccer', 'football', 'basketball',
                           'hockey', 'baseball', 'game', 'match', 'championship', 'tournament'];
    
    // Check tags first
    if (tags.some(t => t.includes('crypto') || t.includes('bitcoin') || t.includes('ethereum'))) {
      return 'Crypto';
    }
    if (tags.some(t => t.includes('politics') || t.includes('election'))) {
      return 'Politics';
    }
    if (tags.some(t => t.includes('sports') || t.includes('nba') || t.includes('nfl'))) {
      return 'Sports';
    }
    
    // Check category field
    if (category.includes('crypto')) return 'Crypto';
    if (category.includes('politic')) return 'Politics';
    if (category.includes('sport')) return 'Sports';
    if (category.includes('entertain')) return 'Entertainment';
    
    // Check question text
    if (cryptoKeywords.some(kw => question.includes(kw))) {
      return 'Crypto';
    }
    if (politicsKeywords.some(kw => question.includes(kw))) {
      return 'Politics';
    }
    if (sportsKeywords.some(kw => question.includes(kw))) {
      return 'Sports';
    }
    
    // Use original category or default
    return market.category || category || 'All';
  }

  /**
   * Sync markets from Polymarket API to database
   * Uses pagination to fetch all active markets (no tag filtering)
   */
  async syncMarkets(limit: number = 2000): Promise<number> {
    try {
      const pageSize = 100; // Markets per API call
      const maxMarkets = limit;
      
      // Check if database is empty or has very few markets (fresh deployment)
      const marketCountResult = await query('SELECT COUNT(*) as count FROM markets');
      const marketCount = parseInt(marketCountResult.rows[0]?.count || '0', 10);
      const isFreshDeployment = marketCount < 10; // Consider fresh if less than 10 markets
      
      if (isFreshDeployment) {
        console.log(`[Sync] Fresh deployment detected (${marketCount} markets in DB). Will force sync all markets.`);
      }
      
      console.log(`Starting market sync with pagination (max: ${maxMarkets}, page size: ${pageSize})...`);
      
      let allMarkets: PolymarketMarket[] = [];
      const seenIds = new Set<string>();
      let offset = 0;
      let totalFetched = 0;
      let consecutiveEmptyPages = 0;
      const maxEmptyPages = 3; // Stop if we get 3 empty pages in a row
      
      // Fetch markets using pagination (no tag filtering)
      while (allMarkets.length < maxMarkets) {
        try {
          const pageMarkets = await this.restClient.fetchMarkets({
            limit: pageSize,
            offset: offset,
            active: true,
            closed: false,
            // No tagSlug or tagId - fetch all active markets
          });
          
          if (pageMarkets.length === 0) {
            consecutiveEmptyPages++;
            if (consecutiveEmptyPages >= maxEmptyPages) {
              console.log(`No more markets found after ${offset} markets. Stopping pagination.`);
              break;
            }
            // Still increment offset in case there's a gap
            offset += pageSize;
            continue;
          }
          
          consecutiveEmptyPages = 0; // Reset counter on successful fetch
          
          // Deduplicate and categorize markets
          // Filter out child markets (outcomes) - these have question_id different from condition_id
          for (const market of pageMarkets) {
            const marketId = market.conditionId || market.questionId || market.id;
            if (!marketId || seenIds.has(marketId)) {
              continue;
            }
            
            // Try to fetch question_id if not present in API response
            // This helps identify child markets early
            if (!market.questionId && market.conditionId) {
              try {
                // Quick fetch with short timeout to avoid blocking
                market.questionId = await Promise.race([
                  this.restClient.fetchQuestionId(market.conditionId),
                  new Promise<string | undefined>((resolve) => 
                    setTimeout(() => resolve(undefined), 2000) // 2 second timeout
                  )
                ]) as string | undefined;
              } catch (error) {
                // Continue if fetch fails - will be checked again in syncMarket()
              }
            }
            
            // Filter out child markets: if question_id exists and differs from condition_id,
            // this is a child market (outcome) that should not be a separate market
            // Exception: if conditionId is missing but questionId exists, it might be a parent event
            if (market.questionId && market.conditionId && market.questionId !== market.conditionId) {
              // This is a child market - skip it as it should be an outcome, not a separate market
              console.log(`[Sync] Skipping child market (outcome): ${marketId} - question_id: ${market.questionId}, condition_id: ${market.conditionId}, question: ${market.question?.substring(0, 60)}`);
              continue;
            }
            
            seenIds.add(marketId);
            // Detect category from market data (tags, question, etc.)
            market.category = this.detectCategory(market);
            allMarkets.push(market);
          }
          
          totalFetched += pageMarkets.length;
          offset += pageSize;
          
          // Log progress every 500 markets
          if (allMarkets.length % 500 === 0 || allMarkets.length >= maxMarkets) {
            console.log(`[Sync Progress] Fetched ${allMarkets.length}/${maxMarkets} unique markets (offset: ${offset})`);
          }
          
          // If we got fewer markets than page size, we've reached the end
          if (pageMarkets.length < pageSize) {
            console.log(`Reached end of markets (got ${pageMarkets.length} < ${pageSize})`);
            break;
          }
          
        } catch (error) {
          console.error(`Error fetching markets at offset ${offset}:`, error instanceof Error ? error.message : String(error));
          // Continue to next page on error
          offset += pageSize;
          consecutiveEmptyPages++;
          if (consecutiveEmptyPages >= maxEmptyPages) {
            console.log(`Too many consecutive errors. Stopping pagination.`);
            break;
          }
        }
      }
      
      console.log(`[Sync] Fetched ${totalFetched} total markets, ${allMarkets.length} unique markets after deduplication`);

      if (allMarkets.length === 0) {
        console.log('No markets fetched from Polymarket API');
        return 0;
      }

      // Count by category - ensure all categories are strings
      const categoryCounts = allMarkets.reduce((acc, m) => {
        let cat: string;
        if (typeof m.category === 'string') {
          cat = m.category;
        } else if (typeof m.category === 'object' && m.category !== null) {
          const catObj = m.category as any;
          cat = catObj.label || catObj.slug || String(catObj.id || 'Uncategorized');
        } else {
          cat = String(m.category || 'Uncategorized');
        }
        acc[cat] = (acc[cat] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      console.log(`[Sync] Market categories:`, categoryCounts);

      // Detect new markets before syncing (non-blocking - errors won't stop sync)
      try {
        const newMarketAlerts = await this.newMarketDetector.detectNewMarkets(allMarkets);
        for (const alert of newMarketAlerts) {
          await this.ingestionService.anomalyDetector.storeAlert(alert);
          console.log(`[New Market] Alert generated for: ${alert.data.marketTitle}`);
        }
      } catch (error) {
        console.error('[Sync] Error detecting new markets (continuing with sync):', error);
      }

      let synced = 0;
      let skipped = 0;
      for (const pmMarket of allMarkets) {
        try {
          // Smart sync: only sync if market has changed
          // On fresh deployment, force sync all markets
          const marketId = pmMarket.conditionId || pmMarket.questionId || pmMarket.id || '';
          if (marketId) {
            const shouldSync = isFreshDeployment || await this.hasMarketChanged(pmMarket, marketId);
            if (shouldSync) {
              await this.syncMarket(pmMarket);
              synced++;
            } else {
              skipped++;
            }
          }
        } catch (error) {
          console.error(`Error syncing market ${pmMarket.id}:`, error);
        }
      }
      
      if (skipped > 0) {
        console.log(`Smart sync: ${synced} updated, ${skipped} skipped (no changes)`);
      }

      // Special handling: force update for specific multi-outcome markets if requested
      // or if they are currently showing only one outcome
      console.log(`[Sync] Performing deep sync for multi-outcome markets...`);
      const multiOutcomeMarkets = allMarkets.filter(m => 
        (m.markets && m.markets.length > 1) || 
        (m.outcomes && m.outcomes.length > 2)
      );
      
      for (const m of multiOutcomeMarkets) {
        const id = m.conditionId || m.questionId || m.id || '';
        if (id) {
          await this.syncMarket(m);
        }
      }

      console.log(`Successfully synced ${synced}/${allMarkets.length} markets`);
      
      // After syncing markets, subscribe to WebSocket updates for active markets
      // This ensures we get real-time price updates
      if (synced > 0) {
        const marketIds = allMarkets
          .map(m => m.conditionId || m.questionId || m.id)
          .filter((id): id is string => !!id)
          .slice(0, 100); // Limit to first 100 to avoid overwhelming WebSocket
        
        if (marketIds.length > 0) {
          this.ingestionService.subscribeToMarkets(marketIds).catch((error: unknown) => {
            console.warn('Failed to subscribe to markets after sync:', error);
          });
        }
      }
      
      return synced;
    } catch (error) {
      console.error('Error during market sync:', error);
      return 0;
    }
  }

  /**
   * Check if a market has changed by comparing key fields
   * Returns true if market should be updated
   */
  private async hasMarketChanged(pmMarket: PolymarketMarket, marketId: string): Promise<boolean> {
    try {
      const result = await query(
        'SELECT question, slug, category, end_date, image_url, updated_at FROM markets WHERE id = $1',
        [marketId]
      );

      if (result.rows.length === 0) {
        return true; // New market, needs to be inserted
      }

      const existing = result.rows[0];
      const newQuestion = pmMarket.question || '';
      const newSlug = pmMarket.slug || marketId;
      const newCategory = pmMarket.category || 'Uncategorized';
      const newEndDate = pmMarket.endDateISO 
        ? new Date(pmMarket.endDateISO).toISOString()
        : pmMarket.endDate 
        ? new Date(pmMarket.endDate).toISOString()
        : null;
      const newImageUrl = pmMarket.image || null;

      // Compare fields - if any changed, return true
      if (
        existing.question !== newQuestion ||
        existing.slug !== newSlug ||
        existing.category !== newCategory ||
        (existing.end_date?.toISOString() || null) !== newEndDate ||
        existing.image_url !== newImageUrl
      ) {
        return true;
      }

      return false; // No changes detected
    } catch (error) {
      // On error, assume it needs updating to be safe
      console.warn(`Error checking market changes for ${marketId}:`, error);
      return true;
    }
  }

  /**
   * Sync a single market from Polymarket format to our database
   * Only updates if market has actually changed (smart sync)
   */
  async syncMarket(pmMarket: PolymarketMarket): Promise<void> {
    // Polymarket uses conditionId or questionId as the primary identifier
    // Use conditionId first, then questionId, then id, then tokenId as fallback
    const marketId = pmMarket.conditionId || pmMarket.questionId || pmMarket.id || pmMarket.tokenId;
    
    if (!marketId) {
      // Only log warning for first few skipped markets to avoid log spam
      if (Math.random() < 0.1) {
        console.warn('Skipping market without ID:', {
          question: pmMarket.question?.substring(0, 50),
          conditionId: pmMarket.conditionId,
          questionId: pmMarket.questionId,
        });
      }
      return;
    }

    // Ensure category is a string and not too long (VARCHAR(100) limit)
    let categoryStr = 'Uncategorized';
    if (pmMarket.category) {
      if (typeof pmMarket.category === 'string') {
        categoryStr = pmMarket.category.substring(0, 100); // Truncate if too long
      } else if (typeof pmMarket.category === 'object' && pmMarket.category !== null) {
        // Handle category as object
        const catObj = pmMarket.category as any;
        categoryStr = (catObj.label || catObj.slug || String(catObj.id || 'Uncategorized')).substring(0, 100);
      } else {
        categoryStr = String(pmMarket.category).substring(0, 100);
      }
    } else if (pmMarket.tags && pmMarket.tags.length > 0) {
      // Use first tag as category if available
      const firstTag = pmMarket.tags[0];
      if (typeof firstTag === 'string') {
        categoryStr = firstTag.substring(0, 100);
      } else if (typeof firstTag === 'object' && firstTag !== null) {
        const tagObj = firstTag as any;
        categoryStr = (tagObj.label || tagObj.slug || String(tagObj.id || 'Uncategorized')).substring(0, 100);
      }
    }

    // Extract question - try multiple sources, fallback to slug-based title
    let question = pmMarket.question;
    if (!question && pmMarket.slug) {
      // Convert slug to readable title as fallback
      // e.g., "will-bitcoin-hit-150k" -> "Will Bitcoin Hit 150k"
      question = pmMarket.slug
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
        .replace(/\b(\w)/g, (char, index) => index === 0 ? char.toUpperCase() : char);
    }
    if (!question) {
      question = 'Untitled Market';
    }

    // Fetch question_id from CLOB API if we have a conditionId
    // This is the parent event identifier that links child markets to parent events
    let questionId: string | undefined = pmMarket.questionId;
    if (!questionId && pmMarket.conditionId) {
      try {
        questionId = await this.restClient.fetchQuestionId(pmMarket.conditionId);
        if (questionId) {
          console.log(`[Sync] Fetched question_id ${questionId} for market ${marketId}`);
        }
      } catch (error) {
        // Silently continue - question_id is optional
      }
    }

    // Check if this is a child market (outcome) that should not be a separate market
    // A child market has question_id that points to a parent market
    // Rule: If question_id exists and differs from condition_id, check if parent exists
    if (questionId && questionId !== marketId) {
      try {
        // Check if a parent market exists with this question_id as its id
        // This means question_id points to an existing parent market
        const parentCheck = await query(
          `SELECT id, question FROM markets WHERE id = $1 LIMIT 1`,
          [questionId]
        );
        
        if (parentCheck.rows.length > 0) {
          const parent = parentCheck.rows[0];
          console.log(`[Sync] Skipping child market (outcome): ${marketId} - question: "${pmMarket.question?.substring(0, 60)}" - Parent exists: ${parent.id} - "${parent.question?.substring(0, 60)}"`);
          return; // Don't sync this market - it's a child/outcome, not a parent market
        }
      } catch (error) {
        // If database check fails, continue with sync (better to have duplicate than miss a market)
        console.error(`[Sync] Error checking for parent market:`, error);
      }
    }

    // Convert Polymarket market to our Market format
    const market: Omit<Market, 'createdAt' | 'updatedAt'> = {
      id: marketId,
      question: question,
      slug: pmMarket.slug || marketId,
      category: categoryStr,
      endDate: pmMarket.endDateISO
        ? new Date(pmMarket.endDateISO)
        : pmMarket.endDate
        ? new Date(pmMarket.endDate)
        : null,
      imageUrl: pmMarket.image || null,
      volume: pmMarket.volume ? parseFloat(String(pmMarket.volume)) : 0,
      volume24h: pmMarket.volume24h ? parseFloat(String(pmMarket.volume24h)) : 0,
      liquidity: pmMarket.liquidity ? parseFloat(String(pmMarket.liquidity)) : 0,
      activityScore: 0, // Initialize to 0, will be calculated based on actual activity
      questionId: questionId || null,
    };

    // Upsert market
    await this.ingestionService.upsertMarket(market);

    // Log market data to debug token_id extraction
    if (Math.random() < 0.05) {
      console.log(`[Sync Debug] Market data for ${marketId}:`, {
        conditionId: pmMarket.conditionId,
        questionId: pmMarket.questionId,
        id: pmMarket.id,
        tokenId: pmMarket.tokenId,
        hasOutcomes: !!(pmMarket.outcomes && pmMarket.outcomes.length > 0),
        outcomesCount: pmMarket.outcomes?.length || 0,
        outcomesWithTokenIds: pmMarket.outcomes?.filter(o => o.tokenId).length || 0,
      });
    }

    // If outcomes don't have token_ids, try to fetch them from API
    let outcomesWithTokens: Array<{
      id?: string;
      tokenId?: string;
      outcome: string;
      price?: string | number;
      volume?: string | number;
      volume24h?: string | number;
    }> = pmMarket.outcomes || [];
    
    // NEW: Check if this market has nested sub-markets (common for multi-outcome/bucket markets in Gamma /events)
    // If it does, we can extract the bucket names and token IDs directly without an extra API call
    if (outcomesWithTokens.length === 0 && pmMarket.markets && Array.isArray(pmMarket.markets) && pmMarket.markets.length > 0) {
      console.log(`[Sync] Market ${marketId} has ${pmMarket.markets.length} nested markets. Extracting bucket outcomes...`);
      const extractedOutcomes = [];
      
      for (const subMarket of pmMarket.markets) {
        // The bucket name is usually in groupItemTitle, fallback to question or title
        let bucketName = subMarket.groupItemTitle || subMarket.question || subMarket.title || '';
        
        // Clean up bucket name (remove parent question prefix if present)
        // e.g., "Bitcoin price on January 8? <78,000" -> "<78,000"
        if (bucketName && question && bucketName.startsWith(question)) {
          bucketName = bucketName.replace(question, '').replace(/^\W+/, '');
        }
        
        // Get token IDs from clobTokenIds (can be a JSON string or array)
        let tokenIds: string[] = [];
        if (subMarket.clobTokenIds) {
          if (typeof subMarket.clobTokenIds === 'string') {
            try {
              tokenIds = JSON.parse(subMarket.clobTokenIds);
            } catch (e) {
              tokenIds = [];
            }
          } else if (Array.isArray(subMarket.clobTokenIds)) {
            tokenIds = subMarket.clobTokenIds;
          }
        }
        
        if (bucketName && tokenIds.length > 0) {
          // Extract volume
          const outcomeVolume = subMarket.volumeNum || (subMarket.volume ? parseFloat(String(subMarket.volume)) : 0);
          const outcomeVolume24h = subMarket.volume24hr || (subMarket.volume24h ? parseFloat(String(subMarket.volume24h)) : 0);

          extractedOutcomes.push({
            id: tokenIds[0],
            tokenId: tokenIds[0],
            outcome: bucketName,
            price: undefined,
            volume: outcomeVolume,
            volume24h: outcomeVolume24h
          });
        }
      }
      
      if (extractedOutcomes.length > 0) {
        outcomesWithTokens = extractedOutcomes;
        console.log(`[Sync] Successfully extracted ${extractedOutcomes.length} bucket outcomes for ${marketId}`);
      }
    }

    // Try conditionId, questionId, or id
    const idToUse = pmMarket.conditionId || pmMarket.questionId || pmMarket.id;
    if (idToUse && (!pmMarket.outcomes || pmMarket.outcomes.length === 0 || pmMarket.outcomes.every(o => !o.tokenId))) {
      // Try to fetch token_ids from API (CLOB first, then Gamma)
      const tokens = await this.restClient.fetchMarketTokens(idToUse);
      if (tokens.length > 0) {
        console.log(`[Sync] Successfully fetched ${tokens.length} token_ids for ID ${idToUse}`);
        // Merge tokens with existing outcomes or create new ones
        if (pmMarket.outcomes && pmMarket.outcomes.length > 0) {
          outcomesWithTokens = pmMarket.outcomes.map((outcome, index) => ({
            ...outcome,
            tokenId: tokens[index]?.token_id || outcome.tokenId || '',
            volume: outcome.volume || tokens[index]?.volume || 0,
            volume24h: outcome.volume24h || tokens[index]?.volume24h || 0,
          }));
        } else {
          // Create outcomes from tokens
          outcomesWithTokens = tokens.map((token: { token_id: string; outcome: string; volume?: number; volume24h?: number }) => ({
            id: token.token_id,
            tokenId: token.token_id,
            outcome: token.outcome || '',
            price: undefined,
            volume: token.volume || 0,
            volume24h: token.volume24h || 0
          }));
        }
      }
    }

    // Sync outcomes if available
    // After syncing outcomes, we'll subscribe to price updates
    if (outcomesWithTokens && outcomesWithTokens.length > 0) {
      // Log outcome data for debugging - especially for markets that might have bucket-style outcomes
      const marketQuestion = pmMarket.question || '';
      const mightBeBucketMarket = marketQuestion.toLowerCase().includes('growth') || 
                                   marketQuestion.toLowerCase().includes('gdp') ||
                                   marketQuestion.toLowerCase().includes('%') ||
                                   outcomesWithTokens.length > 2;
      
      if (mightBeBucketMarket || Math.random() < 0.1) {
        console.log(`[Sync] Market ${marketId} ("${marketQuestion}") - Outcome data:`, {
          outcomesCount: outcomesWithTokens.length,
          outcomes: outcomesWithTokens.map(o => ({
            outcome: o.outcome,
            tokenId: o.tokenId,
            id: o.id,
          })),
          conditionId: pmMarket.conditionId,
          questionId: pmMarket.questionId,
        });
      }

      // Determine if this is a binary market
      const isBinaryMarket = outcomesWithTokens.length === 2 && 
        outcomesWithTokens.some(o => o.outcome && ['yes', 'no', 'true', 'false', '1', '0'].includes(o.outcome.toLowerCase()));
      
      for (const pmOutcome of outcomesWithTokens) {
        const outcomeId = pmOutcome.id || pmOutcome.tokenId || `${marketId}-${pmOutcome.outcome}`;
        const outcome: Omit<Outcome, 'createdAt'> = {
          id: outcomeId,
          marketId: marketId,
          outcome: pmOutcome.outcome,
          tokenId: pmOutcome.tokenId || pmOutcome.id || pmMarket.tokenId || pmMarket.conditionId || '',
          volume: pmOutcome.volume ? parseFloat(String(pmOutcome.volume)) : 0,
          volume24h: pmOutcome.volume24h ? parseFloat(String(pmOutcome.volume24h)) : 0,
        };

        await this.ingestionService.upsertOutcome(outcome);

        // If outcome has an initial price, store it in price_history
        // We also want to capture a default price (e.g. 0.5) if no price is provided
        // to ensure the outcome is visible in the highest probability calculation
        const initialPrice = pmOutcome.price !== undefined && pmOutcome.price !== null
          ? Number(pmOutcome.price)
          : (isBinaryMarket ? 0.5 : (1 / outcomesWithTokens.length));

        if (!isNaN(initialPrice)) {
          // We'll use the price as mid, and set tiny spread for initial data
          // Ensure prices stay within 0-1 range
          const bid = Math.max(0, Math.min(0.99, initialPrice * 0.99));
          const ask = Math.max(bid + 0.001, Math.min(1.0, initialPrice * 1.01));
          
          await this.ingestionService.handlePriceEvent({
            type: 'price_changed',
            market: marketId,
            outcome: outcomeId,
            price: {
              bid,
              ask
            },
            timestamp: Date.now()
          });
        }
      }

      // Detect new outcomes after syncing all outcomes
      const currentOutcomes = outcomesWithTokens.map(o => ({
        id: o.id || o.tokenId || `${marketId}-${o.outcome}`,
        outcome: o.outcome,
      }));
      const newOutcomeAlerts = await this.newMarketDetector.detectNewOutcomes(marketId, currentOutcomes);
      for (const alert of newOutcomeAlerts) {
        await this.ingestionService.anomalyDetector.storeAlert(alert);
        console.log(`[New Outcome] Alert generated for: ${alert.data.newOutcome} in ${alert.data.marketTitle}`);
      }
    } else if (pmMarket.conditionId || pmMarket.questionId || pmMarket.tokenId) {
      // Binary market - create Yes/No outcomes
      // For binary markets, we need to fetch token_ids from CLOB API
      // For now, use conditionId as placeholder (will need to fetch actual token_ids)
      const yesOutcome: Omit<Outcome, 'createdAt'> = {
        id: `${marketId}-yes`,
        marketId: marketId,
        outcome: 'Yes',
        tokenId: pmMarket.tokenId || pmMarket.conditionId || '',
      };

      const noOutcome: Omit<Outcome, 'createdAt'> = {
        id: `${marketId}-no`,
        marketId: marketId,
        outcome: 'No',
        tokenId: pmMarket.tokenId || pmMarket.conditionId || '',
      };

      await this.ingestionService.upsertOutcome(yesOutcome);
      await this.ingestionService.upsertOutcome(noOutcome);
    } else {
      // No outcomes and no conditionId - log warning
      if (Math.random() < 0.1) {
        console.warn(`[Sync] Market ${marketId} has no outcomes or conditionId - cannot create outcomes`);
      }
    }

    // Subscribe to WebSocket updates for this market (non-blocking)
    // This ensures we get real-time price updates for newly synced markets
    this.ingestionService.subscribeToMarket(marketId).catch((error: unknown) => {
      // Don't fail sync if subscription fails
      console.warn(`Failed to subscribe to market ${marketId}:`, error);
    });
  }
}


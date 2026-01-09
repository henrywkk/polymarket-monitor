import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Clock, TrendingUp, ExternalLink, BarChart3, PieChart, Activity } from 'lucide-react';
import { useMarketDetail } from '../hooks/useMarketDetail';
import { useRealtimePrice } from '../hooks/useRealtimePrice';
import { useRealtimeTrades } from '../hooks/useRealtimeTrades';
import { tradesApi } from '../services/api';
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  isBinaryMarket, 
  calculateExpectedValue, 
  getPrimaryOutcome,
  getOutcomeSortKey,
  OutcomeWithPrice 
} from '../utils/market-calculations';
import {
  groupOutcomesByBucket,
  getPrimaryOutcomeForBucket
} from '../utils/outcome-grouping';

// Individual Outcome Row component for real-time updates
const OutcomeRow = ({ 
  marketId, 
  outcome, 
  isPrimary, 
  formatVolume 
}: { 
  marketId: string; 
  outcome: OutcomeWithPrice; 
  isPrimary: boolean;
  formatVolume: (vol: number | undefined) => string;
}) => {
  const priceUpdate = useRealtimePrice(marketId, outcome.id);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (priceUpdate) {
      setPulse(true);
      const timer = setTimeout(() => setPulse(false), 1000);
      return () => clearTimeout(timer);
    }
  }, [priceUpdate]);

  const currentProb = priceUpdate ? Number(priceUpdate.impliedProbability) : Number(outcome.currentPrice?.implied_probability || 0);
  const currentBid = priceUpdate ? Number(priceUpdate.bidPrice) : Number(outcome.currentPrice?.bid_price || 0);
  const currentAsk = priceUpdate ? Number(priceUpdate.askPrice) : Number(outcome.currentPrice?.ask_price || 0);

  return (
    <div
      className={`border rounded-xl p-4 transition-all ${
        pulse ? 'bg-blue-500/10 border-blue-500/50' :
        isPrimary 
          ? 'border-blue-500/30 bg-blue-500/5' 
          : 'border-slate-800 bg-slate-900/50'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className={`font-bold ${isPrimary ? 'text-blue-400' : 'text-white'}`}>
                {outcome.outcome}
              </span>
              {isPrimary && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 font-bold uppercase tracking-tighter">
                  Primary
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 mt-1">
              <span className="text-[10px] text-slate-500 font-bold uppercase flex items-center gap-1">
                <PieChart className="w-3 h-3" />
                24H: {formatVolume((outcome as any).volume24h)}
              </span>
              <span className="text-[10px] text-slate-500 font-bold uppercase flex items-center gap-1">
                <BarChart3 className="w-3 h-3" />
                Total: {formatVolume((outcome as any).volume)}
              </span>
            </div>
          </div>
        </div>
        <div className="text-right">
          {outcome.currentPrice || priceUpdate ? (
            <>
              <span className={`font-black text-xl transition-colors ${pulse ? 'text-blue-400' : 'text-slate-200'}`}>
                {currentProb.toFixed(1)}%
              </span>
              <div className="text-[10px] text-slate-500 font-mono mt-1 font-bold">
                BID: {currentBid.toFixed(4)} | ASK: {currentAsk.toFixed(4)}
              </div>
            </>
          ) : (
            <span className="text-slate-500 text-sm font-bold italic">No price data</span>
          )}
        </div>
      </div>
    </div>
  );
};

export const MarketDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { data: market, isLoading, error } = useMarketDetail(id || '');
  
  // Determine if this is a binary market and get primary outcome
  const outcomes: OutcomeWithPrice[] = market?.outcomes || [];
  const isBinary = market ? isBinaryMarket(outcomes) : false;
  const primaryOutcome = market ? getPrimaryOutcome(outcomes) : null;
  
  // Calculate expected value for multi-outcome markets
  const expectedValue = market ? calculateExpectedValue(outcomes) : null;
  
  const priceUpdate = useRealtimePrice(id, primaryOutcome?.id);
  
  // Real-time trade updates
  const realtimeTrades = useRealtimeTrades(id);
  
  // Fetch trade history from API
  const { data: tradeHistory } = useQuery({
    queryKey: ['tradeHistory', id],
    queryFn: async () => {
      if (!id) return null;
      return await tradesApi.getTradeHistory(id, 50, 'outcome');
    },
    enabled: !!id,
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // Refetch every minute
  });
  
  // Fetch orderbook metrics
  const { data: orderbookData } = useQuery({
    queryKey: ['orderbook', id],
    queryFn: async () => {
      if (!id) return null;
      return await tradesApi.getOrderbook(id, 1, 'outcome'); // Just get latest
    },
    enabled: !!id,
    staleTime: 10000, // 10 seconds
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-slate-400 font-medium">Loading market details...</p>
        </div>
      </div>
    );
  }

  if (error || !market) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-10">
        <div className="bg-red-950/80 border border-red-500/50 rounded-xl p-6 text-red-100">
          Error loading market. Please try again later.
        </div>
        <Link
          to="/"
          className="mt-6 inline-flex items-center text-blue-400 hover:text-blue-300 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Markets
        </Link>
      </div>
    );
  }


      const formatEndDate = (endDate: string | null) => {
        if (!endDate) return 'No end date';
        const date = new Date(endDate);
        return date.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
      };
      
      const formatVolume = (volume: number | undefined) => {
        if (volume === undefined || volume === null) return 'N/A';
        if (volume >= 1000000) return `$${(volume / 1000000).toFixed(1)}M`;
        if (volume >= 1000) return `$${(volume / 1000).toFixed(1)}K`;
        return `$${Number(volume).toFixed(0)}`;
      };

  // Normalize price data - handle both PriceUpdate (camelCase) and API response (snake_case)
  let currentPrice: { bid_price: number; ask_price: number; mid_price: number; implied_probability: number } | undefined;
  
  if (priceUpdate) {
    // Only use priceUpdate if it matches the primary outcome (Yes for Yes/No markets)
    // Check if the update's outcomeId matches the primary outcome's tokenId or id
    const updateMatchesOutcome = primaryOutcome && 
      (priceUpdate.outcomeId === primaryOutcome.id || 
       priceUpdate.outcomeId === primaryOutcome.token_id);
    
    if (updateMatchesOutcome) {
      currentPrice = {
        bid_price: Number(priceUpdate.bidPrice) || 0,
        ask_price: Number(priceUpdate.askPrice) || 0,
        mid_price: Number(priceUpdate.midPrice) || 0,
        implied_probability: Number(priceUpdate.impliedProbability) || 0,
      };
    }
  }
  
  // Use API response format (already snake_case), ensure all values are numbers
  if (!currentPrice && primaryOutcome?.currentPrice) {
    currentPrice = {
      bid_price: Number(primaryOutcome.currentPrice.bid_price) || 0,
      ask_price: Number(primaryOutcome.currentPrice.ask_price) || 0,
      mid_price: Number(primaryOutcome.currentPrice.mid_price) || 0,
      implied_probability: Number(primaryOutcome.currentPrice.implied_probability) || 0,
    };
  }

  // Build Polymarket URL from slug or market ID
  const polymarketUrl = market.slug 
    ? `https://polymarket.com/event/${market.slug}`
    : `https://polymarket.com/event/${market.id}`;

  return (
    <div className="max-w-7xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-6">
        <Link
          to="/"
          className="inline-flex items-center text-blue-400 hover:text-blue-300 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Markets
        </Link>
        <a
          href={polymarketUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-blue-600 text-slate-300 hover:text-white rounded-xl transition-all transform active:scale-95 border border-slate-700 hover:border-blue-500"
        >
          <ExternalLink className="w-4 h-4" />
          <span className="text-sm font-bold">View on Polymarket</span>
        </a>
      </div>

      <div className="bg-[#121826] rounded-3xl border border-slate-800/60 shadow-2xl p-8 mb-6">
        <div className="flex items-start justify-between mb-6">
          <span
            className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest border ${
              market.category === 'Crypto' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' :
              market.category === 'Politics' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
              market.category === 'Sports' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
              'bg-purple-500/10 text-purple-400 border-purple-500/20'
            }`}
          >
            {market.category}
          </span>
          {priceUpdate && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-bold uppercase">
              <TrendingUp className="w-3 h-3" />
              Live Updates
            </span>
          )}
        </div>

        <h1 className="text-3xl font-black text-white mb-8 leading-tight">
          {market.question}
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          {expectedValue !== null ? (
            // Show expected value for multi-outcome markets
            <div className="bg-slate-900/50 rounded-2xl p-6 border border-slate-800/60">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
                Expected Value
              </p>
              <p className="text-4xl font-black text-blue-400">
                {expectedValue.toFixed(2)}%
              </p>
              <p className="text-xs text-slate-500 mt-2">
                Weighted average of all outcome buckets
              </p>
            </div>
          ) : isBinary && currentPrice ? (
            // Show implied probability only for binary markets
            <div className="bg-slate-900/50 rounded-2xl p-6 border border-slate-800/60">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
                Implied Probability
              </p>
              <p className="text-4xl font-black text-blue-400">
                {Number(currentPrice.implied_probability).toFixed(1)}%
              </p>
              <p className="text-xs text-slate-500 mt-2">
                For: {primaryOutcome?.outcome || 'Yes'}
              </p>
            </div>
          ) : null}
          
          {currentPrice && (
            <>
              <div className="bg-slate-900/50 rounded-2xl p-6 border border-slate-800/60">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Bid Price</p>
                <p className="text-4xl font-black text-slate-200 font-mono">
                  {currentPrice?.bid_price !== undefined && currentPrice.bid_price !== null
                    ? Number(currentPrice.bid_price).toFixed(4)
                    : 'N/A'}
                </p>
                {primaryOutcome && (
                  <p className="text-xs text-slate-500 mt-2">
                    For: {primaryOutcome.outcome}
                  </p>
                )}
              </div>

              <div className="bg-slate-900/50 rounded-2xl p-6 border border-slate-800/60">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Ask Price</p>
                <p className="text-4xl font-black text-slate-200 font-mono">
                  {currentPrice?.ask_price !== undefined && currentPrice.ask_price !== null
                    ? Number(currentPrice.ask_price).toFixed(4)
                    : 'N/A'}
                </p>
                {primaryOutcome && (
                  <p className="text-xs text-slate-500 mt-2">
                    For: {primaryOutcome.outcome}
                  </p>
                )}
              </div>
            </>
          )}

            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-slate-900/50 rounded-2xl p-6 border border-slate-800/60">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">24H Volume</p>
                <p className="text-3xl font-black text-white">
                  {formatVolume(Number((market as any).volume24h))}
                </p>
              </div>
              <div className="bg-slate-900/50 rounded-2xl p-6 border border-slate-800/60">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Total Volume</p>
                <p className="text-3xl font-black text-white">
                  {formatVolume(Number((market as any).volume))}
                </p>
              </div>
              <div className="bg-slate-900/50 rounded-2xl p-6 border border-slate-800/60">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Liquidity</p>
                <p className="text-3xl font-black text-blue-400">
                  {formatVolume(Number((market as any).liquidityScore))}
                </p>
              </div>
            </div>

            <div className="flex items-center text-slate-400">
          <Clock className="w-4 h-4 mr-2" />
          <span className="text-sm font-medium">End Date: {formatEndDate(market.end_date)}</span>
        </div>
      </div>


      {/* Outcomes */}
      {market.outcomes && market.outcomes.length > 0 && (
        <div className="bg-[#121826] rounded-3xl border border-slate-800/60 shadow-2xl p-6 mt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-white">All Outcomes</h2>
            {expectedValue !== null && (
              <div className="text-right">
                <p className="text-xs text-slate-500 uppercase tracking-widest">Expected Value</p>
                <p className="text-2xl font-black text-blue-400">{expectedValue.toFixed(2)}%</p>
              </div>
            )}
          </div>
          <div className="space-y-3">
            {(() => {
              // Group outcomes by bucket (for multi-outcome markets)
              const buckets = groupOutcomesByBucket(market.outcomes);
              const bucketEntries = Array.from(buckets.entries());
              
              // Sort bucket entries by their numerical value for human-readable order
              bucketEntries.sort(([a], [b]) => {
                const sortKeyA = getOutcomeSortKey(a);
                const sortKeyB = getOutcomeSortKey(b);
                return sortKeyA - sortKeyB;
              });
              
              // If we have buckets, display them; otherwise display all outcomes
              if (bucketEntries.length > 0 && bucketEntries.length < market.outcomes.length) {
                return bucketEntries.map(([bucketName, bucketOutcomes]) => {
                  const primaryBucketOutcome = getPrimaryOutcomeForBucket(bucketOutcomes);
                  if (!primaryBucketOutcome) return null;
                  
                  const isPrimary = primaryOutcome?.id === primaryBucketOutcome.id;
                  
                  return (
                    <OutcomeRow
                      key={bucketName}
                      marketId={market.id}
                      outcome={primaryBucketOutcome as OutcomeWithPrice}
                      isPrimary={isPrimary}
                      formatVolume={formatVolume}
                    />
                  );
                });
              } else {
                // Display all outcomes individually (for binary markets or when grouping doesn't apply)
                // Sort outcomes by their numerical value for human-readable order
                const sortedOutcomes = [...market.outcomes].sort((a, b) => {
                  const sortKeyA = getOutcomeSortKey(a.outcome);
                  const sortKeyB = getOutcomeSortKey(b.outcome);
                  return sortKeyA - sortKeyB;
                });
                
                return sortedOutcomes.map((outcome) => {
                  const isPrimary = primaryOutcome?.id === outcome.id;
                  return (
                    <OutcomeRow
                      key={outcome.id}
                      marketId={market.id}
                      outcome={outcome as OutcomeWithPrice}
                      isPrimary={isPrimary}
                      formatVolume={formatVolume}
                    />
                  );
                });
              }
            })()}
          </div>
        </div>
      )}

      {/* Orderbook Metrics */}
      {orderbookData && orderbookData.byOutcome && Object.keys(orderbookData.byOutcome).length > 0 && (() => {
        // Filter out invalid orderbook data (spread > 50% or invalid prices)
        const validOutcomes = Object.entries(orderbookData.byOutcome).filter(([outcomeName, metrics]) => {
          const latest = Array.isArray(metrics) && metrics.length > 0 ? metrics[0] : null;
          if (!latest) return false;
          // Validate: spread should be reasonable, prices should be between 0 and 1
          const isValid = latest.spreadPercent <= 50 && 
                         latest.bestBid > 0 && latest.bestAsk > 0 && 
                         latest.bestBid < 1 && latest.bestAsk < 1;
          return isValid;
        });
        
        if (validOutcomes.length === 0) return null;
        
        return (
          <div className="bg-[#121826] rounded-3xl border border-slate-800/60 shadow-2xl p-6 mt-6">
            <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Orderbook Metrics
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {validOutcomes.map(([outcomeName, metrics]) => {
                const latest = Array.isArray(metrics) && metrics.length > 0 ? metrics[0] : null;
                if (!latest) return null;
              
              return (
                <div key={outcomeName} className="bg-slate-900/50 rounded-xl p-4 border border-slate-800/60">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
                    {outcomeName}
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-slate-400 text-xs">Spread</span>
                      <span className="text-white font-mono text-sm">
                        {(latest.spread * 100).toFixed(2)}¢ ({(latest.spreadPercent || 0).toFixed(2)}%)
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400 text-xs">Depth (2%)</span>
                      <span className="text-white font-mono text-sm">
                        {formatVolume(latest.depth2Percent)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400 text-xs">Bid/Ask</span>
                      <span className="text-white font-mono text-sm">
                        {latest.bestBid.toFixed(4)} / {latest.bestAsk.toFixed(4)}
                      </span>
                    </div>
                    {latest.spread > 0.10 && (
                      <div 
                        className="mt-2 px-2 py-1 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400 font-bold cursor-help"
                        title="Liquidity Vacuum: The bid-ask spread is unusually wide (>10 cents), indicating low liquidity. This means there's a large gap between what buyers are willing to pay and what sellers are asking, making it harder to execute trades at favorable prices."
                      >
                        ⚠️ Liquidity Vacuum
                      </div>
                    )}
                  </div>
                </div>
              );
              })}
            </div>
          </div>
        );
      })()}

      {/* Recent Trades */}
      {(realtimeTrades.length > 0 || (tradeHistory && tradeHistory.data.length > 0)) && (
        <div className="bg-[#121826] rounded-3xl border border-slate-800/60 shadow-2xl p-6 mt-6">
          <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5" />
            Recent Trades
          </h2>
          
          {/* Show real-time trades if available, otherwise show from API */}
          {realtimeTrades.length > 0 ? (
            <div className="space-y-2">
              {realtimeTrades.slice(0, 20).map((trade, index) => (
                <div
                  key={`${trade.timestamp}-${index}`}
                  className="bg-slate-900/50 rounded-lg p-3 border border-slate-800/60 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-bold px-2 py-1 rounded ${
                      trade.side === 'buy' 
                        ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                        : 'bg-red-500/20 text-red-400 border border-red-500/30'
                    }`}>
                      {trade.side?.toUpperCase() || 'TRADE'}
                    </span>
                    <span className="text-slate-400 text-xs font-mono">
                      {new Date(trade.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-white font-mono font-bold">
                      {trade.price.toFixed(4)}
                    </span>
                    <span className="text-slate-300 font-mono">
                      {formatVolume(trade.size)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : tradeHistory && tradeHistory.data.length > 0 ? (
            <div className="space-y-2">
              {tradeHistory.data.slice(0, 20).map((trade, index) => (
                <div
                  key={`${trade.timestamp}-${index}`}
                  className="bg-slate-900/50 rounded-lg p-3 border border-slate-800/60 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500 font-bold uppercase">
                      {trade.outcomeName}
                    </span>
                    <span className={`text-xs font-bold px-2 py-1 rounded ${
                      trade.side === 'buy' 
                        ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                        : trade.side === 'sell'
                        ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                        : 'bg-slate-700/50 text-slate-400 border border-slate-700'
                    }`}>
                      {trade.side?.toUpperCase() || 'TRADE'}
                    </span>
                    <span className="text-slate-400 text-xs font-mono">
                      {new Date(trade.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-white font-mono font-bold">
                      {trade.price.toFixed(4)}
                    </span>
                    <span className="text-slate-300 font-mono">
                      {formatVolume(trade.size)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          
          {(!realtimeTrades.length && (!tradeHistory || tradeHistory.data.length === 0)) && (
            <div className="text-center py-8 text-slate-500">
              <Activity className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No recent trades</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};


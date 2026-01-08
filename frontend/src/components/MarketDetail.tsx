import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Clock, TrendingUp, ExternalLink } from 'lucide-react';
import { useMarketDetail } from '../hooks/useMarketDetail';
import { useRealtimePrice } from '../hooks/useRealtimePrice';
import { PriceChart } from './PriceChart';

export const MarketDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { data: market, isLoading, error } = useMarketDetail(id || '');
  const priceUpdate = useRealtimePrice(id);

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

  // For Yes/No markets, prefer the "Yes" outcome for main probability display
  // Otherwise use the first outcome
  const yesOutcome = market.outcomes?.find(o => 
    o.outcome?.toLowerCase() === 'yes' || 
    o.outcome?.toLowerCase() === 'true' ||
    o.outcome?.toLowerCase() === '1'
  );
  const primaryOutcome = yesOutcome || market.outcomes?.[0];
  
  // Normalize price data - handle both PriceUpdate (camelCase) and API response (snake_case)
  let currentPrice: { bid_price: number; ask_price: number; mid_price: number; implied_probability: number } | undefined;
  
  if (priceUpdate) {
    // Only use priceUpdate if it matches the primary outcome (Yes for Yes/No markets)
    // For now, we'll use it if available, but prefer outcome-specific prices
    const updateMatchesOutcome = primaryOutcome && 
      (priceUpdate.outcomeId === primaryOutcome.id || 
       priceUpdate.outcomeId === primaryOutcome.tokenId);
    
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
          <div className="bg-slate-900/50 rounded-2xl p-6 border border-slate-800/60">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Implied Probability</p>
            <p className="text-4xl font-black text-blue-400">
              {currentPrice?.implied_probability !== undefined && currentPrice.implied_probability !== null
                ? `${Number(currentPrice.implied_probability).toFixed(1)}%`
                : 'N/A'}
            </p>
          </div>

          <div className="bg-slate-900/50 rounded-2xl p-6 border border-slate-800/60">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Bid Price</p>
            <p className="text-4xl font-black text-slate-200 font-mono">
              {currentPrice?.bid_price !== undefined && currentPrice.bid_price !== null
                ? Number(currentPrice.bid_price).toFixed(4)
                : 'N/A'}
            </p>
          </div>

          <div className="bg-slate-900/50 rounded-2xl p-6 border border-slate-800/60">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Ask Price</p>
            <p className="text-4xl font-black text-slate-200 font-mono">
              {currentPrice?.ask_price !== undefined && currentPrice.ask_price !== null
                ? Number(currentPrice.ask_price).toFixed(4)
                : 'N/A'}
            </p>
          </div>
        </div>

        <div className="flex items-center text-slate-400">
          <Clock className="w-4 h-4 mr-2" />
          <span className="text-sm font-medium">End Date: {formatEndDate(market.end_date)}</span>
        </div>
      </div>

      {/* Price History Chart */}
      <div className="bg-[#121826] rounded-3xl border border-slate-800/60 shadow-2xl p-8 mb-6">
        <h2 className="text-2xl font-black text-white mb-6">
          Price History
        </h2>
        <PriceChart marketId={market.id} />
      </div>

      {/* Outcomes */}
      {market.outcomes && market.outcomes.length > 0 && (
        <div className="bg-[#121826] rounded-3xl border border-slate-800/60 shadow-2xl p-8">
          <h2 className="text-2xl font-black text-white mb-6">Outcomes</h2>
          <div className="space-y-4">
            {market.outcomes.map((outcome) => (
              <div
                key={outcome.id}
                className="border border-slate-800/60 rounded-2xl p-6 bg-slate-900/30 hover:bg-slate-900/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-lg">
                    {outcome.outcome}
                  </span>
                  {outcome.currentPrice && outcome.currentPrice.implied_probability !== undefined && outcome.currentPrice.implied_probability !== null && (
                    <span className="text-blue-400 font-black text-2xl font-mono">
                      {Number(outcome.currentPrice.implied_probability).toFixed(1)}%
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};


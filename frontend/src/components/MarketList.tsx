import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, ExternalLink, TrendingUp, Activity, Server } from 'lucide-react';
import { useMarkets } from '../hooks/useMarkets';
import { useGlobalStats } from '../hooks/useGlobalStats';
import { useCategories } from '../hooks/useCategories';
import { Link } from 'react-router-dom';
import { wsService } from '../services/websocket';
import { Market } from '../services/api';
import { motion, AnimatePresence } from 'framer-motion';
import { useRealtimePrice } from '../hooks/useRealtimePrice';

interface StatCardProps {
  label: string;
  value: string | number;
  color: 'blue' | 'red' | 'purple' | 'slate' | 'green';
}

const StatCard = ({ label, value, color }: StatCardProps) => {
  const colors = {
    blue: 'text-blue-400 border-blue-500/20',
    red: 'text-red-400 border-red-500/20',
    purple: 'text-purple-400 border-purple-500/20',
    green: 'text-green-400 border-green-500/20',
    slate: 'text-slate-400 border-slate-500/20',
  };
  return (
    <div className="bg-[#121826] p-5 rounded-2xl border border-slate-800/60">
      <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">{label}</p>
      <p className={`text-2xl font-black ${colors[color] || colors.slate}`}>{value}</p>
    </div>
  );
};

interface MarketRowProps {
  market: Market;
  getProbabilityDisplay: (market: Market) => { value: number; label: string; outcome?: string };
  formatVolume: (volume: number | undefined) => string;
  formatLastTrade: (timestamp: string | undefined) => string;
  getCategoryColor: (category: string) => string;
  formatEndDate: (endDate: string | null) => string;
}

const MarketRow = ({ 
  market, 
  getProbabilityDisplay, 
  formatVolume, 
  formatLastTrade, 
  getCategoryColor, 
  formatEndDate 
}: MarketRowProps) => {
  // Use real-time price hook for this specific market
  // We prioritize the outcomeId from the backend's probabilityDisplay
  const primaryOutcomeId = (market as any).probabilityDisplay?.outcomeId;
  const priceUpdate = useRealtimePrice(market.id, primaryOutcomeId);

  // Use real-time value if available, otherwise fallback to static data
  const initialProb = getProbabilityDisplay(market);
  
  // For expected value markets, we don't update the central number in real-time 
  // because we only get updates for one bucket at a time, not the whole expected value.
  // We keep the initial expected value but show the pulse for activity.
  const isExpectedValue = initialProb.label === 'Expected Value';
  const currentProbValue = (isExpectedValue || !priceUpdate) 
    ? initialProb.value 
    : Number(priceUpdate.impliedProbability);
    
  const isHighProbability = isExpectedValue 
    ? currentProbValue > 4.0 // High growth for GDP/Expected Value
    : currentProbValue > 70 || currentProbValue < 30; // High confidence for Probability
  
  // Update last trade time if we get a real-time pulse
  const lastTradeTime = priceUpdate ? new Date().toISOString() : market.lastTradeAt;

  // Pulse effect when price changes
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (priceUpdate) {
      setPulse(true);
      const timer = setTimeout(() => setPulse(false), 1000);
      return () => clearTimeout(timer);
    }
  }, [priceUpdate]);

  return (
    <>
      {/* Row 1: Market Name and ID - aligned with probability column */}
      <motion.tr 
        layout
        initial={{ opacity: 0 }}
        animate={{ 
          opacity: 1,
          backgroundColor: pulse ? 'rgba(59, 130, 246, 0.1)' : 'transparent'
        }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="group hover:bg-slate-800/20 transition-all border-b border-slate-800/40"
      >
        <td className="pl-6 pr-8 py-4">
          {/* Empty - aligns with empty cell in row 2 */}
        </td>
        <td className="px-8 py-4" colSpan={8}>
          <div className="flex items-center gap-2">
            <Link 
              to={`/markets/${market.id}`}
              className="text-white font-bold text-base leading-tight group-hover:text-blue-400 transition-colors"
            >
              {market.question}
            </Link>
            <span className="text-slate-500 text-xs font-mono uppercase tracking-tighter">{market.id}</span>
          </div>
        </td>
      </motion.tr>
      {/* Row 2: All other data - Probability aligns with market name */}
      <motion.tr 
        layout
        initial={{ opacity: 0 }}
        animate={{ 
          opacity: 1,
          backgroundColor: pulse ? 'rgba(59, 130, 246, 0.05)' : 'transparent'
        }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="group hover:bg-slate-800/10 transition-all border-b border-slate-800/40"
      >
        <td className="pl-6 pr-8 py-4">
          {/* Empty - aligns with empty cell in row 1 */}
        </td>
        <td className="px-8 py-4 text-right">
          <div className="flex flex-col items-end">
            <motion.div 
              animate={{ scale: pulse ? 1.1 : 1 }}
              className={`font-mono font-black text-lg ${
                isHighProbability ? 'text-red-500' : 'text-blue-400'
              }`}
            >
              {currentProbValue.toFixed(initialProb.label === 'Expected Value' ? 2 : 1)}%
            </motion.div>
            {initialProb.outcome && (
              <div className="text-xs text-slate-500 mt-0.5">
                {initialProb.outcome}
              </div>
            )}
            {initialProb.label === 'Expected Value' && (
              <div className="text-xs text-slate-500 mt-0.5">
                Expected
              </div>
            )}
          </div>
        </td>
        <td className="px-8 py-4 text-right">
          <div className="text-slate-300 font-mono font-bold">
            {formatVolume(market.volume24h)}
          </div>
        </td>
        <td className="px-8 py-4 text-right">
          <div className="text-slate-400 font-mono text-sm">
            {formatVolume(market.volume)}
          </div>
        </td>
        <td className="px-8 py-4 text-right">
          <div className={`${priceUpdate ? 'text-blue-400 font-bold' : 'text-slate-400'} text-xs font-mono`}>
            {formatLastTrade(lastTradeTime)}
          </div>
        </td>
        <td className="px-8 py-4 text-center">
          <span className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-slate-800/50 text-[10px] font-bold uppercase ${getCategoryColor(market.category)}`}>
            {market.category}
          </span>
        </td>
        <td className="px-8 py-4 text-right">
          <div className="text-slate-300 text-sm font-mono font-semibold">
            {market.liquidityScore !== undefined && market.liquidityScore !== null 
              ? Number(market.liquidityScore).toFixed(1)
              : 'N/A'}
          </div>
        </td>
        <td className="px-8 py-4 text-right">
          <div className="text-slate-400 text-sm font-mono">
            {formatEndDate(market.end_date)}
          </div>
        </td>
        <td className="px-8 py-4 text-right">
          <a
            href={market.slug 
              ? `https://polymarket.com/event/${market.slug}`
              : `https://polymarket.com/event/${market.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800 hover:bg-blue-600 text-slate-400 hover:text-white transition-all transform active:scale-95"
          >
            <ExternalLink className="w-5 h-5" />
          </a>
        </td>
      </motion.tr>
    </>
  );
};

export const MarketList = () => {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [sortBy, setSortBy] = useState('volume24h'); // Default sort by 24H Vol
  const [connectionStatus, setConnectionStatus] = useState<'online' | 'connecting' | 'offline'>('connecting');

  const { data, isLoading, error } = useMarkets({
    page,
    limit: 20,
    search: search || undefined,
    category: category !== 'All' ? category : undefined,
    sortBy,
  });

  // Get global stats for accurate active market count
  const { data: globalStats } = useGlobalStats();
  
  // Get categories for improved filter
  const { data: categoriesData } = useCategories();

  // Initialize WebSocket connection and check status
  useEffect(() => {
    // Connect WebSocket on mount
    wsService.connect();
    
    const checkConnection = () => {
      const isConnected = wsService.isConnected();
      setConnectionStatus(isConnected ? 'online' : 'offline');
    };
    
    // Check immediately
    checkConnection();
    
    // Check every 2 seconds
    const interval = setInterval(checkConnection, 2000);
    
    return () => {
      clearInterval(interval);
      // Don't disconnect on unmount - other components might be using it
    };
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  // Debounce search input
  const [searchInput, setSearchInput] = useState('');
  
  useEffect(() => {
    const timer = setTimeout(() => {
      handleSearchChange(searchInput);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, handleSearchChange]);

  // Calculate stats - use category-specific counts when filtered
  const stats = useMemo(() => {
    if (!data?.data) return { total: 0, active: 0, avgVolume: 0 };
    
    const markets = data.data;
    
    // If category is filtered, use category-specific active count
    // Otherwise use global active count
    let activeCount: number;
    if (category !== 'All' && categoriesData?.data) {
      const categoryData = categoriesData.data.find(cat => cat.name === category);
      activeCount = categoryData?.activeCount || 0;
    } else {
      activeCount = globalStats?.markets.active || 0;
    }
    
    // Calculate average volume from current page markets
    const totalVolume = markets.reduce((sum, m) => 
      sum + (Number(m.volume24h) || 0), 0
    );
    const avgVolume = markets.length > 0 ? totalVolume / markets.length : 0;

    return {
      total: data.pagination.total, // Total markets (filtered by category if applicable)
      active: activeCount, // Active markets (category-specific if filtered)
      avgVolume,
    };
  }, [data, globalStats, category, categoriesData]);

  const formatVolume = (volume: number | undefined) => {
    if (volume === undefined || volume === null) return 'N/A';
    if (volume >= 1000000) return `$${(volume / 1000000).toFixed(1)}M`;
    if (volume >= 1000) return `$${(volume / 1000).toFixed(1)}K`;
    return `$${Number(volume).toFixed(0)}`;
  };

  const formatLastTrade = (timestamp: string | undefined) => {
    if (!timestamp) return 'No trades';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);

    if (diffSec < 60) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    return date.toLocaleDateString();
  };

  // Get probability display - uses probabilityDisplay from backend if available
  const getProbabilityDisplay = (market: any): { value: number; label: string; outcome?: string } => {
    if (market.probabilityDisplay) {
      const value = Number(market.probabilityDisplay.value);
      if (!isNaN(value)) {
        if (market.probabilityDisplay.type === 'expectedValue') {
          return {
            value,
            label: 'Expected Value',
          };
        } else {
          return {
            value,
            label: 'Probability',
            outcome: market.probabilityDisplay.outcome,
          };
        }
      }
    }
    
    // Fallback: search for the leading outcome manually if probabilityDisplay is missing
    if (market.outcomes && market.outcomes.length > 0) {
      const highestProbOutcome = market.outcomes.reduce((max: any, o: any) => 
        (o.currentPrice?.implied_probability || 0) > (max.currentPrice?.implied_probability || 0) ? o : max
      , market.outcomes[0]);

      if (highestProbOutcome) {
        return {
          value: Number(highestProbOutcome.currentPrice?.implied_probability || 50),
          label: 'Probability',
          outcome: highestProbOutcome.outcome
        };
      }
    }

    // Secondary Fallback to currentPrice for backward compatibility
    if (market.currentPrice?.implied_probability !== undefined && market.currentPrice.implied_probability !== null) {
      const value = Number(market.currentPrice.implied_probability);
      if (!isNaN(value)) {
        return {
          value,
          label: 'Probability',
          outcome: (market as any).probabilityDisplay?.outcome || market.currentPrice.outcome,
        };
      }
    }
    
    return {
      value: 50,
      label: 'Probability',
    };
  };

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      Politics: 'text-blue-400',
      Crypto: 'text-yellow-400',
      Sports: 'text-green-400',
      'Pop Culture': 'text-purple-400',
    };
    return colors[category] || 'text-slate-400';
  };

  const formatEndDate = (endDate: string | null) => {
    if (!endDate) return 'No end date';
    const date = new Date(endDate);
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    
    // Don't mark as "Ended" - end_date is just an estimate
    // Polymarket can extend markets by adding new outcomes
    if (days < 0) {
      // Show how many days past the estimated end date
      const daysPast = Math.abs(days);
      return `Est. end ${daysPast}d ago`;
    }
    if (days === 0) return 'Est. ends today';
    if (days === 1) return 'Est. ends tomorrow';
    return `Est. ends in ${days} days`;
  };

  // Only show full-page loading on initial load (no data at all)
  // For subsequent loads (category changes, etc.), show table with loading overlay
  const isInitialLoad = isLoading && !data;
  
  if (isInitialLoad) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-slate-400 font-medium">Syncing with Polymarket CLOB...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-10">
      {/* Loading indicator at top when switching categories/sorting */}
      {isLoading && data && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-slate-900/90 backdrop-blur-sm border-b border-slate-800">
          <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-center gap-3">
            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-slate-400 text-sm font-medium">Loading markets...</p>
          </div>
        </div>
      )}
      {/* Top Bar - Title, Description, and Sort Filters */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-4xl font-black tracking-tight text-white">
              PolyMonitor<span className="text-blue-500">PRO</span>
            </h1>
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase border bg-purple-500/10 text-purple-400 border-purple-500/20">
              BETA
            </div>
          </div>
          <p className="text-slate-400 text-lg">Institutional-grade prediction market monitoring.</p>
        </div>

        {/* Sort Filters - Top Right Corner */}
        <div className="bg-slate-900/50 p-1 rounded-xl border border-slate-800 flex flex-shrink-0">
          {[
            { id: 'activity', label: 'Activity', icon: Activity },
            { id: 'liquidity', label: 'Liquidity', icon: Server },
            { id: 'volume24h', label: '24h Vol', icon: TrendingUp },
            { id: 'volume', label: 'Total Vol', icon: TrendingUp },
          ].map((option) => (
            <button
              key={option.id}
              onClick={() => {
                setSortBy(option.id);
                setPage(1);
              }}
              className={`px-4 py-2.5 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${
                sortBy === option.id 
                  ? 'bg-slate-700 text-white shadow-lg' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <option.icon className="w-4 h-4" />
              {option.label.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Category Filter - Above stats */}
      <div className="mb-6">
        <div className="bg-slate-900/50 p-1 rounded-xl border border-slate-800 flex flex-wrap gap-1">
          {/* Fixed order categories: All, Crypto, Politics, Sports */}
          {['All', 'Crypto', 'Politics', 'Sports'].map((cat) => (
            <button
              key={cat}
              onClick={() => {
                setCategory(cat);
                setPage(1);
              }}
              className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${
                category === cat 
                  ? 'bg-blue-600 text-white shadow-lg' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {cat.toUpperCase()}
            </button>
          ))}
          {/* Dynamic categories from API (sorted by active count) */}
          {categoriesData?.data
            .filter(cat => !['All', 'Crypto', 'Politics', 'Sports'].includes(cat.name))
            .slice(0, 6) // Show top 6 dynamic categories
            .map((cat) => (
              <button
                key={cat.name}
                onClick={() => {
                  setCategory(cat.name);
                  setPage(1);
                }}
                className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${
                  category === cat.name 
                    ? 'bg-blue-600 text-white shadow-lg' 
                    : 'text-slate-400 hover:text-white'
                }`}
                title={`${cat.activeCount} active, ${cat.marketCount} total`}
              >
                {cat.name.toUpperCase()}
              </button>
            ))}
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Live Markets" value={stats.total} color="blue" />
        <StatCard label="Active Markets" value={stats.active} color="green" />
        <StatCard label="Category" value={category !== 'All' ? category : 'All'} color="purple" />
        <StatCard label="Avg Vol (24h)" value={formatVolume(stats.avgVolume)} color="slate" />
      </div>

      {/* Search Bar */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search markets..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-[#121826] border border-slate-800 rounded-xl text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-950/80 border border-red-500/50 rounded-xl p-4 text-red-100 mb-6">
          Error loading markets. Please try again later.
        </div>
      )}

      {/* Main Content Table */}
      {(data || (isLoading && data)) && (
        <>
          <div className="bg-[#121826] rounded-3xl border border-slate-800/60 shadow-2xl overflow-hidden relative">
            {/* Loading overlay for subsequent loads */}
            {isLoading && data && (
              <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm z-10 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-slate-400 text-sm font-medium">Loading...</p>
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse -ml-6">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/30">
                    <th className="pl-6 pr-8 py-5 text-xs font-bold text-slate-500 uppercase tracking-widest"></th>
                    <th colSpan={8} className="px-8 py-5 text-xs font-bold text-slate-500 uppercase tracking-widest">Market</th>
                  </tr>
                  <tr className="border-b border-slate-800 bg-slate-900/30">
                    <th className="pl-6 pr-8 py-5 text-xs font-bold text-slate-500 uppercase tracking-widest"></th>
                    <th className="px-8 py-5 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Probability</th>
                    <th className="px-8 py-5 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Vol (24h)</th>
                    <th className="px-8 py-5 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Total Vol</th>
                    <th className="px-8 py-5 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Last Trade</th>
                    <th className="px-8 py-5 text-xs font-bold text-slate-500 uppercase tracking-widest text-center">Category</th>
                    <th className="px-8 py-5 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Liquidity</th>
                    <th className="px-8 py-5 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Status</th>
                    <th className="px-8 py-5 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  <AnimatePresence mode="popLayout">
                    {data.data.map((market) => (
                      <MarketRow
                        key={market.id}
                        market={market}
                        getProbabilityDisplay={getProbabilityDisplay}
                        formatVolume={formatVolume}
                        formatLastTrade={formatLastTrade}
                        getCategoryColor={getCategoryColor}
                        formatEndDate={formatEndDate}
                      />
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {data.pagination.totalPages > 1 && (
            <div className="flex justify-center items-center gap-4 mt-8">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-6 py-3 bg-[#121826] border border-slate-800 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-800 text-slate-300 font-bold transition-all"
              >
                Previous
              </button>
              <span className="text-slate-400 font-mono">
                Page {data.pagination.page} of {data.pagination.totalPages}
              </span>
              <button
                onClick={() =>
                  setPage((p) => Math.min(data.pagination.totalPages, p + 1))
                }
                disabled={page === data.pagination.totalPages}
                className="px-6 py-3 bg-[#121826] border border-slate-800 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-800 text-slate-300 font-bold transition-all"
              >
                Next
              </button>
            </div>
          )}

          {data.data.length === 0 && (
            <div className="text-center py-12 text-slate-500">
              No markets found. Try adjusting your filters.
            </div>
          )}
        </>
      )}

      {/* Footer with health status */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#121826] border-t border-slate-800/60 shadow-2xl z-50">
        <div className="max-w-7xl mx-auto px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 uppercase tracking-widest font-bold">WebSocket:</span>
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold uppercase border ${
                  connectionStatus === 'online' 
                    ? 'bg-green-500/10 text-green-400 border-green-500/20' 
                    : connectionStatus === 'connecting'
                    ? 'bg-orange-500/10 text-orange-400 border-orange-500/20'
                    : 'bg-red-500/10 text-red-400 border-red-500/20'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    connectionStatus === 'online' ? 'bg-green-500' 
                    : connectionStatus === 'connecting' ? 'bg-orange-500'
                    : 'bg-red-500'
                  } animate-pulse`}></span>
                  {connectionStatus}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 uppercase tracking-widest font-bold">API:</span>
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold uppercase border ${
                  !error && data
                    ? 'bg-green-500/10 text-green-400 border-green-500/20' 
                    : 'bg-red-500/10 text-red-400 border-red-500/20'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    !error && data ? 'bg-green-500' : 'bg-red-500'
                  }`}></span>
                  {!error && data ? 'healthy' : 'error'}
                </div>
              </div>
            </div>
            <div className="text-xs text-slate-500">
              PolyMonitorPRO © 2025
            </div>
          </div>
        </div>
      </div>
      
      {/* Add padding to bottom to account for fixed footer */}
      <div className="h-16"></div>
    </div>
  );
};

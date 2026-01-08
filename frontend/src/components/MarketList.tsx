import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, ExternalLink } from 'lucide-react';
import { useMarkets } from '../hooks/useMarkets';
import { Link } from 'react-router-dom';
import { wsService } from '../services/websocket';

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

export const MarketList = () => {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [sortBy] = useState('updated_at');
  const [connectionStatus, setConnectionStatus] = useState<'online' | 'connecting' | 'offline'>('connecting');

  const { data, isLoading, error } = useMarkets({
    page,
    limit: 20,
    search: search || undefined,
    category: category !== 'All' ? category : undefined,
    sortBy,
  });

  // Check WebSocket connection status
  useEffect(() => {
    const checkConnection = () => {
      setConnectionStatus(wsService.isConnected() ? 'online' : 'offline');
    };
    
    checkConnection();
    const interval = setInterval(checkConnection, 2000);
    return () => clearInterval(interval);
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

  // Calculate stats
  const stats = useMemo(() => {
    if (!data?.data) return { total: 0, active: 0, avgLiquidity: 0 };
    
    const markets = data.data;
    const activeMarkets = markets.filter(m => {
      if (!m.end_date) return true;
      return new Date(m.end_date) > new Date();
    });
    
    // Calculate average liquidity (placeholder - will use actual liquidity scores later)
    const avgLiquidity = 0;

    return {
      total: data.pagination.total,
      active: activeMarkets.length,
      avgLiquidity: Math.round(avgLiquidity),
    };
  }, [data]);

  const getProbability = (market: any): number => {
    if (market.currentPrice?.implied_probability !== undefined && market.currentPrice.implied_probability !== null) {
      return Number(market.currentPrice.implied_probability);
    }
    return 50;
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
    
    if (days < 0) return 'Ended';
    if (days === 0) return 'Ends today';
    if (days === 1) return 'Ends tomorrow';
    return `Ends in ${days} days`;
  };

  if (isLoading && !data) {
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
      {/* Top Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-4xl font-black tracking-tight text-white">
              PolyMonitor<span className="text-blue-500">PRO</span>
            </h1>
            <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase border ${
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
          <p className="text-slate-400 text-lg">Institutional-grade prediction market monitoring.</p>
        </div>

        {/* Time Filters - Placeholder for future volume-based filtering */}
        <div className="bg-slate-900/50 p-1 rounded-xl border border-slate-800 flex">
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
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Live Markets" value={stats.total} color="blue" />
        <StatCard label="Active Markets" value={stats.active} color="green" />
        <StatCard label="Category" value={category !== 'All' ? category : 'All'} color="purple" />
        <StatCard label="Avg Liquidity" value={`${stats.avgLiquidity}%`} color="slate" />
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
      {data && (
        <>
          <div className="bg-[#121826] rounded-3xl border border-slate-800/60 shadow-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/30">
                    <th className="px-8 py-5 text-xs font-bold text-slate-500 uppercase tracking-widest">Market</th>
                    <th className="px-8 py-5 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Probability</th>
                    <th className="px-8 py-5 text-xs font-bold text-slate-500 uppercase tracking-widest text-center">Category</th>
                    <th className="px-8 py-5 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Status</th>
                    <th className="px-8 py-5 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {data.data.map((market) => {
                    const probability = getProbability(market);
                    const isHighProbability = probability > 70 || probability < 30;
                    
                    return (
                      <tr 
                        key={market.id} 
                        className="group hover:bg-slate-800/20 transition-all"
                      >
                        <td className="px-8 py-6">
                          <div className="flex flex-col">
                            <Link 
                              to={`/markets/${market.id}`}
                              className="text-white font-bold text-base leading-tight group-hover:text-blue-400 transition-colors"
                            >
                              {market.question}
                            </Link>
                            <span className="text-slate-500 text-xs mt-1 font-mono uppercase tracking-tighter">{market.id}</span>
                          </div>
                        </td>
                        <td className="px-8 py-6 text-right">
                          <div className={`font-mono font-black text-lg ${
                            isHighProbability ? 'text-red-500' : 'text-blue-400'
                          }`}>
                            {probability.toFixed(1)}%
                          </div>
                        </td>
                        <td className="px-8 py-6 text-center">
                          <span className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-slate-800/50 text-[10px] font-bold uppercase ${getCategoryColor(market.category)}`}>
                            {market.category}
                          </span>
                        </td>
                        <td className="px-8 py-6 text-right">
                          <div className="text-slate-400 text-sm font-mono">
                            {formatEndDate(market.end_date)}
                          </div>
                        </td>
                        <td className="px-8 py-6 text-right">
                          <Link
                            to={`/markets/${market.id}`}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800 hover:bg-blue-600 text-slate-400 hover:text-white transition-all transform active:scale-95"
                          >
                            <ExternalLink className="w-5 h-5" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
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
    </div>
  );
};

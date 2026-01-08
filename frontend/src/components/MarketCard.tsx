import { memo } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, Clock } from 'lucide-react';
import { Market } from '../services/api';
import { useRealtimePrice } from '../hooks/useRealtimePrice';

interface MarketCardProps {
  market: Market;
}

export const MarketCard = memo(({ market }: MarketCardProps) => {
  const priceUpdate = useRealtimePrice(market.id);
  
  // Use real-time price if available, otherwise use initial price from API, fallback to 50%
  // Ensure probability is always a number
  const getProbability = (): number => {
    if (priceUpdate?.impliedProbability !== undefined && priceUpdate.impliedProbability !== null) {
      return Number(priceUpdate.impliedProbability);
    }
    if (market.currentPrice?.implied_probability !== undefined && market.currentPrice.implied_probability !== null) {
      return Number(market.currentPrice.implied_probability);
    }
    return 50;
  };
  
  const probability = getProbability();
  const isUpdating = !!priceUpdate;

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      Politics: 'bg-blue-100 text-blue-800',
      Crypto: 'bg-yellow-100 text-yellow-800',
      Sports: 'bg-green-100 text-green-800',
      'Pop Culture': 'bg-purple-100 text-purple-800',
    };
    return colors[category] || 'bg-gray-100 text-gray-800';
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

  return (
    <Link
      to={`/markets/${market.id}`}
      className="block bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow p-6 border border-gray-200"
    >
      <div className="flex items-start justify-between mb-4">
        <span
          className={`px-2 py-1 rounded-full text-xs font-medium ${getCategoryColor(
            market.category
          )}`}
        >
          {market.category}
        </span>
        {isUpdating && (
          <span className="flex items-center text-green-600 text-xs">
            <TrendingUp className="w-3 h-3 mr-1" />
            Live
          </span>
        )}
      </div>

      <h3 className="text-lg font-semibold text-gray-900 mb-3 line-clamp-2">
        {market.question}
      </h3>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 mb-1">Implied Probability</p>
          <p className="text-2xl font-bold text-primary-600">
            {probability.toFixed(1)}%
          </p>
        </div>
        <div className="text-right">
          <div className="flex items-center text-gray-500 text-sm mb-1">
            <Clock className="w-4 h-4 mr-1" />
            {formatEndDate(market.end_date)}
          </div>
        </div>
      </div>
    </Link>
  );
});


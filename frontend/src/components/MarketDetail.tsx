import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Clock, TrendingUp } from 'lucide-react';
import { useMarketDetail } from '../hooks/useMarketDetail';
import { useRealtimePrice } from '../hooks/useRealtimePrice';
import { PriceChart } from './PriceChart';

export const MarketDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { data: market, isLoading, error } = useMarketDetail(id || '');
  const priceUpdate = useRealtimePrice(id);

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          <p className="mt-4 text-gray-600">Loading market details...</p>
        </div>
      </div>
    );
  }

  if (error || !market) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
          Error loading market. Please try again later.
        </div>
        <Link
          to="/"
          className="mt-4 inline-flex items-center text-primary-600 hover:text-primary-700"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Markets
        </Link>
      </div>
    );
  }

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
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const primaryOutcome = market.outcomes?.[0];
  const currentPrice = priceUpdate || primaryOutcome?.currentPrice;

  return (
    <div className="container mx-auto px-4 py-8">
      <Link
        to="/"
        className="inline-flex items-center text-primary-600 hover:text-primary-700 mb-6"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Markets
      </Link>

      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <span
            className={`px-3 py-1 rounded-full text-sm font-medium ${getCategoryColor(
              market.category
            )}`}
          >
            {market.category}
          </span>
          {priceUpdate && (
            <span className="flex items-center text-green-600 text-sm">
              <TrendingUp className="w-4 h-4 mr-1" />
              Live Updates
            </span>
          )}
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-4">
          {market.question}
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-sm text-gray-600 mb-1">Implied Probability</p>
            <p className="text-3xl font-bold text-primary-600">
              {currentPrice?.implied_probability
                ? `${currentPrice.implied_probability.toFixed(1)}%`
                : 'N/A'}
            </p>
          </div>

          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-sm text-gray-600 mb-1">Bid Price</p>
            <p className="text-3xl font-bold text-gray-900">
              {currentPrice?.bid_price
                ? currentPrice.bid_price.toFixed(4)
                : 'N/A'}
            </p>
          </div>

          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-sm text-gray-600 mb-1">Ask Price</p>
            <p className="text-3xl font-bold text-gray-900">
              {currentPrice?.ask_price
                ? currentPrice.ask_price.toFixed(4)
                : 'N/A'}
            </p>
          </div>
        </div>

        <div className="flex items-center text-gray-600">
          <Clock className="w-4 h-4 mr-2" />
          <span>End Date: {formatEndDate(market.end_date)}</span>
        </div>
      </div>

      {/* Price History Chart */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">
          Price History
        </h2>
        <PriceChart marketId={market.id} />
      </div>

      {/* Outcomes */}
      {market.outcomes && market.outcomes.length > 0 && (
        <div className="bg-white rounded-lg shadow-md p-6 mt-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Outcomes</h2>
          <div className="space-y-4">
            {market.outcomes.map((outcome) => (
              <div
                key={outcome.id}
                className="border border-gray-200 rounded-lg p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-900">
                    {outcome.outcome}
                  </span>
                  {outcome.currentPrice && (
                    <span className="text-primary-600 font-bold">
                      {outcome.currentPrice.implied_probability.toFixed(1)}%
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


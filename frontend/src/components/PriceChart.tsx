import { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useMarketHistory } from '../hooks/useMarketHistory';

interface PriceChartProps {
  marketId: string;
}

export const PriceChart = ({ marketId }: PriceChartProps) => {
  const [timeframe, setTimeframe] = useState<'24h' | '7d' | '30d'>('24h');
  const { data, isLoading } = useMarketHistory(marketId, timeframe);

  if (isLoading) {
    return (
      <div className="h-64 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!data || data.data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-gray-500">
        No price history available
      </div>
    );
  }

  // Transform data for chart - ensure all values are numbers
  const chartData = data.data.map((item) => {
    const impliedProb = Number(item.implied_probability) || 0;
    const bidPrice = Number(item.bid_price) || 0;
    const askPrice = Number(item.ask_price) || 0;
    
    return {
      time: new Date(item.timestamp).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      probability: parseFloat(impliedProb.toFixed(2)),
      bid: parseFloat(bidPrice.toFixed(4)),
      ask: parseFloat(askPrice.toFixed(4)),
    };
  });

  return (
    <div>
      {/* Timeframe Selector */}
      <div className="flex gap-2 mb-4">
        {(['24h', '7d', '30d'] as const).map((tf) => (
          <button
            key={tf}
            onClick={() => setTimeframe(tf)}
            className={`px-4 py-2 rounded-lg transition-colors ${
              timeframe === tf
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {tf}
          </button>
        ))}
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 12 }}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 12 }}
            label={{
              value: 'Probability (%)',
              angle: -90,
              position: 'insideLeft',
            }}
          />
          <Tooltip
            formatter={(value: number) => `${value}%`}
            labelStyle={{ color: '#374151' }}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="probability"
            stroke="#0ea5e9"
            strokeWidth={2}
            dot={false}
            name="Implied Probability"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};


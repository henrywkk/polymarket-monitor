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
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!data || data.data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-slate-500">
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
      <div className="flex gap-2 mb-6">
        {(['24h', '7d', '30d'] as const).map((tf) => (
          <button
            key={tf}
            onClick={() => setTimeframe(tf)}
            className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${
              timeframe === tf
                ? 'bg-blue-600 text-white shadow-lg'
                : 'bg-slate-900/50 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            {tf.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 12, fill: '#94a3b8' }}
            interval="preserveStartEnd"
            stroke="#475569"
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 12, fill: '#94a3b8' }}
            stroke="#475569"
            label={{
              value: 'Probability (%)',
              angle: -90,
              position: 'insideLeft',
              fill: '#94a3b8'
            }}
          />
          <Tooltip
            formatter={(value: number) => `${value}%`}
            contentStyle={{ 
              backgroundColor: '#121826', 
              border: '1px solid rgba(148, 163, 184, 0.2)',
              borderRadius: '0.75rem',
              color: '#e2e8f0'
            }}
            labelStyle={{ color: '#e2e8f0' }}
          />
          <Legend 
            wrapperStyle={{ color: '#e2e8f0', paddingTop: '20px' }}
            iconType="line"
          />
          <Line
            type="monotone"
            dataKey="probability"
            stroke="#3b82f6"
            strokeWidth={3}
            dot={false}
            name="Implied Probability"
            activeDot={{ r: 6, fill: '#3b82f6' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};


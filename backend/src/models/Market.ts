export interface Market {
  id: string;
  question: string;
  slug: string;
  category: string;
  endDate: Date | null;
  imageUrl: string | null;
  volume?: number;
  volume24h?: number;
  liquidity?: number;
  lastTradeAt?: Date;
  activityScore?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MarketWithOutcomes extends Market {
  outcomes?: Outcome[];
  currentPrice?: PriceData;
  liquidityScore?: number; // 0-100 liquidity score
  lastTradeAt?: Date;
}

export interface Outcome {
  id: string;
  marketId: string;
  outcome: string;
  tokenId: string;
  createdAt: Date;
}

export interface PriceData {
  bidPrice: number;
  askPrice: number;
  midPrice: number;
  impliedProbability: number;
}

export interface PriceHistory {
  id: number;
  marketId: string;
  outcomeId: string;
  timestamp: Date;
  bidPrice: number;
  askPrice: number;
  midPrice: number;
  impliedProbability: number;
  createdAt: Date;
}


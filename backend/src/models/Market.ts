export interface Market {
  id: string;
  question: string;
  slug: string;
  category: string;
  endDate: Date | null;
  imageUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MarketWithOutcomes extends Market {
  outcomes?: Outcome[];
  currentPrice?: PriceData;
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


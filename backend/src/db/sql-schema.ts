// Embedded SQL schema as fallback if init.sql file is not found
export const SQL_SCHEMA = `
-- Create markets table
CREATE TABLE IF NOT EXISTS markets (
    id VARCHAR(255) PRIMARY KEY,
    question TEXT NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    category VARCHAR(100) NOT NULL,
    end_date TIMESTAMP,
    image_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create outcomes table
CREATE TABLE IF NOT EXISTS outcomes (
    id VARCHAR(255) PRIMARY KEY,
    market_id VARCHAR(255) NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    outcome VARCHAR(50) NOT NULL,
    token_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(market_id, outcome)
);

-- Create price_history table
CREATE TABLE IF NOT EXISTS price_history (
    id SERIAL PRIMARY KEY,
    market_id VARCHAR(255) NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    outcome_id VARCHAR(255) NOT NULL REFERENCES outcomes(id) ON DELETE CASCADE,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    bid_price DECIMAL(10, 8) NOT NULL,
    ask_price DECIMAL(10, 8) NOT NULL,
    mid_price DECIMAL(10, 8) NOT NULL,
    implied_probability DECIMAL(5, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_markets_category ON markets(category);
CREATE INDEX IF NOT EXISTS idx_markets_end_date ON markets(end_date);
CREATE INDEX IF NOT EXISTS idx_outcomes_market_id ON outcomes(market_id);
CREATE INDEX IF NOT EXISTS idx_price_history_market_id ON price_history(market_id);
CREATE INDEX IF NOT EXISTS idx_price_history_timestamp ON price_history(timestamp);
CREATE INDEX IF NOT EXISTS idx_price_history_market_timestamp ON price_history(market_id, timestamp DESC);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for markets table
CREATE TRIGGER update_markets_updated_at BEFORE UPDATE ON markets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
`;


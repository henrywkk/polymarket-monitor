const axios = require('axios');

async function testTokens() {
  // Get the event first
  const eventResponse = await axios.get('https://gamma-api.polymarket.com/events/38001');
  const event = eventResponse.data;
  
  console.log('Event:', event.title);
  console.log(`Found ${event.markets.length} nested markets\n`);
  
  // Check first nested market's tokens by fetching its condition
  if (event.markets && event.markets.length > 0) {
    const firstMarket = event.markets[0];
    const conditionId = firstMarket.condition_id;
    
    console.log('First nested market:');
    console.log('  Question:', firstMarket.question);
    console.log('  Condition ID:', conditionId);
    
    // Try to fetch tokens from the condition
    console.log('\nFetching tokens for condition:', conditionId);
    
    try {
      // Try Gamma API /markets/{conditionId}
      const marketResponse = await axios.get(`https://gamma-api.polymarket.com/markets/${conditionId}`);
      console.log('\nGamma /markets/{conditionId} response:');
      console.log('  Keys:', Object.keys(marketResponse.data).slice(0, 15));
      console.log('  Question:', marketResponse.data.question || marketResponse.data.title);
      console.log('  Tokens:', marketResponse.data.tokens?.length || 0);
      
      if (marketResponse.data.tokens && marketResponse.data.tokens.length > 0) {
        console.log('\n  Sample tokens (first 3):');
        marketResponse.data.tokens.slice(0, 3).forEach((token, idx) => {
          console.log(`    Token ${idx + 1}:`, {
            token_id: token.token_id || token.asset_id || token.id,
            outcome: token.outcome || token.label || token.name,
          });
        });
      }
    } catch (error) {
      console.error('  Error fetching from Gamma /markets:', error.message);
    }
    
    // Try CLOB API
    try {
      const clobResponse = await axios.get(`https://clob.polymarket.com/markets/${conditionId}`);
      console.log('\nCLOB /markets/{conditionId} response:');
      console.log('  Keys:', Object.keys(clobResponse.data).slice(0, 15));
      if (clobResponse.data.tokens) {
        console.log('  Tokens:', clobResponse.data.tokens.length);
        console.log('  Sample tokens (first 3):');
        clobResponse.data.tokens.slice(0, 3).forEach((token, idx) => {
          console.log(`    Token ${idx + 1}:`, {
            token_id: token.token_id || token.asset_id || token.id,
            outcome: token.outcome || token.label || token.name,
          });
        });
      }
    } catch (error) {
      console.error('  Error fetching from CLOB /markets:', error.message);
    }
  }
}

testTokens().catch(console.error);

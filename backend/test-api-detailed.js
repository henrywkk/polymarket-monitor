const axios = require('axios');

async function testDetailed() {
  const marketId = '38001';
  
  console.log('Fetching detailed market structure...\n');
  
  try {
    const response = await axios.get(`https://gamma-api.polymarket.com/events/${marketId}`);
    const event = response.data;
    
    console.log('Event:', event.title);
    console.log('Event ID:', event.id);
    console.log(`\nFound ${event.markets.length} nested markets:\n`);
    
    // Check first nested market in detail
    if (event.markets && event.markets.length > 0) {
      const firstMarket = event.markets[0];
      console.log('First nested market:');
      console.log('  Question:', firstMarket.question);
      console.log('  Condition ID:', firstMarket.condition_id || firstMarket.conditionId);
      console.log('  Tokens count:', firstMarket.tokens?.length || 0);
      
      if (firstMarket.tokens && firstMarket.tokens.length > 0) {
        console.log('\n  Sample tokens (first 3):');
        firstMarket.tokens.slice(0, 3).forEach((token, idx) => {
          console.log(`    Token ${idx + 1}:`, {
            token_id: token.token_id || token.asset_id || token.id,
            outcome: token.outcome || token.label || token.name,
            allKeys: Object.keys(token),
          });
        });
      }
      
      // Show all nested markets and extract bucket names
      console.log('\n\nAll nested markets with bucket extraction:');
      event.markets.forEach((market, idx) => {
        // Extract bucket from question
        let bucket = '';
        const question = market.question || '';
        
        if (question.includes('less than')) {
          const match = question.match(/less than ([\d.]+)%/);
          bucket = match ? `<${match[1]}%` : question;
        } else if (question.includes('greater than')) {
          const match = question.match(/greater than ([\d.]+)%/);
          bucket = match ? `>${match[1]}%` : question;
        } else if (question.includes('between')) {
          const match = question.match(/between ([\d.]+)% and ([\d.]+)%/);
          bucket = match ? `${match[1]}-${match[2]}%` : question;
        } else {
          bucket = question;
        }
        
        console.log(`  Market ${idx + 1}: "${bucket}"`);
        console.log(`    Question: ${question}`);
        console.log(`    Condition ID: ${market.condition_id || market.conditionId}`);
        console.log(`    Tokens: ${market.tokens?.length || 0}`);
      });
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testDetailed().catch(console.error);

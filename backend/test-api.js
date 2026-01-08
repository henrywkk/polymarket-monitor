const axios = require('axios');

async function testPolymarketAPI() {
  const marketId = '38001';
  const slug = 'gdp-growth-in-2025';
  
  console.log('='.repeat(80));
  console.log('Testing Polymarket API for market:', marketId, '| slug:', slug);
  console.log('='.repeat(80));
  
  // Test 1: Gamma API /events/{id}
  console.log('\n1. Gamma API /events/{id}');
  console.log('-'.repeat(80));
  try {
    const response1 = await axios.get(`https://gamma-api.polymarket.com/events/${marketId}`);
    console.log('Status:', response1.status);
    console.log('Response keys:', Object.keys(response1.data).slice(0, 20));
    console.log('\nFull response (first 500 chars):');
    console.log(JSON.stringify(response1.data, null, 2).substring(0, 500));
    
    // Check for nested markets
    if (response1.data.markets && Array.isArray(response1.data.markets)) {
      console.log(`\nFound ${response1.data.markets.length} nested markets:`);
      response1.data.markets.forEach((market, idx) => {
        console.log(`  Market ${idx + 1}:`, {
          question: market.question || market.title,
          conditionId: market.condition_id || market.conditionId,
          tokens: market.tokens?.length || market.outcomes?.length || 0,
          sampleToken: market.tokens?.[0] || market.outcomes?.[0],
        });
      });
    }
    
    // Check for tokens/outcomes at top level
    if (response1.data.tokens || response1.data.outcomes) {
      const tokens = response1.data.tokens || response1.data.outcomes;
      console.log(`\nTop-level tokens/outcomes (${tokens.length}):`);
      tokens.slice(0, 5).forEach((t, idx) => {
        console.log(`  Token ${idx + 1}:`, {
          token_id: t.token_id || t.asset_id || t.id,
          outcome: t.outcome || t.label || t.name,
          allKeys: Object.keys(t),
        });
      });
    }
  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
  }
  
  // Test 2: Gamma API /events?slug=...
  console.log('\n\n2. Gamma API /events?slug={slug}');
  console.log('-'.repeat(80));
  try {
    const response2 = await axios.get(`https://gamma-api.polymarket.com/events`, {
      params: { slug }
    });
    console.log('Status:', response2.status);
    if (Array.isArray(response2.data)) {
      console.log(`Found ${response2.data.length} events`);
      if (response2.data.length > 0) {
        const event = response2.data[0];
        console.log('First event keys:', Object.keys(event).slice(0, 20));
        console.log('\nFirst event (first 500 chars):');
        console.log(JSON.stringify(event, null, 2).substring(0, 500));
      }
    } else {
      console.log('Response keys:', Object.keys(response2.data).slice(0, 20));
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
  
  // Test 3: CLOB API /markets/{id}
  console.log('\n\n3. CLOB API /markets/{id}');
  console.log('-'.repeat(80));
  try {
    const response3 = await axios.get(`https://clob.polymarket.com/markets/${marketId}`);
    console.log('Status:', response3.status);
    console.log('Response keys:', Object.keys(response3.data).slice(0, 20));
    console.log('\nResponse (first 500 chars):');
    console.log(JSON.stringify(response3.data, null, 2).substring(0, 500));
  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
    }
  }
  
  // Test 4: CLOB API /v2/markets/{id}
  console.log('\n\n4. CLOB API /v2/markets/{id}');
  console.log('-'.repeat(80));
  try {
    const response4 = await axios.get(`https://clob.polymarket.com/v2/markets/${marketId}`);
    console.log('Status:', response4.status);
    console.log('Response keys:', Object.keys(response4.data).slice(0, 20));
    console.log('\nResponse (first 500 chars):');
    console.log(JSON.stringify(response4.data, null, 2).substring(0, 500));
  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
    }
  }
}

testPolymarketAPI().catch(console.error);

const axios = require('axios');

async function testFieldNames() {
  const response = await axios.get('https://gamma-api.polymarket.com/events/38001');
  const event = response.data;
  
  if (event.markets && event.markets.length > 0) {
    const firstMarket = event.markets[0];
    console.log('First nested market - all keys:');
    console.log(Object.keys(firstMarket));
    console.log('\nFirst nested market - full object:');
    console.log(JSON.stringify(firstMarket, null, 2));
  }
}

testFieldNames().catch(console.error);

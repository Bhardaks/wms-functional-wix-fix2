require('dotenv').config();
const axios = require('axios');

const ECOM_ORDERS_SEARCH = 'https://www.wixapis.com/ecom/v1/orders/search';

function headers() {
  const key = process.env.WIX_API_KEY;
  const siteId = process.env.WIX_SITE_ID;
  return {
    Authorization: key,
    'wix-site-id': siteId,
    'Content-Type': 'application/json'
  };
}

(async () => {
  try {
    console.log('=== Offset-Based Pagination Test ===');
    
    const limit = 25;
    let offset = 0;
    let allOrders = [];
    
    for (let page = 1; page <= 5; page++) {
      console.log(`\n📄 Sayfa ${page} (offset: ${offset})`);
      
      const body = {
        paging: { limit, offset },
        sort: [{ fieldName: 'createdDate', order: 'DESC' }]
      };
      
      const response = await axios.post(ECOM_ORDERS_SEARCH, body, { headers: headers() });
      const orders = response.data?.orders || [];
      
      console.log(`   ${orders.length} sipariş alındı`);
      
      if (orders.length === 0) {
        console.log('   Sipariş kalmadı, durduruluyor');
        break;
      }
      
      console.log(`   İlk: ${orders[0]?.number}, Son: ${orders[orders.length-1]?.number}`);
      
      // Önceki sayfalarla çakışma var mı?
      const currentNumbers = new Set(orders.map(o => o.number));
      const previousNumbers = new Set(allOrders.map(o => o.number));
      const overlap = [...currentNumbers].filter(n => previousNumbers.has(n));
      
      console.log(`   Önceki sayfalarla ortak: ${overlap.length}`);
      
      allOrders.push(...orders);
      offset += limit;
      
      // API'den total bilgisi var mı?
      const metadata = response.data?.metadata;
      if (metadata) {
        console.log(`   Metadata: total=${metadata.count}, hasNext=${metadata.hasNext}`);
      }
    }
    
    console.log(`\n📊 Toplam sonuç:`);
    console.log(`   Benzersiz sipariş: ${new Set(allOrders.map(o => o.number)).size}`);
    console.log(`   Toplam fetch: ${allOrders.length}`);
    
    // Hedef siparişleri ara
    const targets = ['10113', '10274', '10281'];
    console.log('\n🎯 Hedef siparişler:');
    targets.forEach(target => {
      const found = allOrders.find(o => o.number === target);
      if (found) {
        console.log(`   ✅ ${target}: Bulundu!`);
      } else {
        console.log(`   ❌ ${target}: Bulunamadı`);
      }
    });
    
    if (allOrders.length > 0) {
      const numbers = allOrders.map(o => parseInt(o.number)).filter(n => !isNaN(n)).sort((a, b) => a - b);
      console.log(`\n📈 Sayısal aralık: ${numbers[0]} - ${numbers[numbers.length-1]}`);
    }
    
  } catch (error) {
    console.error('❌ Offset Test Hatası:', error.response?.data || error.message);
  }
})();
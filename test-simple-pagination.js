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
    console.log('=== Basit Wix API Pagination Test ===');
    
    // İlk önce cursor olmadan test et
    console.log('\n📄 1. Sayfa (cursor yok)');
    const firstResponse = await axios.post(ECOM_ORDERS_SEARCH, {
      cursorPaging: { limit: 25 },
      // Filtre olmadan dene
      // filter: { 
      //   createdDate: { $gte: '2023-01-01T00:00:00.000Z' },
      //   status: { $ne: 'INITIALIZED' }
      // },
      sort: [{ fieldName: 'createdDate', order: 'DESC' }]
    }, { headers: headers() });
    
    const firstOrders = firstResponse.data?.orders || [];
    console.log(`   ${firstOrders.length} sipariş: ${firstOrders.slice(0, 3).map(o => o.number).join(', ')}...${firstOrders.slice(-3).map(o => o.number).join(', ')}`);
    
    const cursor = firstResponse.data?.metadata?.cursors?.next;
    console.log(`   Next cursor: ${cursor ? cursor.substring(0, 50) + '...' : 'YOK'}`);
    
    if (!cursor) {
      console.log('❌ Cursor yok, pagination çalışmıyor');
      return;
    }
    
    // Şimdi cursor ile ikinci sayfayı çek
    console.log('\n📄 2. Sayfa (cursor ile)');
    const secondResponse = await axios.post(ECOM_ORDERS_SEARCH, {
      cursorPaging: { limit: 25, cursor },
      // Filtre olmadan dene
      // filter: { 
      //   createdDate: { $gte: '2023-01-01T00:00:00.000Z' },
      //   status: { $ne: 'INITIALIZED' }
      // },
      sort: [{ fieldName: 'createdDate', order: 'DESC' }]
    }, { headers: headers() });
    
    const secondOrders = secondResponse.data?.orders || [];
    console.log(`   ${secondOrders.length} sipariş: ${secondOrders.slice(0, 3).map(o => o.number).join(', ')}...${secondOrders.slice(-3).map(o => o.number).join(', ')}`);
    
    const newCursor = secondResponse.data?.metadata?.cursors?.next;
    console.log(`   Next cursor: ${newCursor ? newCursor.substring(0, 50) + '...' : 'YOK'}`);
    
    // Karşılaştır
    console.log('\n🔍 Karşılaştırma:');
    console.log(`   Cursor değişti mi? ${cursor !== newCursor ? 'EVET' : 'HAYIR'}`);
    
    const firstNumbers = new Set(firstOrders.map(o => o.number));
    const secondNumbers = new Set(secondOrders.map(o => o.number));
    const overlap = [...firstNumbers].filter(n => secondNumbers.has(n));
    
    console.log(`   Ortak siparişler: ${overlap.length}/${firstOrders.length}`);
    if (overlap.length === 0) {
      console.log('✅ Farklı siparişler, pagination çalışıyor!');
    } else {
      console.log('❌ Aynı siparişler, pagination çalışmıyor');
      console.log(`   Ortak: ${overlap.slice(0, 5).join(', ')}${overlap.length > 5 ? '...' : ''}`);
    }
    
  } catch (error) {
    console.error('❌ Test Hatası:', error.response?.data || error.message);
  }
})();
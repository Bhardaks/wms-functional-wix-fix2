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
    console.log('=== Wix API Pagination Test ===');
    
    let cursor = null;
    let pageCount = 0;
    let totalFetched = 0;
    
    while (pageCount < 5) { // Sadece ilk 5 sayfa test et
      pageCount++;
      
      const body = { 
        cursorPaging: { limit: 25 },
        ...(cursor && { cursorPaging: { limit: 25, cursor } }),
        filter: { 
          createdDate: { $gte: '2023-01-01T00:00:00.000Z' },
          status: { $ne: 'INITIALIZED' }
        },
        sort: [{ fieldName: 'createdDate', order: 'DESC' }]
      };
      
      console.log(`\n📄 Sayfa ${pageCount} (cursor: ${cursor ? cursor.substring(0, 30) + '...' : 'null'})`);
      
      const { data } = await axios.post(ECOM_ORDERS_SEARCH, body, { headers: headers() });
      const items = data?.orders || [];
      
      totalFetched += items.length;
      console.log(`   ${items.length} sipariş alındı (Toplam: ${totalFetched})`);
      console.log(`   İlk sipariş: ${items[0]?.number} (${items[0]?.createdDate})`);
      console.log(`   Son sipariş: ${items[items.length - 1]?.number} (${items[items.length - 1]?.createdDate})`);
      console.log(`   Tüm siparişler: ${items.map(o => o.number).join(', ')}`);
      console.log(`   hasNext: ${data.metadata?.hasNext}`);
      console.log(`   Total: ${data.metadata?.count}`);
      
      const newCursor = data?.metadata?.cursors?.next || null;
      
      console.log(`   Eski cursor: ${cursor ? cursor.substring(0, 50) + '...' : 'null'}`);
      console.log(`   Yeni cursor: ${newCursor ? newCursor.substring(0, 50) + '...' : 'null'}`);
      console.log(`   Cursor eşit mi? ${newCursor === cursor}`);
      
      if (newCursor && newCursor === cursor) {
        console.log('⚠️  Cursor değişmedi, pagination durdu');
        break;
      }
      
      if (!newCursor) {
        console.log('✅ Cursor null, pagination tamamlandı');
        break;
      }
      
      cursor = newCursor;
    }
    
    console.log(`\n📊 Test sonucu: ${pageCount} sayfa, ${totalFetched} sipariş`);
    
  } catch (error) {
    console.error('❌ Test Hatası:', error.response?.data || error.message);
  }
})();
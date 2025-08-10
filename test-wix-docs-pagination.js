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
    console.log('=== Wix Docs Style Pagination Test ===');
    
    // İlk sayfa - docs örneğine göre
    console.log('\n📄 1. Sayfa');
    const body1 = {
      cursorPaging: { limit: 25 },
      sort: [{ fieldName: 'createdDate', order: 'DESC' }]
    };
    
    console.log('   Request body:', JSON.stringify(body1, null, 2));
    
    const response1 = await axios.post(ECOM_ORDERS_SEARCH, body1, { headers: headers() });
    const orders1 = response1.data?.orders || [];
    
    console.log(`   ${orders1.length} sipariş alındı`);
    console.log(`   İlk 3: ${orders1.slice(0, 3).map(o => o.number).join(', ')}`);
    console.log(`   Son 3: ${orders1.slice(-3).map(o => o.number).join(', ')}`);
    
    const cursor = response1.data?.metadata?.cursors?.next;
    console.log(`   Cursor: ${cursor ? 'Var (' + cursor.length + ' karakter)' : 'YOK'}`);
    
    if (!cursor) {
      console.log('❌ Cursor alınamadı');
      return;
    }
    
    // İkinci sayfa - cursor ile
    console.log('\n📄 2. Sayfa');
    const body2 = {
      cursorPaging: { 
        limit: 25,
        cursor: cursor
      },
      sort: [{ fieldName: 'createdDate', order: 'DESC' }]
    };
    
    console.log('   Request body with cursor:', JSON.stringify({
      cursorPaging: { 
        limit: 25,
        cursor: cursor.substring(0, 30) + '...'
      },
      sort: [{ fieldName: 'createdDate', order: 'DESC' }]
    }, null, 2));
    
    const response2 = await axios.post(ECOM_ORDERS_SEARCH, body2, { headers: headers() });
    const orders2 = response2.data?.orders || [];
    
    console.log(`   ${orders2.length} sipariş alındı`);
    console.log(`   İlk 3: ${orders2.slice(0, 3).map(o => o.number).join(', ')}`);
    console.log(`   Son 3: ${orders2.slice(-3).map(o => o.number).join(', ')}`);
    
    const cursor2 = response2.data?.metadata?.cursors?.next;
    console.log(`   Cursor: ${cursor2 ? 'Var (' + cursor2.length + ' karakter)' : 'YOK'}`);
    
    // Analiz
    console.log('\n🔍 Analiz:');
    const overlap = orders1.filter(o1 => orders2.some(o2 => o2.number === o1.number));
    console.log(`   Ortak sipariş sayısı: ${overlap.length}`);
    
    if (overlap.length === 0) {
      console.log('✅ Farklı siparişler - pagination çalışıyor!');
      
      // Şimdi hedef siparişleri ara
      const allNumbers = [...orders1, ...orders2].map(o => o.number);
      const targets = ['10113', '10274', '10281'];
      console.log('\n🎯 Hedef siparişler:');
      targets.forEach(t => {
        const found = allNumbers.includes(t);
        console.log(`   ${t}: ${found ? '✅ Bulundu' : '❌ Bulunamadı'}`);
      });
      
    } else {
      console.log('❌ Aynı siparişler dönüyor - pagination çalışmıyor');
      console.log(`   Ortak: ${overlap.slice(0, 5).map(o => o.number).join(', ')}`);
    }
    
  } catch (error) {
    console.error('❌ Test Hatası:', error.response?.data || error.message);
  }
})();
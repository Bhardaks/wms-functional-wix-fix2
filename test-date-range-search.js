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
    console.log('=== Specific Date Range Search Test ===');
    
    // Spesifik tarih aralıkları ile ara - hedef siparişlerin tarihlerine odaklan
    const dateRanges = [
      { name: '2024 Aralık (10113 için)', start: '2024-12-01', end: '2024-12-31' },
      { name: '2025 Mayıs (10274 için)', start: '2025-05-01', end: '2025-05-31' },
      { name: '2025 Temmuz (10281 için)', start: '2025-07-01', end: '2025-07-31' },
      { name: '2025 Ağustos (Güncel)', start: '2025-08-01', end: '2025-08-31' }
    ];
    
    const allFoundOrders = [];
    
    for (const range of dateRanges) {
      console.log(`\n📅 ${range.name}`);
      
      const body = {
        cursorPaging: { limit: 100 },
        filter: {
          createdDate: {
            $gte: `${range.start}T00:00:00.000Z`,
            $lte: `${range.end}T23:59:59.999Z`
          }
        },
        sort: [{ fieldName: 'createdDate', order: 'DESC' }]
      };
      
      try {
        const response = await axios.post(ECOM_ORDERS_SEARCH, body, { headers: headers() });
        const orders = response.data?.orders || [];
        
        console.log(`   ${orders.length} sipariş bulundu`);
        
        if (orders.length > 0) {
          const numbers = orders.map(o => o.number);
          console.log(`   Siparişler: ${numbers.join(', ')}`);
          
          // Hedef siparişleri kontrol et
          const targets = ['10113', '10274', '10281'];
          targets.forEach(target => {
            if (numbers.includes(target)) {
              const order = orders.find(o => o.number === target);
              console.log(`   🎯 ${target} BULUNDU! Status: ${order.status}, Date: ${new Date(order.createdDate).toLocaleDateString('tr-TR')}`);
            }
          });
          
          allFoundOrders.push(...orders);
        } else {
          console.log('   Sipariş bulunamadı');
        }
        
      } catch (error) {
        console.log(`   ❌ Hata: ${error.response?.data?.message || error.message}`);
      }
    }
    
    console.log(`\n📊 Genel Sonuç:`);
    console.log(`   Toplam bulunan sipariş: ${allFoundOrders.length}`);
    console.log(`   Benzersiz sipariş: ${new Set(allFoundOrders.map(o => o.number)).size}`);
    
    const targets = ['10113', '10274', '10281'];
    console.log('\n🎯 Final Hedef Kontrol:');
    targets.forEach(target => {
      const found = allFoundOrders.find(o => o.number === target);
      if (found) {
        console.log(`   ✅ ${target}: Status=${found.status}, Date=${new Date(found.createdDate).toLocaleDateString('tr-TR')}`);
      } else {
        console.log(`   ❌ ${target}: Hiçbir tarih aralığında bulunamadı`);
      }
    });
    
  } catch (error) {
    console.error('❌ Date Range Test Hatası:', error.message);
  }
})();
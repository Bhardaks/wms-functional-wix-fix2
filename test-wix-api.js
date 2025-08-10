require('dotenv').config();
const wix = require('./backend/services/wix');

(async () => {
  try {
    console.log('=== Wix API Test - Kaç Sipariş Çekiliyor? ===');
    
    let count = 0;
    const orders = [];
    
    console.log('🔄 Wix\'ten siparişler çekiliyor...');
    
    for await (const order of wix.iterateOrders()) {
      count++;
      orders.push({
        number: order.number || order.id,
        status: order.status,
        fulfillmentStatus: order.fulfillmentStatus,
        createdDate: order.createdDate
      });
      
      // İlk 5 ve son 5'i logla, ortayı atla
      if (count <= 5 || count % 50 === 0) {
        console.log(`   ${count}: ${order.number} (${order.status}) - ${new Date(order.createdDate).toLocaleDateString('tr-TR')}`);
      }
    }
    
    console.log(`\n📊 Toplam çekilen sipariş: ${count}`);
    
    if (orders.length > 0) {
      // Sayısal siparişleri filtrele ve sırala
      const numericOrders = orders
        .filter(o => /^\d+$/.test(o.number))
        .map(o => ({...o, num: parseInt(o.number, 10)}))
        .sort((a, b) => a.num - b.num);
      
      if (numericOrders.length > 0) {
        console.log(`\n📈 Sayısal sipariş aralığı: ${numericOrders[0].num} - ${numericOrders[numericOrders.length - 1].num}`);
        
        // Hedeflediğimiz siparişleri kontrol et
        const targets = ['10113', '10274', '10281'];
        console.log('\n🎯 Hedeflenen siparişlerin durumu:');
        
        targets.forEach(target => {
          const found = orders.find(o => o.number === target);
          if (found) {
            console.log(`   ✅ ${target}: ${found.status} (${found.fulfillmentStatus || 'no fulfillment'}) - ${new Date(found.createdDate).toLocaleDateString('tr-TR')}`);
          } else {
            console.log(`   ❌ ${target}: Bulunamadı`);
          }
        });
      }
      
      // En eski ve en yeni tarihleri göster
      const dates = orders
        .map(o => new Date(o.createdDate))
        .sort((a, b) => a - b);
        
      if (dates.length > 0) {
        console.log(`\n📅 Tarih aralığı:`);
        console.log(`   En eski: ${dates[0].toLocaleDateString('tr-TR')}`);
        console.log(`   En yeni: ${dates[dates.length - 1].toLocaleDateString('tr-TR')}`);
      }
    }
    
  } catch (error) {
    console.error('❌ API Test Hatası:', error.message);
    console.error('   Hata detayı:', error.response?.data || error.stack);
  }
})();
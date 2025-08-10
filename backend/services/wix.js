
const axios = require('axios');

const V3_PRODUCTS_QUERY = 'https://www.wixapis.com/stores/v3/products/query';
const V1_PRODUCTS_QUERY = 'https://www.wixapis.com/stores/v1/products/query';
const ECOM_ORDERS_SEARCH = 'https://www.wixapis.com/ecom/v1/orders/search';
const STORES_V2_ORDERS_QUERY = 'https://www.wixapis.com/stores/v2/orders/query';

function headers() {
  const key = process.env.WIX_API_KEY;
  const siteId = process.env.WIX_SITE_ID;
  if (!key || !siteId) throw new Error('WIX_API_KEY or WIX_SITE_ID missing');
  return {
    Authorization: key,          // API Key (site-level) – raw key
    'wix-site-id': siteId,
    'Content-Type': 'application/json'
  };
}

// Coerce any value to a readable string (avoid [object Object])
function s(val, fallback = '') {
  if (val == null) return fallback;
  if (typeof val === 'string') return val;
  // common nested shapes
  if (typeof val === 'object') {
    for (const k of ['original', 'translated', 'value', 'plainText']) {
      if (typeof val[k] === 'string') return val[k];
      if (val[k] && typeof val[k] === 'object') {
        for (const kk of ['original', 'translated', 'value', 'plainText']) {
          if (typeof val[k][kk] === 'string') return val[k][kk];
        }
      }
    }
  }
  try { return JSON.stringify(val); } catch { return String(val); }
}

// Build variant display suffix from choices object/array
function variantSuffix(variant) {
  const ch = variant?.choices || variant?.options || variant?.optionSelections;
  if (!ch) return '';
  if (Array.isArray(ch)) {
    return ' ' + ch.map(x => x && (x.value || x.name || x)).join('/');
  }
  if (typeof ch === 'object') {
    return ' ' + Object.values(ch).map(x => (x && (x.value || x.name || x))).join('/');
  }
  return '';
}

// -------- PRODUCTS (V3 with fallback to V1) --------
async function *iterateProducts() {
  // Try V3 cursor paging
  try {
    let cursor = null;
    do {
      const body = { query: { cursorPaging: { limit: 100, cursor } }, fields: ['id','name','sku','variants','manageVariants','priceData','stock'] };
      const { data } = await axios.post(V3_PRODUCTS_QUERY, body, { headers: headers() });
      const items = data?.products || data?.items || [];
      for (const it of items) yield { item: it, version: 'v3' };
      cursor = data?.nextCursor || null;
    } while (cursor);
    return;
  } catch (e) {
    // Fall back to V1
  }

  // V1: either nextCursor or offset paging
  let cursor = null;
  let offset = 0, total = null, limit = 100;
  for (;;) {
    const body = cursor
      ? { nextCursor: cursor, includeVariants: true }
      : { query: { paging: { limit, offset } }, includeVariants: true };
    const { data } = await axios.post(V1_PRODUCTS_QUERY, body, { headers: headers() });
    const items = data?.products || data?.items || [];
    for (const it of items) yield { item: it, version: 'v1' };

    // Prefer explicit nextCursor if present
    if (data?.nextCursor) { cursor = data.nextCursor; continue; }
    // else rely on paging info
    const p = data?.paging;
    if (p?.total != null) total = p.total;
    if (p?.limit != null) limit = p.limit;
    if (p?.offset != null) offset = p.offset + limit; else offset += limit;
    if (total != null && offset >= total) break;
    if (!items.length && !data?.nextCursor) break;
  }
}

// -------- ORDERS --------
async function *iterateOrders() {
  // eCommerce API ile cursor pagination (en güvenilir yöntem)
  let cursor = null;
  let pageCount = 0;
  let totalFetched = 0;
  
  do {
    pageCount++;
    
    const body = cursor 
      ? { 
          cursorPaging: { limit: 100, cursor },
          sort: [{ fieldName: 'createdDate', order: 'ASC' }]
        }
      : { 
          cursorPaging: { limit: 100 },
          sort: [{ fieldName: 'createdDate', order: 'ASC' }]
        };
    
    const { data } = await axios.post(ECOM_ORDERS_SEARCH, body, { headers: headers() });
    const items = data?.orders || data?.items || [];
    
    totalFetched += items.length;
    console.log(`📄 Wix eCommerce API Sayfa ${pageCount}: ${items.length} sipariş alındı (Toplam: ${totalFetched})`);
    
    // Metadata'dan total ve hasNext bilgisini al
    const metadata = data?.metadata || {};
    if (pageCount === 1) {
      console.log(`📊 Wix'te toplam ${metadata.total || 'bilinmeyen'} sipariş var (sadece ${items.length} erişilebilir)`);
    }
    
    for (const it of items) yield it;
    
    // Cursor'ı güncelle
    cursor = metadata?.cursors?.next || null;
    const hasNext = metadata?.hasNext || false;
    
    console.log(`🔍 Page ${pageCount}: ${items.length} sipariş, hasNext: ${hasNext}, cursor var: ${!!cursor}`);
    
    // Daha fazla veri yoksa dur
    if (!hasNext || !cursor || items.length === 0) {
      console.log('⚠️  Son sayfa, pagination tamamlandı');
      break;
    }
    
    // Güvenlik: Sonsuz döngü önleme
    if (pageCount > 200) {
      console.log('⚠️  200 sayfa limitine ulaşıldı, durduruldu');
      break;
    }
    
  } while (cursor);
  
  console.log(`✅ Wix eCommerce API tamamlandı: ${pageCount} sayfa, ${totalFetched} sipariş`);
}

// Extract SKU from various places in line item (for orders)
function extractSku(lineItem) {
  return lineItem?.physicalProperties?.sku || lineItem?.sku || null;
}

// Extract variant SKU from different possible locations (for products)
function extractVariantSku(variant, productSku = null) {
  // Check multiple possible locations for variant SKU
  const possibleSkus = [
    variant?.sku,                           // Direct SKU
    variant?.variant?.sku,                  // Nested variant SKU (Wix v1 format)
    variant?.physicalProperties?.sku,       // Physical properties
    variant?.productSku,                    // Product-level SKU
    variant?.variantSku,                    // Variant-specific SKU
    variant?.properties?.sku,               // Properties SKU
    productSku                              // fallback to main product SKU
  ];
  
  // Return first non-empty SKU found
  for (const sku of possibleSkus) {
    if (sku && typeof sku === 'string' && sku.trim()) {
      return sku.trim();
    }
  }
  
  return null;
}

function extractCatalogIds(lineItem) {
  const cr = lineItem?.catalogReference || {};
  const productId = cr.catalogItemId || lineItem?.productId || null;
  let variantId = null;
  // common shapes
  if (cr.options) {
    if (typeof cr.options === 'string') variantId = cr.options;
    else if (typeof cr.options === 'object') {
      variantId = cr.options.variantId || cr.options.variant?.id || null;
    }
  }
  // legacy
  if (!variantId && lineItem.variantId) variantId = lineItem.variantId;
  return { productId, variantId };
}

module.exports = { iterateProducts, iterateOrders, s, variantSuffix, extractSku, extractVariantSku, extractCatalogIds };

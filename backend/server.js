require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 5000;

// DB
const DB_PATH = path.join(__dirname, 'db', 'wms.db');
const db = new sqlite3.Database(DB_PATH);

// Middleware
app.use(cors());
app.use(express.json());

// Helpers
function run(sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err); else resolve(this);
    });
  });
}
function all(sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err); else resolve(rows);
    });
  });
}
function get(sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err); else resolve(row);
    });
  });
}


// ---- Wix Sync ----
const wix = require('./services/wix');

// Pull products from Wix into local DB (variants become rows by SKU)
// Pull products from Wix into local DB (variants become rows by SKU) – robust V1/V3, proper names
app.post('/api/sync/wix/products', async (req, res) => {
  try {
    let total = 0, versionUsed = null;
    const seen = new Set();
    for await (const { item: prod, version } of wix.iterateProducts()) {
      versionUsed = version;
      const productId = prod.id || prod._id || prod.productId || prod.product?.id;
      const baseName = wix.s(prod.name || prod.product?.name || 'Ürün');
      const mainSku = prod.sku || prod.product?.sku || null;
      // Parse price properly
      let price = 0;
      if (prod.price?.amount) price = parseFloat(prod.price.amount);
      else if (prod.priceData?.price?.amount) price = parseFloat(prod.priceData.price.amount);
      else if (typeof prod.price === 'number') price = prod.price;
      
      // Parse inventory/stock data
      let inventoryQuantity = null;
      if (prod.stock?.quantity != null) {
        inventoryQuantity = parseInt(prod.stock.quantity, 10);
      } else if (prod.inventory?.quantity != null) {
        inventoryQuantity = parseInt(prod.inventory.quantity, 10);
      }
      
      const variants = prod.variants || prod.product?.variants || [];

      if (variants && variants.length) {
        for (const v of variants) {
          // Use enhanced SKU extraction for variants
          let vSku = wix.extractVariantSku(v, mainSku);
          
          // If still no SKU found, create a fallback UUID-based SKU
          if (!vSku) {
            vSku = `${productId}:${(v.id || v.variantId || 'var')}`;
          }
          
          if (seen.has(vSku)) continue;
          seen.add(vSku);
          const fullName = (baseName || 'Ürün') + wix.variantSuffix(v);
          // Parse variant price properly
          let vPrice = 0;
          if (v.price?.amount) vPrice = parseFloat(v.price.amount);
          else if (typeof v.price === 'number') vPrice = v.price;
          else vPrice = price;
          
          // Parse variant inventory
          let vInventoryQuantity = null;
          if (v.stock?.quantity != null) {
            vInventoryQuantity = parseInt(v.stock.quantity, 10);
          } else if (v.inventory?.quantity != null) {
            vInventoryQuantity = parseInt(v.inventory.quantity, 10);
          } else {
            vInventoryQuantity = inventoryQuantity; // fallback to main product inventory
          }
          
          await run(`INSERT INTO products (sku, name, description, main_barcode, price, wix_product_id, wix_variant_id, inventory_quantity)
                     VALUES (?,?,?,?,?,?,?,?)
                     ON CONFLICT(sku) DO UPDATE SET
                       name=excluded.name,
                       price=excluded.price,
                       wix_product_id=excluded.wix_product_id,
                       wix_variant_id=excluded.wix_variant_id,
                       inventory_quantity=excluded.inventory_quantity,
                       updated_at=CURRENT_TIMESTAMP`,
                    [String(vSku), String(fullName), null, null, vPrice, String(productId||''), String(v.id || v.variantId || ''), vInventoryQuantity]);
          total++;
        }
      } else {
        const sku = mainSku || (productId ? `WIX-${productId}` : `WIX-${Date.now()}`);
        if (!seen.has(sku)) {
          seen.add(sku);
          await run(`INSERT INTO products (sku, name, description, main_barcode, price, wix_product_id, wix_variant_id, inventory_quantity)
                     VALUES (?,?,?,?,?,?,?,?)
                     ON CONFLICT(sku) DO UPDATE SET
                       name=excluded.name,
                       price=excluded.price,
                       wix_product_id=excluded.wix_product_id,
                       inventory_quantity=excluded.inventory_quantity,
                       updated_at=CURRENT_TIMESTAMP`,
                    [String(sku), String(baseName || 'Ürün'), null, null, price, String(productId||''), null, inventoryQuantity]);
          total++;
        }
      }
    }
    res.json({ ok: true, imported: total, versionUsed });
  } catch (e) {
    console.error('Wix sync products error:', {
      message: e.message,
      response: e.response?.data,
      stack: e.stack,
      config: e.config ? {
        url: e.config.url,
        method: e.config.method,
        headers: e.config.headers
      } : null
    });
    res.status(500).json({ 
      error: e.response?.data || e.message,
      details: process.env.NODE_ENV === 'development' ? e.stack : undefined
    });
  }
});
// Pull orders from Wix into local DB – SKU/ID matching fixed
app.post('/api/sync/wix/orders', async (req, res) => {
  try {
    let total = 0;
    for await (const o of wix.iterateOrders()) {
      const orderNumber = o.number || o.id;
      
      
      // Müşteri adını farklı alanlardan bulmaya çalış
      let customerName = '';
      
      // 1. billingInfo'dan firstName + lastName kombinasyonu (en güvenilir)
      const billingFirst = o.billingInfo?.contactDetails?.firstName || '';
      const billingLast = o.billingInfo?.contactDetails?.lastName || '';
      if (billingFirst || billingLast) {
        customerName = (billingFirst + ' ' + billingLast).trim();
      }
      
      // 2. shippingInfo'dan firstName + lastName kombinasyonu
      if (!customerName) {
        const shippingFirst = o.shippingInfo?.logistics?.shippingDestination?.contactDetails?.firstName || '';
        const shippingLast = o.shippingInfo?.logistics?.shippingDestination?.contactDetails?.lastName || '';
        if (shippingFirst || shippingLast) {
          customerName = (shippingFirst + ' ' + shippingLast).trim();
        }
      }
      
      // 3. recipientInfo'dan firstName + lastName kombinasyonu
      if (!customerName) {
        const recipientFirst = o.recipientInfo?.contactDetails?.firstName || '';
        const recipientLast = o.recipientInfo?.contactDetails?.lastName || '';
        if (recipientFirst || recipientLast) {
          customerName = (recipientFirst + ' ' + recipientLast).trim();
        }
      }
      
      // 4. Şirket adını kontrol et
      if (!customerName) {
        customerName = o.billingInfo?.contactDetails?.company || 
                      o.shippingInfo?.logistics?.shippingDestination?.contactDetails?.company ||
                      o.recipientInfo?.contactDetails?.company ||
                      '';
      }
      
      // 5. buyerInfo'dan (eski yöntem) - fallback
      if (!customerName) {
        const buyerFirst = o.buyerInfo?.contactDetails?.firstName || '';
        const buyerLast = o.buyerInfo?.contactDetails?.lastName || '';
        if (buyerFirst || buyerLast) {
          customerName = (buyerFirst + ' ' + buyerLast).trim();
        }
      }
      
      // 6. Son çare olarak contactId kullan
      if (!customerName) {
        customerName = o.buyerInfo?.contactId || 'Unknown Customer';
      }
      
      
      const status = (o.status || 'open').toLowerCase();
      const fulfillmentStatus = o.fulfillmentStatus || null;

      await run(`INSERT INTO orders (order_number, customer_name, status, fulfillment_status) VALUES (?, ?, ?, ?)
                 ON CONFLICT(order_number) DO UPDATE SET
                   customer_name=excluded.customer_name,
                   status=excluded.status,
                   fulfillment_status=excluded.fulfillment_status,
                   updated_at=CURRENT_TIMESTAMP`,
                [String(orderNumber), customerName, status, fulfillmentStatus]);
      const ord = await get('SELECT id FROM orders WHERE order_number=?', [orderNumber]);

      const lines = o.lineItems || o.catalogLineItems || [];
      for (const li of lines) {
        const sku = wix.extractSku(li);
        const { productId: wixPid, variantId: wixVid } = wix.extractCatalogIds(li);
        // Resolve product
        let prod = null;
        if (sku) prod = await get('SELECT * FROM products WHERE sku=?', [sku]);
        if (!prod && wixPid && wixVid) prod = await get('SELECT * FROM products WHERE wix_product_id=? AND wix_variant_id=?', [wixPid, wixVid]);
        if (!prod && wixPid) prod = await get('SELECT * FROM products WHERE wix_product_id=?', [wixPid]);
        if (!prod) {
          const name = wix.s(li.productName || li.name || 'Wix Product');
          const genSku = sku || (wixPid ? `WIX-${wixPid}${wixVid?('-'+wixVid):''}` : `WIX-NO-ID-${Date.now()}`);
          await run(`INSERT OR IGNORE INTO products (sku, name, price, wix_product_id, wix_variant_id) VALUES (?,?,?,?,?)`,
                    [String(genSku), String(name), 0, wixPid || null, wixVid || null]);
          prod = await get('SELECT * FROM products WHERE sku=?', [genSku]);
        }
        const qty = parseInt(li.quantity || 1, 10);
        const pName = wix.s(li.productName || li.name || prod?.name || 'Ürün');
        const pSku = sku || prod.sku;
        const existing = await get('SELECT id FROM order_items WHERE order_id=? AND product_id=?', [ord.id, prod.id]);
        if (existing) {
          await run('UPDATE order_items SET quantity=?, sku=?, product_name=? WHERE id=?', [qty, pSku, pName, existing.id]);
        } else {
          await run('INSERT INTO order_items (order_id, product_id, sku, product_name, quantity) VALUES (?,?,?,?,?)',
                    [ord.id, prod.id, pSku, pName, qty]);
        }
      }
      total++;
    }
    res.json({ ok: true, importedOrders: total });
  } catch (e) {
    console.error('Wix sync orders error:', e.response?.data || e.message);
    res.status(500).json({ error: e.response?.data || e.message });
  }
});
// Pull both (products then orders)
app.post('/api/sync/wix/all', async (req, res) => {
  try {
    const r1 = await (await fetch('http://localhost:'+PORT+'/api/sync/wix/products', { method:'POST'})).json();
    const r2 = await (await fetch('http://localhost:'+PORT+'/api/sync/wix/orders', { method:'POST'})).json();
    res.json({ products: r1, orders: r2 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// ---- Health ----
app.get('/api/health', async (req, res) => {
  try {
    const row = await get('SELECT 1 as ok', []);
    res.json({ status: 'ok', db: !!row });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Products ----
app.get('/api/products', async (req, res) => {
  const rows = await all('SELECT * FROM products ORDER BY id DESC');
  for (const r of rows) {
    r.packages = await all('SELECT * FROM product_packages WHERE product_id=? ORDER BY id', [r.id]);
    const locs = await all(`SELECT l.code FROM product_locations pl JOIN locations l ON l.id=pl.location_id WHERE pl.product_id=? ORDER BY l.code`, [r.id]);
    r.location_codes = locs.map(x=>x.code);
  }
  res.json(rows);
});

app.post('/api/products', async (req, res) => {
  const { sku, name, description, main_barcode, price } = req.body;
  try {
    await run(`INSERT INTO products (sku, name, description, main_barcode, price) VALUES (?,?,?,?,?)`,
      [sku, name, description || null, main_barcode || null, price || 0]);
    const prod = await get('SELECT * FROM products WHERE sku=?', [sku]);
    res.status(201).json(prod);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  const { sku, name, description, main_barcode, price } = req.body;
  try {
    await run(`UPDATE products SET sku=?, name=?, description=?, main_barcode=?, price=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [sku, name, description || null, main_barcode || null, price || 0, id]);
    const prod = await get('SELECT * FROM products WHERE id=?', [id]);
    res.json(prod);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await run('DELETE FROM products WHERE id=?', [id]);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Packages for a product
app.get('/api/products/:id/packages', async (req, res) => {
  const { id } = req.params;
  const rows = await all('SELECT * FROM product_packages WHERE product_id=?', [id]);
  res.json(rows);
});

app.post('/api/products/:id/packages', async (req, res) => {
  const { id } = req.params;
  const { package_number, package_content, package_name, barcode, quantity, weight_kg, volume_m3 } = req.body;
  try {
    await run(`INSERT INTO product_packages (product_id, package_number, package_content, package_name, barcode, quantity, weight_kg, volume_m3) VALUES (?,?,?,?,?,?,?,?)`,
      [id, package_number || null, package_content || package_name || null, package_name || package_content || null, barcode, quantity || 1, weight_kg || null, volume_m3 || null]);
    const row = await get('SELECT * FROM product_packages WHERE product_id=? AND barcode=?', [id, barcode]);
    res.status(201).json(row);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/packages/:pkgId', async (req, res) => {
  const { pkgId } = req.params;
  try {
    await run('DELETE FROM product_packages WHERE id=?', [pkgId]);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Debug endpoint ----
app.get('/api/debug/env', async (req, res) => {
  res.json({
    NODE_ENV: process.env.NODE_ENV || 'not set',
    WIX_API_KEY: process.env.WIX_API_KEY ? 'SET (length: ' + process.env.WIX_API_KEY.length + ')' : 'NOT SET',
    WIX_SITE_ID: process.env.WIX_SITE_ID ? 'SET (length: ' + process.env.WIX_SITE_ID.length + ')' : 'NOT SET',
    PORT: process.env.PORT || 'not set'
  });
});

// ---- Orders ----
app.get('/api/orders', async (req, res) => {
  const rows = await all(`
    SELECT o.*,
           COALESCE(latest_pick.status, NULL) as pick_status,
           COALESCE(latest_pick.pick_id, NULL) as pick_id
    FROM orders o
    LEFT JOIN (
      SELECT p.order_id,
             p.status,
             p.id as pick_id,
             ROW_NUMBER() OVER (PARTITION BY p.order_id ORDER BY p.id DESC) as rn
      FROM picks p
      WHERE p.status != 'completed'
    ) as latest_pick ON latest_pick.order_id = o.id AND latest_pick.rn = 1
    ORDER BY o.id DESC
  `);
  res.json(rows);
});

app.post('/api/orders', async (req, res) => {
  const { order_number, customer_name, items } = req.body;
  if (!order_number || !items || !items.length) {
    return res.status(400).json({ error: 'order_number and items are required' });
  }
  try {
    await run(`INSERT INTO orders (order_number, customer_name, status) VALUES (?,?, 'open')`,
      [order_number, customer_name || null]);
    const order = await get('SELECT * FROM orders WHERE order_number=?', [order_number]);
    for (const it of items) {
      const prod = await get('SELECT * FROM products WHERE id=?', [it.product_id]);
      if (!prod) throw new Error('Invalid product_id ' + it.product_id);
      await run(`INSERT INTO order_items (order_id, product_id, sku, product_name, quantity) VALUES (?,?,?,?,?)`,
        [order.id, prod.id, prod.sku, prod.name, parseInt(it.quantity || 1,10)]);
    }
    res.status(201).json(order);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  const order = await get('SELECT * FROM orders WHERE id=?', [id]);
  const items = await all('SELECT * FROM order_items WHERE order_id=?', [id]);
  res.json({ ...order, items });
});


// ---- Locations / Bins ----
app.get('/api/locations', async (req, res) => {
  const rows = await all('SELECT * FROM locations ORDER BY code');
  res.json(rows);
});
app.post('/api/locations', async (req, res) => {
  const { code, name } = req.body;
  await run('INSERT OR IGNORE INTO locations (code, name) VALUES (?, ?)', [code, name || null]);
  const row = await get('SELECT * FROM locations WHERE code=?', [code]);
  res.status(201).json(row);
});

// Assign a product to a location (creates location if needed)
app.post('/api/products/:id/assign-location', async (req, res) => {
  const { id } = req.params;
  const { code, on_hand } = req.body;
  if (!code) return res.status(400).json({ error: 'code required' });
  await run('INSERT OR IGNORE INTO locations (code) VALUES (?)', [code]);
  const loc = await get('SELECT * FROM locations WHERE code=?', [code]);
  await run('INSERT OR IGNORE INTO product_locations (product_id, location_id, on_hand) VALUES (?,?,?)', [id, loc.id, parseInt(on_hand||0,10)]);
  await run('UPDATE product_locations SET on_hand=? WHERE product_id=? AND location_id=?', [parseInt(on_hand||0,10), id, loc.id]);
  res.json({ success: true });
});

// List product locations
app.get('/api/products/:id/locations', async (req, res) => {
  const { id } = req.params;
  const rows = await all(`SELECT pl.*, l.code, l.name FROM product_locations pl JOIN locations l ON l.id=pl.location_id WHERE pl.product_id=? ORDER BY l.code`, [id]);
  res.json(rows);
});


// ---- Stock movements ----
app.post('/api/stock/in', async (req, res) => {
  const { product_id, qty, note } = req.body;
  await run('INSERT INTO stock_movements (product_id, type, qty, note) VALUES (?, "IN", ?, ?)', [product_id, qty, note || null]);
  res.status(201).json({ success: true });
});
app.post('/api/stock/out', async (req, res) => {
  const { product_id, qty, note } = req.body;
  await run('INSERT INTO stock_movements (product_id, type, qty, note) VALUES (?, "OUT", ?, ?)', [product_id, qty, note || null]);
  res.status(201).json({ success: true });
});
app.get('/api/stock/movements', async (req, res) => {
  const rows = await all('SELECT * FROM stock_movements ORDER BY id DESC');
  res.json(rows);
});

// ---- Picking ----
async function computeExpectedScans(order_id) {
  const items = await all('SELECT * FROM order_items WHERE order_id=?', [order_id]);
  const map = {}; // product_id => { packages: [{id, barcode, perSetQty}], neededSets, counts }
  for (const it of items) {
    const pkgs = await all('SELECT * FROM product_packages WHERE product_id=?', [it.product_id]);
    map[it.product_id] = {
      order_item_id: it.id,
      neededSets: it.quantity,
      packages: pkgs.map(p => ({ id: p.id, barcode: p.barcode, perSetQty: p.quantity })),
      counts: {} // barcode => scanned count
    };
  }
  return map;
}

app.post('/api/picks', async (req, res) => {
  const { order_id } = req.body;
  const order = await get('SELECT * FROM orders WHERE id=?', [order_id]);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  // Create pick
  await run('INSERT INTO picks (order_id, status) VALUES (?, "active")', [order_id]);
  const pick = await get('SELECT * FROM picks WHERE order_id=? ORDER BY id DESC LIMIT 1', [order_id]);
  res.status(201).json(pick);
});

app.get('/api/picks/:id', async (req, res) => {
  const { id } = req.params;
  const pick = await get('SELECT * FROM picks WHERE id=?', [id]);
  if (!pick) return res.status(404).json({ error: 'Pick not found' });
  const order = await get('SELECT * FROM orders WHERE id=?', [pick.order_id]);
  const items = await all('SELECT * FROM order_items WHERE order_id=?', [pick.order_id]);
  for (const it of items) {
    it.packages = await all('SELECT * FROM product_packages WHERE product_id=?', [it.product_id]);
  }
  const scans = await all('SELECT * FROM pick_scans WHERE pick_id=?', [id]);
  res.json({ pick, order, items, scans });
});

app.post('/api/picks/:id/scan', async (req, res) => {
  const { id } = req.params;
  const { barcode } = req.body;
  const pick = await get('SELECT * FROM picks WHERE id=?', [id]);
  if (!pick) return res.status(404).json({ error: 'Pick not found' });

  // Find package by barcode
  const pkg = await get('SELECT * FROM product_packages WHERE barcode=?', [barcode]);
  if (!pkg) return res.status(400).json({ error: 'Bu barkod tanımlı değil' });

  // Find matching order item for this product that still needs sets
  const item = await get('SELECT * FROM order_items WHERE order_id=? AND product_id=?', [pick.order_id, pkg.product_id]);
  if (!item) return res.status(400).json({ error: 'Bu barkod bu siparişte beklenmiyor' });

  // Count scans for this barcode ACROSS ALL PICKS in this order  
  const scannedCountRow = await get(`
    SELECT COUNT(*) as c 
    FROM pick_scans ps 
    JOIN picks p ON ps.pick_id = p.id 
    WHERE p.order_id = ? AND ps.order_item_id = ? AND ps.barcode = ?
  `, [pick.order_id, item.id, barcode]);
  const scannedCount = scannedCountRow.c || 0;

  // Expected per package for this order item
  const perSetQty = pkg.quantity || 1;
  const expectedForThisPackage = perSetQty * item.quantity;

  if (scannedCount >= expectedForThisPackage) {
    return res.status(400).json({ error: 'Bu barkod bu sipariş için zaten yeterince okundu' });
  }

  // Record scan
  await run(`INSERT INTO pick_scans (pick_id, order_item_id, product_id, package_id, barcode) VALUES (?,?,?,?,?)`,
    [id, item.id, item.product_id, pkg.id, barcode]);

  // Update picked_qty (we consider a "set" completed when sum over all packages reaches sum(pack.quantity))
  // Compute total scans for this order_item ACROSS ALL PICKS for this order
  const totalScansRow = await get(`
    SELECT COUNT(*) as c 
    FROM pick_scans ps 
    JOIN picks p ON ps.pick_id = p.id 
    WHERE p.order_id = ? AND ps.order_item_id = ?
  `, [pick.order_id, item.id]);
  const totalScans = totalScansRow.c;

  // total required scans for one set of this product
  const pkgRows = await all('SELECT quantity FROM product_packages WHERE product_id=?', [item.product_id]);
  const scansPerSet = pkgRows.reduce((a, r) => a + (r.quantity || 1), 0);

  const pickedSets = Math.min(item.quantity, Math.floor(totalScans / scansPerSet));
  await run('UPDATE order_items SET picked_qty=? WHERE id=?', [pickedSets, item.id]);

  // Check if order completed
  const remainingRow = await get(`SELECT COUNT(*) as remaining FROM order_items WHERE order_id=? AND picked_qty < quantity`, [pick.order_id]);
  const allPicked = remainingRow.remaining === 0;
  if (allPicked) {
    await run('UPDATE orders SET status="fulfilled" WHERE id=?', [pick.order_id]);
    await run('UPDATE picks SET status="completed" WHERE id=?', [id]);
  }

  res.json({
    success: true,
    item: { id: item.id, picked_qty: pickedSets, quantity: item.quantity },
    order_completed: allPicked
  });
});

// Set pick to partial status (when user exits without completing)
app.post('/api/picks/:id/partial', async (req, res) => {
  const { id } = req.params;
  
  try {
    const pick = await get('SELECT * FROM picks WHERE id=?', [id]);
    if (!pick) {
      return res.status(404).json({ error: 'Pick not found' });
    }
    
    // Pick'i partial duruma güncelle
    await run('UPDATE picks SET status="partial" WHERE id=?', [id]);
    
    // Siparişi de kısmi karşılanmış duruma güncelle
    await run('UPDATE orders SET fulfillment_status="PARTIALLY_FULFILLED" WHERE id=?', [pick.order_id]);
    
    console.log(`✅ Pick ${id} set to partial status, Order ${pick.order_id} set to PARTIALLY_FULFILLED`);
    
    res.json({ success: true, message: 'Pick set to partial status and order updated' });
  } catch (error) {
    console.error('Error setting pick to partial:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Reset pick (cancel all scans and return to initial state)
app.post('/api/picks/:id/reset', async (req, res) => {
  const { id } = req.params;
  
  try {
    const pick = await get('SELECT * FROM picks WHERE id=?', [id]);
    if (!pick) {
      return res.status(404).json({ error: 'Pick not found' });
    }
    
    // Tüm scanları sil
    await run('DELETE FROM pick_scans WHERE pick_id=?', [id]);
    
    // Pick durumunu pending'e çevir
    await run('UPDATE picks SET status="pending" WHERE id=?', [id]);
    
    // Sipariş durumunu tekrar henüz karşılanmamış'a çevir 
    await run('UPDATE orders SET fulfillment_status="NOT_FULFILLED" WHERE id=?', [pick.order_id]);
    
    console.log(`🗑️ Pick ${id} reset - all scans deleted, Order ${pick.order_id} back to NOT_FULFILLED`);
    
    res.json({ success: true, message: 'Pick reset successfully - all scans removed' });
  } catch (error) {
    console.error('Error resetting pick:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Delivery note PDF
app.get('/api/picks/:id/delivery-note.pdf', async (req, res) => {
  const { id } = req.params;
  const pick = await get('SELECT * FROM picks WHERE id=?', [id]);
  if (!pick) return res.status(404).end();

  const order = await get('SELECT * FROM orders WHERE id=?', [pick.order_id]);
  const items = await all('SELECT * FROM order_items WHERE order_id=?', [pick.order_id]);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="delivery-note-${order.order_number}.pdf"`);

  const doc = new PDFDocument({ margin: 40 });
  doc.pipe(res);

  doc.fontSize(18).text('Sevk İrsaliyesi / Delivery Note', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Sipariş: ${order.order_number}`);
  doc.text(`Müşteri: ${order.customer_name || '-'}`);
  doc.text(`Durum: ${order.status}`);
  doc.moveDown();

  doc.text('Kalemler:', { underline: true });
  items.forEach(it => {
    doc.text(`- ${it.product_name} (SKU: ${it.sku})  ${it.picked_qty}/${it.quantity} set`);
  });

  doc.end();
});

// Static files middleware - API route'larından sonra
app.use(express.static(path.join(__dirname, '..', 'public')));

// Fallback: serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Network erişimi için tüm interface'lerde dinle
app.listen(PORT, '0.0.0.0', async () => {
  // Bilgisayarın IP adresini bul
  const os = require('os');
  const interfaces = os.networkInterfaces();
  let localIP = 'localhost';
  
  for (const interfaceName in interfaces) {
    const interface = interfaces[interfaceName];
    for (const connection of interface) {
      if (connection.family === 'IPv4' && !connection.internal) {
        localIP = connection.address;
        break;
      }
    }
    if (localIP !== 'localhost') break;
  }
  
  console.log(`🚀 WMS server started successfully!`);
  console.log(`📱 Local access: http://localhost:${PORT}`);
  console.log(`🌐 Network access: http://${localIP}:${PORT}`);
  console.log(`📋 Test with mobile devices using: http://${localIP}:${PORT}`);
  console.log(`🦓 Zebra terminals can connect to: http://${localIP}:${PORT}`);
});

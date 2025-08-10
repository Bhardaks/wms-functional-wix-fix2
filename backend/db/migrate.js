
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, 'wms.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const db = new sqlite3.Database(DB_PATH);

function runSql(sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

(async () => {
  // helper: check/create column
  async function ensureColumn(db, table, col, defSql) {
    const has = await new Promise((resolve,reject)=>{
      db.all(`PRAGMA table_info(${table})`, [], (err, rows)=>{
        if (err) reject(err);
        else resolve(rows.some(r=>r.name===col));
      });
    });
    if (!has) {
      await new Promise((resolve,reject)=>{
        db.run(`ALTER TABLE ${table} ADD COLUMN ${defSql}`, [], (err)=>{
          if (err) reject(err); else resolve();
        });
      });
      console.log(`➕ Added column ${table}.${col}`);
    }
  }

  try {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    await runSql(schema);
// post-schema upgrades for existing DBs
await runSql(`
  CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT
  );
  CREATE TABLE IF NOT EXISTS product_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    on_hand INTEGER NOT NULL DEFAULT 0,
    UNIQUE(product_id, location_id)
  );
`);

// add wix id columns if missing
await ensureColumn(db, 'products', 'wix_product_id', 'wix_product_id TEXT');
await ensureColumn(db, 'products', 'wix_variant_id', 'wix_variant_id TEXT');
await runSql(`CREATE INDEX IF NOT EXISTS idx_products_wix ON products (wix_product_id, wix_variant_id);`);

// add fulfillment_status column to orders if missing
await ensureColumn(db, 'orders', 'fulfillment_status', 'fulfillment_status TEXT');

// add weight and volume columns to product_packages if missing
await ensureColumn(db, 'product_packages', 'weight_kg', 'weight_kg REAL');
await ensureColumn(db, 'product_packages', 'volume_m3', 'volume_m3 REAL');

// add package number and content columns to product_packages if missing
await ensureColumn(db, 'product_packages', 'package_number', 'package_number TEXT');
await ensureColumn(db, 'product_packages', 'package_content', 'package_content TEXT');

// add inventory quantity column to products if missing
await ensureColumn(db, 'products', 'inventory_quantity', 'inventory_quantity INTEGER');

    console.log('✅ Schema applied to', DB_PATH);
    db.close();
  } catch (e) {
    console.error('Migration failed:', e.message);
    process.exit(1);
  }
})();

/**
 * Shuttle price scraper — feather shuttlecocks from:
 *   - Central Sports (Shopify JSON API)
 *   - Direct Badminton (HTML + cheerio)
 *
 * Usage:  node utils/shuttle-scraper.js
 * Export: scrapeAll() → writes static/generated/shuttle-prices.json and returns the data
 */

const path = require('path');
const fs = require('fs').promises;
const cheerio = require('cheerio');

const OUTPUT_PATH = path.join(__dirname, '../static/generated/shuttle-prices.json');

const DB_BASE = 'https://www.directbadminton.co.uk';
const DB_BRANDS = ['yonex', 'ashaway', 'babolat', 'carlton', 'forza', 'snowpeak', 'victor', 'wilson', 'yehlex'];

// Direct Badminton product URLs end with an uppercase SKU code like -AA, -3B5D9, -1D48
const PRODUCT_URL_RE = /^\/[a-z0-9]+(?:-[a-z0-9]+)*-[A-Z0-9]{2,8}$/;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function parsePrice(str) {
  const m = str.replace(/\s/g, '').match(/£([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

function parseQtyRange(str) {
  str = str.trim();
  if (str.endsWith('+')) return { min: parseInt(str), max: null };
  const parts = str.split('-').map(s => parseInt(s.trim()));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) return { min: parts[0], max: parts[1] };
  const n = parseInt(str);
  if (!isNaN(n)) return { min: n, max: n };
  return null;
}

// ── Central Sports ─────────────────────────────────────────────────────────────

function parseKachingBundles(html, basePrice) {
  const match = html.match(/<script class="kaching-bundles-deal-block-settings"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  let data;
  try { data = JSON.parse(match[1]); } catch { return null; }
  if (!data.dealBars || data.dealBars.length === 0) return null;

  const tiers = [];
  for (const bar of data.dealBars) {
    if (!bar.title) continue;
    const qty = parseQtyRange(bar.title);
    if (!qty || basePrice === null) continue;

    let price = basePrice;
    if (bar.discountType === 'amount' && bar.discountValue) {
      price = Math.round((basePrice - bar.discountValue) * 100) / 100;
    } else if (bar.discountType === 'percentage' && bar.discountValue) {
      price = Math.round(basePrice * (1 - bar.discountValue / 100) * 100) / 100;
    }
    tiers.push({ min_qty: qty.min, max_qty: qty.max, price_per_tube: price });
  }
  if (tiers.length === 0) return null;

  // Some products' kaching-bundles start at qty=2 — ensure qty=1 is always covered
  if (tiers[0].min_qty > 1) {
    tiers.unshift({ min_qty: 1, max_qty: tiers[0].min_qty - 1, price_per_tube: basePrice });
  }

  return tiers.length > 1 ? tiers : null;
}

async function scrapeCentralSports() {
  const resp = await fetch('https://centralsports.co.uk/collections/feather-shuttles/products.json?limit=250');
  if (!resp.ok) throw new Error(`Central Sports API returned ${resp.status}`);
  const data = await resp.json();

  const filtered = (data.products || []).filter(p => {
    const t = p.title.toLowerCase();
    return !t.includes('nylon') && !t.includes('mavis') &&
           !(t.includes('hybrid') && !t.includes('feather'));
  });

  const results = [];
  for (const p of filtered) {
    const variants = p.variants || [];
    const prices = variants.map(v => parseFloat(v.price)).filter(n => !isNaN(n));
    const basePrice = prices.length ? Math.min(...prices) : null;
    const allOutOfStock = variants.length > 0 && variants.every(v => v.available === false);

    // Fetch product page to extract kaching-bundles volume pricing
    let priceTiers = null;
    try {
      const pageResp = await fetch(`https://centralsports.co.uk/products/${p.handle}`);
      if (pageResp.ok) {
        priceTiers = parseKachingBundles(await pageResp.text(), basePrice);
      }
    } catch { /* fall through */ }

    results.push({
      source: 'centralsports',
      source_label: 'Central Sports',
      name: p.title,
      brand: p.vendor || 'Unknown',
      url: `https://centralsports.co.uk/products/${p.handle}`,
      image_url: p.images?.[0]?.src || null,
      single_tube_price: basePrice,
      price_tiers: priceTiers || [{ min_qty: 1, max_qty: null, price_per_tube: basePrice }],
      speed_variants: variants.length > 1
        ? variants.map(v => ({ label: v.title, price: parseFloat(v.price), available: v.available !== false }))
        : null,
      has_volume_pricing: !!(priceTiers && priceTiers.length > 1),
      out_of_stock: allOutOfStock,
      bulk_note: null
    });

    await sleep(250);
  }
  return results;
}

// ── Direct Badminton ───────────────────────────────────────────────────────────

async function getDBProductUrls() {
  const seen = new Set();
  for (const brand of DB_BRANDS) {
    try {
      const resp = await fetch(`${DB_BASE}/feather-shuttlecocks/${brand}`);
      if (!resp.ok) continue;
      const html = await resp.text();
      const $ = cheerio.load(html);
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (href && PRODUCT_URL_RE.test(href) &&
            !href.includes('string') && !href.includes('reel')) {
          seen.add(href);
        }
      });
      await sleep(300);
    } catch (e) {
      console.error(`  DB brand page failed (${brand}): ${e.message}`);
    }
  }
  return [...seen];
}

async function scrapeDBProduct(urlPath) {
  const url = DB_BASE + urlPath;
  let resp;
  try {
    resp = await fetch(url);
  } catch (e) {
    return null;
  }
  if (!resp.ok) return null;

  const html = await resp.text();
  const $ = cheerio.load(html);

  const name = $('h1').first().text().trim();
  if (!name) return null;

  // Skip non-shuttlecock products based on the product name
  const nameLower = name.toLowerCase();
  if (nameLower.includes('nylon') || nameLower.includes('mavis') ||
      nameLower.includes('string') || nameLower.includes('reel') ||
      (nameLower.includes('hybrid') && !nameLower.includes('feather'))) return null;

  // Infer brand from name
  const brand = DB_BRANDS.find(b => name.toLowerCase().includes(b));
  const brandLabel = brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : 'Unknown';

  // Parse volume pricing table.
  // DB uses all-<td> rows; header row has "Quantity" and "Price" in cells[0] and cells[2].
  // Data rows: cells[0]=quantity range, cells[1]=empty spacer, cells[2]=price.
  const tiers = [];
  $('table').each((_, table) => {
    let isQtyTable = false;
    let headerRowIndex = -1;

    $(table).find('tr').each((ri, row) => {
      if (isQtyTable) return;
      const texts = $(row).find('td,th').map((_, c) => $(c).text().trim().toLowerCase()).get();
      if (texts.some(t => t.includes('quantity') || t === 'qty') && texts.some(t => t.includes('price'))) {
        isQtyTable = true;
        headerRowIndex = ri;
      }
    });

    if (!isQtyTable) return;

    $(table).find('tr').each((ri, row) => {
      if (ri <= headerRowIndex) return;
      const cells = $(row).find('td,th').map((_, c) => $(c).text().trim()).get();
      // cells[0]=qty range, cells[1]=spacer, cells[2]=price (or cells[0] and cells[1] if only 2 cols)
      const qtyText  = cells[0];
      const priceText = cells.length >= 3 ? cells[2] : cells[1];
      const qty   = parseQtyRange(qtyText);
      const price = parsePrice(priceText);
      if (qty && price) tiers.push({ min_qty: qty.min, max_qty: qty.max, price_per_tube: price });
    });
  });

  if (tiers.length === 0) return null;

  const image_url = (() => {
    const src = $('img[src]').filter((_, el) => {
      const s = $(el).attr('src') || '';
      return s.includes('product') || s.includes('shuttle');
    }).first().attr('src');
    if (!src) return null;
    return src.startsWith('http') ? src : DB_BASE + src;
  })();

  return {
    source: 'directbadminton',
    source_label: 'Direct Badminton',
    name,
    brand: brandLabel,
    url,
    image_url,
    single_tube_price: tiers[0]?.price_per_tube ?? null,
    price_tiers: tiers,
    has_volume_pricing: tiers.length > 1,
    bulk_note: null
  };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function scrapeAll() {
  console.log('[shuttle-scraper] Scraping Central Sports...');
  const csProducts = await scrapeCentralSports();
  console.log(`[shuttle-scraper]   ${csProducts.length} products found`);

  console.log('[shuttle-scraper] Discovering Direct Badminton URLs...');
  const dbUrls = await getDBProductUrls();
  console.log(`[shuttle-scraper]   ${dbUrls.length} candidate product URLs`);

  console.log('[shuttle-scraper] Scraping Direct Badminton product pages...');
  const dbProducts = [];
  for (const urlPath of dbUrls) {
    const product = await scrapeDBProduct(urlPath);
    if (product) {
      dbProducts.push(product);
      process.stdout.write('.');
    }
    await sleep(250);
  }
  process.stdout.write('\n');
  console.log(`[shuttle-scraper]   ${dbProducts.length} feather shuttle products found`);

  const result = {
    scraped_at: new Date().toISOString(),
    products: [...csProducts, ...dbProducts]
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(result, null, 2));
  console.log(`[shuttle-scraper] Written to ${OUTPUT_PATH}`);

  return result;
}

module.exports = { scrapeAll, OUTPUT_PATH };

// CLI entry point
if (require.main === module) {
  scrapeAll().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

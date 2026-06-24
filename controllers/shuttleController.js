const fs = require('fs').promises;
const path = require('path');
const ExcelJS = require('exceljs');
const { scrapeAll, OUTPUT_PATH } = require('../utils/shuttle-scraper');

function isSuperadmin(req) {
  return req.user?._json?.['https://my-app.example.com/role'] === 'superadmin';
}

exports.shuttlePrices = async function(req, res, next) {
  if (!isSuperadmin(req)) return res.status(403).send('Access denied');

  let data = null;
  try {
    const raw = await fs.readFile(OUTPUT_PATH, 'utf8');
    data = JSON.parse(raw);
  } catch (_) {
    // No cached data yet — prompt user to run a refresh
  }

  res.render('shuttle-prices', {
    static_path: '/static',
    theme: process.env.THEME || 'flatly',
    pageTitle: 'Shuttle Prices',
    pageDescription: 'Feather shuttle price comparison',
    canonical: 'https://stockport-badminton.co.uk/shuttle-prices',
    data
  });
};

exports.exportPrices = async function(req, res, next) {
  if (!isSuperadmin(req)) return res.status(403).send('Access denied');

  let data;
  try {
    const raw = await fs.readFile(OUTPUT_PATH, 'utf8');
    data = JSON.parse(raw);
  } catch (_) {
    return res.status(404).send('No price data yet — run a refresh first.');
  }

  const KEY_QTYS = [1, 5, 14, 25, 50];

  function priceAtQty(product, qty) {
    let best = null;
    for (const t of product.price_tiers || []) {
      if (t.min_qty <= qty) {
        if (!best || t.min_qty > best.min_qty) best = t;
      }
    }
    return best ? best.price_per_tube : product.single_tube_price;
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Stockport Badminton';
  wb.created = new Date();

  // ── Sheet 1: Summary (key quantities) ──────────────────────────────────────
  const summary = wb.addWorksheet('Price Comparison');

  summary.columns = [
    { header: 'Source',       key: 'source',  width: 16 },
    { header: 'Brand',        key: 'brand',   width: 12 },
    { header: 'Product',      key: 'name',    width: 48 },
    { header: '1 tube (£)',   key: 'p1',      width: 12 },
    { header: '5 tubes (£)',  key: 'p5',      width: 12 },
    { header: '14 tubes (£)', key: 'p14',     width: 13 },
    { header: '25 tubes (£)', key: 'p25',     width: 13 },
    { header: '50+ tubes (£)',key: 'p50',     width: 13 },
    { header: 'Out of stock', key: 'oos',     width: 13 },
    { header: 'URL',          key: 'url',     width: 60 },
  ];

  // Style header row
  const headerRow = summary.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C3E50' } };
  headerRow.alignment = { vertical: 'middle' };
  headerRow.height = 20;

  for (const p of data.products) {
    const row = summary.addRow({
      source: p.source_label,
      brand:  p.brand,
      name:   p.name,
      p1:     priceAtQty(p, 1),
      p5:     priceAtQty(p, 5),
      p14:    priceAtQty(p, 14),
      p25:    priceAtQty(p, 25),
      p50:    priceAtQty(p, 50),
      oos:    p.out_of_stock ? 'Yes' : '',
      url:    p.url,
    });

    // Colour-code by source
    const srcColour = p.source === 'centralsports' ? 'FFE8F5E9' : 'FFE3F2FD';
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: srcColour } };

    // Price columns as numbers
    ['p1','p5','p14','p25','p50'].forEach(k => {
      const cell = row.getCell(k);
      if (cell.value !== null) cell.numFmt = '£#,##0.00';
    });

    // Out of stock in amber
    if (p.out_of_stock) {
      row.getCell('oos').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
    }

    // URL as hyperlink
    row.getCell('url').value = { text: p.url, hyperlink: p.url };
    row.getCell('url').font = { color: { argb: 'FF0563C1' }, underline: true };
  }

  summary.autoFilter = { from: 'A1', to: 'J1' };
  summary.views = [{ state: 'frozen', ySplit: 1 }];

  // ── Sheet 2: Full Tiers ─────────────────────────────────────────────────────
  const tiers = wb.addWorksheet('Full Tiers');

  tiers.columns = [
    { header: 'Source',         key: 'source', width: 16 },
    { header: 'Brand',          key: 'brand',  width: 12 },
    { header: 'Product',        key: 'name',   width: 48 },
    { header: 'Min qty (tubes)',key: 'min',    width: 16 },
    { header: 'Max qty (tubes)',key: 'max',    width: 16 },
    { header: 'Price/tube (£)', key: 'price',  width: 14 },
  ];

  const tiersHeader = tiers.getRow(1);
  tiersHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  tiersHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C3E50' } };
  tiersHeader.height = 20;

  for (const p of data.products) {
    const srcColour = p.source === 'centralsports' ? 'FFE8F5E9' : 'FFE3F2FD';
    for (const t of p.price_tiers || []) {
      const row = tiers.addRow({
        source: p.source_label,
        brand:  p.brand,
        name:   p.name,
        min:    t.min_qty,
        max:    t.max_qty ?? '',
        price:  t.price_per_tube,
      });
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: srcColour } };
      row.getCell('price').numFmt = '£#,##0.00';
    }
  }

  tiers.autoFilter = { from: 'A1', to: 'F1' };
  tiers.views = [{ state: 'frozen', ySplit: 1 }];

  // Stream to response
  const scraped = new Date(data.scraped_at);
  const dateStr = `${scraped.getFullYear()}-${String(scraped.getMonth()+1).padStart(2,'0')}-${String(scraped.getDate()).padStart(2,'0')}`;
  const filename = `shuttle-prices-${dateStr}.xlsx`;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
};

exports.refreshPrices = async function(req, res, next) {
  if (!isSuperadmin(req)) return res.status(403).send('Access denied');

  try {
    await scrapeAll();
  } catch (err) {
    return next(err);
  }
  res.redirect('/shuttle-prices');
};

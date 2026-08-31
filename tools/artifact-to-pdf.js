#!/usr/bin/env node
// Renders an Artifact-style HTML fragment to a PDF.
//
// The audit pages are written for the Artifact host, which supplies the
// <!doctype>, <head> and <body> wrapper — so the files on disk start straight in
// at <title> and <style>. This wraps them back up, pins the light theme (the
// pages are theme-aware and a PDF has no viewer preference to read), and prints.
//
//   node tools/artifact-to-pdf.js <in.html> [<in.html> ...] --out docs/hardening/pdf
//
// Uses the Playwright chromium already installed for the e2e suite.

const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

function parseArgs(argv) {
  const files = [];
  let out = 'docs/hardening/pdf';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') { out = argv[++i]; continue; }
    files.push(argv[i]);
  }
  return { files, out };
}

// The pages set their own <title>; reuse it as the PDF's document title.
function titleOf(html, fallback) {
  const m = html.match(/<title>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim() : fallback;
}

function wrap(fragment) {
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  /* The Artifact host's own reset, reproduced so the page lays out as published. */
  :root { color-scheme: light; }
  body { margin: 0; font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #fff; }
  img { max-width: 100%; }
  [hidden] { display: none !important; }
  /* Print: keep a finding or a table row from being split across a page break. */
  @media print {
    .finding, .step, .hyg, .verdict { break-inside: avoid; }
    tr, article { break-inside: avoid; }
    section { break-before: auto; }
    h2 { break-after: avoid; }
  }
</style>
${fragment}
</body>
</html>`;
}

async function main() {
  const { files, out } = parseArgs(process.argv.slice(2));
  if (!files.length) {
    console.error('usage: node tools/artifact-to-pdf.js <in.html> [...] [--out <dir>]');
    process.exit(1);
  }
  fs.mkdirSync(out, { recursive: true });

  const browser = await chromium.launch();
  try {
    for (const file of files) {
      const fragment = fs.readFileSync(file, 'utf8');
      const base = path.basename(file, path.extname(file));
      const title = titleOf(fragment, base);

      const page = await browser.newPage();
      await page.emulateMedia({ colorScheme: 'light' });
      await page.setContent(wrap(fragment), { waitUntil: 'networkidle' });
      // Web fonts resolve after networkidle in Chromium often enough to matter.
      await page.evaluate(() => document.fonts.ready);

      const target = path.join(out, `${base}.pdf`);
      await page.pdf({
        path: target,
        format: 'A4',
        printBackground: true,
        margin: { top: '14mm', bottom: '18mm', left: '12mm', right: '12mm' },
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate:
          `<div style="width:100%;font:9px -apple-system,sans-serif;color:#6b7a76;padding:0 12mm;
             display:flex;justify-content:space-between">
             <span>${title.replace(/[<>&]/g, '')}</span>
             <span class="pageNumber"></span>
           </div>`
      });
      await page.close();
      const kb = Math.round(fs.statSync(target).size / 1024);
      console.log(`${target}  (${kb} KB)  — ${title}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });

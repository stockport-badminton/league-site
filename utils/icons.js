'use strict';

// Inline SVG icons, replacing the Font Awesome webfont (HARD-44).
//
// The site used ~33 icons and paid for all ~2,000: a render-blocking 25 KB all.css, then
// fa-brands-400.woff2 (118 KB) on every page for the footer's three links, and
// fa-solid-900.woff2 (158 KB) wherever a solid icon appeared. The same package ships each
// icon as an SVG file, so `icon('trophy')` reads that file once and inlines the path — a
// few hundred bytes per icon, no font, no stylesheet, nothing to build.
//
// Inline rather than a sprite file: no extra request, works offline, and the result can go
// inside the JS strings that build DataTables buttons. Names are Font Awesome 6's file
// names (`xmark`, not the v4 alias `times`). An unknown name THROWS, at render, so a typo
// is a 500 in the test that renders the page rather than a blank space nobody notices.
//
// Icons: Font Awesome Free by @fontawesome — https://fontawesome.com/license/free
// (Icons: CC BY 4.0). Attribution is also carried once in views/footer.ejs.

const fs = require('fs');
const path = require('path');

const SVG_DIR = path.join(__dirname, '..', 'node_modules', '@fortawesome', 'fontawesome-free', 'svgs');
const STYLES = ['solid', 'brands', 'regular'];

const cache = new Map();

function load(name) {
  if (cache.has(name)) return cache.get(name);
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`icon(): bad icon name "${name}"`);
  for (const style of STYLES) {
    let svg;
    try { svg = fs.readFileSync(path.join(SVG_DIR, style, name + '.svg'), 'utf8'); } catch (e) { continue; }
    const viewBox = /viewBox="([^"]+)"/.exec(svg)[1];
    const body = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<!--[\s\S]*?-->/g, '');
    const parsed = { viewBox, body };
    cache.set(name, parsed);
    return parsed;
  }
  throw new Error(`icon(): no Font Awesome icon called "${name}"`);
}

const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// icon('trophy')                      decorative: aria-hidden
// icon('phone', { label: 'Call' })    meaningful on its own: role="img" + aria-label
// icon('bars', { class: 'icon-float' })
// icon('up-right-from-square', { style: 'font-size:0.65rem' })
//
// Output uses double quotes only, so it can sit inside a single-quoted JS string.
function icon(name, opts) {
  opts = opts || {};
  const { viewBox, body } = load(name);
  const cls = 'icon icon-' + name + (opts.class ? ' ' + opts.class : '');
  const a11y = opts.label
    ? `role="img" aria-label="${escapeAttr(opts.label)}"`
    : 'aria-hidden="true" focusable="false"';
  const style = opts.style ? ` style="${escapeAttr(opts.style)}"` : '';
  return `<svg class="${escapeAttr(cls)}" viewBox="${viewBox}"${style} ${a11y}>${body}</svg>`;
}

module.exports = { icon };

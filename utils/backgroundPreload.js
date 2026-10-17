'use strict';

// <link rel="preload"> tags for the page background (HARD-44 item 2).
//
// `<main class="respBgImg">` (views/nav.ejs, so every page) is the LCP element on most pages,
// and its image is declared in custom.css — so the browser cannot even learn the URL until
// that stylesheet has downloaded and parsed. Lighthouse measured that as 190–850 ms of
// "resource load delay". A preload in the head starts it with the HTML.
//
// A preload only helps if its URL is byte-for-byte the one the CSS asks for, and the CSS
// picks one of six by `min-width` breakpoint. So the list is READ FROM custom.css rather
// than copied here: edit a background there and the preload follows; copy the URLs and the
// two drift apart, and the page downloads the image twice. Each link gets the media range
// between its breakpoint and the next, so a browser fetches exactly the one it will use.

const fs = require('fs');
const path = require('path');

const CSS = path.join(__dirname, '..', 'static', 'beta', 'css', 'custom.css');

function parse(css) {
  const found = [];
  const re = /@media\s*\(min-width:\s*(\d+)px\)\s*\{[^@]*?\.respBgImg\s*\{[^}]*?background-image:\s*url\(["']?([^"')]+)["']?\)/g;
  let m;
  while ((m = re.exec(css))) found.push({ min: Number(m[1]), href: m[2] });
  found.sort((a, b) => a.min - b.min);
  return found.map((b, i) => {
    const next = found[i + 1];
    const media = next
      ? `(min-width: ${b.min}px) and (max-width: ${next.min - 0.02}px)`
      : `(min-width: ${b.min}px)`;
    return { href: b.href, media };
  });
}

let cached;
function backgroundPreloads() {
  if (!cached) cached = parse(fs.readFileSync(CSS, 'utf8'));
  return cached;
}

module.exports = { backgroundPreloads, parse };

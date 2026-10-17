const fs = require('fs');
const path = require('path');
const { icon } = require('../../utils/icons');

// HARD-44. Font Awesome's webfont cost every page 118 KB (the footer's brand icons) and most
// pages another 158 KB plus a render-blocking 25 KB stylesheet, for ~33 icons. They are
// inline SVG now, and that stylesheet is gone from the head — so an `fa-` class that creeps
// back renders as nothing at all, silently. This file is what notices.

const ROOT = path.join(__dirname, '..', '..');

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

const VIEWS = walk(path.join(ROOT, 'views'), ['.ejs']);
const SCRIPTS = walk(path.join(ROOT, 'static', 'beta', 'js'), ['.js']);

// A Font Awesome class in markup or in a JS-built string: `fa-trophy`, `fas`, `fa-solid`.
const FA_CLASS = /class\s*=\s*\\?["'][^"']*\b(fa|fas|far|fab|fa-[a-z0-9-]+)\b/;

describe('no Font Awesome class is left', () => {
  test.each([...VIEWS, ...SCRIPTS].map((f) => [path.relative(ROOT, f), f]))('%s', (rel, file) => {
    const offenders = fs.readFileSync(file, 'utf8').split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => FA_CLASS.test(line));
    expect(offenders.map(([n, line]) => `${rel}:${n}: ${line.trim()}`)).toEqual([]);
  });

  test('the guard still recognises the spellings that were in use', () => {
    for (const line of [
      '<i class="fas fa-trophy"></i>',
      '<i class="fa fa-pencil"></i>',
      '<a class="fa-brands fa-facebook"></a>',
      "text: '<i class=\"fas fa-download\"></i> CSV'",
      '<i class="fa-solid fa-map-location-dot"></i>',
    ]) expect(line).toMatch(FA_CLASS);
    expect('<svg class="icon icon-trophy">').not.toMatch(FA_CLASS);
  });

  test('the stylesheet is not loaded', () => {
    const header = fs.readFileSync(path.join(ROOT, 'views', 'header.ejs'), 'utf8');
    expect(header).not.toMatch(/fontawesome|font-awesome/i);
  });
});

describe('every icon a template asks for exists', () => {
  const used = new Set();
  for (const file of VIEWS) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/icon\(\s*'([a-z0-9-]+)'/g)) used.add(m[1]);
  }

  test('the templates use some icons (the scan is not silently empty)', () => {
    expect(used.size).toBeGreaterThan(25);
  });

  test.each([...used])('%s', (name) => {
    expect(icon(name)).toMatch(/^<svg class="icon icon-[a-z0-9-]+" viewBox="[\d. ]+".*<path d="/);
  });
});

describe('icon()', () => {
  test('is decorative by default', () => {
    expect(icon('trophy')).toContain('aria-hidden="true"');
    expect(icon('trophy')).not.toContain('role="img"');
  });

  test('a label makes it an image with a name', () => {
    const svg = icon('phone', { label: 'Call "Jo" <x>' });
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Call &quot;Jo&quot; &lt;x>"');
    expect(svg).not.toContain('aria-hidden');
  });

  test('extra classes and style are added', () => {
    expect(icon('bars', { class: 'icon-float' })).toContain('class="icon icon-bars icon-float"');
    expect(icon('bars', { style: 'font-size:2em' })).toContain('style="font-size:2em"');
  });

  // It is dropped into single-quoted JS strings (DataTables button labels, the shuttle
  // refresh spinner), so a single quote or a newline in the output would break the page.
  test('output is safe inside a single-quoted JS string', () => {
    for (const name of ['download', 'eye', 'magnifying-glass', 'spinner', 'pencil', 'facebook']) {
      const svg = icon(name, { class: 'icon-spin mr-1' });
      expect(svg).not.toMatch(/['\n\r\\]/);
    }
  });

  test('carries no licence comment per use — attribution is once, in the footer', () => {
    expect(icon('trophy')).not.toContain('<!--');
    expect(fs.readFileSync(path.join(ROOT, 'views', 'footer.ejs'), 'utf8')).toMatch(/Font Awesome Free.*CC BY 4\.0/);
  });

  test('an unknown name throws rather than rendering nothing', () => {
    expect(() => icon('times')).toThrow(/no Font Awesome icon called "times"/);
    expect(() => icon('../../package')).toThrow(/bad icon name/);
  });
});

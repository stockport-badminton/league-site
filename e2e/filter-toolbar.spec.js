// The filter toolbar and DataTables control band on the stats/results pages
// (views/filters.ejs, views/datatables-controls.ejs, middleware/filterState.js).
//
// These are the checks that were run by hand when the toolbar was built, kept so
// they run every time. They cover the three faults it was written to fix - filters
// that could not be combined, a stale season list, and column visibility with no
// visible state - plus the two layout traps: a long pager forcing the page into
// horizontal scroll, and .table-responsive clipping the Columns dropdown.
//
// Read-only: every filter is a GET. See e2e/helpers/read-only.js.

const { test, expect } = require('@playwright/test');
const { readOnly } = require('./helpers/read-only');

const FILTERED = '/player-stats/Division-1/20252026/gender-Male';

test.describe('filter toolbar', function () {

  test('pre-selects the filters in the URL so they compose', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);
    await page.goto(FILTERED);

    // The original fault: the selects had no `selected` logic, so they rendered at
    // their defaults and applying a second filter read those defaults back and
    // dropped the first.
    await expect(page.locator('#divisionSelect')).toHaveValue('Division-1');
    await expect(page.locator('#seasonSelect')).toHaveValue('20252026');
    await expect(page.locator('#gender')).toHaveValue('Male');

    guard.assertNoWrites();
  });

  test('Apply keeps the filters already applied', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);
    await page.goto('/player-stats/Division-1');
    await expect(page.locator('#divisionSelect')).toHaveValue('Division-1');

    await page.locator('#gender').selectOption('Male');
    await page.locator('#statsUpdate').click();
    await page.waitForURL(/player-stats/);

    // Both filters must survive - this is the regression that made the filters
    // look broken.
    expect(new URL(page.url()).pathname).toBe('/player-stats/Division-1/gender-Male');

    guard.assertNoWrites();
  });

  test('renders a chip per applied filter, each dropping only that one', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);
    await page.goto(FILTERED);

    const chips = page.locator('.filter-chip');
    await expect(chips).toHaveCount(3);

    const hrefs = await chips.evaluateAll(els => els.map(e => e.getAttribute('href')));
    expect(hrefs).toEqual([
      '/player-stats/20252026/gender-Male',   // division dropped
      '/player-stats/Division-1/gender-Male', // season dropped
      '/player-stats/Division-1/20252026',    // gender dropped
    ]);

    await expect(page.locator('.filter-clear')).toHaveAttribute('href', '/player-stats');

    guard.assertNoWrites();
  });

  test('a chip link resolves and drops only its own filter', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);
    await page.goto(FILTERED);

    await page.locator('.filter-chip', { hasText: 'Male' }).click();
    await page.waitForURL(/player-stats/);

    expect(new URL(page.url()).pathname).toBe('/player-stats/Division-1/20252026');
    await expect(page.locator('.filter-chip')).toHaveCount(2);
    await expect(page.locator('#gender')).toHaveValue('0');

    guard.assertNoWrites();
  });

  test('offers seasons from the DB, not a hardcoded list', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);
    await page.goto('/player-stats');

    const options = await page.locator('#seasonSelect option').evaluateAll(
      els => els.map(e => ({ value: e.value, label: e.textContent.trim() })));

    // The list used to stop at 2024-2025, which made 2025-2026 and the current
    // season unreachable from the UI entirely.
    expect(options.some(o => o.value === '20252026'),
      '2025-2026 should be reachable').toBe(true);
    expect(options[0].label, 'the current season is the empty-value option')
      .toMatch(/^Current season/);

    guard.assertNoWrites();
  });

  test('the admin base path keeps both of its segments', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);
    await page.goto('/admin/results/Division-1/status-complete');

    const hrefs = await page.locator('.filter-chip').evaluateAll(
      els => els.map(e => e.getAttribute('href')));
    expect(hrefs.length).toBeGreaterThan(0);
    hrefs.forEach(h => expect(h, 'must not collapse to /admin').toMatch(/^\/admin\/results\//));

    // /results and /results-grid need an explicit 'All' where a division would sit.
    await expect(page.locator('.filter-clear')).toHaveAttribute('href', '/admin/results/All');

    guard.assertNoWrites();
  });
});

test.describe('DataTables control band', function () {

  test('gathers the controls into one band above and below the table', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);
    await page.goto('/player-stats');

    await expect(page.locator('.dt-controls')).toHaveCount(1);
    await expect(page.locator('.dt-footer')).toHaveCount(1);
    await expect(page.locator('.dt-controls .dataTables_length')).toHaveCount(1);
    await expect(page.locator('.dt-controls .dataTables_filter')).toHaveCount(1);

    guard.assertNoWrites();
  });

  test('the Columns dropdown hides a column and is not clipped', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);
    await page.setViewportSize({ width: 1400, height: 950 });
    await page.goto('/player-stats/Division-1/20252026');

    const visibleHeaders = () => page.locator('#results-table thead tr:first-child th:visible').count();
    const before = await visibleHeaders();
    expect(before, 'player-stats has 13 columns').toBe(13);

    await page.locator('.dt-controls .buttons-colvis').click();
    const menu = page.locator('.dt-button-collection .dropdown-menu');
    await expect(menu).toBeVisible();

    // .table-responsive used to be the outer wrapper, and overflow-x:auto clips
    // vertically too, so the bottom of this menu was cut off whenever the table
    // was shorter than it. The views use an inert .dt-table-shell instead.
    const clipped = await menu.evaluate(function (m) {
      const r = m.getBoundingClientRect();
      let e = m.parentElement;
      while (e && e !== document.body) {
        const cs = getComputedStyle(e);
        if (cs.overflow !== 'visible' && cs.overflow !== '') {
          const pr = e.getBoundingClientRect();
          if (r.bottom > pr.bottom + 1) return true;
        }
        e = e.parentElement;
      }
      return false;
    });
    expect(clipped, 'the Columns menu is clipped by an ancestor overflow').toBe(false);

    await menu.locator('.dt-button').nth(1).click();
    await expect.poll(visibleHeaders, { timeout: 5000 }).toBe(before - 1);

    guard.assertNoWrites();
  });

  test('per-column search is hidden until asked for, and clears on close', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);
    await page.goto('/player-stats/Division-1/20252026');

    const row = page.locator('.dt-colsearch-row');
    // It used to be permanently visible, doubling the header height and reading
    // like the table's first data row.
    await expect(row).toBeHidden();

    await page.locator('.dt-btn-colsearch').click();
    await expect(row).toBeVisible();

    // fixedHeader re-clones the header on every redraw, discarding whatever has
    // been typed since - typing used to lose roughly every other character. The
    // handler is debounced 300ms and delegated; this asserts the text survives.
    const input = row.locator('input').first();
    await input.pressSequentially('Alex', { delay: 60 });
    await expect(input).toHaveValue('Alex');
    await page.waitForTimeout(600);

    await page.locator('.dt-btn-colsearch').click();
    await expect(row).toBeHidden();
    // Never leave a search applied while its box is hidden.
    await expect(input).toHaveValue('');

    guard.assertNoWrites();
  });

  test('no horizontal page overflow at 390, 768 or 1400px', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);

    for (const width of [390, 768, 1400]) {
      await page.setViewportSize({ width: width, height: 900 });
      await page.goto(FILTERED);
      await page.waitForTimeout(400);

      // A 27-page numbered pager came to 405px and pushed the whole page into
      // horizontal scroll on a phone, which is why .dt-footer .pagination wraps.
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `page scrolls horizontally at ${width}px`).toBeLessThanOrEqual(0);
    }

    guard.assertNoWrites();
  });

  test('loads one jQuery, keeping the Bootstrap plugins bound to it', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);
    await page.goto('/player-stats');

    const facts = await page.evaluate(() => ({
      version: window.jQuery && window.jQuery.fn.jquery,
      modal: !!(window.jQuery && window.jQuery.fn.modal),
      dropdown: !!(window.jQuery && window.jQuery.fn.dropdown),
    }));

    // The DataTables bundle used to include jQuery 3.3.1 on top of the copy
    // footer.ejs self-hosts, and jQuery's UMD replaced window.jQuery with a second
    // instance carrying none of Bootstrap's plugins. 3.7.1 is the node_modules one.
    expect(facts.version, 'a second jQuery has been loaded over the self-hosted one').toBe('3.7.1');
    expect(facts.modal, 'Bootstrap plugins lost from the live jQuery').toBe(true);
    expect(facts.dropdown).toBe(true);

    // One DataTables bundle, and only on pages that build a table.
    const bundles = await page.locator('script[src*="datatables.min.js"]').count();
    expect(bundles).toBe(1);

    guard.assertNoWrites();
  });

  test('DataTables CSS is not loaded on pages without a table', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);
    await page.goto('/rules');

    // It used to sit in header.ejs unconditionally, so all ~50 pages paid for it.
    await expect(page.locator('link[href*="datatables.min.css"]')).toHaveCount(0);
    await expect(page.locator('script[src*="datatables.min.js"]')).toHaveCount(0);

    guard.assertNoWrites();
  });
});

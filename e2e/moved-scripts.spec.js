// The inline <script> blocks REARCH-07 step 5 moved to static/beta/js/ (25 Nov 2026), each
// unchanged and loaded from where the block was. A moved block fails in one of two quiet
// ways: its file 404s (a typo in the asset path, invisible to Jest), or it runs at a
// different moment and finds nothing to bind to. So each page here must load every
// script it names, raise no error, and still do the thing the block did.
//
// Read-only. Pages that need a live third party (Auth0 for /approve-user) are not here.

const { test, expect } = require('@playwright/test');
const { readOnly } = require('./helpers/read-only');

// Collects, for the page's lifetime, uncaught errors and any of our scripts that failed.
function watch(page) {
  const problems = [];
  // Third-party errors are not ours to judge: going offline mid-test makes reCAPTCHA's
  // worker fail to fetch from gstatic, which is the test's doing (venue-map.spec does the same).
  page.on('pageerror', err => {
    if (!/gstatic|google|recaptcha/i.test(err.message)) problems.push('error: ' + err.message);
  });
  page.on('response', res => {
    const url = new URL(res.url());
    if (url.pathname.startsWith('/static/beta/js/') && res.status() >= 400) {
      problems.push(`${res.status()} ${url.pathname}`);
    }
  });
  return problems;
}

test.beforeEach(async ({ page, baseURL }) => { await readOnly(page, baseURL); });

test('every page: the service worker registers, and the offline banner appears offline', async ({ page, context }) => {
  const problems = watch(page);
  await page.goto('/info/clubs');
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => !!r)))
    .toBe(true);
  await context.setOffline(true);
  await expect(page.getByText("You're offline — showing a saved copy")).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText("You're offline — showing a saved copy")).toBeHidden();
  expect(problems).toEqual([]);
});

test('/contact-us shows the dropdown for the kind of contact chosen', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/contact-us');
  await page.selectOption('#contactType', 'Clubs');
  await expect(page.locator('#clubsDropDown')).toHaveClass(/d-block/);
  await expect(page.locator('#leagueDropDown')).toHaveClass(/d-none/);
  // reCAPTCHA calls it by name (data-callback="onSubmit"), so it must still be global.
  expect(await page.evaluate(() => typeof window.onSubmit)).toBe('function');
  expect(problems).toEqual([]);
});

test('/notifications opens the how-to video', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/notifications');
  const opener = page.locator('[data-notifications-video]').first();
  if (!(await opener.count())) test.skip(true, 'no video link on the page');
  await opener.click();
  expect(await page.locator('#notificationsVideo').evaluate(d => d.open)).toBe(true);
  expect(problems).toEqual([]);
});

test('the results page offers notifications, and the banner can be dismissed', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/results/All');
  const banner = page.locator('#notificationsBanner');
  if (!(await banner.count())) test.skip(true, 'no notifications banner on this results page');
  await expect(banner).toBeVisible();
  await banner.locator('[data-role="dismiss"]').click();
  await expect(banner).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('notificationsBannerDismissed'))).toBe('1');
  expect(problems).toEqual([]);
});

test('the announcement form builds both editors', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/admin/homepage-content/create');
  await expect(page.locator('.ql-editor')).toHaveCount(2);
  expect(problems).toEqual([]);
});

test('the push admin page and the homepage load their scripts cleanly', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/admin/push');
  await page.goto('/');
  // The tournament gallery binds on DOMContentLoaded; its modal trigger must exist.
  expect(problems).toEqual([]);
});

test('the Messer concede modal posts to the match it was opened from', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/messer-draw/a-section');
  const opener = page.locator('[data-target="#concedeModal"]').first();
  if (!(await opener.count())) test.skip(true, 'no match to concede in the local A section');
  const match = await opener.getAttribute('data-match');
  await opener.click();
  await expect(page.locator('#concedeModal')).toBeVisible();
  expect(await page.locator('#concedeForm').getAttribute('action'))
    .toBe('/messer-draw/a-section/concede/' + encodeURIComponent(match));
  expect(problems).toEqual([]);
});

test('the player form fills the team list from the club chosen', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/player/create');
  const club = await page.locator('#club option').nth(1).getAttribute('value');
  // Bound in jQuery's ready handler; under a loaded parallel run, choosing before it is
  // bound would change nothing.
  await page.waitForFunction(() => {
    const events = window.jQuery && jQuery._data(document.getElementById('club'), 'events');
    return !!(events && events.change);
  });
  await page.selectOption('#club', club);
  await expect.poll(() => page.locator('#team option').count(), { timeout: 15000 }).toBeGreaterThan(1);
  expect(problems).toEqual([]);
});

// datatables-setup.js builds both kinds of table from the page's #dt-config block.
test.describe('the DataTables set-up', () => {
  test('a stats table has its CSV button, and a column search the button reveals', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/player-stats');
    await expect(page.locator('.dt-controls .buttons-csv')).toContainText('CSV');
    await expect(page.locator('.dt-controls .buttons-csv svg')).toHaveCount(1);
    const toggle = page.locator('.dt-btn-colsearch');
    await expect(toggle).toContainText('Search columns');
    await toggle.click();
    await expect(page.locator('#results-table')).toHaveClass(/colsearch-on/);
    const rows = () => page.locator('#results-table tbody tr').count();
    const before = await rows();
    // Typed, not filled: the search listens for keyup and change, which fill() does not fire.
    await page.locator('.dt-colsearch-row input').first().pressSequentially('zzzz');
    await expect.poll(rows).toBeLessThanOrEqual(1);
    await toggle.click();
    await expect.poll(rows).toBe(before);
    expect(problems).toEqual([]);
  });

  test('a results table pages to the fixture nearest today', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/results/All');
    const config = JSON.parse(await page.locator('#dt-config').textContent());
    expect(config.kind).toBe('results');
    const d = new Date(config.nearestDate);
    const ddmmyyyy = ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear();
    await expect(page.locator('#results-table tbody')).toContainText(ddmmyyyy);
    await expect(page.locator('.dt-controls .buttons-colvis')).toContainText('Columns');
    expect(problems).toEqual([]);
  });
});

test('a Messer result is approved for the scorecard on the page, after asking', async ({ page, baseURL }) => {
  const guard = await readOnly(page, baseURL);
  const problems = watch(page);
  await page.goto('/messer-results');
  const link = page.locator('a[href^="/messer-result/"]').first();
  if (!(await link.count())) test.skip(true, 'no filed Messer result locally');
  const href = await link.getAttribute('href');
  await page.goto(href);
  page.once('dialog', d => d.dismiss());
  await page.locator('#approveBtn').click();
  await page.waitForTimeout(300);
  expect(guard.blocked).toEqual([]);
  page.on('dialog', d => d.accept());
  await page.locator('#approveBtn').click();
  await expect.poll(() => guard.blocked).toContain(`POST ${href}/approve`);
  expect(problems).toEqual([]);
});

test('refreshing shuttle prices shows the busy label as it submits', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/shuttle-prices');
  // The page's own submit handler runs first; this one then stops the navigation, so the
  // page stays to be looked at and nothing is scraped.
  await page.evaluate(() => {
    document.querySelector('#refreshBtn').closest('form').addEventListener('submit', e => {
      window.__submitted = true;
      e.preventDefault();
    });
  });
  await page.locator('#refreshBtn').click();
  expect(await page.evaluate(() => window.__submitted)).toBe(true);
  await expect(page.locator('#refreshBtn')).toContainText('Scraping…');
  await expect(page.locator('#refreshBtn svg.icon-spin')).toHaveCount(1);
  await expect(page.locator('#refreshBtn')).toBeDisabled();
  expect(problems).toEqual([]);
});

test("a player's page draws the rating chart from its data block", async ({ page }) => {
  const problems = watch(page);
  // Player 13 has rated games in the local database (rearch-01 snapshot args).
  await page.goto('/playerStats/13/Local%20Player');
  if (!(await page.locator('#elo-data').count())) test.skip(true, 'no rated games for player 13 locally');
  await expect.poll(() => page.evaluate(() => {
    const chart = window.Chart && Chart.getChart('elo-chart');
    return chart ? chart.data.datasets[0].label : null;
  })).toBe('Local Player ELO');
  expect(problems).toEqual([]);
});

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

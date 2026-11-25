// The homepage's Messer gallery modal is filled from /homepage-gallery when it first
// opens. Neither the listing (a Cloudinary call that used to hold up the homepage's own
// response) nor the images (HARD-43: ~10 requests and ~425 KB) come with the page.
//
// The dev server's Cloudinary credentials are dead (e2e/server-env.js), so the real
// fragment is empty. This answers /homepage-gallery with one image, the way the template
// renders it, and drives Bootstrap's own open, so what is under test is the page's script.
const { test, expect } = require('@playwright/test');
const { readOnly } = require('./helpers/read-only');

const IMG = '/static/beta/images/SDBLLogo.png?gallery-test';

test('the gallery and its images load only when the modal opens', async ({ page, baseURL }) => {
  const guard = await readOnly(page, baseURL);
  const fetched = [];
  page.on('request', r => {
    if (r.url().includes('gallery-test') || r.url().includes('/homepage-gallery')) fetched.push(r.url());
  });
  await page.route('**/homepage-gallery', route => route.fulfill({
    contentType: 'text/html',
    body: `<div class="carousel-item active"><img class="d-block img-fluid" src="${IMG}"></div>`,
  }));

  await page.goto('/');
  await page.waitForTimeout(300);
  expect(fetched).toEqual([]);

  await page.evaluate(() => window.jQuery('#generatedTournamentGalleryModal').modal('show'));
  const img = page.locator('#generatedTournamentGalleryModal img').first();
  await expect(img).toHaveAttribute('src', IMG);
  await expect(page.locator('[data-gallery-status]')).toHaveCount(0);
  await expect.poll(() => fetched.length).toBe(2);

  guard.assertNoWrites();
});

test('an empty gallery says so', async ({ page, baseURL }) => {
  const guard = await readOnly(page, baseURL);
  await page.route('**/homepage-gallery', route => route.fulfill({ contentType: 'text/html', body: '\n' }));
  await page.goto('/');
  await page.evaluate(() => window.jQuery('#generatedTournamentGalleryModal').modal('show'));
  await expect(page.locator('[data-gallery-status]')).toHaveText('No photos yet.');
  guard.assertNoWrites();
});

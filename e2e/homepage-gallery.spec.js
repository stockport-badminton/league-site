// HARD-43: the homepage's Messer gallery modal is hidden, and a hidden modal does not stop
// an <img src> downloading — it cost ~10 requests and ~425 KB on every homepage view. The
// images now carry data-src and get their src when the modal opens.
//
// The dev server's Cloudinary credentials are dead (e2e/server-env.js), so the gallery
// renders empty. This plants one image in the real modal, the way the template renders
// it, and drives Bootstrap's own open, so what is under test is the page's script.
const { test, expect } = require('@playwright/test');
const { readOnly } = require('./helpers/read-only');

const IMG = '/static/beta/images/SDBLLogo.png?gallery-test';

test('gallery images download only when the modal opens', async ({ page, baseURL }) => {
  const guard = await readOnly(page, baseURL);
  const fetched = [];
  page.on('request', r => { if (r.url().includes('gallery-test')) fetched.push(r.url()); });

  await page.goto('/');
  await page.evaluate((src) => {
    const inner = document.querySelector('#generatedTournamentGalleryModal .carousel-inner');
    inner.insertAdjacentHTML('beforeend',
      `<div class="carousel-item active"><img class="d-block img-fluid" data-src="${src}"></div>`);
  }, IMG);

  await page.waitForTimeout(300);
  expect(fetched).toEqual([]);

  await page.evaluate(() => window.jQuery('#generatedTournamentGalleryModal').modal('show'));
  const img = page.locator('#generatedTournamentGalleryModal img').first();
  await expect(img).toHaveAttribute('src', IMG);
  await expect.poll(() => fetched.length).toBe(1);

  guard.assertNoWrites();
});

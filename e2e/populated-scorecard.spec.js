// /populated-scorecard-beta/:id - the third scorecard view.
//
// This is the page the away captain lands on from the confirmation email: the
// submitted result played back to them with every score and player prefilled, to
// check and confirm. It shares its layout with the entry form but is a separate
// 1,190-line view, so a change to one can leave the other behind.
//
// Read-only: the page is rendered and read, never confirmed. The guard aborts the
// confirm POST if anything tries it. See e2e/helpers/read-only.js.

const { test, expect } = require('@playwright/test');
const { readOnly } = require('./helpers/read-only');
const { latestScorecardDraftPath, latestMesserDraftId, draftHasScores } = require('./helpers/db');

test.describe('/populated-scorecard-beta/:id', function () {

  let draftPath;

  test.beforeAll(async function () {
    // No page lists these ids - the URL only ever arrives by email - so it comes
    // from a SELECT, along with the confirmation token the page now requires
    // (HARD-03). See e2e/helpers/db.js.
    draftPath = await latestScorecardDraftPath();
  });

  test('plays the submitted result back with scores prefilled', async function ({ page, baseURL }) {
    test.skip(!draftPath, 'no scorecard drafts in the database to render');
    const guard = await readOnly(page, baseURL);

    await page.goto(draftPath);

    // All 18 games, same as the entry form.
    await expect(page.locator('#Game1homeScore').first()).toHaveCount(1);
    await expect(page.locator('#Game18homeScore').first()).toHaveCount(1);
    await expect(page.locator('#Game19homeScore')).toHaveCount(0);

    // The point of this view: the values are already in the inputs. A draft with
    // every score blank would mean the prefill broke.
    const filled = await page.locator('input[id^="Game"][id$="Score"]').evaluateAll(
      els => els.filter(e => e.value !== '').length);
    expect(filled, 'the submitted scores should be prefilled').toBeGreaterThan(0);

    guard.assertNoWrites();
  });

  test('prefills the player selections too', async function ({ page, baseURL }) {
    test.skip(!draftPath, 'no scorecard drafts in the database to render');
    const guard = await readOnly(page, baseURL);

    await page.goto(draftPath);

    // Players are selects, not inputs - a prefill regression here shows up as
    // every dropdown sitting on its placeholder.
    const chosen = await page.locator('select[id^="home"], select[id^="away"]').evaluateAll(
      els => els.filter(e => e.value && e.value !== '0'
                          && !(e.selectedOptions[0] && e.selectedOptions[0].disabled)).length);
    expect(chosen, 'the submitted players should be preselected').toBeGreaterThan(0);

    guard.assertNoWrites();
  });

  // The enumeration this token exists to stop: the id alone used to be the whole
  // credential. Skips while the newest draft predates migration 011 (no token to
  // withhold); once a real tokenised draft exists this asserts the gate for real.
  test('refuses the same draft when the token is left off the URL', async function ({ page, baseURL }) {
    test.skip(!draftPath, 'no scorecard drafts in the database to render');
    test.skip(!draftPath.includes('?t='), 'newest draft predates the confirmation token');
    const guard = await readOnly(page, baseURL);

    const response = await page.goto(draftPath.split('?')[0]);

    expect(response.status()).toBe(403);
    await expect(page.locator('#Game1homeScore')).toHaveCount(0);

    guard.assertNoWrites();
  });

  test('loads without console or page errors', async function ({ page, baseURL }) {
    test.skip(!draftPath, 'no scorecard drafts in the database to render');
    const guard = await readOnly(page, baseURL);
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

    await page.goto(draftPath);
    await page.waitForTimeout(500);

    const real = errors.filter(e => !/ERR_FAILED|ERR_ABORTED|net::/.test(e));
    expect(real).toEqual([]);

    guard.assertNoWrites();
  });
});

test.describe('/populated-messer-scorecard/:id', function () {

  let messerId;
  let hasScores;

  test.beforeAll(async function () {
    messerId = await latestMesserDraftId();
    hasScores = await draftHasScores('messer_scorecard', messerId);
  });

  test('plays a messer result back with 15 games', async function ({ page, baseURL }) {
    test.skip(!messerId, 'no messer drafts in the database to render');
    const guard = await readOnly(page, baseURL);

    await page.goto('/populated-messer-scorecard/' + messerId);

    // The messer/standard distinction has to hold on the populated view as well -
    // these two views are near-copies, so this is the assertion that catches one
    // being changed without the other.
    await expect(page.locator('#Game15homeScore').first()).toHaveCount(1);
    await expect(page.locator('#Game16homeScore')).toHaveCount(0);
    // And messer's negative scores must survive onto the populated view too.
    await expect(page.locator('#Game1homeScore').first()).toHaveAttribute('min', '-10');

    guard.assertNoWrites();
  });

  test('prefills the submitted scores', async function ({ page, baseURL }) {
    test.skip(!messerId, 'no messer drafts in the database to render');
    test.skip(!hasScores, 'the newest messer draft has no scores to prefill');
    const guard = await readOnly(page, baseURL);

    // This page used to render an empty form headed "Messer Result Submitted", so
    // the away captain following the confirmation link saw none of the scores they
    // were being asked to confirm. The 12 selected players and every score are
    // asserted against a complete mocked draft in
    // __tests__/integration/messer-scorecard.test.js - the only draft in the
    // production database is a partial row, so this checks what that row can show.
    await page.goto('/populated-messer-scorecard/' + messerId);
    const filled = await page.locator('input[id^="Game"][id$="Score"]').evaluateAll(
      els => els.filter(e => e.value !== '').length);
    expect(filled, 'the submitted scores should be prefilled').toBeGreaterThan(0);

    guard.assertNoWrites();
  });

  test('prefills the section and date from the draft', async function ({ page, baseURL }) {
    test.skip(!messerId, 'no messer drafts in the database to render');
    const guard = await readOnly(page, baseURL);

    await page.goto('/populated-messer-scorecard/' + messerId);

    // messer_scorecard has no section column, so the section is derived from the
    // home team - if that lookup breaks, the select falls back to its placeholder.
    const section = await page.locator('#section').first().inputValue();
    expect(['A', 'B'], 'a section should be preselected').toContain(section);

    // yyyy-MM-dd, or the date input silently rejects the value and shows blank.
    const date = await page.locator('#date').first().inputValue();
    expect(date, 'the fixture date should be prefilled').toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Both teams preselected, not left on "Select a team".
    for (const sel of ['#homeTeam', '#awayTeam']) {
      const value = await page.locator(sel).first().inputValue();
      expect(value, sel + ' should be preselected').toMatch(/^\d+$/);
    }

    guard.assertNoWrites();
  });
});

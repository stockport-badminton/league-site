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
const { latestScorecardDraftId, latestMesserDraftId, draftHasScores } = require('./helpers/db');

test.describe('/populated-scorecard-beta/:id', function () {

  let draftId;

  test.beforeAll(async function () {
    // No page lists these ids - the URL only ever arrives by email - so it comes
    // from a SELECT. See e2e/helpers/db.js.
    draftId = await latestScorecardDraftId();
  });

  test('plays the submitted result back with scores prefilled', async function ({ page, baseURL }) {
    test.skip(!draftId, 'no scorecard drafts in the database to render');
    const guard = await readOnly(page, baseURL);

    await page.goto('/populated-scorecard-beta/' + draftId);

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
    test.skip(!draftId, 'no scorecard drafts in the database to render');
    const guard = await readOnly(page, baseURL);

    await page.goto('/populated-scorecard-beta/' + draftId);

    // Players are selects, not inputs - a prefill regression here shows up as
    // every dropdown sitting on its placeholder.
    const chosen = await page.locator('select[id^="home"], select[id^="away"]').evaluateAll(
      els => els.filter(e => e.value && e.value !== '0'
                          && !(e.selectedOptions[0] && e.selectedOptions[0].disabled)).length);
    expect(chosen, 'the submitted players should be preselected').toBeGreaterThan(0);

    guard.assertNoWrites();
  });

  test('loads without console or page errors', async function ({ page, baseURL }) {
    test.skip(!draftId, 'no scorecard drafts in the database to render');
    const guard = await readOnly(page, baseURL);
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

    await page.goto('/populated-scorecard-beta/' + draftId);
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

  // KNOWN BUG - marked test.fail() so the suite stays green while recording it,
  // and tells us to remove the annotation once it is fixed.
  //
  // /populated-messer-scorecard/:id renders an empty form titled "Messer Result
  // Submitted": the away captain following the confirmation link sees none of the
  // scores they are being asked to confirm. Two mismatches in
  // messer_fixture_populate_scorecard_fromId (controllers/messer-scorecard-controller.js):
  //
  //   - it passes the draft as `scorecard`, but the score inputs in
  //     views/messer-scorecard.ejs read `data.Game1homeScore` etc, and `data` is
  //     never passed - so every score renders value="".
  //   - `scorecard` is the raw messer_scorecard row, while the view expects the
  //     dropdown shape (scorecard.homeTeamRows, homeMenRows, homeLadiesRows...),
  //     so the player selects render empty too.
  //
  // The standard /populated-scorecard-beta/:id passes both of these, so this is
  // messer-only. Likely the same root cause as the messer form losing its data on
  // validation errors.
  test('prefills the submitted scores', async function ({ page, baseURL }) {
    test.skip(!messerId, 'no messer drafts in the database to render');
    test.skip(!hasScores, 'the newest messer draft has no scores to prefill');
    // Inside the test body, not the describe body - at describe level this
    // modifier applies to every test in the group.
    test.fail();
    const guard = await readOnly(page, baseURL);

    await page.goto('/populated-messer-scorecard/' + messerId);
    const filled = await page.locator('input[id^="Game"][id$="Score"]').evaluateAll(
      els => els.filter(e => e.value !== '').length);
    expect(filled, 'the submitted scores should be prefilled').toBeGreaterThan(0);

    guard.assertNoWrites();
  });
});

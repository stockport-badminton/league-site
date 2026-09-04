// /scorecard-beta - the 18-game standard scorecard.
//
// The form is inside a Bootstrap modal, and its team and player dropdowns are
// filled in by jQuery from three endpoints as the user picks a division and then
// a team. None of that is exercised by the Jest suite, which renders the route
// with supertest and never runs the page's scripts.
//
// Read-only: nothing here submits. See e2e/helpers/read-only.js.

const { test, expect } = require('@playwright/test');
const { readOnly } = require('./helpers/read-only');
const { selectableValues, selectFirstReal } = require('./helpers/selects');

const MODAL = '#signupModal';

test.describe('/scorecard-beta', function () {

  test('renders the page and opens the scorecard modal', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);
    await page.goto('/scorecard-beta');

    // The modal is closed until the trigger is clicked. This is the assertion
    // most exposed to a Bootstrap 5 upgrade: the trigger is
    // `data-toggle="modal" href="#signupModal"`, which BS5 renames to
    // data-bs-toggle / data-bs-target. Under BS5 the click would do nothing.
    await expect(page.locator(MODAL)).toBeHidden();

    await page.getByRole('link', { name: /Enter Result/i }).first().click();
    await expect(page.locator(MODAL).first()).toBeVisible();

    guard.assertNoWrites();
  });

  test('has all 18 games, each with a home and away score input', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);
    await page.goto('/scorecard-beta');

    for (const n of [1, 9, 18]) {
      await expect(page.locator(`#Game${n}homeScore`).first()).toHaveCount(1);
      await expect(page.locator(`#Game${n}awayScore`).first()).toHaveCount(1);
    }
    // 18 and not 19 - the messer card is the 15-game one.
    await expect(page.locator('#Game19homeScore')).toHaveCount(0);

    const homeInputs = await page.locator('input[id^="Game"][id$="homeScore"]').count();
    expect(homeInputs).toBeGreaterThanOrEqual(18);

    guard.assertNoWrites();
  });

  test('picking a division populates the team dropdowns', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);
    await page.goto('/scorecard-beta');
    await page.getByRole('link', { name: /Enter Result/i }).first().click();
    await expect(page.locator(MODAL).first()).toBeVisible();

    const division = page.locator('#division').first();
    const homeTeam = page.locator('#homeTeam').first();

    const divisionValues = await selectableValues(division);
    expect(divisionValues.length, 'divisions should come from the DB').toBeGreaterThan(0);

    const before = await homeTeam.locator('option').count();
    await selectFirstReal(division);

    // jQuery fetches a template then POSTs /teams, so wait for the option list to
    // actually grow rather than for a fixed delay.
    await expect.poll(
      async () => homeTeam.locator('option').count(),
      { message: 'home team options should be populated from POST /teams', timeout: 10000 }
    ).toBeGreaterThan(before);

    const awayCount = await page.locator('#awayTeam').first().locator('option').count();
    expect(awayCount, 'away team dropdown should populate too').toBeGreaterThan(1);

    guard.assertNoWrites();
  });

  test('picking a home team populates its player dropdowns', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);
    await page.goto('/scorecard-beta');
    await page.getByRole('link', { name: /Enter Result/i }).first().click();
    await expect(page.locator(MODAL).first()).toBeVisible();

    const division = page.locator('#division').first();
    const homeTeam = page.locator('#homeTeam').first();
    await selectFirstReal(division);
    await expect.poll(async () => homeTeam.locator('option').count(), { timeout: 10000 })
      .toBeGreaterThan(1);

    const teamValues = await selectableValues(homeTeam);
    expect(teamValues.length, 'teams should be populated for the division').toBeGreaterThan(0);

    const man1 = page.locator('#homeMan1').first();
    const before = await man1.locator('option').count();
    await selectFirstReal(homeTeam);

    // GET /eligiblePlayers/:teamId/Male and .../Female
    await expect.poll(
      async () => man1.locator('option').count(),
      { message: 'player options should come from GET /eligiblePlayers', timeout: 10000 }
    ).toBeGreaterThan(before);

    const lady1 = await page.locator('#homeLady1').first().locator('option').count();
    expect(lady1, 'ladies dropdown should populate as well').toBeGreaterThan(1);

    guard.assertNoWrites();
  });

  // The auto-fill input carried accept="image/*", so a captain's own scanner PDF was not
  // offered in the file dialog at all - the server could convert a document scorecard and
  // no one could hand it one. A server test cannot see this: the attribute is what the
  // BROWSER uses to filter the picker, and supertest posts whatever it is told to.
  test('the auto-fill input offers documents, not just images', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);

    await page.goto('/scorecard-beta');
    await page.getByRole('link', { name: /Enter Result/i }).first().click();
    await expect(page.locator(MODAL).first()).toBeVisible();

    const accept = await page.locator('#scorecardPhoto').first().getAttribute('accept');
    expect(accept).toContain('image/*');
    expect(accept).toMatch(/pdf/);
    expect(accept).toMatch(/docx|wordprocessingml/);

    guard.assertNoWrites();
  });

  // The plain photo box. It had no `accept` at all, so the dialog offered everything and
  // a captain found out their PDF was wrong only afterwards — and the handler's catch was
  // `console.error` alone, so "afterwards" meant never: the scorecard was filed with no
  // photo and nothing said so.
  test('the plain photo box offers documents too', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);

    await page.goto('/scorecard-beta');
    await page.getByRole('link', { name: /Enter Result/i }).first().click();
    await expect(page.locator(MODAL).first()).toBeVisible();

    const accept = await page.locator('#scoresheet-spreadsheet').first().getAttribute('accept');
    expect(accept).toMatch(/pdf/);
    expect(accept).toMatch(/docx|wordprocessingml/);

    guard.assertNoWrites();
  });

  // Which route a file takes is the whole design: an image goes straight to S3 on a
  // presigned PUT, a document goes through the server so what lands in the bucket is the
  // image inside it. Asserted in the browser because the predicate runs there, and it
  // needs no network at all — so the read-only guard has nothing to object to.
  test('ScorecardUpload routes documents and images differently', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);
    await page.goto('/scorecard-beta');

    const verdicts = await page.evaluate(function () {
      var mk = function (name, type) { return new File([new Uint8Array([1])], name, { type: type }); };
      return {
        loaded:   typeof window.ScorecardUpload === 'object',
        pdf:      ScorecardUpload.isDocument(mk('card.pdf', 'application/pdf')),
        docx:     ScorecardUpload.isDocument(mk('card.docx', '')),
        // Trust the type when the name is unhelpful — phones and some scanners send one
        // without the other.
        pdfNoExt: ScorecardUpload.isDocument(mk('scan', 'application/pdf')),
        jpeg:     ScorecardUpload.isDocument(mk('card.jpg', 'image/jpeg')),
        heic:     ScorecardUpload.isDocument(mk('IMG_0001.HEIC', 'image/heic')),
      };
    });

    expect(verdicts).toEqual({
      loaded: true, pdf: true, docx: true, pdfNoExt: true, jpeg: false, heic: false,
    });

    guard.assertNoWrites();
  });

  test('loads without console or page errors', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

    await page.goto('/scorecard-beta');
    await page.getByRole('link', { name: /Enter Result/i }).first().click();
    await expect(page.locator(MODAL).first()).toBeVisible();

    // Aborted third-party beacons surface as network console errors; they are the
    // guard doing its job, not a fault in the page.
    const real = errors.filter(e => !/ERR_FAILED|ERR_ABORTED|net::/.test(e));
    expect(real).toEqual([]);

    guard.assertNoWrites();
  });
});

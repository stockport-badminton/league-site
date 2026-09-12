// Filing a scorecard, for real: the form is filled in the browser and POSTed, and the row
// it writes is read back out of the database.
//
// THIS SPEC WRITES. One row in `scorecardstore` per test that runs — no updates, no
// deletes, nothing outside that table. It is safe to run repeatedly and needs no
// `tools/local-db.sh load` in between: each run simply adds another draft, exactly as a
// captain filing a result does, and nothing here depends on the table's contents. (A test
// that only passes against a freshly loaded database is a test that gets skipped.)
//
// Why it may write at all: until HARD-13 the dev server this suite starts was pointed at
// the production Supabase, so "serialise the form, do not post it" was the only safe
// answer, and e2e/form-contract.spec.js is what that constraint produced. The database is
// now a local Postgres that rebuilds from nothing in five seconds, and HARD-33 gave the
// server dead credentials for everything outbound, so the submission is harmless.
//
// And it is worth more than serialising, because it holds the part serialising cannot:
// serialising asserts what the DOM WOULD send, while this proves the server accepts that
// shape, stores what it was given, and hands the captain back a page showing it. The
// duplicate `scoresheet-url` bug was exactly a form whose serialised shape and whose
// accepted shape had come apart.
//
// The write is declared: `allowWrites` names the one path, and everything else — every
// other same-origin POST, and anything cross-origin at all — is still aborted and still
// fails assertNoWrites().

const { test, expect } = require('@playwright/test');
const { readOnly } = require('./helpers/read-only');
const { selectableValues } = require('./helpers/selects');
const { query, outstandingFixture } = require('./helpers/db');

const MODAL = '#signupModal';

// `/email-scorecard` is the captain's route: its form posts to /email-scorecard, which
// FILES A DRAFT. `/scorecard-beta` renders the same view with formAction='/scorecard-beta'
// and posts straight to publish — completing the fixture, writing 18 game rows and firing
// the social webhook. This spec deliberately drives the first: it is the flow captains use
// every week, and its side effect is one row in one table.
const CAPTAIN_FORM = '/email-scorecard';

async function openWizard(page) {
  await page.goto(CAPTAIN_FORM);
  await page.getByRole('link', { name: /Enter Result/i }).first().click();
  await expect(page.locator(MODAL).first()).toBeVisible();
}

// A REAL outstanding fixture, not the first two teams in the first division: this files
// the draft a captain would file, against a match that is actually being played, so the
// row it leaves is one the results secretary could open and confirm.
//
// It does NOT stop `dbq --check orphan-drafts` reporting these rows, and the reason is
// worth knowing before you go looking. That check asks whether a COMPLETE or CONCEDED
// fixture exists for the draft — a filed draft is exactly the state it is designed to
// report, because "filed and never published" is the failure it exists to catch. So every
// run of this spec adds a row to it **on the local database**. That is noise, not a
// finding, and `tools/local-db.sh load` clears it in five seconds; production is untouched
// either way. Publishing instead of filing would silence it and is not worth the price —
// POST /scorecard-beta completes the fixture, writes 18 game rows and fires the social
// webhook.
async function chooseFixture(page, fixture) {
  await page.locator('#division').first().selectOption(fixture.division);
  await expect
    .poll(async () => (await selectableValues(page.locator('#homeTeam').first())).length,
          { message: 'teams should arrive from POST /teams', timeout: 10000 })
    .toBeGreaterThan(1);

  await page.locator('#homeTeam').first().selectOption(fixture.homeTeam);
  await page.locator('#awayTeam').first().selectOption(fixture.awayTeam);
  await page.locator('#date').first().fill(fixture.date);
  return fixture;
}

// Three men and three ladies, all different people — the form refuses a player used
// twice, and a submission refused for that reason would say nothing about the shape under
// test.
//
// One side at a time, and only while its own step is showing: the home squad is step 2 and
// the away squad step 3, and Playwright will not select an option in a hidden step — it
// waits for it to become visible and then times the test out, which is not an obvious
// symptom of "wrong step".
async function chooseSquad(page, side) {
  const chosen = {};
  for (const group of [['Man1', 'Man2', 'Man3'], ['Lady1', 'Lady2', 'Lady3']]) {
    const sel = page.locator(`#${side}${group[0]}`).first();
    await expect
      .poll(async () => (await selectableValues(sel)).length,
            { message: `${side} ${group[0]} should be populated`, timeout: 10000 })
      .toBeGreaterThan(2);
    const people = await selectableValues(sel);
    for (let i = 0; i < group.length; i++) {
      await page.locator(`#${side}${group[i]}`).first().selectOption(people[i]);
      chosen[`${side}${group[i]}`] = people[i];
    }
  }
  return chosen;
}

// Step 1 fixture, step 2 home squad, step 3 away squad, and out onto the first score step.
async function walkToScores(page, fixture) {
  await chooseFixture(page, fixture);
  await page.locator(`button.step.step-1[onclick="sendEvent('2')"]`).first().click();
  await chooseSquad(page, 'home');
  await page.locator(`button.step.step-2[onclick="sendEvent('3')"]`).first().click();
  await chooseSquad(page, 'away');
  await page.locator(`button.step.step-3[onclick="sendEvent('4')"]`).first().click();
  await expect(page.locator('.modal-body.step-4').first()).toBeVisible();
  return fixture;
}

// Walk the nine score steps, filling both games on each. The gate refuses to leave a step
// until its games are legal, so getting to step 13 at all means all eighteen are.
async function fillEveryGame(page, homeWins) {
  for (let step = 4; step <= 12; step++) {
    for (const n of [(step - 4) * 2 + 1, (step - 4) * 2 + 2]) {
      const homeWon = n <= homeWins;
      await page.locator(`#Game${n}homeScore`).first().fill(homeWon ? '21' : '15');
      await page.locator(`#Game${n}awayScore`).first().fill(homeWon ? '15' : '21');
    }
    await page.locator(`button.step.step-${step}[onclick="sendEvent('${step + 1}')"]`)
      .first().click();
  }
  await expect(page.locator('.modal-body.step-13').first()).toBeVisible();
  await page.locator(`button.step.step-13[onclick="sendEvent('14')"]`).first().click();
  await expect(page.locator('.modal-body.step-14').first()).toBeVisible();
}

test.describe('filing a scorecard', function () {

  test('writes the draft, and lands the captain on it', async function ({ page, baseURL }) {
    test.slow();                       // eighteen games through a fourteen-step wizard
    const guard = await readOnly(page, baseURL, { allowWrites: [/^\/email-scorecard$/] });

    const fixture = await outstandingFixture();
    test.skip(!fixture, 'no outstanding fixture — load tools/local-db/dev-fixtures.sql');
    const before = (await query('SELECT COALESCE(MAX(id), 0) AS max FROM scorecardstore'))[0].max;

    await openWizard(page);
    await walkToScores(page, fixture);
    await fillEveryGame(page, 11);

    await Promise.all([
      page.waitForURL(/\/populated-scorecard-beta\/\d+/, { timeout: 20000 }),
      page.locator('#signup').first().click(),
    ]);

    // 1. The captain is on the confirmation page for the draft they just filed, and the
    //    URL carries the per-draft token — without it the page refuses to open, which is
    //    what made every submitted scorecard land on a 403 when the token was introduced.
    const url = new URL(page.url());
    const id = Number(url.pathname.split('/').pop());
    expect(id).toBeGreaterThan(before);
    expect(url.searchParams.get('t'), 'the confirmation link must carry its token')
      .toBeTruthy();

    // 2. The row, read back out of the table — not inferred from the redirect.
    const rows = await query(
      `SELECT "homeTeam", "awayTeam", "Game1homeScore", "Game18awayScore", "homeMan1"
         FROM scorecardstore WHERE id = ?`, [id]);
    expect(rows).toHaveLength(1);
    expect(String(rows[0].homeTeam)).toBe(fixture.homeTeam);
    expect(String(rows[0].awayTeam)).toBe(fixture.awayTeam);
    expect(String(rows[0].Game1homeScore)).toBe('21');     // home won game 1
    expect(String(rows[0].Game18awayScore)).toBe('21');    // away won game 18
    expect(rows[0].homeMan1).not.toBeNull();

    // 3. The page plays it back, which is the half a server test cannot see: the same
    //    view, re-rendered from the stored row, is what the results secretary confirms.
    await expect(page.locator('#Game1homeScore').first()).toHaveValue('21');
    await expect(page.locator('#Game18awayScore').first()).toHaveValue('21');

    // One write, and it is the one that was declared.
    expect(guard.writes).toEqual(['POST /email-scorecard']);
    guard.assertNoWrites();
  });

  // The form posts to a server whose SES credentials are deliberately dead (HARD-33), so
  // every submission here exercises the case where the results secretary CANNOT be
  // emailed. That is the whole reason this test found anything: the draft is written
  // before the email is attempted, and the send used to be awaited bare inside the try —
  // so a captain whose draft was safely stored got the 500 page, whose entire message is
  // that nothing was recorded. What a captain does about that is file it again.
  //
  // The draft must survive, the captain must land on it, and the page must say which of
  // the two situations they are in.
  test('survives a results-secretary email that cannot be sent, and says so',
    async function ({ page, baseURL }) {
      test.slow();
      const guard = await readOnly(page, baseURL, { allowWrites: [/^\/email-scorecard$/] });

      const fixture = await outstandingFixture();
      test.skip(!fixture, 'no outstanding fixture — load tools/local-db/dev-fixtures.sql');

      await openWizard(page);
      await walkToScores(page, fixture);
      await fillEveryGame(page, 9);

      await Promise.all([
        page.waitForURL(/\/populated-scorecard-beta\/\d+/, { timeout: 20000 }),
        page.locator('#signup').first().click(),
      ]);

      // Not a 500, and not silence either.
      await expect(page.locator('body')).toContainText(/couldn't email the results secretary/i);
      await expect(page.locator('body')).toContainText(/scorecard is saved/i);
      expect(new URL(page.url()).searchParams.get('notified')).toBe('0');

      guard.assertNoWrites();
    });
});

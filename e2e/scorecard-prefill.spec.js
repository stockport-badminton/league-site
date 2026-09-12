// What the auto-fill actually fills in.
//
// `prefillFromAnalysis` sets the date, the division, both teams, all twelve players and
// all thirty-six scores from the reader's output. Only its photo half had a test
// (e2e/scorecard.spec.js, 'the auto-fill box'), and the photo is the part a captain
// notices is missing — the rest fails quietly, into a form that looks filled in.
//
// It is also the hardest part of the page to get right, because almost none of it is
// direct. Setting the division fires a POST /teams; the teams arrive later and only THEN
// can the team ids be applied; setting a team fires two GET /eligiblePlayers calls, and
// only when those return can the players be applied. So the prefill is a chain of
// deferred writes (`_pendingTeamIds`, `_pendingPlayerIds`), and any break in it leaves the
// fields before the break populated and everything after it empty — which is exactly what
// a captain glancing at step 1 would not notice.
//
// The ids are taken from the running database through the form's own dropdowns rather
// than hardcoded: which divisions and players exist is a property of the data, and a test
// that hardcodes them passes against one snapshot and fails against the next.
//
// Read-only: the analysis and the photo upload are both stubbed, and nothing is submitted.

const { test, expect } = require('@playwright/test');
const { readOnly } = require('./helpers/read-only');
const { selectableValues, selectFirstReal } = require('./helpers/selects');

const MODAL = '#signupModal';
const HOME_SLOTS = ['homeMan1', 'homeMan2', 'homeMan3', 'homeLady1', 'homeLady2', 'homeLady3'];
const AWAY_SLOTS = ['awayMan1', 'awayMan2', 'awayMan3', 'awayLady1', 'awayLady2', 'awayLady3'];

async function openWizard(page) {
  await page.goto('/scorecard-beta');
  await page.getByRole('link', { name: /Enter Result/i }).first().click();
  await expect(page.locator(MODAL).first()).toBeVisible();
}

// Drive the form by hand once to find out what a real analysis result would look like for
// this database: a division, two of its teams, and three men and three ladies from each.
// Doing it through the page is deliberate — these are exactly the ids the reader's
// fuzzy-matcher produces, because it matches against the same tables these dropdowns are
// built from.
async function realCardFor(page) {
  await openWizard(page);

  const division = await selectFirstReal(page.locator('#division').first());
  await expect
    .poll(async () => (await selectableValues(page.locator('#homeTeam').first())).length,
          { message: 'teams should arrive from POST /teams', timeout: 10000 })
    .toBeGreaterThan(1);

  const teams = await selectableValues(page.locator('#homeTeam').first());
  const [homeTeam, awayTeam] = [teams[0], teams[1]];

  const card = { division, homeTeam, awayTeam, date: '2026-09-10' };

  for (const [team, slots] of [[homeTeam, HOME_SLOTS], [awayTeam, AWAY_SLOTS]]) {
    const side = slots === HOME_SLOTS ? 'home' : 'away';
    await page.locator(`#${side}Team`).first().selectOption(team);
    // Three men and three ladies, and they have to be three DIFFERENT people: the form
    // rejects the same player twice, so a card built from option[0] three times would be
    // refused for a reason that has nothing to do with the prefill.
    for (const group of [['Man1', 'Man2', 'Man3'], ['Lady1', 'Lady2', 'Lady3']]) {
      const sel = page.locator(`#${side}${group[0]}`).first();
      await expect
        .poll(async () => (await selectableValues(sel)).length,
              { message: `${side} ${group[0]} should be populated`, timeout: 10000 })
        .toBeGreaterThan(2);
      const people = await selectableValues(sel);
      group.forEach((slot, i) => { card[`${side}${slot}`] = people[i]; });
    }
  }

  // Home wins 11-7, in legal scorelines — the gate downstream will refuse anything else,
  // and a prefill whose scores cannot pass the form's own rules is not a useful prefill.
  for (let n = 1; n <= 18; n++) {
    const homeWon = n <= 11;
    card[`Game${n}homeScore`] = homeWon ? '21' : '15';
    card[`Game${n}awayScore`] = homeWon ? '15' : '21';
  }
  return card;
}

// Everything the page needs to auto-fill without anything leaving the browser.
async function stubAnalysis(page, card) {
  await page.route('**/api/analyse-scorecard', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(card),
  }));
  await page.route('**/sign-s3*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      signedUrl: 'https://badmintontemp.s3.eu-west-1.amazonaws.com/put?sig=x',
      url: 'https://badmintontemp.s3.eu-west-1.amazonaws.com/scorecards/20262027/p.jpg',
    }),
  }));
  await page.route('https://badmintontemp.s3.eu-west-1.amazonaws.com/**',
    route => route.fulfill({ status: 200, body: '' }));
}

const photo = {
  name: 'card.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
};

test.describe('the auto-fill prefill', function () {

  test('fills the fixture, both squads and every score', async function ({ page, baseURL }) {
    test.slow();  // two passes over the form, and the dropdowns are three round trips deep
    const guard = await readOnly(page, baseURL);

    const card = await realCardFor(page);
    await stubAnalysis(page, card);
    await openWizard(page);                       // a fresh, empty form

    await page.setInputFiles('#scorecardPhoto', photo);

    // 1. The fixture. The division is set directly; the teams can only be applied once
    //    POST /teams has answered, so this is the first link in the chain.
    await expect(page.locator('#division').first()).toHaveValue(card.division);
    await expect(page.locator('#date').first()).toHaveValue(card.date);
    await expect.poll(async () => page.locator('#homeTeam').first().inputValue(),
                      { message: 'the home team is applied after POST /teams answers',
                        timeout: 10000 }).toBe(card.homeTeam);
    await expect(page.locator('#awayTeam').first()).toHaveValue(card.awayTeam);

    // 2. The squads, which are a link further down the same chain: they cannot be applied
    //    until GET /eligiblePlayers has answered for the team that was itself applied
    //    asynchronously. If the chain breaks anywhere this is where it shows.
    for (const slot of [...HOME_SLOTS, ...AWAY_SLOTS]) {
      await expect.poll(async () => page.locator(`#${slot}`).first().inputValue(),
                        { message: `${slot} should be prefilled`, timeout: 10000 })
        .toBe(card[slot]);
    }

    // 3. The scores, which are the only part applied immediately.
    for (const n of [1, 9, 11, 12, 18]) {
      await expect(page.locator(`#Game${n}homeScore`).first())
        .toHaveValue(card[`Game${n}homeScore`]);
      await expect(page.locator(`#Game${n}awayScore`).first())
        .toHaveValue(card[`Game${n}awayScore`]);
    }

    guard.assertNoWrites();
  });

  // The prefilled scores are run through the same validator a captain's typing is, and a
  // legal card must come out clean. A prefill that lands 18 games' worth of red is worse
  // than none: the captain cannot tell which of them the reader got wrong.
  test('leaves no game flagged, and walks through the gate it has to pass',
    async function ({ page, baseURL }) {
      test.slow();
      const guard = await readOnly(page, baseURL);

      const card = await realCardFor(page);
      await stubAnalysis(page, card);
      await openWizard(page);

      await page.setInputFiles('#scorecardPhoto', photo);
      await expect(page.locator('#Game18awayScore').first())
        .toHaveValue(card.Game18awayScore);

      const flagged = await page.locator('.score-feedback:visible').count();
      expect(flagged, 'a legal prefilled card should raise no feedback').toBe(0);

      // And the gate agrees: three Continues to the first score step, then straight
      // through it without typing anything.
      for (const from of [1, 2, 3]) {
        await page.locator(`button.step.step-${from}[onclick="sendEvent('${from + 1}')"]`)
          .first().click();
      }
      await page.locator(`button.step.step-4[onclick="sendEvent('5')"]`).first().click();
      await expect(page.locator('.modal-body.step-5').first()).toBeVisible();

      guard.assertNoWrites();
    });

  // A card the reader could not place — no division, no teams — still yields its scores,
  // and the page has to keep them rather than throwing the lot away because the fixture
  // is missing. This is the common half-success: the printed grid reads cleanly and the
  // handwritten header does not.
  test('keeps the scores when the fixture could not be matched',
    async function ({ page, baseURL }) {
      const guard = await readOnly(page, baseURL);
      await stubAnalysis(page, {
        division: null, homeTeam: null, awayTeam: null, date: '2026-09-10',
        Game1homeScore: '21', Game1awayScore: '15',
        Game2homeScore: '19', Game2awayScore: '21',
      });
      await openWizard(page);

      await page.setInputFiles('#scorecardPhoto', photo);

      await expect(page.locator('#Game1homeScore').first()).toHaveValue('21');
      await expect(page.locator('#Game2awayScore').first()).toHaveValue('21');
      await expect(page.locator('#date').first()).toHaveValue('2026-09-10');
      // And the captain is told something was filled in, so "review before submitting"
      // means what it says — the fixture above the scores is the part they must supply.
      await expect(page.locator('#photoAnalysisResult')).toContainText(/auto-filled/i);

      // And the division is still unchosen. Read as "the selected option is the disabled
      // placeholder", not as an empty value: that placeholder carries no `value`
      // attribute, so `select.value` falls back to its TEXT and an empty-string assertion
      // here fails against a correct page (see e2e/helpers/selects.js).
      expect(await page.locator('#division').first()
        .evaluate(el => el.selectedOptions[0].disabled)).toBe(true);

      guard.assertNoWrites();
    });
});

// /messer-scorecard-beta - the 15-game knockout card.
//
// Messer differs from the standard card in ways that are easy to break without
// noticing, because the two views are near-copies of each other: 15 games rather
// than 18, teams chosen by section rather than division, and negative scores are
// legal (it is handicapped, so a side can finish below zero).
//
// Read-only: nothing here submits. See e2e/helpers/read-only.js.

const { test, expect } = require('@playwright/test');
const { readOnly } = require('./helpers/read-only');
const { selectableValues, selectFirstReal } = require('./helpers/selects');

const MODAL = '#signupModal';

async function openCard(page) {
  await page.getByRole('link', { name: /Enter Result/i }).first().click();
  await expect(page.locator(MODAL).first()).toBeVisible();
}

test.describe('/messer-scorecard-beta', function () {

  test('renders and opens the card', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);
    await page.goto('/messer-scorecard-beta');
    await expect(page.locator(MODAL)).toBeHidden();
    await openCard(page);
    guard.assertNoWrites();
  });

  test('has 15 games, not 18', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);
    await page.goto('/messer-scorecard-beta');

    for (const n of [1, 8, 15]) {
      await expect(page.locator(`#Game${n}homeScore`).first()).toHaveCount(1);
      await expect(page.locator(`#Game${n}awayScore`).first()).toHaveCount(1);
    }
    // The distinguishing assertion: games 16-18 belong to the standard card only.
    for (const n of [16, 17, 18]) {
      await expect(page.locator(`#Game${n}homeScore`)).toHaveCount(0);
    }

    guard.assertNoWrites();
  });

  test('score inputs allow negative values, unlike the standard card', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);

    // Asserted on the attribute rather than by typing: the score fields sit on a
    // later step of the multi-step modal, so reaching them means driving the
    // wizard, and min= is the actual contract anyway. Messer is handicapped, so a
    // side can finish below zero; the standard card must not allow that. The
    // failure mode this catches is the two near-identical views drifting into each
    // other - a min="0" copied into messer would silently reject a legal score.
    await page.goto('/messer-scorecard-beta');
    const messerMin = await page.locator('#Game1homeScore').first().getAttribute('min');
    expect(messerMin, 'messer scores must allow negatives').toBe('-10');

    await page.goto('/scorecard-beta');
    const standardMin = await page.locator('#Game1homeScore').first().getAttribute('min');
    expect(standardMin, 'standard scores must not allow negatives').toBe('0');

    guard.assertNoWrites();
  });

  test('picking a section narrows the team dropdowns to that section', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);
    await page.goto('/messer-scorecard-beta');
    await openCard(page);

    const section = page.locator('#section').first();
    const homeTeam = page.locator('#homeTeam').first();

    const sections = await selectableValues(section);
    expect(sections.length, 'sections should be offered').toBeGreaterThan(0);

    // Asserted against the API payload rather than against "the list changed".
    // The teams are server-rendered as every team and the handler *replaces* them,
    // so for whichever section happens to hold all of them the rebuilt list is
    // byte-identical to the original - a "did it change" check passes or fails on
    // which section sorts first, not on whether the wiring works.
    const responded = page.waitForResponse(function (res) {
      return /\/api\/messer-teams-by-section\//.test(res.url()) && res.status() === 200;
    }, { timeout: 10000 });

    await selectFirstReal(section);
    const apiTeams = await (await responded).json();
    expect(apiTeams.length, 'the section should have teams').toBeGreaterThan(0);

    const expected = apiTeams.map(function (t) { return String(t.id); }).join(',');
    for (const sel of ['#homeTeam', '#awayTeam']) {
      await expect.poll(
        async function () { return (await selectableValues(page.locator(sel).first())).join(','); },
        { message: sel + ' should hold exactly the teams the API returned', timeout: 10000 }
      ).toBe(expected);
    }

    guard.assertNoWrites();
  });

  test('the test card renders a fully populated 15-game scorecard', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);
    await page.goto('/messer-scorecard-beta/test');

    // This route exists to render a filled-in card, so it is the cheapest check
    // that the populated layout survives a change.
    await expect(page.locator('#Game15homeScore').first()).toHaveCount(1);
    const filled = await page.locator('input[id^="Game"][id$="Score"]').evaluateAll(
      els => els.filter(e => e.value !== '').length);
    expect(filled, 'the test card should arrive with scores in it').toBeGreaterThan(0);

    guard.assertNoWrites();
  });

  test('loads without console or page errors', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

    await page.goto('/messer-scorecard-beta');
    await openCard(page);

    const real = errors.filter(e => !/ERR_FAILED|ERR_ABORTED|net::/.test(e));
    expect(real).toEqual([]);

    guard.assertNoWrites();
  });
});

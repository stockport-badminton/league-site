// The live scorecard end to end, on phones: start a card, two phones filling it in and
// seeing each other's scores, both captains signing, and the draft it files read back out
// of the database. controllers/liveScorecardController.js.
//
// THIS SPEC WRITES, through the app and in the open, as e2e/scorecard-submit.spec.js does:
// one `live_scorecard` row and one `scorecardstore` draft per run. Every write path is
// named in `allowWrites`; anything else is still aborted and still fails assertNoWrites().
//
// It is the only thing that runs the card's SQL — jsonb_set per cell, the version-checked
// signature, the filing claim — against a real Postgres. The Jest suite fakes the model.
//
// Re-runnable, with one honest limit: a fixture has one card, and this spec signs its card
// off, so each run uses up one outstanding fixture in the local database. The seed plus
// tools/local-db/dev-fixtures.sql offer a dozen or more; `tools/local-db.sh load` restores
// them. The test says so if it runs out, rather than skipping.

const { test, expect } = require('@playwright/test');
const { readOnly } = require('./helpers/read-only');
const { query } = require('./helpers/db');

const WRITES = [/^\/live-scorecard$/, /^\/api\/live-scorecard\/\d+\/(players|games\/\d+|sign)$/];
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

async function phone(browser, baseURL) {
  const context = await browser.newContext(Object.assign({ baseURL }, PHONE));
  const page = await context.newPage();
  const guard = await readOnly(page, baseURL, { allowWrites: WRITES });
  return { context, page, guard };
}

async function pickPlayers(page) {
  await page.getByRole('tab', { name: 'Players' }).click();
  const slots = await page.locator('select[data-slot]').evaluateAll(els => els.map(e => e.getAttribute('data-slot')));
  for (const slot of slots) {
    const select = page.locator('select[data-slot="' + slot + '"]');
    // The first real player not already picked elsewhere on this side.
    const value = await select.evaluate(s => {
      const o = Array.prototype.find.call(s.options, x => x.value && x.value !== '0' && !x.disabled);
      return o ? o.value : '0';
    });
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/players') && r.request().method() === 'POST'),
      select.selectOption(value),
    ]);
  }
}

async function enterGame(page, n, h, a) {
  const row = page.locator('[data-game="' + n + '"]');
  await row.locator('input[data-side="h"]').fill(String(h));
  await row.locator('input[data-side="a"]').fill(String(a));
  await Promise.all([
    page.waitForResponse(r => r.url().endsWith('/games/' + n)),
    row.locator('input[data-side="a"]').press('Enter'),
  ]);
}

test.describe('live scorecard', () => {
  test.setTimeout(120000);

  test('two phones fill it in, two captains sign it, and it files a draft', async ({ browser, baseURL }) => {
    // ---- start a card ----
    const organiser = await phone(browser, baseURL);
    await organiser.page.goto('/live-scorecard');
    const start = organiser.page.getByRole('button', { name: 'Start card' }).first();
    expect(await start.count(), 'no outstanding fixture without a live card is left in the local '
      + 'database: run tools/local-db.sh load').toBeGreaterThan(0);
    await start.click();
    await expect(organiser.page).toHaveURL(/\/live-scorecard\/\d+\/share$/);
    await expect(organiser.page.locator('.live-qr svg')).toBeVisible();

    const playerLink = await organiser.page.locator('input[aria-label="Players\' link"]').inputValue();
    const homeLink = await organiser.page.getByRole('link', { name: 'Open as home captain' }).getAttribute('href');
    const awayLink = await organiser.page.getByRole('link', { name: 'Open as away captain' }).getAttribute('href');
    const cardId = Number(/live-scorecard\/(\d+)/.exec(organiser.page.url())[1]);
    // Absolute URLs are built for the public origin; drive this server with their paths.
    const local = url => { const u = new URL(url); return u.pathname + u.search; };

    // ---- two phones ----
    const a = await phone(browser, baseURL);
    const b = await phone(browser, baseURL);
    await a.page.goto(local(playerLink));
    await b.page.goto(local(playerLink));
    await expect(a.page.getByRole('tab', { name: 'Players' })).toHaveAttribute('aria-selected', 'true');

    await pickPlayers(a.page);
    await a.page.getByRole('tab', { name: 'Games' }).click();
    await b.page.getByRole('tab', { name: 'Games' }).click();

    // Phone A enters game 1; phone B sees it arrive on its poll, names included.
    await a.page.locator('[data-who]').fill('Courtside tester');
    await enterGame(a.page, 1, 21, 15);
    const bGame1 = b.page.locator('[data-game="1"]');
    await expect(bGame1.locator('input[data-side="h"]')).toHaveValue('21', { timeout: 10000 });
    await expect(bGame1.locator('[data-foot]')).toContainText('Courtside tester');
    await expect(bGame1.locator('[data-pair="home"]')).not.toHaveText(/Man 1/);
    await expect(b.page.locator('[data-tally="home"]')).toHaveText('1');

    // A bad score is refused on the phone, with the reason, and not sent.
    const g2 = a.page.locator('[data-game="2"]');
    await g2.locator('input[data-side="h"]').fill('21');
    await g2.locator('input[data-side="a"]').fill('20');
    await g2.locator('input[data-side="a"]').press('Enter');
    await expect(g2.locator('[data-foot]')).toContainText('two-point');

    for (let n = 2; n <= 18; n++) await enterGame(a.page, n, n % 2 ? 21 : 17, n % 2 ? 15 : 21);
    await expect(a.page.locator('[data-tally="played"]')).toHaveText('18');
    await expect(b.page.locator('[data-tally="played"]')).toHaveText('18', { timeout: 10000 });

    // ---- captains ----
    const home = await phone(browser, baseURL);
    const away = await phone(browser, baseURL);
    await home.page.goto(local(homeLink));
    await away.page.goto(local(awayLink));
    // A captain's link with a complete card opens on the signature.
    await expect(home.page.locator('[data-panel="sign"]')).toBeVisible();

    // A player's link has no Sign button.
    await a.page.getByRole('tab', { name: 'Sign off' }).click();
    await expect(a.page.getByRole('button', { name: /^Sign as/ })).toHaveCount(0);

    await home.page.getByRole('textbox', { name: 'Your name' }).fill('Home Captain');
    await home.page.getByRole('button', { name: /^Sign as home captain/ }).click();
    await expect(home.page.locator('[data-toast]')).toContainText('Waiting for the other captain');

    await away.page.getByRole('textbox', { name: 'Your name' }).fill('Away Captain');
    await away.page.getByRole('button', { name: /^Sign as away captain/ }).click();
    await expect(away.page.locator('[data-filed]')).toBeVisible();

    // Everyone else's phone finds out on its next poll.
    await expect(b.page.locator('[data-filed]')).toBeVisible({ timeout: 10000 });
    await expect(b.page.locator('[data-game="3"] input').first()).toBeDisabled();

    // ---- the draft ----
    const [card] = await query('SELECT status, draft_id, fixture_id FROM live_scorecard WHERE id = ?', [cardId]);
    expect(card.status).toBe('filed');
    const [draft] = await query(
      `SELECT s."homeTeam", s."awayTeam", s."Game1homeScore", s."Game1awayScore", s."Game18awayScore",
              s."homeMan1", s."FirstMixedhomeMan1", s."confirmToken", s.date = f.date AS samedate,
              s."homeTeam" = f."homeTeam" AS samehome
         FROM scorecardstore s JOIN fixture f ON f.id = ? WHERE s.id = ?`,
      [card.fixture_id, card.draft_id]);
    expect(draft).toMatchObject({ Game1homeScore: 21, Game1awayScore: 15, Game18awayScore: 21,
      samedate: true, samehome: true });
    expect(draft.FirstMixedhomeMan1).toBe(draft.homeMan1);
    expect(draft.confirmToken).toBeTruthy();

    for (const p of [organiser, a, b, home, away]) {
      p.guard.assertNoWrites();
      await p.context.close();
    }
  });
});

// The score rules, and the gate that stops a captain walking past a broken one.
//
// Confirmed with Neil: invalid scores must BLOCK the next step, not merely warn. That
// makes this a correctness behaviour rather than a nicety — the gate is the only thing
// standing between a mistyped score and a published result, and the `bad-totals` audit
// check exists because results that do not add up have reached the database before.
//
// None of it is reachable from the server. `validateGamePair` and the wrapper around
// `sendEvent` are page script; Jest renders the route with supertest and never runs them.

const { test, expect } = require('@playwright/test');
const { readOnly } = require('./helpers/read-only');

const MODAL = '#signupModal';

async function openWizard(page, baseURL) {
  const guard = await readOnly(page, baseURL);
  await page.goto('/scorecard-beta');
  await page.getByRole('link', { name: /Enter Result/i }).first().click();
  await expect(page.locator(MODAL).first()).toBeVisible();
  return guard;
}

// Steps 1-3 are fixture and teams and do not gate, so three Continues reach the first
// score step. The score inputs are NOT on step 1 — CLAUDE.md records this trap, and it is
// what made the first version of these tests time out on locator.fill: the input exists,
// it is simply not visible yet.
async function goToFirstScoreStep(page) {
  for (const from of [1, 2, 3]) {
    await page.locator(`button.step.step-${from}[onclick="sendEvent('${from + 1}')"]`).first().click();
  }
  await expect(page.locator('.modal-body.step-4').first()).toBeVisible();
}

// Type a pair into game 1 and read back what the captain is told.
async function scoreFeedback(page, home, away) {
  await page.locator('#Game1homeScore').first().fill(String(home));
  await page.locator('#Game1awayScore').first().fill(String(away));
  const fb = page.locator('#gameFeedback1').first();
  return (await fb.isVisible()) ? (await fb.textContent()).trim() : null;
}

// Asserting the MESSAGE, not just "invalid": a wrong-but-present message is the shape of
// bug this suite keeps finding, and a captain who cannot tell why cannot fix it.
test.describe('the score rules', function () {

  test('says which rule was broken, for each rule', async function ({ page, baseURL }) {
    const guard = await openWizard(page, baseURL);
    await goToFirstScoreStep(page);

    expect(await scoreFeedback(page, 15, 10)).toMatch(/at least 21/i);
    expect(await scoreFeedback(page, 21, 20)).toMatch(/at least 2 greater/i);
    expect(await scoreFeedback(page, 35, 10)).toMatch(/between 0 and 30/i);

    guard.assertNoWrites();
  });

  test('accepts a legal game, including 30-29 where the two-point rule stops applying',
    async function ({ page, baseURL }) {
      const guard = await openWizard(page, baseURL);
      await goToFirstScoreStep(page);

      expect(await scoreFeedback(page, 21, 15)).toBeNull();
      // Badminton caps at 30: 30-29 is a real scoreline and must not be rejected by the
      // difference-of-two rule.
      expect(await scoreFeedback(page, 30, 29)).toBeNull();

      guard.assertNoWrites();
    });
});

// Step 4 is the first score step and covers games 1 and 2.
test.describe('the gate on forward navigation', function () {

  test('will not advance from a score step while a game is empty', async function ({ page, baseURL }) {
    const guard = await openWizard(page, baseURL);
    await goToFirstScoreStep(page);

    await page.locator(`button.step.step-4[onclick="sendEvent('5')"]`).first().click();

    // Still on 4, and told why — an empty score is the commonest way to walk past a game.
    await expect(page.locator('.modal-body.step-4').first()).toBeVisible();
    await expect(page.locator('.modal-body.step-5').first()).toBeHidden();
    await expect(page.locator('#gameFeedback1').first()).toContainText(/enter a score/i);

    guard.assertNoWrites();
  });

  test('will not advance while a game breaks a rule', async function ({ page, baseURL }) {
    const guard = await openWizard(page, baseURL);
    await goToFirstScoreStep(page);

    // Game 1 legal, game 2 not. The gate checks BOTH games on the step, so one bad pair
    // must be enough to hold it — checking only the first would let this through.
    await page.locator('#Game1homeScore').first().fill('21');
    await page.locator('#Game1awayScore').first().fill('15');
    await page.locator('#Game2homeScore').first().fill('21');
    await page.locator('#Game2awayScore').first().fill('20');

    await page.locator(`button.step.step-4[onclick="sendEvent('5')"]`).first().click();

    await expect(page.locator('.modal-body.step-4').first()).toBeVisible();
    await expect(page.locator('#gameFeedback2').first()).toContainText(/at least 2 greater/i);

    guard.assertNoWrites();
  });

  test('advances once both games on the step are legal', async function ({ page, baseURL }) {
    const guard = await openWizard(page, baseURL);
    await goToFirstScoreStep(page);

    await page.locator('#Game1homeScore').first().fill('21');
    await page.locator('#Game1awayScore').first().fill('15');
    await page.locator('#Game2homeScore').first().fill('19');
    await page.locator('#Game2awayScore').first().fill('21');

    await page.locator(`button.step.step-4[onclick="sendEvent('5')"]`).first().click();

    // The other half of the gate: it must not become a wall. A rule that blocks a legal
    // card is worse than no rule, because the captain has no way past it.
    await expect(page.locator('.modal-body.step-5').first()).toBeVisible();
    await expect(page.locator('.modal-body.step-4').first()).toBeHidden();

    guard.assertNoWrites();
  });
});

// Walking the whole wizard, and the totals it derives at the end.
//
// Neil's rule is that a total which is not 18 must be prevented. It is — but structurally
// rather than by a check, and that is worth pinning down because it is not obvious from
// reading either half on its own:
//
//   the gate refuses to leave any score step until both its games are legal, so all 18
//   games must be filled to reach the summary at all; and step 14 then DERIVES
//   #homeScore / #awayScore by counting game wins rather than asking anyone to type them.
//
// Those two together are what make 18 guaranteed. The derived pair is also what gets
// posted and written onto the fixture, so if the count is ever wrong the result is wrong
// — and `bad-totals` in the audit checks exists because results that do not add up have
// reached the database before.
test.describe('the summary', function () {
  test('derives the match score from the games, and it totals 18', async function ({ page, baseURL }) {
    test.slow(); // nine score steps, eighteen games
    const guard = await openWizard(page, baseURL);
    await goToFirstScoreStep(page);

    // Home wins 11, away wins 7 — an ordinary league scoreline, and deliberately not a
    // whitewash, so a count that ignored the loser would still have to get this right.
    const homeWins = 11;
    for (let step = 4; step <= 12; step++) {
      const games = [(step - 4) * 2 + 1, (step - 4) * 2 + 2];
      for (const n of games) {
        const homeWon = n <= homeWins;
        await page.locator(`#Game${n}homeScore`).first().fill(homeWon ? '21' : '15');
        await page.locator(`#Game${n}awayScore`).first().fill(homeWon ? '15' : '21');
      }
      await page.locator(`button.step.step-${step}[onclick="sendEvent('${step + 1}')"]`).first().click();
    }

    // Reaching step 13 at all is the structural half: the gate let us through only
    // because every one of the eighteen games is legal.
    await expect(page.locator('.modal-body.step-13').first()).toBeVisible();
    await page.locator(`button.step.step-13[onclick="sendEvent('14')"]`).first().click();
    await expect(page.locator('.modal-body.step-14').first()).toBeVisible();

    // The derived pair, which is what the form posts.
    await expect(page.locator('#homeScore').first()).toHaveValue(String(homeWins));
    await expect(page.locator('#awayScore').first()).toHaveValue(String(18 - homeWins));

    const home = Number(await page.locator('#homeScore').first().inputValue());
    const away = Number(await page.locator('#awayScore').first().inputValue());
    expect(home + away).toBe(18);

    guard.assertNoWrites();
  });
});

// The messer card's score rules and the gate that enforces them — the 15-game half of
// e2e/scorecard-wizard.spec.js.
//
// Messer is the league card's near-twin, which is exactly why it needs its own copy of
// these: the two views drift, and every difference between them is a rule a captain
// cannot guess. Two of them were wrong when this file was written (HARD-28):
//
//   * there was NO GATE. The league card got one in May 2026; messer got the inline
//     feedback and not the wrapper around sendEvent, so every rule it stated was
//     advisory. Walking past an empty game is not a cosmetic failure here — step 14
//     derives the match score with `value * 1`, so a blank pair reads 0-0, `0 > 0` is
//     false, and it is counted as an AWAY win. A card filed with six games missing
//     submits as a real-looking scoreline.
//
//   * the range message said "between 0 and 30" while the inputs carry min="-10" and the
//     server validates -10..30. Messer is handicapped — a side can finish below zero —
//     so the one rule a messer captain cannot guess was the one the form stated wrongly.
//
// None of this is reachable from the server: `validateGamePair` and the sendEvent wrapper
// are page script, and Jest renders the route with supertest without running either.

const { test, expect } = require('@playwright/test');
const { readOnly } = require('./helpers/read-only');

const MODAL = '#signupModal';

async function openWizard(page, baseURL) {
  const guard = await readOnly(page, baseURL);
  await page.goto('/messer-scorecard-beta');
  await page.getByRole('link', { name: /Enter Result/i }).first().click();
  await expect(page.locator(MODAL).first()).toBeVisible();
  return guard;
}

// Steps 1-3 are fixture, home team and away team; none of them gate, so three Continues
// reach the first score step. As on the league card the score inputs are not on step 1 —
// they exist in the DOM from the start but are not visible, which is what makes a
// locator.fill on them hang rather than fail.
async function goToFirstScoreStep(page) {
  for (const from of [1, 2, 3]) {
    await page.locator(`button.step.step-${from}[onclick="sendEvent('${from + 1}')"]`).first().click();
  }
  await expect(page.locator('.modal-body.step-4').first()).toBeVisible();
}

async function scoreFeedback(page, game, home, away) {
  await page.locator(`#Game${game}homeScore`).first().fill(String(home));
  await page.locator(`#Game${game}awayScore`).first().fill(String(away));
  const fb = page.locator(`#gameFeedback${game}`).first();
  return (await fb.isVisible()) ? (await fb.textContent()).trim() : null;
}

async function fillGame(page, n, home, away) {
  await page.locator(`#Game${n}homeScore`).first().fill(String(home));
  await page.locator(`#Game${n}awayScore`).first().fill(String(away));
}

test.describe('the messer score rules', function () {

  test('states the handicapped range, not the league one', async function ({ page, baseURL }) {
    const guard = await openWizard(page, baseURL);
    await goToFirstScoreStep(page);

    // The message has to name the rule the form actually enforces, because -10 is the
    // whole point of a handicapped competition and nothing else on the page says so.
    expect(await scoreFeedback(page, 1, -11, 21)).toMatch(/between -10 and 30/i);
    expect(await scoreFeedback(page, 1, 21, 31)).toMatch(/between -10 and 30/i);
    // And a real handicapped scoreline is not an error.
    expect(await scoreFeedback(page, 1, -5, 21)).toBeNull();

    guard.assertNoWrites();
  });

  test('says which other rule was broken', async function ({ page, baseURL }) {
    const guard = await openWizard(page, baseURL);
    await goToFirstScoreStep(page);

    expect(await scoreFeedback(page, 1, 15, 10)).toMatch(/at least 21/i);
    // Messer's own margin rule: 1, not the league's 2. A 21-20 is a legal messer game.
    expect(await scoreFeedback(page, 1, 21, 21)).toMatch(/at least 1 greater/i);
    expect(await scoreFeedback(page, 1, 21, 20)).toBeNull();

    guard.assertNoWrites();
  });
});

test.describe('the messer gate on forward navigation', function () {

  test('will not advance from a score step while a game is empty', async function ({ page, baseURL }) {
    const guard = await openWizard(page, baseURL);
    await goToFirstScoreStep(page);

    await page.locator(`button.step.step-4[onclick="sendEvent('5')"]`).first().click();

    await expect(page.locator('.modal-body.step-4').first()).toBeVisible();
    await expect(page.locator('.modal-body.step-5').first()).toBeHidden();
    await expect(page.locator('#gameFeedback1').first()).toContainText(/enter a score/i);

    guard.assertNoWrites();
  });

  test('will not advance while a game breaks a rule', async function ({ page, baseURL }) {
    const guard = await openWizard(page, baseURL);
    await goToFirstScoreStep(page);

    // Game 1 legal, game 2 not: the gate has to check both games on the step, or the
    // second of every pair goes unchecked.
    await fillGame(page, 1, 21, 15);
    await fillGame(page, 2, 21, 21);

    await page.locator(`button.step.step-4[onclick="sendEvent('5')"]`).first().click();

    await expect(page.locator('.modal-body.step-4').first()).toBeVisible();
    await expect(page.locator('#gameFeedback2').first()).toContainText(/at least 1 greater/i);

    guard.assertNoWrites();
  });

  test('advances once both games on the step are legal', async function ({ page, baseURL }) {
    const guard = await openWizard(page, baseURL);
    await goToFirstScoreStep(page);

    await fillGame(page, 1, 21, 15);
    await fillGame(page, 2, -3, 21);   // handicapped, and legal

    await page.locator(`button.step.step-4[onclick="sendEvent('5')"]`).first().click();

    // The other half: a gate that blocks a legal card is worse than no gate, because
    // there is no way past it.
    await expect(page.locator('.modal-body.step-5').first()).toBeVisible();
    await expect(page.locator('.modal-body.step-4').first()).toBeHidden();

    guard.assertNoWrites();
  });

  // Messer's three mixed steps carry ONE game where the other six carry two. A gate that
  // assumed pairs — the shape the league card's hardcoded map has — would either skip
  // these three steps or look for a game that is not on them.
  test('gates a mixed step, which holds a single game', async function ({ page, baseURL }) {
    const guard = await openWizard(page, baseURL);
    await goToFirstScoreStep(page);

    // Walk to step 10 (1st Mixed, game 13) filling everything legally.
    for (let step = 4; step <= 9; step++) {
      const first = (step - 4) * 2 + 1;
      await fillGame(page, first, 21, 15);
      await fillGame(page, first + 1, 21, 15);
      await page.locator(`button.step.step-${step}[onclick="sendEvent('${step + 1}')"]`).first().click();
    }
    await expect(page.locator('.modal-body.step-10').first()).toBeVisible();

    // Empty: held.
    await page.locator(`button.step.step-10[onclick="sendEvent('11')"]`).first().click();
    await expect(page.locator('.modal-body.step-10').first()).toBeVisible();
    await expect(page.locator('#gameFeedback13').first()).toContainText(/enter a score/i);

    // Filled: through.
    await fillGame(page, 13, 21, 19);
    await page.locator(`button.step.step-10[onclick="sendEvent('11')"]`).first().click();
    await expect(page.locator('.modal-body.step-11').first()).toBeVisible();

    guard.assertNoWrites();
  });

  // Back must never be gated, or a captain who mistyped a score two steps ago is stuck
  // with it.
  test('lets a captain go back from a step it is holding', async function ({ page, baseURL }) {
    const guard = await openWizard(page, baseURL);
    await goToFirstScoreStep(page);

    await page.locator(`button.step.step-4[onclick="sendEvent('3')"]`).first().click();
    await expect(page.locator('.modal-body.step-3').first()).toBeVisible();

    guard.assertNoWrites();
  });
});

// What the gate is actually protecting: the derived match score.
//
// Step 14 counts wins by comparing the two inputs of each pair, so every unfilled game is
// an away win. The gate is the only thing standing between that and a submitted card —
// there is no "all 15 games present" check anywhere, on either side of the wire.
test.describe('the messer summary', function () {
  test('derives the match score from fifteen games, all of which had to be filled',
    async function ({ page, baseURL }) {
      test.slow(); // nine score steps
      const guard = await openWizard(page, baseURL);
      await goToFirstScoreStep(page);

      // Home wins 9 of 15. Deliberately not a whitewash: a count that ignored the loser
      // would still have to get this right.
      const homeWins = 9;
      const games = { 4: [1, 2], 5: [3, 4], 6: [5, 6], 7: [7, 8], 8: [9, 10], 9: [11, 12],
                      10: [13], 11: [14], 12: [15] };
      for (let step = 4; step <= 12; step++) {
        for (const n of games[step]) {
          const homeWon = n <= homeWins;
          await fillGame(page, n, homeWon ? 21 : 15, homeWon ? 15 : 21);
        }
        await page.locator(`button.step.step-${step}[onclick="sendEvent('${step + 1}')"]`).first().click();
      }

      // Reaching step 13 at all is the structural half: the gate let us past nine steps
      // only because all fifteen games are legal.
      await expect(page.locator('.modal-body.step-13').first()).toBeVisible();
      await page.locator(`button.step.step-13[onclick="sendEvent('14')"]`).first().click();
      await expect(page.locator('.modal-body.step-14').first()).toBeVisible();

      await expect(page.locator('#homeScore').first()).toHaveValue(String(homeWins));
      await expect(page.locator('#awayScore').first()).toHaveValue(String(15 - homeWins));

      const home = Number(await page.locator('#homeScore').first().inputValue());
      const away = Number(await page.locator('#awayScore').first().inputValue());
      // 15, not 18 — the count that is posted and written against the messer match.
      expect(home + away).toBe(15);

      guard.assertNoWrites();
    });
});

// Filing a result on a phone (HARD-34).
//
// Captains file results on a phone, standing in a sports hall at ten o'clock at night. That
// is the primary device for this flow, and until this file every scorecard spec ran at the
// desktop project's 1280px — so "the captain is told why Continue did nothing" meant "would
// be told, on a laptop". roster-edit.spec.js's phone describe is the precedent: that page
// bound dragstart/drop, which touch never fires, and nothing on it worked on a phone while
// every test passed.
//
// Everything here TAPS rather than clicks, and types rather than fills, so the events are
// the ones a phone produces.
//
// What was measured when this was written (Sep 2026), so a later failure has something to
// be compared against:
//
//   * Nothing scrolls sideways at 375, 390 or with the keyboard up, on any of the fourteen
//     steps of either card.
//   * The gate's feedback is safe BY LAYOUT, not by any scrolling code: the score row is the
//     last thing in every score step, so #gameFeedbackN is inserted directly above the
//     footer — about 90px above Continue. Whenever Continue is on screen, so is the reason
//     it did nothing. Move the score row up the step, or put anything between it and the
//     footer, and that stops being true; the gate tests below are what will say so.
//   * The one defect: the league inputs were `type="number"` with no `inputmode`, which on
//     iOS opens the full keyboard in its numbers layout rather than the digit pad. Fixed.
//     Messer deliberately does NOT get the same fix — see its test.
//
// THIS SPEC WRITES, in exactly one test, and says so: the league walk ends by POSTing
// /email-scorecard, which files one draft into `scorecardstore` — the same single row
// scorecard-submit.spec.js leaves, for the same reasons given there. It is declared with
// `allowWrites`; every other test here is read-only. The messer walk stops at the summary:
// its POST files a messer draft, and a second writing spec for the same layout question
// would add a row without adding an answer.

const { test, expect } = require('@playwright/test');
const { readOnly } = require('./helpers/read-only');
const { selectableValues } = require('./helpers/selects');
const { query, outstandingFixture } = require('./helpers/db');

const MODAL = '#signupModal';
const PHONE = { width: 390, height: 844 };

// Two more shapes the gate has to survive. 375x667 is the small iPhone that is still in
// plenty of pockets. 390x500 approximates the same phone with its keyboard up (~340px):
// emulation cannot raise a real keyboard, so this shrinks the viewport to what is left —
// an approximation, but the one that matters, because the captain has just typed a score
// when they reach for Continue.
const GATE_VIEWPORTS = [
  { name: 'a phone', viewport: PHONE },
  { name: 'a small phone', viewport: { width: 375, height: 667 } },
  { name: 'a phone with the keyboard up', viewport: { width: 390, height: 500 } },
];

const CARDS = {
  league: {
    path: '/email-scorecard',
    games: { 4: [1, 2], 5: [3, 4], 6: [5, 6], 7: [7, 8], 8: [9, 10], 9: [11, 12],
             10: [13, 14], 11: [15, 16], 12: [17, 18] },
  },
  messer: {
    path: '/messer-scorecard-beta',
    games: { 4: [1, 2], 5: [3, 4], 6: [5, 6], 7: [7, 8], 8: [9, 10], 9: [11, 12],
             10: [13], 11: [14], 12: [15] },
  },
};

async function openWizard(page, path) {
  await page.goto(path);
  // The messer view includes a dev-only debug panel (views/partials/debugPanel.ejs,
  // rendered when DEV_MODE is set, which this suite's server always is). It is fixed to the
  // bottom right at 400px wide — wider than the phone — and sits over the footer buttons,
  // so a tap on Continue lands on it. It is not part of what a captain sees.
  await page.addStyleTag({ content: '#devDebugPanel { display: none !important; }' });
  await page.getByRole('link', { name: /Enter Result/i }).first().tap();
  await expect(page.locator(MODAL).first()).toBeVisible();
}

function continueButton(page, step) {
  return page.locator(`button.step.step-${step}[onclick="sendEvent('${step + 1}')"]`).first();
}

// Sideways scroll, measured two ways: the page, and the modal — which is its own scroll
// container, so a step too wide for it scrolls inside the modal while the page reports 0.
// Plus any visible control whose right edge is past the viewport, which is what a clipped
// input looks like when neither scrolls.
async function sidewaysOverflow(page) {
  return page.evaluate(function (sel) {
    const de = document.documentElement;
    const modal = document.querySelector(sel);
    const clipped = Array.from(modal.querySelectorAll('input, select, button, label'))
      .filter(function (el) {
        if (!el.offsetParent) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.left < -1 || r.right > de.clientWidth + 1);
      })
      .map(function (el) { return el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''); });
    return {
      page: de.scrollWidth - de.clientWidth,
      modal: modal.scrollWidth - modal.clientWidth,
      clipped: clipped,
    };
  }, MODAL);
}

async function expectNoSidewaysScroll(page, step) {
  const o = await sidewaysOverflow(page);
  expect(o.page, `step ${step}: the page scrolls sideways`).toBeLessThanOrEqual(1);
  expect(o.modal, `step ${step}: the modal scrolls sideways`).toBeLessThanOrEqual(1);
  expect(o.clipped, `step ${step}: controls past the edge of the screen`).toEqual([]);
}

// Type a score the way a thumb does: tap the box, type the digits. Then check the box is
// still on screen — a step that jumps as the captain types is the "scrolls out from under
// the finger" failure.
async function typeScore(page, id, value) {
  const input = page.locator('#' + id).first();
  await input.tap();
  await page.keyboard.type(String(value));
  await expect(input, `${id} moved off screen while being typed into`).toBeInViewport({ ratio: 1 });
}

async function chooseFixture(page, fixture) {
  await page.locator('#division').first().selectOption(fixture.division);
  await expect
    .poll(async () => (await selectableValues(page.locator('#homeTeam').first())).length,
          { message: 'teams should arrive from POST /teams', timeout: 10000 })
    .toBeGreaterThan(1);
  await page.locator('#homeTeam').first().selectOption(fixture.homeTeam);
  await page.locator('#awayTeam').first().selectOption(fixture.awayTeam);
  await page.locator('#date').first().fill(fixture.date);
}

// Three men and three ladies, all different — the form refuses a player used twice.
async function chooseSquad(page, side) {
  for (const group of [['Man1', 'Man2', 'Man3'], ['Lady1', 'Lady2', 'Lady3']]) {
    const sel = page.locator(`#${side}${group[0]}`).first();
    await expect
      .poll(async () => (await selectableValues(sel)).length,
            { message: `${side} ${group[0]} should be populated`, timeout: 10000 })
      .toBeGreaterThan(2);
    const people = await selectableValues(sel);
    for (let i = 0; i < group.length; i++) {
      await page.locator(`#${side}${group[i]}`).first().selectOption(people[i]);
    }
  }
}

// Steps 4-12, every game filled legally, checking the layout on each step as it goes.
async function walkScoreSteps(page, games, homeWins) {
  for (let step = 4; step <= 12; step++) {
    await expect(page.locator(`.modal-body.step-${step}`).first()).toBeVisible();
    for (const n of games[step]) {
      const homeWon = n <= homeWins;
      await typeScore(page, `Game${n}homeScore`, homeWon ? 21 : 15);
      await typeScore(page, `Game${n}awayScore`, homeWon ? 15 : 21);
    }
    await expectNoSidewaysScroll(page, step);
    await continueButton(page, step).tap();
  }
  await expect(page.locator('.modal-body.step-13').first()).toBeVisible();
  await expectNoSidewaysScroll(page, 13);
  await continueButton(page, 13).tap();
  await expect(page.locator('.modal-body.step-14').first()).toBeVisible();
  await expectNoSidewaysScroll(page, 14);
}

test.describe('filing a result on a phone', function () {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test('the league card walks all fourteen steps to a filed draft, and none scrolls sideways',
    async function ({ page, baseURL }) {
      test.slow();                    // eighteen games, typed, through fourteen steps
      const guard = await readOnly(page, baseURL, { allowWrites: [/^\/email-scorecard$/] });

      const fixture = await outstandingFixture();
      test.skip(!fixture, 'no outstanding fixture — load tools/local-db/dev-fixtures.sql');
      const before = (await query('SELECT COALESCE(MAX(id), 0) AS max FROM scorecardstore'))[0].max;

      await openWizard(page, CARDS.league.path);

      await expectNoSidewaysScroll(page, 1);
      await chooseFixture(page, fixture);
      await continueButton(page, 1).tap();

      await expectNoSidewaysScroll(page, 2);
      await chooseSquad(page, 'home');
      await continueButton(page, 2).tap();

      await expectNoSidewaysScroll(page, 3);
      await chooseSquad(page, 'away');
      await continueButton(page, 3).tap();

      await walkScoreSteps(page, CARDS.league.games, 11);

      const submit = page.locator('#signup').first();
      await Promise.all([
        page.waitForURL(/\/populated-scorecard-beta\/\d+/, { timeout: 20000 }),
        submit.tap(),
      ]);

      // Filed, and filed with what was typed on the phone — read back from the table, not
      // inferred from the redirect.
      const id = Number(new URL(page.url()).pathname.split('/').pop());
      expect(id).toBeGreaterThan(before);
      const rows = await query(
        `SELECT "homeTeam", "Game1homeScore", "Game18awayScore" FROM scorecardstore WHERE id = ?`,
        [id]);
      expect(rows).toHaveLength(1);
      expect(String(rows[0].homeTeam)).toBe(fixture.homeTeam);
      expect(String(rows[0].Game1homeScore)).toBe('21');
      expect(String(rows[0].Game18awayScore)).toBe('21');

      // And the page the captain lands on fits the phone too.
      await expect(page.locator('body')).toContainText(/Scorecard received/);
      const landed = await page.evaluate(function () {
        return document.documentElement.scrollWidth - document.documentElement.clientWidth;
      });
      expect(landed, 'the confirmation page scrolls sideways').toBeLessThanOrEqual(1);

      expect(guard.writes).toEqual(['POST /email-scorecard']);
      guard.assertNoWrites();
    });

  // Steps 1-3 are fixture and squads; they need no choices to pass on the messer card, and
  // the question here is layout, so the walk goes straight through them.
  test('the messer card walks all fourteen steps, and none scrolls sideways',
    async function ({ page, baseURL }) {
      test.slow();
      const guard = await readOnly(page, baseURL);
      await openWizard(page, CARDS.messer.path);

      for (const step of [1, 2, 3]) {
        await expectNoSidewaysScroll(page, step);
        await continueButton(page, step).tap();
      }
      await walkScoreSteps(page, CARDS.messer.games, 9);

      guard.assertNoWrites();
    });

  // `type="number"` alone gives iOS its full keyboard switched to the numbers-and-symbols
  // layout: small keys, and letters one tap away. `inputmode="numeric"` gives the 0-9 pad.
  // Android's keypad for type=number is already a digit pad, so this is the iOS half.
  test('the league score boxes ask for the digit pad', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);
    await openWizard(page, CARDS.league.path);

    const boxes = page.locator(`${MODAL} input.scoreInput`);
    await expect(boxes).toHaveCount(36);
    const wrong = await boxes.evaluateAll(function (els) {
      return els.filter(function (e) {
        return e.type !== 'number' || e.getAttribute('inputmode') !== 'numeric';
      }).map(function (e) { return e.id; });
    });
    expect(wrong, 'score boxes without type=number + inputmode=numeric').toEqual([]);

    guard.assertNoWrites();
  });

  // The opposite rule, and the reason the league fix was not copied across. Messer is
  // handicapped and a side can finish below zero (min="-10"). iOS's `numeric` and `decimal`
  // pads have NO MINUS KEY, so the same attribute here would make a negative score
  // impossible to type on an iPhone — while every desktop test went on passing.
  // Plain type=number keeps the numbers-and-symbols keyboard, which has one.
  test('the messer score boxes keep a keyboard with a minus sign', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);
    await openWizard(page, CARDS.messer.path);

    const boxes = page.locator(`${MODAL} input.scoreInput`);
    await expect(boxes).toHaveCount(30);
    const wrong = await boxes.evaluateAll(function (els) {
      return els.filter(function (e) {
        const mode = e.getAttribute('inputmode');
        return e.type !== 'number' || mode === 'numeric' || mode === 'decimal'
          || Number(e.min) >= 0;
      }).map(function (e) { return e.id; });
    });
    expect(wrong, 'messer score boxes that could not take a negative score on iOS').toEqual([]);

    guard.assertNoWrites();
  });

  // What decides whether a phone offers the camera is `accept` and `capture`. `image/*` in
  // accept is what makes iOS and Android list "Take Photo" at all. `capture` must be ABSENT:
  // it forces the camera and removes the photo library, and a captain who photographed the
  // card at the end of the match — the usual order — could then not pick that photo.
  // scorecard.spec.js asserts the desktop half (that the document types are listed).
  for (const [card, ids] of [['league', ['scorecardPhoto', 'scoresheet-spreadsheet']],
                             ['messer', ['scoresheet-spreadsheet']]]) {
    test(`the ${card} card's file pickers offer the camera and the photo library`,
      async function ({ page, baseURL }) {
        const guard = await readOnly(page, baseURL);
        await openWizard(page, CARDS[card].path);

        for (const id of ids) {
          const input = page.locator(`${MODAL} #${id}`).first();
          await expect(input).toHaveCount(1);
          const accept = (await input.getAttribute('accept')) || '';
          expect(accept.split(',').map(s => s.trim()), `#${id} accept`).toContain('image/*');
          expect(await input.getAttribute('capture'), `#${id} must not force the camera`)
            .toBeNull();
        }

        guard.assertNoWrites();
      });
  }
});

// A blocked Continue whose reason is off screen looks like a dead button — the failure mode
// is "nothing happens", which is the worst one there is. So: the reason AND the button
// that was just pressed must both be in the viewport, with no scroll in between.
for (const { name, viewport } of GATE_VIEWPORTS) {
  test.describe(`the gate on ${name} (${viewport.width}x${viewport.height})`, function () {
    test.use({ viewport, hasTouch: true, isMobile: true });

    for (const card of ['league', 'messer']) {
      test(`the ${card} card's blocked Continue leaves its reason on screen`,
        async function ({ page, baseURL }) {
          const guard = await readOnly(page, baseURL);
          await openWizard(page, CARDS[card].path);
          for (const step of [1, 2, 3]) await continueButton(page, step).tap();
          await expect(page.locator('.modal-body.step-4').first()).toBeVisible();

          // Game 1 legal, game 2 left empty — the commonest way to walk past a game, and
          // the one the keyboard makes likeliest: the captain types the last box and goes.
          await typeScore(page, 'Game1homeScore', 21);
          await typeScore(page, 'Game1awayScore', 15);
          await typeScore(page, 'Game2homeScore', 21);

          const next = continueButton(page, 4);
          await next.tap();

          await expect(page.locator('.modal-body.step-4').first()).toBeVisible();
          const reason = page.locator('#gameFeedback2').first();
          await expect(reason).toContainText(/enter a score/i);
          // ratio 1: wholly on screen. The default passes on a one-pixel sliver, and did —
          // with 400px planted between the reason and the button, on the 500px viewport.
          await expect(reason, 'the reason Continue did nothing is off screen')
            .toBeInViewport({ ratio: 1 });
          // Continue only has to be PARTLY on screen, and that is measured rather than
          // generous: the reason is a new line of text, so revealing it pushes the footer
          // down ~46px after the tap. With the keyboard up (390x500) that leaves Continue
          // half below the fold — the captain's finger is on a button that has just moved.
          // Recorded in HARD-34 rather than fixed; what matters is that the reason is
          // wholly visible, and a button that has gone entirely is still caught here.
          await expect(next, 'Continue and its reason are not on screen together')
            .toBeInViewport();

          guard.assertNoWrites();
        });
    }
  });
}

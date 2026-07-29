// Browser coverage for the team-management editor.
//
// This is the layer that mattered most in the rewrite and the one Jest cannot
// reach. The page it replaced bound only dragstart/dragover/drop, so nothing on it
// worked on a touchscreen; its Move Up / Move Down menu items were bound by
// position (`button:nth-child(1)` and `(2)`) and items 3 and 4 never got a
// listener at all. Both of those are JavaScript-only failures — the server-side
// tests were perfectly happy.
//
// READ-ONLY. dev.env carries the same DATABASE_URL as .env, so this is talking to
// the production database. Reordering here only moves DOM nodes; nothing is written
// until Save, which these tests never press. The network guard aborts any mutating
// request and assertNoWrites() fails the test if one was attempted, so "we didn't
// save" is enforced rather than assumed.

const { test, expect } = require('@playwright/test');
const { readOnly } = require('./helpers/read-only');

// Any club with enough players to reorder. Resolved once from the picker rather
// than hardcoded, so the suite doesn't depend on one club's roster staying put.
async function openBiggestClubEditor(page) {
  await page.goto('/manage-players');
  const rows = page.locator('table tbody tr');
  await expect(rows.first()).toBeVisible();

  const target = await rows.evaluateAll(function (trs) {
    let best = null;
    for (const tr of trs) {
      const link = tr.querySelector('a[href^="/manage-players/club-"]');
      const players = parseInt(tr.children[2] && tr.children[2].textContent, 10) || 0;
      if (!link) continue;
      if (!best || players > best.players) {
        best = { href: link.getAttribute('href'), players: players };
      }
    }
    return best;
  });

  expect(target, 'no club with players found on the picker').not.toBeNull();
  await page.goto(target.href + '/edit');
  await expect(page.locator('.roster-card').first()).toBeVisible();
}

// The first list on the page holding at least `n` players.
function listWithAtLeast(page, n) {
  return page.locator('.roster-list').filter({ has: page.locator('.roster-row') }).filter({
    has: page.locator(`.roster-row:nth-child(${n})`)
  }).first();
}

async function namesIn(list) {
  return list.locator('.roster-row .player-name').allTextContents();
}

async function ranksIn(list) {
  return list.locator('.roster-row .rank').allTextContents();
}

test.describe('roster editor', () => {
  test('renders one card per team with numbered lists', async ({ page, baseURL }) => {
    const guard = await readOnly(page, baseURL);
    await openBiggestClubEditor(page);

    const cards = page.locator('.roster-card');
    expect(await cards.count()).toBeGreaterThan(0);

    // Four lists per card: nominated and reserve, men and ladies. Ranks are per
    // (team, gender), so a team's number 1 man and number 1 lady both show as 1.
    const firstCard = cards.first();
    await expect(firstCard.locator('.roster-list')).toHaveCount(4);

    // The rank is on screen at all — the old page held it only in a data attribute.
    const list = listWithAtLeast(page, 2);
    expect(await ranksIn(list)).toEqual(expect.arrayContaining(['1', '2']));

    guard.assertNoWrites();
  });

  test('the save bar is hidden until something moves', async ({ page, baseURL }) => {
    const guard = await readOnly(page, baseURL);
    await openBiggestClubEditor(page);
    await expect(page.locator('#roster-savebar')).toBeHidden();
    guard.assertNoWrites();
  });

  // The headline fix. Pointer events cover mouse, touch and pen from one path;
  // Playwright's mouse drives them the same way a real pointer does.
  test('dragging a handle reorders the list and renumbers it', async ({ page, baseURL }) => {
    const guard = await readOnly(page, baseURL);
    await openBiggestClubEditor(page);

    const list = listWithAtLeast(page, 2);
    const before = await namesIn(list);

    const firstHandle = list.locator('.roster-row').first().locator('.drag-handle');
    const secondRow = list.locator('.roster-row').nth(1);

    const from = await firstHandle.boundingBox();
    const to = await secondRow.boundingBox();

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    // Two moves: the first starts the drag, the second carries the row past the
    // midpoint of the row below it.
    await page.mouse.move(from.x + from.width / 2, to.y + to.height / 2 + 4, { steps: 8 });
    await page.mouse.up();

    const after = await namesIn(list);
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);

    // Renumbered in place, so the top of the list is still 1.
    const ranks = await ranksIn(list);
    expect(ranks[0]).toBe('1');
    expect(ranks[1]).toBe('2');

    // And it is only a pending change until Save.
    await expect(page.locator('#roster-savebar')).toBeVisible();
    await expect(page.locator('#roster-savebar-msg')).toContainText('moved');

    guard.assertNoWrites();
  });

  // Move Up / Move Down were the only non-drag path on the old page and they had
  // no handlers at all, which is why there was no keyboard or touch fallback.
  test('the arrow keys reorder from a focused handle', async ({ page, baseURL }) => {
    const guard = await readOnly(page, baseURL);
    await openBiggestClubEditor(page);

    const list = listWithAtLeast(page, 2);
    const before = await namesIn(list);

    await list.locator('.roster-row').first().locator('.drag-handle').focus();
    await page.keyboard.press('ArrowDown');

    const after = await namesIn(list);
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);

    // Focus follows the row so the key can be pressed again.
    await page.keyboard.press('ArrowUp');
    expect(await namesIn(list)).toEqual(before);

    // Back where it started, so there is nothing to save.
    await expect(page.locator('#roster-savebar')).toBeHidden();

    guard.assertNoWrites();
  });

  test('the row menu opens and its move items work', async ({ page, baseURL }) => {
    const guard = await readOnly(page, baseURL);
    await openBiggestClubEditor(page);

    const list = listWithAtLeast(page, 2);
    const before = await namesIn(list);

    await list.locator('.roster-row').first().locator('.row-menu-btn').click();
    const menu = page.locator('.roster-menu');
    await expect(menu).toBeVisible();

    // Every item is wired, including the two that never were.
    await expect(menu.getByRole('button', { name: 'Move up' })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Move down' })).toBeVisible();
    await expect(menu.getByRole('button', { name: /Make reserve|Make nominated/ })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Move to another team…' })).toBeVisible();

    // Move up is disabled at the top of a nominated list rather than silently
    // doing nothing.
    await expect(menu.getByRole('button', { name: 'Move up' })).toBeDisabled();

    await menu.getByRole('button', { name: 'Move down' }).click();
    const after = await namesIn(list);
    expect(after[0]).toBe(before[1]);

    guard.assertNoWrites();
  });

  test('Discard puts everything back', async ({ page, baseURL }) => {
    const guard = await readOnly(page, baseURL);
    await openBiggestClubEditor(page);

    const list = listWithAtLeast(page, 2);
    const before = await namesIn(list);

    await list.locator('.roster-row').first().locator('.drag-handle').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#roster-savebar')).toBeVisible();

    await page.locator('#roster-discard').click();
    expect(await namesIn(list)).toEqual(before);
    await expect(page.locator('#roster-savebar')).toBeHidden();

    guard.assertNoWrites();
  });

  // Three labelled outcomes instead of one Add button that chose between them by
  // reading a property it had set on an <option> element.
  test('the add dialog separates creating, adopting and transferring', async ({ page, baseURL }) => {
    const guard = await readOnly(page, baseURL);
    await openBiggestClubEditor(page);

    await page.locator('.roster-add-btn').first().click();
    const modal = page.locator('#rosterAddModal');
    await expect(modal).toBeVisible();

    // Creating is always available, and clearly its own action.
    await expect(modal.locator('#rosterCreateBtn')).toBeVisible();

    // A surname common enough to match somewhere in the league. The search is a
    // GET, so it is allowed through the guard.
    await modal.locator('#rosterAddSearch').fill('an');
    await modal.locator('#rosterAddSearchBtn').click();

    const results = modal.locator('#rosterAddResults');
    await expect(results.locator('.result-group')).toHaveCount(2);
    await expect(results).toContainText('Registered to no club');
    await expect(results).toContainText('Already at another club');

    guard.assertNoWrites();
  });

  test('the move dialog offers the club other teams', async ({ page, baseURL }) => {
    const guard = await readOnly(page, baseURL);
    await openBiggestClubEditor(page);

    const list = listWithAtLeast(page, 1);
    await list.locator('.roster-row').first().locator('.row-menu-btn').click();
    await page.locator('.roster-menu').getByRole('button', { name: 'Move to another team…' }).click();

    const modal = page.locator('#rosterMoveModal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('#rosterMoveTeam')).toBeVisible();
    await expect(modal.locator('#rosterMoveSection')).toBeVisible();

    // Defaults to a team other than the one the player is already in.
    const card = list.locator('xpath=ancestor::div[contains(@class,"roster-card")]');
    const currentTeam = await card.getAttribute('data-team-id');
    expect(await modal.locator('#rosterMoveTeam').inputValue()).not.toBe(currentTeam);

    await modal.getByRole('button', { name: 'Cancel' }).click();
    guard.assertNoWrites();
  });
});

test.describe('roster editor on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  // The layout finding: `<div class="container row">` with a bare `.col` per team
  // put every team in one non-wrapping row, so five teams got about 60px each. The
  // cards are now a grid that reflows to one column.
  test('team cards stack instead of sharing one row', async ({ page, baseURL }) => {
    const guard = await readOnly(page, baseURL);
    await openBiggestClubEditor(page);

    const cards = page.locator('.roster-card');
    const count = await cards.count();
    expect(count).toBeGreaterThan(1);

    const first = await cards.nth(0).boundingBox();
    const second = await cards.nth(1).boundingBox();

    // Stacked: the second card starts below the first, not beside it.
    expect(second.y).toBeGreaterThan(first.y + first.height - 2);
    // And each is close to the full width rather than a sliver.
    expect(first.width).toBeGreaterThan(300);

    guard.assertNoWrites();
  });

  test('the page does not scroll sideways', async ({ page, baseURL }) => {
    const guard = await readOnly(page, baseURL);
    await openBiggestClubEditor(page);
    const overflow = await page.evaluate(function () {
      return document.documentElement.scrollWidth - document.documentElement.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
    guard.assertNoWrites();
  });

  // The whole point. On the old page this gesture did nothing at all, because
  // mobile browsers don't synthesise dragstart/drop from touch.
  test('a touch drag reorders the list', async ({ page, baseURL }) => {
    const guard = await readOnly(page, baseURL);
    await openBiggestClubEditor(page);

    const list = listWithAtLeast(page, 2);
    const before = await namesIn(list);

    const handle = list.locator('.roster-row').first().locator('.drag-handle');
    const secondRow = list.locator('.roster-row').nth(1);
    const from = await handle.boundingBox();
    const to = await secondRow.boundingBox();

    // Real touch pointer events, not a synthesised mouse drag.
    await page.locator('body').evaluate(function () { window.scrollTo(0, 0); });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: from.x + from.width / 2, y: from.y + from.height / 2 }]
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from.x + from.width / 2, y: to.y + to.height / 2 + 4 }]
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    const after = await namesIn(list);
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);

    guard.assertNoWrites();
  });
});

test.describe('captain roster view', () => {
  test('is read-only and carries the contact details', async ({ page, baseURL }) => {
    const guard = await readOnly(page, baseURL);
    await page.goto('/manage-players');
    const link = page.locator('a[href^="/manage-players/club-"]').first();
    const href = await link.getAttribute('href');
    await page.goto(href);

    await expect(page.locator('.roster-card').first()).toBeVisible();
    // Nothing editable.
    await expect(page.locator('.drag-handle')).toHaveCount(0);
    await expect(page.locator('.row-menu-btn')).toHaveCount(0);
    await expect(page.locator('#roster-savebar')).toHaveCount(0);
    // But the things a captain actually needs.
    await expect(page.locator('.roster-summary')).toBeVisible();
    await expect(page.locator('.roster-contact').first()).toBeVisible();
    await expect(page.locator('.roster-row .rank').first()).toBeVisible();

    guard.assertNoWrites();
  });
});

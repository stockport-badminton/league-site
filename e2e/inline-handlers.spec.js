// The behaviour that used to be inline handlers, after REARCH-07 moved it out of the
// templates (25 Nov 2026): confirm prompts and the copy-from dropdown are data attributes
// read by static/beta/js/actions.js; the ELO backfill buttons and the venue map's load
// failure are wired from script. __tests__/unit/no-inline-handlers.test.js holds the count;
// this proves the pages still do what the attributes did.
//
// Read-only. An accepted confirm is seen as the POST the guard aborted, so nothing is
// deleted or sent; the backfill's GET (which writes) is answered here in the browser.

const { test, expect } = require('@playwright/test');
const { readOnly } = require('./helpers/read-only');

// The next dialog is answered as asked, and its message kept.
function answerDialog(page, accept) {
  const seen = [];
  page.once('dialog', dialog => { seen.push(dialog.message()); return accept ? dialog.accept() : dialog.dismiss(); });
  return seen;
}

test.describe('a data-confirm form', () => {
  test('asks first, and submits only when the answer is yes', async ({ page, baseURL }) => {
    const guard = await readOnly(page, baseURL);
    await page.goto('/admin/homepage-content');
    const remove = page.locator('form[data-confirm] button[type="submit"]').first();
    if (!(await remove.count())) test.skip(true, 'no announcements locally — run tools/local-db.sh load');

    const declined = answerDialog(page, false);
    await remove.click();
    await page.waitForTimeout(300);
    expect(declined).toEqual(['Delete this announcement?']);
    expect(guard.blocked).toEqual([]);

    const accepted = answerDialog(page, true);
    await remove.click();
    await expect.poll(() => guard.blocked).toEqual([expect.stringMatching(/^POST \/admin\/homepage-content\/\d+\/delete$/)]);
    expect(accepted).toEqual(['Delete this announcement?']);
  });
});

test.describe('a data-confirm button', () => {
  test('asks first, and submits its form only when the answer is yes', async ({ page, baseURL }) => {
    const guard = await readOnly(page, baseURL);
    await page.goto('/admin/push');
    const everyone = page.locator('button[data-confirm]');
    if (!(await everyone.count())) test.skip(true, 'push is not configured locally');

    answerDialog(page, false);
    await everyone.click();
    await page.waitForTimeout(300);
    expect(guard.blocked).toEqual([]);

    const accepted = answerDialog(page, true);
    await everyone.click();
    await expect.poll(() => guard.blocked).toEqual(['POST /admin/push/test']);
    expect(accepted).toEqual(['Send a test notification to every subscriber?']);
  });
});

test('the copy-from dropdown opens the form filled from that team', async ({ page, baseURL }) => {
  const guard = await readOnly(page, baseURL);
  await page.goto('/admin/teams/create');
  const select = page.locator('#copyFrom');
  const value = await select.locator('option').nth(1).getAttribute('value');
  await Promise.all([page.waitForURL(`**/admin/teams/create?copyFrom=${value}`), select.selectOption(value)]);
  await expect(page.locator('#copyFrom')).toHaveValue(value);
  guard.assertNoWrites();
});

test('the ELO backfill button runs the season it names', async ({ page, baseURL }) => {
  const guard = await readOnly(page, baseURL);
  const asked = [];
  await page.route('**/players/eloFullRecalc**', route => {
    asked.push(new URL(route.request().url()).searchParams.get('season'));
    return route.fulfill({ status: 200, contentType: 'text/plain', body: 'recalculated' });
  });
  await page.goto('/players/eloBackfillAdmin');
  const season = await page.locator('#season-select').inputValue();
  await page.getByRole('button', { name: 'Recalculate Season' }).click();
  await expect(page.locator('#result-output')).toContainText('recalculated');
  expect(asked).toEqual([season]);
  guard.assertNoWrites();
});

// A global `.alert { height: 100% }` (2022, for a view since deleted) made an alert as
// tall as its flex column, so what followed spilled past <main>: on this page, at 720px,
// the button stayed under the fixed footer however far you scrolled. Every alert it
// touched was 3-10 times its content height, /messer-results' included.
test('the last button on the backfill page scrolls clear of the footer', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/players/eloBackfillAdmin');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const onTop = await page.getByRole('button', { name: 'Recalculate Season' }).evaluate(b => {
    const r = b.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b;
  });
  expect(onTop, 'the footer covers the button').toBe(true);
  const alert = page.locator('.alert-warning').first();
  const { height, content } = await alert.evaluate(a => ({
    height: a.getBoundingClientRect().height,
    content: [...a.childNodes].reduce((sum, n) => {
      const range = document.createRange(); range.selectNodeContents(n);
      return Math.max(sum, range.getBoundingClientRect().bottom);
    }, 0) - a.getBoundingClientRect().top,
  }));
  expect(height, 'the alert is no taller than its text and padding').toBeLessThan(content + 40);
});

// The 4-second timer would show the fallback eventually; well inside that means the
// script's own load failure did it.
test('the venue map shows its fallback as soon as Maps fails to load', async ({ page, baseURL }) => {
  await readOnly(page, baseURL);
  await page.route(/maps\.googleapis\.com/, route => route.abort());
  await page.goto('/info/clubs');
  await expect(page.locator('#map-fallback')).toBeVisible({ timeout: 2000 });
  await expect(page.locator('#map')).toBeHidden();
});

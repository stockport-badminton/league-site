// The Admin dropdown must fit the window. The navbar is fixed-top, so a menu taller than
// the viewport cannot be scrolled into view: at 23 superadmin items the newest ones were
// unreachable on a laptop. The dev server's mock user is a superadmin and a messer admin,
// which is the longest menu there is.
const { test, expect } = require('@playwright/test');
const { readOnly } = require('./helpers/read-only');

async function openAdminMenu(page, phone) {
  await page.goto('/admin');
  if (phone) await page.locator('.navbar-toggler').click();
  await page.locator('#dropdown01').last().click();
  const menu = page.locator('.dropdown-menu-right.show');
  await expect(menu).toBeVisible();
  return menu;
}

for (const [label, size, phone] of [
  ['a laptop', { width: 1280, height: 720 }, false],
  ['a small phone', { width: 375, height: 640 }, true],
]) {
  test(`every Admin item can be clicked on ${label}`, async ({ page, baseURL }) => {
    const guard = await readOnly(page, baseURL);
    await page.setViewportSize(size);
    const menu = await openAdminMenu(page, phone);

    const items = menu.locator('.dropdown-item');
    const n = await items.count();
    expect(n).toBeGreaterThan(5);
    for (let i = 0; i < n; i++) {
      // trial: checks the item is visible, unobscured and would receive the click —
      // scrolling it into view first — without following it.
      await items.nth(i).click({ trial: true });
    }
    await expect(menu.getByRole('link', { name: 'All admin tools…' })).toBeVisible();

    guard.assertNoWrites();
  });
}

test('the hub links every tool', async ({ page, baseURL }) => {
  const guard = await readOnly(page, baseURL);
  await page.goto('/admin');
  await expect(page.locator('.admin-hub-group')).toHaveCount(6);
  await expect(page.getByRole('link', { name: 'Weekly Video Post' })).toBeVisible();
  guard.assertNoWrites();
});

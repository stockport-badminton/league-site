// Self-test for e2e/helpers/read-only.js.
//
// The other specs depend on that guard to keep them from writing to the
// production database (dev.env carries the same DATABASE_URL as .env). A guard
// that silently stopped firing would be worse than no guard, because the suite
// would still look green while a test wrote real rows. So prove it works.

const { test, expect } = require('@playwright/test');
const { readOnly } = require('./helpers/read-only');

test.describe('read-only guard', function () {

  test('blocks and records a same-origin write', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);
    await page.goto('/rules');

    const reached = await page.evaluate(async function () {
      try {
        // A real mutating endpoint. If the guard is not working this creates a
        // scorecard draft, so it must stay aborted.
        await fetch('/scorecard-beta', { method: 'POST', body: 'x' });
        return true;
      } catch (err) {
        return false;   // aborted at the network layer
      }
    });

    expect(reached, 'the write was not aborted').toBe(false);
    expect(guard.blocked).toContain('POST /scorecard-beta');

    // assertNoWrites must fail for this page, which is the whole point.
    expect(() => guard.assertNoWrites()).toThrow();
  });

  test('lets the read-only POST /teams lookup through', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);
    await page.goto('/rules');

    const ok = await page.evaluate(async function () {
      const res = await fetch('/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ divisionId: '8' })
      });
      return res.ok;
    });

    // team_search() only SELECTs, and the scorecard form's division dropdown
    // depends on it, so it is on the allowlist.
    expect(ok, 'POST /teams should be allowed - it is a lookup, not a write').toBe(true);
    guard.assertNoWrites();
  });

  test('drops third-party beacons so test runs stay out of analytics', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);
    await page.goto('/rules');

    const reached = await page.evaluate(async function () {
      try {
        await fetch('https://www.google-analytics.com/collect', { method: 'POST', body: 'x' });
        return true;
      } catch (err) {
        return false;
      }
    });

    expect(reached).toBe(false);
    // Third-party posts are dropped silently rather than failing the test - they
    // are not our writes.
    guard.assertNoWrites();
  });
});

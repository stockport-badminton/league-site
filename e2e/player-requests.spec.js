// /admin/player-requests — working through a forwarded registration email.
//
// The page builds each person's card in the browser, from the email's reading and the
// players on file, and its buttons call the roster API and then record the outcome.
// None of that runs under Jest. The fixture request comes from
// tools/local-db/dev-fixtures.sql: "Mary Whitle", stored as "Marry Whitle", and one
// person who is not on file at all.
//
// Read-only: both the roster write and the recording POST are fulfilled here in the
// browser, and the test asserts what the page SENT. What the server does with those
// requests is __tests__/integration/player-requests.test.js and roster.test.js.

const { test, expect } = require('@playwright/test');
const { readOnly } = require('./helpers/read-only');

async function openFixtureRequest(page) {
  await page.goto('/admin/player-requests');
  const link = page.getByRole('link', { name: 'Fwd: New players' });
  if (!(await link.count())) test.skip(true, 'no fixture request — run tools/local-db.sh load');
  await link.first().click();
  await expect(page.locator('#request-people .card')).toHaveCount(2);
}

// Answer the recording POST as the server would: the candidate stored as sent.
async function fulfilRecording(page, recorded) {
  await page.route('**/admin/player-requests/*/candidates/*', async route => {
    const body = route.request().postDataJSON();
    recorded.push(body);
    const index = Number(route.request().url().split('/').pop());
    const candidates = [null, null];
    candidates[index] = body;
    candidates[1 - index] = { first: 'x', family: 'y', outcome: null };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, candidates }) });
  });
}

test.describe('registration requests', () => {
  test('the email is shown beside the people read out of it', async ({ page, baseURL }) => {
    const guard = await readOnly(page, baseURL);
    await openFixtureRequest(page);

    await expect(page.locator('.request-body')).toContainText('Please register these for Dome A');
    const cards = page.locator('#request-people .card');
    await expect(cards.nth(0).locator('input').nth(0)).toHaveValue('Mary');
    await expect(cards.nth(0).locator('select').nth(1).locator('option:checked')).toHaveText('Dome A');

    // The typo on file is found, which is what the old search could not do.
    await expect(cards.nth(0)).toContainText('Marry Whitle');
    await expect(cards.nth(0)).toContainText('similar name');
    await expect(cards.nth(1)).toContainText('Nobody on file looks like this person.');

    guard.assertNoWrites();
  });

  test('registering the player on file moves them to the chosen team', async ({ page, baseURL }) => {
    const guard = await readOnly(page, baseURL);
    const transfers = [];
    const recorded = [];
    await page.route('**/api/roster/club-*/transfer', async route => {
      transfers.push({ url: route.request().url(), body: route.request().postDataJSON() });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, applied: true, message: 'moved' }) });
    });
    await fulfilRecording(page, recorded);
    await openFixtureRequest(page);

    const card = page.locator('#request-people .card').nth(0);
    await card.getByRole('button', { name: 'Register this player' }).first().click();

    await expect(card).toContainText('Registered (transferred from another club)');
    expect(transfers).toHaveLength(1);
    expect(transfers[0].url).toContain('/api/roster/club-Dome/transfer');
    expect(transfers[0].body.playerId).toBeGreaterThan(0);
    // The player as stored, not as the email spelled her.
    expect(recorded[0]).toMatchObject({ first: 'Marry', family: 'Whitle', outcome: 'transferred', team: 'Dome A' });

    guard.assertNoWrites();
  });

  test('someone not on file is created in the chosen team', async ({ page, baseURL }) => {
    const guard = await readOnly(page, baseURL);
    const creates = [];
    const recorded = [];
    await page.route('**/api/roster/club-*/players', async route => {
      creates.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, created: { playerId: 99999 } }) });
    });
    await fulfilRecording(page, recorded);
    await openFixtureRequest(page);

    const card = page.locator('#request-people .card').nth(1);
    await card.getByRole('button', { name: 'Create as a new player' }).click();

    await expect(card).toContainText('Created as a new player');
    expect(creates[0]).toMatchObject({ firstName: 'Newby', familyName: 'Playerton', gender: 'Male', section: 'reserve', confirmNew: true });
    expect(recorded[0]).toMatchObject({ outcome: 'created', playerId: 99999 });

    guard.assertNoWrites();
  });

  test('nothing is sent without a team', async ({ page, baseURL }) => {
    const guard = await readOnly(page, baseURL);
    await openFixtureRequest(page);

    const card = page.locator('#request-people .card').nth(1);
    await card.locator('select').nth(1).selectOption('');
    await card.getByRole('button', { name: 'Create as a new player' }).click();
    await expect(card).toContainText('Choose the team to register them to first.');

    guard.assertNoWrites();
  });
});

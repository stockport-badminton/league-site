// What the captain is told when the auto-fill goes wrong.
//
// This is the second contract a server test cannot hold (HARD-28): not what the handler
// did, but whether the sentence the captain reads matches it, and whether the thing that
// sentence points them at is actually on the page. The form has got this wrong twice, in
// the same direction both times — reporting success over a failure:
//
//   * "Scorecard photo uploaded at the start of the form", with nothing in the bucket,
//     shown INSTEAD of the upload box that would have fixed it;
//   * the prefill's "N fields auto-filled" written over an upload warning, so the captain
//     was told the good half of what happened and not the bad half.
//
// The failures themselves are the analysis endpoint's, and it is stubbed here: what is
// under test is the page's reaction, which is the half nothing else covers. The messages
// are asserted by their SUBSTANCE, not word for word — a test that pins the exact string
// fails on a rewording and passes on a wrong message that happens to keep the wording.
//
// Read-only throughout. The stubs are registered AFTER readOnly(), and Playwright matches
// the most recently registered route first, so nothing leaves the browser.

const { test, expect } = require('@playwright/test');
const { readOnly } = require('./helpers/read-only');

const photo = {
  name: 'card.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
};

// The auto-fill box lives on step 1 of the modal, so the modal is opened rather than the
// file being pushed at a closed one: a message the captain cannot see is not a message,
// and visibility is the only assertion that tells those apart. (The first version of this
// file set the input on the closed page and every check still passed, because
// toContainText does not care whether anything is on screen.)
async function openWizard(page) {
  await page.goto('/scorecard-beta');
  await page.getByRole('link', { name: /Enter Result/i }).first().click();
  await expect(page.locator('#signupModal').first()).toBeVisible();
}

async function analysisFails(page, status, error) {
  await page.route('**/api/analyse-scorecard', route => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify({ error }),
  }));
}

// Every one of these leaves the captain with a form they have to fill in by hand, so
// every one of them has to leave that form usable — and has to leave the photo box where
// they can reach it, because the card in their hand still needs attaching.
async function expectRecoverable(page) {
  await expect(page.locator('#photoAnalysisStatus')).toBeHidden();   // no spinner left spinning
  await expect(page.locator('#division')).toBeEnabled();
  await expect(page.locator('#scoresheet-url')).toHaveValue('');

  // Step 13's two states, asserted on their own `display` rather than on visibility,
  // because step 13 is not the step we are standing on — an element inside a hidden step
  // keeps its own computed display, so this reads the page's intent about that box
  // without walking eighteen games to get there.
  //
  // This pair IS the recovery. The photo box must still be offered and the "uploaded at
  // the start of the form" note must not be showing: claiming the photo is already in
  // hand while hiding the box that would put it there is precisely how draft 2439 came to
  // be filed with no scorecard and its captain told otherwise.
  await expect(page.locator('#scorecardUploadDone')).toHaveCSS('display', 'none');
  await expect(page.locator('#scorecardUploadPrompt')).not.toHaveCSS('display', 'none');
}

test.describe('when the scorecard cannot be read', function () {

  // The reader could not find the card's corners, or could not pull an image out of a
  // scanner PDF. Both are the caller's condition rather than a fault, and both come back
  // as a 400 whose message is meant for the captain — so the page must pass it through
  // rather than replace it with something generic.
  test('passes the reason through, and says what to do instead',
    async function ({ page, baseURL }) {
      const guard = await readOnly(page, baseURL);
      await analysisFails(page, 400,
        'The photo could not be pulled out of that file. Take a photo of the card with ' +
        'your phone and upload that instead.');
      await openWizard(page);

      await page.setInputFiles('#scorecardPhoto', photo);

      const result = page.locator('#photoAnalysisResult');
      await expect(result).toBeVisible();
      await expect(result).toContainText(/take a photo of the card/i);
      await expect(result).toContainText(/fill in manually/i);
      await expectRecoverable(page);

      guard.assertNoWrites();
    });

  // A file the reader will not take at all. The message names the file, not the reader —
  // "Could not read the scorecard" for a zip would send a captain off photographing the
  // card again to fix a problem that is not that.
  test('names the file when the file is the problem', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);
    await analysisFails(page, 400,
      'Zip files are not accepted. Send the photo or the document itself.');
    await openWizard(page);

    await page.setInputFiles('#scorecardPhoto', photo);

    await expect(page.locator('#photoAnalysisResult')).toContainText(/zip files are not accepted/i);
    await expectRecoverable(page);

    guard.assertNoWrites();
  });

  // Our fault, not theirs. The captain still needs to know their work is not lost — the
  // card can be attached at the end — because the alternative reading of a crash is that
  // filing the result is broken tonight.
  test('a fault on our side still leaves the captain a way through',
    async function ({ page, baseURL }) {
      const guard = await readOnly(page, baseURL);
      await analysisFails(page, 500,
        'Something went wrong reading that scorecard. Fill the form in yourself and ' +
        'attach the photo at the end — nothing is lost.');
      await openWizard(page);

      await page.setInputFiles('#scorecardPhoto', photo);

      await expect(page.locator('#photoAnalysisResult')).toContainText(/nothing is lost/i);
      await expectRecoverable(page);

      guard.assertNoWrites();
    });

  // The network dropped, or the endpoint answered something that is not JSON. There is no
  // server message to pass through, so the page has to have one of its own — silence here
  // is the worst outcome of the lot: the spinner stops, nothing changes, and the captain
  // has no idea whether to wait.
  test('says something when there is no message to pass through',
    async function ({ page, baseURL }) {
      const guard = await readOnly(page, baseURL);
      await page.route('**/api/analyse-scorecard', route => route.abort('failed'));
      await openWizard(page);

      await page.setInputFiles('#scorecardPhoto', photo);

      await expect(page.locator('#photoAnalysisResult')).toContainText(/could not read the scorecard/i);
      await expectRecoverable(page);

      guard.assertNoWrites();
    });
});

// A 200 that filled nothing in is the case most likely to be reported as success, because
// as far as the request is concerned it IS one. The captain has to be told the difference
// between "read, and here it is" and "read, and it got nothing".
test.describe('when the scorecard is read but yields nothing', function () {

  test('does not claim to have filled anything in', async function ({ page, baseURL }) {
    const guard = await readOnly(page, baseURL);
    await page.route('**/api/analyse-scorecard', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ _meta: {} }),
    }));
    // The photo itself still gets stored — reading the card and keeping it are separate
    // jobs, and the second one succeeding is not a licence to report the first one as
    // having worked.
    await page.route('**/sign-s3*', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        signedUrl: 'https://badmintontemp.s3.eu-west-1.amazonaws.com/put?sig=x',
        url: 'https://badmintontemp.s3.eu-west-1.amazonaws.com/scorecards/20262027/c.jpg',
      }),
    }));
    await page.route('https://badmintontemp.s3.eu-west-1.amazonaws.com/**',
      route => route.fulfill({ status: 200, body: '' }));
    await openWizard(page);

    await page.setInputFiles('#scorecardPhoto', photo);

    const result = page.locator('#photoAnalysisResult');
    await expect(result).toContainText(/could not extract data/i);
    await expect(result).toContainText(/fill in manually/i);
    // The tick belongs to a prefill that filled something in.
    await expect(result).not.toContainText('✓');

    guard.assertNoWrites();
  });
});

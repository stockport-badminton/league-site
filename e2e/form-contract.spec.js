// What the scorecard forms actually submit.
//
// This is the contract a server test cannot see. Jest asserts what a handler does with a
// body; it cannot tell you whether the body the browser builds is the body the fixture
// describes. The gap is not hypothetical — it is where the worst of this month's bugs
// lived:
//
//   Step 13 carried a hidden `scoresheet-url` in EACH of its two states, and
//   `display:none` does not stop a hidden input submitting. So the form posted the field
//   TWICE, req.body['scoresheet-url'] arrived as an array, isPhotoUrl() rejected it, and
//   every photo attached during submission was silently dropped. Every one of ~380
//   scorecard test cases posted the field once, as a string, because that is what the
//   fixture said. The field NAME matched. The SHAPE did not.
//
// So: serialise the real rendered form with FormData — the same thing the browser posts —
// and assert no name carries more than one value. That check is cheap, it generalises to
// any future stray input, and it is the one thing that would have caught it.
//
// It runs over every page that submits a scorecard, which is five, not one. The
// confirmation page is EDITABLE — it replays a draft into the same form, whose action is
// POST /scorecard-beta — so it carries the same contract as the entry form.
//
// Read-only throughout: the form is serialised, never submitted.

const { test, expect } = require('@playwright/test');
const { readOnly } = require('./helpers/read-only');
const { latestScorecardDraftPath, latestMesserDraftId } = require('./helpers/db');

// Serialise whichever form holds the game scores, exactly as the browser would.
async function serialise(page) {
  return page.evaluate(function () {
    var anchor = document.querySelector('[name="Game1homeScore"], #Game1homeScore');
    var form = anchor && anchor.form;
    if (!form) return null;
    var counts = {};
    var keys = [];
    // FormData is the right lens: it is literally what gets posted. An unchecked
    // checkbox is absent, a radio group contributes once, a hidden input in a
    // display:none container is very much present.
    new FormData(form).forEach(function (_value, key) {
      counts[key] = (counts[key] || 0) + 1;
      if (keys.indexOf(key) === -1) keys.push(key);
    });
    return {
      keys: keys,
      duplicated: Object.keys(counts).filter(function (k) { return counts[k] > 1; })
        .map(function (k) { return k + ' x' + counts[k]; }),
      action: form.getAttribute('action') || '(none)',
    };
  });
}

const PAGES = [
  { name: 'the captain\'s entry form  (/email-scorecard)', games: 18, url: async () => '/email-scorecard' },
  { name: 'the publish form          (/scorecard-beta)',   games: 18, url: async () => '/scorecard-beta' },
  { name: 'the messer entry form',                          games: 15, url: async () => '/messer-scorecard-beta' },
  {
    name: 'the standard confirmation page (editable, posts to /scorecard-beta)',
    games: 18,
    url: async () => latestScorecardDraftPath(),
  },
  {
    name: 'the messer confirmation page',
    games: 15,
    url: async () => {
      const id = await latestMesserDraftId();
      return id ? '/populated-messer-scorecard/' + id : null;
    },
  },
];

for (const page_ of PAGES) {
  test.describe(page_.name, function () {
    let url;
    test.beforeAll(async function () { url = await page_.url(); });

    // THE check. One field, one value — anything else and something is posting twice.
    test('posts no field name more than once', async function ({ page, baseURL }) {
      test.skip(!url, 'no draft in the database to render this page from');
      const guard = await readOnly(page, baseURL);
      await page.goto(url);

      const form = await serialise(page);
      expect(form, 'no form holding Game1homeScore was found on this page').not.toBeNull();
      expect(form.duplicated).toEqual([]);

      guard.assertNoWrites();
    });

    // And the form still offers what the handler needs. A renamed or dropped score input
    // would otherwise fail silently at submit time, on a page nobody renders in a test.
    test(`carries exactly ${page_.games} game score pairs`, async function ({ page, baseURL }) {
      test.skip(!url, 'no draft in the database to render this page from');
      const guard = await readOnly(page, baseURL);
      await page.goto(url);

      const form = await serialise(page);
      expect(form).not.toBeNull();

      const scores = form.keys.filter(k => /^Game\d+(home|away)Score$/.test(k));
      expect(scores).toHaveLength(page_.games * 2);
      // No off-by-one at either end: the standard card stops at 18, messer at 15.
      expect(form.keys).toContain('Game1homeScore');
      expect(form.keys).toContain(`Game${page_.games}awayScore`);
      expect(form.keys).not.toContain(`Game${page_.games + 1}homeScore`);

      guard.assertNoWrites();
    });
  });
}

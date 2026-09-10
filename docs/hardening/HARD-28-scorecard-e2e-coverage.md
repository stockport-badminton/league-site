# HARD-28 — What the scorecard flows are supposed to do, and testing that

**Severity:** medium · **Wave:** A · **Blocked by:** nothing
**Owns:** `e2e/scorecard.spec.js`, `e2e/messer-scorecard.spec.js`, `e2e/populated-scorecard.spec.js`
**Source:** four bugs in a fortnight, Sep 2026

> **Read the "Assumptions" section first and correct it.** The rest of this document is
> built on it, and I inferred it from code that has been wrong four times this month. If
> an assumption is wrong the tests below will pin the wrong behaviour in place, which is
> worse than having none.

## Why

Four scorecard bugs reached captains in a fortnight. The suite was not thin — ~380
scorecard-touching test cases and 1013 in total — so "write more tests" is not the
finding. What each one had in common is:

| bug | why ~380 tests missed it |
|---|---|
| duplicate `scoresheet-url` field | the field NAME matched the fixture; the SHAPE did not (one string vs an array) |
| unencoded `/resultImage/` URL | `sendResultZap` is mocked in every suite — never executed |
| auto-fill photo never stored | browser-only; no spec drove that input |
| unreadable card answered 500 | a mid-pipeline throw was never exercised |

Three of the four were **never executed in the shape production executes them**. And two
of the four were invisible from the server entirely.

## What e2e is for here

Not "click everything". A server test can already assert what a handler does with a body.
There are exactly two things it **cannot** see, and both bugs above lived in them:

1. **What the form actually submits.** Not what a fixture says it submits — what the
   rendered DOM serialises to. The duplicate-field bug was a form posting two values
   under one name while every test posted one.
2. **What the captain is actually told.** Whether the message they see matches what
   happened. Twice now the form has reported success over a failure — "Scorecard photo
   uploaded at the start of the form" with nothing uploaded, and a prefill message
   overwriting an upload warning.

**So the organising rule: an e2e test here earns its place if it holds one of those two
contracts.** Anything else is better tested server-side, where it is faster and clearer.

## What is covered today

`scorecard.spec.js` (10) · `messer-scorecard.spec.js` (7) · `populated-scorecard.spec.js` (7)

Page renders and modal opens; 18 (and 15) games present; division populates team
dropdowns; home team populates player dropdowns; both file inputs accept documents;
`ScorecardUpload` routes documents and images differently; the auto-fill stores its photo
and says so when it cannot (added today); messer allows negative scores and narrows teams
by section; the confirmation page plays back scores, players and section, and refuses a
missing token; no console errors on any of them.

That is a good base. It covers **loading** the form. It does not cover **using** it.

## The flows, as I understand them

**A — File a draft.** Captain opens the form, picks the fixture (division → home team →
away team → date), works through the game steps choosing players and entering scores,
optionally attaches a photo, reviews the summary, submits. A draft row is written, the
results secretary and the captain are emailed, and the captain lands on the confirmation
page for that draft.

**B — Auto-fill.** Instead of typing, the captain uploads a photo or a scanner PDF/docx at
step 1. It is OCR'd, the form is filled in, and the photo is stored so they do not upload
it twice. If the reader cannot line the card up, the form still works and says so.

**C — Confirm and publish.** The draft's confirmation link is opened, the result is
reviewed and published: the fixture is completed, 18 game rows written, emails sent, the
social webhook fired.

**D — Add a photo later.** A filed draft with no photo can be given one from a link.

**E — Messer.** The same shape: 15 games, negative scores allowed, sections rather than
divisions, a separate draft table and approve/reject step.

## Assumptions — please correct these

1. **Two entry points.** `GET /scorecard-beta` and `GET /email-scorecard` both render the
   standard card. I assume one is the captain's route and the other is legacy or the
   secretary's. **Which do captains actually use, and should both survive?**
2. **Who publishes.** CLAUDE.md says the away captain confirms via the token link before
   a result finalises; HARD-24 says a superadmin "is who actually validates and publishes
   today". **Which is the intended flow — and is the away-captain confirmation real, or
   aspirational?**
3. **The confirmation page.** Can whoever opens it *change* scores and players, or only
   accept what was filed? That decides whether it needs its own submit-shape tests.
4. **Invalid scores.** Should the wizard *block* moving to the next step, or only warn?
   `validateGamePair(n, requireFilled)` takes a flag, so it does both somewhere.
5. **Players.** Can a card be filed with players left unchosen? `scorecard-no-player`
   tests exist, so I assume yes — but is that a supported case or a tolerated one?
6. **Totals.** The `bad-totals` audit check finds fixtures not totalling 18. Should the
   form prevent that at submit time, or is it deliberately permissive because a conceded
   or short match is legitimate?
7. **Messer this season.** The draw and rules pages get traffic; no result has ever been
   submitted through the site. **Is Messer expected to run through this form this season?**
   If yes it should be tested before it starts; if it is run on paper, it should not be.

## Gaps, in the order I would close them

**1. What the form submits (holds contract 1).** Fill the rendered form in the browser,
serialise it, and assert the payload — field set, and that no name carries more than one
value. This is the single check that would have caught the duplicate-field bug, and it
generalises: any future stray input fails it. The read-only guard blocks the POST, so
serialise rather than submit.

**2. What the captain is told (holds contract 2).** For each failure the flow can hit —
unreadable card, refused file type, failed upload, unmatched fixture — assert the message
shown is the one that fits, and that the recovery it points at is actually available. Both
"success over failure" bugs would have failed this.

**3. The wizard.** Nothing walks it. Step navigation, the progress bar, whether invalid
scores gate the next step (assumption 4), and that the summary shows what was entered.

**4. The prefill.** `prefillFromAnalysis` sets division, teams, players and scores. Only
its photo half is tested. It is also the most-used path now that auto-fill exists.

**5. Messer, to parity.** Same checks, 15 games. Ranked here rather than lower **only if
assumption 7 says it runs through the site** — and then it moves to the top, because its
paths have never executed in production at all.

**6. Mobile.** `roster-edit.spec.js` tests touch and stacking; the scorecard has nothing,
and captains file results on phones at the end of a match night.

## Acceptance criteria

- A test that serialises the real rendered form and fails if any field name carries more
  than one value.
- A test per captain-visible failure message, asserting the message matches the outcome.
- The wizard walked end to end, with the score-gating behaviour of assumption 4 pinned.
- The prefill asserted beyond the photo.
- Messer at parity with the standard card, if assumption 7 says so.
- Everything read-only: `guard.assertNoWrites()` in every test, stubs registered after
  `readOnly()` so nothing reaches S3 or the database.

## Out of scope

- Submitting a real scorecard. The suite runs against production data; a separate database
  is HARD-13, and until then the payload is asserted by serialising, not posting.
- The server-side handlers, which are well covered by Jest already.
- Anything requiring the OCR to actually run: the analysis endpoint is stubbed.

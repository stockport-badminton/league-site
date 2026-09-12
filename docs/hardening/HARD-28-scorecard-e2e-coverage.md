# HARD-28 — What the scorecard flows are supposed to do, and testing that

**Severity:** medium · **Wave:** A · **Blocked by:** nothing
**Owns:** `e2e/scorecard.spec.js`, `e2e/messer-scorecard.spec.js`, `e2e/populated-scorecard.spec.js`
**Source:** four bugs in a fortnight, Sep 2026

> **Answered by Neil, 10 Sep.** The seven open assumptions are settled below and the
> priorities re-ordered accordingly — Messer moved to the top, because the audit that put
> it at the bottom was wrong (see "A correction").
>
> **Re-scoped 12 Sep**, because HARD-13 landed and this brief's central constraint — "the
> suite runs against production data, so serialise the form rather than posting it" — is
> no longer true. See "What HARD-13 changed".

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

## Answered, 10 Sep

1. **Two entry points, and they differ.** `GET /email-scorecard` is the captain's route:
   it files a draft, and additionally loads that captain's own fixtures missing photos.
   `GET /scorecard-beta` sets `formAction: '/scorecard-beta'`, so it posts **straight to
   publish** — the superadmin's route for entering or correcting a result directly. Both
   stay.
2. **The superadmin confirms and publishes.** Not the away captain. CLAUDE.md's note that
   "the away captain must confirm via token link before the result finalises" describes an
   intention, not the flow — HARD-24 has it right.
3. **The confirmation page is editable.** `/populated-scorecard-beta/:id?t=…` plays the
   draft back into the *same* form, whose action is `POST /scorecard-beta`. So whoever
   opens it can correct scores and players before publishing, and the submit-shape
   contract applies to that page too, not just the entry form.
4. **Invalid scores block the next step.** Not a warning.
5. **Every player must be chosen**, using the `No Player` option where there was nobody —
   which supplies a zero. So an unchosen select is a validation failure, and `No Player` is
   a legitimate value rather than a gap.
6. **A total that is not 18 must be prevented** at submit time.
7. **Messer runs through the site, and is in season now.** Three results have been filed
   and approved through it, most recently Shell B v Remnants A on 2 Sep, approved 4 Sep.

## A correction, and the method behind it

The first version of this document put Messer last, on the grounds that no Messer route
had been reached in four months. **That was wrong, and the error is worth keeping.**

`gcloud logging read` applies `--freshness=1d` unless the filter carries a timestamp
constraint. The audit had none, so every "no traffic in four months" was really "no
traffic in the last 24 hours". Re-run with `timestamp>="2026-05-01"`, the whole Messer
submission and approval flow is live: `POST /messer-scorecard-beta` on 3 Sep,
`/populated-messer-scorecard/:id` on 3 Sep, `POST /messer-result/:id/approve` and
`/reject` on 4 Sep. `GET /scorecard/fixture/:id` is live too.

Three routes were deleted in the same pass on the same flawed evidence. They survive
review because that case did not rest on the logs alone — nothing in the codebase
referenced them and the page was linked from nowhere — but that was corroboration that
happened to be there, not method. **Never delete on log silence alone**, and note that the
dev server writes to the production database while logging nothing to Cloud Run, so a row
can exist with no request behind it. Recorded in CLAUDE.md.

## What HARD-13 changed, and what it did not (12 Sep)

**The browser suite has been running against the local database since HARD-13 landed, and
nobody said so.** `playwright.config.js` starts its dev server with
`dotenv_config_path=./dev.env`, and `dev.env`'s `DATABASE_URL` now points at `127.0.0.1`.
Confirmed by the suite itself: six specs skip without `tools/local-db/dev-fixtures.sql`,
which exists only locally, and the last full run reported 71 passed and none skipped.

So the reason this brief said *serialise the form, do not post it* is gone. A submitted
scorecard now writes a row into a Postgres that `tools/local-db.sh load` rebuilds from
nothing in about five seconds. **Gap 1 should submit, not serialise** — and that is
strictly better, because serialising asserts what the DOM *would* send, while submitting
also proves the server accepts it, which is the other half of a shape contract.

CLAUDE.md said the opposite until today ("`dev.env` carries the *same* `DATABASE_URL` as
`.env`, so a local dev server is talking to the **production** Supabase instance"). It was
true when written and became false without anyone noticing, which is the more useful
lesson: a warning that has quietly inverted is worse than no warning, because it is the
one thing a careful person will check.

**What it did not change: the dev server still holds live credentials.** `dev.env` carries
a real `AKIA…` key and the real bucket name, and a `HeadBucket` against `badmintontemp`
with them returns **200**. Two consequences, and the second is the dangerous one:

- The browser-side guard already aborts any request whose host is not the app's
  (`e2e/helpers/read-only.js`), so a presigned PUT from the page cannot reach S3.
- **The guard cannot see a server-side effect at all.** `POST /api/analyse-scorecard` and
  `POST /api/convert-scorecard-document` store the converted image from inside the Node
  process. A submission test that attaches a document would write real objects into the
  production bucket, and Playwright would report nothing wrong, because no browser request
  went anywhere near it. That is exactly how HARD-25's first Jest run put two real objects
  in that bucket.

So **HARD-26 declared the Jest environment and nothing has done the same for the browser
one.** `dev.env` is now the last place a test run holds a live credential. That is
**HARD-33**, and it gates the submission tests below — not the rest of them.

One more sharp edge found while checking this: `reuseExistingServer: !process.env.CI`
means the suite adopts whatever server is already on the port. `npm run prodlocal` loads
`.env`, so running the browser suite while that is up silently points all 71 specs at the
**production** database and bucket. Worth an assertion at suite startup rather than a note.

## Gaps, in the order I would close them

**1. What the form submits (holds contract 1).** Fill the rendered form in the browser and
assert the payload — field set, and that no name carries more than one value. This is the
single check that would have caught the duplicate-field bug, and it generalises: any future
stray input fails it.

Since HARD-13 this can **submit** rather than serialise, against the local database, which
proves the server accepts the shape as well as that the DOM produces it. Do the serialising
version first — it needs nothing from HARD-33 and catches the duplicate-field class on its
own — then the posting version once the dev server's credentials are dead.

**2. What the captain is told (holds contract 2).** For each failure the flow can hit —
unreadable card, refused file type, failed upload, unmatched fixture — assert the message
shown is the one that fits, and that the recovery it points at is actually available. Both
"success over failure" bugs would have failed this.

**3. The wizard.** Nothing walks it. Step navigation, the progress bar, whether invalid
scores gate the next step (assumption 4), and that the summary shows what was entered.

**4. The prefill.** `prefillFromAnalysis` sets division, teams, players and scores. Only
its photo half is tested. It is also the most-used path now that auto-fill exists.

**Messer, to parity — now first, not fifth.** Same checks, 15 games, negative scores,
sections rather than divisions, plus the approve/reject step the standard card does not
have. It is in season, it has ~7 specs against the standard card's 10, and its
submit-and-approve flow carries the same two contracts. The standard card produced four
bugs in a fortnight; there is no reason to think the 15-game copy of it is healthier, and
it is being used right now.

**6. Mobile.** `roster-edit.spec.js` tests touch and stacking; the scorecard has nothing,
and captains file results on phones at the end of a match night.

## Acceptance criteria

- A test that serialises the real rendered form and fails if any field name carries more
  than one value.
- A test per captain-visible failure message, asserting the message matches the outcome.
- The wizard walked end to end, with the score-gating behaviour of assumption 4 pinned.
- The prefill asserted beyond the photo.
- Messer at parity with the standard card, if assumption 7 says so.
- Every test that does not deliberately submit stays read-only: `guard.assertNoWrites()`,
  stubs registered after `readOnly()`.
- A submission test names the rows it writes and the suite can be re-run without
  `local-db.sh load` in between — a test that only passes against a fresh database is a
  test that will be skipped.
- The suite refuses to run against a production `DATABASE_URL` or bucket, rather than
  trusting whoever started the dev server (see `reuseExistingServer`).

## Out of scope

- ~~Submitting a real scorecard.~~ **Lifted 12 Sep** — HARD-13 gives the browser suite a
  disposable database. Submission tests are in scope, behind HARD-33.
- Neutralising `dev.env`. That is HARD-33, and it is a prerequisite rather than part of
  this.
- The server-side handlers, which are well covered by Jest already.
- Anything requiring the OCR to actually run: the analysis endpoint is stubbed.

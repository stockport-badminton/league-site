# HARD-24 — `POST /scorecard-beta` publishes a league result unauthenticated

**Severity:** medium · **Wave:** B · **Blocked by:** nothing
**Owns:** `routes/index.js` (`/scorecard-beta`), `controllers/scorecardController.js`
(`full_fixture_post`), `views/populated-scorecard.ejs`
**Source:** found while checking whether HARD-03's confirmation flow was live, 4 Sep 2026

## Why

`POST /scorecard-beta` is the **publish** step: it writes the fixture's score, inserts 18
`game` rows, fires the result zap and sends the "website updated" email. It carries
`publicFormLimiter` and nothing else.

The asymmetry is the giveaway — **`GET /scorecard-beta` is `secured` and the `POST` is
not**:

```js
router.post('/scorecard-beta', publicFormLimiter, scorecard_controller.validateScorecard, scorecard_controller.full_fixture_post);
router.get('/scorecard-beta', secured, scorecard_controller.scorecard_beta);
```

There is no comment anywhere explaining the POST being open, unlike the several endpoints
in this codebase whose public reachability *is* deliberate and documented. It reads as
historical accident.

## What HARD-01 already prevents

Worth stating, because it bounds the severity and it is genuinely good. `full_fixture_post`
resolves the fixture through `Fixture.resolveFixtureForResult`, which refuses with a 409 or
404 rather than writing when:

| conflict | meaning |
|---|---|
| `already-recorded` | a complete result exists — **it cannot be overwritten** |
| `ambiguous` | two outstanding fixtures for the pairing |
| `rearranged` / `conceded` | the fixture is not awaiting a result |
| `not-found` | no such fixture — **a result cannot be invented** |

Plus the scores must total exactly 18, and the validators refuse a player used twice in a
rubber. So an anonymous caller cannot rewrite history or fabricate a fixture.

## What it can still do

**Publish a plausible but fabricated result for any fixture that is currently
outstanding.** All the inputs are public: fixtures, dates, team names and nominated
players are all on the site.

The nastier half is not the false result, it is what happens next. Once a fake result is
recorded, the real captain's submission resolves to `already-recorded` and is **refused
with a 409**. So this is a way to *block* a genuine result, and the captain sees a
conflict page telling them their match is already recorded. That is much more likely to be
reported as "the website is broken" than as tampering.

## Who actually calls it — check before gating

This package exists because SEC-3 gated the invoice endpoints without checking, and broke
a Make.com automation that only fired once a year (HARD-23). The same check, done first:

**In code, exactly one caller:** the form in `views/populated-scorecard.ejs` (`action="/scorecard-beta"`),
on the confirmation page served by `GET /populated-scorecard-beta/:id` — which is **not**
`secured`; it is gated by the per-draft token, with tokenless drafts grandfathered open.

Two humans reach that form, and they differ:

- **The submitting captain**, redirected there straight after filing. They necessarily
  have a session, because `GET /scorecard-beta` is `secured` and that is where they filled
  the form in. `secured` on the POST costs them nothing.
- **The league secretary**, from the "Scorecard Received" email. Session state on that
  device is unknown. If they are not logged in, `secured` redirects to `/login` and the
  POST body is lost — which would be discovered at the worst moment, mid-validation.

**No external caller is evidenced, and that is not the same as none.** Cloud Logging
retains from 17 May 2026 and the season ended before that, so there are **zero** POSTs to
`/scorecard-beta` or `/email-scorecard` in the whole retained window. Absence of data, not
evidence of absence. Re-run the query once a few results have been filed this season
before treating "no external callers" as established:

```bash
gcloud logging read 'resource.labels.service_name="league-site" AND httpRequest.requestMethod="POST"
  AND httpRequest.requestUrl:"/scorecard-beta"' --project=stockport-badminton-map --freshness=7d
```

## What to do

**`secured` alone is the wrong gate**, for two reasons: any logged-in league member could
still publish any outstanding fixture, and it breaks the secretary's email-link flow.

Accept **either** of:

1. a superadmin session — which is who actually validates and publishes today; or
2. a valid draft token for the draft being published, checked with `mayOpenDraft` exactly
   as the confirmation page does.

**The form does not currently carry the token** — `views/populated-scorecard.ejs` has no
hidden `t` field — so option 2 needs one adding. Note that all 2,434 existing drafts are
tokenless, so for those only the superadmin path can work; that is fine, since the
secretary is the one publishing, and every *new* draft gets a token.

Also worth fixing in the same pass, and cheap:

**The "website updated" email takes its recipient from the request body.**

```js
const toAddresses = (typeof req.body.email !== 'undefined'
  ? (req.body.email.indexOf('@') > 1 ? [req.body.email] : ['stockport.badders.results@gmail.com'])
  : ['stockport.badders.results@gmail.com']);
```

This is the same shape as the `/fixture/reminder` open relay closed in the spam-hardening
pass: an unauthenticated endpoint sending mail from our own verified domain to an address
the caller chooses. Narrower — one recipient, and you must post a valid 18-game scorecard
first — but the recipient should be derived server-side from the fixture, as that fix
established. The rule is already in CLAUDE.md.

## Acceptance criteria

- An anonymous POST is refused without writing to `fixture` or `game`.
- A superadmin session can still publish.
- A caller presenting a valid draft token for that draft can still publish.
- The confirmation page's form still works end to end for both.
- The "website updated" recipient is derived server-side; a body-supplied address is
  ignored.
- Tests: anonymous refused, superadmin accepted, valid token accepted, wrong token
  refused, and an assertion that no write occurred on the refusals.

## Out of scope

- The grandfather clause on tokenless drafts (HARD-03's, deliberately kept).
- Whether the away captain should be in this flow at all — see the diagnosis in HARD-17.

# Spam controls and security headers

Moved out of `CLAUDE.md`, word for word, so that file holds only the rules most tasks need.

### Spam and abuse controls

Five layers, deliberately independent, because each covers what the others can't:

| Layer | Where | Notes |
|---|---|---|
| reCAPTCHA | `validCaptcha` in `contactusController` | On `/contact-us` only. It works — a fake token is rejected |
| Rate limits | `middleware/rateLimit.js` | 12 public endpoints + sitewide backstop |
| Blocklists | `blocked_entry` table, `models/spamControls.js` | ip / email / phrase / word |
| Honeypot + timing | `views/spam-fields.ejs`, `utils/spamChecks.js` | Catches bots we've never seen |
| Submission log | `submission_log` table | The only way to tell whether any of it works |

**Blocking someone is a form submission, not a deploy** — `/admin/spam` (superadmin, in
the Admin nav). It used to be a source edit: 89 spammer addresses and ~180 phrases were
hardcoded in `contactusController.js` and three IPs in `app.js`. Don't put lists back in
code.

Rules worth not rediscovering:

- **Mount `globalLimiter` after the static handlers.** Above them it counts every
  stylesheet, script and image, so one page view is a dozen hits — the Playwright suite
  exhausted a 600-request budget partway through and only 23 of 44 specs ran.
- **A new public form must include `views/spam-fields.ejs`** inside its `<form>`, and its
  route must carry `spamGate()` and a limiter. The shared partial exists so the honeypot
  and the timing floor can't drift apart or be forgotten.
- **A rejection is deliberately indistinguishable from a success.** Naming the check that
  fired is how a spammer tunes a payload. The cost is that a false positive silently eats
  a real message — which is why only the two checks with negligible false-positive rates
  behave this way, and why every rejection is logged with a reason. **Watch the
  `validation` count on `/admin/spam`:** rising means real people failing the form.
- **A missing timing stamp is not spam.** Caches, autofill and any form rendered before
  the field existed would all be caught. Only the floor is enforced, so a stale tab still
  submits.
- **`models/spamControls` never fails closed.** A DB hiccup means empty lists, not
  rejecting every submission. The cache is warmed before `listen()` because the IP check
  reads it synchronously on every request.
- **Rate limiters keep counters in module state**, so `resetRateLimits()` runs before each
  test from `__tests__/setupAfterEnv.js`. It can't live in `setup.js` — that's a
  `setupFiles` entry and runs before `beforeEach` exists. A test that wants to see a limit
  bite must exhaust it within one case.

Anything unauthenticated that sends email must derive its recipients server-side.
`/fixture/reminder` took the address from the request body and was an open relay from our
own verified domain; the risk there is the domain's sending reputation, not spam arriving.

**`POST /fixture/rearrangement` is superadmin-only** (Sep 2026). It was unauthenticated
behind nothing but a rate limit: anyone who could POST could set a fixture to
`rearranged` and insert a replacement from `{homeTeam, awayTeam, date}`. The worry at
the time was that locking it down would change how captains request rearrangements —
it didn't, because the only client is the modal in `fixtures-results.ejs`, which has
always been inside `if (superadmin)`. Captains ask by email; they never had the form.

`Fixture.rearrangeByTeamNames` was tightened in the same pass, and the shape of what was
wrong is worth keeping:
- The INSERT resolved both teams inline with `(SELECT id FROM team WHERE name = ?)`, so
  a name matching nothing inserted a fixture with a **NULL team** instead of failing —
  a supply of exactly the rows `--check ghost-teams` keeps finding.
- The UPDATE and the INSERT were unrelated statements, so a pairing that archived
  nothing still created a replacement. One typo, one phantom fixture.
- No transaction, so a failure between them left a fixture `rearranged` with no
  replacement — invisible until a captain asked where their match had gone.

Both teams are resolved first, the fixture is found explicitly, and both writes share
one `db.withTransaction`. It answers JSON (`{ok, action, fixtureId, replacementId}`) and
passes its 4xx messages to the client; the modal shows them, because reporting only
success made a rejection look identical to an acceptance.

### Security response headers and the CSP

`helmet` is mounted at the very top of `app.js` — above the static handlers, the IP
blocklist and `/healthz` — because the requirement is every response. The policy itself
is in **`utils/securityHeaders.js`**, where every allowlist entry sits beside the
template that forces it. Read that file, not `app.js`, to understand the policy.

Two CSP headers go out, and the split is the design:

| Header | Holds | Why |
|---|---|---|
| `Content-Security-Policy` | `frame-ancestors`, `base-uri`, `object-src`, `form-action` | No resource allowlist at all, so it cannot blank a page that works today |
| `Content-Security-Policy-Report-Only` | the full `script-src`/`style-src`/`img-src`/… allowlist | This is the one that could break the scorecard modal, so it observes first |

- **Adding a CDN to a view means adding it to `OBSERVED`.** A test walks `views/**/*.ejs`
  for external `<script src>` / `<link href>` and fails if a host is missing, so this is
  caught rather than discovered when enforcement is flipped on.
- **Not everything is greppable.** Google Maps injects a `fonts.googleapis.com`
  stylesheet at runtime, and reCAPTCHA creates an iframe that appears in no template.
  Grepping for `<iframe>` finds nothing and builds a policy that breaks both. (The
  Facebook page plugin did the same until it was replaced by a plain link, Oct 2026.)
- **`script-src` keeps `'unsafe-inline'`**, because `views/` has 159 inline `onclick`
  attributes. Do not "improve" this by adding a nonce: a nonce makes the browser *ignore*
  `'unsafe-inline'`, and no nonce can be attached to an `onclick` at all, so it would
  break every one of them. Removing them is HARD-15.
- **`frame-ancestors` is ignored in a report-only header**, which is why the clickjacking
  protection had to go in the enforcing one to do anything.
- Violations POST to `/csp-report` (in `app.js`, above `globalLimiter` for the same reason
  `/healthz` is). Sentry does *not* collect these by default — that needs `report-uri`
  pointed at its security endpoint and the feature enabled, which was never set up.


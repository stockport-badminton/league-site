# HARD-19 — Guards for the two gotchas that keep coming back

**Severity:** medium · **Wave:** A · **Blocked by:** nothing
**Owns:** `__tests__/unit/` (a new guard), and whatever live bugs it turns up
**Sources:** the club contact page fix, 1 Sep 2026

## Why

Two entries in CLAUDE.md's gotcha list have now caused four separate production bugs, and
the last two happened *after* they were written down:

| when | bug | gotcha |
|---|---|---|
| Aug 2026 | 48 `/event/` pages rendered as a two-byte 200 | 1c — INNER JOIN to an optional captain |
| Aug 2026 | Captain and match secretary blank on every `/event/` page | 1 — unquoted camelCase alias |
| Sep 2026 | College Green E missing from its club's contact page | **1c again** |
| Sep 2026 | Club secretary's email blank on every club page | **1 again** |

Both of September's were in `getContactDetailsById`, a query that had been *edited* four
days earlier (to stop inlining `DB_PI_KEY`) without either being noticed. Neither is
subtle once seen; both are invisible until somebody looks at the page. The club secretary's
email had been blank for as long as that page existed and was found only because a human
happened to look.

Documentation has not stopped these. The comparable case is `res.send(err)`, which caused
the same failure eleven times across four controllers until
`__tests__/unit/no-res-send-err.test.js` made it impossible; it has not returned since.

## What makes this harder than the res.send(err) guard

`res.send(err)` is a single unambiguous token. These two are not, and a naive rule is
useless. Measured on 1 Sep 2026:

```
153  matches for /AS [a-z][a-zA-Z]*[A-Z]/ across models/ and controllers/
 71  distinct alias names
 43  of those also appear as `.someAlias` somewhere in models/controllers/views
```

Forty-three "findings" would be ignored by week two. Spot-checking four of them:

- **`totalHomeScore`** — actually written `AS "totalHomeScore"`. The regex matched the
  inner substring of a *correctly quoted* alias. False positive.
- **`awayClubName`** — the "read" is `e.awayClubName` inside a SQL string being built for
  a search filter, not a JavaScript property access. False positive.
- **`fixturePlayers`** — `fixturePlayers[slot]` is a local variable in
  `playerController`. False positive.
- **`mapLink`** — genuinely unquoted, but nothing reads it in camelCase. Not a bug.

So three of four spot checks were noise. **Do not ship the naive version.** A guard that
cries wolf is worse than none, because it teaches people to add exclusions.

## What to do

1. **Get the quoting right first.** Match the whole alias token including its quotes:
   `AS\s+("?)([A-Za-z_][A-Za-z0-9_]*)\1` and branch on whether the quote is present. That
   alone removes the `totalHomeScore` class.
2. **Only count reads that are property access in JavaScript or EJS output** — `row.alias`,
   `<%= x.alias %>`, destructuring — not occurrences inside template-literal SQL and not
   bare identifiers. Stripping template literals containing `SELECT` before searching is
   crude but removes the `awayClubName` class cheaply.
3. **Tie the alias to the function that declares it**, so `clubName` unquoted in
   `models/club.js` is not excused by `clubName` being quoted in `models/venue.js`. This
   is the step that makes the result trustworthy, and the one that takes the work.
4. **Report the survivors and confirm each by hand** before turning the guard red. Expect
   the count to be small. Every survivor is a field rendering blank somewhere right now.
5. **Separately, flag `JOIN player` without `LEFT`** — 12 occurrences in `models/`, a much
   smaller and more tractable list than the alias one. A club officer or team captain is
   optional in the data (two teams currently have no captain at all), so an inner join to
   one silently drops whole rows. Not every one will be wrong; confirm each.

## Acceptance criteria

- The guard runs in milliseconds as part of `npm test`, like `no-res-send-err`.
- Zero false positives on the codebase as it stands, having confirmed each survivor by
  hand. A guard with a suppression list on day one has already failed.
- Every live bug it turns up is fixed, or has a comment saying why the alias is read in
  lowercase deliberately.
- Reintroducing either gotcha makes the guard fail. Prove it the way
  `no-res-send-err.test.js` was proved: put the bug back and watch it go red. That guard's
  first version anchored to the start of a line and sailed past a one-line
  `catch (err) { res.send(err); }` — it was only found by trying to defeat it.

## Tests

The guard *is* the test. It needs its own fixtures though: a small set of strings covering
the quoted alias, the unquoted alias read in camelCase, the unquoted alias read in
lowercase (legitimate), an alias mentioned only inside SQL text, and a `LEFT JOIN player`
versus a plain one.

## Out of scope

- Rewriting the 153 unquoted aliases. Most are read in lowercase and work fine. This is
  about the mismatch, not the style.
- `models/players.js` and `models/fixture.js`'s wider query hygiene. If the guard finds
  something there, fix that finding, not the file.

## Note

The value here is not the two rules. It is that both bugs were **greppable in principle
and still shipped twice**, and that a page can be visibly wrong for years without anything
noticing. If a rule turns out not to be mechanically checkable with an acceptable false
positive rate, say so and close the package — that is a real answer, and better than a
guard nobody trusts.


---

# The alias half, 7 Sep 2026

Half of this package is done: the alias guard exists, and so does the thing that finds
existing offenders. **The join half — an INNER JOIN to something optional — is untouched.**

## What landed

**`__tests__/unit/sql-alias-quoting.test.js`** — the rule is *an alias is either
quoted-and-camelCase, or written lowercase; never camelCase-unquoted*. Only that third
form is dangerous, and it is dangerous because it LIES: the SQL says `AS clubSecEmail` and
the row arrives as `clubsecemail`, so the mistake is invisible where anyone would look.

This brief refuses a suppression list on day one, correctly, and that was the obstacle —
there were 191 offenders. The way round it: **lowercasing an unquoted camelCase alias is a
provable no-op**, because Postgres was already folding it. So all 191 were rewritten and
the guard starts clean.

Proved empirically rather than argued: the output keys of 35 model read functions were
snapshotted against the real database before and after — **421 keys, none changed, none
stopped returning rows** — and the diff was checked mechanically by normalising every
`AS <token>`, which makes the added and removed line sets identical.

**`tools/key-contract.js`** — the guard above compares SQL against itself and can never
find a broken CONSUMER. Nor can Jest: these failures are silent, most of these queries
have no test, and a mock spelling the key camelCase passes against the bug. So this runs
each read-only model function, reads `Object.keys()` off a real row, and reports any
camelCase read in `views/` or `controllers/` whose lowercase form is a real key while the
camelCase form is not. It needs the database, so it lives with `dbq --check`, not in
`npm test`.

## What it found

| | |
|---|---|
| `/club-api` consumer reading `teamName`, `matchSecEmail`, `teamCaptainEmail` | **fixed** — `row.teamName` was undefined, so the filter matched nothing, `filterTeams[0]` was undefined, and `.matchSecEmail` threw. The reminder modal's address field was never filled, silently, since the error only reached the browser console |
| `fixtures-results.ejs` reading `homeClubName` | **recorded, not fixed** — the comparison has always been false, so the Enter and Confirm links only ever showed to `club == 'All'`. Fixing it would reveal two dead links: `/fixtures/edit/:id` does not exist and is swallowed by the `/fixtures/*` wildcard, which ignores the id. Needs a decision about what captains should be offered, not a cast |

Earlier finds from the same class, for the record: `AS Man1` (every player column on
`/fixture-players` and the confirmation screen), `AS clubSecEmail` (`/contact-us` losing
enquiries), `AS pointsFor` (league tables, May), `AS teamCaptain` (`/event/` pages).

## Honest coverage

**66 of 104 read functions** returned a row and were checked. The other 38 need arguments
the tool cannot guess; `--coverage` lists them. Of those 38, ten alias a folded multi-word
name and so could hide the same bug — the two highest-value were hand-checked
(`league.getLeagueTable`, `players.getPlayerGameData`) and **both are correct**, because
they already use the right pattern: fold internally, quote at the boundary
(`beforeval AS "beforeVal"`).

Anyone continuing this should widen `ARGS` in the tool rather than trust the clean run.

# The join half, 7 Sep 2026

**Done.** `__tests__/unit/optional-join-guard.test.js`.

The brief estimated 12 `JOIN player` without `LEFT`; there are now **41**, inside **164**
inner joins in SQL overall. Flagging those would be deleted in a week, exactly as this
brief predicts. So the guard takes the narrowest shape that is *always* wrong: **an inner
join to `player` whose ON clause tests a ROLE.** A role is optional by nature — six teams
have no captain flagged — so joining one as an attribute of another row is the mistake all
three historical bugs made.

That narrowing leaves **2** occurrences, not 41, and both were confirmed by hand:

| | |
|---|---|
| `Player.getEmails` | correct. Five UNION branches, each hardcoding its own role (`'club Sec' AS role`), so the join defines what the row IS and a club with no treasurer *should* contribute no treasurer row |
| `League.getAnnualInvoices` | **the bug** |

The permitted form is expressed as a rule rather than an exemption — a statement that
hardcodes a role literal in its own SELECT list — so there is no suppression list, which
this brief refuses.

## The bug it found

`getAnnualInvoices` inner-joined the club secretary. **A club with nobody flagged
`clubSecretary` was dropped from the invoice run entirely** — no error, no empty row, just
absent from the output the treasurer reads. Latent rather than live: all 18 clubs have one
flagged today, so it was one unflagged secretary away from a club never being invoiced.

Fixing it surfaced a second thing. With the join LEFT, the result went from 18 clubs to
**19** — and the newcomer was `No Club` (63), the sentinel a released player parks on,
which holds `No Team` (52) and so looks like a club with two teams. It had been excluded
*by the same accident*: no flagged secretary, inner join, dropped. It is now excluded on
purpose, which does not depend on its data staying incomplete.

`send_invoices` also no longer hands SES `ToAddresses: [null]`. A club with no address is
reported into the same `outputs` list the successes go to, so the gap is visible rather
than being an absence somebody has to notice.

Verified the change is inert for real clubs: INNER and LEFT both return 20 grouped rows
for `club.id <> 63`.

## Still to do

- Inner joins to `venue`, `club` and `division` — 27 of them, a real class per gotcha 1c
  ("a missing one should cost a field, not the page") but needing judgement per query.
  A `tools/`-style audit, not a unit test.
- Reach the 38 read functions `tools/key-contract.js` cannot make return a row.
- The `homeClubName` links decision.

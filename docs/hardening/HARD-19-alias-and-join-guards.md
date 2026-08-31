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

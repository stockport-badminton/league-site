# HARD-17 — The draft and the recorded games disagree for 1 fixture in 9

**Severity:** high · **Wave:** B · **Blocked by:** nothing
**Owns:** investigation first. Likely `controllers/scorecardController.js`,
`models/fixture.js` — **agree the diagnosis before writing anything.**
**Sources:** found during HARD-09, 31 Aug 2026

## Why

A scorecard submission writes two things: a draft row in `scorecardstore`, and 18 rows in
`game`. They should describe the same match. For roughly one fixture in nine, they do not.

Measured by re-deriving the game rows from the draft and comparing against what is
actually stored, over 120 fixtures that hold both:

| population | exact match |
|---|---|
| all 120 | **99 / 120** |
| restricted to drafts with a full squad and full mixed pairings | **98 / 110 (89%)** |

The restriction matters because it rules out the innocent explanation. A rubber nobody
could field is stored with all four players as `0`, and a draft that still names the
nominated players will legitimately differ — but 12 fixtures with *complete* squads and
*explicitly stored* mixed pairings still disagree with their own game rows. In `#6197` the
draft's `FirstMixedhomeMan1` / `FirstMixedhomeLady1` name one pair and the `game` row names
another.

Two candidate explanations, and they have very different consequences:

1. **The games are written from a later submission than the draft that survives.** A
   captain files, something is amended, the games are rewritten, and the older draft stays
   in the table. Benign for the league table, but it means a draft is not evidence of what
   was played.
2. **A draft is editable after its result is published.** Which would mean the record of
   what a captain filed can change after the fact, with nothing recording that it did.

**Why this is worth a package rather than a note:** three separate things now treat a
draft as a record of the match.

- HARD-03's confirmation flow shows a draft to the away captain and asks them to agree it.
  If the draft can drift from the published result, they are agreeing to something that is
  not what was recorded.
- The photo-upload list joins drafts to fixtures.
- HARD-09 declined to rebuild four orphaned results *because* of this measurement. If the
  divergence turns out to be explanation (1) and the later submission is identifiable, that
  decision could be revisited and the four gaps filled from real data.

## What to do

**Investigate before you change anything.** The deliverable of the first half of this
package is a diagnosis, not a patch.

1. Reproduce the measurement. `scripts/hard09-verify-pairing-mapping.js` (gitignored, may
   need rewriting) does exactly this: it derives 18 rows from a draft using the rubric in
   `controllers/scorecardController.js:258-275` and diffs them against the stored `game`
   rows, reporting the match rate overall and for the clean subset. Start from its output,
   not from this document's numbers.
2. For a handful of the 12 clean-profile mismatches, establish **which** record is right —
   whether a second draft exists for that fixture outside the ±3-day window the script
   uses, and whether its timestamps sit before or after the fixture's.
3. Decide which explanation holds. If more than one does, say so.
4. Then, and only then, propose the fix. If it is (1), the answer is probably to record on
   the fixture which draft produced its games — an id, not a date match — which removes a
   whole class of guessing from this codebase. If it is (2), the answer is that a published
   draft becomes immutable.

## Acceptance criteria

- A written diagnosis naming which explanation holds, with the specific fixtures and
  drafts that demonstrate it.
- If a code change follows: a test that fails without it, and no change to any existing
  published result.
- The measurement re-run after the fix, with the match rate reported. It does not have to
  reach 120/120 — historical divergence is history — but new submissions must not add to
  it.

## Tests

- A test asserting the relationship the fix establishes. If a fixture gains a reference to
  the draft that produced it, assert that a submission sets it and that the confirmation
  view reads the draft *through* it rather than by matching on date and team.
- `__tests__/integration/scorecard.test.js` is the file; note the trap recorded in it —
  one describe block leaves `ses.sendEmail` rejecting and `jest.clearAllMocks()` does not
  restore implementations, so use the `sesWorks()` helper.

## Out of scope

- Rebuilding the four orphaned results. That is HARD-09's decision, already taken. If this
  investigation makes a faithful rebuild possible, raise it as a new package with the
  evidence rather than doing it here.
- The ±3-day windows in `tools/audit/checks.js`. Those are a pragmatic fix for a check;
  this package is about why a window is needed at all.

## Do not

Do not "fix" this by tightening the date window used to match drafts to fixtures. The
window is a symptom. Two records of the same match disagree, and no join condition
resolves that.


---

# Diagnosis, 3 Sep 2026

**Neither of the two candidate explanations above is right.** The answer is a third one,
suggested by the league secretary and confirmed against the data:

> **Results are corrected during validation, the `game` rows are rewritten, and the draft
> is left exactly as the captain filed it.** Nothing edits a draft after the fact and
> nothing writes games from a second submission. The two records simply diverge because
> only one of them is ever corrected.

## Explanation 1 — games written from a later submission — ruled out

Duplicate drafts are real and common: of 1,373 matches, **140 have more than one draft**
(106 have two, 27 three, four have four, three have five — nothing guards against a
scorecard being filed twice). At 10.2% that is temptingly close to the ~20% divergence
rate, which is why it looked like the answer.

It is not. Re-running the comparison against **every** candidate draft rather than the
nearest-dated one moves the match rate from **1033/1299 to 1036/1299** — three fixtures.
`scripts/hard17-duplicate-draft-test.js`.

## Explanation 2 — drafts editable after publication — ruled out

No evidence, and the shape is wrong for it. See below: the drafts are internally
consistent and look exactly like what a captain would have typed.

## What is actually happening

266 fixtures mismatch. **260 of them differ in the mixed rubbers** — the divergence is
overwhelmingly concentrated there:

```
SecondMixed 190   ThirdMixed 185   FirstMixed 130      <- 505 of 679 rubber mismatches
SecondLadies 47   ThirdLadies 44   SecondMens 29
FirstMens 24      ThirdMens 21     FirstLadies 9
```

And of those 260, **173 (66.5%) contain exactly the same twelve people in draft and games —
only the pairing differs.** The home pair stays put and the away partner moves between
rubbers:

```
fixture 4790  FirstMixed   draft 50|66|68|427        games 50|66|68|91
              SecondMixed  draft 1959|1868|1861|91    games 1959|1868|1861|427

fixture 5468  SecondMixed  draft 2232|2233|347|2151   games 2232|2233|789|2151
              ThirdMixed   draft 787|1777|789|2123    games 787|1777|347|2123
```

That is precisely "the mixed order isn't accurate, so it gets fixed during validation".
The remaining 87 involve someone genuinely different — a real substitution corrected at
the same time. Doubles diverge far less (79 fixtures, 38 of which hold the same squad).

**Note for anyone re-measuring:** an earlier pass here asked whether the three mixed
*tuples* had been reordered as units and found one case, and wrongly concluded the
hypothesis was dead. The reordering happens *within* the mixed set — one side's players
reassigned across rubbers — so the test has to compare the personnel multiset per side,
not the tuples. `scripts/hard17-mixed-personnel.js`.

**No time clustering**, which rules out a changed pairing convention: 73% / 81% / 77% /
84% / 77% / 80% match for 2019/20 through 2025/26. A steady rate, consistent with a
steady human process.

## What this means for the three consumers

- **The draft is a faithful record of what the captain submitted.** It is not, and never
  was, a record of what was *played* once corrected. Both statements are fine as long as
  nothing confuses them.
- **HARD-03's confirmation flow is the real exposure.** It shows the away captain a draft
  and asks them to agree it. For ~20% of fixtures that draft does not match the published
  result, and the away captain has no way to see the corrected version. This is worth
  fixing regardless of anything else here.
- **HARD-09's four orphaned results should stay unrebuilt**, and now for a clear reason
  rather than an uncertain one: rebuilding games from a draft would reinstate exactly the
  uncorrected pairings that validation existed to fix.
- **Player and pair statistics are affected, the league table is not.** Scores are
  unchanged, so points and positions are right. But ELO and pair stats attribute results
  to specific partnerships, and for ~173 fixtures the partnership recorded in the draft is
  not the one recorded in `game`. The `game` rows are the corrected record and are what
  those calculations already read, so nothing is wrong today — it only matters if anything
  ever recomputes stats from drafts.

## What to do about it

The divergence is **not corruption and needs no data fix**. Two changes worth making:

1. **Record on the fixture which draft produced its games** — an id, not a date match.
   Every measurement in this package had to guess the association with a ±3-day window,
   and 140 matches have several drafts to choose between. This removes a whole class of
   guessing.
2. **Stop guarding nothing against a second submission.** 140 duplicate-draft matches is a
   lot of noise for a table that is also the confirmation record, even though it turned
   out not to cause this.

Both are smaller than the package assumed, because the headline turned out to be a process
working as intended rather than a bug.

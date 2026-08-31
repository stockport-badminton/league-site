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

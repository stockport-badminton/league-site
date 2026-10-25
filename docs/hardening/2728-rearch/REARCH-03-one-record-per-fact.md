# REARCH-03 — one record per fact: officers, drafts, names

**Size:** M overall, in three parts that do not depend on each other
**Window:** part A in-season OK; part B off-season only; part C any time
**Blocked by:** REARCH-01 for the model functions each part rewrites (soft: it can be done
in hand-written SQL, but then it is done twice). Part B also wants REARCH-08.
**Owns:** A — `club."matchSec"`, `club."clubSec"`, `team.captain` and
`Player.getEmails`; B — `scorecardstore`, `messer_scorecard`, `scorecardController`,
`messer-scorecard-controller`, the validators; C — the `pointsFor` / `pointsAgainst`
aliases in `models/league.js` and their four readers.
**Source:** the 24 Oct 2026 "build it from scratch" review.

Three places where the same fact is stored twice, or two near-identical things are stored
separately, and the copies have already disagreed.

---

## Part A — an officer is recorded one way

### Why

CLAUDE.md, *An officer is recorded two ways*: a pointer on the club or team
(`club."matchSec"`, `club."clubSec"`, `team.captain`) and a flag on the player
(`matchSecrertary`, `clubSecretary`, `teamCaptain`) read against that player's own club or
team. `getEmails` matches either, per UNION branch, and the pointer side never checks where
the player now is. That kept someone who had left a club on its division's distribution
list until her mailbox bounced (18 Sep 2026).

### Where it stands — measured 24 Oct 2026

25 pointers are set (8 `matchSec`, 7 `clubSec`, 10 `captain`):

| | Count | What clearing it does |
|---|---|---|
| Pointer and flag agree, player is at that club/team | 21 | Nothing — the flag already answers |
| Pointer on the `No Club` / `No Team` placeholder rows, player unflagged | 3 | Nothing anyone would want; these are placeholders |
| **Captain of Parrswood C, flagged `teamCaptain`, but plays for another team** | **1** | **Parrswood C loses its captain** |

(CLAUDE.md's "29, of which 25 have a flagged equivalent" is older than this; re-measure
before acting, as always.)

**That last row is the design question.** The flag model says "this player is captain of
*the team they play for*". It cannot say "captain of a team they do not play for", and the
league has one such case today. So the choice is:

1. **Flags are the one record** — retire the pointers. Smallest change, and the direction
   the code is already moving. Parrswood C's captaincy needs a decision with the club: the
   captain is moved to that team, or someone in it is flagged.
2. **A role table is the one record** — `officer (player, role, club, team)`. Expresses
   every case, including the one above, and lets a person hold a role somewhere other than
   their own team. Bigger: every reader of the flags changes, and the roster pages
   (`rosters` skill) edit the flags directly.

**Recommended: option 1**, unless the league says captaining a team you do not play for is
a real, recurring arrangement — one case in 55 teams says it is not. Ask before building.

### What to do (option 1)

1. Resolve the Parrswood C case with a human.
2. A reviewed script nulls all 25 pointers, guarded in its `WHERE` and re-reading after
   (gotcha 2d). `--check all` before and after.
3. A migration drops the three columns. `getEmails` loses its pointer half in every
   branch; the officer joins become flag-only. Snapshot `getEmails` per division list
   before and after: the recipient set must be identical, which is what proves step 2 lost
   nothing.
4. `stale-officer-pointers` check retired, with a note saying why.

---

## Part B — one scorecard engine, parameterised by format

### Why

A league fixture is 18 games, a Messer tie is 15 with handicap scores (negatives allowed,
no win-by-two). That difference is a handful of parameters. Today it is two of everything:

- two draft tables — `scorecardstore` (73 columns: Game1homeScore … Game18awayScore and
  twelve player columns; 1,597 rows) and `messer_scorecard` (15 games; 10 rows);
- two controllers, two express-validator rule sets, two wizards, two confirmation pages;
- two sets of e2e specs (`scorecard-*.spec.js`, `messer-*.spec.js`), which exist partly
  because each copy has broken separately (HARD-28; the messer form rendering blank, which
  the Jest tests missed).

### Do it in two steps; the second is optional

**Step 1 — one rules module, no schema change.** `scorecard/rules.js`:
`rulesFor({ games: 18|15, allowNegative, winByTwo })` returns the per-game check and the
whole-card checks (player uniqueness, totals). Both server validators call it; both wizards
call the *same file* in the browser (that is why REARCH-07 needs a bundler). This is most
of the value: the rule is written once and the two flows cannot disagree about a score.

**Step 2 — one draft table** (`scorecard_draft`, with `format`), games as rows in
`scorecard_draft_game` or as a validated `jsonb` array. Worth it only if step 1 leaves the
two controllers still largely duplicated. Constraints if it is done:

- **Draft ids are in captains' inboxes** (`/populated-scorecard-beta/:id?t=…`) and messer
  approval links. `scorecardstore` ids must be kept as they are; messer drafts need ids
  that do not collide — a separate range, or a mapping kept for old links.
- `confirmToken` and the grandfather rule for tokenless drafts move with the rows
  (`utils/scorecardLinks.js` — `mayOpenDraft` vs `mayPublishDraft` stay distinct).
- HARD-17's draft-vs-games divergence detection reads both; it moves with it.
- `sync.js` and `sanitise.sql` both name the draft tables and their plaintext `email`.

### Window

Off-season only. Captains file every week; Messer runs through the season.

### Acceptance (step 1)

- One rules module; `grep` finds no second definition of the score rule.
- The score-rule e2e specs (`scorecard-wizard`, `messer-wizard`) pass unchanged, and a unit
  test drives `rulesFor` with both formats' edge cases (21-19, 30-29, -10, a 22-20 that
  needs win-by-two in one format and not the other).

---

## Part C — names that say what they hold

`pointsFor` / `pointsAgainst` are games won and lost, not league points (CLAUDE.md, *Common
Table Patterns*). They are computed aliases in `models/league.js`, read in
`socialController.js`, `views/tables.ejs` and `views/all-tables.ejs`. Rename to
`gamesWon` / `gamesLost`; any time; small. Check both table images and both table pages
render the same numbers before and after — a rename that misses a template renders a blank
column, not an error (the reason REARCH-01 cannot do it alone).

---

## Out of scope

- Encrypted contact columns — REARCH-01 puts every `pgp_sym_*` call behind one helper.
- The roster pages' editing of flags (owned by the `rosters` skill's code).
- Changing what Messer *is* (sections, draw, handicaps).

# HARD-09 — Clean the known-bad data

**Severity:** medium · **Wave:** A · **Blocked by:** nothing
**Owns:** `scripts/` (gitignored) and the database. **No application code.**
**Sources:** SEASON-1 (residue), SEASON-4, SEASON-6, SEASON-7, SEASON-8, SEASON-10

## Why

Eight distinct data problems are live right now. None needs a code change; each is
invisible in the UI; several are what make other findings dangerous rather than
theoretical. Baseline before you start:

```bash
node tools/dbq.js --check all
```

## What to do

Work through these **one script at a time**, each with a dry run, modelled on
`scripts/backfill-contact-emails.js` (dry by default, `--apply` to write, guard
re-checked in the `WHERE` clause of the write itself, not just the read).

1. **41 abandoned 2020 fixtures still `outstanding`.** Set them to `void` — the status
   already used for 95 others. This also clears the 15 doubled pairings that make
   HARD-01's fixture-lookup bug reachable. `--check ambiguous-pairings`
2. **3 results with no game rows** (`#6117`, `#6576`, `#6037`). Rebuild the games from
   the scorecard photos if they exist, otherwise void the results and ask the clubs.
   **Ask Neil before either** — this is real league history.
   `--check orphan-results`
3. **3 orphaned drafts** (`#2290`, `#2275`, `#2349`). Two are the same match filed
   twice. Match them to their fixtures by hand and publish, or discard.
   `--check orphan-drafts`
4. **8 results not totalling 18 games.** Mostly historical; the most recent is a 3–3 in
   May 2023. Correct where the scorecard survives, void where it does not.
   `--check bad-totals`
5. **Parrswood B's duplicate ranks** (7 collisions, both genders). Re-saving the team in
   the roster editor normalises them — quickest path is the UI, not a script.
   `--check duplicate-ranks`
6. **16 players with a null rank.** Same fix, same route.
7. **Ghost teams in a division.** Parrswood C was moved to No Club on 31 Aug 2026 during
   the audit; re-check whether any remain. `--check ghost-teams`
8. **Short squads.** Not a data error — a real-world one. Produce the list and send it to
   the league rather than changing anything. `--check short-squads`

## Acceptance criteria

- `node tools/dbq.js --check all` before and after, both pasted into the commit message.
- Every check that was non-zero is either zero or has a written reason why it is not.
- Every write went through a script with a dry run that was reviewed first.
- No application code changed.

## Out of scope

- The 2,132 fixtures pointing at deleted teams — **HARD-11**. That one needs a decision
  about intent before anything is written.
- The 1,605 fixtures stored at 23:00 (BST artefact). Tempting, but shifting timestamps
  changes what every archive page displays; treat it as its own piece of work with Neil.
- Preventing recurrence — that is HARD-01 (validation) and HARD-10 (team lifecycle).

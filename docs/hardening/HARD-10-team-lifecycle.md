# HARD-10 — Withdraw a team properly

**Severity:** medium · **Wave:** B · **Blocked by:** nothing
**Owns:** `controllers/teamController.js`, `models/league.js`, admin views
**Sources:** SEASON-7

## Why

A team that folds has nowhere to go. `/admin/teams` can create, edit and promote or
relegate a team, but it cannot **withdraw** one. So a defunct team stays in its division
and appears in the league table as a row of zeros, visible to every member and every
visitor, looking like a bug in the site.

Parrswood C was in exactly that state during the audit — Division 3, no players, no
fixtures — and Neil moved it to No Club by hand on 31 August 2026, partly because it
would otherwise have been invoiced. That is the second symptom: a withdrawn team is
still billable until someone remembers.

## What to do

1. A **Withdraw team** action on `/admin/teams/:id`, superadmin only, that clears the
   division and records that the team is withdrawn rather than deleting it — the fixture
   table has no foreign keys and 2,132 rows already point at team ids that no longer
   exist (HARD-11). **Do not delete team rows.**
2. Make the league table skip teams with no fixtures this season. This alone removes the
   visible symptom and is worth doing even if the admin action slips.
3. Check the invoice query (`models/league.js`, `getAnnualInvoices`) counts only teams
   that are actually entered this season.
4. Confirm a withdrawn team's players still resolve on historical scorecards and stats.

## Acceptance criteria

- Withdrawing a team removes it from the current league table and from the invoice count.
- Its historical fixtures, results and player stats are unchanged.
- No team row is deleted.
- `node tools/dbq.js --check ghost-teams` returns nothing after a withdrawal.

## Tests

- withdraw → team absent from the division's table, present in last season's archive
- withdraw → excluded from `getAnnualInvoices`
- a non-superadmin cannot withdraw
- historical fixture involving the team still renders

## Out of scope

- Deleting or merging clubs.
- The orphaned team references — **HARD-11**.

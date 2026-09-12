---
name: rosters
description: The team-management pages — the rank/reserve convention on player.rank, the intent-only write API, club-scoped authorization, and the drag-and-drop gotchas. Use when touching rosterController, models/roster.js, views/roster*.ejs, static/beta/js/roster-edit.js, static/beta/css/roster.css, the /api/teams or /api/players or /api/roster endpoints, or e2e/roster-edit.spec.js.
---

# Team management (rosters)

Moved out of CLAUDE.md so it loads when it is relevant rather than in every session.

Two pages, two audiences — they used to be one template switching on a
`superadmin` boolean, which is why the captain's view was laid out around drag
targets she couldn't use.

| Route | Who | View |
|---|---|---|
| `/manage-players` | superadmin picks a club; a club admin is redirected to their own | `roster-clubs.ejs` |
| `/manage-players/club-:club` | captains and admins — read-only | `roster.ejs` |
| `/manage-players/club-:club/edit` | reordering, moves, add/transfer | `roster-edit.ejs` |
| `/manage-players/club-:club/registration.docx` | the league's registration table, streamed | — |

`roster-team-card.ejs` and `roster-row.ejs` are shared by both pages so they can't
drift. Editor behaviour lives in `static/beta/js/roster-edit.js`; styles in
`static/beta/css/roster.css`, opted into with
`include('header.ejs', { useRosterCss: true })`.

**player.rank is the nominated order AND the reserve flag**, per `(team, gender)`:

```
rank 1..N   nominated, in strength order
rank >= 99  reserve, in order (99 = first reserve, 100 = second, ...)
NULL        treated as nominated; gets a real rank on the next save
```

Reserves were previously all written a flat `rank = 99`, so their order could be
dragged but never saved. Anything asking "is this a reserve" must use
`Roster.isReserve(rank)` (i.e. `>= 99`), never `=== 99`. Ranks are per-gender
because a fixture picks 3 men and 3 ladies independently — a team's number 1 man
and number 1 lady both hold rank 1. Display position is recomputed from list order,
so a team whose stored ranks have gaps (there are several, left by the old
client-side renumbering) still reads 1, 2, 3 and is normalised on its next save.

**Writes take intent, never SQL.** `POST /player/batch-update` used to accept
`tablename` and `fields` from the request body and interpolate both into an
`UPDATE`, behind `secured` only — any logged-in captain could write any column of
any table, including their own `player.role`. It is gone. Use:

```
POST /api/teams/:id/order        { sections: [{ gender, section, playerIds: [...] }] }
POST /api/players/:id/move       { teamId, section }
POST /api/players/:id/release
GET  /api/roster/club-:club/candidates?term=
POST /api/roster/club-:club/players | /attach | /transfer
```

`models/roster.js` renumbers **both ends of a move in one transaction** via
`db.withTransaction` (added for this — `otherConnect()` takes a connection per
query, so it cannot hold a transaction). Never renumber client-side: doing so is
what left teams ranked 1, 2, 4, 6.

**`saveTeamOrder` takes section membership from the payload, and settles a gender's
two lists together** (`renumberGender`). Whether someone is nominated is what the
save is *changing*, so it cannot also be the thing that decides which list they
belong to. Reading it from the rank already stored meant a promoted reserve was
dropped from the nominated list for not already being nominated, then re-appended to
the reserve list as a member the payload hadn't named: the save wrote **nothing**,
answered `ok: true`, and the refresh put them back. It was live for a month and no
test caught it — every case posted one section, or four with nobody crossing.
`renumberSection` still derives membership from the ranks, and is only for closing
the gap a departing player leaves behind in `movePlayer` / `releasePlayer`.

**Authorization**: `secured` only proves someone is logged in. Anything scoped to a
club also needs `middleware/requireClubAccess` — as route middleware where the path
carries `:club`, or `assertClubAccess(req, clubName)` inside a handler that has to
look the club up first. Id-keyed endpoints resolve the club from the row's real
owner (`Roster.getTeamOwner` / `getPlayerOwner`), never from the request.

**`/api/` errors answer in JSON**, via a handler that runs before the HTML one in
`routes/index.js`. 4xx messages are passed through to the client (the editor shows
them in its toast); 5xx messages are not, since they can carry SQL.

Gotchas:
- `custom.css` styles `.fa` globally for the footer's social icons (`font-size: 30px;
  float: right`), and `nav.ejs` wraps every page in `.starter-template` which sets
  `text-align: center`. `roster.css` undoes both for `.roster-page` — don't "fix"
  them centrally, 40-odd other pages depend on them.
- Drag uses **Pointer Events** plus `touch-action: none` on the handle. Both are
  needed; the old page bound only `dragstart`/`drop`, which mobile browsers never
  fire from touch, so nothing on it worked on a phone. `touch-action: none` also
  means the dragging finger can't scroll, which is why the drag runs its own
  edge auto-scroll off `requestAnimationFrame`.
- **The dragged row is positioned in document coordinates**, from the pointer's
  offset within it, re-derived after every DOM move (`reanchor()`). Don't go back to
  a running delta with the transform reset to zero on each swap: that snaps the row
  into its new slot out from under the finger, and the asymmetric hysteresis it
  leaves behind is what made the drag feel like it was catching.
- **The drop target is the list the pointer is in**, chosen by distance
  (`listUnder()`), not the first list that would accept an insert. A pointer *above*
  a list also tests as "before its first row", so first-match-wins meant a nominated
  player dragged up from the bottom of the list landed at the top of the reserves.
- **`.roster-card` must not clip** (no `overflow: hidden`). The row menu is absolutely
  positioned inside its row, so clipping the card cut the menu in half for everyone in
  the bottom half of a team. The head's rounded corners are set explicitly instead, and
  the menu flips to `.drop-up` near the foot of the window.
- `models/players.js:create` has no `RETURNING`, so its `insertId` is always
  `undefined`. Use `Roster.createPlayer` when you need the new id.
- Club 63 is `No Club` and team 52 is `No Team` — the sentinels a released player is
  parked on. Named as `Roster.NO_CLUB_ID` / `NO_TEAM_ID`.

## Related

The roster page's own `registration.docx` export is `buildRegistrationDoc` in
`rosterController.js` — the league's *official* registration form is a different
document; see the `registrations` skill.

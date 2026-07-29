# Superseded by the team-management rewrite — 2026-07-29

These are the old team-management views, replaced by `views/roster.ejs` (the
captain's read-only roster), `views/roster-edit.ejs` (the editor) and the shared
`views/roster-team-card.ejs` / `views/roster-row.ejs` partials. Parked here rather
than deleted so the old behaviour is easy to compare against; delete the folder
once you're happy.

Nothing references either file: `manage_player_list_clubs_teams` was the only thing
that rendered `team-admin.ejs`, and `team-admin.ejs` was the only thing that
included `AddCreatePlayerModal.ejs`. Both are gone.

| Moved file | Original path | Replaced by |
|---|---|---|
| team-admin.ejs | views/team-admin.ejs | `views/roster.ejs` + `views/roster-edit.ejs` |
| AddCreatePlayerModal.ejs | views/AddCreatePlayerModal.ejs | the add/transfer dialog in `views/roster-edit.ejs`, driven by `static/beta/js/roster-edit.js` |

Also deleted outright: `../2026-07-audit/views/team-admin-v2.ejs`. That was an
abandoned attempt at the same fix which kept the four-bucket layout and bolted a
long-press `touchmove` handler onto it. The layout was the problem, so there is
nothing in it worth keeping.

## What these files did that the new ones deliberately don't

Worth knowing if you ever diff them:

- **`/player/batch-update`** — both files posted to it. It took `tablename` and
  `fields` from the request body and interpolated them into an `UPDATE`, behind
  `secured` only, so any logged-in captain could write any column of any table.
  Replaced by the intent endpoints in `controllers/rosterController.js`.
- **Client-side renumbering** — the drop handler renumbered only the destination
  bucket, which is why teams are left ranked 1, 2, 4, 6. The server now renumbers
  both ends in one transaction.
- **`rank = 99` for every reserve** — reserve order could be dragged but never
  saved. Now sequential from 99.
- **Move Up / Move Down** — present in the menu, never wired to a handler
  (`button:nth-child(1)` and `(2)` only, so items 3 and 4 got no listener).
- **The transfer alert** — said "an email has been sent to request a transfer" and
  sent nothing, then added the player anyway for a superadmin.
- **Hardcoded `63` / `52`** — the No Club / No Team sentinel ids, as bare literals
  in the view. Named constants in `models/roster.js` now.
- **`data.insertId`** — read from `Player.create`, which has no `RETURNING` clause,
  so it was always `undefined` and the new player's id was posted as `NaN`.

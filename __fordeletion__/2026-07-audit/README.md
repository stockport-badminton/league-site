# Orphan audit — 2026-07-18

Files moved here by an automated orphaned-file audit. Each was verified to have
**zero references** from live code (no `render()`, no `include()`, no `require()`,
not routed). Parked here for review — run the test suite / eyeball the app, then
delete this folder once you're happy.

To restore any file, `git mv` it back to its original path (shown below).

## Orphaned views  (`views/` → `2026-07-audit/views/`)

| Moved file | Original path | Why orphaned |
|---|---|---|
| TournamentNotesModal.ejs | views/TournamentNotesModal.ejs | never rendered/included |
| tournamentPhotosCarouselModal.ejs | views/tournamentPhotosCarouselModal.ejs | never rendered/included |
| userapproved.ejs | views/userapproved.ejs | never rendered/included |
| scorecard-received.ejs | views/scorecard-received.ejs | never rendered/included |
| team-admin-v2.ejs | views/team-admin-v2.ejs | superseded by `team-admin.ejs` (the rendered one) |
| emails-missed-three.ejs | views/emails/missed-three.ejs | never rendered via ejs.renderFile |
| messer-draw.ejs | views/messer-draw.ejs | only reachable via unrouted `teamController.messer_draw` |
| messer-draw-b-section.ejs | views/messer-draw-b-section.ejs | `new_messer_draw` hardcodes the generic `messer-draw-a-section` template for both sections |
| messer-draw-a-section-20222023.ejs | views/messer-draw-a-section-20222023.ejs | historic seasonal variant; render target is hardcoded, season param only feeds the DB query |
| messer-draw-a-section-20232024.ejs | views/messer-draw-a-section-20232024.ejs | same |
| messer-draw-b-section-20222023.ejs | views/messer-draw-b-section-20222023.ejs | same |
| messer-draw-b-section-20232024.ejs | views/messer-draw-b-section-20232024.ejs | same |

> Note: the `messer-draw-*` seasonal/section files contain **real historic draw data**.
> They're dead only because `new_messer_draw` ignores the `:section`/`:season` params
> for template choice. If you ever want per-season draw pages wired back up, restore these.

## Orphaned code  (`2026-07-audit/code/`)

| Moved file | Original path | Why orphaned |
|---|---|---|
| models-secured.js | models/secured.js | dead duplicate — whole body is commented out; the live middleware is `middleware/secured.js` |
| utils-devDebug.js | utils/devDebug.js | never `require`d anywhere |
| controllers-fixtureGenerator.js | controllers/fixtureGenerator.js | Tameside remnant — its only route `/fixture/generate` rendered the removed `tameside-fixtures` view (500). Tool moved to its own repo. Require + route also removed from `routes/index.js`. |

## Loose dead files  (`2026-07-audit/`)

| Moved file | Original path | Why |
|---|---|---|
| messer-test-output.log | messer-test-output.log | stray test log, no references |
| VIDEO_GENERATION_ANALYSIS.md | VIDEO_GENERATION_ANALYSIS.md | old analysis doc, no references |

## NOT moved (needs your decision — see chat)

- **Function-level dead code** (uncalled model fns, unrouted controller fns) — listed in
  chat. Left in place because extracting individual functions from otherwise-live files
  is riskier than moving whole files.
- Already deploy-excluded dirs (`_tools/`, `_amplience/`, `misc/`, `badwords.txt`) — already
  dockerignored/gcloudignored; delete whenever, no rush.

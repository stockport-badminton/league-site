# HARD-41 — move to Node 24 so sanitize-html can be patched

**Severity:** low · **Wave:** C · **Blocked by:** nothing
**Owns:** `Dockerfile`, `cloudbuild.yaml` (the test step's image), `package.json`
(`engines`, the `sanitize-html` pin), the *`sanitize-html` is pinned* section of `CLAUDE.md`
**Source:** the Dependabot review of 11 Oct 2026, which cleared 55 of 58 alerts in
`573a654` and left these two open on purpose.

## Why

Dependabot #331 and #333 are two stored-XSS advisories against `sanitize-html` 2.17.5
(GHSA-g8qq-57p8-ggw5, SVG/SMIL URI-list bypass; GHSA-jxwj-j7wr-gfrw, `</textarea/>`
mutation XSS). The package is pinned exactly at 2.17.5 because every fixed release breaks
the Jest suite — CLAUDE.md has the history.

**What changed on 11 Oct is that the cause is now known precisely, and so is the fix.**
2.18.0 depends on `htmlparser2 ^12`, which — together with `domhandler`, `domutils`,
`domelementtype`, `dom-serializer` and `entities` — ships as ES modules only
(`"type": "module"`, no `require` condition). Then:

- **Node 22 loads it fine.** `require('sanitize-html')` works under plain Node 22, and a
  quick check stripped the SMIL payload from GHSA-g8qq. Production is not the problem.
- **Jest 30 on Node 22 refuses it before any transform runs.** It decides a file is ESM
  from its `package.json` and throws `Must use import to load ES Module`. A babel-jest
  transform with `@babel/plugin-transform-modules-commonjs` plus a `transformIgnorePatterns`
  exception for all six packages was tried and **fails identically** — the ESM check comes
  first. Not worth retrying.
- **Jest's own error names the way out:** *"Use Node v24.9+ where Jest supports
  require(esm) natively."*

So the advisories are blocked on the runtime, not on the library.

## What to do

1. Move every place that names Node 22 to Node 24 (≥ 24.9):
   - `Dockerfile` — `FROM node:22-alpine`
   - `cloudbuild.yaml` — the test step's `node:22` image
   - `package.json` — `"engines": { "node": "22.x" }`
   - the local machine (`nvm install 24`) and the memory note that says to `nvm use 22`.
2. Run the full Jest suite and Playwright on Node 24 **with 2.17.5 still pinned**, so a
   failure from the runtime change cannot be confused with one from the library.
3. Then `npm install sanitize-html@<latest> --save-exact` (2.18.0 or later; **2.17.7 is
   the floor** — 2.17.6 only closes one of the two). Keep it exact until the suite has
   been seen to pass on it; the caret can come back afterwards.
4. Check `controllers/homepageContentController.js` still renders what superadmins have
   saved — the only caller. Compare a few existing homepage items before and after, since
   a parser major can change what gets stripped.
5. Rewrite the CLAUDE.md section: the pin, and the trade it describes, go away.

## Acceptance criteria

- Dependabot #331 and #333 closed by the upgrade, not dismissed.
- Jest and Playwright green on Node 24, in CI as well as locally.
- The deployed image reports Node 24 (`/health` or a log line), checked after the deploy.
- Existing homepage content renders unchanged.

## Out of scope

- Any other dependency. The 11 Oct sweep left nothing else open bar `sprintf-js`
  (dev-only, no fix published, dismissed as #398).
- Moving the test suite to native ESM. That is the other way to make Jest load these
  packages, and a much bigger change than a runtime bump.

## Risk

Low while it waits: the only input to `sanitize-html` is a **superadmin** editing homepage
content. That stops being true the moment it sanitises anything a captain or the public
can submit — at which point this becomes urgent, and the runtime move is the work.
Node 22 is in maintenance LTS until April 2027, so this has a natural deadline anyway.

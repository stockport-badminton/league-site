---
name: hardening
description: Pick up a work package from the August 2026 hardening audit (docs/hardening). Use when the user names any package by its HARD-nn number, asks what to work on next from the audit/backlog, or asks for the status of the hardening work. Loads only the one package's brief plus the rules of engagement, so a session starts with the right context instead of exploring for it.
---

# Working a hardening package

The backlog lives in `docs/hardening/`. Two audits produced it; the findings and the
evidence are in the package files, not in anyone's memory.

## If the user named a package (e.g. `/hardening HARD-01`)

1. Read `docs/hardening/README.md` — rules of engagement and the conflict map.
2. Read the brief: `docs/hardening/HARD-<N>-*.md`, or `docs/hardening/done/HARD-<N>-*.md`
   if it has already landed. Completed packages are moved into `done/` so the top
   level lists only what is still open — a package in `done/` is still worth reading
   when you are working on something that touches the same files.
3. Read `CLAUDE.md` if it is not already in context.

**Do not read the other package files.** Each is self-contained; reading all thirteen is
exactly the waste this command exists to avoid.

Then work the package. Its *Acceptance criteria* is the definition of done and its
*Out of scope* is binding — if you find something else, add it to the backlog rather
than fixing it.

## If the user asked what to work on

Read `docs/hardening/README.md` first — the status table is the current state and is kept
up to date as packages land.

**Its numbered priority list is historical.** It ranks the original top four, and all four
are long done; it has not been renumbered as work landed, and it is not going to be. Do not
read it as a queue and do not report "everything is done" from it. What is still open is
whatever `ls docs/hardening/*.md` lists — landed packages move to `done/`, so the directory
listing IS the backlog.

To choose between them without reading all of the briefs:

1. `ls docs/hardening/*.md` for what is open.
2. Read the **conflict-map row** for each (one line, in the README): it gives the severity,
   the wave and what the package owns.
3. Read the **first 9 lines only** of the two or three that look strongest — the header
   block carries severity, blocked-by and the opening of *Why*. That is enough to rank
   them and it is a fraction of reading a brief.
4. Recommend **one**, with a sentence each on value, effort and risk. Name a runner-up if
   there is an obvious one; do not summarise the rest.

Weight these, in roughly this order:

- **Has it already fired?** A finding with a dated incident behind it beats a hypothetical.
- **Is it live this season?** Captains file results from September; a fault on that path
  costs something now, and one on the invoice path costs something in a year.
- **Is the fix shaped like one already in the codebase?** A package that reuses an
  established pattern is cheaper and much less likely to introduce a new mistake.
- **Is it investigation-first?** A brief that says "agree the diagnosis before writing
  anything" is unbounded, whatever its severity. Say so rather than recommending it as a
  quick win.

**A package whose code is done but which still needs a human — an env var, a bucket policy,
a switch flipped — stays at the top level and is not finished.** Check the status table for
that state before recommending something new; getting an almost-done package over the line
is usually worth more than starting another.

## Rules that apply to every package

- **Every fix needs a test that fails without it.** Write the test, `git stash push`
  the fix, confirm it fails, `git stash pop`, confirm it passes. Three of this year's
  bugs lived behind a green suite because this was skipped.
- **`npm test` before claiming done.** Roughly 1150 tests across 80-odd suites, ~40s; take
  the exact numbers from the run rather than from here, because a figure written down is
  wrong by the next package (this line has now been stale three times). Add
  `npm run test:e2e` if you touched anything the browser drives — two of its spec files
  write, deliberately and by name; see CLAUDE.md.
- **Never hand-write database boilerplate.** Use `tools/dbq.js`:
  ```bash
  node tools/dbq.js "SELECT id, name FROM team LIMIT 5"
  node tools/dbq.js --schema player
  node tools/dbq.js --check all          # integrity checks, before and after data work
  node tools/dbq.js --check orphan-results
  ```
  It refuses anything that is not a single read, and **it reads production**:
  `tools/lib/loadEnv.js` loads `.env` ahead of `dev.env` for every tool, so `dbq` answers
  about the live database unless you pass `--local`. (`dev.env` itself points at the local
  Postgres — that has been true since HARD-13, and the tools deliberately do not follow
  it.) A write belongs in a reviewed script under `scripts/` with a dry run, modelled on
  `scripts/backfill-contact-emails.js` — but note those scripts load `dev.env` FIRST and
  so target the LOCAL database. Check the top of any script before trusting what it
  reports.
- **Do not widen the Playwright read-only allowlist** (`e2e/helpers/read-only.js`).
- Anything hard to reverse — a production data write, a deploy — gets confirmed with
  the user first.

## Finishing

1. Commit with a message that says what was broken and how you know it is fixed.
2. Update the status table at the foot of `docs/hardening/README.md` — package, status,
   commit. That table is how the next session knows where things stand without reading
   git log.
2b. **Ask what this change just made false.** You are the only person who knows, and only
   right now. If you renamed or deleted a file, changed an env var, a route, a header name,
   a token, or a documented count, grep `CLAUDE.md docs/ .claude/skills/` for it before you
   commit. This is not hypothetical: CLAUDE.md described `dev.env` as pointing at
   production for days after HARD-13 made that false, HARD-27's brief still claimed a
   deleted guard was in force, and a skill's trigger list went stale the day a package
   moved. `__tests__/unit/docs-references.test.js` catches the mechanical half — a path
   that no longer resolves — and cannot catch a sentence that has quietly inverted. That
   half is this step.
3. Report the acceptance criteria one by one: met, or not, and why.

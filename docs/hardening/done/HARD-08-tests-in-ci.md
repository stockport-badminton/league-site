# HARD-08 — Run the tests in CI

**Severity:** high · **Wave:** A · **Blocked by:** nothing
**Owns:** `cloudbuild.yaml`
**Sources:** OPS-1

## Why

`cloudbuild.yaml` pulls the cache image, builds, pushes and deploys. **There is no test
step.** 391 Jest tests and 48 Playwright specs run only when somebody remembers.

That works while the person deploying is the person who wrote the tests. The moment it
is not, the tests stop being a safety net and become documentation of what used to be
checked — and a push to `master` goes live regardless of what it broke.

## What to do

Add a step **before** the docker build:

```yaml
- name: 'node:22'
  entrypoint: bash
  args: ['-c', 'npm ci && npm test']
```

A failing step fails the build, so nothing ships. Keep it before the build so a broken
commit does not even produce an image.

Playwright needs a running server and a database, so it does **not** belong in the
pipeline as it stands — it would point at production. Leave it as a local gate and note
that in the file. If you want it enforced, a pre-push hook is the cheap option; a real
CI database is the correct one, and that is a bigger piece of work (see HARD-13).

`npm ci` in a separate step costs a minute or so. If that matters, cache `node_modules`
between steps, but correctness first.

## Acceptance criteria

- A commit with a deliberately failing test does not deploy.
- A clean commit deploys as before.
- Build time increase is understood and noted in the file's comments.

## Tests

None — this *is* the test infrastructure. Verify by pushing a branch with a broken test
to a throwaway trigger, or by running the step's command locally.

## Out of scope

- Adding a staging environment (OPS-4) — worth doing, much bigger.
- Test coverage itself. Coverage is 38% of statements, 25% of functions; the thin spots
  are `playerController` (11%/3%), `fixtureController` (22%/11%) and
  `socialVideoController` (5%/0%). Backfill as you touch them, not as a project.

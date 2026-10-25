# HARD-49 — the machine API checks a token's signature and nothing else

**Severity:** to be established — potentially high · **Wave:** A · **Blocked by:** nothing
**Owns:** `checkJwt` in `routes/index.js`, `team_update_post` in `controllers/teamController.js`,
`Team.updateById` / `Club.updateFull` and the other key-to-column updaters in `models/`
**Source:** found 25 Oct 2026 while clearing the officer pointers (REARCH-03 part A),
looking for anything that could write them again.

## Why

**1. `checkJwt` accepts any token the Auth0 tenant has signed.**

```js
const checkJwt = jwt({
  secret: jwksRsa.expressJwtSecret({ … jwksUri: `https://${AUTH0_DOMAIN}/.well-known/jwks.json` }),
  algorithms: ['RS256']
});
```

There is no `audience` and no `issuer`. `app.js` refuses to start without
`AUTH0_AUDIENCE`, and nothing then uses it here. So a token minted for *any* application or
API on the tenant passes. That includes an ID token, if one can be got, since it is signed with
the same keys. 37 routes sit behind this gate and nothing else, including
`DELETE /player/:id`, `DELETE /fixture/:id`, `PATCH /fixture/:id`, `PATCH /game/:id`,
`POST /fixture/batch-create`, and the create/patch/delete of clubs, teams, divisions,
venues and leagues.

**Whether an ordinary member can obtain such a token is the open question.** It depends on
the tenant's other applications and their grant types, which are not visible from the repo.
Until that is answered, assume yes.

**2. `PATCH /team/:id` writes the raw request body.** `team_update_post` passes
`req.body` straight to `Team.updateById`, which builds `"${key}" = ?` for every key. So:

- any column can be set, `captain` included — which is how this was found;
- **a key is SQL text.** It is wrapped in double quotes, but a key containing `"` closes
  the identifier and continues as SQL. Values are bound; keys are not.

`Club.updateFull`, `Team.createFull` and `Club.createFull` have the same shape, but their
admin-form callers build the object from allowlists (`buildClubObj`, `buildTeamObj`), so
those are safe today. `team_update_post` is the caller that is not. Check the other
`PATCH` handlers behind `checkJwt` for the same pattern.

## What to do

1. **Find out whether anything uses these routes.** Request logs (30 days; always a
   `timestamp>=` filter — CLAUDE.md, *Asking production what is actually used*) for each of
   the 37, by method. They look like the original batch-import API. **Never delete on log
   silence alone**: corroborate with no caller in the repo, in `tools/`, and in anything
   Neil runs by hand.
2. **Add `audience: process.env.AUTH0_AUDIENCE` and `issuer: \`https://${AUTH0_DOMAIN}/\``**
   to `checkJwt`. If anything does call these routes, check its token carries that audience
   first, or the fix locks it out.
3. **Allowlist the columns** in `team_update_post`, and in any other handler that passes a
   body to a key-to-column updater. Better still, make the updaters reject a key that is not
   a known column of their table, so the next caller cannot reintroduce this.
4. Routes nobody uses go behind `access.superadmin` (REARCH-04) or are removed.

## Acceptance criteria

- A token with the wrong audience is refused (401); a test signs one with a local key pair
  and a mocked JWKS. The test fails without the `audience` option.
- `PATCH /team/:id` with an unknown key, or a key containing `"`, is refused before SQL is
  built; a test fails without the allowlist.
- What the logs said about use is recorded here, with the query.

## Out of scope

- Auth0 tenant configuration (hosting).
- REARCH-04's wider route-access declarations, which this feeds into but does not wait for.

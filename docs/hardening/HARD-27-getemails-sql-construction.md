# HARD-27 — `Player.getEmails` builds its SQL by concatenation, including the PI key

**Severity:** medium · **Wave:** C · **Blocked by:** nothing
**Owns:** `models/players.js` (`getEmails`), and whatever the distribution-list path needs
**Sources:** found 5 Sep 2026 while investigating a Gmail rate-limit bounce

## Why

`models/players.js:getEmails` is the query behind every distribution list — it resolves
`clubsecretaries@`, `division3@`, `aerospace@` and the rest into the addresses that
`POST /mail` forwards to. It builds ~1.5KB of SQL by string concatenation, and two things
in it are wrong.

**1. `DB_PI_KEY` is interpolated as a string literal, five times** — once per UNION branch:

```js
"... pgp_sym_decrypt(player.\"playerEmail\", '" + process.env.DB_PI_KEY + "')::text ..."
```

CLAUDE.md already records this pattern as fixed: *"always bind `DB_PI_KEY` as a `?`
parameter, never inline it (one query had it as a string literal until Aug 2026)"*. That
sweep missed this one. The key ends up in the query text, which means it reaches anything
that sees a statement — `console.log(sql)` on the line above (so it is in Cloud Logging on
every distribution-list send), a slow-query log, and an error message.

**Rotating `DB_PI_KEY` is not a small job**, so the value of fixing this is mostly
forward-looking: it stops the key being written to logs from here on.

**2. The `WHERE` terms are interpolated too:**

```js
if (searchTerms.role) whereTerms.push("b.role = '" + searchTerms.role + "'")
if (searchTerms.division) whereTerms.push('b.division = ' + searchTerms.division)
if (searchTerms.club) whereTerms.push("b.id = '" + searchTerms.club + "'")
if (searchTerms.teamName) whereTerms.push("b.teamName = '" + searchTerms.teamName + "'")
```

**This is not exploitable today**, and the brief should say so plainly rather than
overstate it: the only caller is `distribution_list` in `contactusController.js`, which
assigns these from hardcoded arrays (`roles`, `divisions`, `clubNames`) after matching the
envelope recipient against them. So the values are constants from the source, never the
inbound message.

It is a loaded gun rather than a wound. The next caller — a form, an admin page, a
`teamName` taken from anywhere real — makes it one, and nothing in the function signals
that its arguments must be trusted.

## What to do

1. Bind `DB_PI_KEY` as a `?` parameter in all five branches. The wrapper in `db_connect.js`
   converts `?` to `$n`, so the same value is bound five times — pass it five times.
2. Bind the four `WHERE` terms.
3. Remove or reduce the `console.log(sql)` on line 873. It exists to debug the query and
   currently prints the decryption key on every list send.
4. While in there: the function returns bare email strings, which is why one-click
   unsubscribe is not currently possible (there is no id to hang a token on). If the
   unsubscribe work in the mail package ever goes past the `mailto:` form, this is the
   change it needs — return `{ id, email, role }` and let callers map.

## Acceptance criteria

- No `process.env.DB_PI_KEY` appears in any SQL string in `models/players.js`.
- A test asserts the key is passed as a parameter and does not appear in the query text —
  the same shape as the one in `__tests__/unit/club-registration-model.test.js`.
- The distribution lists still resolve to the same addresses. This is the risk in the
  change: the query is large, five-way UNIONed, and has no test of its own. Capture the
  current output for two or three lists **before** touching it and diff after.
- Nothing logs the key.

## Out of scope

- Rotating `DB_PI_KEY`.
- Rewriting the query itself. It is long and repetitive and could be a third of the size,
  but that is a different change with a different risk, and mixing them makes the diff
  unreviewable.
- One-click unsubscribe (see the mail work); only the return shape is noted here.

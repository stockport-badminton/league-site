# HARD-23 — Make.com cannot authenticate to the invoice endpoint

**Severity:** high (it already fired) · **Wave:** B · **Blocked by:** nothing
**Owns:** `routes/index.js` (`/league/sendInvoices`), `controllers/contactusController.js`
**Source:** the annual invoice run that did not happen, 1 Sep 2026

## What happened

The annual club invoices should have gone out at 10:01 BST on 1 Sep 2026. They did not.
Nothing alerted; the run was noticed only because someone went looking.

```
2026-09-01T09:01:37Z  POST /league/sendInvoices  302  userAgent: Make/production
```

**Make.com is the caller, and it has no session.** SEC-3 (`f5f36ff`) put `secured` +
`requireSuperAdmin` on the invoice endpoints — correctly, they were unauthenticated and
mailed every club in the league — but nothing checked *who was already calling them*. So
`secured` redirected Make.com to `/login`, the controller never ran, and no invoice was
sent.

Recovered the same evening by POSTing from a logged-in superadmin browser session:

```js
await (await fetch('/league/sendInvoices', { method: 'POST' })).json()
```

18 clubs, all reported success, which is the correct number (19 club rows minus the
`No Club` sentinel; 18 clubs have teams in a division this season).

## The lesson, which is the inverse of one learned the same day

Locking down `POST /fixture/rearrangement` that morning began with a grep for its callers,
which showed the only client was a superadmin-only modal — so the change was safe. SEC-3
skipped that step, and the caller it did not look for was a scheduled automation whose
failure is invisible for a year.

**Gating an endpoint is a change to its callers, not just to its security.** The check is
the same in both directions and takes one query of the access logs.

## Why it stayed silent, and why that is the worse half

Three separate things had to line up, and all three are still true:

1. **Make.com's HTTP module treats a `302` as success.** It followed the redirect to
   `/login`, got a `200`, and recorded a good run.
2. **The controller answers `200` to a refusal.** If the date is wrong it returns
   `res.send(["not the right date for invoices"])` — a `200` whose body is the error. Any
   caller that does not parse the body sees success.
3. **The date check makes any failure last a year.** `dateCheck` requires today to *be*
   1 September. A run that fails for any reason has no second chance until the next one,
   and the endpoint will actively refuse in the meantime.

Together: an automation that reports success, an endpoint that returns 200 when it
refuses, and a one-day window. Discovery depends entirely on a human wondering.

## What to do

1. **Let a scheduled caller authenticate.** The pattern is already built and proven —
   `requireAuditCaller` in `controllers/auditController.js` (HARD-07): a shared secret in
   a header, SHA-256 then `timingSafeEqual`, and an unset variable *closes* the path
   rather than opening it. Accept either that token or a superadmin session, so the
   browser route keeps working. Reuse it; do not write a second one.
2. **Make a refusal a non-200.** `["not the right date for invoices"]` should be a `409`
   or similar, so a caller that only checks status notices. This is what would have made
   Make.com's run go red.
3. **Widen the window, or add an explicit override.** A ±3 day window, or a
   `?force=true` that a superadmin session may use, means a missed morning is recoverable
   without a code change or a browser console.
4. **Add a UI trigger.** There is currently *no* button anywhere for this — `grep -rn
   "sendInvoice" views/` returns nothing — so the only recovery path was devtools. An
   admin page with a "send annual invoices" button and a per-club result list would have
   turned a two-hour investigation into a click.
5. **Report the run into HARD-07's weekly digest**, or have it mail the treasurer on
   completion. A send that did not happen should be something the system says, not
   something someone notices.

## Acceptance criteria

- A caller presenting the correct token gets the invoices sent; one presenting a wrong or
  absent token gets a 401/403, **not** a redirect.
- A refusal (wrong date, nothing to invoice) is a non-2xx with a body explaining why.
- A superadmin can trigger the run from a page, and see per-club results.
- Tests: token accepted, token rejected, session accepted, anonymous rejected, wrong-date
  refusal is non-2xx.

## Out of scope

- Watching SES bounces for invoice delivery. Real, and it applies to the audit digest and
  every other outbound mail equally, so it wants its own package rather than being bolted
  to this one.
- Anything about the invoice content or the fee calculation.

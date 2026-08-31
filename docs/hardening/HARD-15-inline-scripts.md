# HARD-15 — Remove the inline scripts so the CSP can bite

**Severity:** medium · **Wave:** D · **Blocked by:** HARD-12 (done, `aa20cf8`)
**Owns:** `views/**/*.ejs`, new files under `static/beta/js/`
**Sources:** residual from HARD-12 (SEC-5)

## Why

HARD-12 shipped a Content-Security-Policy, but its `script-src` keeps `'unsafe-inline'`.
That single keyword is the difference between a policy that stops an injected script and
one that only stops a script being *loaded from an unlisted host*. As it stands the CSP is
defence in depth against a compromised CDN; it is not an XSS control.

It cannot simply be removed. `views/` currently has:

```
159   inline onclick= attributes        (161 inline handlers in total)
 18   templates with an inline <script> block
 28   templates referencing <script> at all
 83   templates
```

Drop `'unsafe-inline'` today and every one of those 161 handlers stops firing — the
scorecard wizard's step buttons, the roster editor's toasts, the admin forms. Silently, in
the browser console, on a Tuesday night.

**Do not reach for a nonce as a shortcut.** Adding a nonce makes the browser *ignore*
`'unsafe-inline'` entirely, and a nonce cannot be attached to an `onclick` attribute at
all — so nonces make this worse, not better, until the attributes are gone.
`'unsafe-hashes'` would need a hash per distinct handler body and has to be maintained by
hand forever. The only real answer is to move the handlers into scripts.

## What to do

This is a long tail, so do it in slices that are each independently shippable. Suggested
order, easiest and most-tested first:

1. **Pick one template and establish the pattern.** Move its `onclick="foo(this)"`
   attributes to a `data-action="foo"` attribute plus one delegated listener in a file
   under `static/beta/js/`. `static/beta/js/roster-edit.js` is the closest thing to a
   model already in the repo — event delegation off a container, no inline anything.
2. **Work outward from the pages with browser tests.** `e2e/` covers the scorecard forms,
   the roster editor and the filter toolbar (48 specs). Those pages can be refactored with
   a real safety net; the rest cannot, so extend `e2e/` *first* where you intend to touch
   something risky.
3. **Leave the inline `<script>` blocks that only configure a third party** (gtag, Sentry,
   Hotjar in `views/header.ejs`) until last, and consider moving them to external files
   served from `/static` rather than rewriting them.
4. **Only when `grep -roh "on[a-z]*=" views/ | wc -l` is zero** for the handlers you have
   claimed, drop `'unsafe-inline'` from `OBSERVED['script-src']` in
   `utils/securityHeaders.js` — still report-only — and watch `/csp-report` before
   enforcing.

## Acceptance criteria

- No behaviour change on any page that has an e2e spec: `npm run test:e2e` green, 48
  specs, before and after each slice.
- The count of inline handlers in `views/` goes down and never up. A guard test in the
  style of `__tests__/unit/no-res-send-err.test.js` is the cheap way to hold that.
- `'unsafe-inline'` is removed from `script-src` only after the count reaches zero, and
  only in the report-only header first.
- A week of `/csp-report` output with no `script-src` violations from real pages before
  `CSP_ENFORCE=true` is considered.

## Tests

- A repo guard asserting the inline-handler count in `views/` does not exceed a ceiling
  that you lower with each slice — this is the test that makes the long tail safe.
- e2e specs for each page you touch, added *before* the refactor if none exists.
- The existing `__tests__/integration/security-headers.test.js` asserts what is in
  `script-src`; update it in the same commit that changes the directive.

## Out of scope

- Enforcing the CSP. That is a separate decision with its own prerequisites, written down
  in `utils/securityHeaders.js`.
- The `style-src` `'unsafe-inline'`. 24 templates use `style=""` attributes and inline
  styles are a far weaker vector than inline scripts; finish scripts first.

## Notes

The counts above are from 31 Aug 2026 and are trivially re-measurable:

```bash
grep -roh -E "on(change|submit|click|load|input|keyup|blur|focus)=" views/ | wc -l
grep -rl '<script' --include='*.ejs' views/ | wc -l
```

---
name: emails
description: Everything about outbound and inbound mail — the MJML build pipeline and mailer.send contract, the SES event feed that says whether a message actually arrived, the POST /mail forwarder and its rate budget, and the DMARC reports. Use when touching emails/, views/emails/, utils/mailer.js, utils/ses.js, utils/dmarcReports.js, tools/build-emails.js, tools/dmarc.js, contactusController's distribution_list, or the /mail and /ses-events routes.
---

# Email

Moved out of CLAUDE.md so it loads when it is relevant rather than in every session. Four
subsystems, and almost every rule below exists because something failed **silently** —
a message that was never sent, a template that rendered half its content, a bounce nobody
saw for eight days.

## One MJML pipeline

```
emails/*.mjml  --  npm run build:email  ->  views/emails/*.ejs  --  utils/mailer.js  ->  SES
```

**The compiled `.ejs` is committed, and that is deliberate.** The Dockerfile runs
`npm ci --omit=dev` and `mjml` is a devDependency, so it never reaches the image;
production renders a plain EJS template with the `ejs` it already had. Compiling in the
image instead would make `mjml` a production dependency for the sake of a build step.
`npm run build:email:check` fails if the committed output is stale, and a test asserts it,
so editing a `views/emails/*.ejs` by hand is caught rather than silently overwritten.

**Every send goes through `mailer.send({ template, data, subject, text, whyReceiving, to })`.**
Two of its arguments are **required and have no default**, because both were missing
everywhere before:

- `text` — a plain-text alternative. No previous sender set one, and a message without it
  scores worse with spam filters and shows an empty body in a text-only client.
- `whyReceiving` — the footer's "why you got this" line, per email because the audiences
  differ. With SES a complaint counts against the domain's reputation, which is shared
  with the invoices.

**Three MJML 5 traps, all of which fail silently** (`tools/build-emails.js` documents them
at length and guards the third):

1. **The API is async.** Treating `mjml2html()` as synchronous gives an object with no
   `html` and a template containing only the banner comment.
2. **`mj-include` is disabled by default.** `filePath` alone is not enough — without
   `ignoreIncludes: false` the partials are dropped with no error, so you get a template
   with no header, footer or theme.
3. **An EJS tag *between* two MJML components is discarded**, and the content it guarded
   then renders unconditionally — `<% if (photoUrl) { %>` around an `<mj-text>` becomes a
   photo link that always shows. Wrap it in `<mj-raw>`. The build counts EJS tags in the
   source and its includes against the output and **fails** if any were eaten.

Two more that cost time here:

- **`ejs.renderFile` must be called in its promise form** in `utils/mailer.js`.
  `scorecard.test.js` mocks `ejs` with `renderFile: jest.fn().mockResolvedValue(...)`,
  which never invokes a callback — so a callback-wrapped promise never settles, and 21
  tests sat until Jest's timeout instead of failing.
- **In `mj-section`, give *every* column an explicit width or none.** With one `44px`
  column and one `auto`, MJML splits the section 50/50 rather than letting the second take
  the remainder.

`npm run preview:email` renders each template with sample data, including the no-photo and
no-stats variants that exercise the `mj-raw` conditionals. A preview is not proof: it
renders in a browser and an email renders in Outlook, which lays out through Word.

**Twelve templates**: `scorecard-received`, `website-updated`, `registration-reminder`,
`registration-digest`, `contact-us`, `scorecard-reminder`, `missing-scorecards`,
`transfer-request`, `access-approved`, `access-request`, `scorecard-photo-added` and
`messer-result`.

**Two sends are deliberately not on it, and both are listed in
`__tests__/unit/mail-sends-use-mailer.test.js` with their reason:**

| Send | Why not |
|---|---|
| the annual club invoice | still on its own hand-written `views/emails/clubInvoice.ejs` from June 2025 — off-brand (`#1188E6`, no navy) and its own piece of work |
| the weekly data-integrity digest | renders `views/emails/weekly-anomalies.ejs`, internal to the results secretary rather than member-facing |

That guard exists because this section used to say *"Every send is on the pipeline. Eleven
templates"* and it was **not true**. The signup notification (`POST /new-users-v2`) built
its HTML by string concatenation in `routes/index.js`, so it went out unstyled, with no
plain-text part and no "why you got this" line, for as long as the pipeline existed. It
was missed because it lives in a **route rather than a controller** — there was no
unstyled file in `views/emails/` to be conspicuous — and then this file asserted it had
been done, which is exactly the sort of claim that stops the next person looking.

The guard counts **call sites, not mentions**: it strips comments and strings first,
because `controllers/fixtureController.js` carries a note about `ses.sendEmail(undefined)`
that is not a send. Getting that stripping right matters more than it sounds — the first
version desynchronised on `.replace(/"/g, …)`, a regex literal containing a quote, and
reported `routes/index.js` **clean while it held the very send being hunted**. A
desynchronised scanner under-reports, so it fails in the direction that looks fine. It now
throws if a `'`/`"` run contains a raw newline, which a JS string literal cannot.

So the old rule — escape by hand with `utils/html.js` when concatenating — is **retired**
for outbound mail: a template escapes by default. The escaping tests moved with it, and
assert the *property* (a hostile URL cannot alter the message's structure) rather than an
entity spelling, since EJS writes `&#34;` where the hand-rolled escaper wrote `&quot;`.

The concatenated builders are gone with them — `generateContactUsHTML` alone was 6,966
characters of Mailchimp chrome, including dead "Unsubscribe Preferences" links, wrapped
around three lines of content. Deleting them is what most of that change is by volume, and
it is worth knowing that it took three attempts: the bodies are template literals full of
CSS, so both a `}`-at-column-0 rule and a nearest-blank-line rule cut in the wrong place.
What worked was walking the braces while skipping strings, template literals and comments.
Do that, or leave them.

Design: navy `#002060` is the league's own colour, measured off the printed registration
form, and the navy table header with white bold text is that form's own treatment — so an
emailed invoice and a posted one look related. Calibri first, then Segoe UI, then Arial,
all **system** fonts: Outlook renders through Word and ignores `@font-face`, so a webfont
would apply for some readers and not others. Size text so it fits in the *fallback*, not
just the intended face.

## Knowing whether our email arrived

`POST /ses-events` records what SES says happened to every message, into `email_event`
(migration 014). Two audit checks read it, so a failed send lands in the weekly digest:
`email-delivery-failures` (bounces, complaints, rejections in the last 7 days) and
`email-delivery-delays` (still being retried — the shape a failure has before it finishes).

It exists because of 27 Aug 2026, and the shape of that miss is the point:

- a distribution-list mail had **all eleven of its gmail.com recipients rejected** — Gmail
  rate-limited the sending domain, SES retried for 840 minutes and gave up
- **nobody knew for eight days**
- **`GetSendStatistics` reported 0 bounces**, because it was `bounceType: Transient` and
  that API counts only bounces that damage your sending reputation. Do not use it to
  answer "did our email arrive"; it answers "is our reputation at risk"
- `/admin/audit` said nothing because it only read the database

The events come from the **`baddersEmail` configuration set, which is set as the default
configuration set on the SES identity** — not in any code. Grepping for
`ConfigurationSetName` finds nothing and proves nothing.

- **One row per recipient per event.** A bounce naming eleven addresses is eleven rows,
  because the question is always "who did not get it".
- **`verifySns` gates it**, exactly as it gates `/mail`. Without it anyone could POST
  invented bounces and they would appear in the results secretary's weekly email as fact.
- **It answers 200 to a message it cannot parse.** SNS retries anything that is not 2xx,
  so a malformed notification would otherwise be retried for ever.
- The natural key `(message_id, email, event_type)` carries `ON CONFLICT DO NOTHING`,
  because SNS delivers at least once.

`tools/dbq.js` exports `assertReadOnly` and it is tested directly — including a case
asserting **every audit check passes the guard**, since a check that cannot be run by name
is otherwise only discovered by someone trying. The guard used to reject a semicolon inside
a `--` comment as "multiple statements", the same blind spot HARD-18 records for
`run-migration.js`.

## Knowing whether our mail is being spoofed (DMARC)

DMARC is published at `_dmarc.stockport-badminton.co.uk` with
`rua=mailto:dmarc@stockport-badminton.co.uk`, so the aggregate reports arrive as ordinary
inbound mail — Google and Microsoft send one a day each.

```bash
node tools/dmarc.js                 # the last 30 days, rolled up per sending source
node tools/dmarc.js --days 90       # a wider window
node tools/dmarc.js --raw --json    # the individual reports / machine-readable
```

Parsing lives in **`utils/dmarcReports.js`**, shared by that tool and the weekly audit
check so the two cannot drift.

- **The bucket and prefix come from an SES receipt rule in AWS, not from any code.**
  `inbound-badders-email` → S3 `badmintontemp/inbound-email/`. Grepping the repo proves
  nothing, exactly as it does not for the `baddersEmail` configuration set.
- **Header order varies between reporters.** Microsoft puts `Content-Disposition` *after*
  `Content-Transfer-Encoding`; Google does not. A regex anchored on the encoding header
  matches Google and silently skips Microsoft — and the symptom is "Microsoft isn't
  reporting", which reads as a DNS problem rather than a parsing bug. Find the blank line
  that ends the part's headers instead. Google sends `.zip`, Microsoft `.gz`; handle both.
- **DMARC passes on *either* aligned leg**, so the verdict is an OR. Read as an AND, every
  SPF-broken forward — normal and harmless — reports as a failure.
- **`aspf=r` is load-bearing, do not "harden" it to `s`.** SPF authenticates
  `mail.stockport-badminton.co.uk` (the SES custom MAIL FROM) while `From:` is the apex;
  strict alignment would fail SPF on every message we send.
- The policy is **`p=none`** — monitoring only, enforcing nothing. The point of the reports
  is to leave it: `p=quarantine; pct=25` → `pct=100` → `p=reject`. What blocks that is a
  legitimate sender that does not authenticate, which is what the check below looks for.
  Note `fo=1` in the record is inert while there is no `ruf=`.

**The weekly digest reports only the failures** (`dmarc-unauthenticated-senders`, in
`tools/audit/checks.js`). A row means either somebody is sending as our domain and is not
us, or a real sender that tightening the policy would start binning. The passing rows stay
in `tools/dmarc.js`: a weekly "26 of 26 passed" is the noise the digest exists to avoid.

**This is the one audit check that is not SQL.** It brings a `run()` instead of a `sql`,
because the question — did the receiving world accept our mail as authentic — cannot be
answered from our own tables at all. `checks.runAll` and `dbq --check <name>` handle both
shapes; `__tests__/unit/dbq-guard.test.js` skips the read-only guard for a `run()` check
but asserts it really is one, so a SQL check whose query went missing still fails.

## Forwarding inbound mail (`POST /mail`)

A reply to `results@stockport-badminton.co.uk` arrives via SES inbound and is forwarded to
the league's distribution lists by `distribution_list` in `contactusController.js`.

**The From header stays ours, and it has to.** This is a forwarder: sending as
`someone@gmail.com` out of our SES account fails SPF and DKIM alignment for *their* domain,
and a sender whose domain is on `p=reject` would have the forward binned rather than
delivered. So the sender's identity travels in the two places it can:

- **display name** — `From: "Anne Secretary" <results@stockport-badminton.co.uk>`, falling
  back to their address when they set no display name
- **`Reply-To`** — the original sender, or the original `Reply-To` if they set one

This is what a mailing list's "via" means. Before it, `from` was the flat league address and
`sender` was computed and never used, so every forwarded message looked as though the league
had written it and Reply went back to the league — a loop, with the correspondent's address
lost unless you dug through the body. `X-Original-From` carries it for the record.

`text` was also a debug string (`"Email from sengrid parse send to <list>"`), so the plain-text
alternative of every forwarded message was that sentence — which is what a text-only client
and most spam scorers read.

**A list send is spread over time, and the budget is SNS's.** On 27 Aug 2026 a list mail
to 30 recipients had **all eleven of its gmail.com addresses** rejected with
`421-4.7.28 unusual rate of mail originating from your SPF domain`; SES retried for 840
minutes and gave up, so eleven people never got a fixture withdrawal notice. The complaint
is about **rate** — the same eleven messages reach Gmail whether it is one Bcc blast or
eleven sends, because SES expands Bcc into one delivery each — so only spreading them over
time answers it. `sendSpread` chunks the recipients and fits the gaps to a budget
(`LIST_SEND_CHUNK`, `LIST_SEND_BUDGET_MS`), because **SNS gives an HTTP endpoint ~15
seconds** before it calls the delivery failed and retries, and a retry means sending the
whole list again. A long list gets bigger chunks, not a longer wall clock. Doing it after
the response would dodge the budget but Cloud Run throttles CPU once a request is answered.
It is a mitigation, not a guarantee: Gmail publishes no threshold, which is why both knobs
are env vars.

**That bounce is invisible to `GetSendStatistics`.** It was `bounceType: Transient`, and
that API counts only bounces that hurt reputation — so "0 bounces in 14 days" from it means
"none that count", not "everything arrived". The SNS event destination is where the truth
is: `baddersEmail` is set as the **default configuration set on the SES identity**, not in
any code, so grepping the codebase for `ConfigurationSetName` finds nothing and proves
nothing.

**`List-Unsubscribe` is the `mailto:` form, deliberately.** These lists are not
subscriptions — membership is computed at send time from role flags in `player`
(`Player.getEmails`), so nobody opted in, and unsubscribing a club secretary from
`clubSecretaries@` means they stop receiving league business. That is a decision for a
person, not a one-click POST. One-click would also force the rest of the redesign: its
token identifies ONE recipient, so the header differs per person and the message can no
longer be one blast with everyone in Bcc, and `getEmails` would have to return ids rather
than bare address strings (HARD-27).

**List matching is case-sensitive and by substring** — `roles` are spelled
`clubSecretaries`, divisions `division3`. A lowercase `clubsecretaries@` matches nothing
and falls through to the default branch, which mails only the league's own address.

Testing it: build the MIME by hand and post it base64'd inside the SNS `Message`. Two traps,
both of which parse far enough to look fine and then lose the body — **send it as JSON, not
form-encoded** (form encoding turns the base64's `+` into a space), and **do not
`.filter(Boolean)` the lines** (the empty strings are the blank lines that terminate a
header block).

## Rules that stayed in CLAUDE.md, and still apply

- **A notification must not be able to fail the write it is reporting** —
  `utils/afterCommit.js`. Every post-commit send goes through it.
- **Anything unauthenticated that sends email must derive its recipients server-side.**
  `/fixture/reminder` took the address from the request body and was an open relay from our
  own verified domain.
- **Never build a URL from `req.get('host')`** — emailed links included. Use
  `absoluteUrl()` / `confirmationUrl()` from `utils/canonical.js`.

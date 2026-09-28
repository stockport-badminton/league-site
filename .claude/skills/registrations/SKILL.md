---
name: registrations
description: The league's player-registration paperwork — which of the three registration documents is which, how the team registration docx is built, and the /admin/registrations chase-and-digest flow with its season-keyed status, the registrations@ email queue at /admin/player-requests, and the fuzzy player-name matching every player search uses. Use when touching utils/teamRegistrationDoc.js, documentsController, registrationController, playerRequestController, utils/registrationEmail.js, utils/nameMatch.js, the /forms/* routes, /admin/registrations, /admin/player-requests, or the club_registration and registration_request tables.
---

# The league's registration forms, and chasing them

Moved out of CLAUDE.md so it loads when it is relevant rather than in every session.

## Which document is which

Two different documents, easily confused:

| Route | What |
|---|---|
| `/manage-players/club-:club/registration.docx` | the roster page's own export, built by `buildRegistrationDoc` in `rosterController.js` |
| `/forms/team-registration.docx` + `/forms/team-registration/:club/prefilled.docx` | **the league's official player registration form** |
| `/forms/club-registration` + `/:club/prefilled` | the club form — still a PDF |

**The team registration form is a Word document, not a PDF** (Sep 2026). It was a
prefilled `pdf-lib` AcroForm, and the reason that failed is worth keeping: an AcroForm
has a **fixed set of named fields**, so a club secretary could type into the twelve rows
but could not add a thirteenth or delete one for a player who had left — which is the
entire job. The workaround had grown into three code paths (fill the static 12 rows;
tack a "(continued)" page on for reserve overflow; blank page 1 and redraw both tables
when nominated overflowed). A Word table just grows, so **all of that is gone from the
docx path**.

- Built in **`utils/teamRegistrationDoc.js`** with the `docx` package. `seasonLabel`,
  `teamLabel`, `alignTeamRows` and `splitRoster` live there and are shared with the PDF
  controller so the two renderings cannot drift.
- **The PDF routes still answer** (`/forms/team-registration`, `.../prefilled`) for
  anyone holding an old link. Nothing links to them.
- Pass **`columnWidths` with DXA widths**, not the `PERCENTAGE` convention used by
  `rosterController.buildRegistrationDoc`. `docx` defaults `<w:tblGrid>` to 100 twips
  per column when you omit it, which under `layout: FIXED` collapses the table; and
  percentages are an autofit instruction, so a long name widens the Ladies column out
  of register with the paper form.
- Header rows carry `tableHeader: true` so they repeat across pages, and every row
  carries `cantSplit`.
- The logo is `static/beta/docs/sdbl-logo.png`, cropped from a 300 dpi render of the
  PDF template — the template's two embedded objects are a transparent figure and a
  JPEG swoosh that only compose correctly together, so extracting them individually
  gives you half a logo.
- Colours and fonts were measured from the template, not guessed: fill and heading
  text are **`#002060`** (the old dynamic PDF renderer used `#0B2D6D`, which was
  slightly wrong), Calibri throughout, 22pt masthead / 14pt headings / 12pt table
  headers / 11pt body.
- Tests unzip the response and assert against `word/document.xml`. Asserting on the
  buffer or on which function was called would not have caught the geometry bugs.

## Chasing player registrations

Every club returns the league's registration form before its first fixture, and that used
to be chased from memory. `/admin/registrations` (superadmin, in the Admin nav) lists every
club with a fixture this season, its first match, and whether the form is in.

| | |
|---|---|
| `GET /admin/registrations` | the working page — chase, mark received, download the form |
| `POST /admin/registrations/:club/chase` | emails the club its prefilled form |
| `POST /admin/registrations/:club/received` | mark received (`received=false` to undo) |
| `GET /admin/registrations/digest` | preview the daily email, sends nothing |
| `POST /admin/registrations/run` | the daily send, for Cloud Scheduler |

**Status is keyed by season, and that is the whole design** (`club_registration`, migration
013). The job runs once a season, so the status has to reset every season — and the
cheapest correct reset is none at all: a new season simply has no rows, which reads as
"nothing received, nothing chased". No cron to clear it, nothing to remember in July, and
last season's record is still there. A `received` boolean on `club` would have needed
exactly the annual wipe nobody would remember to run.

- **Recipients are derived server-side** from the club's own officers — club secretary, cc
  match secretary, falling back to whoever has an address. Never from the request:
  `/fixture/reminder` took its address from the body and was an open relay from our own
  verified domain.
- **The attached form is built in-process** by `documentsController.buildPrefilledRegistrationDocx`.
  Fetching our own `secured` URL over HTTP would have needed a server-side credential that
  need not exist.
- **A chase is blind-copied to `REGISTRATION_EMAIL_TO`** (falling back to the results
  mailbox), so there is a filed record of what went out without waiting on SES's own
  notifications. Bcc rather than Cc — the reply-to is already the results mailbox.
- **`sendRawEmail` passes `Destinations` explicitly, and must keep doing so.**
  `MailComposer` strips the `Bcc` header (correctly), and with no `Destinations` SES works
  out delivery from the headers — so a blind copy is silently dropped: the send succeeds,
  SES reports success, To and Cc get their mail, and the copy never exists.
- **An attachment cannot go through SES's `SendEmail`** — SES only accepts one as a complete
  MIME message. `utils/ses.sendRawEmail` composes it with nodemailer's `MailComposer` (already
  a dependency) and posts it with `SendRawEmailCommand`. `mailer.send` picks the transport
  from whether `attachments` is non-empty, so templates, the required `text`/`whyReceiving`
  and the rendering stay shared.
- **The digest sends nothing when nothing is outstanding.** A daily "nothing to do" trains
  the reader to ignore it.
- `fixture.date` is a `timestamp without time zone` holding **local midnight**
  (`2026-09-03 00:00:00`), so compare it to `CURRENT_DATE` directly. Converting
  `AT TIME ZONE 'Europe/London'` shifts every match a day earlier and puts league nights on
  a Sunday. Note `tools/dbq.js` **prints** these an hour early — it renders through a JS
  `Date` — so ask SQL for `to_char(...)` when you need to know what is really stored.
- **A moved match does not set the deadline.** The status query excludes `rearranged`
  *and* `rearranging` — the club is not playing that night, so registrations are not due
  by it. Written as `(f.status IS NULL OR f.status NOT IN (...))`, deliberately: a bare
  `NOT IN` evaluates to NULL for a NULL status and drops the row, which would take a
  club's earliest fixture and its deadline with it.

## Registration requests by email (`/admin/player-requests`)

A different job from the chase above: that one collects a *club's form* once a season,
this one handles the steady trickle of "please register X" emails from secretaries,
captains and players themselves, often several names to a message. They used to be read
out and typed into the roster editor by hand.

```
forward to registrations@stockport-badminton.co.uk
  -> SES inbound -> POST /mail (contactusController.distribution_list)
  -> playerRequestController.queueFromEmail -> registration_request (migration 020)
  -> /admin/player-requests/:id: the email beside the people read out of it
```

- **Nothing is applied from the email.** `utils/registrationEmail.js` makes a first
  reading (names, gender, the team if the email names one we know) and every line is
  shown editable, with Skip. The buttons call the roster API the club pages use —
  `/api/roster/club-:club/players` to create, `/transfer` to move someone on file, which
  for a superadmin applies at once and re-homes their club. There is still one way to
  write a player; this page only records which button was pressed, per person, in
  `candidates[i].outcome`.
- **A refusal falls through to the ordinary forward.** Sender not in
  `REGISTRATION_INBOX_SENDERS`, SPF and DKIM both failing, DMARC failing, or the address
  also sent to a list: the message is forwarded to the results inbox as it always was.
  The new path can queue mail; it cannot lose it.
- **The writer is inside the body**, because the emails are forwarded. `originalFrom` is
  read out of the forwarded block (Gmail, Outlook and Apple Mail markers).
- **Reading stops at the sign-off**, not at the sender's name. Excluding the sender's own
  name looked like the way to skip "Thanks, Jane Secretary" and would have dropped exactly
  the player who writes in to register themselves.
- **Attachments are listed, not read.** A spreadsheet or a filled-in form is opened from
  the original email; the page says it exists so it is not missed.
- Matching is `utils/nameMatch.js` — see below.

## Finding a player who is already registered

Every player search (`Roster.findCandidates` behind the roster add dialog,
`Player.searchPlayers` behind `/api/players/search`, and the request page) goes through
`utils/nameMatch.js`. It was `ILIKE '%term%'`, so "Mary Whitle" could not find the
"Marry Whitle" on file, the dialog offered to create her, and that is how the table came
to hold Wahab Siddiqi *and* Wahab Siddiqui plus eight exact duplicates (measured 28 Sep
2026). Order-, accent- and nickname-tolerant, with a per-word edit allowance.

**The allowance was tuned against the live table and should be re-measured, not
nudged.** Across ~1,200 players the current rules pair six names, all plausibly the same
person; two edits from five letters pairs 27, mostly strangers ("Ryan" ~ "Brian"). A
self-join with `matchName` over every same-gender pair is the measurement.

`POST /api/roster/club-:club/players` answers **409 with `possibleDuplicates`** when the
name looks registered already, and the client resends with `confirmNew: true` after
showing them. Only `exact` and `close` count; a name that merely *contains* this one
("Tom Longworth") would be noise.

## Related

`REGISTRATION_EMAIL_TO` and `REGISTRATION_CRON_TOKEN` are documented in CLAUDE.md's
Environment Variables section. **Unset closes each path rather than opening it**, which is
why they are unset locally.

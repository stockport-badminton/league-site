# HARD-22 — Stop the bucket drifting public again

**Severity:** low · **Wave:** C · **Blocked by:** nothing, but see *Ordering* below
**Owns:** AWS bucket settings on `badmintontemp`. **No repo code** except one optional tidy.
**Source:** step 4 of HARD-02b, pulled out once steps 0–3 landed (1 Sep 2026)

## Why

HARD-02b step 3 made 1,454 objects private, one ACL at a time. That fixed the objects
that existed on 1 Sep 2026 and nothing else. Two ways it comes undone:

- a writer that sends `ACL: 'public-read'` again — that is how the bucket got this way,
  and both leagues' `/sign-s3` did exactly this until recently;
- someone re-running an old script, or a hand-made upload from the console.

The durable fix is to stop ACLs mattering at all. **Object Ownership = `bucket owner
enforced`** disables object ACLs bucket-wide, so "public-read" becomes unexpressible
rather than merely unused. **Block Public Access** is the adjacent lever and blocks public
*policies* too.

This is genuinely optional. The bucket is private today and nothing is broken. It is worth
doing because the alternative is trusting that four writers across two repositories all
keep behaving, forever, with no mechanism to notice if one stops.

## Ordering

Not a hard block, but do **[HARD-21](HARD-21-social-video-read-proxy.md) first.**

The weekly videos are the one thing in the bucket with no credentialed reader. They are
*already* private and the Make.com handoff is *already* broken (HARD-21 explains why), so
this package does not make anything worse — but locking the bucket down while a feature
still has no way to read from it is the kind of thing that gets misdiagnosed later as
"the lockdown broke the videos". Fix the reader, then lock.

## Preconditions — all verified 1 Sep 2026, re-verify before acting

**Every writer must stop sending an ACL**, or `bucket owner enforced` fails their upload
outright with `AccessControlListNotSupported`. This is a *write* dependency, which is why
it is easy to miss when reasoning about a change framed as being about reads.

| Writer | ACL? |
|---|---|
| `routes/index.js` `/sign-s3` (presigned PUT) | none — dropped by HARD-02b |
| `utils/venues-map-generator.js` | none |
| `controllers/socialVideoController.js` (video + `.generating` lock) | none |
| Tameside's `/sign-s3` | none — dropped 1 Sep, and now `secured` |

`grep -rn "ACL" utils/ controllers/ routes/ app.js` returns nothing in this repo. Tameside
verified theirs by checking the presigned URL's `X-Amz-SignedHeaders` is `host` alone.

**Everything that must stay readable must already read with credentials:**

| Thing | Reader |
|---|---|
| Stockport scorecard photos | `GET /scorecard-photo/:id` |
| Tameside scorecard photos | their own `GET /scorecard-photo/:id` |
| Venues map | `GET /static/generated/venues-map.png` in `app.js` |
| Inbound email | never served to a browser |
| OCR cache | never served to a browser |
| **Weekly videos** | **none — HARD-21** |

## The one ask from the Tameside side

**Tell them before switching Object Ownership.** It is their explicit request, recorded in
[`docs/handover/tameside-s3-bucket-reply.md`](../handover/tameside-s3-bucket-reply.md).
They are compatible as of their 1 Sep deploy, but if the two changes had gone in the other
order it would have broken their uploads rather than their displays — and a broken upload
is far harder to spot from this side than a missing image.

## What to do

Each step reverses cleanly. Do them in order and check between.

**1. Re-verify the preconditions above.** The table is a snapshot; treat it as a checklist,
not a fact.

**2. Confirm the SES policy is not caught by this.** The bucket's only policy statement is
`AllowSESReceiptWrite`, granting `s3:PutObject` on `inbound-email/*` to
`Principal: {Service: ses.amazonaws.com}` with an `aws:SourceAccount` condition. A
service principal with a condition is **not** a public policy, so `BlockPublicPolicy` and
`RestrictPublicBuckets` should leave it alone — but *should* is not *did*.

Test it with `node tools/check-inbound-email.js --watch`, which lists what is already
there, then waits for a new object to appear under `inbound-email/`:

```bash
node tools/check-inbound-email.js --watch      # then send the email it tells you to
```

**Why watch S3 rather than just checking your inbox.** The app fetches the raw MIME from
S3 *with credentials*, so no lockdown can break the read; what a lockdown could break is
SES's ability to **write**, which is the `AllowSESReceiptWrite` statement. A failed write
is invisible from an inbox — the mail simply never arrives, with nothing to look at. A new
object appearing is the assertion that matters, and it isolates the bucket from the rest
of the chain: object present but no mail means SNS → `POST /mail` → SES send, not this
package.

**Send to a local part that maps to nothing** — `bpa-test@stockport-badminton.co.uk` will
do. The receipt rule is domain-wide, so anything at the domain triggers it, and an
unmatched local part forwards only to the owner's own plus-addressed inboxes. Avoid
`clubSecretaries`, `matchSecretaries`, `teamCaptains`, `treasurers`, `leagueComms`,
`Premier`, `division1`–`division3` and any club name: those fan out to real league
members. The tool prints this warning too.

Inbound email breaking silently is the worst outcome available here, which is why it gets
a tool rather than a sentence.

**Baseline taken 1 Sep 2026, before any of this package ran: the whole chain works.** A
test send landed a new object under `inbound-email/` *and* arrived in the owner's inbox,
so both halves — SES's write and the SNS → `POST /mail` → forward — were healthy going in.
That is the reading this package is measured against. If the same test fails after step 3
or 4, the lockdown did it; there is no ambiguity left about whether it was already broken.
(HARD-02b's own sweep could not have affected this: it was scoped to the bucket root and
never touched the `inbound-email/` prefix.)

**3. Object Ownership → `bucket owner enforced`.**
```bash
aws s3api put-bucket-ownership-controls --bucket badmintontemp \
  --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
```
**Reverse:** the same call with `ObjectOwnership=ObjectWriter`. Note that reverting
restores the *setting*, not any ACL — ACLs are discarded while it is enforced, so
HARD-02b's `scripts/hard02b-acl-before.json` rollback stops being meaningful once this
lands. If there is any chance of wanting that rollback, do it before this step.

**4. Block Public Access.**
```bash
aws s3api put-public-access-block --bucket badmintontemp \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```
**Reverse:** `aws s3api delete-public-access-block --bucket badmintontemp`. Effective in
seconds, and unlike step 3 it destroys nothing.

**5. Verify.** `node tools/scorecard-photo-audit.js` must still report **1,456 servable,
0 refused** — it reads with credentials, so this is the assertion that the lockdown did
not touch the read path. Then load a scorecard photo, a PDF scorecard and the venues map
through the site, and upload one scorecard end to end.

## Acceptance criteria

- Object ACLs cannot be set on the bucket; a `put-object-acl --acl public-read` is refused.
- `tools/scorecard-photo-audit.js` unchanged: 1,456 servable, 0 refused.
- A scorecard photo, a PDF scorecard and the venues map all still load through the site.
- A new scorecard upload still succeeds, on **both** leagues' sites.
- Inbound email still arrives: `node tools/check-inbound-email.js --watch` sees a new
  object land after a test send.

## Out of scope

- Deleting the 406 unreferenced objects, and lifecycle rules on them. Still the right
  answer to the storage residual, still not this package.
- Moving Tameside to its own bucket. They declined it for now, with reasons.
- The 21 dead `scoresheet-url` rows.

## Optional tidy, while in the area

`/sign-s3` returns `url` as a public bucket URL and the upload page stores it in
`scoresheet-url`. That URL now 403s. Nothing is broken — `photoKeyFromStored` re-derives
the key, and it already accepts a bare key — but the column is accumulating URLs that no
longer mean what they say. The endpoint already returns `key` alongside `url`, so storing
that instead is close to a one-line change. Cosmetic, and explicitly not required by
anything above.

Also noticed: `views/messer-scorecard.ejs.backup` still contains the old
`<img src="<%= scorecard['scoresheet-url'] %>">` that step 3 would have broken. It is a
`.backup` file and is never rendered, but it is a live copy of a pattern that is now
wrong. Deleting it is a separate, trivial call.

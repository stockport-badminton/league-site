# HARD-21 — The weekly social video has never worked, in three separate ways

**Severity:** low · **Wave:** C · **Blocked by:** nothing
**Owns:** `controllers/socialVideoController.js`, `utils/metaPublisher.js`, routes
**Source:** found auditing the bucket for HARD-02b, 1 Sep 2026.
**Re-briefed 19 Sep 2026** — the original package solved a problem that no longer exists,
and running the feature for the first time turned up two more faults.

## The premise changed, and the decision is to rebuild

The package as written said: `GET /api/social/generate-weekly-video` answers with a public
bucket URL that 403s, so give Make.com a URL it can fetch. **Make.com is gone** — every
scenario disabled 15 Sep — and nothing has called this endpoint since. Zero requests in the
whole 30-day log window; the only references in the codebase are its own route definition
and docstring; nothing links to it.

So the question was whether to delete it or finish it. **Decision (19 Sep): finish it** —
the video posts to Meta itself, the way results, tables and fixtures now do.

## What running it for the first time found

The objects in S3 were dated **27 May 2026** — one development run, four months earlier.
Calling the endpoint on production on 19 Sep produced three findings.

### 1. A stale lock deadlocks the feature permanently

The first call answered `202 — "Video generation in progress by another instance"`. There
was no other instance. The `[DEDUP]` trace says it plainly:

```
Lock file exists! Age=9963441s (lockTimeout=120s)
Lock file is stale (9963441s > 120s), proceeding with generation
Proceeding with generation (breaking loop)
Creating lock file to signal other instances...
Lock file already created by another instance, checking for new videos...
```

The stale-lock branch **recognised** the lock and did not **delete** it. The atomic create
that follows uses `IfNoneMatch: '*'`, which fails if the object exists at all — stale or
not. So one interrupted run kills the feature for ever, and reports it as a concurrent run
that does not exist.

The encode takes ~36s on Cloud Run, so a scale-down, a deploy or a timeout mid-generation
is not exotic. Something did exactly that on 27 May and the endpoint answered 202 for
**115 days**. **Fixed**: the stale branch deletes the lock before proceeding.

### 2. The slides were stretched, not letterboxed — and two bugs hid each other

One `convert` invocation, two faults:

- **`-resize 1920:1080`** — a colon is an **aspect ratio** in ImageMagick geometry, not a
  size. It forces the image to 16:9 by distorting it. A 1080x1350 result card came out
  **1080x608**, a third of the intended pixels, with every word visibly stretched.
- **`-extent` before `-gravity`/`-background`** — those only affect operators that come
  after them, so the padding used ImageMagick's defaults: **NorthWest, and white**.

The second was invisible because of the first: `-resize` with a ratio had already forced
the exact target aspect, leaving `-extent` nothing to pad. **Correct the colon alone and
the card lands top-left against white bars**, which is worse than what shipped.

The 1:1 output looked right throughout, by coincidence — ratio 1:1 of a 1080-wide image is
1080x1080, exactly the size intended. Only 16:9 showed the damage, and nobody had looked.

**Fixed**, with `letterboxArgs()` extracted so the order is asserted without ImageMagick
present: `__tests__/unit/social-video-letterbox.test.js`.

### 3. The bucket URL still 403s — **fixed 20 Sep, phase 1**

The original finding. `uploadVideoToS3` sets no ACL and no bucket policy grants
public read, while the handler returns `https://<bucket>.s3.eu-west-1.amazonaws.com/…`.
Replaced by `GET /social-video/:aspect`, which streams the object through our own domain.
The objects stay private.

## What to do

### Phase 1 — make it reachable, and close the open encode — **DONE 20 Sep 2026**

`GET /social-video/:aspect` (`serveWeeklyVideo`), `requireSocialCaller` on the generator,
and `socialVideoPath()` in `utils/canonical.js` so the URL is built in one place like every
other media URL on the site. `__tests__/integration/social-video-read.test.js`.

**One thing that test got wrong first, and it is the reusable part.** The traversal cases
asserted only a 404 — which a handler interpolating `req.params.aspect` straight into the
key would *also* return, because the mocked bucket holds no such object. It passed against
the vulnerable version. It now asserts **the key that actually reached S3**, which is the
only form of the question that tells the two implementations apart. Same mistake as the
"different divisions use different backgrounds" test on the fixtures card: asserting an
outcome that both the fix and the bug produce.

The original steps, for the record:

1. `GET /social-video/:aspect`, aspect constrained to `16-9` / `1-1` resolving to two known
   keys. **Never take a key from the request.** Copy `/scorecard-photo/:id`, which attaches
   an `'error'` listener to `obj.Body` before piping — a mid-transfer failure is otherwise
   an unhandled EventEmitter `'error'` and takes the instance down (gotcha 2c). The
   venues-map route omits that; do not copy it.
2. `mediaLimiter`, as `/scorecard-photo/:id` uses. These are 1–2MB objects on a route that
   must stay unauthenticated, because **Meta fetches it from Meta's servers**.
3. Return that URL from the generate endpoint, built with `absoluteUrl()` — never
   `req.get('host')`, which behind Firebase is the Cloud Run hostname (gotcha 1b).
4. `Cache-Control: public`, short max-age. Nothing here is private; it is about to be
   posted. A 404 must be `no-store` — Meta retries, and a cached miss outlives the fault.
5. **Gate `/api/social/generate-weekly-video`** with `requireSocialCaller`, like the other
   social routes. It currently lets anyone on the internet trigger an ffmpeg encode on
   Cloud Run, repeatedly. The S3 lock blunts that and is not an authorization control.

### Phase 2 — ask Meta what it accepts — **DONE 20 Sep 2026, and all three worries were wrong**

Measured with the free tests: an Instagram media container asks Meta to fetch and validate
the video and publishes nothing (it expires in 24h), and a Facebook video with
`published=false` uploads and stays invisible. Both aspects, both platforms:

```
16-9   instagram REELS : container 18352028341301893 -> FINISHED
       facebook video  : accepted, unpublished (deleted)
1-1    instagram REELS : container 18352028470301893 -> FINISHED
       facebook video  : accepted, unpublished (deleted)
```

This package previously listed three things that "need answering and none should be
guessed". All three were guessed wrong:

| Worry | Reality |
|---|---|
| Reels wants 9:16, so 16:9 and 1:1 may be refused | **Both reach `FINISHED`.** 9:16 is a preference, not a requirement |
| No audio track — Reels is fussy about this | **Not fussy.** Both transcoded with a silent track |
| A 4:5 source letterboxed into 16:9 then into 9:16 would be bars inside bars | True of how it *looks*, and irrelevant to whether it is accepted |

**`FINISHED` means Meta will accept and publish it. It does not mean it looks good** — and
that is the only question the container test cannot answer. A 16:9 video in a Reels slot is
still pillarboxed twice over. Acceptance and presentation are different questions, and it
was easy to conflate them while the feature was unfetchable and neither could be asked.

**So what remains is editorial, not technical.** The source cards are 1080x1350 (4:5), the
same portrait card as results and fixtures. A video rendered at 4:5 would need **no
letterboxing at all** — no bars, every pixel content — and 0.8 is comfortably inside the
range Reels accepts. The two aspects that exist were chosen before any of this was
measurable, and 16:9 in particular is a landscape frame carrying portrait content. Adding a
4:5 render to `VIDEO_KEYS` and dropping 16:9 is probably the right shape, but it is a
decision about how the league's posts should look, not a constraint Meta imposes.

### Phase 3 — publish — **DONE 20 Sep 2026**

`utils/metaPublisher.js` gained the video path: `publishInstagramReel`, `publishPageVideo`,
`validateVideo` (the dry run) and `publishVideoEverywhere`, which keeps the same per-target
contract as the photo one. `controllers/weeklyVideoController.js` posts it, gated by
`requireSocialCaller` on the same `SOCIAL_CRON_TOKEN` as the other two weekly posts, with a
`?dry=1` and a preview page.

**Video is not photo-with-a-different-field**, and that is why it is separate functions
rather than a flag. A photo container is usable the moment it is created; a video container
has to be fetched and transcoded by Meta first, so `waitForContainer` polls `status_code`
until `FINISHED`. Publishing early fails with container-not-ready.

**Posted at 4:5 to both platforms.** The slides are 1080x1350 result cards, so 4:5 carries
them with no letterboxing at all — verified by rendering one and checking the output's
corner pixels are the source's, not black, with an RMSE of 0.16% (JPEG re-encode noise).
16:9 is gone: a landscape frame around portrait content, most of its width black bars.

**A stale video is refused, not posted.** The handler posts whatever is in the bucket and
the bucket keeps the last render for ever — so a generation that did not happen would
publish **last week's results as this week's**, under a caption saying so. Worse than
posting nothing, and the same class of silent wrongness this feature had already produced
twice. `videoFreshness()` reads `LastModified` and refuses anything older than two days
with a 409 naming the step that was missed. The dry run is refused too: validating a stale
video against Meta would report "ok" for something that must not go out.

### Still to do: orchestration

Generating and posting are two calls, and the post refuses if the first has not run. So the
scheduler needs **generate, then post** — either two jobs a few minutes apart, or the
handler calling the generation internally. Two jobs couple them by wall-clock time, which
is fragile; folding generation into the handler makes one request take ~60s, which fits
inside both Cloud Run's timeout and the scheduler's 300s `attemptDeadline`. **Not decided.**
The freshness guard means the failure mode of getting it wrong is a loud 409 rather than a
stale post, which is why it was worth building before the orchestration.

## Acceptance criteria

- `GET /social-video/16-9` and `/social-video/1-1` return `200 video/mp4`.
- The generate endpoint returns URLs on our own domain and no `*.s3.*.amazonaws.com` URL.
- An unknown aspect is a 404 with `no-store`, and no request-supplied string reaches `Key`.
- The generate endpoint answers 403 to an anonymous caller.
- The objects stay private in S3. **Do not "fix" the 403 by adding `ACL: 'public-read'`.**
- An interrupted run does not brick the feature — the stale lock is cleared, not just noticed.
- Slides are letterboxed, centred, on black.

## Out of scope

- Making the video objects public. That is the thing this package exists to avoid.
- Block Public Access on the bucket (HARD-02b step 4) — and note **HARD-22's ordering note
  points here**: it says to fix the reader before locking the bucket so nobody later
  misdiagnoses "the lockdown broke the videos".

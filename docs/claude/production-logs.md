# Asking production what is used

Moved out of `CLAUDE.md`, word for word, so that file holds only the rules most tasks need.

## Asking production what is actually used

Cloud Run request logs are the only honest answer to "does anybody use this route", and
they go back **30 days, not four months**. Measured 14 Sep 2026: the `_Default` log bucket
has 30-day retention and the oldest request log was exactly 30 days old. The four-month
figure that used to be here came from reading the oldest entry for the service, which is a
Cloud **Audit** log — those live in `_Required` at 400 days and record admin activity like
deploys, not requests. Two buckets, two retentions, one `resource.type`.

That makes the rule below more important rather than less: a month is a short window to
conclude "nobody uses this" from, and a season that started three weeks ago is most of it.

**Always put a `timestamp>=` constraint in the filter:**

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="league-site"
   AND httpRequest.requestUrl:"/some-route" AND timestamp>="2026-05-01T00:00:00Z"' \
  --project stockport-badminton-map --account stockport.badders.results@gmail.com \
  --limit=5 --format="value(timestamp,httpRequest.requestMethod,httpRequest.status)"
```

**`gcloud logging read` applies `--freshness=1d` unless the filter contains a timestamp
constraint.** Leave it out and an empty result means "nothing in the last 24 hours", which
reads exactly like "nothing, ever" — and it is the answer you get right before you delete
something. It happened here on 10 Sep: an audit of 31 routes reported the whole Messer
submission and approval flow as unused, when it had run a week earlier (Shell B v
Remnants A, 2 Sep, approved 4 Sep). Three routes were deleted in the same pass and
survived review only because the case for those rested on code evidence as well — nothing
referenced them and the page was linked from nowhere.

So: **never delete on log silence alone.** Corroborate with something that does not depend
on a time window — no references anywhere, unreachable by navigation, a table with no
rows. And note that the dev server writes to the production database while logging
nothing to Cloud Run, so a row can exist with no request behind it.


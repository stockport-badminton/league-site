# The S3 bucket

Moved out of `CLAUDE.md`, word for word, so that file holds only the rules most tasks need.

### What the bucket keeps, and for how long

Two lifecycle rules on `badmintontemp`, both expiry-only. Read them back with
`aws s3api get-bucket-lifecycle-configuration --bucket badmintontemp` rather than trusting
this list — `put-bucket-lifecycle-configuration` **replaces the whole configuration**, so
adding a rule means sending the existing ones again or silently deleting them.

| Prefix | Expires | Why |
|---|---|---|
| `inbound-email/` | 30 days | SES drops the raw message here for the forwarder |
| `scorecards/failed-analysis/` | **14 days** | An upload the reader could not use (HARD-36) |
| `scorecards/` (everything else) | never | The league's record of a result |

**It holds whatever arrived, not only images.** A pdf or docx that no image could be
extracted from is kept as the pdf or docx, because on that path there is no image — the
failure *is* that one could not be produced. `FAILED_UPLOAD_TYPES` in `utils/uploads.js` is
a separate list from `ALLOWED_TYPES` for that reason, and the two must stay separate:
`ALLOWED_TYPES` guards `/sign-s3`, where the content type is **attacker-chosen** and decides
what the bucket will later serve, so adding `application/pdf` there would be a security
change. Nothing kept under this prefix is attacker-chosen in that sense — the bytes are
already on the server, they arrived through multer behind `secured`, the object is private
and it is deleted in 14 days.

**A refusal is not an exception, and that is what the first version missed.** `HARD-36`
hung its store off `analyse_scorecard`'s `catch`; the 4xx refusals return from inside the
`try` and never reach it. On 17 Sep a captain's card was refused by
`POST /api/convert-scorecard-document` with a 400, and there was no log line, no Sentry
event and no object — on the endpoint the package had just been written to make
diagnosable. Every refusal now goes through `refuseUpload`, which keeps the file and names
the check that fired.

**The failed-analysis prefix is the interesting one.** Until Sep 2026,
`POST /api/analyse-scorecard` read the bytes and discarded them unless the analysis
*succeeded*, so a failure left a log line and a request size and nothing else. On 16 Sep a
captain's first two photos failed and the third worked, and diagnosing it meant working
from the only image that survived — the one that had, by definition, succeeded. That
cannot answer what was different about the two that did not.

The message now distinguishes *we refused it* from *it was not there*
(`cornerDetection.findAnchors`), and this is what makes that message checkable: a log line
saying `outside[yMax=0.45]` is only believable if somebody can look at the photo it
describes. The key is logged beside the failure so the two find each other.

**Retention is the whole reason it is a separate prefix.** A scorecard photograph carries
twelve players' names and both captains' signatures, which is why HARD-02b made every
object here private. Diagnostic scrap does not earn the same permanence, and an expiry
attached to the prefix means an object is expired *by virtue of being written there* —
retention that depends on somebody remembering is not retention.

**S3 versioning was considered and rejected**, because it is the obvious first thought: it
protects an object that exists from being overwritten, and here none was ever created. It
also retains *more*, indefinitely, unless a noncurrent-version expiry is added as well —
the opposite of what this data wants.


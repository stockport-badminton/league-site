#!/usr/bin/env node
// Read-only reconciliation of scorecardstore."scoresheet-url" against the S3 bucket.
//
// Written for HARD-02b step 0. Step 3 of that runbook flips ~1,479 objects to private,
// and the failure it must not cause is "a photo that worked yesterday now 404s". The
// only way to tell that apart from the photos which were *already* dead is to have the
// list from before, so run this before step 3 and again after, and diff the counts.
//
// It answers, per row, exactly what GET /scorecard-photo/:id would answer, because it
// imports the route's own helpers rather than reimplementing them. A hand-rolled URL
// parser here would measure this script instead of the proxy — and the two disagreeing
// is precisely the bug class that put 490 '+'-for-space URLs in the column.
//
// Reads only: one S3 ListObjectsV2 pagination and one SELECT. It never fetches an
// object's body, so it costs list requests rather than egress, and it does not touch
// the site (the proxy is rate limited to 120/15min — do not sweep through it).
//
//   node tools/scorecard-photo-audit.js
//   node tools/scorecard-photo-audit.js --json out.json   # full per-row detail
//
require('dotenv').config({ path: require('path').join(__dirname, '../dev.env') });
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const db = require('../db_connect.js');
const {
  photoKeyFromStored, contentTypeFor, downloadTypeFor,
} = require('../utils/scorecardPhoto');

const jsonAt = process.argv.indexOf('--json');
const JSON_OUT = jsonAt > -1 ? process.argv[jsonAt + 1] : null;

async function listBucket(bucket) {
  const s3 = new S3Client({ region: process.env.AWS_REGION || 'eu-west-1' });
  const keys = new Map(); // key -> size
  let token;
  let pages = 0;
  do {
    const page = await s3.send(new ListObjectsV2Command({
      Bucket: bucket, ContinuationToken: token,
    }));
    (page.Contents || []).forEach(o => keys.set(o.Key, o.Size));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
    pages++;
  } while (token);
  return { keys, pages };
}

async function main() {
  const bucket = String(process.env.S3_BUCKET_NAME || '').trim();
  if (!bucket) throw new Error('S3_BUCKET_NAME is not set');

  const { keys, pages } = await listBucket(bucket);
  console.log(`Bucket ${bucket}: ${keys.size} objects (${pages} list page(s)).`);

  db.connect();
  const conn = await db.otherConnect();
  const [rows] = await conn.query(
    `SELECT id, date, "scoresheet-url" AS url, ("confirmToken" IS NOT NULL) AS tokened
       FROM scorecardstore
      WHERE COALESCE(NULLIF(TRIM("scoresheet-url"), ''), '') <> ''
      ORDER BY id`
  );
  console.log(`Rows with a photo: ${rows.length}\n`);

  const verdicts = { ok: [], refused: [], missing: [], badType: [] };

  for (const row of rows) {
    // Exactly the route's sequence: derive the key, then decide whether the type is
    // one it will serve. Anything the route 404s on, this must 404 on too.
    const key = photoKeyFromStored(row.url);
    if (!key) { verdicts.refused.push({ ...row, key: null }); continue; }
    if (!keys.has(key)) { verdicts.missing.push({ ...row, key }); continue; }
    // ContentType is not in a list response; the route falls back to the extension for
    // anything it does not recognise, which is what this checks.
    const servable = contentTypeFor(key, undefined) || downloadTypeFor(key);
    if (!servable) { verdicts.badType.push({ ...row, key }); continue; }
    verdicts.ok.push({ ...row, key, servedAs: servable });
  }

  const n = rows.length;
  const pct = c => n ? (100 * c / n).toFixed(1) + '%' : '-';
  console.log(`  servable            ${String(verdicts.ok.length).padStart(5)}  ${pct(verdicts.ok.length)}`);
  console.log(`  object missing      ${String(verdicts.missing.length).padStart(5)}  ${pct(verdicts.missing.length)}   dead rows — already 404 today`);
  console.log(`  refused by guard    ${String(verdicts.refused.length).padStart(5)}  ${pct(verdicts.refused.length)}   not one of our objects, or a denied prefix`);
  console.log(`  unservable type     ${String(verdicts.badType.length).padStart(5)}  ${pct(verdicts.badType.length)}   in the bucket but the route will not serve it`);

  for (const [label, list] of [['missing', verdicts.missing], ['refused', verdicts.refused], ['unservable', verdicts.badType]]) {
    if (!list.length) continue;
    console.log(`\n--- ${label} (${list.length}) ---`);
    list.slice(0, 15).forEach(r => console.log(
      `  #${String(r.id).padStart(5)}  ${String(r.date || '').slice(0, 10).padEnd(10)}  ${r.key === null ? '(unparseable) ' + String(r.url).slice(0, 60) : r.key}`));
    if (list.length > 15) console.log(`  ... ${list.length - 15} more`);
  }

  // Objects in the bucket under the photo prefixes that no row points at. Not a fault —
  // step 3 still has to make them private — but it is the anonymous-upload residual
  // HARD-02 left behind, and worth knowing the size of before setting a lifecycle rule.
  const referenced = new Set([...verdicts.ok, ...verdicts.missing, ...verdicts.badType].map(r => r.key));
  const orphanObjects = [...keys.keys()].filter(k =>
    !referenced.has(k) && !/^(venues-map|social-videos\/)/.test(k));
  console.log(`\nObjects in the bucket that no scorecard row references: ${orphanObjects.length}`);
  orphanObjects.slice(0, 10).forEach(k => console.log(`  ${k}`));
  if (orphanObjects.length > 10) console.log(`  ... ${orphanObjects.length - 10} more`);

  if (JSON_OUT) {
    require('fs').writeFileSync(JSON_OUT, JSON.stringify({
      bucket, generatedAt: new Date().toISOString(),
      counts: {
        rows: n, ok: verdicts.ok.length, missing: verdicts.missing.length,
        refused: verdicts.refused.length, badType: verdicts.badType.length,
        orphanObjects: orphanObjects.length,
      },
      verdicts, orphanObjects,
    }, null, 2));
    console.log(`\nFull detail written to ${JSON_OUT}`);
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });

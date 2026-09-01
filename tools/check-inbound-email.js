#!/usr/bin/env node
// Is inbound email still landing? Read-only.
//
// The SES receipt rule `inbound-badders-email` catches *any* address at
// stockport-badminton.co.uk, writes the raw MIME to s3://<bucket>/inbound-email/ and
// notifies SNS, which POSTs /mail, which fetches the object **with credentials** and
// forwards it.
//
// That split is the point of this tool. Locking the bucket down (HARD-22: Object
// Ownership / Block Public Access) cannot break the *read* — it is credentialed. What it
// could break is SES's ability to *write*, which is granted by the bucket policy's one
// statement, AllowSESReceiptWrite. A new object appearing under inbound-email/ is
// therefore the assertion that matters, and it is invisible from an inbox: if the write
// failed you would simply never receive the mail, with nothing to look at.
//
//   node tools/check-inbound-email.js            # recent arrivals, newest first
//   node tools/check-inbound-email.js --watch    # wait for the next one to land
//
// Never reads an object body — these are real emails. Keys and timestamps only.
require('dotenv').config({ path: require('path').join(__dirname, '../dev.env') });
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const PREFIX = 'inbound-email/';
const WATCH = process.argv.includes('--watch');
const WATCH_SECONDS = 420;
const POLL_SECONDS = 10;

// Local parts that fan out to real people (controllers/contactusController.js). Sending a
// test to one of these mails the league, not you.
const RESERVED = ['clubSecretaries', 'matchSecretaries', 'teamCaptains', 'treasurers',
  'leagueComms', 'Premier', 'division1', 'division2', 'division3'];

const s3 = new S3Client({ region: process.env.AWS_REGION || 'eu-west-1' });

async function list() {
  const bucket = String(process.env.S3_BUCKET_NAME || '').trim();
  if (!bucket) throw new Error('S3_BUCKET_NAME is not set');
  let token, all = [];
  do {
    const p = await s3.send(new ListObjectsV2Command({
      Bucket: bucket, Prefix: PREFIX, ContinuationToken: token,
    }));
    all.push(...(p.Contents || []).filter(o => o.Key !== PREFIX));
    token = p.IsTruncated ? p.NextContinuationToken : undefined;
  } while (token);
  return all.sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));
}

const ago = d => {
  const m = Math.round((Date.now() - new Date(d)) / 60000);
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};

const show = o => `  ${o.Key.replace(PREFIX, '').slice(0, 24).padEnd(26)} ` +
  `${String(Math.round(o.Size / 1024) + 'K').padStart(6)}  ` +
  `${String(o.LastModified).slice(4, 21)}  ${ago(o.LastModified)}`;

(async () => {
  const before = await list();
  console.log(`inbound-email/ holds ${before.length} objects. Most recent:\n`);
  before.slice(0, 5).forEach(o => console.log(show(o)));

  if (!WATCH) {
    console.log(`\nTo test a round trip:  node tools/check-inbound-email.js --watch`);
    return;
  }

  const seen = new Set(before.map(o => o.Key));
  console.log(`\n---`);
  console.log(`Send an email to a NEW address at stockport-badminton.co.uk, e.g.`);
  console.log(`\n    bpa-test@stockport-badminton.co.uk\n`);
  console.log(`Avoid these local parts — they fan out to real league members:`);
  console.log(`    ${RESERVED.join(', ')}, and any club name.`);
  console.log(`Anything else forwards only to your own plus-addressed inboxes.`);
  console.log(`\nWatching for up to ${WATCH_SECONDS / 60} minutes...\n`);

  const deadline = Date.now() + WATCH_SECONDS * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_SECONDS * 1000));
    const now = await list();
    const fresh = now.filter(o => !seen.has(o.Key));
    if (fresh.length) {
      console.log(`LANDED — SES can still write to the bucket.\n`);
      fresh.forEach(o => console.log(show(o)));
      console.log(`\nThat is the half that a bucket lockdown could break. The forward to your`);
      console.log(`inbox is the other half: if the object is here but no mail arrives, the`);
      console.log(`problem is SNS -> POST /mail -> SES send, not the bucket.`);
      return;
    }
    process.stdout.write(`  nothing yet (${Math.round((deadline - Date.now()) / 1000)}s left)\r`);
  }
  console.log(`\n\nNothing arrived in ${WATCH_SECONDS / 60} minutes.`);
  console.log(`Check: did the send bounce? is the receipt rule still enabled`);
  console.log(`(aws ses describe-active-receipt-rule-set --region eu-west-1)? and does the`);
  console.log(`bucket policy still carry AllowSESReceiptWrite?`);
})().then(() => process.exit(0)).catch(err => { console.error(err.message); process.exit(1); });

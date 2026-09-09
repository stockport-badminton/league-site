// Reading the DMARC aggregate reports the league receives.
//
// DMARC is published at `_dmarc.stockport-badminton.co.uk` with
// `rua=mailto:dmarc@stockport-badminton.co.uk`, so the reports arrive as ordinary
// inbound mail: the domain's MX is SES inbound, and an SES receipt rule drops every
// message into S3. Google and Microsoft send one a day each.
//
// **The bucket and prefix are set by an SES receipt rule in AWS, not by any code.**
// Grepping the repo for them proves nothing, the same way grepping for
// `ConfigurationSetName` does not show that `baddersEmail` is the identity default.
// The rule is `inbound-badders-email`: recipients `stockport-badminton.co.uk`,
// S3Action -> bucket `badmintontemp`, prefix `inbound-email/`.
//
// What the reports are for: DMARC is on `p=none`, which enforces nothing. It is a
// monitoring state, and the only way out of it is evidence that every legitimate sender
// authenticates. These reports are that evidence. The thing to watch for is a source
// that sends as our domain and does NOT align — either someone spoofing us, or a real
// sender that a move to `p=reject` would silently start binning.

const zlib = require('zlib');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');

const BUCKET = process.env.S3_BUCKET_NAME || 'badmintontemp';
const PREFIX = 'inbound-email/';
const REGION = process.env.AWS_REGION || 'eu-west-1';

// Google sends .zip, Microsoft sends .gz. Both turn up, so handle both rather than
// whichever one you happened to test against.
function decompress(buf) {
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) return zlib.gunzipSync(buf);
  if (buf.length > 30 && buf[0] === 0x50 && buf[1] === 0x4b) {
    const method = buf.readUInt16LE(8);
    const nameLen = buf.readUInt16LE(26);
    const extraLen = buf.readUInt16LE(28);
    const data = buf.slice(30 + nameLen + extraLen);
    return method === 0 ? data : zlib.inflateRawSync(data);
  }
  return buf; // some reporters send the XML uncompressed
}

// Pull the report out of a raw MIME message.
//
// Find the blank line that ends each part's headers rather than anchoring on the
// Content-Transfer-Encoding line: **header order varies**. Microsoft puts
// Content-Disposition *after* Content-Transfer-Encoding, so a regex expecting the body
// to follow `base64` immediately matches Google's reports and silently skips Microsoft's
// — which reads as "Microsoft is not reporting" rather than as a parsing bug.
function extractReportXml(raw) {
  const parts = String(raw).split(/\r?\n--[^\r\n-][^\r\n]*\r?\n/);
  for (const part of parts) {
    const split = part.search(/\r?\n\r?\n/);
    if (split < 0) continue;
    if (!/base64/i.test(part.slice(0, split))) continue;
    const body = part.slice(split).replace(/[^A-Za-z0-9+/=]/g, '');
    if (body.length < 80) continue;
    try {
      const text = decompress(Buffer.from(body, 'base64')).toString('utf8');
      if (text.includes('<feedback')) return text;
    } catch (err) { /* not this part */ }
  }
  return null;
}

function tag(source, name) {
  const m = String(source).match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>'));
  return m ? m[1].trim() : '';
}

function parseReport(xml) {
  const meta = (xml.split('<report_metadata>')[1] || '').split('</report_metadata>')[0];
  const published = (xml.split('<policy_published>')[1] || '').split('</policy_published>')[0];

  const records = [];
  for (const chunk of xml.split('<record>').slice(1)) {
    const rec = chunk.split('</record>')[0];
    const evaluated = (rec.split('<policy_evaluated>')[1] || '').split('</policy_evaluated>')[0];
    const dkim = tag(evaluated, 'dkim') || 'none';
    const spf = tag(evaluated, 'spf') || 'none';
    records.push({
      sourceIp: tag(rec, 'source_ip') || '?',
      count: Number(tag(rec, 'count')) || 0,
      headerFrom: tag(rec, 'header_from') || '?',
      disposition: tag(evaluated, 'disposition') || 'none',
      dkim,
      spf,
      // DMARC passes on EITHER aligned leg, so this is an OR and not an AND. Reading it
      // as an AND reports every SPF-broken forward as a failure.
      passes: dkim === 'pass' || spf === 'pass',
    });
  }

  return {
    org: tag(meta, 'org_name') || '?',
    reportId: tag(meta, 'report_id') || '',
    begin: Number(tag(meta, 'begin')) || null,
    end: Number(tag(meta, 'end')) || null,
    domain: tag(published, 'domain') || '',
    policy: {
      p: tag(published, 'p') || '',
      sp: tag(published, 'sp') || '',
      pct: tag(published, 'pct') || '',
      adkim: tag(published, 'adkim') || '',
      aspf: tag(published, 'aspf') || '',
    },
    records,
  };
}

// Fetch and parse every report in the retained window.
//
// `days` bounds the S3 listing, because the prefix holds ALL inbound mail, not just
// reports — the league's own correspondence is in there too. Anything that does not
// yield a `<feedback>` document is simply not a report; identifying them that way rather
// than by recipient means a change to the rua mailbox does not quietly empty this.
async function fetchReports({ days = 30, max = 400, client } = {}) {
  const s3 = client || new S3Client({ region: REGION });
  const since = Date.now() - days * 24 * 60 * 60 * 1000;

  const objects = [];
  let token;
  do {
    const page = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET, Prefix: PREFIX, ContinuationToken: token,
    }));
    for (const o of (page.Contents || [])) {
      if (o.LastModified && o.LastModified.getTime() >= since) objects.push(o);
    }
    token = page.IsTruncated ? page.NextContinuationToken : null;
  } while (token);

  objects.sort((a, b) => b.LastModified - a.LastModified);

  const reports = [];
  for (const o of objects.slice(0, max)) {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: o.Key }));
    const raw = Buffer.concat(await res.Body.toArray()).toString('utf8');
    const xml = extractReportXml(raw);
    if (!xml) continue;
    const report = parseReport(xml);
    report.receivedAt = o.LastModified;
    reports.push(report);
  }
  return reports;
}

// Roll the reports up per sending source.
function summarise(reports) {
  const bySource = new Map();
  let pass = 0, fail = 0, begin = null, end = null;
  const reporters = new Map();

  for (const report of reports) {
    reporters.set(report.org, (reporters.get(report.org) || 0) + 1);
    if (report.begin && (!begin || report.begin < begin)) begin = report.begin;
    if (report.end && (!end || report.end > end)) end = report.end;

    for (const rec of report.records) {
      const key = rec.sourceIp + '|' + rec.headerFrom;
      const row = bySource.get(key) || {
        sourceIp: rec.sourceIp, headerFrom: rec.headerFrom,
        pass: 0, fail: 0, dkim: new Set(), spf: new Set(), reporters: new Set(),
      };
      row[rec.passes ? 'pass' : 'fail'] += rec.count;
      row.dkim.add(rec.dkim);
      row.spf.add(rec.spf);
      row.reporters.add(report.org);
      bySource.set(key, row);
      if (rec.passes) pass += rec.count; else fail += rec.count;
    }
  }

  const sources = [...bySource.values()]
    .map(r => ({
      sourceIp: r.sourceIp,
      headerFrom: r.headerFrom,
      pass: r.pass,
      fail: r.fail,
      dkim: [...r.dkim].join('/'),
      spf: [...r.spf].join('/'),
      reporters: [...r.reporters].join(','),
    }))
    .sort((a, b) => (b.pass + b.fail) - (a.pass + a.fail));

  return {
    reports: reports.length,
    reporters: [...reporters.entries()].map(([k, v]) => k + ' x' + v).join(', '),
    begin, end, pass, fail,
    sources,
    // The only rows anyone needs to act on: mail sent as our domain that authenticated
    // as nobody. Everything else is the system working.
    unauthenticated: sources.filter(s => s.fail > 0),
  };
}

module.exports = { decompress, extractReportXml, parseReport, fetchReports, summarise, BUCKET, PREFIX };

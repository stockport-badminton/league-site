// Parsing DMARC aggregate reports out of the mail they arrive in.
//
// Both traps encoded here cost time when this was first written by hand, and both fail
// the same way: they yield NO report rather than a wrong one, so the symptom is
// "Microsoft isn't reporting" or "we have no data", which reads as a DNS or policy
// problem rather than a parsing bug.

const zlib = require('zlib');
const { extractReportXml, parseReport, summarise } = require('../../utils/dmarcReports');

const XML = (records) => `<?xml version="1.0" encoding="UTF-8" ?>
<feedback>
  <report_metadata>
    <org_name>example.net</org_name>
    <report_id>abc123</report_id>
    <date_range><begin>1788739200</begin><end>1788825600</end></date_range>
  </report_metadata>
  <policy_published>
    <domain>stockport-badminton.co.uk</domain><p>none</p><adkim>r</adkim><aspf>r</aspf>
  </policy_published>
  ${records}
</feedback>`;

const RECORD = (ip, count, dkim, spf) => `
  <record>
    <row>
      <source_ip>${ip}</source_ip><count>${count}</count>
      <policy_evaluated><disposition>none</disposition><dkim>${dkim}</dkim><spf>${spf}</spf></policy_evaluated>
    </row>
    <identifiers><header_from>stockport-badminton.co.uk</header_from></identifiers>
  </record>`;

function asZip(buf, name) {
  const body = zlib.deflateRawSync(buf);
  const header = Buffer.alloc(30);
  header.write('PK\x03\x04', 0, 'binary');
  header.writeUInt16LE(8, 8);                    // method: deflate
  header.writeUInt16LE(Buffer.byteLength(name), 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, Buffer.from(name), body]);
}

// Microsoft's ordering: Content-Disposition sits AFTER Content-Transfer-Encoding.
const microsoftStyle = attachment => [
  'Content-Type: multipart/mixed; boundary="B"', '', '--B',
  'Content-Type: text/html', 'Content-Transfer-Encoding: base64', '',
  Buffer.from('<p>hello</p>').toString('base64'), '--B',
  'Content-Type: application/gzip',
  'Content-Transfer-Encoding: base64',
  'Content-Disposition: attachment; filename="report.xml.gz"', '',
  attachment.toString('base64'), '--B--', '',
].join('\r\n');

// Google's ordering: Content-Disposition before the encoding, and a zip.
const googleStyle = attachment => [
  'Content-Type: multipart/mixed; boundary="B"', '', '--B',
  'Content-Type: application/zip',
  'Content-Disposition: attachment; filename="report.xml.zip"',
  'Content-Transfer-Encoding: base64', '',
  attachment.toString('base64'), '--B--', '',
].join('\r\n');

describe('extracting the report from the message', () => {
  // The bug: anchoring on `Content-Transfer-Encoding: base64\n\n` matches Google and
  // silently skips Microsoft, whose Content-Disposition line sits in between. Find the
  // blank line that ends the headers instead.
  it('finds a gzip attachment whose Content-Disposition follows the encoding header', () => {
    const raw = microsoftStyle(zlib.gzipSync(Buffer.from(XML(RECORD('54.240.7.11', 3, 'pass', 'pass')))));
    expect(extractReportXml(raw)).toContain('<feedback');
  });

  it('finds a zip attachment as well as a gzip one', () => {
    const raw = googleStyle(asZip(Buffer.from(XML(RECORD('54.240.7.11', 3, 'pass', 'pass'))), 'report.xml'));
    expect(extractReportXml(raw)).toContain('<feedback');
  });

  it('returns null for ordinary mail rather than throwing', () => {
    const raw = ['Content-Type: multipart/mixed; boundary="B"', '', '--B',
      'Content-Type: image/jpeg', 'Content-Transfer-Encoding: base64', '',
      Buffer.from('not a report at all, just some bytes').toString('base64'),
      '--B--', ''].join('\r\n');
    expect(extractReportXml(raw)).toBeNull();
  });
});

describe('reading the verdict', () => {
  // DMARC passes on EITHER aligned leg. Reading it as an AND reports every
  // SPF-broken forward — which is normal and harmless — as a failure, and a check that
  // cries wolf weekly is one nobody reads.
  it('treats one passing leg as a pass', () => {
    const [dkimOnly] = parseReport(XML(RECORD('1.2.3.4', 5, 'pass', 'fail'))).records;
    expect(dkimOnly.passes).toBe(true);
    const [spfOnly] = parseReport(XML(RECORD('1.2.3.4', 5, 'fail', 'pass'))).records;
    expect(spfOnly.passes).toBe(true);
  });

  it('treats both legs failing as a failure', () => {
    const [neither] = parseReport(XML(RECORD('9.9.9.9', 2, 'fail', 'fail'))).records;
    expect(neither.passes).toBe(false);
  });

  it('reads the published policy, so a silent revert to p=none is visible', () => {
    expect(parseReport(XML(RECORD('1.2.3.4', 1, 'pass', 'pass'))).policy.p).toBe('none');
  });
});

describe('the weekly summary', () => {
  const reports = [parseReport(XML(
    RECORD('54.240.7.11', 20, 'pass', 'pass') + RECORD('203.0.113.9', 4, 'fail', 'fail')
  ))];

  it('counts the passing and failing volume', () => {
    const s = summarise(reports);
    expect(s.pass).toBe(20);
    expect(s.fail).toBe(4);
  });

  // Only the failures reach the digest. A weekly "everything passed" trains its reader to
  // skim, and then the one week something IS wrong reads the same as every other week.
  it('surfaces only the sources that authenticated as nobody', () => {
    const s = summarise(reports);
    expect(s.unauthenticated.map(u => u.sourceIp)).toEqual(['203.0.113.9']);
  });
});

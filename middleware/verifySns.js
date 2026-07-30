const crypto = require('crypto');
const https = require('https');

// Verifies that a request on /mail genuinely came from Amazon SNS.
//
// `distribution_list` decided what to do from the `x-amz-sns-message-type` *header*
// and then parsed the body — both entirely attacker-supplied. Two consequences:
//
//  - Anyone could POST a crafted "Notification" with a MIME message of their choosing
//    and have it forwarded to a real league distribution list. An open relay.
//  - The "SubscriptionConfirmation" branch fetched `msgBody.SubscribeURL` with
//    https.get. An arbitrary URL from an unauthenticated request, fetched by our
//    server from inside GCP — server-side request forgery.
//
// SNS signs every message. This checks that signature, so neither branch runs on
// anything Amazon did not send.
//
// Docs: "Verifying the signatures of Amazon SNS messages". SignatureVersion 1 signs
// with SHA1, 2 with SHA256; the signed string is a specific subset of fields in a
// specific order, each as "key\nvalue\n".

// The cert must come from Amazon. Without this check an attacker supplies both the
// signature and the certificate that validates it, and verification proves nothing.
const CERT_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com$/;

const SIGNED_FIELDS = {
  Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
  SubscriptionConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
  UnsubscribeConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
};

const certCache = new Map();

function fetchCert(url) {
  if (certCache.has(url)) return Promise.resolve(certCache.get(url));
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('cert fetch status ' + res.statusCode));
      }
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => { certCache.set(url, body); resolve(body); });
    }).on('error', reject);
  });
}

// Only Subject is optional, and only when absent from the message entirely — an
// empty string still has to be signed, so test for the key rather than truthiness.
function canonicalString(msg) {
  const fields = SIGNED_FIELDS[msg.Type];
  if (!fields) return null;
  let out = '';
  for (const f of fields) {
    if (f === 'Subject' && !(f in msg)) continue;
    if (!(f in msg)) return null;
    out += f + '\n' + msg[f] + '\n';
  }
  return out;
}

async function isAuthentic(msg, { fetch = fetchCert } = {}) {
  if (!msg || typeof msg !== 'object') return false;
  if (!SIGNED_FIELDS[msg.Type]) return false;
  if (!msg.Signature || !msg.SigningCertURL) return false;

  let certUrl;
  try {
    certUrl = new URL(msg.SigningCertURL);
  } catch (err) {
    return false;
  }
  if (certUrl.protocol !== 'https:' || !CERT_HOST.test(certUrl.hostname)) return false;
  if (!certUrl.pathname.endsWith('.pem')) return false;

  const expectedTopic = process.env.SNS_TOPIC_ARN;
  if (expectedTopic && msg.TopicArn !== expectedTopic) return false;

  const canonical = canonicalString(msg);
  if (canonical === null) return false;

  const algorithm = String(msg.SignatureVersion) === '2' ? 'RSA-SHA256' : 'RSA-SHA1';
  let cert;
  try {
    cert = await fetch(certUrl.href);
  } catch (err) {
    console.error('SNS cert fetch failed:', err.message);
    return false;
  }

  try {
    const verifier = crypto.createVerify(algorithm);
    verifier.update(canonical, 'utf8');
    return verifier.verify(cert, msg.Signature, 'base64');
  } catch (err) {
    console.error('SNS signature verification threw:', err.message);
    return false;
  }
}

// The body arrives as text (bodyParser.text) and the handler parses it itself, so
// parse here too rather than changing that contract. The parsed message is attached
// as req.snsMessage so the handler doesn't parse a third time.
function verifySns(req, res, next) {
  let msg;
  try {
    msg = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (err) {
    return res.status(400).send('bad request');
  }

  isAuthentic(msg).then(ok => {
    if (!ok) {
      // Deliberately terse to the caller, loud in the logs — a forged message here is
      // an attempt to relay mail through us, and worth seeing in Sentry.
      console.warn('Rejected unverified SNS message', JSON.stringify({
        type: msg && msg.Type,
        topic: msg && msg.TopicArn,
        certUrl: msg && msg.SigningCertURL,
        ip: req.ip,
      }));
      return res.status(403).send('forbidden');
    }
    req.snsMessage = msg;
    next();
  }).catch(next);
}

// The SubscribeURL is fetched by our own server, so it gets the same host check as
// the certificate. Exported for the handler to use on its confirmation path.
function isAmazonSubscribeUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && CERT_HOST.test(u.hostname);
  } catch (err) {
    return false;
  }
}

module.exports = verifySns;
module.exports.isAuthentic = isAuthentic;
module.exports.canonicalString = canonicalString;
module.exports.isAmazonSubscribeUrl = isAmazonSubscribeUrl;
module.exports.CERT_HOST = CERT_HOST;

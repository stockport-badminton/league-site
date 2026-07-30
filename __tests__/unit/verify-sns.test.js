const crypto = require('crypto');
const verifySns = require('../../middleware/verifySns');
const { isAuthentic, canonicalString, isAmazonSubscribeUrl } = verifySns;

// A real SNS message can't be replayed in a test, so the signature path is proved
// with a locally generated key pair and a stubbed cert fetch: sign the canonical
// string the way Amazon does and check the middleware accepts it, then tamper with
// each part and check it doesn't. That validates the thing most likely to be wrong —
// the exact composition of the signed string.
const { privateKey, certificate } = (() => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { privateKey, certificate: publicKey.export({ type: 'spki', format: 'pem' }) };
})();

const CERT_URL = 'https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-abc123.pem';

function sign(msg, algorithm = 'RSA-SHA1') {
  const signer = crypto.createSign(algorithm);
  signer.update(canonicalString(msg), 'utf8');
  return signer.sign(privateKey, 'base64');
}

function notification(over = {}) {
  const msg = {
    Type: 'Notification',
    MessageId: 'm-1',
    TopicArn: 'arn:aws:sns:eu-west-1:1:inbound-mail',
    Message: '{"content":"aGVsbG8="}',
    Timestamp: '2026-07-30T10:00:00.000Z',
    SignatureVersion: '1',
    SigningCertURL: CERT_URL,
    ...over,
  };
  msg.Signature = sign(msg);
  return msg;
}

const fetchStub = { fetch: async () => certificate };

describe('canonicalString', () => {
  it('uses the documented field order for a Notification', () => {
    const s = canonicalString({
      Type: 'Notification', MessageId: 'm', TopicArn: 't', Message: 'body',
      Timestamp: 'ts', Subject: 'subj',
    });
    expect(s).toBe('Message\nbody\nMessageId\nm\nSubject\nsubj\nTimestamp\nts\nTopicArn\nt\nType\nNotification\n');
  });

  it('omits Subject only when the key is absent, not when it is empty', () => {
    const withEmpty = canonicalString({
      Type: 'Notification', MessageId: 'm', TopicArn: 't', Message: 'b', Timestamp: 'ts', Subject: '',
    });
    expect(withEmpty).toContain('Subject\n\n');
    const without = canonicalString({
      Type: 'Notification', MessageId: 'm', TopicArn: 't', Message: 'b', Timestamp: 'ts',
    });
    expect(without).not.toContain('Subject');
  });

  it('signs SubscribeURL and Token for a SubscriptionConfirmation', () => {
    const s = canonicalString({
      Type: 'SubscriptionConfirmation', MessageId: 'm', TopicArn: 't', Message: 'b',
      Timestamp: 'ts', SubscribeURL: 'https://sns.eu-west-1.amazonaws.com/?x=1', Token: 'tok',
    });
    expect(s).toContain('SubscribeURL\nhttps://sns.eu-west-1.amazonaws.com/?x=1\n');
    expect(s).toContain('Token\ntok\n');
  });

  it('returns null for an unknown Type rather than signing something arbitrary', () => {
    expect(canonicalString({ Type: 'NotAThing' })).toBeNull();
  });
});

describe('isAuthentic', () => {
  it('accepts a correctly signed message', async () => {
    await expect(isAuthentic(notification(), fetchStub)).resolves.toBe(true);
  });

  it('accepts SignatureVersion 2 (SHA256)', async () => {
    const msg = { ...notification(), SignatureVersion: '2' };
    msg.Signature = sign(msg, 'RSA-SHA256');
    await expect(isAuthentic(msg, fetchStub)).resolves.toBe(true);
  });

  it('rejects a tampered Message body', async () => {
    // The whole point: the forwarded MIME content is inside Message.
    const msg = notification();
    msg.Message = '{"content":"aSBhbSBzcGFt"}';
    await expect(isAuthentic(msg, fetchStub)).resolves.toBe(false);
  });

  it('rejects a message with no signature at all', async () => {
    const msg = notification();
    delete msg.Signature;
    await expect(isAuthentic(msg, fetchStub)).resolves.toBe(false);
  });

  it('rejects a certificate hosted anywhere but SNS', async () => {
    // Without this the attacker supplies both signature and validating cert.
    for (const url of [
      'https://evil.example.com/cert.pem',
      'https://sns.eu-west-1.amazonaws.com.evil.com/cert.pem',
      'http://sns.eu-west-1.amazonaws.com/cert.pem',
      'https://sns.eu-west-1.amazonaws.com/cert.txt',
    ]) {
      const msg = notification({ SigningCertURL: url });
      await expect(isAuthentic(msg, fetchStub)).resolves.toBe(false);
    }
  });

  it('rejects an unknown message type', async () => {
    await expect(isAuthentic({ Type: 'Whatever', Signature: 'x', SigningCertURL: CERT_URL }, fetchStub))
      .resolves.toBe(false);
  });

  it('rejects junk', async () => {
    await expect(isAuthentic(null, fetchStub)).resolves.toBe(false);
    await expect(isAuthentic('a string', fetchStub)).resolves.toBe(false);
  });

  it('enforces the expected topic when SNS_TOPIC_ARN is set', async () => {
    const prev = process.env.SNS_TOPIC_ARN;
    process.env.SNS_TOPIC_ARN = 'arn:aws:sns:eu-west-1:1:inbound-mail';
    await expect(isAuthentic(notification(), fetchStub)).resolves.toBe(true);
    await expect(isAuthentic(notification({ TopicArn: 'arn:aws:sns:eu-west-1:1:other' }), fetchStub))
      .resolves.toBe(false);
    if (prev === undefined) delete process.env.SNS_TOPIC_ARN; else process.env.SNS_TOPIC_ARN = prev;
  });
});

describe('isAmazonSubscribeUrl', () => {
  it('allows only https SNS hosts', () => {
    // This URL is fetched by our own server — the SSRF sink.
    expect(isAmazonSubscribeUrl('https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription')).toBe(true);
    expect(isAmazonSubscribeUrl('http://sns.eu-west-1.amazonaws.com/')).toBe(false);
    expect(isAmazonSubscribeUrl('https://169.254.169.254/computeMetadata/v1/')).toBe(false);
    expect(isAmazonSubscribeUrl('https://evil.example.com/')).toBe(false);
    expect(isAmazonSubscribeUrl('file:///etc/passwd')).toBe(false);
    expect(isAmazonSubscribeUrl('not a url')).toBe(false);
    expect(isAmazonSubscribeUrl(undefined)).toBe(false);
  });
});

describe('the middleware', () => {
  function res() {
    const r = { statusCode: null, body: null };
    r.status = c => { r.statusCode = c; return r; };
    r.send = b => { r.body = b; return r; };
    return r;
  }

  it('403s a forged message and does not call next', async () => {
    const r = res();
    const next = jest.fn();
    verifySns({ body: JSON.stringify({ Type: 'Notification', Message: 'spam' }), ip: '1.2.3.4' }, r, next);
    await new Promise(setImmediate);
    expect(r.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('400s an unparseable body', () => {
    const r = res();
    const next = jest.fn();
    verifySns({ body: 'not json', ip: '1.2.3.4' }, r, next);
    expect(r.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });
});

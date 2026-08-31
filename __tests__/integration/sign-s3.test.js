const request = require('supertest');

// GET /sign-s3 — the presigned upload for a scorecard photo.
//
// It took the object key and the content type from the query string and handed back a
// presigned PUT with public-read. Any anonymous caller could overwrite any object in
// the bucket by naming it — the venues map and the generated weekly videos live in the
// same bucket — or have the bucket serve HTML from our own storage by choosing the
// type. The unit tests in uploads.test.js cover the key rules; these cover the endpoint
// honouring them, and the response shape its four callers depend on.

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(async (client, command) =>
    `https://bucket.s3.eu-west-1.amazonaws.com/${command.input.Key}?X-Amz-Signature=fake`)
}));

jest.mock('../../db_connect', () => ({
  connect: jest.fn(),
  end: jest.fn().mockResolvedValue(undefined),
  otherConnect: jest.fn(() => Promise.resolve({
    query: jest.fn(() => Promise.resolve([[]]))
  })),
  withTransaction: jest.fn(fn => fn({ query: jest.fn(() => Promise.resolve([[]])) })),
  isObject: jest.fn(obj => obj === Object(obj)),
}));

jest.mock('../../middleware/secured', () => (req, res, next) => next());

const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const app = require('../../app');

const sign = (name, type) =>
  request(app).get('/sign-s3')
    .query({ 'file-name': name, 'file-type': type });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.S3_BUCKET_NAME = 'bucket';
});

describe('GET /sign-s3', () => {
  it('signs an upload for a photo', async () => {
    const res = await sign('20262027-Shell A-Mellor A.jpg', 'image/jpeg');
    expect(res.status).toBe(200);
    expect(res.body.signedUrl).toContain('X-Amz-Signature');
  });

  // The headline fix. The caller no longer decides where the object lands.
  it('ignores the key the caller asks for', async () => {
    await sign('static/generated/venues-map.png', 'image/png');
    const command = getSignedUrl.mock.calls[0][1];
    expect(command.input.Key).not.toBe('static/generated/venues-map.png');
    expect(command.input.Key.startsWith('scorecards/')).toBe(true);
  });

  it('refuses a content type that is not an image', async () => {
    for (const type of ['text/html', 'application/javascript', 'image/svg+xml']) {
      const res = await sign('payload', type);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not accepted/i);
    }
    // Nothing was signed, so no URL to upload with even existed.
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('signs with the content type it validated, not the one on the filename', async () => {
    await sign('sneaky.html', 'image/png');
    const command = getSignedUrl.mock.calls[0][1];
    expect(command.input.ContentType).toBe('image/png');
    expect(command.input.Key).toMatch(/\.png$/);
  });

  it('returns the public URL as well as the signed one', async () => {
    const res = await sign('card.jpg', 'image/jpeg');
    // Three keys because the callers disagree: the two scorecard views read
    // `signedUrl`, and views/scorecard-upload.ejs has always read `signedRequest` and
    // `url` — which is why it never worked against this endpoint.
    expect(res.body.url).toMatch(/^https:\/\/bucket\.s3\.eu-west-1\.amazonaws\.com\/scorecards\//);
    expect(res.body.url).not.toContain('X-Amz');
    expect(res.body.signedRequest).toBe(res.body.signedUrl);
    expect(res.body.key).toBeTruthy();
  });

  it('gives two callers asking for the same name different keys', async () => {
    await sign('card.jpg', 'image/jpeg');
    await sign('card.jpg', 'image/jpeg');
    const first = getSignedUrl.mock.calls[0][1].input.Key;
    const second = getSignedUrl.mock.calls[1][1].input.Key;
    expect(first).not.toBe(second);
  });

  it('does not fall over on a missing content type', async () => {
    const res = await request(app).get('/sign-s3');
    expect(res.status).toBe(400);
  });

  // HARD-02b. The upload asked for `ACL: 'public-read'`, so every scorecard photo was
  // world-readable direct from the bucket and its URL was the only thing standing
  // between a stranger and a photo of a match — a URL that was then emailed. It could
  // not be dropped until there was a read path for the historical rows; there is one
  // now (GET /scorecard-photo/:id), so the signer stops asking.
  //
  // Note what this does and does not do: it stops *new* objects being made public by
  // their own ACL. Anything already in the bucket keeps the ACL it was written with, and
  // a bucket policy granting public read would still override this — both are on the
  // bucket, not in the code, and are the two steps of the runbook in
  // docs/hardening/HARD-02b-private-scorecard-photos.md.
  it('does not ask for a public-read ACL', async () => {
    await sign('card.jpg', 'image/jpeg');
    const command = getSignedUrl.mock.calls[0][1];
    expect(command.input.ACL).toBeUndefined();
  });

  // The presigner signs the headers it is given, so a signature minted without an ACL
  // does not authorise a client to add one: an upload that sends `x-amz-acl` fails the
  // signature check. Asserting the absence above is therefore the whole of it — but the
  // response still has to carry the URL the caller stores, or the draft loses its photo.
  it('still returns the object URL the draft will store', async () => {
    const res = await sign('card.jpg', 'image/jpeg');
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^https:\/\/bucket\.s3\.eu-west-1\.amazonaws\.com\/scorecards\//);
  });
});

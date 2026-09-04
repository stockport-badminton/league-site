// Sets required env vars before any module loads
process.env.AUTH0_DOMAIN = 'test.auth0.com';
process.env.AUTH0_AUDIENCE = 'test-audience';
process.env.AUTH0_CLIENTID = 'test-client-id';
process.env.AUTH0_CLIENT_SECRET = 'test-client-secret';
process.env.CLOUDINARY_AUTH = 'test-cloudinary-auth';
process.env.RECAPTCHA = 'test-recaptcha';
process.env.GMAPSAPIKEY = 'test-gmaps-key';
process.env.THEME = 'flatly';

// ── No test may reach a real AWS account ──────────────────────────────────────
//
// `app.js` and `instrument.js` both call `require('dotenv').config()` at import time,
// and every integration test requires `app.js` — so the real `.env` is loaded into the
// test process, live AWS credentials included. dotenv does not overwrite a variable that
// is already set, and this file is a `setupFiles` entry, so dummies planted here win.
//
// This is not theoretical. The first code path to PUT server-side (storing the image
// pulled out of a document scorecard, utils/uploads.storeImage) wrote **two real objects
// into the production bucket** from `npm test`, because the suite exercising it had no
// reason to mock the SDK — an image upload uses a presigned PUT from the browser, so
// nothing server-side had ever written to S3 before.
//
// A test that wants to exercise an AWS call mocks `@aws-sdk/client-s3`, as
// `__tests__/integration/scorecard-photo.test.js` does. Anything that does NOT mock it
// now fails to sign rather than succeeding against production. The credential chain is
// closed at all three ends: the environment, the shared credentials file, and the
// instance metadata service.
//
// `S3_BUCKET_NAME` is deliberately left alone — several tests build URLs from it and
// compare them against `normalisePhotoUrl`, which checks the host against that value.
// Killing the credentials is what makes the write impossible; renaming the bucket would
// only make those tests wrong.
process.env.AWS_ACCESS_KEY_ID = 'test-access-key-id';
process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-access-key';
process.env.AWS_SESSION_TOKEN = '';
process.env.AWS_SHARED_CREDENTIALS_FILE = '/dev/null/no-such-credentials';
process.env.AWS_CONFIG_FILE = '/dev/null/no-such-config';
process.env.AWS_EC2_METADATA_DISABLED = 'true';
process.env.AWS_PROFILE = '';

// The rate-limit counter reset lives in setupAfterEnv.js, not here: this file is a
// `setupFiles` entry, which runs before the test framework is installed, so beforeEach
// does not exist yet.

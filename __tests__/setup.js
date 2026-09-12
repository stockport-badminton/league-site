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

// ── Everything else the app reads, declared rather than inherited ────────────
//
// The app used to run its tests on the real `.env`: app.js and instrument.js both call
// dotenv.config() at import, and 31 suites require app.js. Of the 40 variables the code
// reads, this file set 15 — the other 25 came from production, including DB_PI_KEY,
// SESSION_SECRET, both cron tokens and the live DATABASE_URL.
//
// That had already been patched three times symptom by symptom (Sentry reporting our own
// test runs, then two real objects written to the production bucket), which is the actual
// finding: a denylist is always one variable behind. So app.js and instrument.js now skip
// dotenv under NODE_ENV=test and this file is the whole environment. A variable a test
// needs must be declared here, not inherited.
//
// Three categories, and the difference matters:

// 1. Credentials — fake, and obviously so. None of these resolves anywhere.
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/nowhere';
process.env.TAMESIDE_DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/nowhere';
process.env.DB_PI_KEY = 'test-pi-key-not-the-real-one';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.RECAPTCHA_SECRET = 'test-recaptcha-secret';
process.env.CLOUDINARY_KEY = 'test-cloudinary-key';
process.env.CLOUDINARY_SECRET = 'test-cloudinary-secret';
process.env.GMAPS_STATIC_API_KEY = 'test-gmaps-static-key';
// SENDGRID_API_KEY is deliberately NOT declared: nothing in the app reads it any more —
// every send goes through SES — so a value here would be noise pretending to be needed.
// The credential is still set on the Cloud Run service and in .env, and revoking it at
// SendGrid is the one part of HARD-26 that needs a person.
process.env.AUTH0_CALLBACK_URL = 'http://127.0.0.1:8080/callback';
process.env.AWS_REGION = 'eu-west-1';
process.env.RESULTS_EMAIL = 'results@example.invalid';
process.env.SITE_ORIGIN = 'https://stockport-badminton.co.uk';

// 2. Variables that are SAFE BECAUSE THEY ARE ABSENT. Setting these would arm things the
//    suite must never do: an unset AUDIT_EMAIL_TO means the weekly digest sends nothing,
//    and an unset cron token CLOSES the token path rather than opening it. Deleted rather
//    than left alone, so a value in the developer's shell cannot arm them either.
delete process.env.AUDIT_EMAIL_TO;
delete process.env.REGISTRATION_EMAIL_TO;
delete process.env.AUDIT_CRON_TOKEN;
delete process.env.REGISTRATION_CRON_TOKEN;
delete process.env.SENTRY_DSN;
// An unset SNS_TOPIC_ARN means verifySns does not enforce a topic, which is what the
// signature fixtures expect — they carry their own TopicArn, and the one test that wants
// the check sets the variable itself and restores it.
delete process.env.SNS_TOPIC_ARN;
// An unset AUDIT_EMAIL_FROM falls back to the league's own results address, which is what
// the digest test asserts the sender is. Declaring a fake here made the suite assert a
// value it had itself invented.
delete process.env.AUDIT_EMAIL_FROM;
delete process.env.DEV_MODE;
delete process.env.CSP_ENFORCE;
delete process.env.K_SERVICE;
delete process.env.K_REVISION;

// 3. S3_BUCKET_NAME keeps its REAL value, deliberately. Several tests build URLs from it
//    and compare them against normalisePhotoUrl, which checks the host against this
//    variable — renaming it makes those tests wrong rather than safer. It is a bucket
//    name, not a credential, and the credentials above are what make it unreachable.
process.env.S3_BUCKET_NAME = 'badmintontemp';

// The rate-limit counter reset lives in setupAfterEnv.js, not here: this file is a
// `setupFiles` entry, which runs before the test framework is installed, so beforeEach
// does not exist yet.

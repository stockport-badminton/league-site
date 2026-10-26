// The whole test environment, derived from config/schema.js (REARCH-06).
//
// app.js skips dotenv under NODE_ENV=test, so nothing is inherited from .env: a variable
// a test needs is declared in the schema with `test: 'fake'` (or set by the test itself
// and restored). Before HARD-26 this process ran on the real .env — live DATABASE_URL,
// DB_PI_KEY, cron tokens and AWS keys — and wrote two objects into the production bucket.
//
// A test that wants to exercise an AWS call mocks `@aws-sdk/client-s3`, as
// `__tests__/integration/scorecard-photo.test.js` does; anything else fails to sign.
//
// The rate-limit counter reset lives in setupAfterEnv.js, not here: this file is a
// `setupFiles` entry, which runs before the test framework is installed.
require('../config/testEnv').applyForJest(process.env);

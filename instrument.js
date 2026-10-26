// Sentry server-side instrumentation.
// MUST be required first in app.js (before express and other modules) so Sentry
// can auto-instrument them. If SENTRY_DSN is unset, Sentry.init is a no-op — so
// this is safe to run locally / in any environment without extra config.
// config loads .env (except under test — see config/index.js).
const config = require('./config');
const Sentry = require('@sentry/node');

Sentry.init({
  dsn: config.SENTRY_DSN,
  environment: config.NODE_ENV || 'development',
  // Only actually send events in production. Cloud Run runs the Docker image,
  // which sets NODE_ENV=production, and Cloud Run also sets K_SERVICE. This stops
  // local dev AND the test suite (both load .env via dotenv, so SENTRY_DSN is
  // present) from shipping synthetic errors to the production Sentry project.
  enabled: config.NODE_ENV === 'production' || !!config.K_SERVICE,
  // Errors only — no performance tracing spans (keeps free-tier quota for real errors).
  tracesSampleRate: 0,
  sendDefaultPii: false,
});

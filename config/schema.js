// Every environment variable the app reads, declared once (REARCH-06).
//
// Before this file, what each variable meant was written in five places by hand —
// docs/claude/env-vars.md, __tests__/setup.js, e2e/server-env.js, utils/testEnvGuard.js
// and tools/lib/loadEnv.js — and HARD-26 is the history of those drifting apart: the test
// environment was patched three times, one variable behind `.env` each time, and the
// second miss wrote two real objects into the production bucket. Now the entry below
// decides how the app parses a variable, whether startup refuses without it, and what the
// Jest and Playwright processes get, in one place. `node tools/env-table.js` prints it.
//
// Fields:
//   kind      secret | public | id | flag | url | list | number | string
//               flag: true only for the string 'true'. list: comma-separated, trimmed.
//               public: printed into pages or URLs, so not a secret even if it looks like one.
//   doc       one line: what it is for.
//   unset     what an absent value means, when that is the important thing about it.
//   default   used when the variable is absent or ''.
//   emptyIsValue  '' is a real value, distinct from absent (CSP_REPORT_URI).
//   required  true: startup refuses without it. 'production': refuses only in production.
//   test      what Jest gets — 'fake' or 'real' (set to `testValue`), 'unset' (deleted, so
//             a value in the developer's shell cannot arm it either), 'pass' (left alone).
//   e2e       what the browser suite's server gets — 'fake' (testValue, assigned before
//             any env file loads), 'unset', or 'local' (from the shell, else dev.env, else
//             .env). Defaults to `test`, with 'real' and 'pass' becoming 'local'.
//   shape     what a live value looks like. testEnvGuard refuses a test process holding a
//             value of this shape under ANY name not declared public.
//   readBy    set when our code does not read it: a library does, or only a tool does.

const ALWAYS_LOCAL = { test: 'unset', e2e: 'local' };

// `@type {const}` keeps each `kind` a literal, so config/index.js can type config.X from it.
module.exports = /** @type {const} */ ({
  // ── Runtime ────────────────────────────────────────────────────────────────
  NODE_ENV: {
    kind: 'string', test: 'pass', e2e: 'local',
    doc: "'production' in the Docker image; Jest sets 'test'. Gates DEV_MODE, Sentry and the dev-database guard.",
  },
  PORT: { kind: 'number', default: 8080, ...ALWAYS_LOCAL, doc: 'Port to listen on. Cloud Run sets it.' },
  K_SERVICE: {
    kind: 'string', test: 'unset', e2e: 'unset',
    doc: 'Set by Cloud Run. Present means "this is the deployed service": Sentry and monitoring switch on.',
  },
  K_REVISION: {
    kind: 'string', default: 'dev-local', test: 'unset', e2e: 'unset',
    doc: "Set by Cloud Run; the service worker's cache version, so each deploy refreshes it.",
  },
  DEV_MODE: {
    kind: 'flag', ...ALWAYS_LOCAL,
    doc: 'Injects a mock superadmin/messeradmin user. Ignored when NODE_ENV=production (gotcha 5).',
  },
  E2E_SERVER: {
    kind: 'string', test: 'unset', e2e: 'local',
    doc: "'1' only in the browser suite's server (e2e/server-env.js sets it); /health reports it so the suite refuses to adopt any other server.",
  },
  ALLOW_PRODUCTION_DB: {
    kind: 'string', test: 'unset', e2e: 'unset',
    doc: "'i-know-what-i-am-doing' lets a non-production server use the production database (npm run prodlocal). See utils/devDatabaseGuard.js.",
  },

  // ── Auth0 ──────────────────────────────────────────────────────────────────
  AUTH0_DOMAIN: {
    kind: 'string', required: true, test: 'fake', testValue: 'test.auth0.com', e2e: 'local',
    doc: 'Auth0 tenant domain: login, logout and the management API.',
  },
  AUTH0_CLIENTID: {
    kind: 'id', required: true, test: 'fake', testValue: 'test-client-id', e2e: 'local',
    doc: 'Auth0 application client id.',
  },
  AUTH0_CLIENT_SECRET: {
    kind: 'secret', required: true, test: 'fake', testValue: 'test-client-secret',
    doc: 'Auth0 application secret: the login callback and the management API token.',
  },
  AUTH0_CALLBACK_URL: {
    kind: 'url', default: 'http://127.0.0.1:8080/callback',
    test: 'fake', testValue: 'http://127.0.0.1:8080/callback', e2e: 'local',
    doc: 'Where Auth0 returns after login.',
  },

  // ── Database ───────────────────────────────────────────────────────────────
  DATABASE_URL: {
    kind: 'url', required: true, test: 'fake', testValue: 'postgresql://test:test@127.0.0.1:1/nowhere', e2e: 'local',
    doc: 'PostgreSQL connection string (Supabase in production, local Postgres in dev.env).',
  },
  TAMESIDE_DATABASE_URL: {
    kind: 'url', readBy: 'tools/gap-finder', test: 'fake', testValue: 'postgresql://test:test@127.0.0.1:1/nowhere',
    doc: "Tameside's database, read only by the cross-league gap-finder.",
  },
  DB_PI_KEY: {
    kind: 'secret', required: true, test: 'fake', testValue: 'test-pi-key-not-the-real-one', e2e: 'local',
    doc: 'pgp_sym key for the encrypted contact columns. Always a bound ? parameter, never inlined.',
  },
  PG_POOL_MAX: { kind: 'number', default: 5, ...ALWAYS_LOCAL, doc: 'pg Pool size.' },

  // ── Sessions and forms ─────────────────────────────────────────────────────
  SESSION_SECRET: {
    kind: 'secret', required: 'production', default: 'dev-only-session-secret',
    test: 'fake', testValue: 'test-session-secret',
    doc: 'Signs the __session cookie and the spam-check form tokens. Only dev may run on the default.',
  },
  RECAPTCHA: { kind: 'public', test: 'fake', testValue: 'test-recaptcha', e2e: 'local', doc: 'reCAPTCHA site key, printed into forms.' },
  RECAPTCHA_SECRET: { kind: 'secret', test: 'fake', testValue: 'test-recaptcha-secret', doc: 'reCAPTCHA server-side secret.' },
  GLOBAL_RATE_LIMIT: { kind: 'number', default: 600, ...ALWAYS_LOCAL, doc: 'Requests per IP per window, site-wide (middleware/rateLimit.js).' },

  // ── AWS ────────────────────────────────────────────────────────────────────
  // The SDK reads these itself. Faking all of them in tests closes the credential chain at
  // all three ends — environment, shared credentials file, instance metadata (HARD-26).
  AWS_ACCESS_KEY_ID: {
    kind: 'secret', readBy: 'aws-sdk', test: 'fake', testValue: 'test-access-key-id', shape: /^(AKIA|ASIA)[A-Z0-9]{16}$/,
    doc: 'S3 and SES credentials.',
  },
  AWS_SECRET_ACCESS_KEY: { kind: 'secret', readBy: 'aws-sdk', test: 'fake', testValue: 'test-secret-access-key', doc: 'S3 and SES credentials.' },
  AWS_SESSION_TOKEN: { kind: 'secret', readBy: 'aws-sdk', test: 'fake', testValue: '', doc: 'Closed in tests.' },
  AWS_SHARED_CREDENTIALS_FILE: { kind: 'string', readBy: 'aws-sdk', test: 'fake', testValue: '/dev/null/no-such-credentials', doc: 'Closed in tests.' },
  AWS_CONFIG_FILE: { kind: 'string', readBy: 'aws-sdk', test: 'fake', testValue: '/dev/null/no-such-config', doc: 'Closed in tests.' },
  AWS_EC2_METADATA_DISABLED: { kind: 'string', readBy: 'aws-sdk', test: 'fake', testValue: 'true', doc: 'Closed in tests.' },
  AWS_PROFILE: { kind: 'string', readBy: 'aws-sdk', test: 'fake', testValue: '', doc: 'Closed in tests.' },
  AWS_REGION: { kind: 'string', default: 'eu-west-1', test: 'fake', testValue: 'eu-west-1', e2e: 'local', doc: 'Region for the DMARC report reader.' },
  S3_BUCKET_NAME: {
    kind: 'string', required: true, test: 'real', testValue: 'badmintontemp',
    doc: 'The badmintontemp bucket. Real even in tests: normalisePhotoUrl checks hosts against it, and the dead credentials are what make it unreachable.',
  },
  // Not secrets, so the real ARNs are the defaults: unset or '' still means our topic, and
  // the check in middleware/verifySns.js cannot be switched off from the environment.
  SNS_MAIL_TOPIC_ARN: {
    kind: 'id', default: 'arn:aws:sns:eu-west-1:758376057067:incomingEmail',
    test: 'fake', testValue: 'arn:aws:sns:eu-west-1:1:inbound-mail', e2e: 'local',
    doc: 'The only topic POST /mail accepts: the SES receipt rule inbound-badders-email.',
  },
  SNS_EVENTS_TOPIC_ARN: {
    kind: 'id', default: 'arn:aws:sns:eu-west-1:758376057067:emailInfo',
    test: 'fake', testValue: 'arn:aws:sns:eu-west-1:1:ses-events', e2e: 'local',
    doc: 'The only topic POST /ses-events accepts: the baddersEmail configuration set.',
  },

  // ── Mail ───────────────────────────────────────────────────────────────────
  RESULTS_EMAIL: {
    kind: 'string', default: 'results@stockport-badminton.co.uk', test: 'fake', testValue: 'results@example.invalid', e2e: 'local',
    doc: 'Results secretary, copied on roster changes.',
  },
  AUDIT_EMAIL_TO: {
    kind: 'list', test: 'unset', e2e: 'unset', unset: 'nothing is ever sent',
    doc: 'Recipients of the weekly data-integrity digest (HARD-07).',
  },
  AUDIT_EMAIL_FROM: {
    kind: 'string', test: 'unset', e2e: 'unset', unset: 'sends from the results address',
    doc: 'Sender for the digest.',
  },
  REGISTRATION_EMAIL_TO: {
    kind: 'list', test: 'unset', e2e: 'unset', unset: 'falls back to AUDIT_EMAIL_TO; both unset sends nothing',
    doc: 'Recipients of the daily player-registration reminder.',
  },
  REGISTRATION_INBOX_SENDERS: {
    kind: 'list', test: 'unset', e2e: 'unset', unset: 'closes the queue; mail is forwarded as before',
    doc: 'Who may put an email in the registrations@ queue.',
  },
  LIST_SEND_CHUNK: { kind: 'number', default: 6, ...ALWAYS_LOCAL, doc: 'Distribution-list sends per batch.' },
  LIST_SEND_BUDGET_MS: { kind: 'number', default: 10000, ...ALWAYS_LOCAL, doc: 'Time budget for one distribution-list request.' },

  // ── Scheduler secrets ──────────────────────────────────────────────────────
  // Compared by middleware/requireCronCaller.js with timingSafeEqual over SHA-256. A
  // superadmin session also works on every one of these routes.
  AUDIT_CRON_TOKEN: { kind: 'secret', test: 'unset', e2e: 'unset', unset: 'closes the token path', doc: 'X-Audit-Token → POST /admin/audit/run.' },
  REGISTRATION_CRON_TOKEN: { kind: 'secret', test: 'unset', e2e: 'unset', unset: 'closes the token path', doc: 'X-Registration-Token → POST /admin/registrations/run.' },
  INVOICE_CRON_TOKEN: { kind: 'secret', test: 'unset', e2e: 'unset', unset: 'closes the token path', doc: 'X-Invoice-Token → POST /league/sendInvoices.' },
  LATE_SCORECARD_CRON_TOKEN: { kind: 'secret', test: 'unset', e2e: 'unset', unset: 'closes the token path', doc: 'X-Late-Scorecard-Token → GET /fixture/outstanding.' },
  SOCIAL_CRON_TOKEN: {
    kind: 'secret', test: 'unset', e2e: 'unset', unset: 'closes the token path',
    doc: 'Scheduler → the weekly posts and the result drains. One secret for all, on purpose.',
  },

  // ── Site ───────────────────────────────────────────────────────────────────
  SITE_ORIGIN: {
    kind: 'url', default: 'https://stockport-badminton.co.uk', test: 'fake', testValue: 'https://stockport-badminton.co.uk', e2e: 'local',
    doc: 'Origin for canonical and absolute URLs (utils/canonical.js). Never req.get(host).',
  },
  CSP_ENFORCE: {
    kind: 'flag', test: 'unset', e2e: 'unset', unset: 'CSP resource allowlist is report-only',
    doc: 'Enforce the CSP allowlist. See utils/securityHeaders.js before setting.',
  },
  CSP_REPORT_URI: {
    kind: 'string', default: '/csp-report', emptyIsValue: true, ...ALWAYS_LOCAL,
    doc: "Where CSP violations are POSTed. '' emits no reporting directives.",
  },
  HSTS_INCLUDE_SUBDOMAINS: { kind: 'flag', ...ALWAYS_LOCAL, doc: 'Adds includeSubDomains to HSTS.' },
  NO_CLUB_ID: { kind: 'number', default: 63, ...ALWAYS_LOCAL, doc: 'The "No Club" placeholder club id.' },
  NO_TEAM_ID: { kind: 'number', default: 52, ...ALWAYS_LOCAL, doc: 'The "No Team" placeholder team id.' },

  // ── Third parties ──────────────────────────────────────────────────────────
  GMAPSAPIKEY: {
    kind: 'public', test: 'fake', testValue: 'test-gmaps-key', e2e: 'local',
    doc: 'Browser Maps key, on every club and event page of both sites; restricted in GCP, not here.',
  },
  GMAPS_STATIC_API_KEY: {
    kind: 'secret', test: 'fake', testValue: 'test-gmaps-static-key', shape: /^AIza[0-9A-Za-z_-]{35}$/,
    doc: 'Server-only key for the venues map generator.',
  },
  CLOUDINARY_KEY: { kind: 'secret', test: 'fake', testValue: 'test-cloudinary-key', doc: 'Cloudinary API key: the Messer gallery.' },
  CLOUDINARY_SECRET: { kind: 'secret', test: 'fake', testValue: 'test-cloudinary-secret', doc: 'Cloudinary API secret.' },
  POSTHOG_KEY: { kind: 'public', test: 'unset', e2e: 'unset', unset: 'loads no PostHog at all', doc: 'PostHog project key (phc_…), printed into pages.' },
  SENTRY_DSN: { kind: 'public', test: 'unset', e2e: 'unset', unset: 'Sentry is a no-op', doc: 'Server-side Sentry DSN (the node project).' },

  // ── Meta ───────────────────────────────────────────────────────────────────
  // The Page tokens never expire and can publish to the league's Facebook Pages and
  // Instagram. No test process may hold one; testEnvGuard also matches them by value.
  META_GRAPH_VERSION: { kind: 'string', default: 'v21.0', test: 'unset', e2e: 'unset', doc: 'Graph API version.' },
  META_PAGE_ID: { kind: 'id', test: 'unset', e2e: 'unset', doc: 'Stockport Facebook Page id.' },
  META_PAGE_TOKEN: { kind: 'secret', test: 'unset', e2e: 'unset', unset: 'nothing posts to Facebook or Instagram', doc: 'Stockport Page access token.' },
  META_IG_USER_ID: { kind: 'id', test: 'unset', e2e: 'unset', unset: 'nothing posts to Instagram', doc: 'Instagram business account id.' },
  META_TAMESIDE_PAGE_ID: { kind: 'id', test: 'unset', e2e: 'unset', doc: 'Tameside Facebook Page id.' },
  META_TAMESIDE_PAGE_TOKEN: { kind: 'secret', test: 'unset', e2e: 'unset', unset: 'nothing posts to the Tameside Page', doc: 'Tameside Page access token.' },
  META_THREADS_GRAPH_VERSION: { kind: 'string', default: 'v1.0', test: 'unset', e2e: 'unset', doc: 'Threads API version.' },
  META_THREADS_APP_ID: { kind: 'id', test: 'unset', e2e: 'unset', unset: 'closes the Threads login', doc: 'Threads app id.' },
  META_THREADS_APP_SECRET: { kind: 'secret', test: 'unset', e2e: 'unset', unset: 'closes the Threads login', doc: 'Threads app secret.' },
  META_THREADS_USER_ID: { kind: 'id', test: 'unset', e2e: 'unset', unset: 'closes the Threads login', doc: "The league's Threads account; the login callback refuses any other." },
  SOCIAL_POST_DIRECT: { kind: 'flag', test: 'unset', e2e: 'unset', unset: 'keeps the Make.com webhook path', doc: 'Queue each published result for Meta ourselves instead of handing it to Make.' },
  SOCIAL_POST_STORY: { kind: 'flag', test: 'unset', e2e: 'unset', unset: 'posts no Instagram story', doc: 'Also post the result as an Instagram story.' },
  SOCIAL_POST_FB_STORY: { kind: 'flag', test: 'unset', e2e: 'unset', unset: 'posts no Facebook story', doc: 'Also post every Facebook Page post as a Page story.' },
  SOCIAL_POST_THREADS: { kind: 'flag', test: 'unset', e2e: 'unset', unset: 'queues nothing for Threads', doc: 'Queue each published result for Threads.' },
});

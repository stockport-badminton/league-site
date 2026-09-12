// Browser-level coverage for the scorecard forms and the stats-page controls.
//
// The Jest suite (npm test) already covers these routes server-side with mocked
// models - validation, model calls, error paths. What it cannot do is run the
// page's JavaScript: the scorecard form lives inside a Bootstrap modal, its team
// and player dropdowns are populated by jQuery from three endpoints, and the
// stats tables are built by DataTables. That layer had no coverage at all, and it
// is the layer a Bootstrap 4 -> 5 migration would break (data-toggle becomes
// data-bs-toggle, .form-group and .form-row are removed, .close becomes
// .btn-close).
//
// The server this starts is configured by e2e/server-env.js, which is the browser
// counterpart of __tests__/setup.js: the local database from dev.env, and dead
// credentials for everything outbound. It refuses to start if anything live
// survives (HARD-33).
//
// That is not the same as e2e/helpers/read-only.js, and both are needed. The
// read-only helper intercepts BROWSER requests, so it cannot see a write the
// server makes from inside Node - which is exactly what the scorecard document
// endpoints do. server-env.js is what makes those harmless; the helper is what
// keeps the suite honest about what the page itself does.
//
// globalSetup then checks the server actually IS ours, because reuseExistingServer
// means we might have adopted somebody else's.

const { defineConfig, devices } = require('@playwright/test');

const BASE_URL = 'http://127.0.0.1:8080';

module.exports = defineConfig({
  testDir: './e2e',
  globalSetup: require.resolve('./e2e/global-setup.js'),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // DEV_MODE injects the mock superadmin so the secured routes render without
  // Auth0. It only works outside production (see middleware/secured.js).
  webServer: {
    command: 'DEV_MODE=true NODE_ENV=development GLOBAL_RATE_LIMIT=100000 node -r ./e2e/server-env.js app.js',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60 * 1000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});

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
// IMPORTANT: dev.env points at the same Supabase database as .env - local runs
// hit production data. These tests are therefore read-only by design, and
// e2e/helpers/read-only.js enforces it at the network layer rather than trusting
// the tests to behave: any unexpected mutating request fails the test instead of
// reaching the database. Nothing here submits a scorecard.

const { defineConfig, devices } = require('@playwright/test');

const BASE_URL = 'http://127.0.0.1:8080';

module.exports = defineConfig({
  testDir: './e2e',
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
    command: 'DEV_MODE=true NODE_ENV=development node -r dotenv/config app.js dotenv_config_path=./dev.env',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60 * 1000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});

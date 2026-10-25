// The `db` project (REARCH-08): model SQL tested against a real Postgres.
//
//   npm run test:db          needs the local container (tools/local-db.sh up)
//
// Separate from the default config on purpose, so `npm test` still needs no database —
// it is what CI's first step and every quick local run use. The database is rebuilt from
// migrations/ and tools/local-db/test-seed.sql at the start of each run, as `sdbl_test`
// beside the development database; that one is never touched.
//
// The rule this brings: a model function's SQL is tested here, or not at all. A mocked-
// database test of a model is not evidence that its query works. Controller tests keep
// mocking models — that is a different seam.
module.exports = {
  displayName: 'db',
  rootDir: __dirname,
  testEnvironment: 'node',
  testMatch: ['<rootDir>/__tests__/db/**/*.test.js'],
  // The main config ignores .claude/ because a worktree lives there; here it is matched
  // by rootDir instead, so a run inside a worktree still finds its own tests.
  testPathIgnorePatterns: ['/node_modules/'],
  // One worker. Every test file shares one database, and each test inserts rows with fixed
  // ids above 1000 (team 1001, season 1001, ...) inside a transaction it rolls back. Two
  // workers inserting the same key at once block on each other's uncommitted row, and
  // across enough files that becomes `deadlock detected` — five tests in five files, the
  // day the suite reached 21 files (REARCH-01). Serial, all of it runs in a few seconds.
  maxWorkers: 1,
  globalSetup: '<rootDir>/__tests__/db/globalSetup.js',
  setupFiles: ['<rootDir>/__tests__/setup.js', '<rootDir>/__tests__/db/env.js'],
  setupFilesAfterEnv: ['<rootDir>/__tests__/db/setupAfterEnv.js'],
  testTimeout: 15000,
};

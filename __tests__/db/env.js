// After __tests__/setup.js: the one variable this project changes. Everything else stays
// as setup.js declares it — the dead credentials, the deleted tokens, the fake DB_PI_KEY
// the seed encrypted its contact details under.
const { testDatabaseUrl } = require('./helpers/testDatabase');

process.env.DATABASE_URL = testDatabaseUrl();

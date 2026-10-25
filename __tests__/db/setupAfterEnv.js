// Every test in the `db` project runs inside a transaction that is rolled back, so tests
// do not see each other's writes and need no cleanup. See helpers/onePool.js for how.

// The same refusal as the main suite: nothing in a test process may hold a live credential.
const { liveCredentials, refusalMessage } = require('../../utils/testEnvGuard');
const live = liveCredentials(process.env);
if (live.length) throw new Error(refusalMessage(live));

// Only Pool is replaced. Named rather than spread: pg's `native` export is a getter that
// tries to load pg-native.
jest.mock('pg', () => {
  const actual = jest.requireActual('pg');
  return { Client: actual.Client, types: actual.types, Pool: require('./helpers/onePool').OnePool };
});

const onePool = require('./helpers/onePool');
const db = require('../../db_connect');

beforeAll(async () => {
  await onePool.open(process.env.DATABASE_URL);
  db.connect();
});
beforeEach(() => onePool.exclusive('BEGIN'));
afterEach(() => onePool.exclusive('ROLLBACK'));
afterAll(() => onePool.close());

// Nothing in a test process may reach production (HARD-26).
//
// This exposure was patched three times variable by variable before anyone looked at the
// shape of it: Sentry reporting our own test runs as production errors, then — the one
// that got through — `npm test` writing two real objects into the production bucket,
// because HARD-25's storage half was the first server-side PUT in the codebase and no
// suite had ever had a reason to mock S3.
//
// Each patch was one variable behind whatever went into .env next. So the guard checks the
// SHAPE of what is present rather than a list of names, and app.js/instrument.js no longer
// load .env under NODE_ENV=test at all: setup.js declares the environment, and a variable
// a test needs has to be stated rather than inherited.

const { liveCredentials, hostOf } = require('../../utils/testEnvGuard');

const PRODUCTION_DB = 'postgresql://u:p@aws-0-eu-west-1.pooler.supabase.com:6543/postgres';

describe('the live-credential guard', () => {
  it('catches a production database url', () => {
    expect(liveCredentials({ DATABASE_URL: PRODUCTION_DB }))
      .toEqual([expect.stringContaining('DATABASE_URL points at')]);
  });

  // Another league's database, and the one nobody would think to look for.
  it('catches the Tameside database too', () => {
    expect(liveCredentials({ TAMESIDE_DATABASE_URL: PRODUCTION_DB })).toHaveLength(1);
  });

  // By shape, not by name: this is what makes it survive the next variable added to .env.
  it('catches a real AWS key id by its shape, and passes the dummy', () => {
    expect(liveCredentials({ AWS_ACCESS_KEY_ID: 'AKIA3BEV4JDVXJZUB64N' })).toHaveLength(1);
    expect(liveCredentials({ AWS_ACCESS_KEY_ID: 'test-access-key-id' })).toEqual([]);
  });

  // Unset is what closes these paths; a value in a test process is a live secret with
  // nothing to gain from it.
  it('catches a cron token or a recipient list being set', () => {
    expect(liveCredentials({ AUDIT_CRON_TOKEN: 'x' })).toHaveLength(1);
    expect(liveCredentials({ REGISTRATION_CRON_TOKEN: 'x' })).toHaveLength(1);
    expect(liveCredentials({ AUDIT_EMAIL_TO: 'a@b.com' })).toHaveLength(1);
    expect(liveCredentials({ REGISTRATION_EMAIL_TO: 'a@b.com' })).toHaveLength(1);
  });

  it('passes a properly declared test environment', () => {
    expect(liveCredentials({
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/nowhere',
      AWS_ACCESS_KEY_ID: 'test-access-key-id',
      S3_BUCKET_NAME: 'badmintontemp',   // real, and deliberately so — see setup.js
    })).toEqual([]);
  });

  it('reads the host out of either connection-string form', () => {
    expect(hostOf(PRODUCTION_DB)).toBe('aws-0-eu-west-1.pooler.supabase.com');
    expect(hostOf('postgresql://u:p@db.abcdefgh.supabase.co:5432/postgres')).toBe('db.abcdefgh.supabase.co');
  });
});

// The demonstration HARD-25's acceptance criteria asked for, kept rather than deleted: the
// process this suite runs in must hold nothing that resolves anywhere real.
describe('this very process', () => {
  it('holds no live credential', () => {
    expect(liveCredentials(process.env)).toEqual([]);
  });

  it('cannot reach the production database, because it does not know where it is', () => {
    expect(process.env.DATABASE_URL).not.toMatch(/supabase/);
    expect(process.env.DB_PI_KEY).toBe('test-pi-key-not-the-real-one');
  });

  // It kept its real value on purpose: tests build URLs from it and compare them against
  // normalisePhotoUrl, which checks the host against this variable. Renaming it would make
  // those tests wrong rather than safer — what makes the bucket unreachable is the dead
  // credentials, not a fake name.
  it('keeps the real bucket name, which is not a credential', () => {
    expect(process.env.S3_BUCKET_NAME).toBe('badmintontemp');
    expect(process.env.AWS_ACCESS_KEY_ID).toBe('test-access-key-id');
  });
});

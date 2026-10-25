// Which database the `db` project uses, and the rule that keeps it from being any other.
//
// The suite DROPs and recreates this database at the start of every run, so the name is
// the guard: it must end `_test`. That is what stops a TEST_DATABASE_URL pasted from the
// wrong file from taking the local development database (`sdbl`) — let alone production,
// which testEnvGuard refuses separately by host.
//
// Local: the tools/local-db.sh container. CI: the `pg` service cloudbuild.yaml starts.
const DEFAULT_URL = 'postgresql://sdbl:sdbl@127.0.0.1:5433/sdbl_test';

function testDatabaseUrl() {
  const raw = process.env.TEST_DATABASE_URL || DEFAULT_URL;
  const url = new URL(raw);
  const name = url.pathname.slice(1);
  if (!/_test$/.test(name)) {
    throw new Error(`TEST_DATABASE_URL names "${name}": the db suite drops its database, so it must end _test`);
  }
  if (/supabase/i.test(url.hostname)) {
    throw new Error(`TEST_DATABASE_URL points at ${url.hostname}: never production`);
  }
  return raw;
}

// The same server, another database — for DROP/CREATE DATABASE, which cannot run while
// connected to the database being dropped.
function withDatabase(raw, name) {
  const url = new URL(raw);
  url.pathname = '/' + name;
  return url.toString();
}

module.exports = { testDatabaseUrl, withDatabase };

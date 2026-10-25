// HARD-32: nothing recorded which migrations a database had seen. Re-applying was safe only
// because every file says IF NOT EXISTS, and "has this run against production yet?" was
// answered by remembering.
//
// run-migration.js now records each file in `schema_migrations` (migrations/025) with a
// hash of its bytes. These tests drive applyMigration() against a fake connection; the
// same cases were rehearsed against a real local Postgres built by `tools/local-db.sh
// load`, which is where the shell half's hash was shown to match this one.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { applyMigration, fileHash, Refusal, LEDGER_MIGRATION } = require('../../run-migration');

const ROOT = path.join(__dirname, '..', '..');
const SQL = Buffer.from('CREATE TABLE IF NOT EXISTS a (id int);\nCREATE INDEX IF NOT EXISTS a_id ON a (id);\n');
const HASH = crypto.createHash('sha256').update(SQL).digest('hex');

// A connection with an optional ledger row for the file. Records every statement.
function fakeConn({ ledger = true, row = null, fail = null } = {}) {
  const sent = [];
  return {
    sent,
    ran: () => sent.filter(s => /^CREATE (TABLE|INDEX)/.test(s.sql)).map(s => s.sql),
    inserts: () => sent.filter(s => s.sql.startsWith('INSERT INTO schema_migrations')),
    query: async (sql, params) => {
      sent.push({ sql, params });
      if (sql.includes("to_regclass('public.schema_migrations')")) return [[{ present: ledger }]];
      if (sql.startsWith('SELECT sha256')) return [row ? [row] : []];
      if (fail && sql.startsWith(fail.prefix)) throw new Error(fail.message);
      return [[]];
    },
  };
}
const quiet = { log: () => {} };

describe('run-migration.js records what it applies', () => {
  it('runs a file it has no record of, then records it with the hash of its bytes', async () => {
    const conn = fakeConn();
    expect(await applyMigration(conn, '026_x.sql', SQL, quiet)).toBe('applied');

    expect(conn.ran()).toHaveLength(2);
    expect(conn.inserts()).toHaveLength(1);
    expect(conn.inserts()[0].sql).toContain("'applied'");
    expect(conn.inserts()[0].params).toEqual(['026_x.sql', HASH]);
    // Recorded after the statements, not before: a failed run must leave no row.
    expect(conn.sent.indexOf(conn.inserts()[0])).toBe(conn.sent.length - 1);
  });

  it('treats a second application of the same file as a recorded no-op', async () => {
    const conn = fakeConn({ row: { sha256: HASH, how: 'applied', recorded_at: new Date() } });
    expect(await applyMigration(conn, '026_x.sql', SQL, quiet)).toBe('already-applied');
    expect(conn.ran()).toEqual([]);
    expect(conn.inserts()).toEqual([]);
  });

  // CHAR(64) pads; a hash compared without trimming would refuse every recorded file.
  it('compares the recorded hash without its padding', async () => {
    const conn = fakeConn({ row: { sha256: HASH + ' ', how: 'replayed', recorded_at: new Date() } });
    expect(await applyMigration(conn, '026_x.sql', SQL, quiet)).toBe('already-applied');
  });

  it('refuses a file edited since it was recorded, and runs none of it', async () => {
    const conn = fakeConn({ row: { sha256: 'f'.repeat(64), how: 'applied', recorded_at: new Date() } });
    await expect(applyMigration(conn, '026_x.sql', SQL, quiet)).rejects.toThrow(/changed since it was recorded/);
    await expect(applyMigration(conn, '026_x.sql', SQL, quiet)).rejects.toBeInstanceOf(Refusal);
    expect(conn.ran()).toEqual([]);
    expect(conn.inserts()).toEqual([]);
  });

  it('refuses every file but the ledger migration on a database with no ledger', async () => {
    const conn = fakeConn({ ledger: false });
    await expect(applyMigration(conn, '011_scorecard_confirm_token.sql', SQL, quiet))
      .rejects.toThrow(`Apply ${LEDGER_MIGRATION} first`);
    expect(conn.ran()).toEqual([]);
  });

  it('applies the ledger migration to a database with no ledger, and records it', async () => {
    const conn = fakeConn({ ledger: false });
    expect(await applyMigration(conn, LEDGER_MIGRATION, SQL, quiet)).toBe('applied');
    expect(conn.inserts()).toHaveLength(1);
  });

  it('records nothing when a statement fails', async () => {
    const conn = fakeConn({ fail: { prefix: 'CREATE INDEX', message: 'column "id" does not exist' } });
    await expect(applyMigration(conn, '026_x.sql', SQL, quiet)).rejects.toThrow('does not exist');
    expect(conn.inserts()).toEqual([]);
  });

  // The tolerance that lets 003 replay after 002 was corrected in place.
  it('still skips "already exists", and records the file', async () => {
    const conn = fakeConn({ fail: { prefix: 'CREATE INDEX', message: 'relation "a_id" already exists' } });
    expect(await applyMigration(conn, '026_x.sql', SQL, quiet)).toBe('applied');
    expect(conn.inserts()).toHaveLength(1);
  });

  it('--record-only records a backfill and runs nothing', async () => {
    const conn = fakeConn();
    expect(await applyMigration(conn, '011_x.sql', SQL, { ...quiet, recordOnly: true })).toBe('recorded');
    expect(conn.ran()).toEqual([]);
    expect(conn.inserts()[0].sql).toContain("'backfilled'");
    expect(conn.inserts()[0].params).toEqual(['011_x.sql', HASH]);
  });

  it('--record-only does not overwrite a record that exists', async () => {
    const conn = fakeConn({ row: { sha256: HASH, how: 'applied', recorded_at: new Date() } });
    expect(await applyMigration(conn, '011_x.sql', SQL, { ...quiet, recordOnly: true })).toBe('already-applied');
    expect(conn.inserts()).toEqual([]);
  });
});

describe('the ledger and its two writers agree', () => {
  it('the ledger migration exists under the name the runner bootstraps from', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'migrations', LEDGER_MIGRATION), 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS schema_migrations/);
    for (const how of ['applied', 'replayed', 'backfilled']) expect(sql).toContain(`'${how}'`);
  });

  // The local load writes rows with shasum; the runner compares with fileHash. Both must
  // hash the BYTES, or a file with a BOM or CRLFs reads as edited the moment it is loaded.
  it('hashes bytes, as shasum does', () => {
    const bytes = Buffer.from([0xef, 0xbb, 0xbf, 0x0d, 0x0a]);
    expect(fileHash(bytes)).toBe(crypto.createHash('sha256').update(bytes).digest('hex'));
  });

  it('tools/local-db.sh records the replay, after every file has gone in and before the seed', () => {
    const sh = fs.readFileSync(path.join(ROOT, 'tools', 'local-db.sh'), 'utf8');
    const replay = sh.indexOf('for f in migrations/001_initial.sql');
    const record = sh.indexOf('INSERT INTO schema_migrations');
    const seed = sh.indexOf('migrations/data/002_data.sql ]');
    expect(replay).toBeGreaterThan(-1);
    expect(record).toBeGreaterThan(replay);
    expect(seed).toBeGreaterThan(record);
    expect(sh).toMatch(/VALUES \('%s', '%s', 'replayed'\)/);
    expect(sh).toMatch(/"\$\(basename "\$f"\)" "\$\(sha256_of "\$f"\)"/);
  });
});

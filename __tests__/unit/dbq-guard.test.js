// tools/dbq.js refuses anything that is not a single read, because DATABASE_URL is
// production and there is no local copy to practise on.
//
// Exercised rather than trusted: it is the only thing between a typo and the league's
// data, and it has already been wrong once — a semicolon inside a `--` comment was
// rejected as "multiple statements", which is the same blind spot HARD-18 records for
// run-migration.js splitting on `;` with no regard for comments.

const { assertReadOnly } = require('../../tools/dbq');

describe('what it refuses', () => {
  it.each([
    ['a second statement',        'SELECT 1; DROP TABLE fixture',        /multiple statements/],
    ['a delete',                  'DELETE FROM fixture',                 /only SELECT/],
    ['an update',                 'UPDATE fixture SET status = 1',       /only SELECT/],
    ['a truncate',                'TRUNCATE fixture',                    /only SELECT/],
    ['DDL',                       'CREATE TABLE x (id int)',             /only SELECT/],
    // Stripping comments for the semicolon test must not become a way past the other
    // tests: the write keyword is still visible to them.
    ['a write hidden after a comment', 'SELECT 1 --;\nDROP TABLE fixture', /write keyword/],
  ])('refuses %s', (_label, sql, expected) => {
    expect(() => assertReadOnly(sql)).toThrow(expected);
  });
});

describe('what it allows', () => {
  it('allows a plain select', () => {
    expect(assertReadOnly('SELECT 1')).toBe('SELECT 1');
  });

  it('allows a WITH whose body is a select', () => {
    expect(() => assertReadOnly('WITH x AS (SELECT 1 AS n) SELECT n FROM x')).not.toThrow();
  });

  it('strips one trailing semicolon, as anyone pasting SQL will leave', () => {
    expect(assertReadOnly('SELECT 1;')).toBe('SELECT 1');
  });

  // The fix. A check in tools/audit/checks.js could not be run by name because its
  // explanatory comment contained a semicolon.
  it('allows a semicolon inside a comment', () => {
    const sql = 'SELECT 1 -- a comment; with a semicolon in it\n';
    expect(() => assertReadOnly(sql)).not.toThrow();
  });

  // ...and the audit checks themselves must all pass their own guard, since a check that
  // cannot be run by name is only discovered by someone trying.
  it('accepts every audit check', () => {
    const checks = require('../../tools/audit/checks');
    const names = checks.all().map(c => c.name);
    expect(names.length).toBeGreaterThan(5);
    for (const name of names) {
      expect(() => assertReadOnly(checks.get(name).sql)).not.toThrow();
    }
  });
});

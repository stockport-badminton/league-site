// The ? -> $N placeholder conversion every query in the app goes through.
//
// It was `sql.replace(/\?/g, ...)`, which rewrites every question mark in the statement
// including the ones that are not placeholders. Found on 31 Aug 2026 while writing a
// HARD-09 cleanup script whose SELECT labelled a deleted team `'?#' || f."homeTeam"`:
// the literal took $1, the real parameter became $2, and Postgres answered "could not
// determine data type of parameter $1".
//
// The dangerous half is the other order. With the literal *after* the placeholder there
// is no error at all — the statement runs and the literal comes back corrupted:
//
//   SELECT ?::text AS param, '?#unknown' AS literal   ->   literal = '$2#unknown'
//
// Verified against the real database before the fix, which is also how it was found
// still live in tools/audit/checks.js: the audit prints `$1#44` where it means `?#44`.

const { pgify } = require('../../db_connect');

describe('pgify', () => {
  describe('what it must still do', () => {
    it('numbers placeholders in sequence', () => {
      expect(pgify('SELECT * FROM t WHERE a = ? AND b = ?')).toBe(
        'SELECT * FROM t WHERE a = $1 AND b = $2');
    });

    it('leaves a statement with no placeholders alone', () => {
      expect(pgify('SELECT 1')).toBe('SELECT 1');
    });

    it('does not touch an existing $N', () => {
      expect(pgify('SELECT $1')).toBe('SELECT $1');
    });
  });

  describe('question marks that are not placeholders', () => {
    // The exact shape that failed. tools/audit/checks.js labels a fixture pointing at a
    // deleted team this way, so this is the live case, not a contrived one.
    it('ignores a ? inside a string literal before a real placeholder', () => {
      expect(pgify(`SELECT COALESCE(t.name, '?#' || f."homeTeam") FROM f WHERE f.date < ?`))
        .toBe(`SELECT COALESCE(t.name, '?#' || f."homeTeam") FROM f WHERE f.date < $1`);
    });

    // The silent one: no error, wrong data.
    it('ignores a ? inside a string literal after a real placeholder', () => {
      expect(pgify(`SELECT ?::text AS param, '?#unknown' AS literal`))
        .toBe(`SELECT $1::text AS param, '?#unknown' AS literal`);
    });

    it('handles a doubled quote inside a literal', () => {
      expect(pgify(`SELECT 'it''s ? here', ? FROM t`))
        .toBe(`SELECT 'it''s ? here', $1 FROM t`);
    });

    it('ignores a ? inside a quoted identifier', () => {
      expect(pgify(`SELECT t."odd?name" FROM t WHERE id = ?`))
        .toBe(`SELECT t."odd?name" FROM t WHERE id = $1`);
    });

    it('ignores a ? in a line comment', () => {
      expect(pgify('-- why ? here\nSELECT ?'))
        .toBe('-- why ? here\nSELECT $1');
    });

    it('ignores a ? in a block comment, including a nested one', () => {
      expect(pgify('/* a ? /* nested ? */ still */ SELECT ?'))
        .toBe('/* a ? /* nested ? */ still */ SELECT $1');
    });

    it('ignores a ? inside a dollar-quoted string', () => {
      expect(pgify('SELECT $$a ? b$$, ?')).toBe('SELECT $$a ? b$$, $1');
      expect(pgify('SELECT $tag$a ? b$tag$, ?')).toBe('SELECT $tag$a ? b$tag$, $1');
    });

    // A placeholder count that does not match the params array is what turns this from a
    // cosmetic bug into a rejected statement, so the count itself is worth asserting.
    it('counts only the real placeholders', () => {
      const sql = `SELECT '?', "?", -- ?\n ?, ?`;
      expect(pgify(sql).match(/\$\d+/g)).toEqual(['$1', '$2']);
    });
  });

  describe('the multi-line SQL this codebase actually writes', () => {
    it('handles a quoted camelCase join with a literal and two placeholders', () => {
      const sql = `
        SELECT f.id, COALESCE(ht.name, '?#' || f."homeTeam") AS home
        FROM fixture f
        LEFT JOIN team ht ON f."homeTeam" = ht.id
        WHERE f.status = ? AND f.date < ?::timestamp`;
      const out = pgify(sql);
      expect(out).toContain(`'?#' || f."homeTeam"`);
      expect(out).toContain('f.status = $1');
      expect(out).toContain('f.date < $2::timestamp');
      expect(out.match(/\$\d+/g)).toEqual(['$1', '$2']);
    });
  });
});

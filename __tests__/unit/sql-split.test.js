// Splitting a script into statements without mistaking a semicolon in prose for a
// statement boundary.
//
// `run-migration.js` used `sql.split(';')`. migrations/011_scorecard_confirm_token.sql had
// two semicolons in its header comment, so the file became three chunks: the first ended
// mid-comment, the second began with bare prose ("nothing changes for a captain, who...")
// because the `--` that made it a comment was left behind in chunk one, and the third held
// the ALTER TABLE. Postgres rejects chunk two, so the ALTER never ran and the column was
// never created (HARD-18).
//
// The original file is kept in __tests__/fixtures/ so this tests the real thing rather
// than a reconstruction of it — the live migration has since been reworded.
//
// Every case below is also run through the OLD implementation, which must get it wrong.
// A test that passes against both implementations is not testing the fix.

const fs = require('fs');
const path = require('path');
const { splitStatements, hasCode, preview } = require('../../utils/sqlScan');

// The splitter as it was.
const naiveSplit = sql => sql.split(';').map(s => s.trim()).filter(s => s.length > 0);

const ORIGINAL_011 = fs.readFileSync(
  path.join(__dirname, '..', 'fixtures', 'migration-011-original.sql'), 'utf8');

describe('semicolons that are not statement boundaries', () => {
  it('ignores one inside a -- comment: the real migration 011', () => {
    const statements = splitStatements(ORIGINAL_011);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('ALTER TABLE scorecardstore');

    // What used to happen: three chunks, the middle one bare prose, the ALTER stranded
    // behind its syntax error.
    const old = naiveSplit(ORIGINAL_011);
    expect(old).toHaveLength(3);
    expect(old[1]).toMatch(/^nothing changes for a captain/);
  });

  it('ignores one inside a string literal', () => {
    const sql = `INSERT INTO note (body) VALUES ('first; second'); SELECT 1`;
    expect(splitStatements(sql)).toEqual([
      `INSERT INTO note (body) VALUES ('first; second')`,
      'SELECT 1',
    ]);
    expect(naiveSplit(sql)).toHaveLength(3);
  });

  it('ignores one inside a quoted identifier', () => {
    const sql = `ALTER TABLE t ADD COLUMN "odd;name" TEXT`;
    expect(splitStatements(sql)).toEqual([sql]);
    expect(naiveSplit(sql)).toHaveLength(2);
  });

  it('ignores them inside a $$ function body — the case that matters most', () => {
    const sql = `CREATE FUNCTION bump() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  NEW.rev := OLD.rev + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER t BEFORE UPDATE ON player FOR EACH ROW EXECUTE FUNCTION bump()`;
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('RETURN NEW;');
    expect(statements[1]).toContain('CREATE TRIGGER');
    // The old splitter shredded the body into fragments.
    expect(naiveSplit(sql).length).toBeGreaterThan(2);
  });

  it('ignores one inside a /* */ block, including a nested one', () => {
    const sql = `/* note; and /* nested; */ still note; */ SELECT 1`;
    expect(splitStatements(sql)).toEqual([sql]);
    expect(naiveSplit(sql)).toHaveLength(4);
  });
});

describe('semicolons that are statement boundaries', () => {
  it('still separates real statements, in order', () => {
    const sql = `CREATE TABLE a (id INT);\nCREATE TABLE b (id INT);\nCREATE TABLE c (id INT);`;
    expect(splitStatements(sql)).toEqual([
      'CREATE TABLE a (id INT)', 'CREATE TABLE b (id INT)', 'CREATE TABLE c (id INT)',
    ]);
  });

  it('does not need a trailing semicolon on the last statement', () => {
    expect(splitStatements('SELECT 1; SELECT 2')).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('keeps a statement with its leading comment', () => {
    const [only] = splitStatements('-- why\nSELECT 1;');
    expect(only).toBe('-- why\nSELECT 1');
  });
});

describe('nothing to run', () => {
  it.each([
    ['empty file', ''],
    ['whitespace only', '\n\n   \n'],
    ['comment only', '-- just a note\n-- and another\n'],
    ['block comment only', '/* nothing\n   to do */\n'],
    ['trailing semicolon after the last statement', 'SELECT 1;'],
  ])('%s yields no stray statement', (_name, sql) => {
    for (const s of splitStatements(sql)) expect(hasCode(s)).toBe(true);
  });

  it('drops comment-only chunks the old splitter would have executed', () => {
    expect(splitStatements('-- a note\n')).toEqual([]);
    expect(naiveSplit('-- a note\n')).toEqual(['-- a note']);
  });
});

describe('preview', () => {
  it('reports the first line of SQL, not the comment above it', () => {
    expect(preview(ORIGINAL_011.trim())).toMatch(/^ALTER TABLE scorecardstore/);
  });

  it('collapses whitespace and truncates', () => {
    expect(preview('SELECT\n   a,\n   b\nFROM t', 12)).toBe('SELECT a, b…');
  });
});

describe('every migration in the repo parses', () => {
  const dir = path.join(__dirname, '..', '..', 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql'));

  it('finds migrations to check', () => expect(files.length).toBeGreaterThan(5));

  it.each(files)('%s splits into statements that each contain SQL', file => {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const statements = splitStatements(sql);
    expect(statements.length).toBeGreaterThan(0);
    for (const s of statements) {
      expect(hasCode(s)).toBe(true);
      // A chunk that begins mid-prose is the 011 signature: no SQL keyword anywhere.
      expect(preview(s)).toMatch(/^[A-Za-z"(]/);
    }
  });
});

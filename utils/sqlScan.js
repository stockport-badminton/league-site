// Walking a SQL string while knowing what you are inside of.
//
// Two places need this and both got it wrong the same way, by scanning the text as if it
// were flat:
//
//   - `pgify` in db_connect.js rewrote `?` to `$N` with a regex, so a question mark inside
//     a string literal became a placeholder. Fixed in baf2215; the state machine below is
//     that fix, lifted out.
//   - `run-migration.js` split statements on `;` with String.split, so a semicolon inside
//     a comment was a statement boundary. That is HARD-18, and it is why
//     migrations/011_scorecard_confirm_token.sql could not be applied by the runner: the
//     header comment contained two semicolons, the chunk after the first began mid-prose,
//     and the ALTER TABLE sat behind that chunk's syntax error. The column would never
//     have been created.
//
// Same bug, one layer apart, so they share one scanner rather than keeping two that can
// drift. The regions Postgres understands:
//
//   'literal'          with '' as the escape
//   "identifier"       with "" as the escape
//   $tag$ ... $tag$    dollar quoting, tag optional
//   -- to end of line
//   /* ... */          nestable, as Postgres allows
//
// An unterminated region runs to the end of the input rather than throwing. That is
// deliberate: this is not a validator, and Postgres will give a better error than we can.

/**
 * The index just past the non-code region starting at `i`, or `i` itself if `sql[i]`
 * does not begin one. Never goes backwards, so a caller can loop on it safely.
 */
function regionEnd(sql, i) {
  const ch = sql[i];
  const next = sql[i + 1];

  // -- line comment
  if (ch === '-' && next === '-') {
    const end = sql.indexOf('\n', i);
    return end === -1 ? sql.length : end;
  }

  // /* block comment */, which Postgres allows to nest
  if (ch === '/' && next === '*') {
    let depth = 0;
    let j = i;
    while (j < sql.length) {
      if (sql[j] === '/' && sql[j + 1] === '*') { depth++; j += 2; continue; }
      if (sql[j] === '*' && sql[j + 1] === '/') { depth--; j += 2; if (!depth) break; continue; }
      j++;
    }
    return j;
  }

  // $tag$ dollar-quoted string. The tag may be empty ($$) or a bare identifier.
  if (ch === '$') {
    const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
    if (tag) {
      const marker = tag[0];
      const close = sql.indexOf(marker, i + marker.length);
      return close === -1 ? sql.length : close + marker.length;
    }
    return i;
  }

  // 'string literal' or "quoted identifier"; a doubled quote is an escaped one.
  if (ch === "'" || ch === '"') {
    const quote = ch;
    let j = i + 1;
    while (j < sql.length) {
      if (sql[j] === quote) {
        if (sql[j + 1] === quote) { j += 2; continue; }
        j++;
        break;
      }
      j++;
    }
    return j;
  }

  return i;
}

/** Does this chunk contain anything but whitespace and comments? */
function hasCode(chunk) {
  let i = 0;
  while (i < chunk.length) {
    const ch = chunk[i];
    if ((ch === '-' && chunk[i + 1] === '-') || (ch === '/' && chunk[i + 1] === '*')) {
      i = regionEnd(chunk, i);
      continue;
    }
    if (!/\s/.test(ch)) return true;
    i++;
  }
  return false;
}

/**
 * Split a script into statements on top-level semicolons only. Comments are kept with the
 * statement that follows them; a chunk that is nothing but comments and whitespace is
 * dropped, since there is nothing in it to run.
 */
function splitStatements(sql) {
  const chunks = [];
  let start = 0;
  let i = 0;
  while (i < sql.length) {
    const stop = regionEnd(sql, i);
    if (stop > i) { i = stop; continue; }
    if (sql[i] === ';') {
      chunks.push(sql.slice(start, i));
      i += 1;
      start = i;
      continue;
    }
    i += 1;
  }
  chunks.push(sql.slice(start));
  return chunks.map(s => s.trim()).filter(hasCode);
}

/**
 * The first line of real SQL in a chunk, for logging. A migration's statement usually
 * carries a paragraph of comment above it, and echoing that back tells you nothing about
 * which statement failed.
 */
function preview(statement, max = 60) {
  let i = 0;
  while (i < statement.length) {
    const ch = statement[i];
    if ((ch === '-' && statement[i + 1] === '-') || (ch === '/' && statement[i + 1] === '*')) {
      i = regionEnd(statement, i);
      continue;
    }
    if (/\s/.test(ch)) { i++; continue; }
    break;
  }
  const code = statement.slice(i).replace(/\s+/g, ' ').trim();
  return code.length > max ? code.slice(0, max).trimEnd() + '…' : code;
}

module.exports = { regionEnd, hasCode, splitStatements, preview };

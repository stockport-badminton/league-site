// Application code logs through utils/log.js, never `console.` (REARCH-09 part B).
//
// On Cloud Run a console line reaches Cloud Logging as bare text: no severity, a
// multi-line value split into one entry per line, and nothing tying it to its request.
// utils/log.js writes JSON that Cloud Logging parses into all three.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');

// What runs in the Cloud Run container, as in config.test.js — less views/, whose
// console calls are browser code. tools/, scripts/, e2e/ and run-migration.js are command
// line programs talking to a terminal, and are outside the rule.
const APP = ['app.js', 'instrument.js', 'db_connect.js', 'db', 'config', 'controllers', 'models', 'utils', 'middleware', 'routes'];

function filesUnder(rel) {
  const at = path.join(root, rel);
  if (fs.statSync(at).isFile()) return [rel];
  return fs.readdirSync(at, { withFileTypes: true }).flatMap(d => {
    const child = path.join(rel, d.name);
    if (d.isDirectory()) return filesUnder(child);
    return /\.js$/.test(d.name) ? [child] : [];
  });
}

describe('application code logs through utils/log.js', () => {
  it('has no console calls', () => {
    // Block comments blanked line for line, so a commented-out call is not one.
    const code = text => text.replace(/\/\*[\s\S]*?\*\//g, c => c.replace(/[^\n]/g, ' '));
    const offenders = APP.flatMap(filesUnder).flatMap(rel =>
      code(fs.readFileSync(path.join(root, rel), 'utf8')).split('\n')
        .map((line, i) => {
          const trimmed = line.trim();
          if (trimmed.startsWith('//')) return null;
          return /\bconsole\.[a-z]+\s*\(/.test(trimmed) ? `${rel}:${i + 1}: ${trimmed}` : null;
        })
        .filter(Boolean));
    expect(offenders).toEqual([]);
  });
});

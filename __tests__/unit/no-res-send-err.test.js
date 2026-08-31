const fs = require('fs');
const path = require('path');

// A repo-level guard against `res.send(err)`.
//
// An Error serialises to `{}` and goes out with Express's default status, so a failed
// request answers **HTTP 200 with an empty body**. The visitor sees a blank page, Sentry
// hears nothing (Express thinks the request succeeded), and a crawler banks it as a
// genuine page with no content.
//
// This is not hypothetical and it is not new. It rendered 48 /event/ pages as a two-byte
// 200 for as long as that route existed, was fixed there, was fixed again in
// playerController and fixtureController — and eleven more instances were still live in
// August 2026, in four controllers, including the fixture read paths.
//
// Fixing them one at a time clearly does not hold. This is cheap, it runs in
// milliseconds, and it is the only thing that stops the twelfth.

const CONTROLLERS = path.join(__dirname, '..', '..', 'controllers');

// Matches the statement anywhere in a line, not just where it is conventionally
// formatted — the first version of this guard anchored to the start of the line and
// sailed straight past a one-line `catch (err) { res.send(err); }`, which is exactly
// the shape somebody in a hurry writes.
const OFFENDER = /\bres\s*\.\s*send\s*\(\s*err/;

function sourceFiles(dir) {
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.js'))
    .map(f => path.join(dir, f));
}

describe('controllers never answer an error with res.send', () => {
  it('has no res.send(err) anywhere under controllers/', () => {
    const offences = [];

    for (const file of sourceFiles(CONTROLLERS)) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        // Skip comment lines — several deliberately quote the old pattern to explain
        // why it was wrong, and those are worth keeping.
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        if (OFFENDER.test(line)) {
          offences.push(`${path.basename(file)}:${i + 1}  ${trimmed}`);
        }
      });
    }

    expect(offences).toEqual([]);
  });
});

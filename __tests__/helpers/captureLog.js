// What the app logged during a test (REARCH-09 part B).
//
// utils/log.js is silent under Jest, so a test that cares about a log line spies on the
// logger rather than on console. `text()` is every call at the chosen levels, one per
// line, fields serialised as JSON. `strings()` is every string value the calls carried —
// message and fields alike, unescaped — which is what a test about log-line injection has
// to look at: JSON would hide a raw newline behind `\n`.
const log = require('../../utils/log');

const LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'];

function leaves(value, out) {
  if (typeof value === 'string') out.push(value);
  else if (value instanceof Error) out.push(value.message);
  else if (value && typeof value === 'object') Object.values(value).forEach(v => leaves(v, out));
  return out;
}

function captureLog(levels = LEVELS) {
  const spies = levels.map(level => jest.spyOn(log, level).mockImplementation(() => {}));
  const calls = () => spies.flatMap(s => s.mock.calls);
  return {
    calls,
    text: () => calls()
      .map(args => args.map(a => (typeof a === 'string' ? a : JSON.stringify(a, (k, v) =>
        v instanceof Error ? { message: v.message } : v))).join(' '))
      .join('\n'),
    strings: () => calls().flatMap(args => leaves(args, [])),
    restore: () => spies.forEach(s => s.mockRestore()),
  };
}

module.exports = { captureLog };

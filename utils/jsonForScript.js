// Embedding a JSON value inside an inline <script> block.
//
// `JSON.stringify` alone is NOT safe there, and the reason is that the browser finds the
// end of a `<script>` element before any JavaScript is parsed. A string containing a
// closing script tag ends the block early — everything after it becomes page content, the
// remaining JS renders as markup, and anything after that runs as script. The same is true
// of `<!--`, which opens an HTML comment inside a script block.
//
// So the characters below are escaped as `\uXXXX`. That is a no-op as far as JavaScript is
// concerned — the two spellings are the same string — but there is no longer a literal `<`
// for the HTML parser to find.
//
// U+2028 and U+2029 are here for a different reason: they are valid inside a JSON string
// but were line terminators in JavaScript before ES2019, so an older engine sees an
// unterminated string literal and a syntax error. Cheap to keep correct.
//
// **This matters because the values are free text an admin types.** A venue address in
// this database already carries an apostrophe — `Mulberry's Sports Complex` — and two
// clubs carry `&` in their match-night text. Nothing stops one carrying angle brackets.
//
// Ported from the Tameside site, where `views/club.ejs` needed it for the same venue map.

const ESCAPES = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

/**
 * JSON, safe to drop straight into a `<script>` block with `<%- %>`.
 *
 * Returns the string `null` for an undefined value rather than the empty string, because
 * `var x = ;` is a syntax error that takes the whole page's script with it.
 */
function jsonForScript(value) {
  const json = JSON.stringify(value);
  if (json === undefined) return 'null';
  return json.replace(/[<>&\u2028\u2029]/g, c => ESCAPES[c]);
}

module.exports = jsonForScript;
module.exports.jsonForScript = jsonForScript;

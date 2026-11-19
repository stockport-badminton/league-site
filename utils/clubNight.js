// A club's `clubNightText` as it should be shown, or '' when there is nothing to show.
//
// The column is free text from /admin/clubs, and clubs with no club night of their own
// (they only play matches) hold a placeholder: "NA" for David Lloyd, Racketeer and
// Remnants, "None" for the No Club sentinel. Shown as-is that reads "Club night: NA" on
// /info/clubs, in the venues map popup and in /llms.txt. Every reader goes through this,
// so the list of placeholders lives in one place (it was an inline regex in two).

const PLACEHOLDER = /^(none|na|n\/a|-)$/i;

function clubNightText(value) {
  const text = String(value == null ? '' : value).trim();
  return PLACEHOLDER.test(text) ? '' : text;
}

module.exports = { clubNightText };

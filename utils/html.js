// HTML escaping for strings that are concatenated into markup rather than rendered
// through a template.
//
// EJS escapes for you (`<%= %>`); hand-built HTML does not, and this codebase builds
// outbound emails by concatenation. Every one of those is a place where a value from a
// request can end an attribute and write its own markup — which is what
// POST /add-scorecard-photo/:id did with `req.body.imgURL`, into a message sent from
// results@stockport-badminton.co.uk to the results secretary.
//
// The same five-replacement function already existed privately inside
// controllers/rosterController.js. It lives here so the next hand-built email does not
// get a sixth copy or, more likely, none.
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { escapeHtml };

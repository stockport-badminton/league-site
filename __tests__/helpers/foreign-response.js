// Deciding whether a response actually came from the application under test.
//
// This is a pure function so it can be tested directly. It is used by the guard in
// __tests__/setupAfterEnv.js, which is not itself importable.
//
// The rule used to be a heuristic over security headers, and the heuristic was wrong —
// see the note on STAMP_HEADER below.

// Every server supertest stands up for us is given an id, and stamps it on each response
// it produces (see setupAfterEnv.js). A response carrying the wrong id, or none, did not
// come from the server this request created.
//
// The previous rule inferred "not ours" from the ABSENCE of helmet's headers, on the
// grounds that every response from app.js carries them. That half is true; the converse
// is not, and the converse is what the rule actually needed. Three of the colliding
// listeners on the machine where this was diagnosed are Express servers, and Express's
// own 404 from finalhandler carries:
//
//     HTTP/1.1 404 Not Found
//     X-Powered-By: Express
//     Content-Security-Policy: default-src 'none'
//     X-Content-Type-Options: nosniff
//
// — which satisfied every clause of the heuristic, so the guard stayed silent and the
// collision was reported as "expected 200, received 404" from our own code. Two separate
// investigations chased that as a real bug. An identity we issue ourselves cannot be
// guessed by a process that does not know it exists.
const STAMP_HEADER = 'x-test-server-id';

/**
 * @param {object|null} headers          the response headers, lower-cased as node gives them
 * @param {string|undefined} expectedId  the id of the server this request stood up, if we
 *                                       stood one up
 * @returns {boolean} true if this response came from something other than that server
 */
function isForeignResponse(headers, expectedId) {
  if (!headers) return false;

  // The normal case: we created the server, so we know exactly what its responses say.
  if (expectedId) return headers[STAMP_HEADER] !== expectedId;

  // request('http://host:port') — supertest was handed a URL rather than an app, so there
  // is no server of ours to compare against and no stamp to expect. Only the guard's own
  // self-test does this. Fall back to the old heuristic, which is all that is available.
  return !headers['content-security-policy'] &&
    !headers['content-security-policy-report-only'] &&
    !headers['x-content-type-options'];
}

module.exports = { isForeignResponse, STAMP_HEADER };

// Self-test for the guard in __tests__/setupAfterEnv.js.
//
// HARD-20: supertest binds an ephemeral port per request, and other processes on a
// developer machine listen in the same range — VS Code helpers and Postman, on the machine
// where this was diagnosed. When a bind collides they answer instead, with a 400, 401 or
// 404 that reads exactly like an authorization bug in our own code. It cost days.
//
// The guard cannot prevent the collision. It exists so the failure says what happened.
// This proves it fires, and — as important — that it does not fire on our own responses.

const http = require('http');
const request = require('supertest');
const { isForeignResponse, STAMP_HEADER } = require('../helpers/foreign-response');

function foreignServer(status, body, headers) {
  const server = http.createServer((req, res) => {
    res.writeHead(status, Object.assign({ 'Content-Type': 'text/plain' }, headers || {}));
    res.end(body);
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

describe('the foreign-response guard', () => {
  // The three statuses actually observed from colliding local listeners.
  it.each([
    [400, 'WebSockets request was expected'],
    [401, 'Unauthorized'],
    [404, 'Not Found'],
  ])('reports a %s from a process that is not our app', async (status, body) => {
    const { server, port } = await foreignServer(status, body);
    try {
      // A test would normally assert a real status here; the guard must pre-empt that and
      // explain, rather than let it fail as a status mismatch.
      await expect(
        request(`http://127.0.0.1:${port}`).get('/sitemap.xml').expect(200)
      ).rejects.toThrow(/did not come from the application/);
    } finally {
      server.close();
    }
  });

  it('names the port so the listener can be identified', async () => {
    const { server, port } = await foreignServer(401, 'nope');
    try {
      await expect(
        request(`http://127.0.0.1:${port}`).get('/anything').expect(200)
      ).rejects.toThrow(new RegExp(`lsof -iTCP:${port}`));
    } finally {
      server.close();
    }
  });

  it('falls back to the header heuristic when there is no server of ours to compare against', async () => {
    // request('http://host:port') hands supertest a URL rather than an app, so it stands
    // up no server and there is no stamp to expect. Only this self-test does that. The
    // old header heuristic is all that is available in that case — and it is a heuristic:
    // see the rule tests below for what it cannot see.
    const { server, port } = await foreignServer(401, 'nope', {
      'Content-Security-Policy': "default-src 'self'",
    });
    try {
      // Ours, so the guard stays out of the way and the real status mismatch is reported.
      await expect(
        request(`http://127.0.0.1:${port}`).get('/anything').expect(200)
      ).rejects.toThrow(/401/);
    } finally {
      server.close();
    }
  });

  // Deliberately NOT tested here: that a real 404 from our own app carries the CSP header
  // and so is distinguishable from a foreign one. The obvious way to write it is
  // `jest.resetModules()` + `require('../../app')`, which builds a second application and
  // a second pg pool — the exact pattern HARD-14 records as having produced a one-in-nine
  // timeout that was twice written off as contention. It was written that way here, and
  // duly timed out in the full run while passing alone. `security-headers.test.js` already
  // asserts the header is on every response, including 404s, without booting a second app.
});

// The rule itself, tested directly. It is a pure function precisely because the version it
// replaced was wrong in a way that no amount of re-running the suite would have shown.
describe('isForeignResponse', () => {
  const OURS = 'a-server-we-stood-up';

  // This is the shape that defeated the previous rule, and it is not hypothetical: three
  // of the seven colliding listeners on the machine where this was diagnosed are Express
  // servers, and this is verbatim what Express's own finalhandler 404 sends.
  const expressDefault404 = {
    'x-powered-by': 'Express',
    'content-security-policy': "default-src 'none'",
    'x-content-type-options': 'nosniff',
    'content-type': 'text/html; charset=utf-8',
  };

  it('reports a foreign response that carries the headers the old rule trusted', () => {
    // The old rule asked only whether CSP and X-Content-Type-Options were ABSENT. All
    // three of its clauses are satisfied here, so it stayed silent and the collision was
    // reported as "expected 200, received 404" from our own code. Two separate
    // investigations then went looking for a bug that was not there.
    expect(isForeignResponse(expressDefault404, OURS)).toBe(true);
  });

  it('accepts a response carrying the id of the server that was stood up', () => {
    expect(isForeignResponse({ [STAMP_HEADER]: OURS }, OURS)).toBe(false);
  });

  it('reports a response carrying a different server id', () => {
    // Cross-talk rather than a foreign process: still not the server this request created.
    expect(isForeignResponse({ [STAMP_HEADER]: 'some-other-server' }, OURS)).toBe(true);
  });

  it('reports a response with no id at all when one was expected', () => {
    expect(isForeignResponse({ 'content-type': 'text/html' }, OURS)).toBe(true);
  });

  it('says nothing when there is no response to judge', () => {
    expect(isForeignResponse(null, OURS)).toBe(false);
  });
});

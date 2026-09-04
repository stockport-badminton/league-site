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

  it('does not fire on a response that does carry our security headers', async () => {
    // The distinguishing signal is the CSP header helmet puts on every response, not the
    // body — only one of the six colliding ports produced that string.
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

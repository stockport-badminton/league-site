// The fix for HARD-14: supertest must bind the loopback address, not the wildcard.
//
// A quarter of full runs used to fail, across ten unrelated suites, because
// `request(app)` binds an ephemeral port per request and other processes on a developer
// machine listen in the same range. That was not bad luck, and it was not unavoidable.
//
// supertest calls `app.listen(0)` with no host, which binds the IPv6 WILDCARD `::`, while
// addressing its requests to 127.0.0.1. Two things then go wrong together:
//
//   1. the kernel's port-0 allocator for `::` will hand out a port that is already held
//      on 127.0.0.1 specifically — the two are different addresses, so it is not a
//      conflict as far as the bind is concerned; and
//   2. an incoming connection to 127.0.0.1 is delivered to the MORE SPECIFIC of the two
//      bindings — theirs.
//
// So the request goes to the other process, which answers with a plausible 400, 401 or
// 404. Asking for 127.0.0.1 instead removes the first step, and with it the whole class:
// that allocator will not hand out a port already taken on that address.
//
// Deliberately NOT requiring app.js — a second application means a second pg pool, which
// is the pattern the guard self-test records as having caused timeouts of its own.

const http = require('http');
const net = require('net');
const request = require('supertest');

const ok = (req, res) => { res.end('ok'); };

// The port the kernel is about to hand out. Ephemeral allocation walks forward, so a
// decoy planted just ahead of this sits exactly where the next few binds will look —
// which is what makes the contested case reproducible instead of a one-in-thousands
// coincidence. (A sweep of ports BEHIND the cursor never revisits them, and reports a
// clean run whether or not the bug is present.)
function nextPort(address, family) {
  const handle = net._createServerHandle(address, 0, family);
  if (typeof handle === 'number') throw new Error('could not bind: errno ' + handle);
  const out = {};
  handle.getsockname(out);
  handle.close();
  return out.port;
}

// A listener bound to 127.0.0.1 only, exactly as the VS Code helpers are.
async function plantDecoyAheadOfCursor(address, family) {
  for (let attempt = 0; attempt < 25; attempt++) {
    const target = nextPort(address, family) + 4;
    const decoy = http.createServer((req, res) => { res.end('DECOY'); });
    try {
      await new Promise((resolve, reject) => {
        decoy.once('error', reject);
        decoy.listen(target, '127.0.0.1', resolve);
      });
      return { decoy, target };
    } catch (err) {
      decoy.close();
    }
  }
  return null;
}

describe('supertest server binding', () => {
  it('binds 127.0.0.1, not the wildcard', async () => {
    const test = request(ok).get('/');
    // Read the address before the request completes — supertest closes the server after.
    const address = test._server.address();
    await test.expect(200);

    // Without the fix this is '::', the IPv6 wildcard, which is what allows a
    // 127.0.0.1-specific listener elsewhere on the machine to answer instead.
    expect(address.address).toBe('127.0.0.1');
    expect(address.family).toBe('IPv4');
  });

  it('never takes a port another process already holds on 127.0.0.1', async () => {
    const planted = await plantDecoyAheadOfCursor('127.0.0.1', 4);
    if (!planted) return; // could not set the experiment up; not a failure of the code

    try {
      const ports = [];
      const pending = [];
      for (let i = 0; i < 60; i++) {
        const test = request(ok).get('/');
        ports.push(test._server.address().port);
        pending.push(test.expect(200).expect('ok'));
      }
      await Promise.all(pending);

      // Before the fix these binds walk straight onto the decoy and it answers 'DECOY'.
      expect(ports).not.toContain(planted.target);
    } finally {
      await new Promise(resolve => planted.decoy.close(resolve));
    }
  });

  // The OS behaviour the fix rests on, asserted directly so that a change in kernel or
  // Node behaviour surfaces here rather than as a mysterious flake months later.
  //
  // Only the loopback half is asserted. The wildcard half — that `::` DOES hand out a
  // held port — is the bug, and was verified by hand on macOS 23.6 / Node 22.22.3, but
  // it is a property of a particular kernel's allocator and is not something we want a
  // red suite over on a machine that happens not to share it.
  it('the loopback allocator skips a port already held on loopback', async () => {
    const planted = await plantDecoyAheadOfCursor('127.0.0.1', 4);
    if (!planted) return;

    const handles = [];
    try {
      let handedOut = false;
      for (let i = 0; i < 60; i++) {
        const handle = net._createServerHandle('127.0.0.1', 0, 4);
        if (typeof handle === 'number') break;
        const out = {};
        handle.getsockname(out);
        handles.push(handle);
        if (out.port === planted.target) { handedOut = true; break; }
      }
      expect(handedOut).toBe(false);
    } finally {
      handles.forEach(handle => handle.close());
      await new Promise(resolve => planted.decoy.close(resolve));
    }
  });

  it('stamps every response with the id of the server that produced it', async () => {
    const res = await request(ok).get('/').expect(200);
    expect(res.headers['x-test-server-id']).toMatch(/^\d+:\d+$/);
  });
});

// The visitor's IP address, resolved once so every consumer agrees.
//
// Behind Firebase Hosting → Cloud Run there are two proxies in front of this app, so
// `req.connection.remoteAddress` is a Google frontend and useless for identifying a
// visitor. That is why the hardcoded IP blacklist in app.js never blocked anything:
// it compared a Google internal address against a list of spammers.
//
// Cloud Run documents X-Forwarded-For as `client, proxy...`, so the leftmost entry is
// the visitor. `req.ip` with `trust proxy` enabled gives the same answer, and is used
// when available so the rate limiters (which read req.ip themselves) and the blocklist
// cannot disagree.
//
// The trade-off worth being explicit about: the leftmost XFF entry is ultimately
// client-settable, because a caller can send their own X-Forwarded-For and Google
// appends to it. So this is good enough to rate-limit and to block casual abuse, and
// not good enough to be the only defence — which is why the captcha, honeypot and
// timing checks exist alongside it. It also means a determined caller can make the
// submission log show an address that isn't theirs; check the log's user agent and
// pattern before blocking an address by hand.
function clientIp(req) {
  if (!req) return '';
  let ip = req.ip;

  if (!ip) {
    const xff = req.headers && req.headers['x-forwarded-for'];
    if (xff) ip = String(xff).split(',')[0].trim();
  }
  if (!ip) ip = (req.socket && req.socket.remoteAddress) || '';

  ip = String(ip).trim();
  // Express reports IPv4 over IPv6 as ::ffff:1.2.3.4; store the readable form.
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

// The raw header, kept alongside the resolved address in the submission log so a
// suspicious entry can be examined rather than guessed at.
function forwardedChain(req) {
  const xff = req && req.headers && req.headers['x-forwarded-for'];
  return xff ? String(xff) : '';
}

module.exports = { clientIp, forwardedChain };

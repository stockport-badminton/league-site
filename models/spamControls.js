var db = require('../db_connect.js');

// Blocklists and the submission log — see migrations/010_spam_controls.sql.
//
// The point of this table is that blocking a spammer stops being a code change. It used
// to mean editing controllers/contactusController.js (89 email addresses and ~180
// phrases) or app.js (three IPs) and running a deploy.
//
// The lists are cached in memory because the IP list is consulted on *every* request,
// and a DB round trip per request to check a list of a hundred strings would be absurd.
// The cache is refreshed lazily on a TTL, so an admin change takes effect within a
// minute without needing a restart or a cross-instance invalidation mechanism.
const CACHE_TTL_MS = 60 * 1000;

const cache = {
  loadedAt: 0,
  ip: new Set(),
  email: new Set(),
  phrase: [],
  word: [],
};

async function load() {
  const [rows] = await (await db.otherConnect()).query(
    'SELECT kind, value FROM blocked_entry WHERE active ORDER BY id'
  );
  const next = { ip: new Set(), email: new Set(), phrase: [], word: [] };
  for (const row of rows) {
    const value = String(row.value || '').trim();
    if (!value) continue;
    if (row.kind === 'ip') next.ip.add(value);
    else if (row.kind === 'email') next.email.add(value.toLowerCase());
    else if (row.kind === 'phrase') next.phrase.push(value.toLowerCase());
    else if (row.kind === 'word') next.word.push(value.toLowerCase());
  }
  cache.ip = next.ip;
  cache.email = next.email;
  cache.phrase = next.phrase;
  cache.word = next.word;
  cache.loadedAt = Date.now();
  return cache;
}

// Never throws. A database hiccup must not take the site down or, worse, fail closed and
// reject every submission — it degrades to "the lists are whatever we last loaded",
// which for a fresh instance means empty. The captcha, honeypot and rate limits are all
// still in force in that state.
async function ensureLoaded() {
  if (Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache;
  try {
    return await load();
  } catch (err) {
    console.error('spamControls: could not load blocklists:', err.message);
    // Push the clock forward so a broken DB isn't retried on every single request.
    cache.loadedAt = Date.now();
    return cache;
  }
}

exports.refresh = load;

exports.isBlockedIp = async function(ip) {
  if (!ip) return false;
  const lists = await ensureLoaded();
  return lists.ip.has(ip);
};

// Synchronous variant for the request-path middleware, which cannot afford to await on
// every request. Reads whatever the cache holds; the async refresh is triggered
// separately at startup and on a timer.
exports.isBlockedIpSync = function(ip) {
  return !!ip && cache.ip.has(ip);
};

exports.isBlockedEmail = async function(email) {
  if (!email) return false;
  const lists = await ensureLoaded();
  return lists.email.has(String(email).trim().toLowerCase());
};

// Returns the matching term (useful for the log) or null.
exports.matchBlockedText = async function(text) {
  if (!text) return null;
  const lists = await ensureLoaded();
  const haystack = String(text).toLowerCase();

  for (const phrase of lists.phrase) {
    if (haystack.includes(phrase)) return { kind: 'phrase', value: phrase };
  }
  for (const word of lists.word) {
    // Whole-word only, so "ass" doesn't match "class" — the old list conflated the two
    // categories and this is why they're separate kinds here.
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(haystack)) return { kind: 'word', value: word };
  }
  return null;
};

// --- admin ---

exports.list = async function() {
  const [rows] = await (await db.otherConnect()).query(
    `SELECT id, kind, value, note, created_at, created_by, active
     FROM blocked_entry ORDER BY kind ASC, created_at DESC`
  );
  return rows;
};

exports.add = async function({ kind, value, note, createdBy }) {
  const [rows] = await (await db.otherConnect()).query(
    `INSERT INTO blocked_entry (kind, value, note, created_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (kind, LOWER(value)) DO UPDATE
       SET active = TRUE, note = COALESCE(EXCLUDED.note, blocked_entry.note)
     RETURNING id`,
    [kind, String(value).trim(), note || null, createdBy || null]
  );
  await load();
  return rows[0] && rows[0].id;
};

exports.setActive = async function(id, active) {
  const [result] = await (await db.otherConnect()).query(
    'UPDATE blocked_entry SET active = ? WHERE id = ?', [!!active, id]
  );
  await load();
  return result;
};

// --- submission log ---

// Fire-and-forget from the request path: a logging failure must never turn a legitimate
// submission into an error, so this swallows its own errors and returns nothing useful.
exports.logSubmission = async function(entry) {
  try {
    await (await db.otherConnect()).query(
      `INSERT INTO submission_log
         (endpoint, ip, forwarded_for, user_agent, verdict, reason, email, excerpt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(entry.endpoint || '').slice(0, 200),
        entry.ip || null,
        (entry.forwardedFor || '').slice(0, 300) || null,
        (entry.userAgent || '').slice(0, 300) || null,
        entry.verdict,
        entry.reason || null,
        (entry.email || '').slice(0, 200) || null,
        // 200 characters: enough to recognise a campaign, not a message archive.
        (entry.excerpt || '').slice(0, 200) || null,
      ]
    );
  } catch (err) {
    console.error('spamControls: could not log submission:', err.message);
  }
};

exports.recentSubmissions = async function(limit = 100) {
  const [rows] = await (await db.otherConnect()).query(
    `SELECT id, created_at, endpoint, ip, forwarded_for, user_agent, verdict, reason,
            email, excerpt
     FROM submission_log ORDER BY created_at DESC LIMIT ?`,
    [Math.min(Number(limit) || 100, 500)]
  );
  return rows;
};

// Counts for the admin screen — the answer to "is this 3 a week or 300?", which nothing
// could answer before.
exports.submissionStats = async function() {
  const [rows] = await (await db.otherConnect()).query(
    `SELECT verdict, reason, count(*)::int AS n,
            count(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS last7,
            count(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS last24h
     FROM submission_log
     GROUP BY verdict, reason
     ORDER BY n DESC`
  );
  return rows;
};

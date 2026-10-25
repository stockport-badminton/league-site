// @ts-check
const { sql } = require('kysely');
const { kysely } = require('../db');

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

/** @type {{ loadedAt: number, ip: Set<string>, email: Set<string>, phrase: string[], word: string[] }} */
const cache = {
  loadedAt: 0,
  ip: new Set(),
  email: new Set(),
  phrase: [],
  word: [],
};

async function load() {
  const rows = await kysely.selectFrom('blocked_entry').select(['kind', 'value'])
    .where('active', '=', true).orderBy('id').execute();
  /** @type {{ ip: Set<string>, email: Set<string>, phrase: string[], word: string[] }} */
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
    console.error('spamControls: could not load blocklists:', /** @type {Error} */ (err).message);
    // Push the clock forward so a broken DB isn't retried on every single request.
    cache.loadedAt = Date.now();
    return cache;
  }
}

exports.refresh = load;

/** @param {string | null | undefined} ip */
exports.isBlockedIp = async function(ip) {
  if (!ip) return false;
  const lists = await ensureLoaded();
  return lists.ip.has(ip);
};

// Synchronous variant for the request-path middleware, which cannot afford to await on
// every request. Reads whatever the cache holds; the async refresh is triggered
// separately at startup and on a timer.
/** @param {string | null | undefined} ip */
exports.isBlockedIpSync = function(ip) {
  return !!ip && cache.ip.has(ip);
};

/** @param {unknown} email */
exports.isBlockedEmail = async function(email) {
  if (!email) return false;
  const lists = await ensureLoaded();
  return lists.email.has(String(email).trim().toLowerCase());
};

// Returns the matching term (useful for the log) or null.
/** @param {unknown} text */
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
  return kysely.selectFrom('blocked_entry')
    .select(['id', 'kind', 'value', 'note', 'created_at', 'created_by', 'active'])
    .orderBy('kind', 'asc').orderBy('created_at', 'desc').execute();
};

// The conflict target is the unique INDEX on (kind, LOWER(value)) — an index, not a
// constraint, so ON CONSTRAINT cannot name it and the expression has to be written out.
// The cast says what it is: a conflict target, not a value.
const KIND_AND_VALUE =
  /** @type {import('kysely').RawBuilder<unknown>} */ (sql`kind, LOWER(value)`);

/** @param {{ kind: string, value: unknown, note?: string, createdBy?: string }} entry */
exports.add = async function({ kind, value, note, createdBy }) {
  const row = await kysely.insertInto('blocked_entry')
    .values({ kind, value: String(value).trim(), note: note || null, created_by: createdBy || null })
    .onConflict(oc => oc.expression(KIND_AND_VALUE).doUpdateSet(eb => ({
      active: true,
      note: eb.fn.coalesce('excluded.note', 'blocked_entry.note'),
    })))
    .returning('id')
    .executeTakeFirst();
  await load();
  return row && row.id;
};

// Returns nothing; spamAdminController, its one caller, never read the old rows array.
/** @param {number} id @param {unknown} active */
exports.setActive = async function(id, active) {
  await kysely.updateTable('blocked_entry').set({ active: !!active }).where('id', '=', id).execute();
  await load();
};

// --- submission log ---

// Fire-and-forget from the request path: a logging failure must never turn a legitimate
// submission into an error, so this swallows its own errors and returns nothing useful.
/**
 * @param {{ endpoint?: string, ip?: string | null, forwardedFor?: string, userAgent?: string,
 *   verdict: string, reason?: string | null, email?: string, excerpt?: string }} entry
 */
exports.logSubmission = async function(entry) {
  try {
    await kysely.insertInto('submission_log').values({
      endpoint: String(entry.endpoint || '').slice(0, 200),
      ip: entry.ip || null,
      forwarded_for: (entry.forwardedFor || '').slice(0, 300) || null,
      user_agent: (entry.userAgent || '').slice(0, 300) || null,
      verdict: entry.verdict,
      reason: entry.reason || null,
      email: (entry.email || '').slice(0, 200) || null,
      // 200 characters: enough to recognise a campaign, not a message archive.
      excerpt: (entry.excerpt || '').slice(0, 200) || null,
    }).execute();
  } catch (err) {
    console.error('spamControls: could not log submission:', /** @type {Error} */ (err).message);
  }
};

exports.recentSubmissions = async function(limit = 100) {
  return kysely.selectFrom('submission_log')
    .select(['id', 'created_at', 'endpoint', 'ip', 'forwarded_for', 'user_agent', 'verdict', 'reason',
      'email', 'excerpt'])
    .orderBy('created_at', 'desc').limit(Math.min(Number(limit) || 100, 500)).execute();
};

const WEEK_AGO = /** @type {import('kysely').RawBuilder<Date>} */ (sql`NOW() - INTERVAL '7 days'`);
const DAY_AGO = /** @type {import('kysely').RawBuilder<Date>} */ (sql`NOW() - INTERVAL '24 hours'`);

// Counts for the admin screen — the answer to "is this 3 a week or 300?", which nothing
// could answer before.
exports.submissionStats = async function() {
  return kysely.selectFrom('submission_log')
    .select(eb => [
      'verdict', 'reason',
      eb.cast(eb.fn.countAll(), 'integer').as('n'),
      eb.cast(eb.fn.countAll().filterWhere('created_at', '>', WEEK_AGO), 'integer').as('last7'),
      eb.cast(eb.fn.countAll().filterWhere('created_at', '>', DAY_AGO), 'integer').as('last24h'),
    ])
    .groupBy(['verdict', 'reason'])
    .orderBy('n', 'desc')
    .execute();
};

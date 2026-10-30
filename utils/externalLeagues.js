// @ts-check
// Games from the Tameside and Manchester leagues, for the team-strength ratings.
//
// Tameside's app is a fork of ours with its own Supabase project: its `game` table has the
// same shape, read here through a read-only transaction on TAMESIDE_DATABASE_URL.
// Manchester's (mcrbl.org.uk) scorecards are web pages: one season search returns every
// card of the season in full, so a season is one request.
//
// Both record players by name only. Linking a name to one of our players is the nightly
// run's job (controllers/teamStrengthController.js), not the import's.

const config = require('../config')
const log = require('./log')

const MCRBL_URL = 'https://mcrbl.org.uk/scorecards.php'
const USER_AGENT = 'stockport-badminton.co.uk team-strength import (results@stockport-badminton.co.uk)'

const unescape = (/** @type {string} */ s) => s
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
const text = (/** @type {string} */ s) => unescape(s.replace(/<[^>]+>/g, '')).trim()

/** @param {string} tr @returns {[string, string][]} [class, text] per cell */
function cells(tr) {
  return [...tr.matchAll(/(<td[^>]*>)([\s\S]*?)<\/td>/g)].map(m => {
    const cls = m[1].match(/class="(\w+)"/)
    return [cls ? cls[1] : '', text(m[2])]
  })
}

// A card writes a pair as initials: first and last ("SM"), or every word ("GHP", "TlH"),
// and for "Kerrie Worthington (Lawler)" either KW or KWL.
/** @param {string} name */
function initials(name) {
  const out = new Set()
  for (const t of [name.replace(/\(.*?\)/g, ''), name.replace(/[()]/g, '')]) {
    const parts = t.replace(/-/g, ' ').split(/\s+/).filter(Boolean)
    if (!parts.length) continue
    out.add((parts[0][0] + parts[parts.length - 1][0]).toUpperCase())
    out.add(parts.map(w => w[0]).join('').toUpperCase())
  }
  return out
}

const ddmmyyyy = (/** @type {string} */ s) => { const [d, m, y] = s.split('/'); return `${y}-${m}-${d}` }

/**
 * One card's games. Two formats: the men/ladies card (six named slots a side, men A-C then
 * ladies A-C, and each pairing's players as initials) and the Open card (three fixed pairs a
 * side, men's doubles, no gender written). A pairing whose initials do not pick out exactly
 * one listed player of the right gender is dropped rather than guessed: two "JC"s on one
 * side happen.
 * @param {string} chunk the HTML from one "Date Entered" to the next
 */
function parseCard(chunk) {
  const rows = [...('<tr>' + chunk).matchAll(/<tr[\s\S]*?<\/tr>/g)].map(m => cells(m[0]))
  /** @type {{ division: string | null, date: string | null, home: string | null, away: string | null, games: any[], dropped: number }} */
  const card = { division: null, date: null, home: null, away: null, games: [], dropped: 0 }
  /** @type {Record<'h' | 'a', { slot: string, gender: string | null, name: string }[]>} */
  const roster = { h: [], a: [] }
  let open = false, pair = 0
  for (const r of rows) {
    const txt = r.map(c => c[1])
    if (r.length && (txt[0] === 'Division' || txt[0] === 'Group')) {
      card.division = txt[1] || null
      const dates = txt.filter(t => /^\d{2}\/\d{2}\/\d{4}$/.test(t))
      card.date = dates.length ? ddmmyyyy(dates[dates.length - 1]) : null
    } else if (r.length === 4 && r[0][0] === 'style1' && txt.includes('HOME') && txt.includes('AWAY')) {
      card.home = txt[1]; card.away = txt[3]
    } else if (txt.some(t => /^PAIR \d$/.test(t)) || (open && r.length === 2 && r.every(c => c[0] === 'style2'))) {
      open = true
      const p = txt.find(t => /^PAIR \d$/.test(t))
      if (p) pair = Number(p.split(' ')[1])
      const names = r.filter(c => c[0] === 'style2').map(c => c[1])
      if (names.length === 2) {
        roster.h.push({ slot: `P${pair}`, gender: null, name: names[0] })
        roster.a.push({ slot: `P${pair}`, gender: null, name: names[1] })
      }
    } else if (r.filter(c => c[0] === 'style1' && /^[ABC]$/.test(c[1])).length === 2) {
      // The MEN / LADIES label sits on the B row, after the A row: gender is by position.
      const slots = r.filter(c => c[0] === 'style1' && /^[ABC]$/.test(c[1])).map(c => c[1])
      const names = r.filter(c => c[0] === 'style2').map(c => c[1])
      if (names.length === 2) {
        const gender = roster.h.length < 3 ? 'Male' : 'Female'
        roster.h.push({ slot: slots[0], gender, name: names[0] })
        roster.a.push({ slot: slots[1], gender, name: names[1] })
      }
    } else if (r.length >= 8 && r[0][0] === 'style4' && r[1][0] === 'style5') {
      const label = r[0][1], code = r[1][1]
      const pts = r.slice(2, 6).map(c => (/^\d+$/.test(c[1]) ? Number(c[1]) : null))
      const mixed = label.startsWith('MIXED')
      const want = label.startsWith('MENS') ? ['Male', 'Male'] : label.startsWith('LADIES') ? ['Female', 'Female']
        : mixed ? ['Male', 'Female'] : [null, null]
      /** @type {{ name: string, gender: string | null }[][] | null} */
      let sides = null
      if (open) {
        const m = label.match(/^H(\d) v A(\d)$/)
        const hp = m ? roster.h.filter(p => p.slot === `P${m[1]}`) : [], ap = m ? roster.a.filter(p => p.slot === `P${m[2]}`) : []
        if (hp.length === 2 && ap.length === 2) sides = [hp, ap]
      } else {
        const ini = code.split('/').map(s => s.trim().toUpperCase())
        if (ini.length === 4) {
          const pick = (/** @type {'h' | 'a'} */ side, /** @type {string[]} */ codes) => codes.map((cd, k) => {
            const c = roster[side].filter(p => p.gender === want[k] && initials(p.name).has(cd))
            return c.length === 1 ? c[0] : null
          })
          const h = pick('h', ini.slice(0, 2)), a = pick('a', ini.slice(2))
          if (h.every(Boolean) && a.every(Boolean)) sides = [/** @type {any} */ (h), /** @type {any} */ (a)]
        }
      }
      if (!sides || pts.some(v => v == null)) { card.dropped++; continue }
      for (const g of [0, 1]) {
        card.games.push({ label, game: g + 1, mixed, home: sides[0], away: sides[1],
          hs: /** @type {number} */ (pts[2 * g]), as: /** @type {number} */ (pts[2 * g + 1]) })
      }
    }
  }
  return card
}

const clean = (/** @type {string} */ s) => s.replace(/\s+/g, ' ').trim()

/**
 * A Manchester season's results page, as external_game rows.
 * @param {string} html
 * @returns {{ rows: import('../models/externalGame').ExternalGame[], cards: number, dropped: number }}
 */
function parseMcrblSeason(html) {
  const cards = html.split('Date Entered').slice(1).map(parseCard)
  const rows = []
  for (const c of cards) {
    if (!c.date || !c.home || !c.away) continue
    for (const g of c.games) {
      rows.push({
        league: /** @type {const} */ ('mcrbl'),
        source_key: [c.date, c.home, c.away, g.label, g.game].join('|'),
        played_on: c.date, game_type: g.label, mixed: g.mixed,
        home1: clean(g.home[0].name), home2: clean(g.home[1].name), away1: clean(g.away[0].name), away2: clean(g.away[1].name),
        home1_gender: g.home[0].gender, home2_gender: g.home[1].gender, away1_gender: g.away[0].gender, away2_gender: g.away[1].gender,
        home_score: g.hs, away_score: g.as,
      })
    }
  }
  return { rows, cards: cards.length, dropped: cards.reduce((a, c) => a + c.dropped, 0) }
}

// Manchester's name for the season a date falls in: '2026-27' from September 2026 to August 2027.
/** @param {Date} [d] */
function mcrblSeason(d = new Date()) {
  const y = d.getUTCMonth() >= 7 ? d.getUTCFullYear() : d.getUTCFullYear() - 1
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`
}

/** One season's results page, fetched. @param {string} season e.g. '2026-27' */
async function fetchMcrblSeason(season) {
  if (!/^\d{4}-\d{2}$/.test(season)) throw new Error(`not a Manchester season: ${season}`)
  const res = await fetch(MCRBL_URL, {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ season, form_submitted: 'Search' }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`mcrbl.org.uk answered ${res.status} for ${season}`)
  return res.text()
}

/**
 * Tameside's games since a date, as external_game rows. Null when TAMESIDE_DATABASE_URL is
 * not set: the import then skips Tameside rather than failing.
 * @param {string} [since] YYYY-MM-DD
 */
async function tamesideGames(since = '2000-01-01') {
  if (!config.TAMESIDE_DATABASE_URL) return null
  const { Pool } = require('pg')
  const pool = new Pool({ connectionString: config.TAMESIDE_DATABASE_URL, max: 1 })
  pool.on('error', err => log.error({ err }, '[team-strength] Tameside pool error')) // gotcha 2c
  const c = await pool.connect()
  try {
    await c.query('BEGIN TRANSACTION READ ONLY')
    const name = (/** @type {string} */ a) => `TRIM(regexp_replace(${a}.first_name || ' ' || ${a}.family_name, '\\s+', ' ', 'g'))`
    // Player 0 is Tameside's "No Player", which a walkover is entered against.
    const { rows } = await c.query(
      `SELECT g.id, g."gameType"::text AS type, to_char(f.date, 'YYYY-MM-DD') AS day, g."homeScore" AS hs, g."awayScore" AS "as",
              ${name('p1')} AS h1, p1.gender AS g1, ${name('p2')} AS h2, p2.gender AS g2,
              ${name('p3')} AS a1, p3.gender AS g3, ${name('p4')} AS a2, p4.gender AS g4
         FROM game g JOIN fixture f ON f.id = g.fixture
         JOIN player p1 ON p1.id = g."homePlayer1" JOIN player p2 ON p2.id = g."homePlayer2"
         JOIN player p3 ON p3.id = g."awayPlayer1" JOIN player p4 ON p4.id = g."awayPlayer2"
        WHERE g."homePlayer1" <> 0 AND g."homePlayer2" <> 0 AND g."awayPlayer1" <> 0 AND g."awayPlayer2" <> 0
          AND g."homeScore" IS NOT NULL AND g."awayScore" IS NOT NULL AND f.date >= $1::date
        ORDER BY f.date, g.id`, [since])
    await c.query('ROLLBACK')
    const g = (/** @type {string | null} */ v) => (v === 'Male' || v === 'Female' ? v : null)
    return rows.map(r => ({
      league: /** @type {const} */ ('tameside'), source_key: String(r.id), played_on: r.day,
      game_type: r.type, mixed: /Mixed/.test(r.type),
      home1: r.h1, home2: r.h2, away1: r.a1, away2: r.a2,
      home1_gender: g(r.g1), home2_gender: g(r.g2), away1_gender: g(r.g3), away2_gender: g(r.g4),
      home_score: Number(r.hs), away_score: Number(r.as),
    }))
  } finally {
    c.release()
    await pool.end()
  }
}

// How a name is compared: brackets dropped, spaces collapsed, case ignored.
const normName = (/** @type {string} */ s) => String(s || '').replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Links other leagues' names to our players. A name is ours only when exactly one of our
 * players (in any season) has it and the genders agree, or the other league does not say.
 * Anyone else is that league's own player, `${league}:${name}`. Two of ours with one name,
 * or a name that matches someone of the other gender, stays unlinked: a wrong link moves
 * two people's ratings, a missed one only loses some evidence.
 * @param {{ id: number, name: string, gender: string | null }[]} ours
 */
function linker(ours) {
  /** @type {Map<string, Set<number>>} */ const byName = new Map()
  /** @type {Map<number, string | null>} */ const genderOf = new Map()
  for (const p of ours) {
    const k = normName(p.name)
    if (!k) continue
    const ids = byName.get(k) || new Set()
    ids.add(p.id)
    byName.set(k, ids)
    if (p.gender) genderOf.set(p.id, p.gender)
  }
  /** @param {string} league @param {string} name @param {string | null} gender @returns {number | string} */
  return (league, name, gender) => {
    const k = normName(name), ids = byName.get(k)
    if (ids && ids.size === 1) {
      const id = /** @type {number} */ ([...ids][0])
      if (!gender || !genderOf.get(id) || genderOf.get(id) === gender) return id
    }
    return `${league}:${k}`
  }
}

module.exports = { parseMcrblSeason, parseCard, initials, normName, linker, mcrblSeason, fetchMcrblSeason, tamesideGames, MCRBL_URL }

// @ts-check
// Team strength: a points-based doubles rating, and what the nightly run builds on it
// (/admin/team-strength). Pure functions; models/teamStrength.js loads and stores.
//
// ## The model
//
// Every rally of a game is won by the home pair with probability
//
//   p = sigmoid(s_h1 + s_h2 - s_a1 - s_a2 + home [+ the four players' mixed offsets])
//
// so a 21-15 game is 36 observations, not one win. The strengths are fitted over the whole
// history at once by penalised maximum likelihood, each game weighted by its age. Fitting
// everything together is what compares divisions: a reserve playing up, a promoted team, a
// player moving club all link one division to another, and the fit carries those links
// through everyone they played. The ELO's fixed DIVISION_RANK_POINTS is what this replaces.
//
// Settings were chosen by a walk-forward backtest (refit each month, predict the next) on
// 2024/25 and checked on 2025/26 + 2026/27 to October: 75.3% of game winners called
// against the ELO's 71.2%. A per-pair "chemistry" term made it worse and is left out.
// Men's and ladies' strengths are on separate scales: mixed games pin each down only
// relative to its own gender, so a man is only ever compared with a man.

const DAY = 86400000

const SETTINGS = Object.freeze({
  halfLifeDays: 365, // a game a year old counts half
  tau: 0.3,          // how far a player may sit from their division's average
  mixedSd: 0.15,     // how different a player may be at mixed
  iters: 200,
  // A fixture's own swing, on top of the players' strengths: who turned up, the hall, the
  // night. Without it the 18 games are independent and a fixture's score varies a third as
  // much as real ones do. Sized on 2024/25 (0.15) and 2025/26 (0.25), predicting every
  // fixture from the nominated lineups of the September before.
  fixtureSd: 0.2,
  // A team's form over the rest of a season, held for all its fixtures in one simulated
  // season: squads change and players improve. Sized on the same two seasons' final tables.
  formSd: 0.1,
})

// The display scale: 1500 plus 1000 per unit of strength. 100 points between two players in
// the same pair is 52.5% of rallies, or about 63% of games.
const display = (/** @type {number} */ s) => Math.round(1500 + 1000 * s)

const sig = (/** @type {number} */ x) => 1 / (1 + Math.exp(-x))

const HOME_VAR = 0.1 * 0.1

// P(winning a rally-point game to 21, two clear, capped at 30) from P(winning a rally).
const gameWin = (() => {
  const N = 2001, table = new Float64Array(N)
  const done = (/** @type {number} */ x, /** @type {number} */ y) => (x >= 21 && x - y >= 2) || x === 30
  for (let i = 0; i < N; i++) {
    const p = i / (N - 1)
    const P = Array.from({ length: 31 }, () => new Float64Array(31))
    P[0][0] = 1
    let win = 0
    for (let a = 0; a <= 30; a++) for (let b = 0; b <= 30; b++) {
      const pr = P[a][b]
      if (!pr) continue
      if (done(a, b)) { win += pr; continue }
      if (done(b, a)) continue
      if (a < 30) P[a + 1][b] += pr * p
      if (b < 30) P[a][b + 1] += pr * (1 - p)
    }
    table[i] = win
  }
  return (/** @type {number} */ p) => {
    const x = Math.min(Math.max(p, 0), 1) * (N - 1), i = Math.min(Math.floor(x), N - 2), f = x - i
    return table[i] * (1 - f) + table[i + 1] * f
  }
})()

/**
 * @typedef {{ t: number, mixed: boolean, h1: number, h2: number, a1: number, a2: number,
 *   hs: number, as: number }} Game
 * @typedef {{ s: Map<number, number>, se: Map<number, number>, mixed: Map<number, number>,
 *   home: number, mean: (gender: string, divRank: number | null | undefined) => number }} Fit
 */

// Fits the model to `games` as seen at `now`. `divisionOf(id)` is the division rank of the
// team a player was last registered to, `genderOf(id)` their gender: together they give a
// player with few games a starting point at their division's average.
/**
 * @param {Game[]} games
 * @param {number} now ms
 * @param {(id: number) => string} genderOf
 * @param {(id: number) => number | null | undefined} divisionOf
 * @param {Partial<typeof SETTINGS>} [opts]
 * @returns {Fit}
 */
function fit(games, now, genderOf, divisionOf, opts = {}) {
  const o = { ...SETTINGS, ...opts }
  const s = new Map(), m = new Map()
  let home = 0
  const W = games.map(g => Math.pow(0.5, (now - g.t) / (o.halfLifeDays * DAY)))
  for (const g of games) for (const p of [g.h1, g.h2, g.a1, g.a2]) s.set(p, 0)

  /** @type {Record<string, number>} */
  const mu = {}
  const muKey = (/** @type {number} */ p) => `${genderOf(p)}:${divisionOf(p) || 0}`
  const prior = (/** @type {number} */ p) => mu[muKey(p)] || 0
  const get = (/** @type {Map<number, number>} */ M, /** @type {number} */ k) => M.get(k) || 0
  const lin = (/** @type {Game} */ g) => {
    let x = get(s, g.h1) + get(s, g.h2) - get(s, g.a1) - get(s, g.a2) + home
    if (g.mixed) x += get(m, g.h1) + get(m, g.h2) - get(m, g.a1) - get(m, g.a2)
    return x
  }
  const t2 = o.tau * o.tau, m2 = o.mixedSd * o.mixedSd

  // Block coordinate ascent: a damped diagonal-Newton step on the strengths (and home edge),
  // then on the mixed offsets, each from fresh gradients. One step over both blocks on one
  // gradient overshoots and diverges.
  for (let it = 0; it < o.iters; it++) {
    for (const block of ['s', 'm']) {
      /** @type {Map<number, number>} */ const G = new Map()
      /** @type {Map<number, number>} */ const H = new Map()
      let gHome = 0, hHome = 0
      const add = (/** @type {number} */ k, /** @type {number} */ gv, /** @type {number} */ hv) => {
        G.set(k, (G.get(k) || 0) + gv); H.set(k, (H.get(k) || 0) + hv)
      }
      for (let i = 0; i < games.length; i++) {
        const g = games[i]
        if (block === 'm' && !g.mixed) continue
        const n = g.hs + g.as, q = sig(lin(g))
        const gr = W[i] * (g.hs - n * q), hv = W[i] * n * q * (1 - q)
        add(g.h1, gr, hv); add(g.h2, gr, hv); add(g.a1, -gr, hv); add(g.a2, -gr, hv)
        gHome += gr; hHome += hv
      }
      // Each rally's prediction moves five numbers together (four strengths and the home edge),
      // so a step on the diagonal curvature converges only below 2/5. 0.5 sat on that edge:
      // fine on a varied season, but four players meeting over and over oscillated and diverged.
      const STEP = 0.35
      if (block === 's') {
        for (const [p, v] of s) s.set(p, v + STEP * ((G.get(p) || 0) - (v - prior(p)) / t2) / ((H.get(p) || 0) + 1 / t2))
        // A prior on the home edge too (sd 0.1, four times what the data shows): without one, a
        // set of games the home side all won pushes it towards infinity and every strength
        // with it. Real seasons never do that; a test's, or an early season's, can.
        home += STEP * (gHome - home / HOME_VAR) / (hHome + 1 / HOME_VAR)
      } else {
        for (const [p, gv] of G) { const v = get(m, p); m.set(p, v + STEP * (gv - v / m2) / ((H.get(p) || 0) + 1 / m2)) }
      }
    }
    // The division averages, refreshed as the strengths settle, shrunk a little towards 0.
    if (it % 10 === 9) {
      /** @type {Record<string, [number, number]>} */ const acc = {}
      for (const [p, v] of s) { const k = muKey(p); acc[k] = acc[k] || [0, 0]; acc[k][0] += v; acc[k][1]++ }
      for (const k in acc) mu[k] = acc[k][0] / (acc[k][1] + 5)
    }
  }

  // A standard error per player, from the curvature at the answer, for "how sure are we".
  /** @type {Map<number, number>} */ const curv = new Map()
  for (let i = 0; i < games.length; i++) {
    const g = games[i], n = g.hs + g.as, q = sig(lin(g)), hv = W[i] * n * q * (1 - q)
    for (const p of [g.h1, g.h2, g.a1, g.a2]) curv.set(p, (curv.get(p) || 0) + hv)
  }
  const se = new Map([...s.keys()].map(p => [p, 1 / Math.sqrt((curv.get(p) || 0) + 1 / t2)]))
  return { s, se, mixed: m, home, mean: (gender, divRank) => mu[`${gender}:${divRank || 0}`] || 0 }
}

// ---------------------------------------------------------------------------
// Fixtures

// The nine pairings of a fixture, each played twice (scorecardController builds the same
// eighteen games): level doubles are 1+2, 1+3 and 2+3, mixed is man n with lady n.
const RUBBERS = Object.freeze([
  { type: 'FirstMens', mixed: false, pick: (/** @type {Lineup} */ l) => [l.men[0], l.men[1]] },
  { type: 'FirstLadies', mixed: false, pick: (/** @type {Lineup} */ l) => [l.ladies[0], l.ladies[1]] },
  { type: 'SecondMens', mixed: false, pick: (/** @type {Lineup} */ l) => [l.men[0], l.men[2]] },
  { type: 'SecondLadies', mixed: false, pick: (/** @type {Lineup} */ l) => [l.ladies[0], l.ladies[2]] },
  { type: 'ThirdMens', mixed: false, pick: (/** @type {Lineup} */ l) => [l.men[1], l.men[2]] },
  { type: 'ThirdLadies', mixed: false, pick: (/** @type {Lineup} */ l) => [l.ladies[1], l.ladies[2]] },
  { type: 'FirstMixed', mixed: true, pick: (/** @type {Lineup} */ l) => [l.men[0], l.ladies[0]] },
  { type: 'SecondMixed', mixed: true, pick: (/** @type {Lineup} */ l) => [l.men[1], l.ladies[1]] },
  { type: 'ThirdMixed', mixed: true, pick: (/** @type {Lineup} */ l) => [l.men[2], l.ladies[2]] },
])
const GAMES_PER_RUBBER = 2

/**
 * A player as the predictions see them: a strength and a mixed offset.
 * @typedef {{ id: number | null, name: string, s: number, mx: number }} Slot
 * @typedef {{ men: Slot[], ladies: Slot[] }} Lineup
 */

// P(home wins each of the nine rubbers' games), with the home advantage the fit found and
// `swing`, this fixture's own shift towards the home side.
/** @param {Lineup} home @param {Lineup} away @param {number} homeEdge @param {number} [swing] */
function rubberProbs(home, away, homeEdge, swing = 0) {
  return RUBBERS.map(r => {
    const [h1, h2] = r.pick(home), [a1, a2] = r.pick(away)
    let x = h1.s + h2.s - a1.s - a2.s + homeEdge + swing
    if (r.mixed) x += h1.mx + h2.mx - a1.mx - a2.mx
    return gameWin(sig(x))
  })
}

// The fixture's score distribution: P(home wins k of the 18 games), k = 0..18.
/** @param {number[]} probs one per rubber */
function scoreDistribution(probs) {
  let dist = [1]
  for (const q of probs) for (let g = 0; g < GAMES_PER_RUBBER; g++) {
    const next = new Array(dist.length + 1).fill(0)
    dist.forEach((v, k) => { next[k] += v * (1 - q); next[k + 1] += v * q })
    dist = next
  }
  return dist
}

// Gauss-Hermite nodes and weights for a standard normal: the fixture's swing, integrated.
const SWING_NODES = [-2.857, -1.356, 0, 1.356, 2.857]
const SWING_WEIGHTS = (w => w.map(v => v / w.reduce((a, b) => a + b, 0)))([0.0113, 0.2221, 0.5333, 0.2221, 0.0113])

/** @param {Lineup} home @param {Lineup} away @param {number} homeEdge @param {number} [fixtureSd] */
function predictFixture(home, away, homeEdge, fixtureSd = SETTINGS.fixtureSd) {
  const probs = rubberProbs(home, away, homeEdge)
  /** @type {number[]} */ const dist = new Array(GAMES_PER_RUBBER * RUBBERS.length + 1).fill(0)
  SWING_NODES.forEach((z, i) => {
    scoreDistribution(rubberProbs(home, away, homeEdge, fixtureSd * z)).forEach((v, k) => { dist[k] += SWING_WEIGHTS[i] * v })
  })
  const total = dist.length - 1, half = total / 2
  const likely = dist.indexOf(Math.max(...dist))
  return {
    pHome: dist.reduce((a, v, k) => a + (k > half ? v : 0), 0),
    pDraw: dist[half] || 0,
    pAway: dist.reduce((a, v, k) => a + (k < half ? v : 0), 0),
    expected: dist.reduce((a, v, k) => a + v * k, 0),
    likely: { home: likely, away: total - likely },
    rubbers: RUBBERS.map((r, i) => ({
      type: r.type, home: r.pick(home).map(p => p.name), away: r.pick(away).map(p => p.name), p: probs[i],
    })),
  }
}

// The three of one gender a team is expected to field: whoever has played most for it this
// season, then its nominated players in order, then its reserves. Paired strongest first, as
// teams mostly do. Using the nominated three instead called 64% of 2025/26's results right;
// the usual three called 70%, and the players who actually turned up 76%.
/**
 * @template {Slot} T
 * @param {T[]} nominated in rank order
 * @param {T[]} reserves in rank order
 * @param {{ slot: T, fixtures: number }[]} played this season, for this team
 * @returns {T[]} at most three
 */
function usualThree(nominated, reserves, played) {
  const regulars = [...played].sort((a, b) => b.fixtures - a.fixtures || b.slot.s - a.slot.s).map(x => x.slot)
  /** @type {T[]} */ const out = []
  const seen = new Set()
  for (const p of [...regulars, ...nominated, ...reserves]) {
    if (out.length === 3) break
    if (seen.has(p.id)) continue
    seen.add(p.id)
    out.push(p)
  }
  return out.sort((a, b) => b.s - a.s)
}

// ---------------------------------------------------------------------------
// Season projection

// A seeded generator, so a run can be repeated exactly (mulberry32).
/** @param {number} seed */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * @typedef {{ id: number, name: string, divRank: number | null, gamesWon: number, played: number, remaining: number }} Standing
 * @typedef {{ id: number, name: string, rank: number, teams: Standing[], promotes: boolean, relegates: boolean }} Division
 * @typedef {{ home: number, away: number }} Remaining
 * @typedef {{ men: (Slot & { se: number })[], ladies: (Slot & { se: number })[] }} UncertainLineup
 */

// Plays the rest of the season `sims` times. Each run first draws every player's strength
// from their uncertainty — so one run may have a team's number 1 in form across all its
// fixtures, as happens — then plays all 18 games of every fixture left. Final order is
// games won, ties by divRank, as League.getRunIn sorts.
/**
 * @param {Division[]} divisions
 * @param {Remaining[]} remaining
 * @param {Map<number, UncertainLineup>} lineups by team id
 * @param {number} homeEdge
 * @param {{ sims?: number, seed?: number, moving?: number, fixtureSd?: number, formSd?: number }} [opts]
 */
function projectSeason(divisions, remaining, lineups, homeEdge, opts = {}) {
  const sims = opts.sims || 5000, moving = opts.moving || 2
  const fixtureSd = opts.fixtureSd ?? SETTINGS.fixtureSd, formSd = opts.formSd ?? SETTINGS.formSd
  const rand = rng(opts.seed || 20262027)
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())
  const divOf = new Map(), teamIdx = new Map()
  divisions.forEach((d, di) => d.teams.forEach((t, ti) => { divOf.set(t.id, di); teamIdx.set(t.id, ti) }))
  const fixtures = remaining.filter(f => divOf.has(f.home) && divOf.get(f.home) === divOf.get(f.away)
    && lineups.has(f.home) && lineups.has(f.away))

  const counts = divisions.map(d => d.teams.map(() => new Array(d.teams.length).fill(0)))
  const wonSum = divisions.map(d => d.teams.map(() => 0)), wonSq = divisions.map(d => d.teams.map(() => 0))
  const draw = (/** @type {Slot & { se: number }} */ p) => ({ ...p, s: p.s + p.se * gauss() })

  for (let n = 0; n < sims; n++) {
    /** @type {Map<number, Lineup>} */ const drawn = new Map()
    /** @type {Map<number, number>} */ const form = new Map()
    for (const [id, l] of lineups) { drawn.set(id, { men: l.men.map(draw), ladies: l.ladies.map(draw) }); form.set(id, formSd * gauss()) }
    const won = divisions.map(d => d.teams.map(t => t.gamesWon))
    for (const f of fixtures) {
      const di = divOf.get(f.home)
      let hw = 0
      const swing = fixtureSd * gauss() + (form.get(f.home) || 0) - (form.get(f.away) || 0)
      for (const q of rubberProbs(/** @type {Lineup} */ (drawn.get(f.home)), /** @type {Lineup} */ (drawn.get(f.away)), homeEdge, swing)) {
        for (let g = 0; g < GAMES_PER_RUBBER; g++) if (rand() < q) hw++
      }
      won[di][teamIdx.get(f.home)] += hw
      won[di][teamIdx.get(f.away)] += GAMES_PER_RUBBER * RUBBERS.length - hw
    }
    divisions.forEach((d, di) => {
      const order = d.teams.map((t, ti) => ti)
        .sort((a, b) => won[di][b] - won[di][a] || (d.teams[a].divRank ?? 99) - (d.teams[b].divRank ?? 99))
      order.forEach((ti, pos) => { counts[di][ti][pos]++; wonSum[di][ti] += won[di][ti]; wonSq[di][ti] += won[di][ti] ** 2 })
    })
  }

  return divisions.map((d, di) => {
    const n = d.teams.length
    const teams = d.teams.map((t, ti) => {
      const pos = counts[di][ti].map(c => c / sims)
      const sum = (/** @type {number} */ from, /** @type {number} */ to) => pos.slice(from, to).reduce((a, v) => a + v, 0)
      return {
        id: t.id, name: t.name, gamesWon: t.gamesWon, played: t.played, remaining: t.remaining,
        expectedWon: wonSum[di][ti] / sims,
        sdWon: Math.sqrt(Math.max(0, wonSq[di][ti] / sims - (wonSum[di][ti] / sims) ** 2)),
        positions: pos,
        expectedPosition: pos.reduce((a, v, i) => a + v * (i + 1), 0),
        pWinner: pos[0],
        pUp: d.promotes ? sum(0, moving) : 0,
        pDown: d.relegates ? sum(Math.max(n - moving, moving), n) : 0,
      }
    }).sort((a, b) => a.expectedPosition - b.expectedPosition)
    return { id: d.id, name: d.name, rank: d.rank, promotes: d.promotes, relegates: d.relegates, teams }
  })
}

// ---------------------------------------------------------------------------
// Team order checks

/**
 * @typedef {{ id: number, name: string, rank: number, r: number | null, s: number | null, se: number | null, recent: number }} Rated
 * @typedef {{ name: string, nominated: Rated[], reserves: Rated[], unset: boolean }} Squad
 * @typedef {{ name: string, men: Squad, ladies: Squad }} ClubTeam
 */

const RESERVE_BASE = 99
// A team with more nominated players than this has not set its nominations: everyone is
// "nominated", so there is no order to check.
const MAX_NOMINATED = 6
const MIN_RECENT_GAMES = 6
const CONFIDENCE = 0.8

// Normal CDF (a close tanh approximation, plenty for an 80% threshold).
const Phi = (/** @type {number} */ x) => 0.5 * (1 + Math.tanh(0.7978845608 * (x + 0.044715 * x ** 3)))

/** P(a is stronger than b). @param {Rated} a @param {Rated} b */
const pStronger = (a, b) => Phi(((a.s ?? 0) - (b.s ?? 0)) / Math.sqrt((a.se ?? 1) ** 2 + (b.se ?? 1) ** 2))
const usable = (/** @type {Rated} */ p) => p.s != null && p.recent >= MIN_RECENT_GAMES

// The four checks, for one club's teams in club order (team.rank, first team first):
//   order           a lower-nominated player rates above a higher one in the same team
//   lowerStronger   a lower team's nominated player rates above a higher team's
//   reserveTooLow   a reserve rates above the team above's third nominated player
//   reserveTooHigh  a reserve rates below the team below's third nominated player
// Each needs both players with recent games and an 80% chance the order is wrong.
/** @param {ClubTeam[]} teams */
function orderFlags(teams) {
  /** @type {{ kind: string, gender: string, team: string, text: string, p: number, stronger: Rated, weaker: Rated }[]} */
  const flags = []
  /** @param {string} kind @param {string} gender @param {string} team @param {Rated} stronger @param {Rated} weaker @param {string} text */
  const flag = (kind, gender, team, stronger, weaker, text) => {
    if (!usable(stronger) || !usable(weaker)) return
    const p = pStronger(stronger, weaker)
    if (p >= CONFIDENCE) flags.push({ kind, gender, team, text, p, stronger, weaker })
  }
  const third = (/** @type {Squad} */ sq) => sq.nominated[Math.min(2, sq.nominated.length - 1)]

  for (const gender of /** @type {const} */ (['men', 'ladies'])) {
    const label = gender === 'men' ? 'man' : 'lady'
    teams.forEach((team, ti) => {
      const sq = team[gender], nom = sq.nominated
      if (!sq.unset) for (let i = 0; i < nom.length; i++) for (let j = i + 1; j < nom.length; j++) {
        flag('order', gender, team.name, nom[j], nom[i],
          `${nom[j].name} (${label} ${nom[j].rank}) looks stronger than ${nom[i].name} (${label} ${nom[i].rank})`)
      }
      for (let tj = 0; tj < ti; tj++) {
        const up = teams[tj]
        if (up[gender].unset || sq.unset) continue
        for (const b of nom) for (const a of up[gender].nominated) {
          flag('lowerStronger', gender, team.name, b, a,
            `${b.name} (${team.name} ${label} ${b.rank}) looks stronger than ${a.name} (${up.name} ${label} ${a.rank})`)
        }
      }
      const above = teams[ti - 1], below = teams[ti + 1]
      const t3 = above && !above[gender].unset ? third(above[gender]) : undefined
      if (above && t3) for (const r of sq.reserves) {
        flag('reserveTooLow', gender, team.name, r, t3,
          `${r.name} (reserve, ${team.name}) looks stronger than ${above.name}'s ${label} ${t3.rank}, ${t3.name}`)
      }
      const b3 = below && !below[gender].unset ? third(below[gender]) : undefined
      if (below && b3) for (const r of sq.reserves) {
        flag('reserveTooHigh', gender, team.name, b3, r,
          `${r.name} (reserve, ${team.name}) looks weaker than ${below.name}'s ${label} ${b3.rank}, ${b3.name}`)
      }
    })
  }
  return flags
}

module.exports = {
  SETTINGS, RUBBERS, RESERVE_BASE, MAX_NOMINATED, MIN_RECENT_GAMES, CONFIDENCE,
  display, sig, gameWin, fit, usualThree, rubberProbs, scoreDistribution, predictFixture, projectSeason, orderFlags, pStronger,
}

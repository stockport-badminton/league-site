// The rules of a live scorecard (migrations/022_live_scorecard.sql), kept free of the
// database so they can be tested directly and shared with nothing else by accident.
//
// The game layout and the score rules are the SAME ones the paper-card flow enforces —
// scorecardController's `gameObject.data` and its greaterThan21 / differenceOfTwo
// validators. They are restated rather than imported because the controller's versions
// are express-validator callbacks bound to form field names. If either ever changes, this
// must change with it: a live card that signs off a score the draft path would refuse
// produces a draft the results secretary cannot publish.

const GAMES_PER_FIXTURE = 18;

// Slot names are the scorecardstore column names, so toDraftRow is a straight copy.
const SIDES = ['home', 'away'];
const SLOTS = [];
SIDES.forEach(side => {
  ['Man', 'Lady'].forEach(kind => {
    [1, 2, 3].forEach(n => SLOTS.push(side + kind + n));
  });
});

function slotGender(slot) {
  return /Lady/.test(slot) ? 'Female' : 'Male';
}

function slotSide(slot) {
  return slot.indexOf('home') === 0 ? 'home' : 'away';
}

// Two games per pairing, in card order. `pair` names the side-relative slots.
const PAIRINGS = [
  { type: 'FirstMens',    label: '1st Mens',    pair: ['Man1', 'Man2'] },
  { type: 'FirstLadies',  label: '1st Ladies',  pair: ['Lady1', 'Lady2'] },
  { type: 'SecondMens',   label: '2nd Mens',    pair: ['Man1', 'Man3'] },
  { type: 'SecondLadies', label: '2nd Ladies',  pair: ['Lady1', 'Lady3'] },
  { type: 'ThirdMens',    label: '3rd Mens',    pair: ['Man2', 'Man3'] },
  { type: 'ThirdLadies',  label: '3rd Ladies',  pair: ['Lady2', 'Lady3'] },
  { type: 'FirstMixed',   label: '1st Mixed',   pair: ['Man1', 'Lady1'] },
  { type: 'SecondMixed',  label: '2nd Mixed',   pair: ['Man2', 'Lady2'] },
  { type: 'ThirdMixed',   label: '3rd Mixed',   pair: ['Man3', 'Lady3'] },
];

const GAMES = [];
PAIRINGS.forEach(p => {
  [1, 2].forEach(() => GAMES.push({
    n: GAMES.length + 1,
    type: p.type,
    label: p.label,
    home: p.pair.map(s => 'home' + s),
    away: p.pair.map(s => 'away' + s),
  }));
});

function isScore(v) {
  return Number.isInteger(v) && v >= 0 && v <= 30;
}

// null when the score is one the draft path would accept; otherwise why not, in words a
// player can act on. Mirrors scorecardController: 0–30, somebody reached 21, and a lead
// of two unless a side reached 30.
function scoreProblem(h, a) {
  if (!isScore(h) || !isScore(a)) return 'Scores are whole numbers from 0 to 30';
  if (h < 21 && a < 21) return 'One side has to reach 21';
  if (Math.abs(h - a) < 2 && h < 30 && a < 30) return 'The winner needs a two-point lead, unless they reached 30';
  return null;
}

// Parse what a phone sent for one game. Both blank clears it; anything else must be a
// complete, valid score — a half-entered game is the phone's business, not the card's.
function parseGame(body) {
  const blank = v => v === null || v === undefined || v === '';
  if (blank(body.home) && blank(body.away)) return { clear: true };
  // Checked separately because Number('') is 0: without this "21" and a blank is 21–0.
  if (blank(body.home) || blank(body.away)) return { error: 'Enter both scores' };
  const h = Number(body.home);
  const a = Number(body.away);
  const problem = scoreProblem(h, a);
  if (problem) return { error: problem };
  return { h, a };
}

function gameNumber(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= GAMES_PER_FIXTURE ? n : null;
}

// The match so far, from whatever games are in.
function tally(games) {
  let home = 0, away = 0, played = 0, homePoints = 0, awayPoints = 0;
  GAMES.forEach(g => {
    const s = games && games[String(g.n)];
    if (!s || !isScore(s.h) || !isScore(s.a)) return;
    played += 1;
    homePoints += s.h;
    awayPoints += s.a;
    if (s.h > s.a) home += 1; else if (s.a > s.h) away += 1;
  });
  return { home, away, played, homePoints, awayPoints, total: GAMES_PER_FIXTURE };
}

// Everything standing between this card and a captain's signature. Empty means ready.
function problems(card) {
  const players = card.players || {};
  const games = card.games || {};
  const out = [];

  const missing = SLOTS.filter(s => !Number.isInteger(players[s]));
  if (missing.length) out.push(missing.length + ' player ' + (missing.length === 1 ? 'slot is' : 'slots are') + ' still empty');

  // The same rule as the draft path: nobody twice on one side, except No Player (0).
  SIDES.forEach(side => {
    const ids = SLOTS.filter(s => slotSide(s) === side)
      .map(s => players[s])
      .filter(id => Number.isInteger(id) && id !== 0);
    if (new Set(ids).size !== ids.length) out.push('The same player is picked twice for the ' + side + ' side');
  });

  const unplayed = GAMES.filter(g => {
    const s = games[String(g.n)];
    return !s || scoreProblem(s.h, s.a);
  });
  if (unplayed.length) out.push(unplayed.length + ' of ' + GAMES_PER_FIXTURE + ' games have no score yet');

  const t = tally(games);
  if (!unplayed.length && t.home + t.away !== GAMES_PER_FIXTURE) out.push('Every game needs a winner');

  return out;
}

// The scorecardstore row this card becomes. `ctx` is the fixture it was started from;
// `dateText` is the fixture's own timestamp as text, so the draft carries the identical
// value (supersedeEarlierDrafts and the publish step both match on it exactly, and a JS
// Date round trip would put it at the mercy of the process time zone).
//
// The mixed slots are copies of the base slots, exactly as the wizard fills them.
function toDraftRow(card, ctx, extra) {
  const p = card.players;
  const row = {
    date: ctx.dateText,
    division: ctx.divisionId,
    homeTeam: ctx.homeTeamId,
    awayTeam: ctx.awayTeamId,
  };
  SLOTS.forEach(s => { row[s] = p[s]; });
  const ordinal = ['First', 'Second', 'Third'];
  SIDES.forEach(side => {
    [1, 2, 3].forEach(n => {
      row[ordinal[n - 1] + 'Mixed' + side + 'Man' + n] = p[side + 'Man' + n];
      row[ordinal[n - 1] + 'Mixed' + side + 'Lady' + n] = p[side + 'Lady' + n];
    });
  });
  GAMES.forEach(g => {
    const s = card.games[String(g.n)];
    row['Game' + g.n + 'homeScore'] = s.h;
    row['Game' + g.n + 'awayScore'] = s.a;
  });
  row['scoresheet-url'] = '';
  row.email = (extra && extra.email) || '';
  row.confirmToken = extra && extra.confirmToken;
  return row;
}

// What a phone needs to draw the card. Never includes a token.
function publicState(card) {
  return {
    id: card.id,
    rev: card.rev,
    version: card.version,
    status: card.status,
    players: card.players || {},
    games: card.games || {},
    signatures: {
      home: card.home_signed_at ? { by: card.home_signed_by, at: card.home_signed_at } : null,
      away: card.away_signed_at ? { by: card.away_signed_by, at: card.away_signed_at } : null,
    },
    tally: tally(card.games),
    problems: problems(card),
    filed: card.status === 'filed',
  };
}

// Who an editor says they are, for the "entered by" line. Free text, so trimmed and
// capped; it is shown back escaped and is not an identity.
function cleanName(raw, max) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 40);
}

module.exports = {
  GAMES_PER_FIXTURE,
  SLOTS,
  SIDES,
  PAIRINGS,
  GAMES,
  slotGender,
  slotSide,
  scoreProblem,
  parseGame,
  gameNumber,
  tally,
  problems,
  toDraftRow,
  publicState,
  cleanName,
};

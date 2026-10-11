// A scorecard filled in live at the match — see migrations/022_live_scorecard.sql for the
// shape and utils/liveScorecard.js for the rules.
//
// Every write is ONE conditional UPDATE, because several phones write to the same row
// during a match. Each one bumps `rev` so the others' polls notice; content edits also bump
// `version` and clear both signatures in the same statement, so a signature can never
// outlive the scores it was given for. `status = 'live'` is in every edit's WHERE: once a
// card is filing or filed, an edit matches no row and the caller reports it as locked.

var db = require('../db_connect.js');
const { SLOTS, SIDES } = require('../utils/liveScorecard');

const COLUMNS = `id, fixture_id, edit_token, home_token, away_token, players, games, version,
  rev, status, home_signed_by, home_signed_at, away_signed_by, away_signed_at, draft_id,
  created_by, created_email, created_at, updated_at`;

const CLEAR_SIGNATURES = `home_signed_by = NULL, home_signed_at = NULL,
  away_signed_by = NULL, away_signed_at = NULL`;

async function conn() {
  return db.otherConnect();
}

// One card per fixture. ON CONFLICT rather than check-then-insert, so two captains pressing
// Start together get one card between them; the loser gets null and reads the winner's.
exports.create = async function({ fixtureId, tokens, createdBy, createdEmail }) {
  const [rows] = await (await conn()).query(
    `INSERT INTO live_scorecard (fixture_id, edit_token, home_token, away_token, created_by, created_email)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (fixture_id) DO NOTHING
     RETURNING ${COLUMNS}`,
    [fixtureId, tokens.edit, tokens.home, tokens.away, createdBy, createdEmail || null]
  );
  return rows[0] || null;
};

exports.getById = async function(id) {
  const [rows] = await (await conn()).query(`SELECT ${COLUMNS} FROM live_scorecard WHERE id = ?`, [id]);
  return rows[0] || null;
};

exports.getByFixture = async function(fixtureId) {
  const [rows] = await (await conn()).query(`SELECT ${COLUMNS} FROM live_scorecard WHERE fixture_id = ?`, [fixtureId]);
  return rows[0] || null;
};

// Which of these fixtures already have a card, for the start page.
exports.getForFixtures = async function(fixtureIds) {
  if (!fixtureIds.length) return [];
  const [rows] = await (await conn()).query(
    `SELECT id, fixture_id, status, created_by FROM live_scorecard WHERE fixture_id = ANY(?::int[])`,
    [fixtureIds]
  );
  return rows;
};

// The fixture a card belongs to, with everything the page and the draft need.
// LEFT JOINs: a card must still open if a team or division row has gone missing.
// `datetext` is the stored timestamp as text — see toDraftRow for why it is not a Date.
exports.getContext = async function(fixtureId) {
  const [rows] = await (await conn()).query(
    `SELECT f.id AS fixtureid, f.status AS fixturestatus,
            to_char(f.date, 'YYYY-MM-DD HH24:MI:SS') AS datetext,
            to_char(f.date, 'FMDay FMDD FMMonth YYYY') AS datelabel,
            f."homeTeam" AS hometeamid, ht.name AS hometeamname,
            f."awayTeam" AS awayteamid, awt.name AS awayteamname,
            ht.division AS divisionid, d.name AS divisionname
       FROM fixture f
       LEFT JOIN team ht ON f."homeTeam" = ht.id
       LEFT JOIN team awt ON f."awayTeam" = awt.id
       LEFT JOIN division d ON ht.division = d.id
      WHERE f.id = ?`,
    [fixtureId]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    fixtureId: r.fixtureid,
    fixtureStatus: r.fixturestatus,
    dateText: r.datetext,
    dateLabel: r.datelabel,
    homeTeamId: r.hometeamid,
    homeTeamName: r.hometeamname || 'Home',
    awayTeamId: r.awayteamid,
    awayTeamName: r.awayteamname || 'Away',
    divisionId: r.divisionid,
    divisionName: r.divisionname || '',
  };
};

// `playerId` null empties the slot. The slot is checked against SLOTS here as well as in the
// controller, because it becomes part of a jsonb path.
exports.setPlayer = async function(id, slot, playerId) {
  if (SLOTS.indexOf(slot) === -1) throw new Error('unknown slot ' + slot);
  const set = playerId === null
    ? 'players = players - ?::text'
    : 'players = jsonb_set(players, ARRAY[?::text], to_jsonb(?::int))';
  const params = playerId === null ? [slot, id] : [slot, playerId, id];
  const [rows] = await (await conn()).query(
    `UPDATE live_scorecard SET ${set}, version = version + 1, rev = rev + 1,
       ${CLEAR_SIGNATURES}, updated_at = now()
     WHERE id = ? AND status = 'live' RETURNING ${COLUMNS}`,
    params
  );
  return rows[0] || null;
};

// `score` null clears the game; otherwise {h, a, by}.
exports.setGame = async function(id, n, score) {
  const key = String(n);
  const set = score === null
    ? 'games = games - ?::text'
    : 'games = jsonb_set(games, ARRAY[?::text], ?::jsonb)';
  const params = score === null
    ? [key, id]
    : [key, JSON.stringify({ h: score.h, a: score.a, by: score.by || '', at: new Date().toISOString() }), id];
  const [rows] = await (await conn()).query(
    `UPDATE live_scorecard SET ${set}, version = version + 1, rev = rev + 1,
       ${CLEAR_SIGNATURES}, updated_at = now()
     WHERE id = ? AND status = 'live' RETURNING ${COLUMNS}`,
    params
  );
  return rows[0] || null;
};

// A captain signs the version they were looking at. If anything changed since, no row
// matches and the caller tells them to look again — that is the whole point of `version`.
// Bumps `rev` only, so the other captain's view of the content stays signable.
exports.sign = async function(id, side, name, version) {
  if (SIDES.indexOf(side) === -1) throw new Error('unknown side ' + side);
  const [rows] = await (await conn()).query(
    `UPDATE live_scorecard SET ${side}_signed_by = ?, ${side}_signed_at = now(),
       rev = rev + 1, updated_at = now()
     WHERE id = ? AND status = 'live' AND version = ? RETURNING ${COLUMNS}`,
    [name, id, version]
  );
  return rows[0] || null;
};

// Both signed: exactly one request gets to file it.
exports.claimForFiling = async function(id) {
  const [rows] = await (await conn()).query(
    `UPDATE live_scorecard SET status = 'filing', rev = rev + 1, updated_at = now()
     WHERE id = ? AND status = 'live'
       AND home_signed_at IS NOT NULL AND away_signed_at IS NOT NULL
     RETURNING ${COLUMNS}`,
    [id]
  );
  return rows[0] || null;
};

exports.markFiled = async function(id, draftId) {
  const [rows] = await (await conn()).query(
    `UPDATE live_scorecard SET status = 'filed', draft_id = ?, rev = rev + 1, updated_at = now()
     WHERE id = ? AND status = 'filing' RETURNING ${COLUMNS}`,
    [draftId, id]
  );
  return rows[0] || null;
};

// Filing failed before a draft existed: put it back so the captains can sign again.
exports.releaseClaim = async function(id) {
  await (await conn()).query(
    `UPDATE live_scorecard SET status = 'live', rev = rev + 1, updated_at = now()
     WHERE id = ? AND status = 'filing'`,
    [id]
  );
};

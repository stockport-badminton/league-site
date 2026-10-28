// The season history tables and their <entity>_at views (REARCH-02, migration 030).
const db = require('../../db_connect');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);

// Live columns a history table deliberately does not keep: contact and login details, and
// site permissions, none of which is a fact about a season. A new live column has to be
// added to the history table (and its view) or named here, or the next rollover silently
// drops it, the way the archives drifted from the live schema.
const NOT_KEPT = {
  team: [], club: [], division: [], venue: [], messer: [],
  player: ['playerEmail', 'playerTel', 'authEmail', 'role', 'messerAdmin'],
};
// Columns only the archives had: the officer pointers migration 029 dropped from the live
// tables. Kept in history as what 2021/22–2025/26 recorded.
const ARCHIVE_ONLY = { team: ['captain'], club: ['matchSec', 'clubSec'] };
const ENTITIES = Object.keys(NOT_KEPT);

async function columns(table) {
  return run(`SELECT column_name AS name, data_type AS type, character_maximum_length AS len
                FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = ?
               ORDER BY ordinal_position`, [table]);
}

const currentSeason = async () => (await run(
  `SELECT name FROM season WHERE "startDate" <= now() ORDER BY "startDate" DESC LIMIT 1`))[0].name;

describe('history tables keep every live column', () => {
  it.each(ENTITIES)('%s_season has the live columns, in the live types, bar the ones named', async entity => {
    const live = (await columns(entity)).filter(c => !NOT_KEPT[entity].includes(c.name));
    const history = await columns(`${entity}_season`);
    const kept = history.filter(c => !['season', ...(ARCHIVE_ONLY[entity] || [])].includes(c.name));
    const byName = cs => Object.fromEntries(cs.map(c => [c.name, `${c.type}${c.len ? `(${c.len})` : ''}`]));
    expect(byName(kept)).toEqual(byName(live));
  });

  it.each(ENTITIES)('%s_at has the history table\'s columns, in order', async entity => {
    const names = async t => (await columns(t)).map(c => c.name);
    expect(await names(`${entity}_at`)).toEqual(await names(`${entity}_season`));
  });

  it('player_season has no contact details', async () => {
    expect((await columns('player_season')).map(c => c.name))
      .not.toEqual(expect.arrayContaining(['playerEmail']));
    expect((await columns('player_season')).some(c => c.type === 'bytea')).toBe(false);
  });
});

describe('team_at', () => {
  it('reads a past season from history, and the current season from the live table', async () => {
    const current = await currentSeason();
    const [live] = await run('SELECT id, name FROM team ORDER BY id LIMIT 1');
    await run(`INSERT INTO team_season (season, id, name, division) VALUES ('20242025', ?, 'Then', 3)`, [live.id]);

    expect(await run('SELECT name, division FROM team_at WHERE season = ? AND id = ?', ['20242025', live.id]))
      .toEqual([{ name: 'Then', division: 3 }]);
    expect(await run('SELECT name FROM team_at WHERE season = ? AND id = ?', [current, live.id]))
      .toEqual([{ name: live.name }]);
  });

  // A snapshot taken before the next season's startDate is of the season that is still
  // current. Readers use the live table for the current season today; so does the view,
  // rather than returning the team twice.
  it('ignores history rows for the current season', async () => {
    const current = await currentSeason();
    const [live] = await run('SELECT id, name FROM team ORDER BY id LIMIT 1');
    await run(`INSERT INTO team_season (season, id, name) VALUES (?, ?, 'Snapshot')`, [current, live.id]);
    expect(await run('SELECT name FROM team_at WHERE season = ? AND id = ?', [current, live.id]))
      .toEqual([{ name: live.name }]);
  });

  it('leaves the archive-only pointer NULL on live rows', async () => {
    const rows = await run('SELECT DISTINCT captain FROM team_at WHERE season = ?', [await currentSeason()]);
    expect(rows).toEqual([{ captain: null }]);
  });
});

describe('history keys', () => {
  it('refuses a season the season table does not have', async () => {
    await expect(run(`INSERT INTO team_season (season, id) VALUES ('20992100', 1)`))
      .rejects.toThrow(/foreign key/);
  });

  it('refuses a second row for the same season and id', async () => {
    await run(`INSERT INTO player_season (season, id) VALUES ('20242025', 1)`);
    await expect(run(`INSERT INTO player_season (season, id) VALUES ('20242025', 1)`))
      .rejects.toThrow(/duplicate key/);
  });
});

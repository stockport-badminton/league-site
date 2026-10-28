// The season-aware readers against a real Postgres (REARCH-02 step 4).
//
// Each used to splice the season into a table name (`team${season}`) and branch between
// the live tables and that season's archive. They now read the <entity>_at views with the
// season bound, which for the current season are the live tables. Proved identical on the
// local database for every season with history by snapshotting all eleven before and
// after (docs/hardening/2728-rearch/rearch-02-snapshots/). What these tests keep is the
// reason any of it exists: a past season reads that season, the current season reads
// today, and nothing leaks between them.
//
// The seed's archives differ from today (tools/local-db/test-seed.sql): in 2024/25 team 8
// was 'Eastbank C' in Division 2, and in 2025/26 Ben of Northfield A (player 12) was
// registered to Northfield B. Each test copies them into history with the backfill, inside
// its own rolled-back transaction.
const db = require('../../db_connect');
const { backfill } = require('../../tools/season-history-backfill');
const Season = require('../../models/season');
const League = require('../../models/league');
const Teams = require('../../models/teams');
const Club = require('../../models/club');
const Fixture = require('../../models/fixture');
const Player = require('../../models/players');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);

const PAST = '20242025';
const LAST = '20252026';

beforeEach(async () => {
  await backfill(await db.otherConnect());
});

it('the seasons these tests call past are past', () => {
  expect([PAST, LAST]).not.toContain(Season.current());
});

describe('league tables', () => {
  it("names a past season's teams as they were, and divides them as they were", async () => {
    const past = await League.getAllLeagueTables(PAST);
    expect(past.find(r => r.name === 'Eastbank C')).toMatchObject({ divisionName: 'Division 2' });
    expect(past.map(r => r.name)).not.toContain('Eastbank B');

    const now = await League.getAllLeagueTables();
    expect(now.find(r => r.name === 'Eastbank B')).toMatchObject({ divisionName: 'Division 3' });

    expect((await League.getLeagueTable('Division-2', PAST)).map(r => r.name)).toContain('Eastbank C');
  });

  // HARD-10: a withdrawn team leaves this season's table but stays in the seasons it played.
  it('drops a withdrawn team from the current table only', async () => {
    await run('UPDATE team SET withdrawn = now() WHERE id = 1');
    const names = rows => rows.map(r => r.name);

    expect(names(await League.getAllLeagueTables())).not.toContain('Northfield A');
    expect(names(await League.getAllLeagueTables(Season.current()))).not.toContain('Northfield A');
    expect(names(await League.getLeagueTable('Premier'))).not.toContain('Northfield A');
    expect(names(await League.getAllLeagueTables(PAST))).toContain('Northfield A');
    expect(names(await League.getLeagueTable('Premier', PAST))).toContain('Northfield A');
  });

  it('refuses a malformed season as a 404', async () => {
    await expect(League.getAllLeagueTables('2024 AS x --')).rejects.toMatchObject({ status: 404 });
  });
});

describe('Team.getMesser', () => {
  it("reads a past season's draw with that season's team names", async () => {
    await run(`INSERT INTO messer_season (season, id, "homeTeam", "awayTeam", section, "drawPos")
      VALUES (?, 1, 8, 1, 'A', 1)`, [PAST]);
    expect(await Teams.getMesser({ season: PAST, section: 'A' }))
      .toEqual([expect.objectContaining({ homeTeamName: 'Eastbank C', awayTeamName: 'Northfield A', drawPos: 1 })]);
    // A season with no draw recorded is an empty draw, not a missing table.
    expect(await Teams.getMesser({ season: LAST, section: 'A' })).toHaveLength(0);
  });
});

describe('Club.existsInSeason', () => {
  // A club renamed since (Canute → Remnants) is a real filter on the seasons it was used in.
  it("checks the name against that season's clubs", async () => {
    await run(`UPDATE club_season SET name = 'Canute' WHERE season = ? AND id = 3`, [PAST]);
    expect(await Club.existsInSeason('Canute', PAST)).toBe(true);
    expect(await Club.existsInSeason('Eastbank', PAST)).toBe(false);
    expect(await Club.existsInSeason('Canute', '')).toBe(false);
    expect(await Club.existsInSeason('Eastbank', '')).toBe(true);
  });
});

describe('Player.getSeasonRanks', () => {
  it("ranks a player by the division of their team that season", async () => {
    expect(await Player.getSeasonRanks(LAST, [12])).toEqual({ 12: 2 });   // Northfield B
    expect(await Player.getSeasonRanks(undefined, [12])).toEqual({ 12: 1 });  // Northfield A
  });

  it('returns nothing, rather than throwing, for a season with no player history', async () => {
    expect(await Player.getSeasonRanks('20182019')).toEqual({});
  });
});

describe('Fixture.getFixtureDetails', () => {
  it("lists a past season's fixtures with that season's teams and divisions", async () => {
    const past = (await Fixture.getFixtureDetails({ season: PAST })).find(f => f.id === 104);
    expect(past).toMatchObject({ awayTeam: 'Eastbank C', divisionName: 'Division 3' });
    // The division is the home team's: Ridgeline A, Division 3 both then and now.

    const now = (await Fixture.getFixtureDetails({})).find(f => f.id === 307);
    expect(now).toMatchObject({ awayTeam: 'Eastbank B' });
  });

  it("joins the season's division, not today's", async () => {
    await run(`UPDATE division_season SET name = 'Old Division 3' WHERE season = ? AND id = 4`, [PAST]);
    const past = (await Fixture.getFixtureDetails({ season: PAST })).find(f => f.id === 104);
    expect(past.divisionName).toBe('Old Division 3');
  });
});

// HARD-48: a past season's lineups show each player's team and rank as they were.
describe('Fixture.getMatchPlayerOrderDetails', () => {
  const ben = async season => (await Fixture.getMatchPlayerOrderDetails({ season, team: 'Northfield A' }))
    .map(r => ({ Man2: r.Man2, Man2Rank: r.Man2Rank, Man2TeamName: r.Man2TeamName }));

  it("reads a player's team and rank from that season's history", async () => {
    await run('UPDATE player_season SET rank = 7 WHERE season = ? AND id = 12', [LAST]);
    const rows = await ben(LAST);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows).toEqual(rows.map(() => ({ Man2: 'Ben NorthfieldA', Man2Rank: 7, Man2TeamName: 'Northfield B' })));
  });

  it('reads the live tables for the current season, ignoring any history taken of it', async () => {
    await run(`INSERT INTO player_season (season, id, first_name, team, rank)
      VALUES (?, 12, 'Snapshot', 4, 7)`, [Season.current()]);
    const rows = await ben(undefined);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows).toEqual(rows.map(() => ({ Man2: 'Ben NorthfieldA', Man2Rank: 2, Man2TeamName: 'Northfield A' })));
  });

  // 2019/20 ranked 289 of 876 registered players; reading those blanks would paint half
  // the season red. A season ranking fewer than half keeps the live rank, and its teams.
  it('keeps the live rank for a season that mostly did not record one', async () => {
    await run('UPDATE player_season SET rank = NULL WHERE season = ? AND id <> 12', [LAST]);
    await run('UPDATE player_season SET rank = 7 WHERE season = ? AND id = 12', [LAST]);
    expect((await ben(LAST))[0]).toEqual({ Man2: 'Ben NorthfieldA', Man2Rank: 2, Man2TeamName: 'Northfield B' });
  });

  it('falls back to the live row for a player the history does not hold', async () => {
    await run('DELETE FROM player_season WHERE season = ? AND id = 12', [LAST]);
    expect((await ben(LAST))[0]).toEqual({ Man2: 'Ben NorthfieldA', Man2Rank: 2, Man2TeamName: 'Northfield A' });
  });

  // An inner join here dropped 60 fixtures of 2024/25 (gotcha 1c).
  it("keeps the fixture when the player's team that season is not in that season's teams", async () => {
    await run('UPDATE player_season SET team = 999 WHERE season = ? AND id = 12', [LAST]);
    const rows = await ben(LAST);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ Man2: 'Ben NorthfieldA', Man2TeamName: null });
  });
});

describe('Player.getNamesClubsTeams', () => {
  it("lists a past season's squad as registered that season", async () => {
    const team = async season => (await Player.getNamesClubsTeams({ season, club: 'Northfield' }))
      .find(r => r.playerID === 12).teamName;
    expect(await team(LAST)).toBe('Northfield B');
    expect(await team(undefined)).toBe('Northfield A');
  });
});

describe('player and pair stats', () => {
  it("name a past season's clubs and teams as they were", async () => {
    await run(`UPDATE club_season SET name = 'Canute' WHERE season = ? AND id = 3`, [PAST]);

    const players = await Player.newGetPlayerStats({ season: PAST });
    expect(players.find(r => r.playerId === 81)).toMatchObject({ clubName: 'Canute', teamName: 'Eastbank C' });
    const playersNow = await Player.newGetPlayerStats({});
    expect(playersNow.find(r => r.playerId === 81)).toMatchObject({ clubName: 'Eastbank', teamName: 'Eastbank B' });

    // The pair stats' club join ignored the season once, so 2024/25 labelled Canute's
    // pairs "Remnants" and /pair-stats/20242025/club-Canute was empty.
    const pairs = await Player.newGetPairStats({ season: PAST, club: 'Canute' });
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs.every(r => r.clubName === 'Canute')).toBe(true);
    expect(await Player.newGetPairStats({ club: 'Canute' })).toHaveLength(0);
  });
});

describe('Player.getPlayerGameData', () => {
  it("labels each game with the teams of the season it was played in", async () => {
    await run(`UPDATE game SET "homePlayer1End" = 1500, "homePlayer2End" = 1500,
      "awayPlayer1End" = 1500, "awayPlayer2End" = 1500 WHERE fixture IN (104, 307)`);
    // A history row for the current season must not displace the live table.
    await run(`INSERT INTO team_season (season, id, name) VALUES (?, 8, 'Snapshot')`, [Season.current()]);

    const rows = await Player.getPlayerGameData(81);
    const teamOn = date => rows.filter(r => new Date(r.date).getFullYear() === date).map(r => r.teamName);
    expect(new Set(teamOn(2024))).toEqual(new Set(['Eastbank C']));
    expect(new Set(teamOn(2026))).toEqual(new Set(['Eastbank B']));
  });
});

const request = require('supertest');

// HARD-48 changed the player-team joins on /fixture-players from INNER to LEFT, so a
// player whose team cannot be found keeps the fixture on the page instead of removing
// it. That makes a NULL team name reachable for the first time, and both views built the
// note as `"<br />" + row['Man1TeamName']` — which renders the word "null". Real render,
// because the bug is in the template's data contract (CLAUDE.md, *Assert on rendered
// HTML, not the view name*).

jest.mock('../../models/fixture');
jest.mock('../../models/season');
jest.mock('../../models/auth.js');

const Fixture = require('../../models/fixture');
const app = require('../../app');

function row(overrides = {}) {
  const r = {
    id: 1, date: '2024-10-01T00:00:00.000Z', name: 'Tatton',
    teamName: 'Tatton A', oppositionName: 'Shell A',
  };
  for (const p of ['Man1', 'Man2', 'Man3', 'Lady1', 'Lady2', 'Lady3']) {
    r[p] = `${p} Player`;
    r[`${p}Rank`] = 1;
    r[`${p}TeamName`] = 'Tatton A';
  }
  return Object.assign(r, overrides);
}

describe('GET /fixture-players/:season with a player whose team is unknown', () => {
  it('keeps the row and labels the team instead of printing null', async () => {
    Fixture.getMatchPlayerOrderDetails.mockResolvedValue([row({ Man2TeamName: null })]);

    const res = await request(app).get('/fixture-players/20242025');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Man2 Player');
    expect(res.text).toContain('<br />no team');
    expect(res.text).not.toMatch(/<br \/>null/);
  });

  it('still names the other team when there is one', async () => {
    Fixture.getMatchPlayerOrderDetails.mockResolvedValue([row({ Lady1TeamName: 'Tatton B' })]);

    const res = await request(app).get('/fixture-players/20242025');

    expect(res.text).toContain('<br />Tatton B');
  });
});

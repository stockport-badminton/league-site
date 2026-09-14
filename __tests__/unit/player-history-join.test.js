// A player's game history must not drop games played against a team that has since been
// deleted. HARD-11.
//
// There are no foreign keys on `fixture."homeTeam"` / `"awayTeam"`, and 2,132 fixtures
// across every season point at team ids that are no longer in `team`.
// `Player.getPlayerGameData` inner-joined both, so those games vanished from the page
// silently. Measured against production, 14 Sep 2026:
//
//   10,422 of 35,244 game rows — 30% of everything ever recorded
//   677 of 904 players missing at least one game
//   Susan Forbes: played 716 rated games, page showed 256
//
// After the fix her page shows all 716, 406 of them under a deleted team.
//
// WHY THIS IS A SEPARATE FILE rather than a rule added to optional-join-guard.test.js:
// that guard is deliberately narrow and its header explains why — "a guard that cries wolf
// is worse than none, because it teaches people to add exclusions". A general
// `fixture -> team` rule would flag seven call sites, six of which are correct as they
// stand (they read current-season data, where there are no orphans) and would need
// exclusions on day one. So this guards the one query that demonstrably lost rows.
//
// It is a source check rather than a behavioural one because Jest has no database here.
// The behavioural proof is in the package: the same call went 256 -> 716 rows against
// production. What this stops is the join quietly reverting.

const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, '..', '..', 'models', 'players.js');

// The body of getPlayerGameData, up to the next top-level export.
function playerGameDataSource() {
  const src = fs.readFileSync(SOURCE, 'utf8');
  const start = src.indexOf('exports.getPlayerGameData');
  expect(start).toBeGreaterThan(-1);
  const next = src.indexOf('\nexports.', start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("a player's game history keeps games whose team was deleted", () => {
  const body = playerGameDataSource();

  it('LEFT JOINs both teams on the fixture', () => {
    expect(body).toMatch(/LEFT JOIN team homeTeam ON fixture\."homeTeam" = homeTeam\.id/);
    expect(body).toMatch(/LEFT JOIN team awayTeam ON fixture\."awayTeam" = awayTeam\.id/);
  });

  it('does not inner-join either of them', () => {
    // Specifically the bare `JOIN team <alias> ON fixture."<side>Team"` form. Matching on
    // "not LEFT" rather than on the absence of the string, so that reordering the clause
    // cannot sneak an inner join back past this.
    const innerHome = /(?<!LEFT )JOIN team homeTeam ON fixture\."homeTeam"/;
    const innerAway = /(?<!LEFT )JOIN team awayTeam ON fixture\."awayTeam"/;
    expect(body).not.toMatch(innerHome);
    expect(body).not.toMatch(innerAway);
  });

  // Without a fallback the row survives but renders as an empty cell, which looks like a
  // bug rather than a deleted team — and the view prints teamName straight out.
  it('falls back to a readable name rather than NULL', () => {
    expect(body).toMatch(/COALESCE\(homeTeam\.name,\s*'[^']+'\)\s+AS hometeamname/);
    expect(body).toMatch(/COALESCE\(awayTeam\.name,\s*'[^']+'\)\s+AS awayteamname/);
  });

  // The rank is deliberately NOT coalesced: it feeds `team.rank - teamrank AS
  // "teamAdjustment"`, and the view guards with `teamAdjustment > 0`, so NULL renders no
  // bracket. Substituting a number here would invent an adjustment that never happened.
  it('leaves the team rank null rather than inventing an adjustment', () => {
    expect(body).toMatch(/homeTeam\.rank AS hometeamrank/);
    expect(body).toMatch(/awayTeam\.rank AS awayteamrank/);
    expect(body).not.toMatch(/COALESCE\(homeTeam\.rank/);
    expect(body).not.toMatch(/COALESCE\(awayTeam\.rank/);
  });
});

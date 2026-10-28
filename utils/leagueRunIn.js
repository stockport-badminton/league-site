// The league run-in: each division's table with the top two and bottom two marked, and
// whether each of those places is already certain (/admin/league-run-in, superadmin only).
//
// Two up, two down, by position, and nothing more of the rules than that: the top
// division has nobody to promote, the bottom one nobody to relegate, and the top team of
// every division is marked apart as its winner. A tie on games won is not resolved; a
// place is called certain only when no other team can reach the same total.
//
// "Can reach" assumes a team wins every game it has left, 18 a fixture. It ignores that two
// teams who still meet cannot both win that match, so it can say "not yet certain" for a
// team that is in fact safe, never the other way round.

const GAMES_PER_FIXTURE = 18;
const MOVING = 2;

/**
 * @param {Array<{ division: number, divisionName: string, divisionRank: number, id: number,
 *   name: string, played: number, remaining: number, gamesWon: number, gamesLost: number }>} rows
 *   one season's standings, ordered by division and then by place (League.getRunIn)
 */
function runIn(rows) {
  /** @type {Map<number, any>} */
  const divisions = new Map();
  for (const row of rows) {
    if (!divisions.has(row.division)) {
      divisions.set(row.division, { id: row.division, name: row.divisionName, rank: row.divisionRank, teams: [] });
    }
    divisions.get(row.division).teams.push({ ...row, max: row.gamesWon + GAMES_PER_FIXTURE * row.remaining });
  }
  const list = [...divisions.values()];
  const topRank = Math.min(...list.map(d => d.rank));
  const bottomRank = Math.max(...list.map(d => d.rank));

  for (const d of list) {
    const n = d.teams.length;
    d.promotes = d.rank !== topRank;
    d.relegates = d.rank !== bottomRank;
    d.teams.forEach((/** @type {any} */ t, /** @type {number} */ i) => {
      const others = d.teams.filter((/** @type {any} */ o) => o !== t);
      // How many others could still finish level with or above this team, and level
      // with or below it.
      const canCatch = others.filter((/** @type {any} */ o) => o.max >= t.gamesWon).length;
      const canFallTo = others.filter((/** @type {any} */ o) => o.gamesWon <= t.max).length;

      t.position = i + 1;
      t.zone = i === 0 ? 'winner'
        : i < MOVING && d.promotes ? 'up'
        : i >= n - MOVING && d.relegates && i >= MOVING ? 'down'
        : null;
      t.certain = {
        winner: canCatch === 0,
        up: d.promotes && canCatch < MOVING,
        down: d.relegates && canFallTo < MOVING,
      };
    });
  }
  return list;
}

module.exports = { runIn, GAMES_PER_FIXTURE, MOVING };

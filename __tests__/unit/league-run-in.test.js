// utils/leagueRunIn.js: two up, two down, and when each place is certain.
const { runIn } = require('../../utils/leagueRunIn');

// One division's rows, best first, from [name, gamesWon, remaining] triples.
const division = (id, rank, teams) => teams.map(([name, gamesWon, remaining]) => ({
  division: id, divisionName: `Division ${rank}`, divisionRank: rank, id: name, name,
  played: 10, remaining, gamesWon, gamesLost: 0,
}));

const zones = d => d.teams.map(t => t.zone);
const pick = (divisions, name) => divisions.flatMap(d => d.teams).find(t => t.name === name);

const MIDDLE = division(2, 2, [['A', 100, 2], ['B', 90, 2], ['C', 80, 2], ['D', 70, 2], ['E', 60, 2], ['F', 50, 2]]);
const TOP = division(1, 1, [['P1', 100, 0], ['P2', 90, 0], ['P3', 80, 0], ['P4', 70, 0]]);
const BOTTOM = division(3, 3, [['L1', 100, 0], ['L2', 90, 0], ['L3', 80, 0], ['L4', 70, 0]]);

describe('zones', () => {
  it('marks the winner, the second team, and the bottom two', () => {
    const [, middle] = runIn([...TOP, ...MIDDLE, ...BOTTOM]);
    expect(zones(middle)).toEqual(['winner', 'up', null, null, 'down', 'down']);
  });

  it('promotes nobody from the top division and relegates nobody from the bottom one', () => {
    const [top, , bottom] = runIn([...TOP, ...MIDDLE, ...BOTTOM]);
    expect(zones(top)).toEqual(['winner', null, 'down', 'down']);
    expect(zones(bottom)).toEqual(['winner', 'up', null, null]);
  });

  it('keeps the order it was given, numbering from 1', () => {
    const [d] = runIn(MIDDLE);
    expect(d.teams.map(t => [t.position, t.name])).toEqual(
      [[1, 'A'], [2, 'B'], [3, 'C'], [4, 'D'], [5, 'E'], [6, 'F']]);
  });
});

describe('certainty', () => {
  // A has 100 and B could reach at most 90 + 36 = 126, so nothing is settled.
  it('is not certain while another team can still catch up', () => {
    const all = runIn([...TOP, ...MIDDLE, ...BOTTOM]);
    expect(pick(all, 'A').certain).toEqual({ winner: false, up: false, down: false });
    expect(pick(all, 'F').certain.down).toBe(false);
  });

  it('is certain once nobody can reach the same total', () => {
    const all = runIn([...TOP, ...division(2, 2, [['A', 200, 1], ['B', 150, 1], ['C', 100, 1], ['D', 40, 1], ['E', 30, 1]]), ...BOTTOM]);
    expect(pick(all, 'A').certain).toMatchObject({ winner: true, up: true });
    // B can be caught by A only, so second place or better is settled but first is not.
    expect(pick(all, 'B').certain).toMatchObject({ winner: false, up: true });
    // D can reach 58 and only E is below that: bottom two is settled for both.
    expect(pick(all, 'D').certain.down).toBe(true);
    expect(pick(all, 'E').certain.down).toBe(true);
    expect(pick(all, 'C').certain.down).toBe(false);
  });

  it('calls a tie not certain', () => {
    const [d] = runIn([...division(2, 2, [['A', 100, 0], ['B', 100, 0], ['C', 50, 0]]), ...TOP, ...BOTTOM]);
    expect(d.teams[0].certain.winner).toBe(false);
  });

  it('never calls a top-division team promoted, or a bottom-division team relegated', () => {
    const [top, , bottom] = runIn([...TOP, ...MIDDLE, ...BOTTOM]);
    expect(top.teams.every(t => t.certain.up === false)).toBe(true);
    expect(bottom.teams.every(t => t.certain.down === false)).toBe(true);
    // Finished seasons, so the winners are settled.
    expect(top.teams[0].certain.winner).toBe(true);
    expect(bottom.teams[0].certain.winner).toBe(true);
  });
});

it('copes with no results at all', () => {
  expect(runIn([])).toEqual([]);
});

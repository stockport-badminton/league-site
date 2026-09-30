// How the scorecard reader turns what Vision read into form fields.
//
// Measured Sep 2026 by re-running the reader over 59 filed cards and comparing with what
// each captain actually filed. Vision read the header and the names well; the losses were
// all after it:
//
//                          before   after
//   division                10/59   16/16 this season (the rest is stale team data)
//   both teams              37/59   56/59
//   player slots           419/708  635/708
//
// Every test below is one of the causes, on synthetic text laid out like a real card at a
// real photo's resolution — no Vision call and no photograph, because what Google returns
// for the same image is not stable from one run to the next.

process.env.NODE_ENV = 'test';

jest.mock('../../models/players');
jest.mock('../../models/fixture');
jest.mock('../../models/teams');
jest.mock('../../models/division');

const Player = require('../../models/players');
const { extractScorecardData } = require('../../controllers/scorecardExtraction');
const { _matching: M } = require('../../controllers/scorecardAnalysisController');

// A 3000x4000 photo: large enough that fixed-pixel tolerances stop working, which is the
// point — the photos captains send are this size.
const W = 3000, H = 4000;
function word(text, nx, ny, nw = 0.04, nh = 0.015) {
  const x = nx * W, y = ny * H, w = nw * W, h = nh * H;
  return {
    text, confidence: 0.9, centerX: x, centerY: y, width: w, height: h,
    bounds: [{ x: x - w / 2, y: y - h / 2 }, { x: x + w / 2, y: y - h / 2 },
             { x: x + w / 2, y: y + h / 2 }, { x: x - w / 2, y: y + h / 2 }],
  };
}

// The printed template, plus whatever the captain wrote.
function card({ header = [], home = [], away = [] } = {}) {
  const block = (y0, names) => [
    word('LADIES', 0.12, y0), word('GENTLEMEN', 0.12, y0 + 0.12),
    ...names,
  ];
  return [
    word('HOME', 0.06, 0.20),                 // first, as on the card: the header's HOME
    word('DATE', 0.10, 0.14), word('DIVISION', 0.60, 0.14),
    ...header,
    word('HOME', 0.06, 0.26), word('TEAM', 0.12, 0.26),
    word('COUPLES', 0.40, 0.26), word('POINTS', 0.55, 0.26),
    word('WON', 0.75, 0.26), word('BY', 0.81, 0.26),
    ...block(0.29, home),
    word('AWAY', 0.06, 0.55), word('TEAM', 0.12, 0.55),
    ...block(0.58, away),
    word('TOTALS', 0.45, 0.85),
  ];
}
const read = blocks => extractScorecardData({ textBlocks: blocks, imageWidth: W, imageHeight: H });

describe('reading the header', () => {
  // Vision reads the printed "V AWAY" as one word, and sometimes takes the team letter
  // with it. Both names had been read perfectly and both came back empty — 5 of 59 cards.
  it('splits the HOME line on VAWAY, even when it has swallowed the team letter', async () => {
    const { metadata } = await read(card({ header: [
      word('COLLEGE', 0.20, 0.20), word('GREEN', 0.30, 0.20), word('EVAWAY', 0.42, 0.20),
      word('MELLOR', 0.60, 0.20), word('B', 0.68, 0.20, 0.01),
    ] }));
    expect(metadata.homeTeam).toBe('COLLEGE GREEN E');
    expect(metadata.awayTeam).toBe('MELLOR B');
  });

  it('leaves an ordinary header alone', async () => {
    const { metadata } = await read(card({ header: [
      word('SHELL', 0.20, 0.20), word('B', 0.26, 0.20, 0.01), word('AWAY', 0.45, 0.20), word('DOME', 0.60, 0.20),
    ] }));
    expect(metadata.homeTeam).toBe('SHELL B');
    expect(metadata.awayTeam).toBe('DOME');
  });
});

describe('finding the two team blocks', () => {
  // AWAY and TEAM sit further apart than the old fixed 50px on a photo this size, so the
  // block was never found and all six of that side's players came back blank — 14 of
  // 118 sides.
  //
  // Asserted on the flat player lists, which exist before and after the change, so this
  // fails for the anchor and nothing else. An earlier version checked `homeSlots` was not
  // null, which the old code passed by never returning it at all.
  it('finds HOME TEAM and AWAY TEAM on a high-resolution photo', async () => {
    const { homePlayers, awayPlayers } = await read(card({
      home: [word('Richard', 0.20, 0.44), word('Laws', 0.28, 0.44)],
      away: [word('Jason', 0.20, 0.73), word('Hui', 0.28, 0.73)],
    }));
    expect(homePlayers).toEqual(['Richard Laws']);
    expect(awayPlayers).toEqual(['Jason Hui']);
  });
});

describe('players, by slot', () => {
  const pitch = 0.03;                       // LADIES to GENTLEMEN is four rows
  const L = (k, ...ws) => ws.map(([t, x, dy = 0]) => word(t, x, 0.29 + k * pitch + dy));
  const G = (k, ...ws) => ws.map(([t, x, dy = 0]) => word(t, x, 0.41 + k * pitch + dy));

  // The complaint that started this: man 1 missing, and men 2 and 3 became 1 and 2.
  it('leaves an empty row empty instead of moving the rows below it up', async () => {
    const { homeSlots } = await read(card({ home: [
      ...G(2, ['PHIL', 0.20], ['REGAN', 0.28]),
      ...G(3, ['JON', 0.20], ['SMITH', 0.28]),
    ] }));
    expect(homeSlots.men).toEqual([null, 'PHIL REGAN', 'JON SMITH']);
  });

  // Written large, a name wraps: "Kieran" on one line and "Hesp" below. The old 30px row
  // tolerance made those two rows, and neither half matched anybody.
  it('keeps a name written over two lines together', async () => {
    const { homeSlots } = await read(card({ home: [
      ...L(2, ['Kerry', 0.20, -0.005], ['Booth', 0.20, 0.007]),
    ] }));
    expect(homeSlots.ladies).toEqual([null, 'Kerry Booth', null]);
  });
});

describe('matching players', () => {
  const man = (id, first, family) => ({ id, first_name: first, family_name: family });
  const MEN = [man(1, 'Richard', 'Laws'), man(2, 'Jason', 'Hui'), man(3, 'Myles', 'Malloy-Sherratt'),
               man(4, 'Lee', 'Sherratt'), man(5, 'Phil', 'Regan')];
  const LADIES = [man(11, 'Louise', 'Wildgoose'), man(12, 'Suzanne', 'Mayer'), man(13, 'Amy', 'Magee')];
  beforeEach(() => {
    Player.findElgiblePlayersFromTeamId.mockImplementation(async (id, g) => (g === 'Male' ? MEN : LADIES));
  });

  // What captains write. Scored against the whole name, every one was at or under 0.5
  // and came back blank.
  it.each([
    ['R. LAWS', 1], ['Hui', 2], ['Myles M-Sherratt', 3],
  ])('reads "%s" as the right man', async (raw, id) => {
    const out = await M.matchPlayers({ slots: { men: [raw, null, null], ladies: [null, null, null] } }, 9);
    expect(out.men[0]).toBe(String(id));
  });

  it.each([['S. Mayer②', 12], ['Louise W', 11], ['A . MAGEE (  )', 13]])(
    'reads "%s" as the right lady', async (raw, id) => {
      const out = await M.matchPlayers({ slots: { men: [null, null, null], ladies: [raw, null, null] } }, 9);
      expect(out.ladies[0]).toBe(String(id));
    });

  it('keeps each slot where it was on the card', async () => {
    const out = await M.matchPlayers({ slots: { men: [null, 'Phil Regan', 'R Laws'], ladies: [null, null, null] } }, 9);
    expect(out.men).toEqual([null, '5', '1']);
  });

  // Some captains write a man in a ladies row. The section is a hint, not a rule.
  it('moves a clearly male name out of a ladies row', async () => {
    const out = await M.matchPlayers({ slots: { men: [null, null, null], ladies: ['Jason Hui', null, null] } }, 9);
    expect(out.ladies[0]).toBeNull();
    expect(out.men).toContain('2');
  });

  it('never puts one player in two slots', async () => {
    const out = await M.matchPlayers({ slots: { men: ['Richard Laws', 'R. Laws', null], ladies: [null, null, null] } }, 9);
    expect(out.men.filter(id => id === '1')).toHaveLength(1);
  });

  it('falls back to card order when the section labels were not found', async () => {
    const out = await M.matchPlayers({ slots: null, flat: ['Richard Laws', 'Amy Magee', 'Jason Hui'] }, 9);
    expect(out.men).toEqual(['1', '2', null]);
    expect(out.ladies).toEqual(['13', null, null]);
  });
});

describe('division', () => {
  const DIVS = [{ id: 7, name: 'Premier' }, { id: 8, name: 'Division 1' }, { id: 9, name: 'Division 2' }, { id: 10, name: 'Division 3' }];
  // The old fallback stripped "Division" from the handwriting, not from the names, so a
  // correctly read "2" was compared with "Division 2" and lost. 10 of 59 cards right.
  it.each([['2', 9], ['2nd', 9], ['1 .', 8], ['I', 8], ['TWO', 9], ['3', 10], ['Prem', 7], ['PROM', 7]])(
    '"%s" is division %s', (raw, id) => {
      expect(M.divisionFromText(raw, DIVS).id).toBe(id);
    });
  it('is nothing when the box is blank', () => {
    expect(M.divisionFromText('', DIVS)).toBeNull();
  });
});

describe('teams and the fixture', () => {
  it.each([
    ['DAVID LLOYD A. v', 'DAVID LLOYD A'], ['SYDALL 19/4/26 v', 'SYDALL'],
    ['Macc A', 'Macclesfield A'], ["APBC ' A '", 'Alderley Park A'], ['C GREEN A', 'College Green A'],
  ])('cleans "%s"', (raw, clean) => {
    expect(M.cleanTeamText(raw)).toBe(clean);
  });

  const TEAMS = [
    { id: 20, name: 'Syddal Park B', division: 8 }, { id: 21, name: 'Syddal Park A', division: 7 },
    { id: 30, name: 'Shell B', division: 8 }, { id: 31, name: 'Shell C', division: 9 },
    { id: 40, name: 'Mellor A', division: 10 }, { id: 46, name: 'Mellor B', division: 10 },
    { id: 50, name: 'Tatton A', division: 10 }, { id: 60, name: 'Cheadle Hulme A', division: 10 },
    { id: 70, name: 'Aerospace A', division: 9 }, { id: 80, name: 'Featherforce A', division: 8 },
  ];
  const fx = (id, h, a) => ({ id, homeId: h, awayId: a,
    homeName: TEAMS.find(t => t.id === h).name, awayName: TEAMS.find(t => t.id === a).name, divisionId: 10 });

  // "Mellor C" is as close to Mellor A as to Mellor B; only one of them plays Tatton now.
  it('uses the other side of the fixture to break a tie', () => {
    const got = M.matchFixture('Mellor C', 'Tatten', [fx(1, 46, 50), fx(2, 40, 60)], TEAMS);
    expect(got.id).toBe(1);
  });

  // Tatton A is at home twice among the candidates, so this only resolves if "Cheadle"
  // is read as Cheadle Hulme A — Levenshtein alone scores it 0.47.
  it('matches a club name without the team letter', () => {
    const got = M.matchFixture('Tatton', 'Cheadle', [fx(1, 50, 60), fx(2, 50, 40), fx(3, 46, 50)], TEAMS);
    expect(got.id).toBe(1);
  });

  // An unreadable side ("Яна с" for Shell C) must not veto what the other side says.
  it('treats an unreadable side as unread, and trusts a fixture its team has only one of', () => {
    const got = M.matchFixture('AEROSPACE A', 'Яна с', [fx(1, 70, 31), fx(2, 46, 50)], TEAMS);
    expect(got.id).toBe(1);
  });

  it('but not when that team has more than one candidate fixture', () => {
    expect(M.matchFixture('AEROSPACE A', '', [fx(1, 70, 31), fx(2, 70, 30)], TEAMS)).toBeNull();
  });

  // The fixture is a hint. When the card's real fixture is not among the candidates, a
  // nearby one must not be accepted in its place — it falls back to the teams alone.
  it('refuses a fixture the handwriting does not support', () => {
    expect(M.matchFixture('SHELL B', 'SYDDAL PARK B', [fx(1, 80, 30)], TEAMS)).toBeNull();
  });

  // A near-miss is not a match: "Shell C" scores 0.86 against "SHELL B", comfortably over
  // the floor, but Shell B itself scores 1. Accepting it is how a missing fixture turns
  // into somebody else's.
  it('refuses a fixture when another team fits the handwriting clearly better', () => {
    expect(M.matchFixture('SHELL B', 'FEATHERFORCE A', [fx(1, 31, 80)], TEAMS)).toBeNull();
  });

  // "SYDALL" resembles no whole team name, but it is plainly the club, so the side counts
  // as read — otherwise Shell B's only fixture would be taken for it, against Featherforce.
  it('reads a misspelt club name as the club rather than as unread', () => {
    expect(M.teamSimilarity('sydall', 'Syddal Park B')).toBeGreaterThanOrEqual(0.5);
    expect(M.matchFixture('SYDALL', 'SHELL B', [fx(1, 80, 30)], TEAMS)).toBeNull();
  });
});

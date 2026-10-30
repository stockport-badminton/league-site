// utils/externalLeagues.js: reading Manchester's scorecards, and linking other leagues'
// names to our players. The cards here are made up, in the shape mcrbl.org.uk prints.
const X = require('../../utils/externalLeagues');

const td = (cls, text) => `<td class="${cls}">${text}</td>`;
const tr = (...cells) => `<tr>${cells.join('')}</tr>`;
const header = (division, date, home, away) => [
  tr(td('style7', `Date Entered ${date}`)),
  tr(td('style1', 'Division'), td('style2', division), td('style2', date)),
  tr(td('style1', 'HOME'), td('style2', home), td('style1', 'AWAY'), td('style2', away)),
].join('');
const scores = (label, code, [a, b, c, d]) => tr(td('style4', label), td('style5', code),
  td('style6', a), td('style6', b), td('style6', c), td('style6', d), td('style6', ''), td('style6', ''));

// Men A-C then ladies A-C a side. The MEN / LADIES label sits on the B row, as on the site.
function mblCard({ home = [], away = [], games = [], date = '03/09/2025' } = {}) {
  const slot = (i, label) => tr(label ? td('style1', label) : td('', ''), td('style1', 'ABC'[i % 3]), td('style2', home[i]),
    label ? td('style1', label) : td('', ''), td('style1', 'ABC'[i % 3]), td('style2', away[i]));
  return [
    header('2', date, 'Home One', 'Away One'),
    tr(td('style2', ''), td('style4', '◄ "X" IF BC ARE SWAPPED'), td('style2', 'X'), td('style4', '◄ "X" IF BC ARE SWAPPED')),
    slot(0), slot(1, 'MEN'), slot(2), slot(3), slot(4, 'LADIES'), slot(5),
    tr(td('style9', 'GAME 1 POINTS'), td('style9', 'GAME 2 POINTS'), td('style9', 'GAMES')),
    ...games.map(g => scores(...g)),
    tr(td('style8', 'WINNERS'), td('style2', 'Away One'), td('style2', '1'), td('style2', '17')),
  ].join('');
}
const page = (...cards) => `<html><body><table class="center">${cards.join('')}</table></body></html>`;

const HOME = ['Haider Ali', 'Jason Hui', 'Stuart McCracken', 'Hannah Hernon', 'Holly Simonds', 'Nicole Kelly'];
const AWAY = ['Dan Otto', 'Pete Taylor', 'Jacob Olsen', 'Emma Hillesdon', 'Holly Hillesdon', 'Kerrie Worthington (Lawler)'];

describe('parseMcrblSeason', () => {
  it('reads each pairing as two games, the players resolved from their initials', () => {
    const { rows, cards, dropped } = X.parseMcrblSeason(page(mblCard({ home: HOME, away: AWAY, games: [
      ['MENS A&B', 'HA/JH/DO/PT', ['14', '21', '9', '21']],
    ] })));
    expect({ cards, dropped }).toEqual({ cards: 1, dropped: 0 });
    expect(rows).toEqual([1, 2].map(n => expect.objectContaining({
      league: 'mcrbl', played_on: '2025-09-03', game_type: 'MENS A&B', mixed: false,
      home1: 'Haider Ali', home2: 'Jason Hui', away1: 'Dan Otto', away2: 'Pete Taylor',
      home1_gender: 'Male', away2_gender: 'Male', source_key: `2025-09-03|Home One|Away One|MENS A&B|${n}`,
    })));
    expect(rows.map(r => [r.home_score, r.away_score])).toEqual([[14, 21], [9, 21]]);
  });

  it('takes the mixed pairing from the initials, so a B/C swap is read as played', () => {
    // Away's mixed BvB pair is man B with lady C: the card's "BC swapped" box.
    const { rows } = X.parseMcrblSeason(page(mblCard({ home: HOME, away: AWAY, games: [
      ['MIXED BvB', 'JH/HS/PT/KWL', ['16', '21', '8', '21']],
    ] })));
    expect(rows[0]).toMatchObject({ mixed: true, home1: 'Jason Hui', home2: 'Holly Simonds',
      away1: 'Pete Taylor', away2: 'Kerrie Worthington (Lawler)', away1_gender: 'Male', away2_gender: 'Female' });
  });

  it('drops a pairing whose initials fit two listed players, rather than guessing', () => {
    const twins = [...AWAY]; twins[4] = 'Emily Harris'; // EH twice among the away ladies
    const { rows, dropped } = X.parseMcrblSeason(page(mblCard({ home: HOME, away: twins, games: [
      ['LADIES A&B', 'HH/HS/EH/EH', ['19', '21', '7', '21']],
      ['MENS A&C', 'HA/SM/DO/JO', ['14', '21', '16', '21']],
    ] })));
    expect(dropped).toBe(1);
    expect(rows.map(r => r.game_type)).toEqual(['MENS A&C', 'MENS A&C']);
  });

  it('drops a pairing with a blank score', () => {
    const { rows, dropped } = X.parseMcrblSeason(page(mblCard({ home: HOME, away: AWAY, games: [
      ['MENS A&B', 'HA/JH/DO/PT', ['21', '15', '', '']],
    ] })));
    expect({ games: rows.length, dropped }).toEqual({ games: 0, dropped: 1 });
  });

  it('reads an Open card from its fixed pairs, gender not given', () => {
    const open = [
      header('OA', '03/09/2025', 'Edgeley OA', 'Nomads O'),
      tr(td('style1', 'PAIR 1'), td('style2', 'Vince Chan'), td('style1', 'PAIR 1'), td('style2', 'Graham Dean')),
      tr(td('style2', 'Dipesh Asher'), td('style2', 'Oscar Daniel')),
      tr(td('style1', 'PAIR 2'), td('style2', 'Morgan Pittaway'), td('style1', 'PAIR 2'), td('style2', 'Peter Whitehead')),
      tr(td('style2', 'Joe Scott'), td('style2', 'Kavisha Mandalia')),
      scores('H1 v A2', 'VC/DA/PW/KM', ['21', '17', '21', '8']),
    ].join('');
    const { rows } = X.parseMcrblSeason(page(open));
    expect(rows[0]).toMatchObject({ game_type: 'H1 v A2', mixed: false, home1: 'Vince Chan', home2: 'Dipesh Asher',
      away1: 'Peter Whitehead', away2: 'Kavisha Mandalia', home1_gender: null, home_score: 21, away_score: 17 });
  });
});

describe('initials', () => {
  it('knows first-and-last, every word, and a bracketed maiden name', () => {
    expect([...X.initials('Stuart McCracken')]).toEqual(['SM']);
    expect(X.initials('Grace Hope Pike')).toEqual(new Set(['GP', 'GHP']));
    expect(X.initials('Kerrie Worthington (Lawler)')).toEqual(new Set(['KW', 'KL', 'KWL']));
  });
});

describe('linker', () => {
  const link = X.linker([
    { id: 1, name: 'Lorna Allen', gender: 'Female' },
    { id: 2, name: 'Alex Smith', gender: 'Male' }, { id: 3, name: 'Alex  Smith ', gender: 'Male' },
    { id: 4, name: 'Sam Roe', gender: 'Male' },
  ]);

  it('links a name exactly one of ours has, ignoring case and spacing', () => {
    expect(link('mcrbl', 'lorna  ALLEN', 'Female')).toBe(1);
    expect(link('mcrbl', 'Lorna Allen', null)).toBe(1);
  });

  it('keeps apart a name two of ours share, and a name of the other gender', () => {
    expect(link('mcrbl', 'Alex Smith', 'Male')).toBe('mcrbl:alex smith');
    expect(link('tameside', 'Sam Roe', 'Female')).toBe('tameside:sam roe');
  });

  it('gives each league its own players', () => {
    expect(link('tameside', 'Pat Nobody', 'Male')).toBe('tameside:pat nobody');
    expect(link('mcrbl', 'Pat Nobody', 'Male')).toBe('mcrbl:pat nobody');
  });
});

describe('mcrblSeason', () => {
  it('names the season a date falls in, turning over in August', () => {
    expect(X.mcrblSeason(new Date('2026-10-30'))).toBe('2026-27');
    expect(X.mcrblSeason(new Date('2027-04-01'))).toBe('2026-27');
    expect(X.mcrblSeason(new Date('2027-08-02'))).toBe('2027-28');
  });
});

describe('fetchMcrblSeason and tamesideGames', () => {
  it('refuses a season that is not one, before any request', async () => {
    await expect(X.fetchMcrblSeason('2026-27; DROP')).rejects.toThrow('not a Manchester season');
  });

  it('skips Tameside when its database is not configured', async () => {
    expect(await X.tamesideGames()).toBeNull();
  });
});

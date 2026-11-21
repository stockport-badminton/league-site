// utils/fixturePreview.js: the words on a public event page.
const P = require('../../utils/fixturePreview');

const fixture = over => ({ id: 7388, date: new Date(2026, 8, 1), homeTeam: 'Manor B', awayTeam: 'Parrswood C',
  homeTeamId: 11, awayTeamId: 22, divisionName: 'Division 3', status: 'outstanding', homeScore: null, awayScore: null, ...over });
const played = (id, home, away, hs, as, date) => ({ id, date, homeTeam: home, awayTeam: away, homeScore: hs, awayScore: as,
  homeName: `T${home}`, awayName: `T${away}` });
const forecast = fc => ({ ran_at: '2026-08-31', home: null, away: null,
  fixture: { pHome: 0.5, pDraw: 0.1, pAway: 0.4, expected: 9.4, likely: { home: 10, away: 8 }, edges: { mens: 3, ladies: 3, mixed: 3 }, ...fc } });
const text = preview => preview.sections.flatMap(s => s.paragraphs).join(' ');
const pick = (salt, options) => options[0];

describe('formSentence', () => {
  it('says nothing before a team has played', () => {
    expect(P.formSentence('Manor B', [], pick)).toBeNull();
  });

  it('says a winless run in English, not "taking no of their last two"', () => {
    const form = P.teamForm(22, [played(1, 22, 33, 3, 15), played(2, 33, 22, 17, 1)]);
    const s = P.formSentence('Parrswood C', form, pick);
    expect(s).toBe('Parrswood C have not won in their last two, and will be looking to change that.');
    expect(s).not.toMatch(/\bno of\b/);
  });

  it('counts draws in a winless run', () => {
    const form = P.teamForm(22, [played(1, 22, 33, 9, 9), played(2, 33, 22, 12, 6)]);
    expect(P.formSentence('Parrswood C', form, pick)).toContain('drawing one');
  });

  it('notices a winning streak', () => {
    const form = P.teamForm(11, [played(3, 11, 33, 12, 6), played(2, 33, 11, 8, 10), played(1, 11, 33, 13, 5)])
    expect(P.formSentence('Manor B', form, pick)).toMatch(/three straight wins|three wins in a row/);
  });

  it('reads each result from the team’s own side, home or away', () => {
    const form = P.teamForm(11, [played(2, 33, 11, 12, 6), played(1, 11, 33, 12, 6)]);
    expect(form.map(r => r.result)).toEqual(['L', 'W']);
    expect(form[0]).toMatchObject({ home: false, won: 6, lost: 12, opponent: 'T33' });
  });
});

describe('squadSentence', () => {
  const profile = over => ({ teams: 9, men: 5, ladies: 5, overall: 5, fixtures: 3, settled: 0.9, last: 6, projection: null, ...over });

  it('names the strongest squad, and where its strength lies', () => {
    expect(P.squadSentence('Manor B', profile({ overall: 1, men: 1, ladies: 6 }), pick))
      .toMatch(/^On paper Manor B have the strongest squad in the division, with their strength in the men’s games\./);
  });

  it('says how settled the line-up has been, and nothing about it before a match', () => {
    expect(P.squadSentence('Manor B', profile({ settled: 0.4, last: 3 }), pick)).toContain('rotated their squad more than most');
    expect(P.squadSentence('Manor B', profile({ fixtures: 0, settled: null, last: null }), pick)).not.toMatch(/line-up|rotated|six/);
  });
});

describe('buildPreview', () => {
  it('previews an upcoming fixture: the favourite, the likely score, where the games are won', () => {
    const p = P.buildPreview({ fixture: fixture(), forecast: forecast({ pHome: 0.7, pAway: 0.2, likely: { home: 11, away: 7 },
      edges: { mens: 4.5, ladies: 1.5, mixed: 3 } }) });
    expect(p.state).toBe('upcoming');
    expect(p.sections.map(s => s.heading)).toEqual(['Match preview', 'Prediction'])
    const t = text(p);
    expect(t).toContain('Manor B host Parrswood C in Division 3');
    expect(t).toMatch(/Manor B (go in as |are )?favourites|makes Manor B favourites/);
    expect(t).toContain('11–7 Manor B win');
    expect(t).toContain('Manor B should have the edge in the men’s doubles, while Parrswood C look stronger in the ladies’ doubles. The mixed looks evenly matched.');
    const day = new Date(2026, 8, 1).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    expect(p.summary).toBe(`Manor B vs Parrswood C, Division 3 badminton, ${day}. Preview and prediction: Manor B 70% favourites.`);
  });

  it('calls a close one too close to call', () => {
    const p = P.buildPreview({ fixture: fixture(), forecast: forecast({ pHome: 0.45, pAway: 0.42, pDraw: 0.13, likely: { home: 9, away: 9 } }) });
    expect(text(p)).toMatch(/too close to call|very little between the sides/);
    expect(text(p)).toContain('9–9 draw');
    expect(p.summary).toContain('too close to call');
  });

  it('writes "the Premier division", not "in Premier"', () => {
    const p = P.buildPreview({ fixture: fixture({ divisionName: 'Premier' }) });
    expect(text(p)).toContain('in the Premier division');
    expect(text(p)).not.toContain('in Premier ');
  });

  it('reports a result, game types included, and drops the forecast', () => {
    const games = [
      ...Array(6).fill({ gameType: 'ThirdMens', homeScore: 21, awayScore: 15 }),
      ...Array(6).fill({ gameType: 'SecondLadies', homeScore: 15, awayScore: 21 }),
      ...[0, 1, 2, 3, 4, 5].map(i => ({ gameType: 'FirstMixed', homeScore: i < 3 ? 21 : 18, awayScore: i < 3 ? 19 : 21 })),
    ];
    const p = P.buildPreview({ fixture: fixture({ status: 'complete', homeScore: 9, awayScore: 9 }), forecast: forecast(),
      context: { form: [], meetings: [], games } });
    expect(p.state).toBe('result');
    expect(p.forecast).toBeNull();
    expect(text(p)).toContain('Manor B and Parrswood C shared the spoils in Division 3, drawing 9–9');
    expect(text(p)).toContain('Manor B took the men’s doubles 6–0, Parrswood C took the ladies’ doubles 6–0 and the mixed were shared 3–3.');
  });

  it('gives a void or rearranged fixture no prediction', () => {
    for (const status of ['void', 'rearranged', 'rearranging']) {
      const p = P.buildPreview({ fixture: fixture({ status }), forecast: forecast() });
      expect(p.forecast).toBeNull();
      expect(p.sections.map(s => s.heading)).not.toContain('Prediction');
    }
  });

  it('reads previous meetings from this fixture’s side, whichever way round they were played', () => {
    const p = P.buildPreview({ fixture: fixture(), context: { form: [], games: [],
      meetings: [played(2, 22, 11, 7, 11, new Date(2026, 2, 2)), played(1, 11, 22, 12, 6, new Date(2025, 9, 1))] } });
    expect(text(p)).toContain('Manor B won the last meeting 11–7');
    expect(text(p)).toContain('Manor B lead 2–0');
    expect(p.meetings[0]).toMatchObject({ home: 11, away: 7, venue: 'away' });
  });

  it('quotes the table places only before the match', () => {
    const standings = [{ id: 22, gamesWon: 20, gamesLost: 16, played: 2 }, { id: 11, gamesWon: 10, gamesLost: 8, played: 1 }];
    const before = P.buildPreview({ fixture: fixture(), standings });
    expect(before.home.position).toMatchObject({ place: 2, label: '2nd', of: 2 });
    expect(text(before)).toContain('Manor B are 2nd of 2 with 10 games won from one match');
    const after = P.buildPreview({ fixture: fixture({ status: 'complete', homeScore: 10, awayScore: 8 }), standings });
    expect(after.home.position).toBeNull();
  });

  it('words a fixture the same way on every visit, and different fixtures differently', () => {
    const fc = forecast({ pHome: 0.7, pAway: 0.2 });
    expect(text(P.buildPreview({ fixture: fixture(), forecast: fc }))).toBe(text(P.buildPreview({ fixture: fixture(), forecast: fc })));
    const verdicts = new Set([...Array(30).keys()].map(i =>
      P.buildPreview({ fixture: fixture({ id: 1000 + i }), forecast: fc }).sections.find(s => s.heading === 'Prediction').paragraphs[0]));
    expect(verdicts.size).toBeGreaterThan(1);
  });
});

describe('ordinal', () => {
  it.each([[1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [11, '11th'], [12, '12th'], [13, '13th'], [21, '21st'], [22, '22nd']])(
    '%i is %s', (n, s) => expect(P.ordinal(n)).toBe(s));
});

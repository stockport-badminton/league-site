// The confirmation form must show "No Player" for a stored 0, not an innocent bystander.
//
// A stored player id of 0 is the sentinel for a side that turned up short. Nothing in
// views/populated-scorecard.ejs marked either No Player option `selected`, so a stored 0
// matched no option — and a single-select with nothing selected displays the first
// NON-DISABLED option, i.e. a real player.
//
// That is worse than a crash. `full_fixture_post` validates these with `isInt()`, which a
// real player id passes, so confirming the form recorded somebody as playing an event
// they were not in: no error, no bounce, just invented results. Verified live on draft
// 2432, where `ThirdMixedhomeLady3` is stored 0 and the form offered Jo Hilliard.
//
// Ported from the same bug in the Tameside site (commit 0cda7228), which shares this
// view's ancestry.

const request = require('supertest');

jest.mock('../../models/fixture');
jest.mock('../../models/division');
jest.mock('../../models/players');
jest.mock('../../models/teams');
jest.mock('../../models/game');
jest.mock('../../models/club');
jest.mock('../../models/auth.js');
jest.mock('axios');

const Fixture = require('../../models/fixture');
const Division = require('../../models/division');
const Team = require('../../models/teams');
const Player = require('../../models/players');
const app = require('../../app');

const LADIES = [
  { id: 22, first_name: 'Jo', family_name: 'Hilliard' },
  { id: 739, first_name: 'Alison', family_name: 'Cosadinos' },
  { id: 900, first_name: 'Pat', family_name: 'Nolan' },
];
const MEN = [
  { id: 50, first_name: 'Chris', family_name: 'Petty' },
  { id: 60, first_name: 'Dave', family_name: 'Lee' },
  { id: 70, first_name: 'Sam', family_name: 'Reid' },
];

// The ordinal flags are COMPUTED from the ids passed in, exactly as the real query does
// (`CASE WHEN player.id = ? THEN 1 ELSE 0 END AS first|second|third`). A mock with
// hardcoded flags passes while the form is still wrong — that is the failure mode this
// whole test exists to avoid, so do not simplify it.
function eligible(pool) {
  return (first, second, third) => pool.map(p => Object.assign({}, p, {
    first: p.id === Number(first) ? 1 : 0,
    second: p.id === Number(second) ? 1 : 0,
    third: p.id === Number(third) ? 1 : 0,
  }));
}

function draft(over = {}) {
  const base = {
    id: 2432, division: 1, homeTeam: 10, awayTeam: 11, confirmToken: null,
    homeMan1: 50, homeMan2: 60, homeMan3: 70,
    homeLady1: 22, homeLady2: 739, homeLady3: 900,
    awayMan1: 50, awayMan2: 60, awayMan3: 70,
    awayLady1: 22, awayLady2: 739, awayLady3: 900,
    FirstMixedhomeMan1: 50, FirstMixedhomeLady1: 22,
    SecondMixedhomeMan2: 60, SecondMixedhomeLady2: 739,
    ThirdMixedhomeMan3: 70, ThirdMixedhomeLady3: 900,
    FirstMixedawayMan1: 50, FirstMixedawayLady1: 22,
    SecondMixedawayMan2: 60, SecondMixedawayLady2: 739,
    ThirdMixedawayMan3: 70, ThirdMixedawayLady3: 900,
  };
  for (let g = 1; g <= 18; g++) { base['Game' + g + 'homeScore'] = 1; base['Game' + g + 'awayScore'] = 0; }
  return Object.assign(base, over);
}

// The options of one <select>, in document order, with whether each is selected.
function optionsOf(html, id) {
  const block = new RegExp('<select[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)</select>').exec(html);
  if (!block) throw new Error('select not found: ' + id);
  return (block[1].match(/<option[^>]*>[^<]*<\/option>/g) || []).map(o => ({
    value: (/value="([^"]*)"/.exec(o) || [, null])[1],
    label: o.replace(/<[^>]*>/g, '').trim(),
    selected: /\sselected/i.test(o),
    disabled: /\sdisabled/i.test(o),
  }));
}

// What the browser actually shows. Two subtleties, both of which this test got wrong
// first time round:
//   - when several options carry `selected` in a single-select, the LAST one wins. That
//     is what makes `<option disabled selected>Choose…</option>` safe as a fallback: a
//     real option marked selected later overrides it.
//   - with nothing selected at all, the browser shows the first NON-DISABLED option, so a
//     disabled placeholder is skipped rather than displayed. That is what hid the bug.
function displayed(options) {
  const selected = options.filter(o => o.selected);
  return selected.length ? selected[selected.length - 1] : options.find(o => !o.disabled);
}

beforeEach(() => {
  jest.clearAllMocks();
  Division.getAllAndSelectedById.mockResolvedValue([{ id: 1, name: 'Division 1', selected: 1 }]);
  Team.getAllAndSelectedById.mockResolvedValue([{ id: 10, name: 'Mellor A', selected: 1 }]);
  Player.getEligiblePlayersAndSelectedById.mockImplementation((a, b, c, team, gender) =>
    Promise.resolve(gender === 'Female' ? eligible(LADIES)(a, b, c) : eligible(MEN)(a, b, c)));
});

describe('GET /populated-scorecard-beta/:id — a stored 0 means No Player', () => {
  // One squad select (placeholder is disabled, so the bug hid) and one mixed select
  // (no placeholder at all, so the first option is a real player).
  it.each([
    ['homeLady2', 'home'],
    ['awayLady2', 'away'],
    ['SecondMixedhomeLady2', 'home'],
    ['ThirdMixedhomeLady3', 'home'],
    ['SecondMixedawayLady2', 'away'],
    ['ThirdMixedawayMan3', 'away'],
  ])('shows No Player in %s when it is stored as 0', async (field, side) => {
    Fixture.getScorecardById.mockResolvedValue([draft({ [field]: 0 })]);

    const res = await request(app).get('/populated-scorecard-beta/2432');
    expect(res.status).toBe(200);

    const shown = displayed(optionsOf(res.text, field));
    expect(shown.value).toBe('0');
    expect(shown.label).toMatch(/No Player/);
    // The specific failure: a real person offered for a slot nobody filled.
    expect(shown.label).not.toMatch(/Hilliard|Cosadinos|Nolan|Petty|Lee|Reid/);
  });

  it('picks the No Player option matching the side, not the other one', async () => {
    Fixture.getScorecardById.mockResolvedValue([draft({ awayLady2: 0 })]);
    const res = await request(app).get('/populated-scorecard-beta/2432');
    // Both carry value 0, so this is cosmetic — but "No Player Home Team" in an away
    // dropdown reads like a bug of its own.
    expect(displayed(optionsOf(res.text, 'awayLady2')).label).toBe('No Player Away Team');
  });

  // The other direction, which matters just as much: the fix must not make No Player
  // sticky when somebody did play.
  it('still selects the real player when one is stored', async () => {
    Fixture.getScorecardById.mockResolvedValue([draft()]);
    const res = await request(app).get('/populated-scorecard-beta/2432');

    expect(displayed(optionsOf(res.text, 'homeLady2')).label).toBe('Alison Cosadinos');
    expect(displayed(optionsOf(res.text, 'ThirdMixedhomeLady3')).label).toBe('Pat Nolan');
    optionsOf(res.text, 'homeLady2')
      .filter(o => o.value === '0')
      .forEach(o => expect(o.selected).toBe(false));
  });

  it('leaves every other select alone when one field is zeroed', async () => {
    Fixture.getScorecardById.mockResolvedValue([draft({ ThirdMixedhomeLady3: 0 })]);
    const res = await request(app).get('/populated-scorecard-beta/2432');

    expect(displayed(optionsOf(res.text, 'ThirdMixedhomeLady3')).value).toBe('0');
    expect(displayed(optionsOf(res.text, 'SecondMixedhomeLady2')).label).toBe('Alison Cosadinos');
    expect(displayed(optionsOf(res.text, 'homeLady2')).label).toBe('Alison Cosadinos');
  });
});

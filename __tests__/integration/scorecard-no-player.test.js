// Recording a side that turned up short, and the error re-render that made it impossible.
//
// Ported from the Tameside site (8f924847, 7b1d6ff4, f359cffe), where these bugs put a
// captain in an unrecoverable 500 loop — three POSTs in eighteen seconds — on the first
// night of the season. Each link looks harmless alone:
//
//   1. `0` is the "No Player" id. The duplicate validator returned `value` on its pass
//      path, which is truthy for a form's `"0"` but falsy for a numeric 0.
//   2. The error re-render's placeholder was `<option>Choose Lady 2</option>` — no value
//      and NOT disabled, so submittable, and a browser posts a value-less option's label.
//      A row was selected only where its ordinal flag was 1, which nothing satisfies when
//      the choice was 0, so the select fell back to that placeholder.
//   3. The error branch then queried an integer column with "Choose Lady 2", so the page
//      whose only job was to show the validation message crashed instead — and so did
//      every retry.

const request = require('supertest');

jest.mock('../../models/fixture');
jest.mock('../../models/division');
jest.mock('../../models/players');
jest.mock('../../models/teams');
jest.mock('../../models/game');
jest.mock('../../models/club');
jest.mock('../../models/auth.js');
jest.mock('axios');
jest.mock('../../utils/ses', () => ({ sendEmail: jest.fn().mockResolvedValue({}) }));

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

// Ordinal flags computed from the ids passed in, as the real query does. A mock with
// hardcoded flags passes while the form is still wrong.
const eligible = pool => (first, second, third) => pool.map(p => Object.assign({}, p, {
  first: p.id === Number(first) ? 1 : 0,
  second: p.id === Number(second) ? 1 : 0,
  third: p.id === Number(third) ? 1 : 0,
}));

// A body that fails validation (plenty missing), so the error branch renders.
const body = (over = {}) => Object.assign({
  division: '1', homeTeam: '10', awayTeam: '11',
  homeMan1: '50', homeMan2: '60', homeMan3: '70',
  homeLady1: '22', homeLady2: '739', homeLady3: '900',
  awayMan1: '50', awayMan2: '60', awayMan3: '70',
  awayLady1: '22', awayLady2: '739', awayLady3: '900',
}, over);

function optionsOf(html, id) {
  const b = new RegExp('<select[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)</select>').exec(html);
  if (!b) throw new Error('select not found: ' + id);
  return (b[1].match(/<option[^>]*>[^<]*<\/option>/g) || []).map(o => ({
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
  Division.getAllAndSelectedById.mockResolvedValue([{ id: 1, name: 'Division 1' }]);
  Team.getAllAndSelectedById.mockResolvedValue([{ id: 10, name: 'Mellor A' }]);
  Player.getEligiblePlayersAndSelectedById.mockImplementation((a, b, c, team, gender) =>
    Promise.resolve(gender === 'Female' ? eligible(LADIES)(a, b, c) : eligible(MEN)(a, b, c)));
});

describe.each([['/email-scorecard'], ['/scorecard-beta']])('POST %s — the error re-render', route => {
  it('never renders a placeholder a browser could submit', async () => {
    const res = await request(app).post(route).type('form').send(body());
    expect(res.status).toBe(200);

    // A value-less option posts its own LABEL, so an enabled placeholder is a fake data
    // value waiting to happen. Every one must be disabled.
    const enabled = (res.text.match(/<option(?![^>]*disabled)[^>]*>Choose[^<]*<\/option>/g) || []);
    expect(enabled).toEqual([]);
  });

  it('keeps a No Player choice instead of falling back to the placeholder', async () => {
    const res = await request(app).post(route).type('form').send(body({ homeLady2: '0' }));
    expect(res.status).toBe(200);

    const shown = displayed(optionsOf(res.text, 'homeLady2'));
    expect(shown.value).toBe('0');
    expect(shown.label).toMatch(/No Player/);
  });

  it('still shows the real player when one was chosen', async () => {
    const res = await request(app).post(route).type('form').send(body());
    expect(displayed(optionsOf(res.text, 'homeLady2')).label).toBe('Alison Cosadinos');
  });

  // Bug 3. Reachable by anyone, not just by a captain who hit the placeholder — the same
  // crash was seen in production from a scanner posting random strings.
  it('does not crash when a player field is not a number', async () => {
    const res = await request(app).post(route).type('form')
      .send(body({ homeMan1: 'Choose Man 1', homeLady2: 'lmdkqrfp', homeTeam: 'gkuhrrew' }));

    expect(res.status).toBe(200);
    expect(res.status).not.toBe(500);
  });

  it('never passes a non-numeric id to a query against an integer column', async () => {
    await request(app).post(route).type('form')
      .send(body({ homeMan1: 'Choose Man 1', homeLady2: 'lmdkqrfp', homeTeam: 'gkuhrrew' }));

    expect(Player.getEligiblePlayersAndSelectedById).toHaveBeenCalled();
    for (const call of Player.getEligiblePlayersAndSelectedById.mock.calls) {
      for (const arg of call.slice(0, 4)) {
        expect(typeof arg).toBe('number');
        expect(Number.isFinite(arg)).toBe(true);
      }
    }
    for (const call of Team.getAllAndSelectedById.mock.calls) {
      call.forEach(arg => expect(typeof arg).toBe('number'));
    }
  });
});

// Bug from f359cffe: every field the form carries forward needs `value=` on the error
// render, not just the selects.
describe('POST /email-scorecard — an uploaded photo survives a validation error', () => {
  it('carries scoresheet-url back into the hidden field', async () => {
    const url = 'https://badmintontemp.s3.eu-west-1.amazonaws.com/scorecards/abc.jpg';
    const res = await request(app).post('/email-scorecard').type('form')
      .send(body({ 'scoresheet-url': url }));

    expect(res.status).toBe(200);
    const hidden = /<input[^>]*name="scoresheet-url"[^>]*>/.exec(res.text);
    expect(hidden).not.toBeNull();
    // Without a value the photo is discarded and a resubmission saves an empty string,
    // orphaning the object in S3.
    expect(hidden[0]).toContain(url);
  });
});

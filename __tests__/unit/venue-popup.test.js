// The venue map's pin content — ported from the Tameside site with this league's data.
//
// The bug it fixes: the popup was built in SQL from `club.matchNightText`, a hand-written
// summary that lumps every team into one string. Featherforce's reads "Weds & Thurs 8pm 2
// courts", which tells a visitor the club is out on both nights and NOT that A plays
// Thursday and B plays Wednesday. Tameside had the sharper version — G.H.A.P's two teams
// are at two different venues and both pins carried the same combined sentence, which is
// what a visitor reported.
//
// The markup was also concatenated unescaped in Postgres, interpolating a club website
// straight into an `href`. This database already holds `Mulberry's Sports Complex` and two
// `&`s.

process.env.NODE_ENV = 'test';

const VP = require('../../static/beta/js/venue-popup');
const jsonForScript = require('../../utils/jsonForScript');

// Featherforce is the local case: one venue, two teams, two different nights.
const FEATHERFORCE = {
  venueName: 'Salford City Academy',
  address: 'Lancaster Road, Salford',
  gMapUrl: 'https://maps.example/salford',
  matchTeams: [
    { club: 'Featherforce', website: 'https://ff.example', team: 'Featherforce A', matchDay: 'Thursday 8pm 2 courts' },
    { club: 'Featherforce', website: 'https://ff.example', team: 'Featherforce B', matchDay: 'Wednesday 8pm 2 courts' },
  ],
  clubNights: [{ club: 'Featherforce', website: 'https://ff.example', clubNightText: 'Weds & Thurs 8pm' }],
};

describe('a club whose teams play on different nights', () => {
  const html = VP.popupHtml(FEATHERFORCE);

  // The whole point. The club summary must not be what a pin says.
  it('never prints the club-level combined summary as the match night', () => {
    expect(html).toContain('Featherforce A');
    expect(html).toContain('Featherforce B');
    expect(html).not.toMatch(/Featherforce A:<\/strong>\s*Weds &amp; Thurs/);
  });

  it('says which team plays when', () => {
    expect(html).toMatch(/Featherforce A:<\/strong>\s*Thursday 8pm/);
    expect(html).toMatch(/Featherforce B:<\/strong>\s*Wednesday 8pm/);
  });

  it('still shows the club night, labelled as a club night', () => {
    expect(html).toMatch(/Club night:<\/strong>\s*Weds &amp; Thurs 8pm/);
  });
});

describe('grouping', () => {
  const venue = t => ({ venueName: 'V', matchTeams: t, clubNights: [] });

  // Several clubs run two or three teams on the same night at the same venue; printing
  // the same sentence once per team is noise.
  it('collapses teams that share a night onto one line', () => {
    const html = VP.popupHtml(venue([
      { club: 'Shell', team: 'Shell A', matchDay: 'Monday 8pm' },
      { club: 'Shell', team: 'Shell B', matchDay: 'Monday 8pm' },
      { club: 'Shell', team: 'Shell C', matchDay: 'Monday 8pm' },
    ]));
    expect(html).toMatch(/Shell A, Shell B, Shell C:<\/strong>\s*Monday 8pm/);
    expect(html.match(/Monday 8pm/g)).toHaveLength(1);
  });

  it('keeps teams on separate lines when their nights differ', () => {
    const clubs = VP.byClub(venue([
      { club: 'Featherforce', team: 'Featherforce A', matchDay: 'Thursday' },
      { club: 'Featherforce', team: 'Featherforce B', matchDay: 'Wednesday' },
    ]));
    expect(clubs).toHaveLength(1);
    expect(clubs[0].nights).toHaveLength(2);
  });

  it('gives each club its own block and prints the address once', () => {
    const html = VP.popupHtml({
      venueName: 'Woods Lane', address: "Mulberry's, Cheadle", gMapUrl: 'https://maps.example/x',
      matchTeams: [
        { club: 'Shell', team: 'Shell A', matchDay: 'Monday' },
        { club: 'Syddal Park', team: 'Syddal Park A', matchDay: 'Tuesday' },
      ],
      clubNights: [],
    });
    expect(html).toContain('Shell');
    expect(html).toContain('Syddal Park');
    expect(html.match(/Mulberry/g)).toHaveLength(1);
  });

  it('merges a club that both plays and trains at the venue', () => {
    const clubs = VP.byClub({
      matchTeams: [{ club: 'Mellor', website: 'https://m.example', team: 'Mellor A', matchDay: 'Monday' }],
      clubNights: [{ club: 'Mellor', website: null, clubNightText: 'Friday 7pm' }],
    });
    expect(clubs).toHaveLength(1);
    expect(clubs[0].clubNightText).toBe('Friday 7pm');
    // A later null must not blank a website the first list supplied.
    expect(clubs[0].website).toBe('https://m.example');
  });

  it('says so rather than printing a dangling label when a night is missing', () => {
    const html = VP.popupHtml({ venueName: 'V', matchTeams: [{ club: 'C', team: 'C A', matchDay: null }], clubNights: [] });
    expect(html).toContain('match night not recorded');
    expect(html).not.toMatch(/C A:<\/strong>\s*<br>/);
  });
});

// The SQL version had none of this, and the data already contains the characters.
describe('escaping', () => {
  it('escapes a club name that would otherwise break the markup', () => {
    const html = VP.popupHtml({ venueName: 'V', matchTeams: [{ club: '<script>x</script>', team: 'T', matchDay: 'Mon' }], clubNights: [] });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes the ampersand this database actually holds', () => {
    const html = VP.popupHtml({ venueName: 'V', matchTeams: [], clubNights: [{ club: 'Featherforce', clubNightText: 'Weds & Thurs 8pm' }] });
    expect(html).toContain('Weds &amp; Thurs');
    expect(html).not.toMatch(/Weds & Thurs/);
  });

  it('cannot break out of an href', () => {
    const html = VP.popupHtml({
      venueName: 'V', clubNights: [],
      matchTeams: [{ club: 'C', website: 'https://x.example/"onmouseover="alert(1)', team: 'T', matchDay: 'Mon' }],
    });
    expect(html).not.toContain('onmouseover="');
    expect(html).toContain('&quot;');
  });

  // An admin-entered field is a click away from running as script on our own origin.
  it.each(['javascript:alert(1)', 'data:text/html,x', 'JaVaScRiPt:alert(1)', '/relative', 'x.example', ''])(
    'refuses %p as an href', bad => {
      expect(VP.safeUrl(bad)).toBeNull();
      expect(VP.link(bad, 'Club')).toBe('Club');
    });

  it('accepts http and https', () => {
    expect(VP.safeUrl('https://x.example')).toBe('https://x.example');
    expect(VP.safeUrl('http://x.example')).toBe('http://x.example');
  });
});

// The rows are embedded in an inline <script>, and the browser finds the end of a script
// element before any JavaScript is parsed.
describe('embedding the venue data in the page', () => {
  const CLOSER = '</' + 'script>';

  it('cannot close the script block', () => {
    const out = jsonForScript({ address: 'Somewhere' + CLOSER + '<b>' });
    expect(out).not.toContain(CLOSER);
    expect(out).not.toContain('<');
  });

  it('still parses back to exactly the same value', () => {
    const value = { address: "Mulberry's " + CLOSER, night: 'Weds & Thurs' };
    expect(JSON.parse(jsonForScript(value))).toEqual(value);
  });

  it('emits null rather than nothing for an undefined value', () => {
    // `var data = ;` is a syntax error that takes the whole page's script with it.
    expect(jsonForScript(undefined)).toBe('null');
  });

  it('escapes the line separators that were newlines before ES2019', () => {
    expect(jsonForScript({ a: '  ' })).toContain('\\u2028');
    expect(jsonForScript({ a: '  ' })).toContain('\\u2029');
  });
});

// The query itself cannot be exercised without a database — the unit tests above use
// fixture data and the integration test mocks the model — so this guards the one
// regression the whole change is about: going back to the club-level summary.
//
// Verified against production on 22 Sep 2026: 17 venues, and the pin for Salford City
// Academy reads "Featherforce A: Wednesday 8pm 2 courts" / "Featherforce B: Thursday 8pm
// 2 courts" with the club night listed separately, where it used to read the single
// string "Weds & Thurs 8pm 2 courts" for both.
describe('the venue query', () => {
  const src = require('fs').readFileSync(require.resolve('../../models/venue.js'), 'utf8');
  const query = src.slice(src.indexOf('exports.getVenueClubs'), src.indexOf('exports.getById'));
  const code = query.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

  it('takes the match night from the team, not the club summary', () => {
    expect(code).toMatch(/team\."matchDay"/);
    expect(code).not.toMatch(/matchNightText/);
    expect(code).not.toMatch(/matchVenue/);
  });

  it('returns data, not markup — the escaping lives in venue-popup.js', () => {
    expect(code).not.toMatch(/concat\(/i);
    expect(code).not.toMatch(/<strong|<div|<a href/);
  });

  it('leaves withdrawn teams off the map', () => {
    expect(code).toMatch(/withdrawn IS NULL/);
  });
});

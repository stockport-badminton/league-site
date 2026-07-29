// The Admin dropdown builds three links from the user's club claim. That claim is a
// club name for an admin, but the literal string 'All' for a superadmin (see the
// Auth0 strategy in app.js), who has no single club — so building the links
// unconditionally handed the superadmin /manage-players/club-All and
// /forms/{team,club}-registration/All/prefilled, none of which can resolve. The
// registration pair was Sentry NODE-S, and all four events were the superadmin
// clicking their own nav.
//
// Rendering the partial directly rather than booting the app: this is about what the
// template emits for a given claim, and it lets the admin case be exercised without
// a real Auth0 login.

const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

const NAV = path.join(__dirname, '../../views/nav.ejs');
const CLUB_CLAIM = 'https://my-app.example.com/club';
const ROLE_CLAIM = 'https://my-app.example.com/role';

function renderNav(club, role) {
  const user = {
    _json: {
      [ROLE_CLAIM]: role,
      [CLUB_CLAIM]: club,
      'https://my-app.example.com/messeradmin': false,
    },
  };
  return ejs.render(fs.readFileSync(NAV, 'utf8'),
    { user, locals: { user }, pastSeasons: [], static_path: '/static' },
    { filename: NAV });
}

describe('nav club links', () => {
  it('gives an admin the prefilled forms for their own club', () => {
    const html = renderNav('Shell', 'admin');
    expect(html).toContain('/manage-players/club-Shell');
    expect(html).toContain('/forms/team-registration/Shell/prefilled');
    expect(html).toContain('/forms/club-registration/Shell/prefilled');
  });

  it('never builds a link from the literal claim "All"', () => {
    const html = renderNav('All', 'superadmin');
    expect(html).not.toContain('club-All');
    expect(html).not.toContain('/All/prefilled');
    expect(html).not.toMatch(/prefilled/);
  });

  it('does not duplicate the blank forms into the Admin dropdown', () => {
    // They are already in Useful Links, which every user sees.
    const html = renderNav('All', 'superadmin');
    expect(html.match(/href="\/forms\/club-registration"/g)).toHaveLength(1);
    expect(html.match(/href="\/forms\/team-registration"/g)).toHaveLength(1);
  });

  it('falls back safely when the claim is missing entirely', () => {
    const html = renderNav(undefined, 'admin');
    expect(html).not.toContain('club-undefined');
    expect(html).not.toContain('/undefined/prefilled');
    expect(html).not.toMatch(/prefilled/);
  });
});

// The Player and Team Registration form as an editable Word document.
//
// The point of the .docx is that a club secretary can add and delete rows, which
// a PDF AcroForm cannot: its rows are a fixed set of named fields, twelve per
// table, and a club that outgrew them fell into a dynamic-redraw fallback. So
// these tests assert on the document's real content — the zip is opened and
// `word/document.xml` is read — rather than on which builder was called. A test
// that only checked "the docx route responded 200" would have stayed green while
// the tables came out empty, which is exactly the trap
// __tests__/integration/messer-scorecard.test.js documents for res.render.

const zlib = require('zlib');
const request = require('supertest');

let mockCurrentUser = null;

jest.mock('../../middleware/secured', () => (req, res, next) => {
  if (mockCurrentUser) req.user = mockCurrentUser;
  next();
});

jest.mock('../../models/players');
jest.mock('../../models/season', () => ({
  current: jest.fn(() => '20262027'),
  previous: jest.fn(() => '20252026'),
  getSeasons: jest.fn(() => ({ current: '20262027', previous: '20252026' })),
  assertName: jest.fn(),
  isServable: jest.fn(() => true),
  archived: jest.fn(() => []),
}));

jest.mock('../../db_connect', () => ({
  connect: jest.fn(),
  otherConnect: jest.fn(() => Promise.resolve({
    query: jest.fn(() => Promise.resolve([[], []])),
  })),
  withTransaction: jest.fn(fn => fn({ query: jest.fn(() => Promise.resolve([[]])) })),
  isObject: jest.fn(obj => obj === Object(obj)),
}));

const Player = require('../../models/players');
const app = require('../../app');

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// ---------------------------------------------------------------------------
// Reading the .docx
//
// A .docx is a zip. The repo has no unzip helper and jszip is only a transitive
// dependency of `docx`, so this walks the central directory itself and inflates
// the one entry we want with zlib. Thirty lines beats depending on something
// nothing declares.
// ---------------------------------------------------------------------------

// Walks the central directory once, calling back with each entry's name and a
// lazy reader. `docx` names embedded media randomly, so the logo can only be
// found by pattern.
function zipEntries(buffer) {
  // End of central directory: signature 0x06054b50, scanned from the back
  // because the comment field is variable length.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');

  const count = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);
  const entries = [];

  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = buffer.readUInt16LE(p + 10);
    const compressedSize = buffer.readUInt32LE(p + 20);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const localOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLen);

    entries.push({
      name: name,
      read: function() {
        // The local header repeats the name and carries its own extra field,
        // which is often a different length from the central one.
        const lNameLen = buffer.readUInt16LE(localOffset + 26);
        const lExtraLen = buffer.readUInt16LE(localOffset + 28);
        const start = localOffset + 30 + lNameLen + lExtraLen;
        const data = buffer.slice(start, start + compressedSize);
        return method === 0 ? data : zlib.inflateRawSync(data);
      },
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipEntry(buffer, wanted) {
  const entry = zipEntries(buffer).find(e => e.name === wanted);
  if (!entry) throw new Error(`no ${wanted} in the archive`);
  return entry.read();
}

function documentXml(buffer) {
  return readZipEntry(buffer, 'word/document.xml').toString('utf8');
}

function unescapeXml(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

// Every <w:tr> in the document, as an array of cell strings. The masthead and
// the title line are borderless two-cell tables, so they show up here too —
// `registrationRows` filters down to the six-column ones.
function allRows(xml) {
  return (xml.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []).map(tr =>
    (tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).map(tc =>
      unescapeXml((tc.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [])
        .map(t => t.replace(/<[^>]+>/g, '')).join(''))
    )
  );
}

function registrationRows(xml) {
  return allRows(xml).filter(cells => cells.length === 6);
}

// The two registration tables, split at the second header row.
function tables(xml) {
  const rows = registrationRows(xml);
  const headerAt = [];
  rows.forEach((cells, i) => { if (cells[0] === 'Ladies' && cells[3] === 'Men/Open') headerAt.push(i); });
  expect(headerAt).toHaveLength(2);
  return {
    nominated: rows.slice(headerAt[0] + 1, headerAt[1]),
    reserves: rows.slice(headerAt[1] + 1),
  };
}

const nonEmpty = rows => rows.filter(cells => cells.some(c => c !== ''));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// getClubRoster orders by gender, then team rank, then player rank — ladies
// first, and the two genders are independent lists per team.
function player(name, gender, rank, teamName, junior) {
  return { id: name.length + rank, name, gender, rank, junior: junior ? 1 : 0, teamName };
}

// Shell B has two ladies to three men: the case the column pairing exists for.
const SHELL = [
  player('Priya Ramanathan', 'Female', 1, 'Shell A'),
  player('Judith Peatman', 'Female', 2, 'Shell A'),
  player('Emma Hillesdon', 'Female', 3, 'Shell A'),
  player('Sally Ford', 'Female', 1, 'Shell B'),
  player('Jill Naylor', 'Female', 2, 'Shell B'),
  player('Aisha Karim', 'Female', 99, 'Shell A', true),   // reserve
  player('Josie Chan', 'Female', 101, 'Shell B'),         // reserve, rank > 99
  player('Neil Cooper', 'Male', 1, 'Shell A'),
  player('Sam Whittaker', 'Male', 2, 'Shell A'),
  player('Leon Bailey', 'Male', 3, 'Shell A'),
  player('Richard Laws', 'Male', 1, 'Shell B'),
  player('Tom Davis', 'Male', 2, 'Shell B'),
  player('Sai Karthik', 'Male', 3, 'Shell B'),
  player('Tom Beddow', 'Male', 100, 'Shell A'),           // reserve, rank > 99
];

// Twenty nominated ladies in one team: over the AcroForm's twelve-row cap, which
// is the case that motivated the whole exercise.
const BIG_CLUB = [];
for (let i = 1; i <= 20; i++) BIG_CLUB.push(player(`Lady Number ${i}`, 'Female', i, 'Racketeer A'));
for (let i = 1; i <= 14; i++) BIG_CLUB.push(player(`Man Number ${i}`, 'Male', i, 'Racketeer A'));

const SUPERADMIN = {
  id: 'auth0|super',
  displayName: 'Results Secretary',
  _json: {
    'https://my-app.example.com/role': 'superadmin',
    'https://my-app.example.com/club': 'All',
  },
};

function clubAdmin(club) {
  return {
    id: 'auth0|admin',
    displayName: 'Club Admin',
    _json: {
      'https://my-app.example.com/role': 'admin',
      'https://my-app.example.com/club': club,
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = SUPERADMIN;
  Player.getClubRoster.mockResolvedValue(SHELL);
});

async function getDoc(url) {
  const res = await request(app).get(url).buffer().parse((r, cb) => {
    const chunks = [];
    r.on('data', c => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  return res;
}

// ---------------------------------------------------------------------------

describe('GET /forms/team-registration.docx — the blank form', () => {
  it('serves a Word document with the season in the filename', async () => {
    const res = await getDoc('/forms/team-registration.docx');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain(DOCX_TYPE);
    expect(res.headers['content-disposition'])
      .toBe('attachment; filename="Team Registration Form 2026-27.docx"');
  });

  it('stamps the current season on the page, not the template\'s baked-in one', async () => {
    const res = await getDoc('/forms/team-registration.docx');
    const xml = documentXml(res.body);
    expect(xml).toContain('2026-27');
    expect(xml).not.toContain('2025-26');
  });

  it('keeps the template\'s wording, headings and column headers', async () => {
    const xml = documentXml((await getDoc('/forms/team-registration.docx')).body);
    expect(xml).toContain('Stockport &amp; District Badminton League');
    expect(xml).toContain('Player and Team Registration Form');
    expect(xml).toContain('Team Registration');
    expect(xml).toContain('Reserves Registration');
    expect(xml).toContain('Please list your teams ranking players in order of strength');
    expect(xml).toContain('under the age of 18 at the start of September');

    const header = registrationRows(xml)[0];
    expect(header).toEqual(['Ladies', 'Team', 'U 18', 'Men/Open', 'Team', 'U 18']);
  });

  it('embeds the league logo rather than dropping the branding', async () => {
    const buffer = (await getDoc('/forms/team-registration.docx')).body;
    const xml = documentXml(buffer);
    expect(xml).toContain('<w:drawing>');
    // The image itself has to be in the package, or Word shows a red X.
    const media = zipEntries(buffer).filter(e => /^word\/media\/.+\.png$/.test(e.name));
    expect(media).toHaveLength(1);
    expect(media[0].read().length).toBeGreaterThan(1000);
  });

  it('paints the header bars in the template\'s navy and repeats them across pages', async () => {
    const xml = documentXml((await getDoc('/forms/team-registration.docx')).body);
    expect(xml).toContain('w:fill="002060"');
    // tblHeader is what makes the column titles reappear when the table grows
    // past a page — the whole point of letting it grow.
    expect((xml.match(/<w:tblHeader\b/g) || []).length).toBe(2);
    // cantSplit on every row, so a one-line row never straddles a page break.
    expect((xml.match(/<w:cantSplit\b/g) || []).length)
      .toBe(allRows(xml).length);
  });

  it('gives twelve empty rows per table, as the paper form has', async () => {
    const { nominated, reserves } = tables(documentXml((await getDoc('/forms/team-registration.docx')).body));
    expect(nominated).toHaveLength(12);
    expect(reserves).toHaveLength(12);
    expect(nonEmpty(nominated)).toHaveLength(0);
    expect(nonEmpty(reserves)).toHaveLength(0);
  });

  it('is real table rows, so a secretary can insert and delete them', async () => {
    const xml = documentXml((await getDoc('/forms/team-registration.docx')).body);
    // No AcroForm-style fixed fields, and no fixed grid to bump against.
    expect(xml).not.toContain('LadiesRow');
    expect(xml).toContain('<w:tbl>');
  });
});

describe('GET /forms/team-registration/:club/prefilled.docx', () => {
  it('fills a club\'s nominated players, with the team letter and the U 18 flag', async () => {
    const res = await getDoc('/forms/team-registration/Shell/prefilled.docx');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition'])
      .toBe('attachment; filename="Shell Team Registration Form 2026-27.docx"');

    const { nominated } = tables(documentXml(res.body));
    expect(nonEmpty(nominated).slice(0, 3)).toEqual([
      ['Priya Ramanathan', 'A', '', 'Neil Cooper', 'A', ''],
      ['Judith Peatman', 'A', '', 'Sam Whittaker', 'A', ''],
      ['Emma Hillesdon', 'A', '', 'Leon Bailey', 'A', ''],
    ]);
  });

  // rank >= 99 is the reserve marker. They used to all be written a flat 99, and
  // are now numbered sequentially from it — so an == 99 test would put every
  // reserve after the first into the nominated table.
  it('classifies reserves by rank >= 99, not rank == 99', async () => {
    const { nominated, reserves } = tables(documentXml(
      (await getDoc('/forms/team-registration/Shell/prefilled.docx')).body));

    const names = rows => rows.flatMap(cells => [cells[0], cells[3]]).filter(Boolean);
    // Ranks 99, 100 and 101 are all reserves.
    expect(names(reserves).sort()).toEqual(['Aisha Karim', 'Josie Chan', 'Tom Beddow']);
    expect(names(nominated)).not.toContain('Tom Beddow');
    expect(names(nominated)).not.toContain('Josie Chan');
  });

  it('marks a junior with Y in the U 18 column', async () => {
    const { reserves } = tables(documentXml(
      (await getDoc('/forms/team-registration/Shell/prefilled.docx')).body));
    const aisha = reserves.find(cells => cells[0] === 'Aisha Karim');
    expect(aisha[2]).toBe('Y');
    // and nobody else picks the flag up
    expect(reserves.filter(cells => cells[2] === 'Y' || cells[5] === 'Y')).toHaveLength(1);
  });

  // Shell B fields two ladies and three men. Without the pairing, the men's
  // column would slide up against the ladies' and every later team would be
  // out of register between the two halves of the page.
  it('keeps the ladies and men columns aligned when a team is lopsided', async () => {
    const { nominated } = tables(documentXml(
      (await getDoc('/forms/team-registration/Shell/prefilled.docx')).body));
    const filled = nonEmpty(nominated);

    expect(filled).toHaveLength(6); // 3 for Shell A, 3 for Shell B
    expect(filled.slice(3)).toEqual([
      ['Sally Ford', 'B', '', 'Richard Laws', 'B', ''],
      ['Jill Naylor', 'B', '', 'Tom Davis', 'B', ''],
      ['', '', '', 'Sai Karthik', 'B', ''],   // the padded slot
    ]);
  });

  it('leaves a few blank rows at the foot of each table to type into', async () => {
    const { nominated, reserves } = tables(documentXml(
      (await getDoc('/forms/team-registration/Shell/prefilled.docx')).body));
    expect(nominated).toHaveLength(nonEmpty(nominated).length + 4);
    expect(reserves).toHaveLength(nonEmpty(reserves).length + 4);
  });

  // The reason the Word version exists. The AcroForm has twelve rows per table
  // and needed a whole second rendering path to cope with a club that had more.
  it('has no twelve-row cap and needs no continuation page', async () => {
    Player.getClubRoster.mockResolvedValue(BIG_CLUB);
    const xml = documentXml((await getDoc('/forms/team-registration/Racketeer/prefilled.docx')).body);
    const { nominated } = tables(xml);

    expect(nonEmpty(nominated)).toHaveLength(20);
    for (let i = 1; i <= 20; i++) expect(xml).toContain(`Lady Number ${i}`);
    for (let i = 1; i <= 14; i++) expect(xml).toContain(`Man Number ${i}`);

    // One table, still headed once — no "(continued)" section, and no second
    // pass that redraws the page from scratch.
    expect(xml).not.toContain('continued');
    expect(registrationRows(xml).filter(c => c[0] === 'Ladies')).toHaveLength(2);
  });

  it('404s for a club nobody has heard of', async () => {
    Player.getClubRoster.mockResolvedValue([]);
    const res = await request(app).get('/forms/team-registration/Nowhere/prefilled.docx');
    expect(res.status).toBe(404);
  });

  it('refuses a club admin reaching for another club', async () => {
    mockCurrentUser = clubAdmin('College Green');
    const res = await request(app).get('/forms/team-registration/Shell/prefilled.docx');
    expect(res.status).toBe(403);
    expect(Player.getClubRoster).not.toHaveBeenCalled();
  });

  it('lets a club admin have their own club', async () => {
    mockCurrentUser = clubAdmin('Shell');
    const res = await getDoc('/forms/team-registration/Shell/prefilled.docx');
    expect(res.status).toBe(200);
    expect(documentXml(res.body)).toContain('Priya Ramanathan');
  });
});

// The Word version is what the nav points at now, but the PDF URLs are in
// captains' bookmarks and in emails, so they keep working.
describe('the PDF routes it replaces', () => {
  it('still serves the blank PDF', async () => {
    const res = await getDoc('/forms/team-registration');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
  });

  it('still serves the prefilled PDF', async () => {
    const res = await getDoc('/forms/team-registration/Shell/prefilled');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
  });
});

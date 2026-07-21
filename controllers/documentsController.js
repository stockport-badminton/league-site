const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const seasonModel = require('../models/season');
const Player = require('../models/players');

const TEAM_REGISTRATION_TEMPLATE = path.join(__dirname, '../static/beta/docs/Team Registration Form ePDF.pdf');
const CLUB_CLAIM = 'https://my-app.example.com/club';
const ROLE_CLAIM = 'https://my-app.example.com/role';

// "20262027" -> "2026-27", matching the template's existing header style
function seasonLabel(seasonName) {
  return `${seasonName.slice(0, 4)}-${seasonName.slice(6, 8)}`;
}

// Cover the template's baked-in season text and draw the current one in its place
async function stampSeason(doc, label) {
  const page = doc.getPages()[0];
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({ x: 440, y: 637, width: 115, height: 22, color: rgb(1, 1, 1) });
  page.drawText(label, { x: 444, y: 643, size: 13, font, color: rgb(0.043, 0.176, 0.427) });
}

exports.teamRegistrationForm = async function(req, res, next) {
  try {
    const label = seasonLabel(seasonModel.current());
    const doc = await PDFDocument.load(fs.readFileSync(TEAM_REGISTRATION_TEMPLATE));
    await stampSeason(doc, label);

    const pdfBytes = await doc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Team Registration Form ${label}.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    next(err);
  }
};

// --- Prefilled version ------------------------------------------------

// Field names for the two 12-row tables baked into the template. Both share
// the same column x-positions (Ladies|Team|U18|Men-Open|Team|U18); the
// reserves table's fields just have odd auto-generated names from Acrobat.
function nominatedFieldNames(n) {
  return {
    ladiesName: `LadiesRow${n}`,
    ladiesTeam: `TeamRow${n}`,
    ladiesU18: `U 18Row${n}`,
    menName: `MenOpenRow${n}`,
    menTeam: `TeamRow${n}_2`,
    menU18: `U 18Row${n}_2`,
  };
}

function reserveFieldNames(n) {
  const base = `Team U 18 Team U 18 Ladies MenOpenRow${n}`;
  return {
    ladiesName: base,
    ladiesTeam: `${base}_2`,
    ladiesU18: `${base}_3`,
    menName: `${base}_4`,
    menTeam: `${base}_5`,
    menU18: `${base}_6`,
  };
}

const ROWS_PER_TABLE = 12;

// Team names are "<Club> A" / "<Club> B" etc — the template's Team columns
// are narrow, so show just the distinguishing letter, matching the existing
// docx export's convention (playerController.js manage_player_list_clubs_teams).
function teamLabel(teamName) {
  return teamName.trim().slice(-1);
}

function setField(form, name, value) {
  form.getTextField(name).setText(value || '');
}

// Groups ladies/men into {lady, man} row pairs, one team at a time (in the
// team's own rank order — see getClubRoster), padding the shorter gender
// with blanks so a team's block ends at the same row for both columns. Without
// this, a team with e.g. 3 ladies but 4 men pushes every following team's rows
// out of alignment between the two columns.
function alignTeamRows(allRows, ladies, men) {
  const teamOrder = [];
  const seen = new Set();
  allRows.forEach(r => { if (!seen.has(r.teamName)) { seen.add(r.teamName); teamOrder.push(r.teamName); } });

  const ladiesByTeam = {};
  ladies.forEach(l => { (ladiesByTeam[l.teamName] = ladiesByTeam[l.teamName] || []).push(l); });
  const menByTeam = {};
  men.forEach(m => { (menByTeam[m.teamName] = menByTeam[m.teamName] || []).push(m); });

  const rows = [];
  teamOrder.forEach(team => {
    const teamLadies = ladiesByTeam[team] || [];
    const teamMen = menByTeam[team] || [];
    const count = Math.max(teamLadies.length, teamMen.length);
    for (let i = 0; i < count; i++) {
      rows.push({ lady: teamLadies[i] || null, man: teamMen[i] || null });
    }
  });
  return rows;
}

function fillStaticRows(form, fieldNamesFn, rows, count) {
  for (let i = 0; i < count; i++) {
    const f = fieldNamesFn(i + 1);
    const row = rows[i] || {};
    setField(form, f.ladiesName, row.lady && row.lady.name);
    setField(form, f.ladiesTeam, row.lady && teamLabel(row.lady.teamName));
    setField(form, f.ladiesU18, row.lady && row.lady.junior ? 'Y' : '');
    setField(form, f.menName, row.man && row.man.name);
    setField(form, f.menTeam, row.man && teamLabel(row.man.teamName));
    setField(form, f.menU18, row.man && row.man.junior ? 'Y' : '');
  }
}

// --- Dynamic table rendering, for clubs whose nominated or reserve list
// doesn't fit the template's fixed 12-row tables. Built fresh (not editing
// template content), so there's no cap on how many players can be listed.
//
// Two ways in:
//  - reserves-only overflow: nominated fits the static template as-is, so we
//    just tack a "(continued)" page on the end for the reserves overflow.
//  - nominated overflow: showing the (already-complete, static) Reserves
//    table on page 1 while Nominated's overflow trails on a later page would
//    put Reserves ahead of the rest of Nominated in reading order. Instead we
//    blank out both static tables on page 1 and render both sections fresh,
//    Nominated in full before Reserves starts, extending across as many pages
//    as either one needs.

const PAGE_SIZE = [595.2, 841.68];
const COL_X = [38, 193, 245, 296, 451, 503];
const COL_WIDTH = [155, 52, 51, 155, 52, 52];
const COL_HEADERS = ['Ladies', 'Team', 'U 18', 'Men/Open', 'Team', 'U 18'];
const ROW_HEIGHT = 15.36;
const FIELD_HEIGHT = 13.92;
const HEADER_HEIGHT = 20;
const TOP_Y = 800;
const PAGE1_START_Y = 524; // where the static "Team Registration" heading sits
const BOTTOM_MARGIN = 40;
const HEADER_FILL = rgb(0.043, 0.176, 0.427);

// Blanks everything below the intro paragraph on page 1 (both static
// headings and both static tables), so it can be redrawn dynamically.
function blankLowerPage1(page) {
  page.drawRectangle({ x: 30, y: 30, width: 536, height: 505, color: rgb(1, 1, 1) });
}

async function renderSections(doc, form, startPage, startY, sections) {
  const titleFont = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = startPage;
  let y = startY;
  let fieldCounter = 0;

  function drawHeaderRow() {
    COL_X.forEach((x, i) => {
      page.drawRectangle({ x, y: y - HEADER_HEIGHT, width: COL_WIDTH[i], height: HEADER_HEIGHT, color: HEADER_FILL });
      page.drawText(COL_HEADERS[i], { x: x + 4, y: y - HEADER_HEIGHT + 6, size: 9, font: titleFont, color: rgb(1, 1, 1) });
    });
    y -= HEADER_HEIGHT;
  }

  function newPage() {
    page = doc.addPage(PAGE_SIZE);
    y = TOP_Y;
  }

  function drawSectionHeading(title) {
    if (y - (24 + HEADER_HEIGHT) < BOTTOM_MARGIN) newPage();
    page.drawText(title, { x: COL_X[0], y, size: 14, font: titleFont, color: HEADER_FILL });
    y -= 24;
    drawHeaderRow();
  }

  function addField(x, rowTop, width, value) {
    const name = `Dyn_${fieldCounter++}`;
    const field = form.createTextField(name);
    field.setText(value || '');
    field.addToPage(page, {
      x, y: rowTop - FIELD_HEIGHT, width, height: FIELD_HEIGHT,
      borderWidth: 0.5, borderColor: rgb(0, 0, 0),
    });
  }

  if (!page) newPage();

  for (const section of sections) {
    drawSectionHeading(section.title);

    for (const row of section.rows) {
      if (y - ROW_HEIGHT < BOTTOM_MARGIN) {
        newPage();
        drawSectionHeading(`${section.title} (continued)`);
      }
      const lady = row.lady, man = row.man;
      const values = [
        lady && lady.name, lady && teamLabel(lady.teamName), lady && lady.junior ? 'Y' : '',
        man && man.name, man && teamLabel(man.teamName), man && man.junior ? 'Y' : '',
      ];
      COL_X.forEach((x, col) => addField(x, y, COL_WIDTH[col], values[col]));
      y -= ROW_HEIGHT;
    }
    y -= 20; // gap before the next section's heading
  }
}

// Auth check mirrors manage_player_list_clubs_teams (playerController.js),
// but reads the claims already present on req.user instead of making a live
// Auth0 Management API call for data nav.ejs proves is already free on every page.
function assertClubAccess(req, club) {
  const userClub = req.user && req.user._json && req.user._json[CLUB_CLAIM];
  if (userClub !== club && userClub !== 'All') {
    const err = new Error("Sorry you don't have access to this page");
    err.status = 403;
    throw err;
  }
}

exports.teamRegistrationFormPrefilled = async function(req, res, next) {
  try {
    const club = req.params.club;
    assertClubAccess(req, club);

    const roster = await Player.getClubRoster(club);
    if (roster.length < 1) return next('no club by that name');

    const nominated = roster.filter(r => r.rank !== 99);
    const reserves = roster.filter(r => r.rank === 99);
    const nominatedRows = alignTeamRows(nominated, nominated.filter(r => r.gender === 'Female'), nominated.filter(r => r.gender === 'Male'));
    const reserveRows = alignTeamRows(reserves, reserves.filter(r => r.gender === 'Female'), reserves.filter(r => r.gender === 'Male'));

    const label = seasonLabel(seasonModel.current());
    const doc = await PDFDocument.load(fs.readFileSync(TEAM_REGISTRATION_TEMPLATE));
    await stampSeason(doc, label);
    const form = doc.getForm();

    if (nominatedRows.length <= ROWS_PER_TABLE) {
      fillStaticRows(form, nominatedFieldNames, nominatedRows, ROWS_PER_TABLE);

      if (reserveRows.length <= ROWS_PER_TABLE) {
        fillStaticRows(form, reserveFieldNames, reserveRows, ROWS_PER_TABLE);
      } else {
        console.warn(`Team registration form: reserves overflow for club "${club}"`);
        fillStaticRows(form, reserveFieldNames, reserveRows.slice(0, ROWS_PER_TABLE), ROWS_PER_TABLE);
        await renderSections(doc, form, null, null, [
          { title: 'Reserves Registration (continued)', rows: reserveRows.slice(ROWS_PER_TABLE) },
        ]);
      }
    } else {
      // Nominated overflows: the static Reserves table can't be moved out of the
      // way, so redraw both sections fresh, Nominated in full before Reserves.
      console.warn(`Team registration form: nominated overflow for club "${club}"`);
      const page1 = doc.getPages()[0];
      blankLowerPage1(page1);
      await renderSections(doc, form, page1, PAGE1_START_Y, [
        { title: 'Team Registration', rows: nominatedRows },
        { title: 'Reserves Registration', rows: reserveRows },
      ]);
    }

    const pdfBytes = await doc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${club} Team Registration Form ${label}.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    next(err);
  }
};

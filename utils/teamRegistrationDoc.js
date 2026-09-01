// The league's Player and Team Registration form, as an editable Word document.
//
// The form has always been a PDF AcroForm stamped from
// `static/beta/docs/Team Registration Form ePDF.pdf`, and as a *form* it is
// unusable: an AcroForm has a fixed set of named fields, so a club secretary
// cannot add the player who joined last week or delete the one who left. The
// PDF path grew a whole dynamic-redraw fallback (blank the page, re-render both
// tables, mint new fields) purely to cope with clubs that outgrew its twelve
// rows — machinery that a Word table makes unnecessary, because a Word table
// just grows.
//
// This module builds the same document with real table rows. Layout numbers are
// measured from the PDF template rather than guessed:
//
//   page          A4, 595.2 x 841.68pt, table spanning x=38..555 (517pt)
//   columns       155 | 52 | 51 | 155 | 52 | 52  (Ladies|Team|U 18|Men/Open|Team|U 18)
//   header fill   #002060, 12pt Calibri Bold in white, centred
//   headings      14pt Calibri Bold #002060  ("Player and Team Registration
//                 Form", the season stamp, "Team Registration", "Reserves
//                 Registration")
//   masthead      22pt Calibri Bold #002060 beside the league logo
//   body          11pt Calibri
//   row height    15.36pt
//
// The row-pairing helpers below are shared with the PDF path in
// documentsController, so the two documents can't drift.

const path = require('path');
const fs = require('fs');
const docx = require('docx');
const Roster = require('../models/roster');

const LOGO = path.join(__dirname, '../static/beta/docs/sdbl-logo.png');

// The logo's footprint on the PDF template: ~121 x 109pt. ImageRun sizes in
// pixels at 96dpi, so convert rather than passing points and landing at 75%.
const LOGO_PT = { width: 121, height: 109 };
const LOGO_PX = {
  width: Math.round(LOGO_PT.width / 72 * 96),
  height: Math.round(LOGO_PT.height / 72 * 96),
};

const NAVY = '002060';

// Widths in twips (1/20 pt), straight from the template's column positions.
// These go into <w:tblGrid> as well as each cell: with a fixed table layout it
// is the grid Word lays out from, and docx defaults it to 100 twips a column
// when it isn't given — which collapses every column to nothing. Percentage
// widths (the convention in rosterController's export) are an autofit
// instruction, and autofit would let a long name widen the Ladies column and
// pull the whole grid out of register with the paper form.
const COL_PT = [155, 52, 51, 155, 52, 52];
const COL_TWIP = COL_PT.map(w => w * 20);
const TABLE_TWIP = COL_TWIP.reduce((a, b) => a + b, 0); // 10340 = 517pt
const COL_HEADERS = ['Ladies', 'Team', 'U 18', 'Men/Open', 'Team', 'U 18'];

// The masthead's logo/title split (the title starts at x=170 on the template)
// and the title/season split (the season stamp starts at x=452.5).
const MASTHEAD_TWIP = [(170 - 38) * 20, TABLE_TWIP - (170 - 38) * 20];
const TITLE_TWIP = [Math.round((452.5 - 38) * 20), TABLE_TWIP - Math.round((452.5 - 38) * 20)];

const ROW_HEIGHT_TWIP = Math.round(15.36 * 20);
const HEADER_HEIGHT_TWIP = Math.round(20 * 20);

// Rows left empty at the foot of each table so a secretary has somewhere to
// type without having to insert a row first. Insert/Delete Row still works —
// that is the point of the exercise — these just save the common case a step.
const SPARE_ROWS = 4;

// The blank (un-prefilled) form keeps the template's twelve rows per table, so
// a printed copy looks like the one people already know.
const BLANK_FORM_ROWS = 12;

const INTRO = [
  'Please list your teams ranking players in order of strength. Only players who can '
    + 'fulfil rules 18 & 19 can be registered as permanent team members. Other players '
    + 'must be registered as reserves and nominated to a team that corresponds to their '
    + 'playing standard until they can fulfil the above rules.',
  'For junior team members, please indicate if they are under the age of 18 at the '
    + 'start of September.',
];

// ---------------------------------------------------------------------------
// Shared shaping (used by the PDF path too)
// ---------------------------------------------------------------------------

// "20262027" -> "2026-27", matching the template's existing header style
function seasonLabel(seasonName) {
  return `${seasonName.slice(0, 4)}-${seasonName.slice(6, 8)}`;
}

// Team names are "<Club> A" / "<Club> B" etc — the Team columns are narrow, so
// show just the distinguishing letter, matching the roster export's convention.
function teamLabel(teamName) {
  return String(teamName || '').trim().slice(-1);
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

// Splits a club roster into the two tables the form has.
//
// Reserves are rank >= 99, not rank == 99: they used to all be written flat at
// 99 so their order could never be saved, and are now numbered sequentially
// from it (see models/roster.js). An == 99 test would silently reclassify every
// reserve after the first as nominated.
function splitRoster(roster) {
  const nominated = roster.filter(r => !Roster.isReserve(r.rank));
  const reserves = roster.filter(r => Roster.isReserve(r.rank));
  return {
    nominatedRows: alignTeamRows(
      nominated,
      nominated.filter(r => r.gender === 'Female'),
      nominated.filter(r => r.gender === 'Male')
    ),
    reserveRows: alignTeamRows(
      reserves,
      reserves.filter(r => r.gender === 'Female'),
      reserves.filter(r => r.gender === 'Male')
    ),
  };
}

// ---------------------------------------------------------------------------
// Document construction
// ---------------------------------------------------------------------------

function pt(points) {
  return Math.round(points * 20); // twips
}

const NO_BORDERS = {
  top: { style: docx.BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: docx.BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: docx.BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: docx.BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideHorizontal: { style: docx.BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideVertical: { style: docx.BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

const GRID = { style: docx.BorderStyle.SINGLE, size: 6, color: '000000' };
const GRID_BORDERS = {
  top: GRID, bottom: GRID, left: GRID, right: GRID,
  insideHorizontal: GRID, insideVertical: GRID,
};

function para(text, opts) {
  const o = opts || {};
  return new docx.Paragraph({
    alignment: o.alignment,
    spacing: o.spacing || { before: 0, after: 0 },
    children: [new docx.TextRun({
      text: text == null ? '' : String(text),
      bold: o.bold,
      color: o.color,
      size: o.size,          // half-points
      font: 'Calibri',
    })],
  });
}

// One data cell. Names sit left, the Team letter and the U 18 flag are centred,
// matching the template's field alignment.
function dataCell(text, index) {
  return new docx.TableCell({
    width: { size: COL_TWIP[index], type: docx.WidthType.DXA },
    verticalAlign: docx.VerticalAlign.CENTER,
    children: [para(text, {
      size: 22,
      alignment: index === 0 || index === 3 ? docx.AlignmentType.LEFT : docx.AlignmentType.CENTER,
    })],
  });
}

function headerRow() {
  return new docx.TableRow({
    tableHeader: true, // repeat on every page the table spills onto
    cantSplit: true,
    height: { value: HEADER_HEIGHT_TWIP, rule: docx.HeightRule.ATLEAST },
    children: COL_HEADERS.map((title, i) => new docx.TableCell({
      width: { size: COL_TWIP[i], type: docx.WidthType.DXA },
      shading: { type: docx.ShadingType.CLEAR, fill: NAVY, color: 'auto' },
      verticalAlign: docx.VerticalAlign.CENTER,
      children: [para(title, {
        bold: true, color: 'FFFFFF', size: 24, alignment: docx.AlignmentType.CENTER,
      })],
    })),
  });
}

function dataRow(values) {
  return new docx.TableRow({
    cantSplit: true, // a one-line row that straddles a page break is just ugly
    height: { value: ROW_HEIGHT_TWIP, rule: docx.HeightRule.ATLEAST },
    children: values.map(dataCell),
  });
}

function playerValues(row) {
  const lady = row.lady;
  const man = row.man;
  return [
    lady ? lady.name : '',
    lady ? teamLabel(lady.teamName) : '',
    lady && lady.junior ? 'Y' : '',
    man ? man.name : '',
    man ? teamLabel(man.teamName) : '',
    man && man.junior ? 'Y' : '',
  ];
}

// No ROWS_PER_TABLE, no overflow branch, no continuation page: the table has as
// many rows as the club has players, and Word repeats the header itself.
function registrationTable(rows, spareRows) {
  const body = rows.map(r => dataRow(playerValues(r)));
  for (let i = 0; i < spareRows; i++) body.push(dataRow(['', '', '', '', '', '']));

  return new docx.Table({
    width: { size: TABLE_TWIP, type: docx.WidthType.DXA },
    columnWidths: COL_TWIP,
    layout: docx.TableLayoutType.FIXED,
    borders: GRID_BORDERS,
    margins: {
      top: pt(1), bottom: pt(1), left: pt(3), right: pt(3),
    },
    rows: [headerRow()].concat(body),
  });
}

function masthead() {
  // A missing asset degrades to a logo-less masthead rather than 500ing the
  // form; the integration test asserts the image really is in the package, so
  // losing it is caught at build time rather than by a captain.
  const logo = fs.existsSync(LOGO) ? fs.readFileSync(LOGO) : null;
  return new docx.Table({
    width: { size: TABLE_TWIP, type: docx.WidthType.DXA },
    columnWidths: MASTHEAD_TWIP,
    layout: docx.TableLayoutType.FIXED,
    borders: NO_BORDERS,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    rows: [new docx.TableRow({
      cantSplit: true,
      children: [
        new docx.TableCell({
          width: { size: MASTHEAD_TWIP[0], type: docx.WidthType.DXA },
          verticalAlign: docx.VerticalAlign.CENTER,
          children: [new docx.Paragraph({
            spacing: { before: 0, after: 0 },
            children: logo
              ? [new docx.ImageRun({ data: logo, transformation: LOGO_PX })]
              : [],
          })],
        }),
        new docx.TableCell({
          width: { size: MASTHEAD_TWIP[1], type: docx.WidthType.DXA },
          verticalAlign: docx.VerticalAlign.CENTER,
          children: [para('Stockport & District Badminton League', {
            bold: true, color: NAVY, size: 44,
          })],
        }),
      ],
    })],
  });
}

// The title line and the season stamp share a baseline on the template; two
// borderless cells reproduce that without relying on a tab stop surviving an
// edit. The season is the live one, so the document is never stamped with a
// year the league has moved on from.
function titleLine(label) {
  return new docx.Table({
    width: { size: TABLE_TWIP, type: docx.WidthType.DXA },
    columnWidths: TITLE_TWIP,
    layout: docx.TableLayoutType.FIXED,
    borders: NO_BORDERS,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    rows: [new docx.TableRow({
      cantSplit: true,
      children: [
        new docx.TableCell({
          width: { size: TITLE_TWIP[0], type: docx.WidthType.DXA },
          children: [para('Player and Team Registration Form', { bold: true, color: NAVY, size: 28 })],
        }),
        new docx.TableCell({
          width: { size: TITLE_TWIP[1], type: docx.WidthType.DXA },
          children: [para(label, { bold: true, color: NAVY, size: 28 })],
        }),
      ],
    })],
  });
}

function sectionHeading(text) {
  return para(text, {
    bold: true, color: NAVY, size: 28,
    spacing: { before: pt(22), after: pt(10) },
  });
}

/**
 * Build the registration form as a .docx buffer.
 *
 * @param {object}  opts
 * @param {string}  opts.label          season label, e.g. "2026-27"
 * @param {string} [opts.clubName]      club, when prefilled
 * @param {Array}  [opts.nominatedRows] {lady, man} pairs from alignTeamRows
 * @param {Array}  [opts.reserveRows]   likewise
 * @returns {Promise<Buffer>}
 */
async function buildTeamRegistrationDocx(opts) {
  const o = opts || {};
  const prefilled = !!o.clubName;
  const nominatedRows = o.nominatedRows || [];
  const reserveRows = o.reserveRows || [];
  const spare = prefilled ? SPARE_ROWS : BLANK_FORM_ROWS;

  const children = [
    masthead(),
    // Two tables with nothing between them merge into one in Word, so this
    // spacer is structural as well as cosmetic.
    para('', { size: 22, spacing: { before: 0, after: pt(6) } }),
    titleLine(o.label),
    para(INTRO[0], { size: 22, spacing: { before: pt(12), after: pt(10) } }),
    para(INTRO[1], { size: 22, spacing: { before: 0, after: 0 } }),
    sectionHeading('Team Registration'),
    registrationTable(nominatedRows, spare),
    sectionHeading('Reserves Registration'),
    registrationTable(reserveRows, spare),
    // Word wants somewhere to put the cursor after a trailing table.
    para('', { size: 22 }),
  ];

  const doc = new docx.Document({
    title: (prefilled ? o.clubName + ' ' : '') + 'Player and Team Registration Form ' + o.label,
    description: 'Stockport & District Badminton League player and team registration',
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22 } },
      },
    },
    sections: [{
      properties: {
        page: {
          size: {
            width: docx.convertMillimetersToTwip(210),
            height: docx.convertMillimetersToTwip(297),
          },
          margin: {
            // The template's own margins: the table spans x=38..555, and the
            // masthead starts ~52pt down.
            top: pt(52), bottom: pt(36), left: pt(38), right: pt(40),
          },
        },
      },
      children: children,
    }],
  });

  return docx.Packer.toBuffer(doc);
}

module.exports = {
  seasonLabel,
  teamLabel,
  alignTeamRows,
  splitRoster,
  buildTeamRegistrationDocx,
  LOGO,
  COL_HEADERS,
  NAVY,
};

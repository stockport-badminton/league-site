// Region-based scorecard data extraction.
// Accepts pre-transformed text blocks (from cornerDetection.analyseImage)
// and returns structured match data: metadata, players, and 18 score pairs.

// ── Scorecard template ────────────────────────────────────────────────────────

class ScorecardTemplate {
  constructor(imageWidth, imageHeight) {
    this.imageWidth  = imageWidth;
    this.imageHeight = imageHeight;
    this.anchors = {
      DATE:      { pattern: /DATE\s*/i,       searchArea: { yMin: 0, yMax: 0.3 } },
      DIVISION:  { pattern: /DIVISION\s*/i,   searchArea: { yMin: 0, yMax: 0.3 } },
      HOME:      { pattern: /^HOME$/i,        searchArea: { yMin: 0, yMax: 0.3 } },
      AWAY:      { pattern: /^AWAY$/i,        searchArea: { yMin: 0, yMax: 0.3 } },
      HOME_TEAM: { words: [/^HOME$/i, /^TEAM$/i], searchArea: { yMin: 0.15, yMax: 0.4 }, multiWord: true },
      AWAY_TEAM: { words: [/^AWAY$/i, /^TEAM$/i], searchArea: { yMin: 0.3,  yMax: 0.7 }, multiWord: true },
      COUPLES:   { pattern: /COUPLES/i,       searchArea: { yMin: 0.15, yMax: 0.4 } },
      POINTS:    { pattern: /POINTS/i,        searchArea: { yMin: 0.15, yMax: 0.4 } },
      WON_BY:    { words: [/^WON$/i, /^BY$/i],  searchArea: { yMin: 0.15, yMax: 0.4 }, multiWord: true },
      TOTALS:    { pattern: /TOTALS/i,        searchArea: { yMin: 0.4,  yMax: 1.0 } },
    };
  }

  _inArea(block, area) {
    if (!area) return true;
    const ny = block.centerY / this.imageHeight;
    const nx = block.centerX / this.imageWidth;
    return (area.yMin === undefined || ny >= area.yMin)
        && (area.yMax === undefined || ny <= area.yMax)
        && (area.xMin === undefined || nx >= area.xMin)
        && (area.xMax === undefined || nx <= area.xMax);
  }

  // A two-word printed label: the second word to the RIGHT of the first, on its line.
  //
  // Tolerances are in units of the first word's own height, not pixels. This used to
  // chain through a globally sorted list with `SPACING = 50, Y_TOL = 50` in pixels, and
  // on a high-resolution photo the gap between AWAY and TEAM is simply wider than 50 —
  // so the player block was never located and all six of that side's players came back
  // blank. Measured Sep 2026 over 59 filed cards: 14 of 118 sides lost that way, and
  // finding them all also moved score reading from 1553 to 1607 of 2124, because
  // WON BY is what places the points column.
  _multiWordAnchor(blocks, anchor) {
    const [first, second] = anchor.words;
    for (const a of blocks.filter(b => first.test(b.text))) {
      const h = Math.max(a.height, 1);
      const b = blocks
        .filter(c => c !== a && second.test(c.text)
          && Math.abs(c.centerY - a.centerY) < 0.7 * h
          && c.bounds[0].x - a.bounds[1].x > -0.5 * h
          && c.bounds[0].x - a.bounds[1].x < 3 * h)
        .sort((x, y) => x.bounds[0].x - y.bounds[0].x)[0];
      if (b) {
        return {
          text: `${a.text} ${b.text}`,
          bounds: { 0: a.bounds[0], 1: b.bounds[1], 2: b.bounds[2], 3: a.bounds[3] },
          centerX: (a.centerX + b.centerX) / 2,
          centerY: a.centerY,
          width: b.bounds[1].x - a.bounds[0].x,
          height: a.height,
        };
      }
    }
    return null;
  }

  findAnchors(textBlocks) {
    const found = {};
    for (const [name, anchor] of Object.entries(this.anchors)) {
      const cands = textBlocks.filter(b => this._inArea(b, anchor.searchArea));
      if (anchor.multiWord) {
        const m = this._multiWordAnchor(cands, anchor);
        if (m) found[name] = { ...m, anchorName: name };
      } else {
        const m = cands.find(b => anchor.pattern.test(b.text) && b.text.length <= 20);
        if (m) found[name] = { ...m, anchorName: name };
      }
    }
    return found;
  }

  defineRegions(anchors) {
    const { imageWidth: W, imageHeight: H } = this;
    const r = {};
    if (anchors.DATE && anchors.HOME) {
      r.header = { x: 0, y: anchors.DATE.bounds[0].y, width: W,
                   height: anchors.HOME.bounds[3].y - anchors.DATE.bounds[0].y + 50 };
    }
    if (anchors.HOME_TEAM && anchors.DATE && anchors.COUPLES) {
      r.homeTeam = {
        x: anchors.DATE.bounds[0].x,
        y: anchors.HOME_TEAM.centerY,
        width: anchors.COUPLES.bounds[0].x - anchors.DATE.bounds[0].x,
        height: (anchors.AWAY_TEAM ? anchors.AWAY_TEAM.centerY : H / 2) - anchors.HOME_TEAM.centerY,
      };
    }
    if (anchors.AWAY_TEAM && anchors.DATE && anchors.COUPLES) {
      r.awayTeam = {
        x: anchors.DATE.bounds[0].x - 50,
        y: anchors.AWAY_TEAM.centerY,
        width: anchors.COUPLES.bounds[0].x - anchors.DATE.bounds[0].x + 50,
        height: (anchors.TOTALS ? anchors.TOTALS.centerY : H * 0.85) - anchors.AWAY_TEAM.centerY,
      };
    }
    if (anchors.COUPLES && anchors.POINTS && anchors.WON_BY) {
      r.columns = {
        points: {
          x: anchors.COUPLES.bounds[1].x,
          width: ((anchors.WON_BY.bounds[0].x + anchors.POINTS.bounds[1].x) / 2) - anchors.COUPLES.bounds[1].x,
        },
      };
    }
    return r;
  }
}

// ── Region-based extractor ────────────────────────────────────────────────────

class RegionBasedExtractor {
  constructor(textBlocks, anchors, regions) {
    this.textBlocks = textBlocks;
    this.anchors    = anchors;
    this.regions    = regions;
  }

  _inRegion(block, region) {
    return block.centerX >= region.x && block.centerX <= region.x + region.width
        && block.centerY >= region.y && block.centerY <= region.y + region.height;
  }

  _isLabel(text) {
    return [/^LADIES$/i,/^GENTS$/i,/^GENTLEMEN$/i,/^MIXED$/i,
            /^1ST$/i,/^2ND$/i,/^3RD$/i,/HOME\s+TEAM/i,/AWAY\s+TEAM/i,
            /^TEAM$/i,/^AWAY$/i,/^HOME$/i].some(p => p.test(text));
  }

  extractPlayerRows(region) {
    const LINE_THRESHOLD = 30;
    const blocks = this.textBlocks.filter(b => this._inRegion(b, region) && !this._isLabel(b.text));
    const rows = [];
    [...blocks].sort((a, b) => a.centerY - b.centerY).forEach(block => {
      const row = rows.find(r => Math.abs(r.centerY - block.centerY) < LINE_THRESHOLD);
      if (row) { row.blocks.push(block); }
      else      { rows.push({ centerY: block.centerY, blocks: [block] }); }
    });
    rows.forEach(r => r.blocks.sort((a, b) => a.centerX - b.centerX));
    return rows;
  }

  // The six names in a team block, by SLOT: { ladies: [3], men: [3] }, null where a slot
  // is empty or unreadable. Returns null if the section labels cannot be found, and the
  // caller falls back to the flat list.
  //
  // A slot is placed by its position between the printed LADIES and GENTLEMEN labels,
  // which sit four rows apart. The flat list this replaces lost the position of every
  // name: an empty or unreadable row simply vanished, so everything below it moved up a
  // slot. It also grouped words into rows with a fixed 30-pixel tolerance, so on a
  // high-resolution photo a name written large split into "Kieran" and "Hesp", neither
  // of which matched anybody. Grouping words by slot fixes both at once.
  extractPlayerSlots(region) {
    const inR = this.textBlocks.filter(b => this._inRegion(b, region));
    const ladies = inR.find(b => /^LADIES$/i.test(b.text));
    const gents  = inR.find(b => /^(GENTLEMEN|GENTS)$/i.test(b.text));
    if (!ladies || !gents || gents.centerY <= ladies.centerY) return null;
    const pitch = (gents.centerY - ladies.centerY) / 4;

    const slots = { ladies: [[], [], []], men: [[], [], []] };
    for (const b of inR) {
      if (this._isLabel(b.text)) continue;
      const kl = Math.round((b.centerY - ladies.centerY) / pitch);
      const kg = Math.round((b.centerY - gents.centerY) / pitch);
      if (kg >= 1 && kg <= 3) slots.men[kg - 1].push(b);
      else if (kl >= 1 && kl <= 3) slots.ladies[kl - 1].push(b);
    }
    const name = bs => bs
      .sort((a, b) => Math.abs(a.centerY - b.centerY) < pitch / 3 ? a.centerX - b.centerX : a.centerY - b.centerY)
      .map(b => b.text).join(' ')
      .replace(/\d+/g, '')
      .trim() || null;
    return { ladies: slots.ladies.map(name), men: slots.men.map(name) };
  }

  parsePlayerRow(row) {
    const name = row.blocks
      .sort((a, b) => a.centerX - b.centerX)
      .map(b => b.text)
      .join(' ')
      .replace(/\d+/g, '')
      .trim();
    return { playerName: name, rawBlocks: row.blocks };
  }

  extractPointsPairs() {
    const pc = this.regions.columns?.points;
    if (!pc || !this.anchors.POINTS || !this.anchors.TOTALS) return [];

    const numericBlocks = this.textBlocks.filter(b => {
      const inCol   = b.centerX >= pc.x && b.centerX <= pc.x + pc.width + 50;
      const isNum   = /^\d+$/.test(b.text.trim());
      const inRange = b.bounds[2].y > this.anchors.POINTS.centerY
                   && b.bounds[0].y < this.anchors.TOTALS.centerY;
      return inCol && isNum && inRange;
    }).sort((a, b) => a.centerY - b.centerY);

    const ROW_THRESHOLD = 25;
    const rows = [];
    numericBlocks.forEach(block => {
      const row = rows.find(r => Math.abs(r.centerY - block.centerY) < ROW_THRESHOLD);
      if (row) { row.blocks.push(block); }
      else      { rows.push({ centerY: block.centerY, blocks: [block] }); }
    });

    return rows.sort((a, b) => a.centerY - b.centerY).map(row => {
      const mid = this.anchors.POINTS.centerX;
      const home = row.blocks.filter(b => b.bounds[0].x < mid);
      const away = row.blocks.filter(b => b.bounds[1].x > mid);
      return {
        homePoints: home.length ? home[0].text : null,
        awayPoints: away.length ? away[0].text : null,
      };
    });
  }

  extractMetadata() {
    if (!this.regions.header) return {};
    const Y_TOL = 40;
    const hblocks = this.textBlocks.filter(b => this._inRegion(b, this.regions.header));

    const between = (block, leftAnchor, rightAnchor) =>
      Math.abs(block.centerY - leftAnchor.centerY) < Y_TOL
      && block.centerX > leftAnchor.bounds[1].x
      && (!rightAnchor || block.centerX < rightAnchor.bounds[0].x)
      && block !== leftAnchor && block !== rightAnchor
      && block.text !== ':';

    const join = blocks => blocks.sort((a, b) => a.centerX - b.centerX).map(b => b.text).join(' ');

    // Vision often reads the printed "V AWAY" as ONE word, `VAWAY`, and sometimes takes the
    // team letter with it (`COLLEGE GREEN EVAWAY`). Then there is no AWAY anchor and both
    // teams came back empty, though both names had been read perfectly — 5 of 59 filed
    // cards, Sep 2026. Split the whole HOME line on it instead.
    if (this.anchors.HOME && !this.anchors.AWAY) {
      const line = join(hblocks.filter(b => between(b, this.anchors.HOME, null)));
      const m = line.match(/^(.*?)\s*V\s*AWAY\s*(.*)$/i);
      if (m) {
        return {
          date:     this.anchors.DATE     ? join(hblocks.filter(b => between(b, this.anchors.DATE, this.anchors.DIVISION))) : '',
          division: this.anchors.DIVISION ? join(hblocks.filter(b => between(b, this.anchors.DIVISION, null))) : '',
          homeTeam: m[1].trim(),
          awayTeam: m[2].trim(),
        };
      }
    }

    return {
      date:     this.anchors.DATE     ? join(hblocks.filter(b => between(b, this.anchors.DATE, this.anchors.DIVISION))) : '',
      division: this.anchors.DIVISION ? join(hblocks.filter(b => between(b, this.anchors.DIVISION, null))) : '',
      homeTeam: this.anchors.HOME && this.anchors.AWAY
                  ? join(hblocks.filter(b => between(b, this.anchors.HOME, this.anchors.AWAY) && b.text !== 'V')) : '',
      awayTeam: this.anchors.AWAY
                  ? join(hblocks.filter(b => between(b, this.anchors.AWAY, null))) : '',
    };
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

async function extractScorecardData({ textBlocks, imageWidth, imageHeight }) {
  const template = new ScorecardTemplate(imageWidth, imageHeight);
  const anchors  = template.findAnchors(textBlocks);
  const regions  = template.defineRegions(anchors);
  const ex       = new RegionBasedExtractor(textBlocks, anchors, regions);

  const metadata    = ex.extractMetadata();
  const homeRows    = regions.homeTeam ? ex.extractPlayerRows(regions.homeTeam) : [];
  const awayRows    = regions.awayTeam ? ex.extractPlayerRows(regions.awayTeam) : [];
  const pointsPairs = ex.extractPointsPairs();

  return {
    metadata,
    homePlayers: homeRows.map(r => ex.parsePlayerRow(r).playerName).filter(Boolean),
    awayPlayers: awayRows.map(r => ex.parsePlayerRow(r).playerName).filter(Boolean),
    // By slot where the section labels can be found; the flat lists above are the fallback.
    homeSlots: regions.homeTeam ? ex.extractPlayerSlots(regions.homeTeam) : null,
    awaySlots: regions.awayTeam ? ex.extractPlayerSlots(regions.awayTeam) : null,
    pointsPairs,
  };
}

module.exports = { extractScorecardData };

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
      HOME_TEAM: { pattern: /HOME\s+TEAM/i,   searchArea: { yMin: 0.15, yMax: 0.4 }, multiWord: true },
      AWAY_TEAM: { pattern: /AWAY\s+TEAM/i,   searchArea: { yMin: 0.3,  yMax: 0.7 }, multiWord: true },
      COUPLES:   { pattern: /COUPLES/i,       searchArea: { yMin: 0.15, yMax: 0.4 } },
      POINTS:    { pattern: /POINTS/i,        searchArea: { yMin: 0.15, yMax: 0.4 } },
      WON_BY:    { pattern: /WON\s+BY/i,     searchArea: { yMin: 0.15, yMax: 0.4 }, multiWord: true },
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

  _multiWordAnchor(blocks, anchor) {
    const SPACING = 50, Y_TOL = 50;
    const sorted = [...blocks].sort((a, b) =>
      Math.abs(a.centerY - b.centerY) < Y_TOL ? a.centerX - b.centerX : a.centerY - b.centerY
    );
    for (let i = 0; i < sorted.length; i++) {
      let text = sorted[i].text, parts = [sorted[i]], cur = sorted[i];
      for (let j = i + 1; j < sorted.length; j++) {
        const nxt = sorted[j];
        if (Math.abs(nxt.centerY - cur.centerY) < Y_TOL &&
            (nxt.bounds[0].x - cur.bounds[1].x) < SPACING) {
          text += ' ' + nxt.text;
          parts.push(nxt);
          cur = nxt;
          if (anchor.pattern.test(text)) {
            const f = parts[0], l = parts[parts.length - 1];
            return {
              text,
              bounds: { 0: f.bounds[0], 1: l.bounds[1], 2: l.bounds[2], 3: f.bounds[3] },
              centerX: (f.centerX + l.centerX) / 2,
              centerY: f.centerY,
              width: l.bounds[1].x - f.bounds[0].x,
              height: f.height,
            };
          }
        } else { break; }
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
    pointsPairs,
  };
}

module.exports = { extractScorecardData };

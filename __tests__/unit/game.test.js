const Game = require('../../models/game');

// gamesCount: 999 = "established" by default, so tests exercise the standard
// K=32 path unless a test explicitly opts a player into provisional K.
const makePlayers = (overrides = {}) => ({
  1: { rating: 1500, rank: 1, date: '2024-01-01', gamesCount: 999 },
  2: { rating: 1500, rank: 1, date: '2024-01-01', gamesCount: 999 },
  3: { rating: 1500, rank: 1, date: '2024-01-01', gamesCount: 999 },
  4: { rating: 1500, rank: 1, date: '2024-01-01', gamesCount: 999 },
  ...overrides,
});

const makeGame = (overrides = {}) => ({
  homePlayer1: 1, homePlayer2: 2,
  awayPlayer1: 3, awayPlayer2: 4,
  homeScore: 21, awayScore: 15,
  fixture: 999,
  ...overrides,
});

describe('Game.calculateRating', () => {
  describe('return shape', () => {
    it('returns updateObj and prevRatingDates', () => {
      const result = Game.calculateRating(makeGame(), makePlayers(), '2024-01-01', 1);
      expect(result).toHaveProperty('updateObj');
      expect(result).toHaveProperty('prevRatingDates');
    });

    it('updateObj has all eight player rating keys', () => {
      const { updateObj } = Game.calculateRating(makeGame(), makePlayers(), '2024-01-01', 1);
      expect(updateObj).toMatchObject({
        homePlayer1Start: expect.any(Number),
        homePlayer2Start: expect.any(Number),
        awayPlayer1Start: expect.any(Number),
        awayPlayer2Start: expect.any(Number),
        homePlayer1End: expect.any(Number),
        homePlayer2End: expect.any(Number),
        awayPlayer1End: expect.any(Number),
        awayPlayer2End: expect.any(Number),
      });
    });
  });

  describe('home win', () => {
    it('increases home ratings and decreases away ratings', () => {
      const { updateObj } = Game.calculateRating(makeGame(), makePlayers(), '2024-01-01', 1);
      expect(updateObj.homePlayer1End).toBeGreaterThan(1500);
      expect(updateObj.homePlayer2End).toBeGreaterThan(1500);
      expect(updateObj.awayPlayer1End).toBeLessThan(1500);
      expect(updateObj.awayPlayer2End).toBeLessThan(1500);
    });

    it('applies symmetric ±15 point swing for equal-rated players (K=32, scaled by margin 21-15)', () => {
      // margin 6/21 -> multiplier 0.85 + 0.30*(6/21) = 0.9357; effectiveK = 32*0.9357 = 29.94
      // E=0.5 for equal ratings -> round(29.94*0.5) = 15
      const { updateObj } = Game.calculateRating(makeGame(), makePlayers(), '2024-01-01', 1);
      expect(updateObj.homePlayer1End - 1500).toBe(15);
      expect(updateObj.awayPlayer1End - 1500).toBe(-15);
    });

    it('records correct start ratings', () => {
      const { updateObj } = Game.calculateRating(makeGame(), makePlayers(), '2024-01-01', 1);
      expect(updateObj.homePlayer1Start).toBe(1500);
      expect(updateObj.awayPlayer1Start).toBe(1500);
    });
  });

  describe('away win', () => {
    it('increases away ratings and decreases home ratings', () => {
      const game = makeGame({ homeScore: 15, awayScore: 21 });
      const { updateObj } = Game.calculateRating(game, makePlayers(), '2024-01-01', 1);
      expect(updateObj.awayPlayer1End).toBeGreaterThan(1500);
      expect(updateObj.homePlayer1End).toBeLessThan(1500);
    });

    it('applies symmetric ±15 point swing for equal-rated players (same margin, reversed)', () => {
      const game = makeGame({ homeScore: 15, awayScore: 21 });
      const { updateObj } = Game.calculateRating(game, makePlayers(), '2024-01-01', 1);
      expect(updateObj.awayPlayer1End - 1500).toBe(15);
      expect(updateObj.homePlayer1End - 1500).toBe(-15);
    });
  });

  describe('Elo expectation scaling', () => {
    it('strong team beating weak team earns fewer points than equal match', () => {
      // 1700 vs 1300: homeExpect ≈ 0.91 → effectiveK (margin 21-15) ≈ 29.94 → round(29.94*0.09) = 3
      const players = makePlayers({
        1: { rating: 1700, rank: 1, date: '2024-01-01' },
        2: { rating: 1700, rank: 1, date: '2024-01-01' },
        3: { rating: 1300, rank: 1, date: '2024-01-01' },
        4: { rating: 1300, rank: 1, date: '2024-01-01' },
      });
      const { updateObj } = Game.calculateRating(makeGame(), players, '2024-01-01', 1);
      const gain = updateObj.homePlayer1End - updateObj.homePlayer1Start;
      expect(gain).toBeGreaterThan(0);
      expect(gain).toBeLessThan(16);
    });

    it('weak team upsetting strong team earns more points than equal match', () => {
      // 1300 vs 1700: homeExpect ≈ 0.09 → effectiveK (margin 21-15) ≈ 29.94 → round(29.94*0.91) = 27
      const players = makePlayers({
        1: { rating: 1300, rank: 1, date: '2024-01-01' },
        2: { rating: 1300, rank: 1, date: '2024-01-01' },
        3: { rating: 1700, rank: 1, date: '2024-01-01' },
        4: { rating: 1700, rank: 1, date: '2024-01-01' },
      });
      const { updateObj } = Game.calculateRating(makeGame(), players, '2024-01-01', 1);
      const gain = updateObj.homePlayer1End - updateObj.homePlayer1Start;
      expect(gain).toBeGreaterThan(16);
      expect(gain).toBeLessThanOrEqual(32);
    });
  });

  describe('player id 0 (walkover / bye)', () => {
    it('returns unchanged ratings when any player id is 0', () => {
      const players = { ...makePlayers(), 0: { rating: 1500, date: '2024-01-01' } };
      const game = makeGame({ homePlayer1: 0 });
      const { updateObj } = Game.calculateRating(game, players, '2024-01-01', 1);
      expect(updateObj.homePlayer1End).toBe(updateObj.homePlayer1Start);
      expect(updateObj.awayPlayer1End).toBe(updateObj.awayPlayer1Start);
    });

    it('falls back to 1500 when player id 0 has no entry in fixturePlayers', () => {
      const game = makeGame({ homePlayer1: 0 });
      const { updateObj } = Game.calculateRating(game, makePlayers(), '2024-01-01', 1);
      expect(updateObj.homePlayer1Start).toBe(1500);
      expect(updateObj.homePlayer1End).toBe(1500);
    });
  });

  describe('division rank adjustment', () => {
    it('higher-division away players make home appear more favored, reducing their gain on a win', () => {
      // Away rank 2, division 1: (rank-div)*150 = +150 added to home adjusted start
      // → homePairStart 1650 vs awayPairStart 1500 → home more favored → gains less
      const players = makePlayers({
        3: { rating: 1500, rank: 2, date: '2024-01-01' },
        4: { rating: 1500, rank: 2, date: '2024-01-01' },
      });
      const { updateObj: adjusted } = Game.calculateRating(makeGame(), players, '2024-01-01', 1);
      const { updateObj: baseline } = Game.calculateRating(makeGame(), makePlayers(), '2024-01-01', 1);
      expect(adjusted.homePlayer1End - adjusted.homePlayer1Start)
        .toBeLessThan(baseline.homePlayer1End - baseline.homePlayer1Start);
    });
  });

  describe('partner rating-gap split', () => {
    it('weaker partner gains more and stronger partner gains less on a win, summing to the same pair total as an equal pair', () => {
      const mismatched = makePlayers({
        1: { rating: 1300, rank: 1, date: '2024-01-01', gamesCount: 999 }, // weaker home partner
        2: { rating: 1700, rank: 1, date: '2024-01-01', gamesCount: 999 }, // stronger home partner
      });
      const { updateObj } = Game.calculateRating(makeGame(), mismatched, '2024-01-01', 1);
      const weakGain = updateObj.homePlayer1End - updateObj.homePlayer1Start;
      const strongGain = updateObj.homePlayer2End - updateObj.homePlayer2Start;
      expect(weakGain).toBeGreaterThan(strongGain);

      // The pair's average (1500) matches the equal-rated baseline exactly, so the
      // pool being split should be identical — only its distribution differs.
      const { updateObj: baseline } = Game.calculateRating(makeGame(), makePlayers(), '2024-01-01', 1);
      const baselineTotal = (baseline.homePlayer1End - baseline.homePlayer1Start) + (baseline.homePlayer2End - baseline.homePlayer2Start);
      expect(weakGain + strongGain).toBe(baselineTotal);
    });

    it('equal-rated partners split (near) evenly', () => {
      const { updateObj } = Game.calculateRating(makeGame(), makePlayers(), '2024-01-01', 1);
      const p1Gain = updateObj.homePlayer1End - updateObj.homePlayer1Start;
      const p2Gain = updateObj.homePlayer2End - updateObj.homePlayer2Start;
      expect(Math.abs(p1Gain - p2Gain)).toBeLessThanOrEqual(1); // at most a 1-point rounding difference
    });
  });

  describe('zero-sum home/away split', () => {
    it('the away side\'s total change is always the exact negative of the home side\'s', () => {
      const cases = [
        makePlayers(),
        makePlayers({ 1: { rating: 1520, rank: 1, date: '2024-01-01', gamesCount: 999 } }),
        makePlayers({ 3: { rating: 1613, rank: 1, date: '2024-01-01', gamesCount: 999 } }),
      ];
      for (const players of cases) {
        const { updateObj } = Game.calculateRating(makeGame(), players, '2024-01-01', 1);
        const homeTotal = (updateObj.homePlayer1End - updateObj.homePlayer1Start) + (updateObj.homePlayer2End - updateObj.homePlayer2Start);
        const awayTotal = (updateObj.awayPlayer1End - updateObj.awayPlayer1Start) + (updateObj.awayPlayer2End - updateObj.awayPlayer2Start);
        expect(homeTotal).toBe(-awayTotal);
      }
    });
  });

  describe('provisional K-factor', () => {
    it('a newer player\'s game moves the pool further than an otherwise-identical established game', () => {
      const newer = makePlayers({ 1: { rating: 1500, rank: 1, date: '2024-01-01', gamesCount: 3 } });
      const established = makePlayers();
      const { updateObj: withNewer } = Game.calculateRating(makeGame(), newer, '2024-01-01', 1);
      const { updateObj: withEstablished } = Game.calculateRating(makeGame(), established, '2024-01-01', 1);
      const newerGain = withNewer.homePlayer1End - withNewer.homePlayer1Start;
      const establishedGain = withEstablished.homePlayer1End - withEstablished.homePlayer1Start;
      expect(newerGain).toBeGreaterThan(establishedGain);
    });
  });

  describe('margin of victory', () => {
    it('a blowout moves rating further than a narrow win, all else equal', () => {
      const players = makePlayers();
      const blowout = makeGame({ homeScore: 21, awayScore: 2 });
      const narrow = makeGame({ homeScore: 22, awayScore: 20 });
      const { updateObj: blowoutResult } = Game.calculateRating(blowout, players, '2024-01-01', 1);
      const { updateObj: narrowResult } = Game.calculateRating(narrow, players, '2024-01-01', 1);
      const blowoutGain = blowoutResult.homePlayer1End - blowoutResult.homePlayer1Start;
      const narrowGain = narrowResult.homePlayer1End - narrowResult.homePlayer1Start;
      expect(blowoutGain).toBeGreaterThan(narrowGain);
    });
  });
});

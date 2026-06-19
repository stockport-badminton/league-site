const Game = require('../../models/game');

const makePlayers = (overrides = {}) => ({
  1: { rating: 1500, rank: 1, date: '2024-01-01' },
  2: { rating: 1500, rank: 1, date: '2024-01-01' },
  3: { rating: 1500, rank: 1, date: '2024-01-01' },
  4: { rating: 1500, rank: 1, date: '2024-01-01' },
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

    it('applies symmetric ±16 point swing for equal-rated players (K=32)', () => {
      const { updateObj } = Game.calculateRating(makeGame(), makePlayers(), '2024-01-01', 1);
      expect(updateObj.homePlayer1End - 1500).toBe(16);
      expect(updateObj.awayPlayer1End - 1500).toBe(-16);
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

    it('applies symmetric ±16 point swing for equal-rated players', () => {
      const game = makeGame({ homeScore: 15, awayScore: 21 });
      const { updateObj } = Game.calculateRating(game, makePlayers(), '2024-01-01', 1);
      expect(updateObj.awayPlayer1End - 1500).toBe(16);
      expect(updateObj.homePlayer1End - 1500).toBe(-16);
    });
  });

  describe('Elo expectation scaling', () => {
    it('strong team beating weak team earns fewer points than equal match', () => {
      // 1700 vs 1300: homeExpect ≈ 0.91 → homeAdjust = round(32*0.09) = 3
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
      // 1300 vs 1700: homeExpect ≈ 0.09 → homeAdjust = round(32*0.91) = 29
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
      // Away rank 2, division 1: (rank-div)*500 = +500 added to home adjusted start
      // → homePairStart 2000 vs awayPairStart 1500 → home more favored → gains less
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
});

// The roster model's pure rules — what counts as a reserve, and how search matches are
// split by club.
//
// The rank arithmetic that used to live here (saveTeamOrder, movePlayer, releasePlayer,
// addToTeam, createPlayer) moved to __tests__/db/roster.test.js when the model went onto
// the typed query layer (REARCH-01). Those tests faked db_connect and decoded ranks out of
// the SQL, because when they were written there was no database to run them against.
// Every rule they pinned is kept there, asserted on the ranks actually stored.

const Roster = require('../../models/roster');

describe('isReserve', () => {
  it('treats 99 and above as a reserve', () => {
    expect(Roster.isReserve(99)).toBe(true);
    expect(Roster.isReserve(100)).toBe(true);
    expect(Roster.isReserve(101)).toBe(true);
  });

  it('treats a nominated rank as not a reserve', () => {
    expect(Roster.isReserve(1)).toBe(false);
    expect(Roster.isReserve(98)).toBe(false);
  });

  // 24 players in production have a NULL rank. Treating them as nominated means
  // the next save gives them a real number instead of stranding them.
  it('treats a missing rank as nominated', () => {
    expect(Roster.isReserve(null)).toBe(false);
    expect(Roster.isReserve(undefined)).toBe(false);
  });

  it('accepts a numeric string, as the DB driver may return', () => {
    expect(Roster.isReserve('99')).toBe(true);
    expect(Roster.isReserve('2')).toBe(false);
  });
});

describe('findCandidates', () => {
  const table = () => [
    { playerId: 1, name: 'Marry Whitle', gender: 'Female', clubName: 'Dome', clubId: 57, teamName: 'Dome B' },
    { playerId: 2, name: 'Mary Whitle', gender: 'Female', clubName: 'No Club', clubId: Roster.NO_CLUB_ID, teamName: 'No Team' },
    { playerId: 3, name: 'Mary Whittle', gender: 'Female', clubName: 'Shell', clubId: 40, teamName: 'Shell A' },
    { playerId: 4, name: 'Andy Bates', gender: 'Male', clubName: 'Mellor', clubId: 9, teamName: 'Mellor A' },
  ];

  // The split is pure: findCandidates is allForMatching (a read, tested in db/) handed to
  // this. Matching a misspelling end to end is in __tests__/db/roster.test.js.
  it('splits the matches by where the player is now, including this club', () => {
    const found = Roster.splitCandidates(table(), 'Mary Whitle', 'Shell');
    expect(found.unattached.map(p => p.playerId)).toEqual([2]);
    expect(found.otherClubs.map(p => p.playerId)).toEqual([1]);
    expect(found.ownClub.map(p => p.playerId)).toEqual([3]);
  });

  it('counts a player whose club resolves to nothing as unattached', () => {
    const found = Roster.splitCandidates(
      [{ playerId: 5, name: 'Ben Holcome', gender: 'Male', clubName: null, clubId: null, teamName: null }],
      'Ben Holcome', 'Shell');
    expect(found.unattached.map(p => p.playerId)).toEqual([5]);
  });
});

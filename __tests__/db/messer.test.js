// The Messer knockout's model functions against a real Postgres (REARCH-01): filing and
// approving a scorecard, and the draw — its wiring, the home/away swap, and advancing a
// winner. The swap and the wiring save were tested by reading SQL out of a mocked
// db_connect (messer-swap-model.test.js, messer-bracket-save-model.test.js); the rules
// they pinned are asserted here on the draw itself. Written and passed against the string
// queries first, then run unchanged against the typed ones.
//
// Filing could not be tested against a migrations-built database at all until migration
// 027 restored messer_scorecard."scoresheet-url", which the submit handler writes.
const db = require('../../db_connect');
const Fixture = require('../../models/fixture');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);
const NO_TEAM = 52;
let T;  // four real team ids

// A scratch section 'Z': slots 1 and 2 feed slot 3 — 1's winner to its home side, 2's to
// its away side. Slot 3 starts with two teams already in it.
beforeEach(async () => {
  T = (await run('SELECT id FROM team WHERE id <> 52 ORDER BY id LIMIT 4')).map(r => r.id);
  // The seed has a card awaiting approval between two of these teams, which would
  // (rightly) block a swap. Each test makes its own.
  await run(`DELETE FROM messer_scorecard WHERE status IN ('draft', 'submitted')`);
  await run(`INSERT INTO messer (id, section, "drawPos", round, "nextDrawPos", "nextSlot", "homeTeam", "awayTeam") VALUES
    (9001, 'Z', 1, 1, 3, 'H', ${T[0]}, ${T[1]}),
    (9002, 'Z', 2, 1, 3, 'A', ${T[2]}, ${T[3]}),
    (9003, 'Z', 3, 2, NULL, NULL, ${T[0]}, ${T[2]})`);
});
const draw = async () => (await run(`SELECT id, "homeTeam", "awayTeam", round, "nextDrawPos", "nextSlot", "homeScore"
  FROM messer WHERE section = 'Z' ORDER BY "drawPos"`)).map(r => ({ ...r }));

// Every NOT NULL column without a default set to zero, then `extra`.
async function zeroRow(table, extra) {
  const cols = await run(`SELECT column_name FROM information_schema.columns
    WHERE table_name = ? AND is_nullable = 'NO' AND column_default IS NULL`, [table]);
  return Object.assign(Object.fromEntries(cols.map(c => [c.column_name, 0])), extra);
}

describe('filing and approving a Messer scorecard', () => {
  it('createMesserScorecard stores the card with its photo and returns the new id', async () => {
    const card = await zeroRow('messer_scorecard', { homeTeam: T[0], awayTeam: T[1], date: '2027-01-20',
      email: 'messer@example.invalid', status: 'submitted', 'scoresheet-url': 'scorecards/messer.jpg' });
    const result = await Fixture.createMesserScorecard(card);
    expect(result).toHaveLength(1);
    const [row] = await Fixture.getMesserScorecardById(result[0].id);
    expect(row).toMatchObject({ id: result[0].id, status: 'submitted', 'scoresheet-url': 'scorecards/messer.jpg' });
    expect(row.homeMan1Name).toBe(' ');   // CONCAT of an empty slot, as the page has always had
    expect((await Fixture.listMesserScorecardsForApproval()).map(r => r.id)).toContain(result[0].id);
  });

  it('updateMesserScorecardStatus moves the card on and stamps it', async () => {
    const [{ id }] = await Fixture.createMesserScorecard(await zeroRow('messer_scorecard',
      { homeTeam: T[0], awayTeam: T[1], date: '2027-01-20', status: 'submitted' }));
    await run(`UPDATE messer_scorecard SET updated_at = now() - interval '1 day' WHERE id = ?`, [id]);
    await Fixture.updateMesserScorecardStatus(id, 'approved');
    const [row] = await run('SELECT status, updated_at > now() - interval \'1 minute\' AS fresh FROM messer_scorecard WHERE id = ?', [id]);
    expect(row).toEqual({ status: 'approved', fresh: true });
    expect((await Fixture.listMesserScorecardsForApproval()).map(r => r.id)).not.toContain(id);
  });

  it('createMesserResult returns the id, and updateMesserTable records the score in the draw', async () => {
    const result = await Fixture.createMesserResult(await zeroRow('messer_result', { homeTeam: T[0], awayTeam: T[1] }));
    expect(Number.isInteger(result[0].id)).toBe(true);
    await Fixture.updateMesserTable(9001, { homeScore: 9, awayScore: 6, winningTeam: T[0] });
    expect((await run('SELECT "homeScore", "awayScore", "winningTeam" FROM messer WHERE id = 9001'))[0])
      .toEqual({ homeScore: 9, awayScore: 6, winningTeam: T[0] });
  });
});

describe('the draw', () => {
  it('getMesserBracket lists a section in draw order with the team names', async () => {
    const bracket = await Fixture.getMesserBracket('Z');
    expect(bracket.map(r => r.drawPos)).toEqual([1, 2, 3]);
    expect(bracket[0]).toMatchObject({ id: 9001, nextDrawPos: 3, nextSlot: 'H', homeTeam: T[0] });
    expect(typeof bracket[0].homeTeamName).toBe('string');
  });

  it('findMesserMatch finds a match either way round, and says which', async () => {
    expect(await Fixture.findMesserMatch(T[0], T[1])).toMatchObject({ id: 9001, section: 'Z', drawPos: 1, reversed: false });
    expect(await Fixture.findMesserMatch(T[1], T[0])).toMatchObject({ id: 9001, reversed: true });
    expect((await Fixture.findMesserMatch(T[0], T[1])).exact).toBeUndefined();
    expect(await Fixture.findMesserMatch(T[3], T[0])).toBeNull();
  });
});

describe('saveMesserBracketLinks — the wiring page', () => {
  const link = (id, now, was) => ({ id, ...now, was });
  const W = (round, nextDrawPos, nextSlot) => ({ round, nextDrawPos, nextSlot });

  it('writes nothing when nothing changed', async () => {
    expect(await Fixture.saveMesserBracketLinks([link(9001, W(1, 3, 'H'), W(1, 3, 'H'))])).toEqual({ saved: 0, conflicts: [] });
  });

  it('writes the rows that changed, when each still holds what the page showed', async () => {
    expect(await Fixture.saveMesserBracketLinks([
      link(9001, W(1, 3, 'A'), W(1, 3, 'H')), link(9002, W(1, 3, 'H'), W(1, 3, 'A')), link(9003, W(2, null, null), W(2, null, null)),
    ])).toEqual({ saved: 2, conflicts: [] });
    expect((await draw()).map(r => r.nextSlot)).toEqual(['A', 'H', null]);
  });

  // B-30: a page opened before a swap put the old sides back when saved.
  it('rolls the whole save back if any row moved on underneath the page, naming it', async () => {
    await run(`UPDATE messer SET "nextSlot" = 'H' WHERE id = 9002`);   // a swap, after the page loaded
    expect(await Fixture.saveMesserBracketLinks([
      link(9001, W(1, 3, 'A'), W(1, 3, 'H')),   // still as the page showed it
      link(9002, W(2, 3, 'A'), W(1, 3, 'A')),   // the page still thinks this is 'A'
    ])).toEqual({ saved: 0, conflicts: [2] });
    expect((await draw()).map(r => r.nextSlot)).toEqual(['H', 'H', null]);
  });
});

describe('swapMesserHomeAway', () => {
  it('swaps the teams and flips the sides of the matches feeding the slot, together', async () => {
    expect(await Fixture.swapMesserHomeAway('Z', 9003)).toEqual({ id: 9003, drawPos: 3, feedersFlipped: 2 });
    const [s1, s2, s3] = await draw();
    expect([s3.homeTeam, s3.awayTeam]).toEqual([T[2], T[0]]);
    expect([s1.nextSlot, s2.nextSlot]).toEqual(['A', 'H']);
  });

  it('refuses, writing nothing: no such slot here, no teams yet, already played, a card pending this way round', async () => {
    const before = await draw();
    await expect(Fixture.swapMesserHomeAway('A', 9003)).rejects.toMatchObject({ status: 404, code: 'missing' });

    await run(`UPDATE messer SET "homeTeam" = ${NO_TEAM}, "awayTeam" = ${NO_TEAM} WHERE id = 9002`);
    await expect(Fixture.swapMesserHomeAway('Z', 9002)).rejects.toMatchObject({ status: 409, code: 'empty' });

    await run(`UPDATE messer SET "homeScore" = 9, "awayScore" = 6 WHERE id = 9001`);
    await expect(Fixture.swapMesserHomeAway('Z', 9001)).rejects.toMatchObject({ status: 409, code: 'played' });

    await Fixture.createMesserScorecard(await zeroRow('messer_scorecard', { homeTeam: T[0], awayTeam: T[2], date: '2027-01-20', status: 'submitted' }));
    await expect(Fixture.swapMesserHomeAway('Z', 9003)).rejects.toMatchObject({ status: 409, code: 'pending' });
    const after = await draw();
    expect(after.map(r => r.nextSlot)).toEqual(before.map(r => r.nextSlot));
    expect([after[2].homeTeam, after[2].awayTeam]).toEqual([T[0], T[2]]);
  });

  // Approval finds the match by exact orientation; a card filed the other way round is
  // what the swap is for.
  it('allows a swap when the pending card was filed the other way round', async () => {
    await Fixture.createMesserScorecard(await zeroRow('messer_scorecard', { homeTeam: T[2], awayTeam: T[0], date: '2027-01-20', status: 'submitted' }));
    expect(await Fixture.swapMesserHomeAway('Z', 9003)).toMatchObject({ feedersFlipped: 2 });
  });
});

describe('advanceMesserWinner', () => {
  it('puts the winner into the side of the next match its slot is wired to', async () => {
    const [m] = await run(`SELECT section, "nextDrawPos", "nextSlot" FROM messer WHERE id = 9002`);
    expect(await Fixture.advanceMesserWinner(m, T[3])).toEqual({ advanced: true, targetId: 9003, slot: 'A' });
    expect((await draw())[2].awayTeam).toBe(T[3]);
  });

  it('does nothing for a final, a missing target, or a next match already played', async () => {
    expect(await Fixture.advanceMesserWinner({ section: 'Z', nextDrawPos: null, nextSlot: null }, T[0]))
      .toEqual({ advanced: false, reason: 'no-next-slot' });
    expect(await Fixture.advanceMesserWinner({ section: 'Z', nextDrawPos: 99, nextSlot: 'H' }, T[0]))
      .toEqual({ advanced: false, reason: 'target-missing' });
    await run(`UPDATE messer SET "homeScore" = 9 WHERE id = 9003`);
    expect(await Fixture.advanceMesserWinner({ section: 'Z', nextDrawPos: 3, nextSlot: 'H' }, T[3]))
      .toEqual({ advanced: false, reason: 'target-already-played', targetId: 9003 });
    expect((await draw())[2].homeTeam).toBe(T[0]);
  });
});

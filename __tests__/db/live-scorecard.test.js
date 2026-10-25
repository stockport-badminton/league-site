// models/liveScorecard.js against a real Postgres (REARCH-01).
//
// Every write here is one conditional UPDATE, and the conditions are the design: an edit
// bumps `version` and clears both signatures, a signature only lands on the version it
// was given for, a card that is filing or filed refuses edits. The integration test
// replaces this model with an in-memory imitation of those rules, so until this file the
// SQL that enforces them had never run under test. Written and passed against the string
// queries first, then run unchanged against the typed ones.
const db = require('../../db_connect');
const Live = require('../../models/liveScorecard');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);

const FIXTURE = 302;
const start = (fixtureId = FIXTURE) => Live.create({
  fixtureId, tokens: { edit: 'e-tok', home: 'h-tok', away: 'a-tok' }, createdBy: 'Captain A', createdEmail: null,
});
const signBoth = async card => {
  await Live.sign(card.id, 'home', 'Home Captain', card.version);
  return Live.sign(card.id, 'away', 'Away Captain', card.version);
};

describe('liveScorecard', () => {
  it('create makes one card per fixture; the second caller gets null and reads the first', async () => {
    const card = await start();
    expect(card).toMatchObject({ fixture_id: FIXTURE, status: 'live', version: 1, rev: 1, players: {}, games: {},
      edit_token: 'e-tok', created_by: 'Captain A', created_email: null, draft_id: null });
    expect(await start()).toBeNull();
    expect((await Live.getByFixture(FIXTURE)).id).toBe(card.id);
    expect([...await Live.getForFixtures([FIXTURE, 999999])]).toEqual([
      { id: card.id, fixture_id: FIXTURE, status: 'live', created_by: 'Captain A' }]);
  });

  it('setPlayer fills and empties a slot, bumps version and rev, and clears both signatures', async () => {
    let card = await start();
    card = await Live.sign(card.id, 'home', 'Home Captain', card.version);
    expect(card.home_signed_by).toBe('Home Captain');

    card = await Live.setPlayer(card.id, 'homeMan1', 42);
    expect(card).toMatchObject({ players: { homeMan1: 42 }, version: 2, rev: 3, home_signed_by: null, home_signed_at: null });
    card = await Live.setPlayer(card.id, 'awayLady3', 7);
    expect(card.players).toEqual({ homeMan1: 42, awayLady3: 7 });
    card = await Live.setPlayer(card.id, 'homeMan1', null);
    expect(card).toMatchObject({ players: { awayLady3: 7 }, version: 4 });

    await expect(Live.setPlayer(card.id, 'homeMan1; DROP', 1)).rejects.toThrow('unknown slot');
  });

  it('setGame records a score with who and when, and clears it', async () => {
    let card = await start();
    card = await Live.setGame(card.id, 4, { h: 21, a: 15, by: 'Captain A' });
    expect(card.games['4']).toMatchObject({ h: 21, a: 15, by: 'Captain A' });
    expect(Date.parse(card.games['4'].at)).not.toBeNaN();
    card = await Live.setGame(card.id, 4, null);
    expect(card.games).toEqual({});
    expect(card.version).toBe(3);
  });

  it('a signature lands only on the version it was given for, and bumps rev but not version', async () => {
    const card = await start();
    const edited = await Live.setGame(card.id, 1, { h: 21, a: 3 });
    expect(await Live.sign(card.id, 'home', 'Home Captain', card.version)).toBeNull();
    const signed = await Live.sign(card.id, 'home', 'Home Captain', edited.version);
    expect(signed).toMatchObject({ version: edited.version, rev: edited.rev + 1, home_signed_by: 'Home Captain' });
    expect(signed.home_signed_at).toBeInstanceOf(Date);
    await expect(Live.sign(card.id, 'middle', 'x', 0)).rejects.toThrow('unknown side');
  });

  it('only a card signed by both can be claimed, only once, and then refuses edits', async () => {
    const card = await start();
    await Live.sign(card.id, 'home', 'Home Captain', card.version);
    expect(await Live.claimForFiling(card.id)).toBeNull();

    await signBoth(card);
    expect(await Live.claimForFiling(card.id)).toMatchObject({ status: 'filing' });
    expect(await Live.claimForFiling(card.id)).toBeNull();
    expect(await Live.setGame(card.id, 1, { h: 21, a: 0 })).toBeNull();
    expect(await Live.setPlayer(card.id, 'homeMan1', 1)).toBeNull();
  });

  it('markFiled closes a claimed card with its draft; releaseClaim puts an unfiled one back', async () => {
    const card = await start();
    await signBoth(card);
    expect(await Live.markFiled(card.id, 1234)).toBeNull();

    await Live.claimForFiling(card.id);
    await Live.releaseClaim(card.id);
    expect((await Live.getById(card.id)).status).toBe('live');

    await Live.claimForFiling(card.id);
    expect(await Live.markFiled(card.id, 1234)).toMatchObject({ status: 'filed', draft_id: 1234 });
    await Live.releaseClaim(card.id);
    expect((await Live.getById(card.id)).status).toBe('filed');
  });

  it('getContext names the fixture, and falls back when a team is missing', async () => {
    const ctx = await Live.getContext(FIXTURE);
    expect(ctx).toMatchObject({ fixtureId: FIXTURE, dateText: expect.stringMatching(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/) });
    expect(typeof ctx.homeTeamName).toBe('string');
    expect(await Live.getContext(999999)).toBeNull();

    await run('ALTER TABLE fixture DISABLE TRIGGER ALL');
    await run('UPDATE fixture SET "homeTeam" = 999999 WHERE id = ?', [FIXTURE]);
    await run('ALTER TABLE fixture ENABLE TRIGGER ALL');
    expect(await Live.getContext(FIXTURE)).toMatchObject({ homeTeamName: 'Home', divisionName: '' });
  });
});

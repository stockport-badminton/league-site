// Whether a published result goes out as an Instagram story and a Facebook Page story too.
//
// SOCIAL_POST_STORY and SOCIAL_POST_FB_STORY are off unless set, because a story goes out on
// every result a captain publishes. When on, each story is its own target — its own queue
// row (HARD-47), so a story that fails beside a feed post that worked is reported as
// exactly that — and uses the 9:16 card (`resultPostContent().storyImageUrl`, asserted in
// result-post-direct.test.js).

jest.mock('../../utils/metaPublisher', () => ({
  targets: jest.fn(),
  pageStoryTarget: jest.requireActual('../../utils/metaPublisher').pageStoryTarget,
  publishEverywhere: jest.fn(),
}));
jest.mock('../../models/socialResultPost', () => ({ enqueue: jest.fn().mockResolvedValue([]) }));

const meta = require('../../utils/metaPublisher');
const SocialResultPost = require('../../models/socialResultPost');
const Fixture = require('../../models/fixture');

const RESULT = { fixtureId: 7300, homeTeam: 'Tatton A', awayTeam: 'Mellor B', homeScore: 11, awayScore: 7, division: 'Division 3' };
const PAGE = { id: '101950371354925', token: 'page-token' };
const IG = { id: '17841409056774880', token: 'page-token' };

const queuedKinds = () => SocialResultPost.enqueue.mock.calls[0][1];

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SOCIAL_POST_DIRECT = 'true';
  meta.targets.mockReturnValue({ stockportPage: PAGE, instagram: IG, tamesidePage: null });
});
afterEach(() => {
  delete process.env.SOCIAL_POST_DIRECT;
  delete process.env.SOCIAL_POST_STORY;
  delete process.env.SOCIAL_POST_FB_STORY;
});

it('queues no story unless a story flag is set', async () => {
  await Fixture.sendResultZap({ ...RESULT });
  expect(queuedKinds()).toEqual(['page', 'instagram']);
});

it('queues the Instagram story as its own target on SOCIAL_POST_STORY', async () => {
  process.env.SOCIAL_POST_STORY = 'true';
  await Fixture.sendResultZap({ ...RESULT });
  expect(queuedKinds()).toEqual(['page', 'instagram', 'instagram-story']);

  // Posted with the Instagram account's own credentials.
  const story = Fixture.resultTargets().find(t => t.kind === 'instagram-story');
  expect(story).toMatchObject({ name: 'Instagram story', id: IG.id, token: IG.token });
});

it('queues no Instagram story when there is no Instagram account, whatever the flag says', async () => {
  process.env.SOCIAL_POST_STORY = 'true';
  meta.targets.mockReturnValue({ stockportPage: PAGE, instagram: null, tamesidePage: null });
  await Fixture.sendResultZap({ ...RESULT });
  expect(queuedKinds()).toEqual(['page']);
});

it('queues a Facebook page story on SOCIAL_POST_FB_STORY, on its own', async () => {
  process.env.SOCIAL_POST_FB_STORY = 'true';
  await Fixture.sendResultZap({ ...RESULT });
  expect(queuedKinds()).toEqual(['page', 'instagram', 'page-story']);

  const story = Fixture.resultTargets().find(t => t.kind === 'page-story');
  expect(story).toMatchObject({ name: 'Stockport page story', id: PAGE.id, token: PAGE.token });
});

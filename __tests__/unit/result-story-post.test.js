// Whether a published result goes out as an Instagram story too, and what it hands Meta.
//
// SOCIAL_POST_STORY is off unless set, because a story goes out on every result a captain
// publishes. When on, the story is a third target beside the page and the feed post, and
// gets its own 9:16 URL.

jest.mock('../../utils/metaPublisher', () => ({
  targets: jest.fn(),
  publishEverywhere: jest.fn(),
}));

const meta = require('../../utils/metaPublisher');
const Fixture = require('../../models/fixture');

const RESULT = { homeTeam: 'Tatton A', awayTeam: 'Mellor B', homeScore: 11, awayScore: 7, division: 'Division 3' };
const PAGE = { id: '101950371354925', token: 'page-token' };
const IG = { id: '17841409056774880', token: 'page-token' };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SOCIAL_POST_DIRECT = 'true';
  meta.targets.mockReturnValue({ stockportPage: PAGE, instagram: IG, tamesidePage: null });
  meta.publishEverywhere.mockResolvedValue({ posted: [{ target: 'x' }], failed: [], ok: true });
});
afterEach(() => {
  delete process.env.SOCIAL_POST_DIRECT;
  delete process.env.SOCIAL_POST_STORY;
});

it('posts no story unless SOCIAL_POST_STORY is set', async () => {
  await Fixture.sendResultZap({ ...RESULT });
  const [targets, payload] = meta.publishEverywhere.mock.calls[0];
  expect(targets.map(t => t.kind)).toEqual(['page', 'instagram']);
  expect(payload.storyImageUrl).toBeUndefined();
});

it('adds the story as its own target, with the 9:16 url, when it is', async () => {
  process.env.SOCIAL_POST_STORY = 'true';
  await Fixture.sendResultZap({ ...RESULT });
  const [targets, payload] = meta.publishEverywhere.mock.calls[0];

  expect(targets.map(t => [t.name, t.kind])).toEqual([
    ['Stockport page', 'page'], ['Instagram', 'instagram'], ['Instagram story', 'instagram-story'],
  ]);
  expect(targets[2]).toMatchObject({ id: IG.id, token: IG.token });
  expect(payload.storyImageUrl).toBe(
    'https://stockport-badminton.co.uk/resultImage/Tatton%20A/Mellor%20B/11/7/Division%203/story.jpg');
  // The feed post is untouched.
  expect(payload.imageUrls).toBe(
    'https://stockport-badminton.co.uk/resultImage/Tatton%20A/Mellor%20B/11/7/Division%203.jpg');
});

it('posts no story when there is no Instagram account, whatever the flag says', async () => {
  process.env.SOCIAL_POST_STORY = 'true';
  meta.targets.mockReturnValue({ stockportPage: PAGE, instagram: null, tamesidePage: null });
  await Fixture.sendResultZap({ ...RESULT });
  expect(meta.publishEverywhere.mock.calls[0][0].map(t => t.kind)).toEqual(['page']);
});

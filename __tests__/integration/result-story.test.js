// The result as an Instagram story: the 9:16 card, its route, and posting it.
//
// Instagram draws its own interface over a story, so on this card "renders a JPEG" proves
// very little. The feed layout at 1920 rendered perfectly and put the away team, half the
// score and the site address under the reply box. What these assert is where things are.

process.env.NODE_ENV = 'test';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const request = require('supertest');
const app = require('../../app');
const social = require('../../controllers/socialController');
const { subjectFor, subjectLayer } = require('../../utils/socialCard');
const { resultImagePath, resultStoryImagePath } = require('../../utils/canonical');

const { STORY, STORY_SAFE } = social;
const DIVISIONS = ['Premier', 'Division 1', 'Division 2', 'Division 3'];
const RESULT = { homeTeam: 'Tatton A', awayTeam: 'Mellor B', homeScore: 11, awayScore: 7, division: 'Division 3' };

describe('the story url', () => {
  it('is the result card url with /story.jpg in place of .jpg, every segment encoded', () => {
    expect(resultStoryImagePath(RESULT))
      .toBe('/resultImage/Tatton%20A/Mellor%20B/11/7/Division%203/story.jpg');
    expect(resultImagePath(RESULT)).toBe('/resultImage/Tatton%20A/Mellor%20B/11/7/Division%203.jpg');
  });
});

describe('the story route', () => {
  it('serves a 1080x1920 JPEG, and the feed route still serves 1080x1350', async () => {
    const story = await request(app).get(resultStoryImagePath(RESULT));
    expect(story.status).toBe(200);
    expect(story.headers['content-type']).toMatch(/image\/jpeg/);
    const s = await sharp(story.body).metadata();
    expect([s.format, s.width, s.height]).toEqual(['jpeg', 1080, 1920]);

    const feed = await request(app).get(resultImagePath(RESULT));
    const f = await sharp(feed.body).metadata();
    expect([f.width, f.height]).toEqual([1080, 1350]);
  });

  // The handler used to write both sizes to the container's disk on every request, for a
  // Make.com scenario that no longer exists. Nothing read them.
  it('writes nothing to disk', async () => {
    const team = 'Diskcheck ' + Date.now();
    await request(app).get(resultImagePath({ ...RESULT, homeTeam: team }));
    const dir = path.join(__dirname, '../../static/beta/images/generated');
    const left = fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => n.startsWith('Diskcheck')) : [];
    expect(left).toEqual([]);
  });
});

describe('the story layout keeps clear of Instagram\'s overlays', () => {
  it('ends the panel, and so all the text, above the reply box', () => {
    expect(Math.round(STORY.H * STORY.layout.panelBottom)).toBeLessThanOrEqual(STORY_SAFE.bottom);
    expect(Math.round(STORY.H * STORY.layout.panelTop)).toBeGreaterThanOrEqual(STORY_SAFE.top);
  });

  // The player is the other thing worth seeing, and the one that moves per division:
  // Division 1's is a pair, and a wide subject is lifted to fill the space.
  it.each(DIVISIONS)('keeps the player below the profile bar: %s', async division => {
    const subject = await subjectFor(division);
    const layer = await subjectLayer(subject, { W: STORY.W, H: STORY.H, ...STORY.subject });
    expect(layer.top).toBeGreaterThanOrEqual(STORY_SAFE.top);
  });
});

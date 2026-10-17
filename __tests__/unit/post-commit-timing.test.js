// HARD-47 step 1: what the publish request waits on, one `[timing]` line per step.
// Publishing a result took 16-51 s against Firebase Hosting's 60 s cut, and the request
// log could only say the total. These lines are how the split gets measured.
jest.mock('axios');
const axios = require('axios');
jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

const { afterCommit } = require('../../utils/afterCommit');
const meta = require('../../utils/metaPublisher');

let log;
beforeEach(() => {
  jest.clearAllMocks();
  log = jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const timingLines = () => log.mock.calls.map(c => c.join(' ')).filter(l => l.startsWith('[timing]'));

describe('afterCommit', () => {
  it('logs how long a step took, labelled with its stage', async () => {
    await afterCommit('result zap', async () => 'done', { stage: 'scorecard-post-commit' });
    expect(timingLines()).toEqual([expect.stringMatching(/^\[timing\] scorecard-post-commit: result zap \d+ms ok$/)]);
  });

  it('times a failed step too, and says it failed', async () => {
    await afterCommit('results email', async () => { throw new Error('SES is down'); });
    expect(timingLines()).toEqual([expect.stringMatching(/^\[timing\] post-commit: results email \d+ms failed$/)]);
  });
});

describe('publishEverywhere', () => {
  it('logs each target separately, with its outcome', async () => {
    let n = 0;
    axios.post.mockImplementation(async (url) => {
      if (String(url).includes('/media_publish')) throw new Error('Meta said no');
      return { data: { id: `id-${++n}` } };
    });
    axios.get.mockResolvedValue({ data: { status_code: 'FINISHED' } });

    await meta.publishEverywhere([
      { name: 'Stockport page', kind: 'page', id: 'P1', token: 't' },
      { name: 'Instagram', kind: 'instagram', id: 'IG1', token: 't' },
    ], { imageUrls: ['https://stockport-badminton.co.uk/resultImage/a/b/1/2/Premier'], message: 'm' });

    const lines = timingLines();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\[timing\] meta: Stockport page \d+ms ok$/);
    expect(lines[1]).toMatch(/^\[timing\] meta: Instagram \d+ms failed$/);
  });
});

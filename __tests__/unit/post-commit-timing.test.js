// HARD-47 step 1: what the publish request waits on, one timing line per step — since
// REARCH-09 a `timing` field ({ stage, step, ms, outcome }) on a structured log line.
// Publishing a result took 16-51 s against Firebase Hosting's 60 s cut, and the request
// log could only say the total. These lines are how the split gets measured.
jest.mock('axios');
const axios = require('axios');
jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

const { afterCommit } = require('../../utils/afterCommit');
const meta = require('../../utils/metaPublisher');
const logger = require('../../utils/log');

let info;
beforeEach(() => {
  jest.clearAllMocks();
  info = jest.spyOn(logger, 'info');
});
afterEach(() => jest.restoreAllMocks());

const timings = () => info.mock.calls.map(c => c[0] && c[0].timing).filter(Boolean);

describe('afterCommit', () => {
  it('logs how long a step took, labelled with its stage', async () => {
    await afterCommit('result zap', async () => 'done', { stage: 'scorecard-post-commit' });
    expect(timings()).toEqual([{ stage: 'scorecard-post-commit', step: 'result zap', ms: expect.any(Number), outcome: 'ok' }]);
  });

  it('times a failed step too, and says it failed', async () => {
    await afterCommit('results email', async () => { throw new Error('SES is down'); });
    expect(timings()).toEqual([{ stage: 'post-commit', step: 'results email', ms: expect.any(Number), outcome: 'failed' }]);
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

    expect(timings()).toEqual([
      { stage: 'meta', step: 'Stockport page', ms: expect.any(Number), outcome: 'ok' },
      { stage: 'meta', step: 'Instagram', ms: expect.any(Number), outcome: 'failed' },
    ]);
  });
});

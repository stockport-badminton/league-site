// Vision's capacity refusal must be retried, and named when it outlasts the retries.
//
// On 1 Oct 2026 Vision refused about half of all calls with `code 8: Resource has been
// exhausted`. The refusal is a PER-IMAGE error inside a successful response, so nothing
// threw: `runOCR` reported "No text detected in image" — blaming a photo that was fine —
// and the controller turned that into a 500 and a Sentry exception. See detectText in
// controllers/cornerDetection.js.
//
// The client is mocked so these run without Google. The response shapes are the real
// ones: `helpers.js` in @google-cloud/vision returns `r.responses[0]` as a success, with
// `.error` set and no `fullTextAnnotation`.

const mockDetect = jest.fn();
jest.mock('@google-cloud/vision', () => ({
  ImageAnnotatorClient: jest.fn(() => ({ documentTextDetection: (...a) => mockDetect(...a) })),
}));

const sharp = require('sharp');
const { detectText, analyseImage, VISION_RETRY_DELAYS_MS } = require('../../controllers/cornerDetection');

const NO_DELAY = [0, 0, 0];

const refused = () => [{ error: { code: 8, message: 'Resource has been exhausted (e.g. check quota).' } }];
const ok = (annotation = { pages: [{ blocks: [] }] }) => [{ fullTextAnnotation: annotation }];

beforeEach(() => mockDetect.mockReset());

describe('detectText', () => {
  it('retries a per-image code 8 and returns the response that got through', async () => {
    mockDetect
      .mockResolvedValueOnce(refused())
      .mockResolvedValueOnce(refused())
      .mockResolvedValueOnce(ok());

    const result = await detectText(Buffer.from('img'), NO_DELAY);

    expect(result.fullTextAnnotation).toBeDefined();
    expect(mockDetect).toHaveBeenCalledTimes(3);
  });

  it('retries the same refusal when it arrives as a thrown gRPC error', async () => {
    mockDetect
      .mockRejectedValueOnce(Object.assign(new Error('8 RESOURCE_EXHAUSTED'), { code: 8 }))
      .mockResolvedValueOnce(ok());

    await expect(detectText(Buffer.from('img'), NO_DELAY)).resolves.toBeDefined();
    expect(mockDetect).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retries with a busy error, not "No text detected"', async () => {
    mockDetect.mockResolvedValue(refused());

    const err = await detectText(Buffer.from('img'), NO_DELAY).catch(e => e);

    expect(mockDetect).toHaveBeenCalledTimes(NO_DELAY.length + 1);
    expect(err.visionBusy).toBe(true);
    expect(err.status).toBe(503);
    expect(err.message).toMatch(/busy/i);
    expect(err.message).not.toMatch(/no text|quota|exhausted/i);
    expect(err.detail).toMatch(/exhausted/i);   // the log keeps Google's own wording
  });

  it('does not retry any other per-image error, and names it', async () => {
    mockDetect.mockResolvedValue([{ error: { code: 3, message: 'Bad image data.' } }]);

    const err = await detectText(Buffer.from('img'), NO_DELAY).catch(e => e);

    expect(mockDetect).toHaveBeenCalledTimes(1);
    expect(err.visionBusy).toBeUndefined();
    expect(err.message).toMatch(/code 3.*Bad image data/);
  });

  it('does not retry a thrown error that is not a capacity refusal', async () => {
    mockDetect.mockRejectedValue(Object.assign(new Error('7 PERMISSION_DENIED'), { code: 7 }));

    await expect(detectText(Buffer.from('img'), NO_DELAY)).rejects.toThrow(/PERMISSION_DENIED/);
    expect(mockDetect).toHaveBeenCalledTimes(1);
  });

  // Sized against Firebase Hosting's 60s cut-off (CLAUDE.md 1bc): two calls per card,
  // each retrying in full, plus the analysis itself, must fit well inside it.
  it('keeps the worst case for a card well inside 60 seconds', () => {
    const perCall = VISION_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
    expect(2 * perCall).toBeLessThan(30000);
  });
});

describe('analyseImage when Vision stays busy', () => {
  afterEach(() => jest.useRealTimers());

  it('stops at autoRotate rather than spending a second round of retries in runOCR', async () => {
    mockDetect.mockResolvedValue(refused());
    const img = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).jpeg().toBuffer();

    jest.useFakeTimers();
    const pending = analyseImage(img).catch(e => e);
    await jest.advanceTimersByTimeAsync(VISION_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0));
    const err = await pending;

    expect(err.visionBusy).toBe(true);
    expect(mockDetect).toHaveBeenCalledTimes(VISION_RETRY_DELAYS_MS.length + 1);
  });
});

// HARD-43: the homepage gallery listing is cached, bounded in time, and never rejects.
jest.mock('axios');
const axios = require('axios');
const gallery = require('../../utils/cloudinaryGallery');

const listing = (n) => ({ data: { resources: Array.from({ length: n }, (_, i) => ({ url: `u${i}` })) } });
const hang = () => new Promise(() => {});

let now;
beforeEach(() => {
  jest.clearAllMocks();
  gallery._reset();
  now = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => jest.restoreAllMocks());

describe('cloudinaryGallery.getGallery', () => {
  it('makes one Cloudinary call for two requests in a row', async () => {
    axios.get.mockResolvedValue(listing(3));
    expect(await gallery.getGallery('messer2026')).toHaveLength(3);
    expect(await gallery.getGallery('messer2026')).toHaveLength(3);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('shares one call between concurrent cold requests', async () => {
    axios.get.mockResolvedValue(listing(2));
    await Promise.all([gallery.getGallery('t'), gallery.getGallery('t'), gallery.getGallery('t')]);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('keys on the tag, so a new gallery tag takes effect at once', async () => {
    axios.get.mockResolvedValueOnce(listing(1)).mockResolvedValueOnce(listing(4));
    expect(await gallery.getGallery('old')).toHaveLength(1);
    expect(await gallery.getGallery('new')).toHaveLength(4);
  });

  it('answers within the deadline, with no gallery, when Cloudinary never answers', async () => {
    Date.now.mockRestore(); // real clock for this one
    axios.get.mockImplementation(hang);
    const started = Date.now();
    const assets = await gallery.getGallery('messer2026');
    expect(assets).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('serves the stale listing without waiting while it refreshes', async () => {
    axios.get.mockResolvedValueOnce(listing(3));
    await gallery.getGallery('t');
    now += gallery.FRESH_MS + 1;
    let release;
    axios.get.mockImplementation(() => new Promise(r => { release = r; }));
    // Resolves immediately with the old listing although the refresh is still pending.
    expect(await gallery.getGallery('t')).toHaveLength(3);
    expect(axios.get).toHaveBeenCalledTimes(2);
    // Settle the refresh before the test ends. Left hanging, its deadline fires 1.5 s
    // later and logs after the file has finished, and Jest answers that with exit code 1
    // although every test passed. That failed the Cloud Build of 3edbe3f, where the
    // suite runs in one process; locally each file's worker exited first and hid it.
    release(listing(4));
    await new Promise(setImmediate);
    expect(await gallery.getGallery('t')).toHaveLength(4);
  });

  it('keeps the last good listing when a refresh fails, and backs off before retrying', async () => {
    axios.get.mockResolvedValueOnce(listing(3));
    await gallery.getGallery('t');
    now += gallery.FRESH_MS + 1;
    axios.get.mockRejectedValueOnce(new Error('Request failed with status code 500'));
    await gallery.getGallery('t');        // starts the failing refresh
    await new Promise(setImmediate);      // let it settle
    expect(await gallery.getGallery('t')).toHaveLength(3);
    expect(axios.get).toHaveBeenCalledTimes(2); // no retry inside the back-off
    now += gallery.FAILURE_MS + 1;
    axios.get.mockResolvedValueOnce(listing(5));
    await gallery.getGallery('t');
    await new Promise(setImmediate);
    expect(await gallery.getGallery('t')).toHaveLength(5);
  });

  it('a cold failure renders no gallery rather than throwing', async () => {
    axios.get.mockRejectedValue(new Error('Request failed with status code 500'));
    await expect(gallery.getGallery('t')).resolves.toEqual([]);
  });

  it('never rejects, even when the HTTP client throws instead of returning a promise', async () => {
    axios.get.mockImplementation(() => { throw new Error('boom'); });
    await expect(gallery.getGallery('t')).resolves.toEqual([]);
    axios.get.mockReturnValue(undefined);
    gallery._reset();
    await expect(gallery.getGallery('t')).resolves.toEqual([]);
  });

  it('sends the credentials as auth, never in the URL', async () => {
    axios.get.mockResolvedValue(listing(0));
    await gallery.getGallery('messer 2026');
    const [url, opts] = axios.get.mock.calls[0];
    expect(url).not.toMatch(/test-cloudinary-(key|secret)/);
    expect(url).toMatch(/\/tags\/messer%202026$/);
    expect(opts.auth).toEqual({ username: 'test-cloudinary-key', password: 'test-cloudinary-secret' });
  });
});

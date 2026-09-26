// The Threads OAuth client: what it sends, and what it lets out when Threads refuses.

jest.mock('axios');
const axios = require('axios');
const threads = require('../../utils/threadsAuth');

const SECRET = 'app-secret-must-never-leak';

beforeEach(() => {
  jest.resetAllMocks();
  process.env.META_THREADS_APP_ID = '1113993321053331';
  process.env.META_THREADS_APP_SECRET = SECRET;
  process.env.META_THREADS_USER_ID = '28753684917596556';
});
afterEach(() => {
  delete process.env.META_THREADS_APP_ID;
  delete process.env.META_THREADS_APP_SECRET;
  delete process.env.META_THREADS_USER_ID;
});

function refusal(message) {
  const err = new Error('Request failed with status code 400');
  err.config = { params: { client_secret: SECRET, access_token: 'THAAsecret' } };
  err.response = { status: 400, data: { error: { message, type: 'OAuthException', code: 10 } } };
  return err;
}

describe('configuration', () => {
  it('counts the expected account id as required, since it is what refuses the wrong login', () => {
    expect(threads.missingConfig()).toEqual([]);
    delete process.env.META_THREADS_USER_ID;
    expect(threads.missingConfig()).toEqual(['META_THREADS_USER_ID']);
  });
});

describe('the code exchange', () => {
  it('posts the code with the Threads app credentials and the same redirect uri', async () => {
    axios.post.mockResolvedValue({ data: { access_token: 'short', user_id: 1 } });
    const token = await threads.exchangeCode({ code: 'abc#_', redirectUri: 'https://x/cb' });

    expect(token).toBe('short');
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toBe('https://graph.threads.net/oauth/access_token');
    const sent = new URLSearchParams(body);
    expect(sent.get('client_id')).toBe('1113993321053331');
    expect(sent.get('grant_type')).toBe('authorization_code');
    expect(sent.get('redirect_uri')).toBe('https://x/cb');
    // The documented `#_` suffix is stripped.
    expect(sent.get('code')).toBe('abc');
  });
});

describe('long-lived tokens', () => {
  it('exchanges and refreshes with the documented grant types', async () => {
    axios.get.mockResolvedValue({ data: { access_token: 'THAAlong', expires_in: 5184000 } });
    await expect(threads.longLived('short')).resolves.toEqual({ token: 'THAAlong', expiresIn: 5184000 });
    await expect(threads.refresh('THAAlong')).resolves.toEqual({ token: 'THAAlong', expiresIn: 5184000 });

    expect(axios.get.mock.calls[0][0]).toBe('https://graph.threads.net/access_token');
    expect(axios.get.mock.calls[0][1].params.grant_type).toBe('th_exchange_token');
    expect(axios.get.mock.calls[1][0]).toBe('https://graph.threads.net/refresh_access_token');
    expect(axios.get.mock.calls[1][1].params.grant_type).toBe('th_refresh_token');
  });

  it('refuses an answer with no expiry rather than storing a token of unknown life', async () => {
    axios.get.mockResolvedValue({ data: { access_token: 'THAAlong' } });
    await expect(threads.refresh('x')).rejects.toThrow(threads.ThreadsError);
  });
});

describe('failures', () => {
  it('carries Threads\' own sentence, and never the secret or the token', async () => {
    axios.get.mockRejectedValue(refusal('Session has expired'));
    let caught;
    try { await threads.refresh('THAAsecret'); } catch (e) { caught = e; }

    expect(caught).toBeInstanceOf(threads.ThreadsError);
    expect(caught.message).toBe('Threads refused the token refresh: Session has expired');
    const everything = JSON.stringify(caught) + caught.message + String(caught.stack);
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain('THAAsecret');
  });

  it('names the missing Threads Tester role, which otherwise looks like a code bug', async () => {
    axios.get.mockRejectedValue(refusal(
      'The user has not accepted the invite to test the app. requires the threads_basic permission'));
    await expect(threads.me('t')).rejects.toThrow(/Threads Tester role/);
  });
});

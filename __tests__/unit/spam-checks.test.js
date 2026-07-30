const { honeypotTripped, formStamp, timingProblem, HONEYPOT_FIELD, MIN_SECONDS } =
  require('../../utils/spamChecks');

// The honeypot and the timing floor are the two checks that don't depend on recognising
// anything, so they're the ones that catch spam we haven't seen before. They're also the
// two most capable of silently eating a real person's message, because a rejection looks
// like a success — so the false-positive behaviour is what's tested hardest here.

describe('honeypot', () => {
  it('trips on any value', () => {
    expect(honeypotTripped({ [HONEYPOT_FIELD]: 'http://spam.example' })).toBe(true);
    expect(honeypotTripped({ [HONEYPOT_FIELD]: 'x' })).toBe(true);
  });

  it('does not trip on the states a browser actually sends', () => {
    // An untouched text input posts as an empty string; a form rendered before the field
    // existed doesn't post it at all. Neither is spam.
    expect(honeypotTripped({ [HONEYPOT_FIELD]: '' })).toBe(false);
    expect(honeypotTripped({ [HONEYPOT_FIELD]: '   ' })).toBe(false);
    expect(honeypotTripped({})).toBe(false);
    expect(honeypotTripped(undefined)).toBe(false);
  });

  it('is not named anything a bot would recognise as a trap', () => {
    expect(HONEYPOT_FIELD).not.toMatch(/honey|trap|spam|bot/i);
  });
});

describe('timing', () => {
  it('rejects a submission faster than a human could type', () => {
    const now = Date.now();
    expect(timingProblem({ formTs: formStamp(now) }, now + 500)).toBe('too-fast');
  });

  it('accepts a submission after the floor', () => {
    const now = Date.now();
    expect(timingProblem({ formTs: formStamp(now) }, now + (MIN_SECONDS + 1) * 1000)).toBeNull();
  });

  it('accepts a stale tab', () => {
    // Someone opens the form, goes to find a postcode, comes back. Only the floor is
    // enforced — rejecting this would punish exactly the person we want to hear from.
    const now = Date.now();
    expect(timingProblem({ formTs: formStamp(now) }, now + 6 * 60 * 60 * 1000)).toBeNull();
  });

  it('has no opinion when the stamp is missing or malformed', () => {
    // Caches, autofill tools and forms rendered before this field existed. A false
    // positive here means a real message vanishing silently, so absent means no opinion.
    const now = Date.now();
    expect(timingProblem({}, now)).toBeNull();
    expect(timingProblem({ formTs: '' }, now)).toBeNull();
    expect(timingProblem({ formTs: 'nonsense' }, now)).toBeNull();
    expect(timingProblem({ formTs: 'abc.def' }, now)).toBeNull();
    expect(timingProblem(undefined, now)).toBeNull();
  });

  it('rejects a stamp that has been edited', () => {
    // A present-but-wrong signature is not something a browser produces.
    const now = Date.now();
    const stamp = formStamp(now);
    const [ts, mac] = stamp.split('.');
    // Same length, different content, so it fails the compare rather than the guard.
    const tampered = ts + '.' + (mac[0] === 'A' ? 'B' : 'A') + mac.slice(1);
    expect(timingProblem({ formTs: tampered }, now + 10000)).toBe('bad-stamp');
  });

  it('rejects a backdated timestamp with a valid-looking shape', () => {
    // Rewriting the timestamp to something older is the obvious way to defeat a timing
    // check, which is why the value is signed.
    const now = Date.now();
    const old = String(now - 60000);
    const stamp = formStamp(now);
    const forged = old + '.' + stamp.split('.')[1];
    expect(timingProblem({ formTs: forged }, now)).toBe('bad-stamp');
  });

  it('rejects a stamp from the future', () => {
    const now = Date.now();
    expect(timingProblem({ formTs: formStamp(now + 60000) }, now)).toBe('bad-stamp');
  });

  it('does not throw on a signature of the wrong length', () => {
    // timingSafeEqual throws on differing lengths, so the length is checked first.
    const now = Date.now();
    expect(() => timingProblem({ formTs: String(now) + '.short' }, now)).not.toThrow();
  });
});

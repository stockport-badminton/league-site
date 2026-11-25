const securityHeaders = require('../../utils/securityHeaders');

// The enforcement switch (HARD-12).
//
// The whole design rests on being able to promote the observed policy to enforcing
// without touching code — one env var, so the decision can be made by whoever is
// watching the reports, and reversed in a redeploy rather than a code change. A switch
// that has never been exercised is not a switch, so it is exercised here: the
// report-only path is what ships, and this is the only thing that proves the other
// branch produces a coherent policy rather than throwing at boot.

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('by default', () => {
  it('enforces only the directives that need no allowlist', () => {
    delete process.env.CSP_ENFORCE;
    const enforced = securityHeaders.enforcedDirectives();
    expect(Object.keys(enforced).sort()).toEqual(
      ['base-uri', 'default-src', 'form-action', 'frame-ancestors', 'object-src']
    );
    // Not a real source list — helmet's sentinel for "deliberately omit default-src".
    // The enforced header must name no source of scripts, styles or images at all.
    expect(Array.isArray(enforced['default-src'])).toBe(false);
  });

  it('observes the full allowlist separately', () => {
    delete process.env.CSP_ENFORCE;
    const observed = securityHeaders.observedDirectives();
    expect(observed['script-src']).toContain('https://cdn.jsdelivr.net');
    expect(observed['default-src']).toEqual(["'self'"]);
  });
});

describe('with CSP_ENFORCE=true', () => {
  beforeEach(() => { process.env.CSP_ENFORCE = 'true'; });

  it('folds the observed allowlist into the enforcing header', () => {
    const enforced = securityHeaders.enforcedDirectives();
    expect(enforced['script-src']).toContain('https://cdn.jsdelivr.net');
    expect(enforced['default-src']).toEqual(["'self'"]);
    // The baseline survives the merge — enforcing the allowlist must not quietly drop
    // the clickjacking and form-action protection that was already live.
    expect(enforced['frame-ancestors']).toEqual(["'self'"]);
    expect(enforced['form-action']).toEqual(["'self'"]);
  });

  it('stops sending a report-only header, rather than sending both', () => {
    expect(securityHeaders.observedDirectives()).toBeNull();
  });

  it('keeps reporting violations once enforcing', () => {
    // Enforcing is when a violation costs a real visitor a broken page, so this is the
    // point at which the reports matter most.
    const enforced = securityHeaders.enforcedDirectives();
    expect(enforced['report-uri']).toEqual(['/csp-report']);
  });
});

describe('where reports are sent', () => {
  it('defaults to the collector in app.js', () => {
    delete process.env.CSP_REPORT_URI;
    expect(securityHeaders.reportUri()).toBe('/csp-report');
    expect(securityHeaders.reportingEndpointsHeader())
      .toBe('csp-endpoint="/csp-report", csp-inline="/csp-report?policy=inline"');
  });

  it('can be pointed at Sentry, or anywhere else, without a code change', () => {
    process.env.CSP_REPORT_URI = 'https://example.ingest.de.sentry.io/api/1/security/?sentry_key=k';
    const observed = securityHeaders.observedDirectives();
    expect(observed['report-uri']).toEqual([process.env.CSP_REPORT_URI]);
    expect(securityHeaders.reportingEndpointsHeader()).toContain('sentry.io');
  });

  it('emits no reporting directives at all when set empty', () => {
    process.env.CSP_REPORT_URI = '';
    const observed = securityHeaders.observedDirectives();
    expect(observed['report-uri']).toBeUndefined();
    expect(observed['report-to']).toBeUndefined();
    expect(securityHeaders.reportingEndpointsHeader()).toBeNull();
  });
});

// REARCH-07 step 6: script-src without 'unsafe-inline', observed, so a report means inline
// script ran on a page we think has none.
describe('the inline-script policy', () => {
  it("is script-src as allowed, without 'unsafe-inline', asking for a sample", () => {
    delete process.env.CSP_REPORT_URI;
    const d = securityHeaders.inlineDirectives();
    expect(Object.keys(d).sort()).toEqual(['report-to', 'report-uri', 'script-src']);
    expect(d['script-src']).not.toContain("'unsafe-inline'");
    expect(d['script-src']).toContain("'report-sample'");
    const hosts = securityHeaders.OBSERVED['script-src'].filter(s => s !== "'unsafe-inline'");
    expect(d['script-src']).toEqual(expect.arrayContaining(hosts));
    // The main policy keeps it until the scorecard templates are clean.
    expect(securityHeaders.OBSERVED['script-src']).toContain("'unsafe-inline'");
  });

  it('reports to its own URL and group, so the collector can tell the two apart', () => {
    delete process.env.CSP_REPORT_URI;
    expect(securityHeaders.inlineDirectives()['report-uri']).toEqual(['/csp-report?policy=inline']);
    expect(securityHeaders.inlineDirectives()['report-to']).toEqual(['csp-inline']);
    process.env.CSP_REPORT_URI = 'https://example.ingest.de.sentry.io/api/1/security/?sentry_key=k';
    expect(securityHeaders.inlineReportUri()).toBe(process.env.CSP_REPORT_URI + '&policy=inline');
  });

  it('reports nowhere when reporting is off', () => {
    process.env.CSP_REPORT_URI = '';
    expect(securityHeaders.inlineDirectives()['report-uri']).toBeUndefined();
    expect(securityHeaders.inlinePolicyHeader()).toMatch(/^script-src [^;]+$/);
  });

  it('is sent whether or not the allowlist is enforced', () => {
    for (const v of [undefined, 'true']) {
      if (v) process.env.CSP_ENFORCE = v; else delete process.env.CSP_ENFORCE;
      expect(securityHeaders.inlinePolicyHeader()).toMatch(/^script-src 'self' /);
    }
  });
});

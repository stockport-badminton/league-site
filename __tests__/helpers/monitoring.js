// Shared by browser-posthog.test.js and browser-sentry-origin.test.js: render the real
// header, then run the real static/beta/js/monitoring.js against the #sbl-monitoring
// block it emitted, in a fake browser. What is under test is the shipped code and the
// shipped config, not a copy of either written into the test.

const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const HEADER = path.join(ROOT, 'views', 'header.ejs');
const MONITORING = fs.readFileSync(path.join(ROOT, 'static', 'beta', 'js', 'monitoring.js'), 'utf8');
const { siteOrigin } = require('../../utils/canonical');

const ENV_KEYS = ['NODE_ENV', 'K_SERVICE', 'POSTHOG_KEY'];

// `env` sets exactly these keys: one left out is unset for the render.
function renderHeader(env, user) {
  const before = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return ejs.render(fs.readFileSync(HEADER, 'utf8'), {
      static_path: '/static',
      pageTitle: 't',
      pageDescription: 'd',
      theme: 'flatly',
      siteOrigin,
      config: require('../../config'),
      asset: require('../../utils/assets').asset,
      jsonForScript: require('../../utils/jsonForScript'),
      backgroundPreloads: require('../../utils/backgroundPreload').backgroundPreloads,
      ...(user ? { user } : {}),
      canonical: 'https://stockport-badminton.co.uk/',
    }, { filename: HEADER });
  } finally {
    for (const k of ENV_KEYS) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    }
  }
}

// The block's text as the browser would hand it to JSON.parse, or null.
function configBlock(html) {
  const m = html.match(/<script type="application\/json" id="sbl-monitoring">([\s\S]*?)<\/script>/);
  return m ? m[1] : null;
}

// Run monitoring.js in a fake browser. Returns the window, what it appended to <head>,
// and a `load()` that fires the window's load listeners.
function runMonitoring(html, {
  pathname = '/', hostname = 'www.stockport-badminton.co.uk', protocol = 'https:', readyState = 'loading',
} = {}) {
  const block = configBlock(html);
  const injected = [];
  const onLoad = [];
  const window = {
    addEventListener: (type, fn) => { if (type === 'load') onLoad.push(fn); },
  };
  const sandbox = {
    window,
    location: { pathname, hostname, protocol },
    document: {
      readyState,
      getElementById: (id) => (id === 'sbl-monitoring' && block !== null ? { textContent: block } : null),
      createElement: () => ({}),
      head: { appendChild: (el) => injected.push(el) },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(MONITORING, sandbox);
  return { window, injected, load: () => onLoad.forEach((fn) => fn()), sandbox };
}

module.exports = { renderHeader, configBlock, runMonitoring, MONITORING };

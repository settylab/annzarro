/**
 * Every way a Gene Set Analysis service can fail, for every service, says
 * which one happened (panels/gene-set-utilities/fetch-policy.js).
 *
 * The panel once read any HTTP 404 from STRING as "STRING knows none of
 * these genes for Homo sapiens", so a retired version host or a moved API
 * sent users off to check their species. Now each section's error names
 * what happened, in its own words: offline, unreachable, blocked by the
 * browser (CORS), timed out, rate-limited, the service down, an error on
 * the service's side, an address that is gone. "Knows none of these genes"
 * is said only when the service answered that it found no matches (STRING's
 * 404 "did not find any matches", Reactome's JSON 404, a reply whose genes
 * all failed).
 *
 * fetch is mocked per case: a reply (status and body), or a rejection with
 * the TypeError browsers give for no network, a DNS failure and a CORS
 * refusal alike; the panel tells those apart with a no-cors check of the
 * host's root (mocked here to answer or not) and navigator.onLine.
 *
 * Run:  node --test annzarro/tests/js/gene-set-errors.test.mjs
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const R = await import('../../../static/js/panels/gene-set-utilities/runner.js');
const P = await import('../../../static/js/panels/gene-set-utilities/fetch-policy.js');
const { ADAPTERS } = await import('../../../static/js/panels/gene-set-utilities/services/index.js');
const { _resetBackgrounds, isNoMatches } = await import('../../../static/js/panels/gene-set-utilities/services/string.js');
const { _resetOrganisms } = await import('../../../static/js/panels/gene-set-utilities/services/gprofiler.js');
const { isReactomeNoMatches } = await import('../../../static/js/panels/gene-set-utilities/services/optional.js');

const FIX = new URL('./gene-set-fixtures/', import.meta.url);
const fixture = (name) => readFileSync(new URL(name, FIX), 'utf8');
const byId = Object.fromEntries(ADAPTERS.map(a => [a.id, a]));

const flush = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

function defaults(adapter) {
    return Object.fromEntries(Object.entries(adapter.params || {}).map(([k, p]) => [k, p.default]));
}

function inputFor(adapter) {
    // a species g:Profiler has no built-in name for would ask for its list
    // first; 9606 goes straight to the profile request
    return {
        genes: ['TP53', 'MDM2', 'ATM', 'CDKN1A', 'CHEK2'], genesHash: `h-${adapter.id}`, taxonomyId: '9606',
        speciesName: 'Homo sapiens', idType: 'symbol', params: { ...defaults(adapter), background: 'genome' },
        focus: { id: 'TP53', name: 'TP53' }, background: null,
        services: { string: { api: 'https://version-12-5.string-db.org/api', version: '12.5' } }
    };
}

// The services of the operator's list, one section each
const SERVICES = {
    STRING: 'string-enrichment', 'g:Profiler': 'gprofiler-gost', 'MyGene.info': 'mygene-card',
    Enrichr: 'enrichr', Reactome: 'reactome', HPA: 'hpa'
};

const reply = (status, body = '', headers = {}) => () => Promise.resolve(new Response(body, { status, headers }));
const typeError = () => Promise.reject(new TypeError('Failed to fetch'));

/**
 * The failure cases. `fail` answers every request of the service; `probe`
 * whether the host's root answers the no-cors check; `online` is
 * navigator.onLine.
 */
const CASES = {
    'a 404 that is not "no matches"': { fail: reply(404, '<html><body><h1>Not Found</h1></body></html>'),
        kind: 'endpoint', says: /has no such address \(HTTP 404\): the service's API may have moved/ },
    'no network or DNS failure': { fail: typeError, probe: false,
        kind: 'unreachable', says: /could not connect to \S+: no network, the address did not resolve, or the service is down/ },
    'offline': { fail: typeError, online: false,
        kind: 'offline', says: /this browser is offline/ },
    'timeout': { fail: () => new Promise(() => {}),
        kind: 'timeout', says: /timed out after \d+ s: \S+ did not answer in time/ },
    'CORS or blocked by the browser': { fail: typeError, probe: true,
        kind: 'blocked', says: /answered, but the browser blocked its reply: the service does not allow requests from this page \(CORS\)/ },
    '429': { fail: reply(429, 'slow down'),
        kind: 'rate-limit', says: /is limiting how often it may be asked \(HTTP 429\)/ },
    '500': { fail: reply(500, 'Internal Server Error'),
        kind: 'server', says: /failed on this request \(HTTP 500, an error on the service's side\)/ },
    'the service down (503)': { fail: reply(503, '<html>Service Unavailable</html>'),
        kind: 'down', says: /is down or overloaded \(HTTP 503\); try again later/ }
};

/** Run `adapter` against `c`, driving the faked clock until it settles. */
async function runCase(adapter, c) {
    _resetBackgrounds();
    _resetOrganisms();
    const calls = { requests: 0, probes: 0 };
    const fetchImpl = (url, init) => {
        if (init && init.mode === 'no-cors') {
            calls.probes++;
            return c.probe ? Promise.resolve(new Response(null, { status: 200 })) : typeError();
        }
        calls.requests++;
        return c.fail(url, init);
    };
    const runner = R.createRunner({ fetchImpl, setTimeout, clearTimeout, now: () => Date.now(), random: () => 0,
        queues: new Map(), timeoutMs: 20000, online: () => (c.online === undefined ? true : c.online) });
    let done = false;
    const p = runner.start(adapter.id, adapter, inputFor(adapter), 'k').then(r => { done = true; return r; });
    for (let i = 0; i < 200 && !done; i++) {
        await flush();
        mock.timers.tick(5000);
    }
    const run = await p;
    runner.dispose();
    return { run, calls };
}

for (const [service, id] of Object.entries(SERVICES)) {
    for (const [name, c] of Object.entries(CASES)) {
        test(`${service}: ${name} is said as such, with no "not found"`, async (t) => {
            mock.timers.enable({ apis: ['setTimeout', 'Date'] });
            t.after(() => mock.timers.reset());
            const { run, calls } = await runCase(byId[id], c);
            assert.equal(run.status, 'error', JSON.stringify(run));
            assert.equal(run.error.kind, c.kind, run.error.message);
            assert.match(run.error.message, c.says);
            // (a quoted reply of the service may say "Not Found": that is its HTTP reason)
            assert.doesNotMatch(run.error.message.replace(/"[^"]*"/g, ''), /knows none|not found|no matches|does not cover/i,
                'only a service that found no matches is reported as not knowing the genes');
            // the section offers Retry for every one of these (gene-set.js
            // paints Retry for every kind that is not an answer about the genes)
            assert.ok(!['unmapped', 'empty', 'species', 'idtype', 'capped', 'declined', 'unfocused'].includes(run.error.kind));
            const retried = P.isRetryable({ kind: c.kind });
            assert.equal(run.error.attempts, retried ? 2 : 1, 'retried automatically only when that may help');
            if (c.online === false) assert.equal(calls.probes, 0, 'offline: no check of the host either');
        });
    }
}

test('STRING: its 404 "did not find any matches" is the one answer read as no genes known', async (t) => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    t.after(() => mock.timers.reset());
    const body = fixture('string-404-nothing-found.json');
    const { run } = await runCase(byId['string-enrichment'], { fail: reply(404, body) });
    assert.equal(run.status, 'error');
    assert.equal(run.error.kind, 'unmapped');
    assert.match(run.error.message, /STRING knows none of these 5 genes for Homo sapiens/);
    assert.ok(isNoMatches({ status: 404, body }));
    assert.ok(!isNoMatches({ status: 404, body: '<html>Not Found</html>' }));
    assert.ok(!isNoMatches({ status: 404, body: '[{"Error":"not found","ErrorMessage":"no such method"}]' }));
    assert.ok(!isNoMatches({ status: 500, body }));
});

test('Reactome: its JSON 404 is "none of the genes", a bare 404 is an address that is gone', async (t) => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    t.after(() => mock.timers.reset());
    // the AnalysisService's error shape (documented; Reactome keeps what it is sent, so not recorded)
    const body = JSON.stringify({ code: 404, reason: 'Not Found', messages: ['No matching data found for the identifiers'] });
    const { run } = await runCase(byId.reactome, { fail: reply(404, body, { 'Content-Type': 'application/json' }) });
    assert.equal(run.error.kind, 'unmapped');
    assert.match(run.error.message, /Reactome knows none of these 5 genes/);
    assert.ok(isReactomeNoMatches({ status: 404, body }));
    assert.ok(!isReactomeNoMatches({ status: 404, body: '<html>404</html>' }));
});

test('the no-cors check carries nothing of the request: no body, no cookie, no referrer, the root only', async (t) => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    t.after(() => mock.timers.reset());
    const seen = [];
    const c = { fail: typeError, probe: true };
    const adapter = byId['gprofiler-gost'];
    _resetOrganisms();
    const fetchImpl = (url, init) => {
        seen.push({ url, init });
        return init.mode === 'no-cors' ? Promise.resolve(new Response(null)) : c.fail();
    };
    const runner = R.createRunner({ fetchImpl, setTimeout, clearTimeout, now: () => Date.now(), random: () => 0,
        queues: new Map(), online: () => true });
    await runner.start(adapter.id, adapter, inputFor(adapter), 'k');
    const probes = seen.filter(s => s.init.mode === 'no-cors');
    assert.ok(probes.length >= 1);
    for (const { url, init } of probes) {
        assert.equal(url, 'https://biit.cs.ut.ee/');
        assert.equal(init.method, 'GET');
        assert.equal(init.body, undefined);
        assert.equal(init.credentials, 'omit');
        assert.equal(init.referrerPolicy, 'no-referrer');
    }
    runner.dispose();
});

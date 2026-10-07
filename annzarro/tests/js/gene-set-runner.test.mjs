/**
 * Running the Gene Set Analysis panel's sections against services that are
 * slow, down, rate-limiting or wrong (panels/gene-set-utilities/runner.js,
 * fetch-policy.js), with fetch mocked and the clock faked.
 *
 * What must hold: a request that never answers times out and is tried once
 * more, then the section says so; a 4xx is not retried and its message is
 * shown; a 429's Retry-After is honoured; a superseded or hidden run never
 * paints; one failing section leaves the others alone; requests carry no
 * cookie, no referrer and no gene in the URL; STRING is asked at most once a
 * second; and after a cancel no timer is left behind.
 *
 * Run:  node --test annzarro/tests/js/gene-set-runner.test.mjs
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const R = await import('../../../static/js/panels/gene-set-utilities/runner.js');
const P = await import('../../../static/js/panels/gene-set-utilities/fetch-policy.js');
const { stringEnrichment, stringNetwork, stringPartners } = await import('../../../static/js/panels/gene-set-utilities/services/string.js');
const { gprofilerGost } = await import('../../../static/js/panels/gene-set-utilities/services/gprofiler.js');
const { mygeneMapping } = await import('../../../static/js/panels/gene-set-utilities/services/mygene.js');

const FIX = new URL('./gene-set-fixtures/', import.meta.url);
const fixture = (name) => readFileSync(new URL(name, FIX), 'utf8');

/** Let promise chains run (setImmediate is not faked). */
const flush = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

/** Timers through the faked clock, counted: a test can ask that none is left. */
function timers() {
    const live = new Set();
    return {
        live,
        setTimeout(fn, ms) {
            const t = setTimeout(() => { live.delete(t); fn(); }, ms);
            live.add(t);
            return t;
        },
        clearTimeout(t) { live.delete(t); clearTimeout(t); },
        now: () => Date.now()
    };
}

function runnerWith(fetchImpl, t, extra = {}) {
    const changes = [];
    const runner = R.createRunner({ fetchImpl, setTimeout: t.setTimeout, clearTimeout: t.clearTimeout, now: t.now,
        random: () => 0, queues: new Map(), onChange: (id, run) => changes.push([id, run.status]), ...extra });
    return { runner, changes };
}

const json = (body, status = 200, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body),
    { status, headers: { 'Content-Type': 'application/json', ...headers } });

/** A one-request adapter on host example.org. */
const simple = (id = 'one', over = {}) => ({
    id, version: '1', label: 'One', kind: 'set', provider: { name: 'Example', host: 'example.org', home: 'https://example.org' },
    limits: { minGenes: 1, maxGenes: 10 }, supportsSpecies: () => true, render() {},
    async fetch(input, io) { return io.fetchJson('https://example.org/api', { form: { identifiers: input.genes.join('\r') } }); },
    ...over
});

const input = { genes: ['TP53', 'MDM2', 'ATM', 'CDKN1A', 'CHEK2', 'NOTAGENE'], genesHash: 'h1', taxonomyId: '9606',
    speciesName: 'Homo sapiens', idType: 'symbol', params: {}, focus: { id: 'TP53', name: 'TP53' },
    services: { string: { api: 'https://version-12-5.string-db.org/api', version: '12.5' } } };

test('a request that never answers times out, is tried once more, then the section says so; no timer is left', async (t) => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    t.after(() => mock.timers.reset());
    const tm = timers();
    let calls = 0;
    const { runner } = runnerWith(() => { calls++; return new Promise(() => {}); }, tm, { timeoutMs: 20000 });
    const done = runner.start('one', simple(), input, 'k');
    await flush();
    assert.equal(runner.get('one').status, 'loading');
    mock.timers.tick(20000);
    await flush();
    assert.equal(calls, 1);
    assert.ok(runner.get('one').retryAt, 'the section shows when it retries');
    mock.timers.tick(1500);
    await flush();
    assert.equal(calls, 2, 'one automatic retry');
    mock.timers.tick(20000);
    const run = await done;
    assert.equal(run.status, 'error');
    assert.equal(run.error.kind, 'timeout');
    assert.equal(run.error.attempts, 2);
    assert.match(run.error.message, /timed out after 20 s/);
    assert.equal(tm.live.size, 0, 'no timer left behind');
    assert.equal(runner.inFlight(), 0);
});

test('a superseded run is aborted and its late reply never paints', async () => {
    const tm = timers();
    const pending = [];
    const fetchImpl = (url, init) => new Promise((resolve) => pending.push({ resolve, signal: init.signal }));
    const { runner } = runnerWith(fetchImpl, tm);
    const ignoring = simple('one', { async fetch(inp, io) {
        // an adapter that does not pass its signal on still cannot paint late
        await new Promise(r => setTimeout(r, 5));
        return io.fetchJson('https://example.org/api', { form: { q: inp.genes[0] } });
    } });
    const a = runner.start('one', ignoring, { ...input, genes: ['A'] }, 'kA');
    await new Promise(r => setTimeout(r, 10));
    await flush();
    assert.equal(pending.length, 1);
    const b = runner.start('one', ignoring, { ...input, genes: ['B'] }, 'kB');
    assert.ok(pending[0].signal.aborted, 'A was aborted when B started');
    await new Promise(r => setTimeout(r, 10));
    await flush();
    pending[0].resolve(json({ who: 'A' }));
    pending[1].resolve(json({ who: 'B' }));
    await a;
    const run = await b;
    assert.equal(run.status, 'ok');
    assert.deepEqual(run.result, { who: 'B' });
    assert.equal(run.lastInputHash, 'kB');
    assert.equal(tm.live.size, 0);
});

test('hiding a section aborts its run; dispose aborts everything, a retry wait included', async (t) => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    t.after(() => mock.timers.reset());
    const tm = timers();
    const signals = [];
    const fetchImpl = (url, init) => {
        signals.push(init.signal);
        if (url.includes('fail')) return Promise.resolve(new Response('busy', { status: 503 }));
        return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('a', 'AbortError'))));
    };
    const { runner } = runnerWith(fetchImpl, tm);
    const hidden = runner.start('one', simple(), input, 'k1');
    const retrying = runner.start('two', simple('two', { async fetch(i, io) { return io.fetchJson('https://example.org/fail'); } }), input, 'k2');
    await flush();
    runner.abort('one');
    assert.equal((await hidden).status, 'idle', 'a hidden section goes back to what it showed (nothing)');
    assert.ok(signals[0].aborted);
    await flush();
    assert.ok(runner.get('two').retryAt, 'two is waiting to retry the 503');
    runner.dispose();
    await retrying;
    assert.equal(tm.live.size, 0, 'the retry wait was cleared');
    assert.equal(runner.inFlight(), 0);
});

test('429 waits for Retry-After, then retries once; 400 is not retried and says why; 503 and no connection are retried', async (t) => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    t.after(() => mock.timers.reset());
    const tm = timers();
    // 429 then ok
    let n = 0;
    const r429 = runnerWith(() => (++n === 1 ? Promise.resolve(new Response('slow down', { status: 429, headers: { 'Retry-After': '3' } }))
        : Promise.resolve(json({ ok: true }))), tm).runner;
    const p = r429.start('one', simple(), input, 'k');
    await flush();
    assert.equal(n, 1);
    mock.timers.tick(2999);
    await flush();
    assert.equal(n, 1, 'not before Retry-After');
    mock.timers.tick(1);
    assert.equal((await p).status, 'ok');
    assert.equal(n, 2);
    // 400 with STRING's error body: one attempt, the message shown
    let m = 0;
    const r400 = runnerWith(() => { m++; return Promise.resolve(new Response(fixture('string-error-unknown-organism.json'), { status: 400 })); }, tm).runner;
    const e400 = await r400.start('one', simple(), input, 'k');
    assert.equal(m, 1);
    assert.equal(e400.error.kind, 'http');
    assert.equal(e400.error.status, 400);
    assert.match(e400.error.message, /unknown organism: Sorry, STRING does not know an organism named '4'/);
    assert.doesNotMatch(e400.error.message, /<br/, 'HTML in the body is stripped');
    // 503 then 503: two attempts
    let k = 0;
    const r503 = runnerWith(() => { k++; return Promise.resolve(new Response('', { status: 503 })); }, tm).runner;
    const p503 = r503.start('one', simple(), input, 'k');
    await flush();
    mock.timers.tick(1500);
    const e503 = await p503;
    assert.equal(k, 2);
    assert.equal(e503.error.kind, 'down');
    assert.equal(e503.error.attempts, 2);
    // TypeError, and the host's root does not answer either: unreachable, retried once
    let j = 0;
    const rnet = runnerWith((url, init) => { if (init.mode !== 'no-cors') j++; return Promise.reject(new TypeError('Failed to fetch')); }, tm).runner;
    const pnet = rnet.start('one', simple(), input, 'k');
    await flush();
    mock.timers.tick(1500);
    await flush();
    const enet = await pnet;
    assert.equal(j, 2);
    assert.equal(enet.error.kind, 'unreachable');
    assert.match(enet.error.message, /could not connect to example\.org/);
    assert.equal(tm.live.size, 0);
});

test('a reply that is not JSON is a parse error, not retried', async () => {
    const tm = timers();
    let n = 0;
    const { runner } = runnerWith(() => { n++; return Promise.resolve(new Response('<html>maintenance</html>', { status: 200 })); }, tm);
    const run = await runner.start('one', simple(), input, 'k');
    assert.equal(run.error.kind, 'parse');
    assert.equal(n, 1);
});

test('one section failing leaves another alone', async () => {
    const tm = timers();
    const { runner } = runnerWith(() => Promise.resolve(json({ fine: 1 })), tm);
    const bad = simple('bad', { async fetch() { throw new Error('adapter bug'); } });
    const [a, b] = await Promise.all([runner.start('bad', bad, input, 'k1'), runner.start('good', simple('good'), input, 'k2')]);
    assert.equal(a.status, 'error');
    assert.equal(a.error.kind, 'adapter');
    assert.equal(b.status, 'ok');
});

test('requests: POST form bodies, no cookies, no referrer, no gene in the URL, STRING told who calls', async () => {
    const tm = timers();
    const seen = [];
    const replies = {
        get_string_ids: fixture('string-get_string_ids.json'), enrichment: fixture('string-enrichment.json'),
        ppi_enrichment: fixture('string-ppi_enrichment.json'), interaction_partners: fixture('string-interaction_partners.json')
    };
    const fetchImpl = async (url, init) => {
        seen.push({ url, init });
        if (url.endsWith('/svg/network')) return new Response(fixture('string-network.svg'), { headers: { 'Content-Type': 'image/svg+xml' } });
        if (url.includes('biit.cs.ut.ee')) return json(fixture('gprofiler-profile.json'));
        if (url.includes('mygene.info')) return json(fixture(String(init.body).includes('scopes=alias') ? 'mygene-query-alias.json' : 'mygene-query-symbol.json'));
        return json(replies[url.split('/').pop()]);
    };
    const { runner } = runnerWith(fetchImpl, tm, { queues: new Map([['version-12-5.string-db.org', new R.HostQueue({ maxConcurrent: 4 }, tm)]]) });
    const params = { background: 'genome', requiredScore: 400, networkType: 'functional', hideDisconnected: false, limit: 10 };
    for (const a of [stringEnrichment, stringNetwork, stringPartners]) {
        const run = await runner.start(a.id, a, { ...input, params }, `k-${a.id}`);
        assert.equal(run.status, 'ok', `${a.id}: ${JSON.stringify(run.error)}`);
    }
    await runner.start('gprofiler-gost', gprofilerGost, { ...input, params: { sources: ['GO:BP'], threshold: 0.05, correction: 'g_SCS', background: 'genome' } }, 'kg');
    await runner.start('mygene-mapping', mygeneMapping, { ...input, params: { aliases: true } }, 'km');
    assert.ok(seen.length >= 8);
    for (const { url, init } of seen) {
        assert.equal(init.credentials, 'omit', url);
        assert.equal(init.referrerPolicy, 'no-referrer', url);
        assert.equal(init.method, 'POST', url);
        for (const g of input.genes) assert.ok(!url.includes(g), `${g} is not in ${url}`);
        if (url.includes('string-db.org')) {
            assert.ok(init.body instanceof URLSearchParams, 'form-encoded');
            assert.equal(init.body.get('caller_identity'), 'annzarro');
            assert.equal(init.body.get('species'), '9606');
        }
    }
    const svg = seen.find(s => s.url.endsWith('/svg/network'));
    assert.equal(svg.init.body.get('block_structure_pics_in_bubbles'), '1', 'SVG without the 2 MB structure pictures');
    assert.ok(seen.find(s => s.url.includes('biit.cs.ut.ee')).init.headers['Content-Type'] === 'application/json');
    // the shared id mapping was asked for once for the two set sections
    assert.equal(seen.filter(s => s.url.endsWith('/get_string_ids')).length, 1);
});

test('one host is paced: three sections to it start at 0, 1 and 2 s', async (t) => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    t.after(() => mock.timers.reset());
    const tm = timers();
    const starts = [];
    const t0 = Date.now();
    const fetchImpl = () => { starts.push(Date.now() - t0); return Promise.resolve(json({})); };
    const { runner } = runnerWith(fetchImpl, tm);
    const paced = (id) => simple(id, { provider: { name: 'STRING', host: 'string-db.org', home: 'https://string-db.org', minIntervalMs: 1000, maxConcurrent: 1 },
        async fetch(i, io) { return io.fetchJson('https://version-12-5.string-db.org/api/json/x', { form: { a: 1 } }); } });
    const runs = ['a', 'b', 'c'].map(id => runner.start(id, paced(id), input, id));
    for (let i = 0; i < 4; i++) { await flush(); mock.timers.tick(1000); }
    await Promise.all(runs);
    assert.deepEqual(starts, [0, 1000, 2000]);
});

test('an ok result is reused from the cache, without a request; errors are not cached', async () => {
    const tm = timers();
    let n = 0;
    const { runner } = runnerWith(() => { n++; return Promise.resolve(n === 1 ? new Response('', { status: 500 }) : json({ v: n })); }, tm,
        { random: () => 0 });
    const failing = await runner.start('one', simple('one', { async fetch(i, io) { return io.fetchJson('https://example.org/x', { timeoutMs: 5000 }); } }), input, 'k');
    // 500 then ok on the automatic retry: one result, two requests
    assert.equal(failing.status, 'ok');
    const again = await runner.start('one', simple(), input, 'k');
    assert.equal(again.cached, true);
    assert.equal(n, 2, 'no request for a cached key');
    assert.ok(runner.has('k'));
});

test('bodyExcerpt, retryAfterMs and isRetryable', () => {
    assert.equal(P.bodyExcerpt('{"message":"Invalid organism: nosuchorg"}'), 'Invalid organism: nosuchorg');
    assert.equal(P.bodyExcerpt('<p>Bad <b>request</b></p>'), 'Bad request');
    assert.equal(P.bodyExcerpt('x'.repeat(300)).length, 201);
    assert.equal(P.retryAfterMs('3', 0), 3000);
    assert.equal(P.retryAfterMs('120', 0), 30000, 'capped at 30 s');
    assert.equal(P.retryAfterMs(new Date(10000).toUTCString(), 4000), 6000);
    assert.equal(P.retryAfterMs('soon', 0), null);
    for (const kind of ['timeout', 'unreachable', 'rate-limit', 'down', 'server']) assert.ok(P.isRetryable({ kind }), kind);
    for (const kind of ['offline', 'blocked', 'endpoint', 'http']) assert.ok(!P.isRetryable({ kind }), kind);
    assert.ok(!P.isRetryable({ kind: 'parse' }));
});

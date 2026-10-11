/**
 * The policy client (static/js/policy.js): load, the fallback on a server
 * without the endpoint, the refetch when a reply names another policy
 * version, and what the Gene Set Analysis panel may do (geneSetPolicy,
 * panels/gene-set-utilities/policy-gate.js), including a Run after the
 * administrator turned something off. fetch is mocked.
 *
 * Run:  node --test annzarro/tests/js/policy.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.fetch = async () => ({ ok: false, status: 503, statusText: 'offline in test' });
const { createPolicy, geneSetPolicy, POLICY_HEADER } = await import('../../../static/js/policy.js');
const { readRunPolicy, turnedOffNotice } = await import('../../../static/js/panels/gene-set-utilities/policy-gate.js');
const { createConsent, _resetSessionConsent } = await import('../../../static/js/panels/gene-set-utilities/consent.js');
const { registerAll } = await import('../../../static/js/panels/gene-set-utilities/services/index.js');
const { enabledAdapters } = await import('../../../static/js/panels/gene-set-utilities/registry.js');
registerAll();

const URL_EFFECTIVE = '/api/v1/policy/effective';

/** A reply as fetch gives it. */
function reply(status, body, headers = {}) {
    return {
        ok: status >= 200 && status < 300, status,
        headers: { get: (k) => headers[k] ?? headers[k.toLowerCase()] ?? null },
        json: async () => body
    };
}

/** A fetch that serves `server.policy` (null: no endpoint) and records its calls. */
function mockServer(policy) {
    const server = { policy, calls: [], fail: false };
    server.fetch = async (url) => {
        server.calls.push(String(url));
        if (server.fail) throw new TypeError('network down');
        if (!String(url).startsWith(URL_EFFECTIVE)) return reply(200, {}, server.policy ? { [POLICY_HEADER]: server.policy.version } : {});
        if (!server.policy) return reply(404, { error: 'not found' });
        return reply(200, server.policy, { [POLICY_HEADER]: server.policy.version });
    };
    return server;
}

const flush = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

test('load reads the resolved values and the version', async () => {
    const server = mockServer({ version: 'v1', values: { 'panel.gene-set.enabled': false, 'panel.cell-plot.enabled': true } });
    const policy = createPolicy({ fetchImpl: server.fetch, url: URL_EFFECTIVE });
    assert.equal(policy.isAvailable(), false);
    await policy.load();
    assert.equal(policy.isAvailable(), true);
    assert.equal(policy.version(), 'v1');
    assert.equal(policy.get('panel.gene-set.enabled'), false);
    assert.equal(policy.panelEnabled('gene-set'), false);
    assert.equal(policy.panelEnabled('cell-plot'), true);
    assert.equal(policy.panelEnabled('unlisted-type'), true, 'a type the policy does not name is not disabled');
    assert.equal(policy.get('nope', 7), 7);
});

test('a server without the endpoint falls back: nothing is set, nothing is disabled', async () => {
    const server = mockServer(null);
    const policy = createPolicy({ fetchImpl: server.fetch, url: URL_EFFECTIVE });
    const state = await policy.load();
    assert.equal(state.available, false);
    assert.deepEqual(policy.values(), {});
    assert.equal(policy.panelEnabled('gene-set'), true);
    assert.deepEqual(await policy.fresh(), { status: 'absent' });
    // and the gene-set panel gets exactly what /config said
    const integ = { externalRequests: 'ask', services: ['string'] };
    assert.deepEqual(geneSetPolicy(policy.values(), integ),
        { externalRequests: 'ask', services: ['string'], links: true, speciesSearch: true, outbound: true });
});

test('a network error or a 500 at load does not throw and sets nothing', async () => {
    const server = mockServer({ version: 'v1', values: { 'panel.gene-set.enabled': false } });
    server.fail = true;
    const policy = createPolicy({ fetchImpl: server.fetch, url: URL_EFFECTIVE });
    await policy.load();
    assert.equal(policy.isAvailable(), false);
    assert.equal(policy.panelEnabled('gene-set'), true);
    const bad = createPolicy({ fetchImpl: async () => reply(500, {}), url: URL_EFFECTIVE });
    await bad.load();
    assert.equal(bad.isAvailable(), false);
    const garbage = createPolicy({ fetchImpl: async () => reply(200, { values: [1] }), url: URL_EFFECTIVE });
    await garbage.load();
    assert.equal(garbage.isAvailable(), false);
});

test('a reply with another X-AnnZarro-Policy version reloads the policy, once', async () => {
    const server = mockServer({ version: 'v1', values: { 'panel.gene-set.enabled': true } });
    const policy = createPolicy({ fetchImpl: server.fetch, url: URL_EFFECTIVE });
    await policy.load();
    const seen = [];
    policy.onChange((s) => seen.push(s.version));
    const calls = () => server.calls.filter(u => u.startsWith(URL_EFFECTIVE)).length;
    assert.equal(calls(), 1);

    // same version: no read
    policy.observe(reply(200, {}, { [POLICY_HEADER]: 'v1' }), '/api/v1/data/info');
    await flush();
    assert.equal(calls(), 1);
    // no header (an older server, or a reply that is not the API's): no read
    policy.observe(reply(200, {}), '/api/v1/data/info');
    policy.observe(reply(200, {}, { [POLICY_HEADER]: 'v9' }), 'https://string-db.org/api/json/enrichment');
    await flush();
    assert.equal(calls(), 1);

    // the admin changes the policy; the next API reply carries the new version
    server.policy = { version: 'v2', values: { 'panel.gene-set.enabled': false } };
    policy.observe(reply(200, {}, { [POLICY_HEADER]: 'v2' }), '/api/v1/data/info');
    policy.observe(reply(200, {}, { [POLICY_HEADER]: 'v2' }), '/api/v1/data/obs');
    await flush();
    assert.equal(calls(), 2, 'two replies, one read');
    assert.equal(policy.version(), 'v2');
    assert.equal(policy.panelEnabled('gene-set'), false);
    assert.deepEqual(seen, ['v2']);
    // the policy's own reply does not trigger another read
    policy.observe(reply(200, {}, { [POLICY_HEADER]: 'v3' }), `${URL_EFFECTIVE}?keys=a`);
    await flush();
    assert.equal(calls(), 2);
});

test('installFetchObserver watches the page\'s own fetches and leaves the policy read alone', async () => {
    const server = mockServer({ version: 'v1', values: {} });
    const target = { fetch: server.fetch };
    const policy = createPolicy({ url: URL_EFFECTIVE });
    policy.installFetchObserver(target);
    policy.installFetchObserver(target); // once
    await policy.load();
    server.policy = { version: 'v2', values: { 'panel.gene-table.enabled': false } };
    const r = await target.fetch('/api/v1/data/info');
    assert.equal(r.status, 200, 'the caller still gets its reply');
    await flush();
    assert.equal(policy.version(), 'v2');
    assert.equal(policy.panelEnabled('gene-table'), false);
    assert.equal(server.calls.filter(u => u.startsWith(URL_EFFECTIVE)).length, 2);
});

test('fresh() reads the keys asked for and merges them', async () => {
    const server = mockServer({ version: 'v1', values: { 'outbound.allow_external': true, 'panel.gene-set.links': true } });
    const policy = createPolicy({ fetchImpl: server.fetch, url: URL_EFFECTIVE });
    await policy.load();
    server.policy = { version: 'v2', values: { 'outbound.allow_external': false } };
    const r = await policy.fresh(['outbound.allow_external']);
    assert.equal(r.status, 'ok');
    assert.ok(server.calls.at(-1).endsWith('?keys=outbound.allow_external'));
    assert.equal(policy.get('outbound.allow_external'), false);
    assert.equal(policy.get('panel.gene-set.links'), true, 'keys not asked for are kept');
});

test('geneSetPolicy: the config when the policy is silent, the policy over it, the switch over all', () => {
    const integ = { externalRequests: 'on', services: null };
    assert.deepEqual(geneSetPolicy({}, integ),
        { externalRequests: 'on', services: null, links: true, speciesSearch: true, outbound: true });
    assert.deepEqual(geneSetPolicy({ 'panel.gene-set.external_requests': 'ask', 'panel.gene-set.services': ['string', 5] }, integ),
        { externalRequests: 'ask', services: ['string'], links: true, speciesSearch: true, outbound: true });
    assert.equal(geneSetPolicy({ 'panel.gene-set.external_requests': 'bogus' }, integ).externalRequests, 'on', 'an unknown mode is ignored');
    assert.equal(geneSetPolicy({ 'panel.gene-set.external_requests': 'off' }, integ).links, true, 'off sends nothing but links work');
    const none = { externalRequests: 'off', services: [], links: false, speciesSearch: false, outbound: false };
    assert.deepEqual(geneSetPolicy({ 'panel.gene-set.external_requests': 'none' }, integ), none);
    assert.deepEqual(geneSetPolicy({ 'outbound.allow_external': false }, integ), none);
    assert.deepEqual(geneSetPolicy({ 'outbound.allow_external': false, 'panel.gene-set.links': true }, integ), none);
    assert.equal(geneSetPolicy({ 'panel.gene-set.links': false }, integ).links, false);
    assert.equal(geneSetPolicy({ 'panel.gene-set.species_search': false }, integ).speciesSearch, false);
});

test('a Run after the administrator switched outbound off sends nothing', async () => {
    _resetSessionConsent();
    const integ = { externalRequests: 'on', services: null };
    const server = mockServer({ version: 'v1', values: { 'outbound.allow_external': true } });
    const policy = createPolicy({ fetchImpl: server.fetch, url: URL_EFFECTIVE });
    await policy.load();

    // the tab as it was opened: every service offered, sent without asking
    const opened = geneSetPolicy(policy.values(), integ);
    const offered = enabledAdapters({ ...integ, services: opened.services });
    assert.ok(offered.length > 0);
    const request = { host: 'string-db.org', persistable: true };
    assert.equal(createConsent({ policy: opened.externalRequests }).decide(request).answer, 'send');

    // mid-session the admin flips the switch; no reply has reached the tab yet
    server.policy = { version: 'v2', values: { 'outbound.allow_external': false } };
    const run = await readRunPolicy(policy, integ);
    assert.equal(run.unreadable, false);
    assert.equal(run.gs.externalRequests, 'off');
    assert.deepEqual(enabledAdapters({ ...integ, services: run.gs.services }), [], 'no service is left to run');
    assert.equal(createConsent({ policy: run.gs.externalRequests }).decide(request).answer, 'deny');
    assert.equal(run.gs.links, false);
    assert.match(turnedOffNotice(opened, run.gs, offered), /turned off by the administrator: nothing was sent/);
});

test('a Run after one service was turned off drops that service only', async () => {
    const integ = { externalRequests: 'ask', services: null };
    const server = mockServer({ version: 'v1', values: {} });
    const policy = createPolicy({ fetchImpl: server.fetch, url: URL_EFFECTIVE });
    await policy.load();
    const before = geneSetPolicy(policy.values(), integ);
    const had = enabledAdapters({ ...integ, services: before.services });
    server.policy = { version: 'v2', values: { 'panel.gene-set.services': ['string', 'gprofiler'] } };
    const run = await readRunPolicy(policy, integ);
    const left = enabledAdapters({ ...integ, services: run.gs.services });
    assert.ok(left.length > 0 && left.length < had.length);
    assert.ok(left.every(a => ['string', 'gprofiler'].includes(a.id.split('-')[0])));
    const gone = had.filter(a => !left.includes(a));
    assert.match(turnedOffNotice(before, run.gs, gone), /^The administrator turned off /);
});

test('a policy that exists but cannot be read at Run sends nothing', async () => {
    const integ = { externalRequests: 'on', services: null };
    const server = mockServer({ version: 'v1', values: {} });
    const policy = createPolicy({ fetchImpl: server.fetch, url: URL_EFFECTIVE });
    await policy.load();
    server.fail = true;
    const run = await readRunPolicy(policy, integ);
    assert.equal(run.unreadable, true);
    assert.equal(run.gs.externalRequests, 'off');
    assert.match(run.notice, /could not be read: nothing was sent/);
    // on a server that never had a policy, the same failure is not a policy failure
    const none = mockServer(null);
    const plain = createPolicy({ fetchImpl: none.fetch, url: URL_EFFECTIVE });
    await plain.load();
    none.fail = true;
    const ok = await readRunPolicy(plain, integ);
    assert.equal(ok.unreadable, false);
    assert.equal(ok.gs.externalRequests, 'on');
});

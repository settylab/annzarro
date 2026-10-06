/**
 * What the Gene Set Analysis panel saves, what it reads back, and the
 * server's switch for its external requests.
 *
 *   - getConfig() is an explicit list of keys (state.js configOf): never the
 *     snapshot, a result, an error or a consent. A share link must not carry
 *     one person's gene list or a third party's results, and must stay short,
 *     whatever the selection (30k genes).
 *   - A link from another build (sections this one lacks, sections it does
 *     not list, bad params) loads with defaults, keeps what it does not know,
 *     and never throws.
 *   - The source table is stored under `tableFilter`, so the panel set's id
 *     remapping (deeplink.js remapPanelReferences) already follows it.
 *   - integrations.external_requests: ask (default) | on | off; YAML's
 *     booleans for a bare on/off; anything else is ask. The consent store.
 *
 * Run:  node --test annzarro/tests/js/gene-set-config.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.fetch = async () => ({ ok: false, statusText: 'offline in test' });
const { readIntegrations, Config } = await import('../../../static/js/config.js');
const S = await import('../../../static/js/panels/gene-set-utilities/state.js');
const { ADAPTERS } = await import('../../../static/js/panels/gene-set-utilities/services/index.js');
const { remapPanelReferences, serializableConfig, panelSetToView, encodeView, decodeView } = await import('../../../static/js/utils/deeplink.js');
const { createConsent, STORAGE_KEY, _resetSessionConsent } = await import('../../../static/js/panels/gene-set-utilities/consent.js');

const SECTION6_KEYS = ['id', 'title', 'tableFilter', 'idColumn', 'idType', 'autoUpdate', 'sections', 'sectionOrder', 'links', 'controlsVisible'];

function configFor(stored, extra = {}) {
    const settings = S.normalizeConfig(stored, ADAPTERS);
    return S.configOf({ id: 'gene-set-1759000000000', title: 'Gene Set Analysis 1', settings, adapters: ADAPTERS, ...extra });
}

test('getConfig has exactly the saved keys, nothing derived, and stays small at 30k genes', () => {
    const cfg = configFor({ tableFilter: 'gene-table-1759000000000' }, { controlsVisible: true });
    assert.deepEqual(Object.keys(cfg).sort(), [...SECTION6_KEYS].sort());
    assert.deepEqual(S.CONFIG_KEYS.slice().sort(), [...SECTION6_KEYS, 'consent'].sort(), 'consent only when given');
    // a snapshot of 30k genes and its results live elsewhere: nothing of them is saved
    const snapshot = S.makeSnapshot({ genes: Array.from({ length: 30000 }, (_, i) => `GENE${i}`),
        names: Array.from({ length: 30000 }, (_, i) => `GENE${i}`), sourceId: 'gene-table-1', sourceTitle: 'T',
        taxonomyId: '9606', idColumn: '_index', takenAt: 0 });
    assert.equal(snapshot.count, 30000);
    const json = JSON.stringify(cfg);
    assert.ok(json.length < 1024, `config is ${json.length} characters`);
    assert.ok(!/GENE\d/.test(json));
    for (const key of ['snapshot', 'runs', 'results', 'consent', 'currentEntries']) assert.ok(!(key in cfg), key);
    // every section has visible + params; Enrichr, Reactome and HPA are off by default
    for (const a of ADAPTERS) assert.deepEqual(Object.keys(cfg.sections[a.id]).sort(), ['params', 'visible']);
    assert.equal(cfg.sections.enrichr.visible, false);
    assert.equal(cfg.sections.links.visible, true);
    assert.equal(cfg.sectionOrder[0], 'links');
    assert.equal(cfg.autoUpdate, false, 'auto-update is off by default');
    assert.equal(cfg.idColumn, 'auto', 'the id column is found in var by default');
    assert.equal(cfg.idType, 'auto', 'and read by its values');
    // the dataset as background by default, the genome on request
    assert.equal(S.normalizeConfig({}, ADAPTERS).sections['string-enrichment'].params.background, 'dataset');
    assert.equal(S.normalizeConfig({}, ADAPTERS).sections['gprofiler-gost'].params.background, 'dataset');
    assert.equal(serializableConfig(cfg).tableFilter, 'gene-table-1759000000000', 'not a derived key');
    // params at their default are not saved; a changed one is, and reads back
    assert.deepEqual(cfg.sections['string-network'].params, {});
    const changed = S.normalizeConfig({ sections: { 'string-network': { visible: true, params: { requiredScore: 700 } } } }, ADAPTERS);
    const saved = S.configOf({ id: 'g', title: 't', settings: changed, adapters: ADAPTERS });
    assert.deepEqual(saved.sections['string-network'].params, { requiredScore: 700 });
    assert.deepEqual(S.normalizeConfig(saved, ADAPTERS).sections['string-network'].params,
        { requiredScore: 700, networkType: 'functional', hideDisconnected: false });
});

test('a config from another build: unknown sections kept, missing ones default, bad params repaired, never throws', () => {
    const warnings = [];
    const settings = S.normalizeConfig({
        tableFilter: 'gene-table-9', idColumn: 'gene_symbols', autoUpdate: true,
        sections: { 'future-service': { visible: true, params: { x: 1 } },
            'string-network': { visible: false, params: { requiredScore: 123, networkType: 'physical', bogus: 1 } },
            'gprofiler-gost': { visible: true, params: { sources: ['GO:BP', 'NOPE'] } }, junk: null },
        sectionOrder: ['future-service', 'string-network', 42],
        links: { columns: ['ncbi', 7], listOpen: true }
    }, ADAPTERS, (m) => warnings.push(m));
    assert.equal(settings.sections['future-service'].visible, true, 'kept for the round trip');
    assert.equal(settings.sections['string-network'].visible, false);
    assert.deepEqual(settings.sections['string-network'].params, { requiredScore: 400, networkType: 'physical', hideDisconnected: false });
    assert.deepEqual(settings.sections['gprofiler-gost'].params.sources, ['GO:BP', 'GO:MF', 'GO:CC', 'KEGG', 'REAC', 'WP']);
    assert.equal(settings.sections['mygene-card'].visible, true, 'a section the link did not list gets its default');
    assert.equal(settings.sectionOrder[0], 'future-service');
    for (const a of ADAPTERS) assert.ok(settings.sectionOrder.includes(a.id));
    assert.ok(settings.sectionOrder.includes('links'));
    assert.deepEqual(settings.links, { columns: ['ncbi'], listOpen: true });
    assert.ok(warnings.length >= 2, warnings.join('\n'));
    for (const junk of [null, undefined, 'x', 42, [], { sections: 'x', sectionOrder: 'y', links: 5 }]) {
        assert.doesNotThrow(() => S.normalizeConfig(junk, ADAPTERS));
    }
    // and it saves what it read, unknown sections included
    const again = S.configOf({ id: 'g', title: 't', settings });
    assert.ok(again.sections['future-service']);
});

test('the panel set id remap follows the source table; a share link round trip keeps the settings', () => {
    const gs = { id: 'gene-set-2', ...configFor({ tableFilter: 'gene-table-1', autoUpdate: true }) };
    const plot = { id: 'cell-plot-3', tableFilter: 'gene-table-1' };
    remapPanelReferences([gs, plot], { 'gene-table-1': 'gene-table-77' });
    assert.equal(gs.tableFilter, 'gene-table-77');
    assert.equal(plot.tableFilter, 'gene-table-77');
    const layout = { v: 1, hierarchy: [{ type: 'tile', id: 'gene-set-2' }], controlState: {}, panelConfigs: { 'gene-set-2': gs } };
    const view = decodeView(encodeView({ v: 1, constants: { taxonomyId: '10090' }, layout }));
    assert.deepEqual(view.layout.panelConfigs['gene-set-2'], gs);
    const set = panelSetToView({ dataset: 'x.zarr', view: { v: 1, constants: { taxonomyId: '10090' }, layout } });
    const back = S.normalizeConfig(set.view.layout.panelConfigs['gene-set-2'], ADAPTERS);
    assert.equal(back.tableFilter, 'gene-table-77');
    assert.equal(back.autoUpdate, true);
    assert.equal(set.view.constants.taxonomyId, '10090', 'the species rides in the view constants, not the panel');
});

test('integrations: ask by default; on, off and YAML booleans; anything else is ask', () => {
    assert.equal(readIntegrations(null).externalRequests, 'ask');
    assert.equal(readIntegrations({}).externalRequests, 'ask');
    assert.equal(readIntegrations({ integrations: { external_requests: 'off' } }).externalRequests, 'off');
    assert.equal(readIntegrations({ integrations: { external_requests: ' ON ' } }).externalRequests, 'on');
    assert.equal(readIntegrations({ integrations: { external_requests: false } }).externalRequests, 'off');
    assert.equal(readIntegrations({ integrations: { external_requests: true } }).externalRequests, 'on');
    assert.equal(readIntegrations({ integrations: { external_requests: 'sometimes' } }).externalRequests, 'ask');
    assert.equal(readIntegrations({ integrations: 'nonsense' }).externalRequests, 'ask');
    const full = readIntegrations({ integrations: { gene_set: { services: ['string', 7], timeout_ms: 5000 },
        string_db: { base_url: 'https://version-12-5.string-db.org/api', version: 12.5 } } });
    assert.deepEqual(full.services, ['string']);
    assert.equal(full.timeoutMs, 5000);
    assert.deepEqual(full.stringDb, { baseUrl: 'https://version-12-5.string-db.org/api', version: '12.5' });
    assert.equal(readIntegrations({ integrations: { string_db: { base_url: 'http://insecure' } } }).stringDb.baseUrl, null);
    assert.equal(readIntegrations({ integrations: { gene_set: { timeout_ms: -1 } } }).timeoutMs, 20000);
    // the client's defaults: STRING pinned to 12.5, the panel offered
    assert.equal(Config.STRING_DB.BASE_URL, 'https://version-12-5.string-db.org/api');
    assert.equal(Config.STRING_DB.VERSION, '12.5');
    assert.equal(Config.INTEGRATIONS.externalRequests, 'ask');
    assert.ok(Config.DEFAULTS.ENABLED_PANEL_TYPES.includes('gene-set'));
});

function memoryStorage(initial = {}) {
    const data = { ...initial };
    return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}

const STRING_HOST = { host: 'version-12-5.string-db.org', persistable: true };
const GP = { host: 'biit.cs.ut.ee', persistable: true };
const ENRICHR = { host: 'maayanlab.cloud', persistable: false };

test('consent: asked once per host; "Always" remembered, never for a service that publishes lists', () => {
    _resetSessionConsent();
    const storage = memoryStorage();
    const c = createConsent({ policy: 'ask', storage });
    const reqs = [STRING_HOST, ENRICHR, STRING_HOST];
    assert.deepEqual(c.missing(reqs).map(r => r.host), [STRING_HOST.host, ENRICHR.host]);
    c.grant(c.missing(reqs), { always: true });
    assert.deepEqual(JSON.parse(storage.data[STORAGE_KEY]), { [STRING_HOST.host]: 'allow' }, 'Enrichr is never remembered');
    assert.deepEqual(c.missing(reqs), [], 'this page: both agreed');
    _resetSessionConsent();
    assert.deepEqual(createConsent({ policy: 'ask', storage }).missing(reqs).map(r => r.host), [ENRICHR.host],
        'next page: STRING remembered, Enrichr asked again');
    // the earlier stored form (a list of hosts) still reads as "always"
    _resetSessionConsent();
    const legacy = memoryStorage({ [STORAGE_KEY]: JSON.stringify([GP.host]) });
    assert.equal(createConsent({ policy: 'ask', storage: legacy }).decide(GP).answer, 'send');
    // storage that throws: asked again, nothing breaks
    _resetSessionConsent();
    const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    const b = createConsent({ policy: 'ask', storage: broken });
    assert.equal(b.missing(reqs).length, 2);
    assert.doesNotThrow(() => b.grant(reqs, { always: true }));
    assert.doesNotThrow(() => b.deny(reqs));
    _resetSessionConsent();
});

test('consent precedence: server off > server on > the user\'s Never > a link for this selection > the page\'s or the user\'s yes > ask', () => {
    _resetSessionConsent();
    const link = { selection: 'sel-A', hosts: [STRING_HOST.host, ENRICHR.host] };
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ [GP.host]: 'deny' }) });
    const at = (policy, selection, extra = {}) => createConsent({ policy, storage, link, selection, ...extra });
    // the server's off wins over everything, its on over the user's Never and the link
    assert.deepEqual(at('off', 'sel-A').decide(STRING_HOST), { answer: 'deny', why: 'server' });
    assert.deepEqual(at('on', 'sel-A').decide(GP), { answer: 'send', why: 'server' });
    // ask: the link's consent covers exactly its selection
    assert.deepEqual(at('ask', 'sel-A').decide(STRING_HOST), { answer: 'send', why: 'link' });
    assert.equal(at('ask', 'sel-B').decide(STRING_HOST).answer, 'ask', 'another selection falls back to the user (here: ask)');
    assert.equal(at('ask', null).decide(STRING_HOST).answer, 'ask');
    // never for a service that publishes lists, even when the link names it
    assert.equal(at('ask', 'sel-A').decide(ENRICHR).answer, 'ask');
    // the user's stored Never stays a Never, also under a link that names the host
    const withGp = createConsent({ policy: 'ask', storage, link: { selection: 'sel-A', hosts: [GP.host] }, selection: 'sel-A' });
    assert.deepEqual(withGp.decide(GP), { answer: 'deny', why: 'user' });
    assert.deepEqual(withGp.denied([GP, STRING_HOST]), [GP.host]);
    // the user's earlier Always applies when the link does not
    const s2 = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ [STRING_HOST.host]: 'allow' }) });
    assert.deepEqual(createConsent({ policy: 'ask', storage: s2, link, selection: 'sel-B' }).decide(STRING_HOST), { answer: 'send', why: 'user' });
    // Never, then forgotten: asked again
    const s3 = memoryStorage();
    const c = createConsent({ policy: 'ask', storage: s3 });
    c.deny([STRING_HOST, ENRICHR]);
    assert.deepEqual(JSON.parse(s3.data[STORAGE_KEY]), { [STRING_HOST.host]: 'deny' });
    assert.equal(c.decide(STRING_HOST).answer, 'deny');
    c.forget([STRING_HOST.host]);
    assert.equal(c.decide(STRING_HOST).answer, 'ask');
    _resetSessionConsent();
});

test('a link\'s consent is kept only when well formed, and saved with the panel', () => {
    assert.equal(S.readLinkConsent(null), null);
    assert.equal(S.readLinkConsent({ selection: '', hosts: ['a.org'] }), null);
    assert.equal(S.readLinkConsent({ selection: 'x', hosts: [] }), null);
    assert.deepEqual(S.readLinkConsent({ selection: 'x', hosts: ['a.org', 'a.org', 'bad host/', 7] }), { selection: 'x', hosts: ['a.org'] });
    const settings = S.normalizeConfig({ consent: { selection: 'h1', hosts: ['string-db.org'] } }, ADAPTERS);
    const cfg = S.configOf({ id: 'g', title: 't', settings, adapters: ADAPTERS });
    assert.deepEqual(cfg.consent, { selection: 'h1', hosts: ['string-db.org'] });
    assert.ok(!('consent' in configFor({})), 'no consent, no key');
});

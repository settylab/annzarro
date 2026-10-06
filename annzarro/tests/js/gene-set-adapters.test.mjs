/**
 * The Gene Set Analysis panel's service adapters
 * (panels/gene-set-utilities/services/*.js).
 *
 * Every adapter keeps the contract the panel relies on (registry.js); each
 * reads a recorded reply (gene-set-fixtures/, recorded 2026-10-05 from
 * STRING 12.5, g:Profiler, MyGene.info and the Human Protein Atlas for
 * TP53 MDM2 ATM CDKN1A CHEK2 NOTAGENE; Enrichr's and Reactome's are written
 * from their documented shapes, because both keep what they are sent where
 * others can read it) into the rows and the coverage it states; and what a
 * service returns reaches the page as text: a term named
 * `<img src=x onerror=alert(1)>` is shown, not run. The DOM stand-in below
 * throws on any innerHTML write.
 *
 * Run:  node --test annzarro/tests/js/gene-set-adapters.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const registry = await import('../../../static/js/panels/gene-set-utilities/registry.js');
const { ADAPTERS, registerAll } = await import('../../../static/js/panels/gene-set-utilities/services/index.js');
const { makeDom, sci } = await import('../../../static/js/panels/gene-set-utilities/dom.js');
const { xrefsOf } = await import('../../../static/js/panels/gene-set-utilities/services/mygene.js');
const { organismFor, _resetOrganisms } = await import('../../../static/js/panels/gene-set-utilities/services/gprofiler.js');
const { checkParams, blockedReason } = await import('../../../static/js/panels/gene-set-utilities/state.js');
const { _resetBackgrounds } = await import('../../../static/js/panels/gene-set-utilities/services/string.js');
const { httpError, bodyExcerpt } = await import('../../../static/js/panels/gene-set-utilities/fetch-policy.js');
const { mappedCoverage } = await import('../../../static/js/panels/gene-set-utilities/services/common.js');

const FIX = new URL('./gene-set-fixtures/', import.meta.url);
const fixture = (name) => readFileSync(new URL(name, FIX), 'utf8');
const byId = Object.fromEntries(ADAPTERS.map(a => [a.id, a]));

// --- a DOM stand-in: elements with text, attributes and children; no innerHTML --------
class Node_ {
    constructor(doc) { this.ownerDocument = doc; this.childNodes = []; this.parentNode = null; }
    get firstChild() { return this.childNodes[0] || null; }
    get textContent() { return this.childNodes.map(c => c.textContent).join(''); }
    set textContent(v) { this.childNodes = []; if (v !== '') this.appendChild(new Text_(this.ownerDocument, String(v))); }
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.childNodes.push(c); return c; }
    append(...cs) { for (const c of cs) this.appendChild(typeof c === 'string' ? new Text_(this.ownerDocument, c) : c); }
    removeChild(c) { this.childNodes = this.childNodes.filter(x => x !== c); c.parentNode = null; return c; }
    insertBefore(c, ref) { this.appendChild(c); if (ref) { this.childNodes.pop(); this.childNodes.splice(this.childNodes.indexOf(ref), 0, c); } return c; }
}
class Text_ extends Node_ {
    constructor(doc, text) { super(doc); this.nodeType = 3; this._t = text; }
    get textContent() { return this._t; }
}
class Element_ extends Node_ {
    constructor(doc, tag) {
        super(doc); this.nodeType = 1; this.tagName = tag.toUpperCase(); this.attributes = {}; this.dataset = {};
        this.className = ''; this.listeners = {}; this.hidden = false;
        this.classList = { add: (c) => { this.className += ` ${c}`; }, remove: () => {}, toggle: () => {}, contains: (c) => this.className.split(' ').includes(c) };
    }
    set innerHTML(v) { throw new Error(`innerHTML written: ${String(v).slice(0, 80)}`); }
    get innerHTML() { return ''; }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
    get children() { return this.childNodes.filter(c => c.nodeType === 1); }
    all(pred, out = []) { for (const c of this.children) { if (pred(c)) out.push(c); c.all(pred, out); } return out; }
    byTag(tag) { return this.all(c => c.tagName === tag.toUpperCase()); }
}
const doc = { createElement: (t) => new Element_(doc, t), createTextNode: (t) => new Text_(doc, t) };

function renderCtx(input, extra = {}) {
    const D = makeDom(doc);
    const images = [];
    return { ...D, sci, input, images, hasGene: () => false, focusGene: () => {}, nameOf: (x) => x,
        blobImage(blob, alt) { images.push({ blob, alt }); return D.el('img', { src: 'blob:fake', alt }); }, ...extra };
}

// --- a fake io: fixture replies by URL --------------------------------------------------
function fakeIo(routes) {
    const calls = [];
    const reply = (url, opts) => {
        calls.push({ url, opts });
        for (const [pat, fn] of routes) if (pat.test(url)) return fn(url, opts);
        throw new Error(`no fixture for ${url}`);
    };
    return { calls, signal: new AbortController().signal,
        fetchJson: async (url, opts) => JSON.parse(reply(url, opts)),
        fetchText: async (url, opts) => reply(url, opts),
        fetchBlob: async (url, opts) => new Blob([reply(url, opts)], { type: 'image/svg+xml' }),
        memo: async (key, fn) => fn(fakeIoRef.current) };
}
const fakeIoRef = { current: null };
function io(routes) { const i = fakeIo(routes); fakeIoRef.current = i; return i; }

const GENES = ['TP53', 'MDM2', 'ATM', 'CDKN1A', 'CHEK2', 'NOTAGENE'];
const base = (a, over = {}) => ({ genes: GENES, names: GENES, genesHash: 'h', focus: { id: 'TP53', name: 'TP53' },
    taxonomyId: '9606', speciesName: 'Homo sapiens', idType: 'symbol', params: checkParams(a.params, {}),
    background: null, backgroundHash: null, services: { string: { api: 'https://version-12-5.string-db.org/api', version: '12.5' } }, ...over });

const STRING_ROUTES = [
    [/get_string_ids$/, () => fixture('string-get_string_ids.json')],
    [/json\/enrichment$/, () => fixture('string-enrichment.json')],
    [/ppi_enrichment$/, () => fixture('string-ppi_enrichment.json')],
    [/svg\/network$/, () => fixture('string-network.svg')],
    [/interaction_partners$/, () => fixture('string-interaction_partners.json')]
];

test('every adapter keeps the contract; ids unique; registering twice is refused', () => {
    registry._resetRegistry();
    registerAll({ strict: true });
    const all = registry.allAdapters();
    assert.equal(all.length, ADAPTERS.length);
    assert.equal(new Set(all.map(a => a.id)).size, all.length);
    for (const a of all) {
        assert.deepEqual(registry.adapterProblems(a), [], a.id);
        assert.ok(a.fetch.length >= 2, `${a.id}.fetch(input, io)`);
        assert.ok(a.version, a.id);
        assert.ok(a.limits.maxGenes >= a.limits.minGenes);
        assert.ok(registry.hostsOf(a, base(a)).length >= 1);
        for (const tax of ['9606', '10090', '4932', '99999']) assert.ok([true, false, 'unknown'].includes(a.supportsSpecies(tax)), `${a.id} ${tax}`);
    }
    assert.throws(() => registry.registerAdapter(byId['string-enrichment'], { strict: true }), /duplicate id/);
    assert.throws(() => registry.registerAdapter({ id: 'Bad Id' }, { strict: true }), /id/);
    assert.ok(registry.adapterProblems({ ...byId['hpa'], fetch: async (x) => x }).includes('fetch(input, io)'));
    // the server's list narrows them, by adapter id or service name
    assert.deepEqual(registry.enabledAdapters({ services: ['string', 'hpa'] }).map(a => a.id).sort(),
        ['hpa', 'string-enrichment', 'string-network', 'string-partners']);
    assert.equal(registry.enabledAdapters({ services: null }).length, ADAPTERS.length);
    // STRING's host follows the configured (versioned) address
    assert.deepEqual(registry.hostsOf(byId['string-network'], base(byId['string-network'])), ['version-12-5.string-db.org']);
});

test('the default sections: off for Enrichr, Reactome, HPA (opt-in), on for STRING, g:Profiler, MyGene', () => {
    const off = ADAPTERS.filter(a => !a.defaultVisible).map(a => a.id).sort();
    assert.deepEqual(off, ['enrichr', 'hpa', 'reactome', 'string-partners']);
    assert.equal(byId.enrichr.privacy.stores, 'public');
    assert.match(byId.enrichr.privacy.text, /publicly viewable/);
    assert.equal(byId.reactome.privacy.stores, 'token');
});

test('STRING enrichment: mapping states 5 of 6 (NOTAGENE not found); a term named as HTML is shown as text', async () => {
    const a = byId['string-enrichment'];
    const i = io(STRING_ROUTES);
    const result = await a.fetch(base(a), i);
    assert.equal(result.mapped.length, 5);
    assert.deepEqual(result.unmapped, ['NOTAGENE']);
    assert.equal(result.terms.length, 44);
    const cov = a.coverage(result, base(a));
    assert.equal(cov.shown, 5);
    assert.equal(cov.total, 6);
    assert.match(cov.lines()[0], /STRING: not found by the service \(1 gene\) -- NOTAGENE/);
    // enrichment is asked for with the STRING ids, not the names
    const enr = i.calls.find(c => /json\/enrichment$/.test(c.url));
    assert.ok(enr.opts.form.identifiers.split('\r').every(s => s.startsWith('9606.ENSP')));
    const el = doc.createElement('div');
    const ctx = renderCtx(base(a));
    a.render(result, el, ctx);
    const table = el.byTag('table')[0];
    assert.equal(table.byTag('caption')[0].textContent, 'STRING functional enrichment');
    assert.ok(table.byTag('th').every(th => th.getAttribute('scope') === 'col'));
    assert.equal(table.byTag('tbody')[0].children.length, 25, 'the first 25 of 44 rows, then "Show all 44"');
    const more = el.byTag('button').find(b => b.textContent === 'Show all 44');
    more.listeners.click[0]();
    assert.equal(el.byTag('tbody')[0].children.length, 44, 'all of them, on request');
    assert.ok(el.textContent.includes('<img src=x onerror=alert(1)>'), 'shown as text');
    assert.equal(el.byTag('img').length, 0, 'no element made from it');
    const csv = a.exportRows(result);
    assert.equal(csv.rows.length, 44);
});

test('STRING enrichment against the dataset: the background is mapped once a page, said while mapping, sent as STRING ids', async () => {
    _resetBackgrounds();
    const a = byId['string-enrichment'];
    assert.equal(a.params.background.default, 'dataset', 'the dataset is the default background');
    const i = io(STRING_ROUTES);
    const said = [];
    i.progress = (t) => said.push(t);
    const input = base(a, { params: { background: 'dataset' }, background: [...GENES, 'GENE_X'], backgroundHash: 'bg' });
    const result = await a.fetch(input, i);
    assert.equal(result.backgroundSize, 5);
    assert.ok(i.calls.find(c => /json\/enrichment$/.test(c.url)).opts.form.background_string_identifiers.startsWith('9606.ENSP'));
    assert.match(a.describeRequest(input), /dataset's 7 genes as the background/);
    assert.match(said[0], /Mapping the dataset's 7 genes to STRING ids/);
    assert.equal(said[said.length - 1], '');
    // the same dataset and species again: no second mapping of the background
    const j = io(STRING_ROUTES);
    await a.fetch({ ...input, genesHash: 'other', genes: GENES.slice(0, 3) }, j);
    const mapped = j.calls.filter(c => /get_string_ids$/.test(c.url)).map(c => c.opts.form.identifiers.split('\r').length);
    assert.deepEqual(mapped, [3], 'only the selection is mapped; the background is reused');
    // the whole genome, on request: no background sent
    const k = io(STRING_ROUTES);
    const genome = await a.fetch(base(a, { params: { background: 'genome' } }), k);
    assert.equal(genome.backgroundSize, null);
    assert.ok(!('background_string_identifiers' in k.calls.find(c => /json\/enrichment$/.test(c.url)).opts.form));
});

test('ids are read as their type: g:Profiler gets Entrez ids with their namespace, MyGene its scopes', async () => {
    _resetOrganisms();
    const a = byId['gprofiler-gost'];
    const i = io([[/gost\/profile/, () => fixture('gprofiler-profile.json')]]);
    await a.fetch(base(a, { genes: ['7157', '4193'], idType: 'entrez', params: { ...base(a).params, background: 'genome' } }), i);
    assert.equal(i.calls[0].opts.json.numeric_namespace, 'ENTREZGENE_ACC');
    const j = io([[/gost\/profile/, () => fixture('gprofiler-profile.json')]]);
    await a.fetch(base(a, { params: { ...base(a).params, background: 'genome' } }), j);
    assert.ok(!('numeric_namespace' in j.calls[0].opts.json), 'symbols need no namespace');
    // the dataset background, by default
    const k = io([[/gost\/profile/, () => fixture('gprofiler-profile.json')]]);
    await a.fetch(base(a, { background: [...GENES, 'X'], backgroundHash: 'b' }), k);
    assert.equal(k.calls[0].opts.json.domain_scope, 'custom');
    assert.equal(k.calls[0].opts.json.background.length, 7);
    const m = byId['mygene-mapping'];
    for (const [type, scope] of [['ensembl', 'ensembl.gene'], ['entrez', 'entrezgene'], ['symbol', 'symbol']]) {
        const q = io([[/mygene\.info\/v3\/query$/, () => '[]']]);
        // nothing found at all: said as such (asserted below); the scope is what matters here
        await m.fetch(base(m, { idType: type, params: { aliases: false } }), q).catch(() => {});
        assert.equal(q.calls[0].opts.form.scopes, scope, type);
    }
});

test('Enrichr and Reactome say that their background is not the dataset', async () => {
    for (const [id, routes, re] of [['enrichr', [[/addList$/, () => fixture('enrichr-addList.json')], [/\/enrich$/, () => fixture('enrichr-enrich.json')]], /library's genes \(Enrichr takes no dataset background/],
        ['reactome', [[/projection/, () => fixture('reactome-projection.json')]], /genome only \(Reactome takes no custom background\)/]]) {
        const a = byId[id];
        const result = await a.fetch(base(a), io(routes));
        const el = doc.createElement('div');
        a.render(result, el, renderCtx(base(a)));
        assert.match(el.textContent, re, id);
    }
});

test('STRING network: an SVG blob shown only through ctx.blobImage, with an alt that counts', async () => {
    const a = byId['string-network'];
    const result = await a.fetch(base(a), io(STRING_ROUTES));
    assert.ok(result.image instanceof Blob);
    assert.equal(result.stats.nodes, 5);
    const el = doc.createElement('div');
    const ctx = renderCtx(base(a));
    a.render(result, el, ctx);
    assert.equal(ctx.images.length, 1);
    assert.equal(ctx.images[0].blob.type, 'image/svg+xml');
    assert.match(ctx.images[0].alt, /^STRING network, 5 genes, \d+ interactions$/);
    const links = el.byTag('a');
    assert.ok(links.some(l => l.getAttribute('href').startsWith('https://version-12-5.string-db.org/cgi/network?identifiers=9606.ENSP')));
    for (const l of links) {
        assert.equal(l.getAttribute('target'), '_blank');
        assert.match(l.getAttribute('rel'), /noopener/);
        assert.equal(l.getAttribute('referrerpolicy'), 'no-referrer');
        assert.match(l.getAttribute('aria-label'), /opens in a new tab/);
    }
});

test('STRING partners of the focused gene; a partner in the dataset is a button that focuses it', async () => {
    const a = byId['string-partners'];
    const result = await a.fetch(base(a), io(STRING_ROUTES));
    assert.ok(result.partners.length >= 3);
    const focused = [];
    const el = doc.createElement('div');
    a.render(result, el, renderCtx(base(a), { hasGene: (n) => n === result.partners[0].name, focusGene: (n) => focused.push(n) }));
    const buttons = el.byTag('button').filter(b => /^Focus /.test(b.getAttribute('aria-label') || ''));
    assert.equal(buttons.length, 1);
    buttons[0].listeners.click[0]();
    assert.deepEqual(focused, [result.partners[0].name]);
});

test('g:Profiler: failed genes stated, term genes read back from the evidence, organism by taxon', async () => {
    _resetOrganisms();
    const a = byId['gprofiler-gost'];
    const i = io([[/gost\/profile/, () => fixture('gprofiler-profile.json')]]);
    const result = await a.fetch(base(a), i);
    assert.deepEqual(result.failed, ['NOTAGENE']);
    assert.equal(result.terms.length, 30);
    assert.ok(result.terms[0].genes.length > 0 && result.terms[0].genes.every(g => GENES.includes(g)));
    const body = i.calls[0].opts.json;
    assert.deepEqual(Object.keys(body).sort(), ['no_evidences', 'organism', 'query', 'significance_threshold_method', 'sources', 'user_threshold'],
        'only documented keys (unknown ones made g:Profiler answer 500)');
    assert.equal(body.organism, 'hsapiens');
    assert.equal(a.coverage(result, base(a)).shown, 5);
    // an organism outside the built-in map comes from its organisms list, read once
    const list = [{ id: 'sstibetan', taxonomy_id: '9823', scientific_name: 'Sus scrofa' }, { id: 'btaurus', taxonomy_id: '9913', scientific_name: 'Bos taurus' }];
    const oi = io([[/organisms_list/, () => JSON.stringify(list)]]);
    assert.equal(await organismFor('9913', oi), 'btaurus');
    assert.equal(await organismFor('1', oi), null);
    assert.equal(oi.calls.length, 1, 'the list is read once a page');
    // a species g:Profiler lacks is said so, as such
    _resetOrganisms();
    await assert.rejects(a.fetch(base(a, { taxonomyId: '1', speciesName: '' }), io([[/organisms_list/, () => '[]']])), (e) => e.kind === 'species');
});

test('MyGene lookup: exact matches, alias matches flagged (never mixed in), the unmapped listed', async () => {
    const a = byId['mygene-mapping'];
    const genes = ['TP53', 'MDM2', 'ATM', 'CDKN1A', 'CHEK2', 'NOTAGENE', 'P53'];
    const i = io([[/mygene\.info\/v3\/query$/, (url, opts) => fixture(opts.form.scopes === 'alias' ? 'mygene-query-alias.json' : 'mygene-query-symbol.json')]]);
    const result = await a.fetch(base(a, { genes }), i);
    const by = Object.fromEntries(result.rows.map(r => [r.query, r]));
    assert.equal(by.TP53.match, 'exact');
    assert.equal(by.P53.match, 'alias');
    assert.equal(by.P53.symbol, 'TP53');
    assert.equal(by.NOTAGENE.match, 'none');
    assert.equal(i.calls.length, 2);
    assert.deepEqual(i.calls[1].opts.form.q.split(','), ['NOTAGENE', 'P53'], 'only the misses are tried as aliases');
    const cov = a.coverage(result, base(a, { genes }));
    assert.equal(cov.shown, 6);
    assert.deepEqual(cov.gaps[0].names, ['NOTAGENE'], 'the gene not found is named in the strip, not in the card');
    const el = doc.createElement('div');
    a.render(result, el, renderCtx(base(a, { genes })));
    assert.match(el.textContent, /1 only as an alias \(flagged\)/);
    assert.match(el.textContent, /P53 → TP53/);
    assert.doesNotMatch(el.textContent, /not found/, 'said once, in the strip');
    // aliases off: one request, no alias rows
    const j = io([[/mygene\.info\/v3\/query$/, () => fixture('mygene-query-symbol.json')]]);
    const strict = await a.fetch(base(a, { genes, params: { aliases: false } }), j);
    assert.equal(j.calls.length, 1);
    assert.equal(strict.rows.find(r => r.query === 'P53').match, 'none');
    // in batches of 1,000
    const big = Array.from({ length: 2500 }, (_, n) => `G${n}`);
    const k = io([[/mygene\.info\/v3\/query$/, () => '[]']]);
    await assert.rejects(a.fetch(base(a, { genes: big, params: { aliases: false } }), k), (e) => e.kind === 'unmapped');
    assert.deepEqual(k.calls.map(c => c.opts.form.q.split(',').length), [1000, 1000, 500]);
});

test('MyGene gene card: the ids the Links section uses', async () => {
    const a = byId['mygene-card'];
    const i = io([[/mygene\.info\/v3\/query$/, () => fixture('mygene-card.json')]]);
    const result = await a.fetch(base(a), i);
    assert.equal(i.calls[0].opts.query.q, 'symbol:"TP53"');
    assert.equal(result.match, 'exact');
    assert.deepEqual(xrefsOf(result.hit), { symbol: 'TP53', entrez: '7157', ensembl: 'ENSG00000141510', uniprot: 'P04637', mim: '191170', hgnc: '11998' });
    const el = doc.createElement('div');
    a.render(result, el, renderCtx(base(a)));
    assert.match(el.textContent, /tumor protein p53/);
    // no exact symbol: looked up as an alias, and said so
    let n = 0;
    const j = io([[/mygene\.info\/v3\/query$/, () => (++n === 1 ? '{"total":0,"hits":[]}' : fixture('mygene-card.json'))]]);
    const alias = await a.fetch(base(a, { focus: { id: 'P53', name: 'P53' } }), j);
    assert.equal(alias.match, 'alias');
    assert.equal(j.calls[1].opts.query.q, 'alias:"P53"');
    const el2 = doc.createElement('div');
    a.render(alias, el2, renderCtx(base(a, { focus: { id: 'P53', name: 'P53' } })));
    assert.match(el2.textContent, /P53 is not a Homo sapiens symbol; this is TP53/);
});

test('Human Protein Atlas: the exact gene out of a fuzzy search; human only', async () => {
    const a = byId.hpa;
    const result = await a.fetch(base(a), io([[/proteinatlas/, () => fixture('hpa-search.json')]]));
    assert.equal(result.row.gene, 'TP53');
    assert.equal(result.row.ensembl, 'ENSG00000141510');
    assert.ok(result.row.location.length);
    assert.equal(a.supportsSpecies('10090'), false);
    assert.equal(blockedReason(a, base(a, { taxonomyId: '10090', speciesName: 'Mus musculus' })).kind, 'species');
    const none = await a.fetch(base(a, { focus: { id: 'NOTAGENE', name: 'NOTAGENE' } }), io([[/proteinatlas/, () => fixture('hpa-search.json')]]));
    assert.equal(none.row, null);
});

test('Enrichr: list stored once, library asked, its HTML-looking term shown as text; symbols only', async () => {
    const a = byId.enrichr;
    const i = io([[/addList$/, () => fixture('enrichr-addList.json')], [/\/enrich$/, () => fixture('enrichr-enrich.json')]]);
    const result = await a.fetch(base(a), i);
    assert.equal(i.calls[0].opts.multipart.description, 'annzarro', 'no dataset name or path is sent');
    assert.equal(result.terms.length, 3);
    assert.equal(a.openUrl(base(a), result), 'https://maayanlab.cloud/Enrichr/enrich?dataset=e6cdbeb5df9066dbd49b27166c7f4748');
    const el = doc.createElement('div');
    a.render(result, el, renderCtx(base(a)));
    assert.ok(el.textContent.includes('<b>Not bold</b> (GO:0000000)'));
    assert.equal(el.byTag('b').length, 0);
    assert.match(el.textContent, /anyone can read it/);
    assert.equal(blockedReason(a, base(a, { idType: 'ensembl' })).kind, 'idtype');
    await assert.rejects(a.fetch(base(a, { params: { library: 'GO_Biological_Process_2025' } }), io([[/addList$/, () => fixture('enrichr-addList.json')], [/\/enrich$/, () => '{}']])),
        /no results for library/);
});

test('Reactome: projected analysis, link to the result, unmatched counted', async () => {
    const a = byId.reactome;
    const i = io([[/projection/, () => fixture('reactome-projection.json')]]);
    const result = await a.fetch(base(a, { taxonomyId: '10090', speciesName: 'Mus musculus' }), i);
    assert.equal(i.calls[0].opts.query.species, 'Mus musculus');
    assert.equal(i.calls[0].opts.text, GENES.join('\n'));
    assert.equal(result.pathways.length, 2);
    assert.equal(a.coverage(result, base(a)).shown, 5);
    assert.equal(a.openUrl(base(a), result), 'https://reactome.org/PathwayBrowser/#/DTAB=AN&ANALYSIS=MjAyNjEwMDUyMzA3NDdfNTcxODI%3D');
    const el = doc.createElement('div');
    a.render(result, el, renderCtx(base(a)));
    assert.match(el.textContent, /209 pathways with at least one gene; the 2 with the smallest p are listed here/);
});


test('STRING\'s 404 "nothing found" is an answer: none of the genes known, with the species and a hint', async () => {
    _resetBackgrounds();
    const a = byId['string-enrichment'];
    const text = fixture('string-404-nothing-found.json');
    const i = io([[/get_string_ids$/, () => { throw httpError(404, text, { host: 'version-12-5.string-db.org', now: 0 }); }]]);
    const input = base(a, { params: { background: 'genome' }, dataTaxonomyId: '6239' });
    await assert.rejects(a.fetch(input, i), (e) => {
        assert.equal(e.kind, 'unmapped');
        assert.equal(e.message, 'STRING knows none of these 6 genes for Homo sapiens (taxon 9606). Is the species right? '
            + "The dataset's genes look like Caenorhabditis elegans (taxon 6239).");
        return true;
    });
    assert.equal(i.calls.length, 1, 'no enrichment asked for nothing');
    // the network section says the same
    await assert.rejects(byId['string-network'].fetch(input, io([[/get_string_ids$/, () => { throw httpError(404, text, { host: 'x', now: 0 }); }]])),
        (e) => e.kind === 'unmapped');
    // another error is still an error
    await assert.rejects(a.fetch(input, io([[/get_string_ids$/, () => { throw httpError(400, '[{"Error":"unknown organism"}]', { host: 'x', now: 0 }); }]])),
        (e) => e.kind === 'http' && e.status === 400);
});

test('the wrong species: every gene unmapped is said so by STRING, g:Profiler and MyGene, naming the species', async () => {
    _resetBackgrounds();
    _resetOrganisms();
    const genes = Array.from({ length: 165 }, (_, n) => `wrong-${n}`);
    const s = byId['string-enrichment'];
    await assert.rejects(s.fetch(base(s, { genes, params: { background: 'genome' }, taxonomyId: '10090', speciesName: 'Mus musculus' }),
        io([[/get_string_ids$/, () => '[]']])),
    (e) => e.kind === 'unmapped' && /none of these 165 genes for Mus musculus \(taxon 10090\)\. Is the species right\?/.test(e.message));
    const g = byId['gprofiler-gost'];
    const reply = JSON.stringify({ result: [], meta: { genes_metadata: { failed: genes, ambiguous: {}, query: {} }, version: 'x' } });
    await assert.rejects(g.fetch(base(g, { genes, params: { ...base(g).params, background: 'genome' } }), io([[/gost\/profile/, () => reply]])),
        (e) => e.kind === 'unmapped' && /g:Profiler knows none of these 165 genes/.test(e.message));
    const m = byId['mygene-mapping'];
    await assert.rejects(m.fetch(base(m, { genes, params: { aliases: false } }), io([[/mygene/, () => '[]']])),
        (e) => e.kind === 'unmapped' && /MyGene\.info knows none of these 165 genes/.test(e.message));
});

test('a service\'s error text: one sentence, no HTML, entities decoded', () => {
    const said = bodyExcerpt(fixture('string-404-nothing-found.json'));
    assert.equal(said, 'nothing found: Sorry, STRING did not find any matches for your input.');
    assert.equal(bodyExcerpt('<html><body><h1>Bad &amp; wrong</h1><p>Detail&nbsp;here. More.</p><script>x()</script></body></html>'),
        'Bad & wrong Detail here.');
    assert.equal(bodyExcerpt('{"message":"Invalid organism: nosuchorg"}'), 'Invalid organism: nosuchorg');
    assert.equal(bodyExcerpt('&#x3C;b&#62; &lt;i&gt;'), '<b> <i>', 'decoded entities are text, not markup');
});

test('the genes not found: all of them in the strip\'s breakdown, its line kept short', () => {
    const genes = Array.from({ length: 170 }, (_, n) => `G${n}`);
    const missing = genes.slice(5);
    const cov = mappedCoverage(5, genes, missing, 'STRING');
    assert.equal(cov.gaps[0].names.length, 165);
    assert.deepEqual([...cov.gaps[0].names], missing);
    assert.equal(cov.gaps[0].detail, 'G5, G6, G7, G8, G9, and 160 more');
});

test('FDR within category: the column says so, and a note when the table pools categories (or sources)', async () => {
    const a = byId['string-enrichment'];
    const result = await a.fetch(base(a, { params: { background: 'genome' } }), io(STRING_ROUTES));
    const el = doc.createElement('div');
    a.render(result, el, renderCtx(base(a)));
    assert.ok(el.byTag('th').some(th => th.textContent === 'FDR (within category)'));
    const note = () => el.all(n => (n.className || '').includes('gs-fdr-note'));
    assert.equal(note().length, 1);
    assert.match(note()[0].textContent, /^FDR is corrected within each category by STRING, not across the \d+ categories shown together\. Expect more false positives than the FDR column suggests; pick a category for a corrected list\.$/);
    // one category picked: a corrected list, no note
    const select = el.byTag('select')[0];
    select.value = select.childNodes[1].value;
    select.listeners.change[0]();
    assert.equal(note().length, 0);
    assert.ok(a.exportRows(result).columns.includes('fdr_within_category'));
    // g:Profiler: corrected within each source
    _resetOrganisms();
    const g = byId['gprofiler-gost'];
    const gr = await g.fetch(base(g, { params: { ...base(g).params, background: 'genome' } }), io([[/gost\/profile/, () => fixture('gprofiler-profile.json')]]));
    const gel = doc.createElement('div');
    g.render(gr, gel, renderCtx(base(g)));
    assert.match(gel.textContent, /adjusted p is corrected within each source by g:Profiler, not across the \d+ sources shown together/);
    assert.ok(gel.byTag('th').some(th => th.textContent === 'p (adj., within source)'));
    assert.ok(g.exportRows(gr).columns.includes('p_value_adjusted_within_source'));
});

/**
 * Categorical columns with many categories, up to one per cell
 * (static/js/utils/categories.js, annzarro/core/categories.py).
 *
 *  - Past 64 categories a plot is coloured by colour group: categories ranked
 *    by their points, rank r in colour r mod 64, one trace and one legend
 *    entry per colour naming its largest categories ("k0, k64, k128 +N
 *    more"). v0.4.0 drew a trace and a legend entry per category and hung at
 *    a few thousand; at a one-per-cell column it asked for every category
 *    (a GB-sized reply at 95.6M cells) and then failed on it.
 *  - The colour request for such a column asks for the labels of the points
 *    only (categories=used), not the column's list.
 *  - The hover names each point's exact category.
 *
 * Run:  node --test annzarro/tests/js/many-categories.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {
    addEventListener() {}, location: { href: 'http://localhost/' }, Config: {},
    getComputedStyle: () => ({ position: 'relative' })
};
function mkEl(tag) {
    return {
        tagName: tag, style: {}, dataset: {}, children: [], _attrs: {}, innerHTML: '', className: '',
        classList: { add() {}, remove() {} },
        appendChild(c) { this.children.push(c); return c; }, insertBefore(c) { this.children.push(c); return c; },
        querySelectorAll: () => [], querySelector: () => null, remove() {}, setAttribute(k, v) { this._attrs[k] = v; }
    };
}
globalThis.document = {
    createElement: mkEl, getElementById: () => null, body: mkEl('body'),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {}
};
globalThis.Plotly = new Proxy({}, { get: () => () => Promise.resolve() });
const chain = new Proxy(function () {}, {
    get: (_t, p) => (p === 'length' ? 0 : p === Symbol.iterator ? [][Symbol.iterator] : () => chain),
    apply: () => chain
});
globalThis.jQuery = () => chain;
globalThis.$ = globalThis.jQuery;
globalThis.fetch = async () => ({ ok: false, statusText: 'test' });

const { CacheManager } = await import('../../../static/js/cache-manager.js');
const { DataManager } = await import('../../../static/js/data-manager.js');
const { loadAxisData, hoverTemplateFor } = await import('../../../static/js/panels/plot-utilities/plot-make.js');
const { processCategories, isLegendProxy } = await import('../../../static/js/panels/plot-utilities/plot-make-helper.js');
const { classifyError } = await import('../../../static/js/utils/coverage.js');
const cats = await import('../../../static/js/utils/categories.js');

const DS = '/data/many.zarr';
const N = 6;
const NAMES = Array.from({ length: N }, (_, i) => `cell${i}`);
const BARCODES = NAMES.map((_, i) => `BC${i}-1`);

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A fake server whose obs column `barcode` has 2,000,000 categories (metadata). */
function installServer() {
    const calls = [];
    globalThis.fetch = async (url) => {
        const u = new URL(url, 'http://localhost');
        const q = Object.fromEntries(u.searchParams);
        const path = u.pathname.replace('/api/v1/data/', '');
        calls.push({ path, q });
        if (path === 'dataset_structure') {
            return json({ n_obs: N, n_vars: 1, obs: { columns: ['barcode', 'few'], columns_info: {
                barcode: { type: 'categorical', n_categories: 2000000 },
                few: { type: 'categorical', n_categories: 2 } } } });
        }
        if (path === 'subset') return json({ subset: null, key: null, n: N, n_total: N, n_eligible: N,
                                              defaults: { threshold: 100, size: 50, seed: 0 } });
        if (path === 'cells') return json({ cells: NAMES });
        if (path === 'genes') return json({ genes: ['g0'] });
        if (path === 'obs' && q.columns === 'barcode' && q.categories === 'ranked') {
            // the column's ranking over all its cells: cell i's category has rank N-1-i
            const buf = new ArrayBuffer(4 + 4 * N);
            new Uint8Array(buf, 0, 4).set([0x5b, 0x5d, 0x20, 0x20]);   // "[]  "
            const codes = new Int32Array(buf, 4, N);
            for (let i = 0; i < N; i++) codes[i] = N - 1 - i;
            return new Response(buf, { status: 200, headers: {
                'Content-Type': 'application/octet-stream', 'X-Annzarro-Encoding': 'categorical',
                'X-Annzarro-Shape': String(N), 'X-Annzarro-Dtype': 'int32', 'X-Annzarro-Categories-Bytes': '4',
                'X-Annzarro-Categories-Used': '2000000', 'X-Annzarro-Categories-Order': 'ranked',
                'X-Annzarro-Categories-Total': '2000000' } });
        }
        if (path === 'obs' && q.columns === 'barcode') {
            // what the server sends for hover/table: these rows' labels only
            return json({ data: { barcode: BARCODES }, categories: { barcode: BARCODES },
                          n_categories: { barcode: 2000000 } });
        }
        if (path === 'obs' && q.columns === 'few') {
            return json({ data: { few: NAMES.map((_, i) => (i % 2 ? 'b' : 'a')) }, categories: { few: ['a', 'b'] } });
        }
        return json({ data: [] });
    };
    return calls;
}

async function open() {
    CacheManager.clear();
    const calls = installServer();
    await DataManager.setCurrentDataset(DS, true);
    calls.length = 0;
    return calls;
}

test('colouring a column with more than 64 categories: labels of the points, ranks of the whole column', async () => {
    const calls = await open();
    const loaded = await loadAxisData({ type: 'obs', key: 'barcode', column: '' }, 'cells', null, { role: 'colour' });
    assert.deepEqual(loaded.values, BARCODES);
    const obs = calls.filter(c => c.path === 'obs');
    assert.deepEqual(obs.map(c => c.q.categories).sort(), ['ranked', 'used']);
    assert.ok(loaded.rankOf instanceof Map);
    BARCODES.forEach((b, i) => assert.equal(loaded.rankOf.get(b), N - 1 - i));
});

test('up to 64 categories a colouring asks for every category', async () => {
    const calls = await open();
    const loaded = await loadAxisData({ type: 'obs', key: 'few', column: '' }, 'cells', null, { role: 'colour' });
    assert.equal(loaded.type, 'categorical');
    assert.equal(calls.find(c => c.path === 'obs').q.categories, 'all');
});

test('hover and table load a one-per-cell column as before', async () => {
    const calls = await open();
    const loaded = await loadAxisData({ type: 'obs', key: 'barcode', column: '' }, 'cells');
    assert.deepEqual(loaded.values, BARCODES);
    assert.equal(calls.find(c => c.path === 'obs').q.categories, undefined);
});

test('frequency ranks: most cells first, ties by category, in linear time', () => {
    const r = cats.frequencyRanks(Uint32Array.from([3, 0, 5, 3, 1, 5]));
    assert.deepEqual(Array.from(r.order), [2, 5, 0, 3, 4]);
    assert.deepEqual(Array.from(r.rankOf), [2, -1, 0, 3, 4, 1]);
    assert.equal(r.used, 5);
    const ones = cats.frequencyRanks(new Uint32Array(1e6).fill(1));
    assert.equal(ones.used, 1e6);
    assert.equal(ones.order[999999], 999999);
});

test('a colour group names its largest categories on the plot, then how many more', () => {
    assert.equal(cats.groupLegendName(['S1', 'S7', 'S12', 'S20', 'S33']), 'S1, S7, S12 +2 more');
    assert.equal(cats.groupLegendName(['S5', 'S69']), 'S5, S69');
    assert.equal(cats.groupLegendName(['S1', 'S7', 'S12', ...Array(1000).fill(null)]), 'S1, S7, S12 +1,000 more');
    assert.equal(cats.groupOf(130), 2);
});

test("the server's label cap reads as such", () => {
    const err = new Error("'barcode' has 95,600,000 distinct values; labelling 95,600,000 rows would send more than 2,000,000 of them.");
    err.data = { reason: 'too_many_categories', count: 95600000, limit: 2000000,
                 detail: '95,600,000 distinct values; labelling 95,600,000 rows would send more than 2,000,000 of them: use a cell subset to label fewer rows' };
    const cov = classifyError(err, { unit: 'cells', source: 'obs.barcode', total: 10 });
    assert.equal(cov.headline(), 'Not labelled: too many distinct values');
    assert.match(cov.lines()[0], /^obs\.barcode: too many distinct values to label -- 95,600,000 distinct values; .*use a cell subset/);
});

/**
 * `nCategories` categories, category k holding `base - k` points (distinct
 * sizes, so the frequency order is k0, k1, k2, ...), plus a few points with
 * no value, shuffled.
 */
function panel(nCategories, base = nCategories + 20) {
    const categories = Array.from({ length: nCategories }, (_, i) => `k${i}`);
    const color = [];
    categories.forEach((c, k) => { for (let j = 0; j < base - k; j++) color.push(c); });
    for (let j = 0; j < 30; j++) color.push(null);
    const shuffled = color.map((_, i) => color[(i * 7919) % color.length]);
    const cells = shuffled.map((_, i) => `c${i}`);
    return {
        settings: { hideNaN: false, hideOutliers: false, tableFilter: 'none', z: null, pointSize: 4, pointOpacity: 1,
                    categoryPalette: 'hue' },
        data: { entities: 'cells', cells, x: { values: cells.map((_, i) => i) }, y: { values: cells.map((_, i) => -i) },
                color: shuffled, colorType: 'categorical', colorCategories: categories },
        categories
    };
}

/** The column's ranking, as the server sends it: category k has rank k. */
const columnRanks = (categories) => new Map(categories.map((c, k) => [c, k]));

function colourOfEach(traces) {
    const out = new Map();
    for (const t of traces.filter(t => !isLegendProxy(t) && t._azLabels)) {
        t._azLabels.forEach(l => out.set(l, t.marker.color));
    }
    return out;
}

test('hundreds of categories: 64 colour groups by rank, one legend entry each, every point drawn', () => {
    const { settings, data } = panel(500);
    data.colorRankOf = columnRanks(data.colorCategories);
    // categories listed in an order unrelated to their ranks
    const traces = processCategories(settings, data, data.colorCategories.slice().reverse());
    const legend = traces.filter(isLegendProxy);
    const points = traces.filter(t => !isLegendProxy(t));
    const groups = points.filter(t => t._azLabels);
    assert.equal(groups.length, cats.GROUP_COLOURS);
    assert.equal(legend.length, cats.GROUP_COLOURS + 1);               // and NA
    assert.equal(points.reduce((n, t) => n + t.x.length, 0), data.color.length);
    // colour group g is led by rank g: k0 leads group 0, with k64, k128, ...
    const first = groups.find(t => t.name.startsWith('k0,'));
    assert.ok(first, groups.map(t => t.name).slice(0, 5).join(' | '));
    assert.equal(first.name, 'k0, k64, k128 +5 more');
    for (const t of groups) {
        const members = new Set();
        t.customdata.forEach((cell, j) => {
            assert.equal(t._azLabels[j], data.color[Number(cell.slice(1))]);
            assert.equal(t.hovertext[j], `<br>${t._azLabels[j]}`);
            members.add(Number(t._azLabels[j].slice(1)) % cats.GROUP_COLOURS);
        });
        assert.equal(members.size, 1, `${t.name}: one colour group`);
        assert.match(hoverTemplateFor(t, settings, data), /%\{hovertext\}<extra><\/extra>$/);
    }
});

test('a category keeps its colour across parts and a table filter', () => {
    const { settings, data } = panel(500);
    const rankOf = columnRanks(data.colorCategories);
    const view = (keep) => {
        const idx = data.color.map((_, i) => i).filter(keep);
        return { ...data, colorRankOf: rankOf, color: idx.map(i => data.color[i]), cells: idx.map(i => data.cells[i]),
                 x: { values: idx.map(i => data.x.values[i]) }, y: { values: idx.map(i => data.y.values[i]) } };
    };
    // two parts that hold different sizes of the same categories: ranked by
    // the cells shown, their colours would differ
    const part0 = view(i => i % 3 === 0), part1 = view(i => i % 3 !== 0 && data.color[i] !== 'k0');
    const whole = colourOfEach(processCategories(settings, view(() => true), data.colorCategories));
    const c0 = colourOfEach(processCategories(settings, part0, data.colorCategories));
    const c1 = colourOfEach(processCategories(settings, part1, data.colorCategories));
    let compared = 0;
    for (const [label, colour] of c0) {
        assert.equal(colour, whole.get(label), label);
        if (c1.has(label)) { assert.equal(c1.get(label), colour, label); compared++; }
    }
    assert.ok(compared > 400);
    // a table filter that removes the largest categories' points
    const filtered = { ...view(() => true), tableEntities: new Set(data.cells.filter((_, i) => !['k0', 'k1', 'k2'].includes(data.color[i]))) };
    const cf = colourOfEach(processCategories({ ...settings, tableFilter: 'cell-table', removeNonTableEntries: true },
        filtered, data.colorCategories));
    for (const [label, colour] of cf) assert.equal(colour, whole.get(label), label);
    assert.ok(!cf.has('k0') && cf.has('k3'));
});

test('up to 64 categories the legend lists each one, as before', () => {
    const { settings, data, categories } = panel(cats.GROUP_COLOURS);
    const legend = processCategories(settings, data, categories).filter(isLegendProxy);
    assert.equal(legend.length, cats.GROUP_COLOURS + 1);    // and NA
    assert.ok(!legend.some(t => /more$/.test(t.name)));
});

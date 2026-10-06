/**
 * Categorical columns with many categories, up to one per cell
 * (static/js/utils/categories.js, annzarro/core/categories.py).
 *
 *  - Colouring by a column with more categories than the colour limit is
 *    refused before anything is requested, with one notice that says how
 *    many distinct values it has and to use the hover or a table instead.
 *    v0.4.0 asked for the column with every category (a GB-sized reply at
 *    95.6M cells) and then failed on it.
 *  - Between 100 categories and the limit the plot draws in 64 shared colours
 *    with a one-line legend; v0.4.0 drew a trace and a legend entry per
 *    category and hung at a few thousand.
 *  - The hover still names each point's category, and a one-per-cell column
 *    still loads for hover and tables.
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
const { Config } = await import('../../../static/js/config.js');
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

test('colouring by a one-per-cell column is refused before any request, with one notice', async () => {
    const calls = await open();
    const axis = { type: 'obs', key: 'barcode', column: '' };
    await assert.rejects(loadAxisData(axis, 'cells', null, { role: 'colour' }), (err) => {
        const lines = err.coverage.lines();
        assert.equal(lines.length, 1);
        assert.match(lines[0], /obs\.barcode has 2,000,000 distinct values, too many to colour by/);
        assert.match(lines[0], /show it in the hover or in a table/);
        assert.equal(err.coverage.headline(), 'Not coloured: too many categories');
        return true;
    });
    assert.deepEqual(calls.filter(c => c.path === 'obs'), [], 'nothing was requested for the column');
});

test('the same column still loads for the hover and the table, labels for the rows shown', async () => {
    const calls = await open();
    const loaded = await loadAxisData({ type: 'obs', key: 'barcode', column: '' }, 'cells');
    assert.deepEqual(loaded.values, BARCODES);
    const obs = calls.filter(c => c.path === 'obs');
    assert.equal(obs.length, 1);
    assert.equal(obs[0].q.categories, undefined, 'not the colour request');
});

test('a colouring below the limit asks for every category', async () => {
    const calls = await open();
    const loaded = await loadAxisData({ type: 'obs', key: 'few', column: '' }, 'cells', null, { role: 'colour' });
    assert.equal(loaded.type, 'categorical');
    assert.equal(calls.find(c => c.path === 'obs').q.categories, 'all');
});

test('the colour limit follows the server setting', () => {
    const was = Config.DEFAULTS.CATEGORY_COLOUR_LIMIT;
    try {
        Config.DEFAULTS.CATEGORY_COLOUR_LIMIT = 1;
        const structure = { obs: { columns_info: { few: { type: 'categorical', n_categories: 2 } } } };
        const err = cats.colourRefusal({ type: 'obs', key: 'few' }, structure);
        assert.equal(err.data.reason, 'too_many_categories');
        assert.equal(err.data.limit, 1);
        assert.equal(cats.colourRefusal({ type: 'obsm', key: 'X' }, structure), null);
        assert.equal(cats.colourRefusal({ type: 'obs', key: 'unknown' }, structure), null);
    } finally {
        Config.DEFAULTS.CATEGORY_COLOUR_LIMIT = was;
    }
});

test("the server's 413 reads the same as the client's own refusal", () => {
    const err = new Error("'barcode' has 95,600,000 distinct values, too many to colour by (the limit is 10,000).");
    err.data = { reason: 'too_many_categories', count: 95600000, limit: 10000 };
    const cov = classifyError(err, { unit: 'cells', source: 'colour', total: 10 });
    assert.equal(cov.headline(), 'Not coloured: too many categories');
    assert.match(cov.lines()[0], /colour: not coloured -- 'barcode' has 95,600,000 distinct values/);
});

function panel(nCategories, nPoints) {
    const categories = Array.from({ length: nCategories }, (_, i) => `k${i}`);
    const cells = Array.from({ length: nPoints }, (_, i) => `c${i}`);
    const color = cells.map((_, i) => (i % 97 === 0 ? null : categories[(i * 7919) % nCategories]));
    return {
        settings: { hideNaN: false, hideOutliers: false, tableFilter: 'none', z: null, pointSize: 4, pointOpacity: 1,
                    categoryPalette: 'hue' },
        data: { entities: 'cells', cells, x: { values: cells.map((_, i) => i) }, y: { values: cells.map((_, i) => -i) },
                color, colorType: 'categorical', colorCategories: categories },
        categories
    };
}

test('a few thousand categories: 64 shared colours and a one-line legend, every point drawn', () => {
    const { settings, data, categories } = panel(3000, 9000);
    const traces = processCategories(settings, data, categories);
    const legend = traces.filter(isLegendProxy);
    const points = traces.filter(t => !isLegendProxy(t));
    assert.deepEqual(legend.map(t => t.name).sort(), ['3,000 categories (colours shared)', 'NA']);
    assert.ok(points.length <= cats.BUCKET_COLOURS + 1, `${points.length} traces`);
    assert.equal(points.reduce((n, t) => n + t.x.length, 0), 9000);
    // the hover names each point's own category
    for (const t of points.filter(t => t._azLabels)) {
        t.customdata.forEach((cell, j) => {
            assert.equal(t._azLabels[j], data.color[Number(cell.slice(1))]);
            assert.equal(t.hovertext[j], `<br>${t._azLabels[j]}`);
        });
        assert.match(hoverTemplateFor(t, settings, data), /%\{hovertext\}<extra><\/extra>$/);
    }
    // category k is drawn in colour k mod 64, so equal categories share a colour
    const colourOf = new Map();
    for (const t of points.filter(t => t._azLabels)) t._azLabels.forEach(l => colourOf.set(l, t.marker.color));
    assert.equal(colourOf.get('k5'), colourOf.get(`k${5 + cats.BUCKET_COLOURS}`));
    assert.notEqual(colourOf.get('k5'), colourOf.get('k6'));
});

test('up to 100 categories the legend lists each one, as before', () => {
    const { settings, data, categories } = panel(cats.LEGEND_CATEGORIES, 1000);
    const legend = processCategories(settings, data, categories).filter(isLegendProxy);
    assert.equal(legend.length, cats.LEGEND_CATEGORIES + 1);    // and NA
    assert.ok(!legend.some(t => /categories/.test(t.name)));
});

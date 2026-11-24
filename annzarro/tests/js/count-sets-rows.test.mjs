/**
 * The Venn and UpSet set list as rows with colours, and the UpSet's None / Count colouring (utils/set-plot-model.js,
 * utils/count-plot-model.js, panels/cell-count/controls-model.js, panels/cell-count/draw-sets.js):
 *
 *   - a set's colour: the default of each position (Okabe and Ito, then the group colours), a stored pick, one pure
 *     function (`setColours`) that the list, the Venn and the UpSet all read;
 *   - the normaliser: a valid stored colour is kept, a bad one dropped, nothing is stored at the default;
 *   - the Venn: circles filled with the set colours, each label naming its set;
 *   - the UpSet: one uniform colour by default; Count colours the bars by count on a scale with a colour bar; the
 *     value choices start with None, and an old config (no value) reads as None;
 *   - every other mode's value choices and colour use are unchanged.
 *
 * Run:  node --test annzarro/tests/js/count-sets-rows.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.fetch = async () => ({ ok: false, status: 404, statusText: 'offline in test' });

const S = await import('../../../static/js/utils/set-plot-model.js');
const M = await import('../../../static/js/utils/count-plot-model.js');
const K = await import('../../../static/js/panels/cell-count/controls-model.js');
const D = await import('../../../static/js/panels/cell-count/draw-sets.js');
const { PLOT_PALETTES } = await import('../../../static/js/utils/plot-theme.js');
const { VOCABULARY } = await import('../../../static/js/utils/vocabulary.js');

const LIGHT = PLOT_PALETTES.light;
const OKABE = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#56B4E9', '#D55E00', '#F0E442', '#000000'];
const obsSet = (key, extra = {}) => ({ source: { type: 'obs', key }, member: { op: '>', value: 1 }, ...extra });

/** The counts of a sets grid of k sets, every cell in or out at random but seeded. */
function setsGrid(k, n = 300) {
    let s = 7;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const counts = new Float64Array(2 ** k);
    for (let c = 0; c < n; c++) {
        let at = 0;
        for (let i = 0; i < k; i++) at = at * 2 + (rnd() < 0.4 ? 0 : 1);
        counts[at] += 1;
    }
    const axes = Array.from({ length: k }, () => ({ kind: 'member', levels: ['@in', '@out'], n_outside: [0, 0] }));
    return M.readGrid({ reply: { n_shown: n, n_counted: n, axes }, counts, measures: null });
}
const tableOf = (config, grid) => M.countTable(config, grid, config.sets.map((_, i) => ({ input: 'sets', set: i })));
const plotOf = (config, names) => {
    const k = config.sets.length;
    return S.setPlotModel(config, tableOf(config, setsGrid(k)), { names: names || config.sets.map((_, i) => `set ${i}`) });
};
const norm = (raw) => M.normalizeCountPlot(raw);

// ------------------------------------------------------------------ set colours

test('a set takes the Okabe and Ito colours in order, then the group colours, and a stored colour wins', () => {
    const sets = Array.from({ length: 10 }, (_, i) => obsSet(`c${i}`));
    const colours = S.setColours(sets);
    assert.deepEqual(colours.slice(0, 8), OKABE);
    assert.equal(colours.length, 10);
    assert.match(colours[8], /^#[0-9a-f]{6}$/i);
    assert.notEqual(colours[8], colours[9]);
    const picked = S.setColours([obsSet('a', { color: '#ff0000' }), obsSet('b'), obsSet('c', { color: 'not a colour!' })]);
    assert.deepEqual(picked, ['#ff0000', OKABE[1], OKABE[2]], 'a pick is used; one that is no colour reads as the default');
});

test('the normaliser keeps a valid set colour, drops a bad one and stores nothing at the default', () => {
    const { config } = norm({ version: 1, mode: 'venn', sets: [obsSet('a', { color: '#ff0000' }), obsSet('b', { color: 'ye ll ow;' }), obsSet('c', { color: 7 }), obsSet('d')] });
    assert.equal(config.sets[0].color, '#ff0000');
    for (const i of [1, 2, 3]) assert.ok(!('color' in config.sets[i]), `set ${i} stores no colour`);
    // an old link: names, no colours, nothing added
    const old = norm({ version: 1, mode: 'upset', sets: [obsSet('a', { name: 'one' }), obsSet('b', { name: 'two' })] }).config;
    assert.deepEqual(old.sets.map((s) => s.name), ['one', 'two']);
    assert.ok(old.sets.every((s) => !('color' in s)) && !('value' in old));
});

// ------------------------------------------------------------------ Venn

test('the Venn circles are filled with the set colours and each label names its set', () => {
    const config = { version: 1, mode: 'venn', sets: [obsSet('a', { color: '#123456' }), obsSet('b'), obsSet('c')] };
    const plot = plotOf(config, ['alpha cells', 'beta cells', 'gamma cells']);
    assert.deepEqual(plot.sets.map((s) => s.colour), ['#123456', OKABE[1], OKABE[2]]);
    const fig = D.buildFigure(plot, LIGHT);
    const circles = fig.layout.shapes.filter((s) => s.type === 'circle');
    assert.deepEqual(circles.map((c) => c.fillcolor), ['#123456', OKABE[1], OKABE[2]]);
    assert.deepEqual(circles.map((c) => c.line.color), ['#123456', OKABE[1], OKABE[2]]);
    const labels = fig.layout.annotations.filter((a) => /^[ABC]\b/.test(a.text));
    assert.equal(labels.length, 3);
    assert.ok(labels[0].text.startsWith('A') && labels[0].text.includes('alpha cells'), labels[0].text);
    assert.ok(labels[2].text.includes('gamma cells'));
    const long = D.buildFigure(plotOf(config, ['a very long set name that does not fit beside a circle', 'b', 'c']), LIGHT);
    const first = long.layout.annotations.find((a) => a.text.startsWith('A'));
    assert.ok(first.text.length < 40 && first.text.endsWith('…'), first.text);
    assert.ok(first.hovertext.includes('a very long set name that does not fit beside a circle'), 'the full name on hover');
});

// ------------------------------------------------------------------ UpSet

test('an UpSet colours every bar one neutral colour by default, and the set-size bars take the set colours', () => {
    const config = { version: 1, mode: 'upset', sets: [obsSet('a'), obsSet('b', { color: '#abcdef' }), obsSet('c')] };
    const plot = plotOf(config);
    assert.equal(plot.color, null);
    const fig = D.buildFigure(plot, LIGHT);
    const bars = fig.data.find((t) => t.name === 'intersections');
    assert.equal(bars.marker.color, LIGHT.noneColor);
    assert.ok(!bars.marker.showscale);
    const sizes = fig.data.find((t) => t.name === 'set sizes');
    assert.deepEqual(Array.from(sizes.marker.color), [OKABE[0], '#abcdef', OKABE[2]]);
});

test('UpSet Count colours each bar by its count on a scale with a colour bar', () => {
    const config = { version: 1, mode: 'upset', value: { kind: 'count' }, sets: [obsSet('a'), obsSet('b'), obsSet('c')] };
    const plot = plotOf(config);
    assert.deepEqual(plot.color, { label: 'Count', kind: 'count' });
    for (const r of plot.regions) assert.equal(r.color, r.count);
    const fig = D.buildFigure(plot, LIGHT, { colorscale: 'Viridis', colour: { min: 3 } });
    const bars = fig.data.find((t) => t.name === 'intersections');
    assert.ok(Array.isArray(bars.marker.color), 'a value per bar');
    assert.deepEqual(bars.marker.color, plot.shown.map((i) => plot.regions[i].count));
    assert.equal(bars.marker.showscale, true);
    assert.equal(bars.marker.colorbar.title.text, 'Count');
    assert.ok(bars.marker.colorscale && bars.marker.cmin === 3, 'the scale and the range boxes apply');
    const none = plotOf({ ...config, value: undefined });
    assert.equal(none.color, null, 'no value is one colour');
});

test('the count of an UpSet is kept in its config, and dropped in every other mode', () => {
    const sets = [obsSet('a'), obsSet('b')];
    assert.deepEqual(norm({ version: 1, mode: 'upset', sets, value: { kind: 'count' } }).config.value, { kind: 'count' });
    assert.ok(!('value' in norm({ version: 1, mode: 'bar', value: { kind: 'count' } }).config));
    assert.ok(!('value' in norm({ version: 1, mode: 'venn', sets, value: { kind: 'count' } }).config));
});

test('an UpSet offers None first (the default), then Count; an old config reads as None; None writes nothing', () => {
    const upset = { version: 1, mode: 'upset', sets: [obsSet('a'), obsSet('b')] };
    const choices = K.valueChoices(upset);
    assert.deepEqual(choices.slice(0, 2).map((c) => c.value), ['none', 'count']);
    assert.equal(choices[0].label, 'None');
    assert.equal(choices[0].help, 'One color for every bar.');
    assert.equal(choices[1].help, 'Each bar colored by its cells, on the color scale.');
    assert.equal(K.valueChoiceOf(upset), 'none');
    assert.equal(K.valueChoiceOf({ ...upset, value: { kind: 'count' } }), 'count');
    assert.equal(K.valueChoiceOf({ ...upset, value: { kind: 'share' } }), 'share:all');
    assert.deepEqual(K.applyValueChoice(upset, 'count').value, { kind: 'count' });
    assert.ok(!('value' in K.applyValueChoice({ ...upset, value: { kind: 'count' } }, 'none')));
    assert.deepEqual(K.colorUse({ ...upset, value: { kind: 'count' } }), { map: true, palette: false });
    assert.deepEqual(K.colorUse(upset), { map: false, palette: false });
    assert.deepEqual(K.colorUse({ ...upset, value: { kind: 'share' } }), { map: true, palette: false });
});

test('the other modes offer the same Height and Color choices as before', () => {
    const values = (config) => K.valueChoices(config).map((c) => c.value);
    const stats = ['stat:mean', 'stat:sum', 'stat:pct_above', 'stat:sd', 'stat:zscore'];
    assert.deepEqual(values({ version: 1, mode: 'bar' }).slice(0, 2), ['count', 'share:all']);
    assert.ok(!values({ version: 1, mode: 'bar' }).includes('none'));
    assert.ok(stats.every((s) => values({ version: 1, mode: 'bar' }).includes(s)));
    for (const mode of ['hist2d', 'heatmap']) {
        assert.equal(values({ version: 1, mode })[0], 'count');
        assert.ok(!values({ version: 1, mode }).includes('none'));
        assert.equal(K.valueChoiceOf({ version: 1, mode }), 'count');
    }
    assert.deepEqual(values({ version: 1, mode: 'venn' }), []);
    assert.equal(VOCABULARY.countPlot.value.count, 'Count');
});

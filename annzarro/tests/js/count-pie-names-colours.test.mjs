/**
 * A pie names its slices and colours them by a continuous scale (operator, 0.8.0): "the legend for the slice colors or
 * to display the category or bin names on the slices ... continuous color values, especially if we are binning a
 * continuum". Names sit at the numbers' radius (stacked above the number when both are shown), under the same 3% rule;
 * bins of a number are coloured by their value on the colour map by default, categories by their level palette.
 *
 * Run:  node --test annzarro/tests/js/count-pie-names-colours.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const M = await import('../../../static/js/utils/count-plot-model.js');
const D = await import('../../../static/js/panels/cell-count/draw.js');
const K = await import('../../../static/js/panels/cell-count/controls-model.js');
const { asHex } = await import('../../../static/js/utils/grouping-colours.js');
const { VOCABULARY } = await import('../../../static/js/utils/vocabulary.js');
const { PLOT_PALETTES } = await import('../../../static/js/utils/plot-theme.js');

const WORDS = { count: 'Cells', fill: '%', hoverCount: 'Cells', hoverShare: 'Share', share: () => '', slices: VOCABULARY.countPlot.slices };
const obs = (key, extra = {}) => ({ source: { type: 'obs', key }, ...extra });
const norm = (c) => M.normalizeCountPlot({ version: 1, mode: 'pie', ...c }).config;
const draw = (config, table, extra = {}) => D.countFigure(config, table, {
    options: K.drawOptions(config), words: WORDS, inputNames: { x: 'depth' }, palette: ['#111111'], theme: PLOT_PALETTES.light, ...extra });

/** Four bins of a number (40, 30, 20, 10 cells; edges 0 to 40) under the given binning method. */
function bins(stored = {}, method = 'equal_width') {
    const config = norm({ x: obs('depth', { binning: { method, bins: 4 } }), ...stored });
    const reply = { reply: { n_counted: 100, n_shown: 100, axes: [{ levels: ['bin:0', 'bin:1', 'bin:2', 'bin:3'], edges: [0, 10, 20, 30, 40], bins_made: 4, degenerate: false, n_outside: [0, 0] }] },
        counts: [40, 30, 20, 10], measures: null };
    return { config, table: M.countTable(config, M.readGrid(reply), [{ input: 'x' }]) };
}

/** Categories: 850 of 1000, then 70, 50 and two under 3%. */
function cats(stored = {}) {
    const config = norm({ x: obs('k'), ...stored });
    const reply = { reply: { n_counted: 1000, n_shown: 1000, axes: [{ levels: ['c:a', 'c:b', 'c:c', 'c:d', 'c:e'], n_outside: [0, 0] }] },
        counts: [850, 70, 50, 20, 10], measures: null };
    return { config, table: M.countTable(config, M.readGrid(reply), [{ input: 'x' }]) };
}

const notes = (f) => (f.layout.annotations || []).filter((a) => a.name === 'pie-label');
const radius = (a) => Math.hypot(a.x, a.y);
const luminance = (hex) => { const h = asHex(hex); return [1, 3, 5].reduce((s, i, k) => s + [0.2126, 0.7152, 0.0722][k] * parseInt(h.slice(i, i + 2), 16), 0); };

/** The relative luminance the slices' text colour rule reads (WCAG, linearised sRGB). */
const relative = (hex) => { const h = asHex(hex); const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };

// --- names on slices -------------------------------------------------------------------------------------------------

test('names: each slice of 3% or more shows its name at the numbers\' radius; a smaller slice\'s name is in its hover only', () => {
    const { config, table } = cats({ names: true });
    const f = draw(config, table);
    const n = notes(f);
    const labels = f.data[0].labels;
    assert.deepEqual(n.map((a) => a.text), labels.slice(0, 3), 'no number asked for: the names alone');
    assert.ok(n.every((a) => Math.abs(radius(a) - 0.75) < 1e-12), 'the numbers\' radius');
    assert.ok(f.data[0].hovertext[3].includes(labels[3]) && f.data[0].hovertext[4].includes(labels[4]), 'a small slice\'s name stays in its hover');
});

test('both: the name above the number, one annotation at the place the number alone has', () => {
    const numbers = notes(draw(...Object.values(cats({ labels: 'count' }))));
    const both = notes(draw(...Object.values(cats({ labels: 'count', names: true }))));
    assert.equal(both.length, 3);
    both.forEach((a, i) => {
        const labels = draw(...Object.values(cats({ labels: 'count', names: true }))).data[0].labels;
        assert.equal(a.text, `${labels[i]}<br>${numbers[i].text}`, 'name, then number');
        assert.deepEqual([a.x, a.y], [numbers[i].x, numbers[i].y], 'the same point');
        assert.equal(a.yanchor, 'middle');
    });
});

test('names and numbers read on their slice: dark text on a light slice, light on a dark one', () => {
    const { config, table } = bins({ names: true, labels: 'count' });
    const f = draw(config, table);
    const colours = f.data[0].marker.colors;
    notes(f).forEach((a, i) => assert.equal(a.font.color, relative(colours[i]) > 0.4 ? '#000000' : '#ffffff', `slice ${i}`));
});

test('bin names are the labels the bars use', () => {
    const { config, table } = bins({ names: true });
    const f = draw(config, table);
    const [labels] = M.levelLabelsOf(config, table);
    assert.deepEqual(f.data[0].labels, ['bin:0', 'bin:1', 'bin:2', 'bin:3'].map((id) => labels.get(id)));
    assert.deepEqual(notes(f).map((a) => a.text), f.data[0].labels);
});

test('no names asked for: the numbers alone, as before', () => {
    const f = draw(...Object.values(cats({ labels: 'count' })));
    assert.deepEqual(notes(f).map((a) => a.text), ['850', '70', '50']);
});

// --- continuous colours ----------------------------------------------------------------------------------------------

const colourTrace = (f) => f.data.find((t) => t.meta && t.meta.pieAxes);

test('bins of a number are coloured by their centre on a continuous scale by default, with a colour bar', () => {
    const { config, table } = bins({ color: { map: 'Greys' } });
    const f = draw(config, table);
    const colours = f.data[0].marker.colors;
    assert.equal(colours.length, 4);
    const lum = colours.map(luminance);
    assert.ok(lum.every((v, i) => i === 0 || v > lum[i - 1]), `monotone in the bin's value: ${lum}`);
    const bar = colourTrace(f);
    assert.ok(bar && bar.marker.showscale && bar.marker.colorbar.title.text.includes('depth'), 'a colour bar titled with the input');
    assert.deepEqual(bar.marker.color, [5, 15, 25, 35], 'the bins\' centres');
    assert.equal(bar.hoverinfo, 'skip');
    assert.equal(bar.showlegend, false);
    assert.equal(f.layout.showlegend, false, 'the colour bar says the colour: no legend by default');
});

test('Min and Max are honoured: a bin beyond a limit takes the end colour, and the bar carries the limits', () => {
    const { config, table } = bins({ color: { map: 'Greys', min: 15, max: 25 } });
    const f = draw(config, table);
    const [c0, c1, c2, c3] = f.data[0].marker.colors.map((c) => asHex(c));
    assert.equal(c0, c1, 'the first two bins sit at or below Min');
    assert.equal(c2, c3, 'the last two sit at or above Max');
    assert.notEqual(c1, c2);
    const bar = colourTrace(f).marker;
    assert.deepEqual([bar.cmin, bar.cmax], [15, 25]);
});

test('Reverse flips the map', () => {
    const a = draw(...Object.values(bins({ color: { map: 'Greys' } }))).data[0].marker.colors.map(asHex);
    const b = draw(...Object.values(bins({ color: { map: 'Greys', reverse: true } }))).data[0].marker.colors.map(asHex);
    assert.deepEqual(b, [...a].reverse());
});

test('evenly drawn bins (log) are coloured by their order, so each bin is one step of colour', () => {
    const { config, table } = bins({ color: { map: 'Greys' } }, 'log');
    const f = draw(config, table);
    assert.deepEqual(colourTrace(f).marker.color, [0, 1, 2, 3], 'the bins\' order');
    assert.ok(colourTrace(f).marker.colorbar.title.text.includes('order'));
    const lum = f.data[0].marker.colors.map(luminance);
    assert.ok(lum.every((v, i) => i === 0 || v > lum[i - 1]));
});

test('the slices\' colours follow their bin, not their place after Sort by height', () => {
    const sorted = draw(...Object.values(bins({ color: { map: 'Greys' }, sort: 'height', reverse: true })));
    const plain = draw(...Object.values(bins({ color: { map: 'Greys' } })));
    assert.deepEqual(sorted.data[0].marker.colors, [...plain.data[0].marker.colors].reverse());
});

test('the level palette can be kept for bins (color.slices: levels): the bins\' own colours, a legend, no colour bar', () => {
    const f = draw(...Object.values(bins({ color: { slices: 'levels' } })));
    assert.equal(colourTrace(f), undefined);
    assert.equal(f.layout.showlegend, true);
    const plain = draw(...Object.values(bins({ color: { slices: 'levels' } })));
    assert.equal(new Set(plain.data[0].marker.colors).size, 4);
});

test('categories keep their level palette and a legend, with no colour bar', () => {
    const f = draw(...Object.values(cats()));
    assert.equal(colourTrace(f), undefined);
    assert.equal(f.layout.showlegend, true);
    assert.equal(f.layout.legend.title.text, 'depth');
});

// --- the stored config -----------------------------------------------------------------------------------------------

test('the new options are stored only when they differ from their defaults', () => {
    assert.equal(norm({ x: obs('k'), color: { slices: 'continuous' } }).color, undefined, 'continuous is the default for bins');
    assert.deepEqual(norm({ x: obs('k'), color: { slices: 'levels' } }).color, { slices: 'levels' });
    assert.equal(K.drawOptions(norm({ x: obs('k') })).names, undefined);
    assert.equal(K.drawOptions(norm({ x: obs('k'), names: true })).names, true);
    assert.equal(K.drawOptions(norm({ x: obs('k'), color: { slices: 'levels' } })).pieColour, 'levels');
    assert.equal(K.drawOptions(norm({ x: obs('k') })).pieColour, undefined, 'continuous is the default');
    assert.equal(K.drawOptions(norm({ mode: 'bar', x: obs('k'), names: true })).names, undefined, 'a bar has no slice names');
});

test('an old pie link draws as before: categories unchanged, no new field', () => {
    const f = draw(...Object.values(cats({ labels: 'count', ring: true })));
    assert.equal(f.data[0].hole, 0.5);
    assert.deepEqual(notes(f).map((a) => a.text), ['850', '70', '50']);
    assert.ok(f.data.slice(1).every((t) => !(t.marker && t.marker.showscale)));
});

test('the Display pop-over: a pie of bins has the colour map unless the palette is kept; categories have the palette only', () => {
    const isNumeric = (s) => s.key === 'depth';
    const use = (c) => K.colorUse(norm(c), isNumeric);
    assert.deepEqual(use({ x: obs('depth') }), { map: true, palette: false });
    assert.deepEqual(use({ x: obs('depth'), color: { slices: 'levels' } }), { map: false, palette: true });
    assert.deepEqual(use({ x: obs('k') }), { map: false, palette: true });
    assert.deepEqual(use({ x: obs('depth', { binning: { method: 'categories' } }) }), { map: false, palette: true });
    assert.deepEqual(K.colorUse(norm({ x: obs('depth') })), { map: false, palette: true }, 'without the page\'s knowledge of numbers: as before');
    const s = (c) => K.sliceColourUse(norm(c), isNumeric);
    assert.deepEqual(s({ x: obs('depth') }), { offered: true, continuous: true, refusal: '' });
    assert.equal(s({ x: obs('k') }).continuous, false);
    assert.ok(s({ x: obs('k') }).refusal.length > 10, 'categories say why');
    assert.equal(K.sliceColourUse(norm({ mode: 'bar', x: obs('depth') }), isNumeric).offered, false);
});

test('the pie trace is named, so the legend invariant keeps its slices\' entries (a trace with no name is hidden from the legend)', async () => {
    const { isRealName, hasLegendEntries } = await import('../../../static/js/utils/legend-entries.js');
    const f = draw(...Object.values(cats()));
    assert.ok(isRealName(f.data[0].name), `the pie's name: ${f.data[0].name}`);
    assert.equal(hasLegendEntries(f.data), true);
});

test('bins merged into "other" stay out of the scale: the bins keep their centres and "other" takes the grey', () => {
    const config = norm({ x: obs('depth', { binning: { method: 'equal_width', bins: 4 } }), color: { map: 'Greys' } });
    const reply = { reply: { n_counted: 110, n_shown: 110, axes: [{ levels: ['bin:0', 'bin:1', 'bin:2', 'bin:3', '@other'], edges: [0, 10, 20, 30, 40], bins_made: 4, degenerate: false, n_outside: [0, 0] }] },
        counts: [40, 30, 20, 10, 10], measures: null };
    const table = M.countTable(config, M.readGrid(reply), [{ input: 'x' }]);
    const f = draw(config, table);
    assert.deepEqual(colourTrace(f).marker.color, [5, 15, 25, 35, null]);
    assert.equal(f.data[0].marker.colors[4], PLOT_PALETTES.light.notInTableColor);
});

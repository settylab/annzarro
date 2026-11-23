/**
 * What a count plot draws (panels/cell-count/draw.js, C3): the Plotly figure of a bar, a histogram, a 2D histogram, a
 * heatmap and a pie, and the CSV of the plotted table. Every number the figure shows is compared with the table's own
 * (count-plot-model.js, itself tested against F0's fixture), and the layout words come from the `words` the caller
 * passes, so a test reads the figure and not a string it would have to retype.
 *
 * Run:  node --test annzarro/tests/js/count-plot-draw.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { expected } from './fixtures/grouping.mjs';

const M = await import('../../../static/js/utils/count-plot-model.js');
const D = await import('../../../static/js/panels/cell-count/draw.js');
const { PLOT_PALETTES } = await import('../../../static/js/utils/plot-theme.js');

const obs = (key) => ({ source: { type: 'obs', key } });
const norm = (config) => M.normalizeCountPlot({ version: 1, ...config }).config;

const words = {
    count: 'Cell count', fill: '% of cells in each bar', hoverCount: 'Cells', hoverShare: 'Share',
    share: (base) => `Share of ${base}`, measure: (stat, source, above) => `${stat} of ${source}${above === undefined ? '' : ` above ${above}`}`,
    topLevel: (name) => `Most frequent level of ${name}`
};
const PALETTE = ['#111111', '#222222', '#333333', '#444444'];
const inputNames = { x: 'cell_type', y: 'condition', split: 'condition', factor: 'sample' };
const opts = (options = {}, extra = {}) => ({ options, words, inputNames, palette: PALETTE, theme: PLOT_PALETTES.light, measureSource: 'score', ...extra });

const withContract = ({ counts, measure, ...reply }) => ({
    reply: { n_shown: reply.n_counted, ...reply,
        axes: reply.axes.map((a) => {
            const bins = a.levels.filter((id) => id.startsWith('bin:')).length;
            const binned = bins ? { edges: Array.from({ length: bins + 1 }, (_, k) => k * 10), bins_made: bins, degenerate: false } : {};
            return { n_outside: [0, 0], ...binned, ...a };
        }) },
    counts, measures: measure || null });
const gridOf = (reply) => M.readGrid(withContract(reply));
const tableOf = (config, reply, inputs) => M.countTable(config, gridOf(reply), inputs.map((input) => ({ input })));

/** Three cell types by two conditions with a measure: the fixture of F0's grid. */
const fixture = (over = {}) => {
    const config = norm({ mode: 'bar', x: obs('cell_type'), split: obs('condition'), measure: { stat: 'mean', source: { type: 'obs', key: 'score' }, above: 5 }, ...over });
    return { config, table: M.countTable(config, M.readGrid(withContract({ ...expected.grid.cell_type_x_condition })), [{ input: 'x' }, { input: 'split' }]) };
};

const small = (mode, over = {}) => {
    const config = norm({ mode, x: obs('k'), ...over });
    const reply = { axes: [{ levels: ['c:a', 'c:b', 'c:c'] }], counts: [30, 10, 60], n_counted: 100 };
    return { config, table: tableOf(config, reply, ['x']) };
};

// --- bar -------------------------------------------------------------------------------------------------------------

test('a bar plot is one bar trace of the counts, in the levels\' order, with a tick of text for each level', () => {
    const { config, table } = small('bar');
    const f = D.countFigure(config, table, opts());
    assert.equal(f.data.length, 1);
    assert.equal(f.data[0].type, 'bar');
    assert.deepEqual(f.data[0].y, [30, 10, 60]);
    assert.deepEqual(f.data[0].x, [0, 1, 2]);
    assert.deepEqual(f.layout.xaxis.ticktext, ['a', 'b', 'c']);
    assert.equal(f.layout.yaxis.title.text, 'Cell count');
    assert.equal(f.layout.showlegend, false);
});

test('two levels with one label stay two bars, and a label cannot inject markup', () => {
    const { config, table } = small('bar');
    const labels = [new Map([['c:a', 'Same'], ['c:b', 'Same'], ['c:c', '<b>x</b> & y']])];
    const f = D.countFigure(config, table, opts({}, { labels }));
    assert.equal(f.data[0].x.length, 3);
    assert.deepEqual(f.layout.xaxis.ticktext, ['Same', 'Same', '&lt;b&gt;x&lt;/b&gt; &amp; y']);
});

test('a split makes one trace per level, colored by level, with the arrangement as the layout', () => {
    const { config, table } = fixture({ value: undefined, measure: undefined });
    const cts = table.dims[0];
    for (const [arrangement, layout] of [['stack', { barmode: 'stack' }], ['dodge', { barmode: 'group' }], ['fill', { barmode: 'stack', barnorm: 'percent' }]]) {
        const f = D.countFigure({ ...config, arrangement }, table, opts());
        assert.equal(f.data.length, table.dims[1]);
        for (const [k, v] of Object.entries(layout)) assert.equal(f.layout[k], v, `${arrangement} ${k}`);
        assert.equal(f.layout.showlegend, true);
        assert.equal(f.layout.legend.title.text, 'condition');
        f.data.forEach((t, s) => {
            assert.equal(t.marker.color, PALETTE[s % PALETTE.length]);
            for (let l = 0; l < cts; l++) assert.equal(t.y[l], table.count[l * table.stride[0] + s * table.stride[1]]);
        });
    }
    assert.equal(D.countFigure({ ...config, arrangement: 'fill' }, table, opts()).layout.yaxis.title.text, words.fill);
});

test('a level\'s own color from the reply wins over the palette', () => {
    const { config, table } = fixture({ value: undefined, measure: undefined });
    table.axes[1].info = { ...table.axes[1].info, colors: { [table.axes[1].levels[0]]: '#abcdef' } };
    const f = D.countFigure(config, table, opts());
    assert.equal(f.data[0].marker.color, '#abcdef');
    assert.equal(f.data[1].marker.color, PALETTE[1]);
});

test('a share is drawn as the model computes it, as a percent axis; stacked means are never added', () => {
    const { config, table } = fixture({ value: { kind: 'share', of: 'x' }, measure: undefined });
    const share = M.shareValues(table, 'x');
    const f = D.countFigure(config, table, opts());
    assert.equal(f.layout.yaxis.title.text, 'Share of x');
    assert.equal(f.layout.yaxis.tickformat, '.0%');
    f.data.forEach((t, s) => t.y.forEach((y, l) => assert.equal(y, share[l * table.stride[0] + s * table.stride[1]])));
    const m = fixture({ value: { kind: 'measure' } });
    const g = D.countFigure(m.config, m.table, opts());
    assert.equal(g.layout.barmode, 'group');
    assert.equal(g.layout.barnorm, undefined);
    const means = M.measureValues(m.table, 'mean');
    g.data.forEach((t, s) => t.y.forEach((y, l) => {
        const v = means[l * m.table.stride[0] + s * m.table.stride[1]];
        assert.equal(y, Number.isNaN(v) ? null : v);
    }));
    assert.equal(g.layout.yaxis.title.text, 'mean of score above 5');
});

test('a bar without a value is a gap, not a zero', () => {
    const { config, table } = fixture({ value: { kind: 'measure' } });
    const means = M.measureValues(table, 'mean');
    const empty = Array.from(means).findIndex((v) => Number.isNaN(v));
    if (empty < 0) return;
    const f = D.countFigure(config, table, opts());
    const s = Math.floor(empty / table.stride[1]) % table.dims[1];
    assert.equal(f.data[s].y[Math.floor(empty / table.stride[0])], null);
});

test('a measure height without a measure is refused, not drawn as counts', () => {
    const { config, table } = small('bar', { value: { kind: 'measure' } });
    assert.throws(() => D.countFigure(config, table, opts()), /measure/);
});

test('levels sort by height and reverse; the ticks and the bars move together', () => {
    const { config, table } = small('bar');
    const f = D.countFigure(config, table, opts({ sort: 'height' }));
    assert.deepEqual(f.data[0].y, [60, 30, 10]);
    assert.deepEqual(f.layout.xaxis.ticktext, ['c', 'a', 'b']);
    assert.deepEqual(D.countFigure(config, table, opts({ sort: 'height', reverse: true })).layout.xaxis.ticktext, ['b', 'a', 'c']);
    assert.deepEqual(D.countFigure(config, table, opts({ reverse: true })).data[0].y, [60, 10, 30]);
});

test('horizontal puts the levels on y, first at the top, and the value on x', () => {
    const { config, table } = small('bar');
    const f = D.countFigure(config, table, opts({ horizontal: true }));
    assert.equal(f.data[0].orientation, 'h');
    assert.deepEqual(f.data[0].x, [30, 10, 60]);
    assert.deepEqual(f.data[0].y, [0, 1, 2]);
    assert.equal(f.layout.yaxis.autorange, 'reversed');
    assert.equal(f.layout.xaxis.title.text, 'Cell count');
});

test('a log axis is for counts only', () => {
    const { config, table } = small('bar');
    assert.equal(D.countFigure(config, table, opts({ log: true })).layout.yaxis.type, 'log');
    const s = small('bar', { value: { kind: 'share' } });
    assert.equal(D.countFigure(s.config, s.table, opts({ log: true })).layout.yaxis.type, undefined);
});

test('printed labels show the count, the share or the measure, and none shows nothing', () => {
    const { config, table } = small('bar');
    assert.equal(D.countFigure(config, table, opts()).data[0].text, undefined);
    assert.equal(D.countFigure(config, table, opts({ labels: 'none' })).data[0].text, undefined);
    assert.deepEqual(D.countFigure(config, table, opts({ labels: 'count' })).data[0].text, ['30', '10', '60']);
    assert.deepEqual(D.countFigure(config, table, opts({ labels: 'share' })).data[0].text, ['30%', '10%', '60%']);
    const m = fixture({ value: { kind: 'count' } });
    const means = M.measureValues(m.table, 'mean');
    const texts = D.countFigure(m.config, m.table, opts({ labels: 'measure' })).data[0].text;
    assert.equal(texts[0], Number.isFinite(means[0]) ? String(Number(means[0].toPrecision(4))) : '');
    assert.equal(D.countFigure(config, table, opts({ labels: 'count' })).layout.uniformtext.mode, 'hide');
    assert.throws(() => D.countFigure(config, table, opts({ labels: 'weird' })), /Unknown label kind/);
});

test('hover names the levels, the count, the share and the measure with its statistic and source', () => {
    const { config, table } = fixture({ value: { kind: 'count' } });
    const t = D.countFigure(config, table, opts()).data[0];
    const labels = M.levelLabelsOf(config, table);
    const first = t.hovertext[0];
    assert.ok(first.startsWith(`${labels[0].get(table.axes[0].levels[0])} × ${labels[1].get(table.axes[1].levels[0])}<br>`), first);
    assert.ok(first.includes(`Cells: ${table.count[0].toLocaleString('en-US')}`), first);
    assert.ok(first.includes('Share: '), first);
    assert.ok(first.includes('mean of score above 5: '), first);
    assert.equal(t.hoverinfo, 'text');
});

// --- histogram -------------------------------------------------------------------------------------------------------

const hist = (levels, counts, edges, over = {}) => {
    const config = norm({ mode: 'histogram', x: { source: { type: 'obs', key: 'depth' }, binning: { method: 'equal_width', bins: 3 } }, ...over });
    return { config, table: tableOf(config, { axes: [{ levels, ...(edges ? { edges } : {}) }], counts, n_counted: counts.reduce((x, y) => x + y, 0) }, ['x']) };
};

test('a histogram sits on the numeric axis: each bar at its bin\'s center with its bin\'s width', () => {
    const { config, table } = hist(['bin:0', 'bin:1', 'bin:2', '@na'], [5, 8, 2, 7]);
    const f = D.countFigure(config, table, opts());
    const t = f.data[0];
    assert.deepEqual(t.x, [5, 15, 25]);
    assert.deepEqual(t.width, [10, 10, 10]);
    assert.deepEqual(t.y, [5, 8, 2]);
    assert.equal(f.layout.bargap < 0.1, true);
    assert.equal(f.layout.xaxis.tickvals, undefined);
    assert.equal(f.layout.xaxis.title.text, 'cell_type');
});

test('the cells without a value are not a bar of a histogram', () => {
    const { config, table } = hist(['bin:0', 'bin:1', 'bin:2', '@na'], [5, 8, 2, 7]);
    assert.equal(D.countFigure(config, table, opts()).data[0].y.length, 3);
});

test('a zero bin is a bar just left of the first edge, not on the axis of another', () => {
    const { config, table } = hist(['@zero', 'bin:0', 'bin:1', 'bin:2'], [9, 5, 8, 2], [4, 14, 24, 34]);
    const t = D.countFigure(config, table, opts()).data[0];
    assert.deepEqual(t.y, [9, 5, 8, 2]);
    assert.equal(t.x[0], 0);
    assert.ok(t.x[0] + t.width[0] / 2 <= t.x[1] - t.width[1] / 2 + 1e-9, 'the zero bar does not overlap the first bin');
});

test('overlaid histograms of a split are translucent; stacked ones are not', () => {
    const config = norm({ mode: 'histogram', x: { source: { type: 'obs', key: 'depth' }, binning: { method: 'equal_width', bins: 3 } }, split: obs('c'), arrangement: 'dodge' });
    const table = tableOf(config, { axes: [{ levels: ['bin:0', 'bin:1', 'bin:2'] }, { levels: ['c:p', 'c:q'] }], counts: [1, 2, 3, 4, 5, 6], n_counted: 21 }, ['x', 'split']);
    const over = D.countFigure(config, table, opts());
    assert.equal(over.layout.barmode, 'overlay');
    assert.ok(over.data.every((t) => t.opacity < 1));
    assert.deepEqual(over.data.map((t) => t.y), [[1, 3, 5], [2, 4, 6]]);
    const stacked = D.countFigure({ ...config, arrangement: 'stack' }, table, opts());
    assert.equal(stacked.layout.barmode, 'stack');
    assert.ok(stacked.data.every((t) => t.opacity === undefined));
});

test('levels that are not bins (an integer split by its values) are drawn as categories', () => {
    const config = norm({ mode: 'histogram', x: { source: { type: 'obs', key: 'n' }, binning: { method: 'categories' } } });
    const table = tableOf(config, { axes: [{ levels: ['c:1', 'c:2', 'c:3'], edges: [1, 2, 3], bins_made: 3, degenerate: false }], counts: [4, 5, 6], n_counted: 15 }, ['x']);
    const f = D.countFigure(config, table, opts());
    assert.deepEqual(f.data[0].x, [0, 1, 2]);
    assert.deepEqual(f.layout.xaxis.ticktext, ['1', '2', '3']);
});

test('reversing a histogram reverses its axis', () => {
    const { config, table } = hist(['bin:0', 'bin:1', 'bin:2'], [1, 2, 3]);
    assert.equal(D.countFigure(config, table, opts({ reverse: true })).layout.xaxis.autorange, 'reversed');
});

// --- 2D histogram and heatmap ----------------------------------------------------------------------------------------

const rect = (mode, over = {}) => {
    const config = norm({ mode, x: mode === 'hist2d' ? { source: { type: 'obs', key: 'a' }, binning: { method: 'equal_width', bins: 3 } } : obs('a'),
        y: mode === 'hist2d' ? { source: { type: 'obs', key: 'b' }, binning: { method: 'equal_width', bins: 2 } } : obs('b'), ...over });
    const xl = mode === 'hist2d' ? ['bin:0', 'bin:1', 'bin:2'] : ['c:p', 'c:q', 'c:r'];
    const yl = mode === 'hist2d' ? ['bin:0', 'bin:1'] : ['c:u', 'c:v'];
    return { config, table: tableOf(config, { axes: [{ levels: xl }, { levels: yl }], counts: [1, 0, 2, 3, 4, 5], n_counted: 15 }, ['x', 'y']) };
};

test('a 2D histogram is a heatmap of the counts: rows are y, columns x, an empty rectangle is no color', () => {
    const { config, table } = rect('hist2d');
    const f = D.countFigure(config, table, opts());
    const t = f.data[0];
    assert.equal(t.type, 'heatmap');
    assert.deepEqual(t.x, [5, 15, 25]);
    assert.deepEqual(t.y, [5, 15]);
    assert.deepEqual(t.z, [[1, 2, 4], [null, 3, 5]]);
    assert.equal(t.colorbar.title.text, 'Cell count');
    assert.equal(f.layout.showlegend, false);
});

test('a heatmap shows its zeros as zeros, rows from the top, with a tick of text for each level', () => {
    const { config, table } = rect('heatmap');
    const f = D.countFigure(config, table, opts());
    assert.deepEqual(f.data[0].z, [[1, 2, 4], [0, 3, 5]]);
    assert.equal(f.layout.yaxis.autorange, 'reversed');
    assert.deepEqual(f.layout.xaxis.ticktext, ['p', 'q', 'r']);
    assert.deepEqual(f.layout.yaxis.ticktext, ['u', 'v']);
});

test('a heatmap prints its cells when asked to', () => {
    const { config, table } = rect('heatmap');
    assert.equal(D.countFigure(config, table, opts()).data[0].texttemplate, undefined);
    const t = D.countFigure(config, table, opts({ labels: 'count' })).data[0];
    assert.equal(t.texttemplate, '%{text}');
    assert.deepEqual(t.text, [['1', '2', '4'], ['0', '3', '5']]);
});

test('a heatmap of shares by its row, column or total is the model\'s share', () => {
    for (const of of ['row', 'column', 'total']) {
        const { config, table } = rect('heatmap', { value: { kind: 'share', of } });
        const f = D.countFigure(config, table, opts());
        const share = M.shareValues(table, of);
        const rows = [0, 1].map((yl) => [0, 1, 2].map((xl) => share[xl * table.stride[0] + yl * table.stride[1]]));
        assert.deepEqual(f.data[0].z, rows.map((r) => r.map((v) => (Number.isNaN(v) ? null : v))), of);
        assert.equal(f.data[0].colorbar.tickformat, '.0%');
    }
});

test('a z-score is colored around zero on a diverging scale', () => {
    const config = norm({ mode: 'heatmap', x: obs('a'), y: obs('b'), value: { kind: 'measure' }, measure: { stat: 'zscore', source: { type: 'obs', key: 's' } } });
    const rows = [[2, 4, 8, 4, 2], [1, 2, 3, 2, 1], [3, 9, 27, 9, 3], [1, 1, 1, 1, 1]];
    const table = tableOf(config, { axes: [{ levels: ['c:p', 'c:q'] }, { levels: ['c:u', 'c:v'] }], counts: [4, 4, 4, 4], measure: rows, n_counted: 16 }, ['x', 'y']);
    const t = D.countFigure(config, table, opts()).data[0];
    assert.equal(t.zmid, 0);
    assert.equal(t.reversescale, true);
    assert.equal(t.colorscale, 'RdBu');
});

test('a numeric color uses the chosen color map, and a named extra scale its stops', () => {
    const { config, table } = rect('heatmap');
    assert.equal(D.countFigure(config, table, opts()).data[0].colorscale, 'Viridis');
    assert.equal(D.countFigure(config, table, opts({ colorscale: 'Cividis' })).data[0].colorscale, 'Cividis');
    assert.ok(Array.isArray(D.countFigure(config, table, opts({ colorscale: 'Inferno' })).data[0].colorscale));
});

const topTable = () => {
    const config = norm({ mode: 'heatmap', x: obs('a'), y: obs('b'), value: { kind: 'top_level', factor: obs('f') } });
    // rectangles (x,y): p/u 3 vs 1, p/v 1 vs 1 (tie), q/u 0 vs 4, q/v empty
    const reply = { axes: [{ levels: ['c:p', 'c:q'] }, { levels: ['c:u', 'c:v'] }, { levels: ['c:A', 'c:B'] }], counts: [3, 1, 1, 1, 0, 4, 0, 0], n_counted: 10 };
    return { config, table: tableOf(config, reply, ['x', 'y', 'factor']) };
};

test('a rectangle is colored by its most frequent level; an empty one has no color', () => {
    const { config, table } = topTable();
    const f = D.countFigure(config, table, opts());
    const t = f.data[0];
    assert.deepEqual(t.z, [[0, 1], [0, null]]);
    assert.equal(t.showscale, false);
    assert.equal(t.colorscale.length, 4);
    assert.deepEqual(t.colorscale.map((s) => s[1]), [PALETTE[0], PALETTE[0], PALETTE[1], PALETTE[1]]);
    assert.deepEqual(f.data.slice(1).map((s) => [s.type, s.name, s.marker.color]), [['scatter', 'A', PALETTE[0]], ['scatter', 'B', PALETTE[1]]]);
    assert.equal(f.layout.showlegend, true);
    assert.equal(f.layout.legend.title.text, 'sample');
    assert.ok(t.hovertext[0][0].endsWith('A: 75%'), t.hovertext[0][0]);
});

test('fading by the level\'s share steps each level through lighter colors', () => {
    const { config, table } = topTable();
    const f = D.countFigure(config, table, opts({ fade: true }));
    const t = f.data[0];
    assert.equal(t.colorscale.length, 2 * 2 * 4);
    // p/u: level A (0) with share .75 -> step 3; p/v: level A (tie goes first) with .5 -> step 2; q/u: B with 1 -> step 3
    assert.deepEqual(t.z, [[0 * 4 + 3, 1 * 4 + 3], [0 * 4 + 2, null]]);
    const light = t.colorscale[0][1];
    const full = t.colorscale[2 * 3][1];
    assert.notEqual(light, full);
    assert.equal(full, '#111111');
});

test('the labels of the most frequent level come from the caller when it has them', () => {
    // the caller's names are the factor's renames (C2a: opts.topLabels gave way to the factor's own `labels`)
    const { config, table } = topTable();
    const named = { ...config, value: { ...config.value, factor: { ...config.value.factor, labels: { 'c:A': 'Alpha', 'c:B': 'Beta' } } } };
    const f = D.countFigure(named, table, opts());
    assert.deepEqual(f.data.slice(1).map((s) => s.name), ['Alpha', 'Beta']);
});

// --- pie -------------------------------------------------------------------------------------------------------------

test('a pie has one slice per level in its order, none sorted behind the caller\'s back', () => {
    const { config, table } = small('pie');
    const f = D.countFigure(config, table, opts());
    const t = f.data[0];
    assert.equal(t.type, 'pie');
    assert.equal(t.sort, false);
    assert.deepEqual(t.labels, ['a', 'b', 'c']);
    assert.deepEqual(t.values, [30, 10, 60]);
    assert.deepEqual(t.marker.colors, PALETTE.slice(0, 3));
    assert.equal(t.hole, 0);
    assert.equal(t.textinfo, 'none');
    assert.deepEqual(D.countFigure(config, table, opts({ sort: 'height' })).data[0].labels, ['c', 'a', 'b']);
});

test('a ring is a pie with a hole, and its labels show the count or the share', () => {
    const { config, table } = small('pie');
    assert.equal(D.countFigure(config, table, opts({ ring: true })).data[0].hole, 0.5);
    assert.equal(D.countFigure(config, table, opts({ labels: 'count' })).data[0].textinfo, 'value');
    assert.equal(D.countFigure(config, table, opts({ labels: 'share' })).data[0].textinfo, 'percent');
});

test('the collected rest of a pie is grey, last, with its count', () => {
    const levels = Array.from({ length: 15 }, (_, i) => `c:L${i}`);
    const counts = levels.map((_, i) => 100 - i * 5);
    const config = norm({ mode: 'pie', x: obs('k') });
    const table = tableOf(config, { axes: [{ levels }], counts, n_counted: counts.reduce((a, b) => a + b, 0) }, ['x']);
    const t = D.countFigure(config, table, opts()).data[0];
    assert.equal(t.values.length, 13);
    assert.equal(t.values[12], counts.slice(12).reduce((a, b) => a + b, 0));
    assert.equal(t.marker.colors[12], PLOT_PALETTES.light.notInTableColor);
    assert.equal(t.labels[12], 'k other');
});

// --- modes, the table, and cost --------------------------------------------------------------------------------------

test('the modes with a drawing of their own are refused here, by name', () => {
    assert.deepEqual([...D.DRAWN_MODES], ['bar', 'histogram', 'hist2d', 'heatmap', 'pie']);
    const { table } = small('bar');
    for (const mode of ['density', 'density2d', 'venn', 'upset']) {
        assert.throws(() => D.countFigure({ ...norm({ mode }), mode }, table, opts()), new RegExp(mode));
    }
});

test('drawing leaves the table as it was', () => {
    const { config, table } = rect('heatmap', { value: { kind: 'share', of: 'row' } });
    const before = JSON.stringify({ c: Array.from(table.count), r: table.rows, d: table.dims });
    D.countFigure(config, table, opts({ labels: 'share', sort: 'height', reverse: true }));
    assert.equal(JSON.stringify({ c: Array.from(table.count), r: table.rows, d: table.dims }), before);
});

test('a 512 by 512 heatmap is one z row per level of y, built in a pass over its rows', () => {
    const n = 512;
    const config = norm({ mode: 'heatmap', x: obs('a'), y: obs('b') });
    const levels = (p) => Array.from({ length: n }, (_, i) => `c:${p}${i}`);
    // the model's heatmap limit is 200; the drawing has none of its own, so it is built straight from a grid
    const reply = { axes: [{ levels: levels('x') }, { levels: levels('y') }], counts: new Float64Array(n * n).map((_, i) => i % 7), n_counted: 1 };
    const table = tableOf(config, reply, ['x', 'y']);
    const f = D.countFigure(config, table, opts({ labels: 'count' }));
    assert.equal(f.data[0].z.length, n);
    assert.equal(f.data[0].z[0].length, n);
    assert.equal(f.data[0].z[3][5], table.count[5 * table.stride[0] + 3 * table.stride[1]]);
});

// --- the CSV ---------------------------------------------------------------------------------------------------------

const headers = { count: 'Cells', share: 'Share', measure: 'Mean of score' };

test('the CSV is the plotted table: levels by their labels, the count, the share and the measure', () => {
    const { config, table } = fixture({ value: { kind: 'count' } });
    const csv = D.countCsv(config, table, { inputNames: { x: 'cell_type', split: 'condition' }, headers });
    const lines = csv.split('\n');
    assert.equal(lines[0], 'cell_type,condition,Cells,Share,Mean of score');
    assert.equal(lines.length, table.rows + 1);
    const labels = M.levelLabelsOf(config, table);
    const share = M.shareValues(table, 'all');
    const mean = M.measureValues(table, 'mean');
    const cells = lines[1].split(',');
    assert.equal(cells[0], labels[0].get(table.axes[0].levels[0]));
    assert.equal(cells[1], labels[1].get(table.axes[1].levels[0]));
    assert.equal(Number(cells[2]), table.count[0]);
    assert.equal(Number(cells[3]), share[0]);
    assert.equal(cells[4] === '' ? NaN : Number(cells[4]), mean[0]);
});

test('the CSV uses the share base the plot shows, and the labels the caller shows', () => {
    const { config, table } = small('bar', { value: { kind: 'share', of: 'all' } });
    const labels = [new Map([['c:a', 'Alpha, the first'], ['c:b', '=cmd'], ['c:c', 'C']])];
    const csv = D.countCsv(config, table, { inputNames: { x: 'k' }, headers, labels });
    assert.deepEqual(csv.split('\n').slice(1), ['"Alpha, the first",30,0.3', "'=cmd,10,0.1", 'C,60,0.6']);
});

// --- an unticked level keeps its name ------------------------------------------------------------------------------

test('an unticked level of a grouping source keeps its display name, where the checklist reads it', () => {
    const young = 'g:["c:Young","bin:0"]';
    const old = 'g:["c:Old","bin:1"]';
    const config = norm({ mode: 'bar', x: { source: { type: 'group', key: 'G' }, levels: [young] } });
    const reply = { axes: [{ levels: [young, '@other'], categories: [young, old], names: { [young]: 'Young | Rnase6 < 0.391', [old]: 'Old | Rnase6 > 0.391' } }],
        counts: [30, 70], n_counted: 100 };
    const table = tableOf(config, reply, ['x']);
    const [labels] = M.levelLabelsOf(config, table);
    assert.equal(labels.get(young), 'Young | Rnase6 < 0.391');
    assert.equal(labels.get(old), 'Old | Rnase6 > 0.391', 'the unticked level is named, not keyed');
});

// --- even-width bins (WP-9, decision 28) -----------------------------------------------------------------------------

const binned = (mode, method, levels, edges, over = {}) => {
    const input = (key, extra = {}) => ({ source: { type: 'obs', key }, binning: { method, ...extra } });
    const config = norm({ mode, x: input('a', over.xBinning), ...(mode === 'hist2d' ? { y: input('b') } : {}), ...(over.config || {}) });
    const xAxis = { levels, edges };
    const axes = mode === 'hist2d' ? [xAxis, { levels: ['bin:0', 'bin:1'], edges: [1, 2, 3] }] : [xAxis];
    const counts = Array.from({ length: levels.length * (mode === 'hist2d' ? 2 : 1) }, (_, i) => i + 1);
    return { config, table: tableOf(config, { axes, counts, n_counted: 100 }, mode === 'hist2d' ? ['x', 'y'] : ['x']) };
};
const LOG = ['bin:0', 'bin:1', 'bin:2'];
const LOG_EDGES = [1, 10, 100, 1000];

test('log bins of a 2D histogram are drawn at their index, with ticks at the borders labelled by the edges', () => {
    const { config, table } = binned('hist2d', 'log', LOG, LOG_EDGES);
    const f = D.countFigure(config, table, opts());
    assert.deepEqual(f.data[0].x, [0, 1, 2]);
    assert.deepEqual(f.layout.xaxis.tickvals, [-0.5, 0.5, 1.5, 2.5]);
    assert.deepEqual(f.layout.xaxis.ticktext, ['1', '10', '100', '1000']);
    assert.equal(f.layout.xaxis.tickmode, 'array');
    assert.equal(f.layout.xaxis.zeroline, false, 'index 0 is not the value 0');
});

test('an index axis shows the real range of a bin in the hover', () => {
    const { config, table } = binned('hist2d', 'log', LOG, LOG_EDGES);
    const hover = D.countFigure(config, table, opts()).data[0].hovertext;
    assert.match(hover[0][1], /10 to 100/);
    assert.match(hover[0][0], /1 to 10/);
    assert.match(hover[1][2], /2 to 3/);
});

test('equal-width bins stay at their values by default, and the switch moves either kind', () => {
    const eq = binned('hist2d', 'equal_width', LOG, [0, 10, 20, 30]);
    assert.equal(M.binSpacingOf(eq.config, 'x'), 'value');
    assert.deepEqual(D.countFigure(eq.config, eq.table, opts()).data[0].x, [5, 15, 25]);
    const forced = norm({ ...eq.config, binSpacing: { x: 'even' } });
    assert.deepEqual(D.countFigure(forced, eq.table, opts()).data[0].x, [0, 1, 2]);
    const lg = binned('hist2d', 'log', LOG, LOG_EDGES);
    assert.equal(M.binSpacingOf(lg.config, 'x'), 'even');
    const atValues = norm({ ...lg.config, binSpacing: { x: 'value' } });
    assert.deepEqual(D.countFigure(atValues, lg.table, opts()).data[0].x, [5.5, 55, 550]);
});

test('equal-count and manual bins default to even too, and a missing switch is the default', () => {
    assert.equal(M.binSpacingOf(norm({ mode: 'hist2d', x: { source: { type: 'obs', key: 'a' }, binning: { method: 'equal_count' } } }), 'x'), 'even');
    assert.equal(M.binSpacingOf(norm({ mode: 'hist2d', x: { source: { type: 'obs', key: 'a' }, binning: { method: 'manual', thresholds: [1, 2] } } }), 'x'), 'even');
    assert.equal(M.binSpacingOf(norm({ mode: 'hist2d', x: obs('a') }), 'x'), 'value');
});

test('a histogram of log bins is bars of one width at the indexes', () => {
    const { config, table } = binned('histogram', 'log', LOG, LOG_EDGES);
    const f = D.countFigure(config, table, opts());
    assert.deepEqual(f.data[0].x, [0, 1, 2]);
    assert.deepEqual(f.data[0].width, [1, 1, 1]);
    assert.deepEqual(f.layout.xaxis.ticktext, ['1', '10', '100', '1000']);
    assert.match(f.data[0].hovertext[1], /10 to 100/);
});

test('the zero bin is a slot of its own at the left, labelled 0', () => {
    const { config, table } = binned('hist2d', 'log', ['@zero', 'bin:0', 'bin:1'], [1, 10, 100], { xBinning: { zero_bin: true } });
    const f = D.countFigure(config, table, opts());
    assert.deepEqual(f.data[0].x, [0, 1, 2]);
    assert.equal(f.layout.xaxis.ticktext[0], '0');
    assert.match(f.data[0].hovertext[0][0], /a = 0/);
    assert.match(f.data[0].hovertext[0][1], /1 to 10/);
});

test('negative edges are labelled as they are', () => {
    const { config, table } = binned('hist2d', 'equal_count', LOG, [-5, -1.234567, 0.5, 8], {});
    const f = D.countFigure(config, table, opts());
    assert.deepEqual(f.layout.xaxis.ticktext, ['-5', '-1.23', '0.5', '8']);
    assert.match(f.data[0].hovertext[0][0], /-5 to -1.23/);
});

test('manual bins have open ends: no tick outside the thresholds, and the end bins read < and >=', () => {
    const { config, table } = binned('hist2d', 'manual', LOG, [5, 10], { xBinning: { thresholds: [5, 10] } });
    const f = D.countFigure(config, table, opts());
    assert.deepEqual(f.data[0].x, [0, 1, 2]);
    assert.deepEqual(f.layout.xaxis.tickvals, [0.5, 1.5]);
    assert.deepEqual(f.layout.xaxis.ticktext, ['5', '10']);
    const hover = f.data[0].hovertext[0];
    assert.match(hover[0], /a &lt; 5/);
    assert.match(hover[1], /5 to 10/);
    assert.match(hover[2], /≥ 10/);
});

test('many bins thin to about twelve labelled ticks, each at a border', () => {
    const levels = Array.from({ length: 60 }, (_, i) => `bin:${i}`);
    const edges = Array.from({ length: 61 }, (_, i) => 2 ** (i / 6));
    const { config, table } = binned('histogram', 'log', levels, edges);
    const f = D.countFigure(config, table, opts());
    const { tickvals, ticktext } = f.layout.xaxis;
    assert.ok(tickvals.length <= 13 && tickvals.length >= 6, String(tickvals.length));
    assert.equal(tickvals.length, ticktext.length);
    assert.ok(tickvals.every((v) => Number.isInteger(v + 0.5)));
});

test('the colour bar and the counts do not change with the drawing', () => {
    const lg = binned('hist2d', 'log', LOG, LOG_EDGES);
    const a = D.countFigure(lg.config, lg.table, opts()).data[0];
    const b = D.countFigure(norm({ ...lg.config, binSpacing: { x: 'value', y: 'value' } }), lg.table, opts()).data[0];
    assert.deepEqual(a.z, b.z);
    assert.deepEqual(a.colorbar, b.colorbar);
});


test('a 2D histogram with a Color by is one transparent-to-color layer per level, opacity on one scale of counts', () => {
    const config = norm({ mode: 'hist2d', split: obs('k'), x: { source: { type: 'obs', key: 'a' }, binning: { method: 'equal_width', bins: 3 } },
        y: { source: { type: 'obs', key: 'b' }, binning: { method: 'equal_width', bins: 2 } } });
    // x by y by level, the level innermost: level a counts 1..6, level b counts 10 for the first rectangle only
    const counts = [1, 10, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0];
    const table = tableOf(config, { axes: [{ levels: ['bin:0', 'bin:1', 'bin:2'] }, { levels: ['bin:0', 'bin:1'] }, { levels: ['c:a', 'c:b'] }], counts, n_counted: 36 }, ['x', 'y', 'split']);
    const f = D.countFigure(config, table, opts());
    const layers = f.data.filter((t) => t.type === 'heatmap');
    assert.equal(layers.length, 2);
    assert.deepEqual(layers[0].z, [[1, 3, 5], [2, 4, 6]]);
    assert.deepEqual(layers[1].z, [[10, null, null], [null, null, null]], 'a level with no cell in a rectangle leaves it empty');
    for (const t of layers) {
        assert.equal(t.zmin, 0);
        assert.equal(t.zmax, 10, 'one scale for every level: the highest count of any');
        assert.match(t.colorscale[0][1], /, 0\)$/);
        assert.equal(t.showscale, false);
    }
    assert.deepEqual(layers.map((t) => t.colorscale[1][1].replace(/[^#0-9a-f]/gi, '').slice(0, 7)).length, 2);
    const names = f.data.filter((t) => t.type === 'scatter').map((t) => t.name);
    assert.deepEqual(names, ['a', 'b'], 'a legend entry for each level');
    assert.equal(f.layout.showlegend, true);
    assert.equal(f.layout.legend.title.text, 'condition');
});

test('a log-binned 2D histogram with a Color by draws every level layer on the index axis with edge ticks', () => {
    const input = (key, binning) => ({ source: { type: 'obs', key }, binning });
    const config = norm({ mode: 'hist2d', x: input('a', { method: 'log' }), y: input('b', { method: 'equal_width' }), split: obs('s') });
    const reply = { axes: [{ levels: LOG, edges: LOG_EDGES }, { levels: ['bin:0', 'bin:1'], edges: [0, 5, 10] }, { levels: ['c:p', 'c:q'] }],
        counts: Array.from({ length: 12 }, (_, i) => i + 1), n_counted: 78 };
    const table = tableOf(config, reply, ['x', 'y', 'split']);
    const f = D.countFigure(config, table, opts());
    const layers = f.data.filter((t) => t.type === 'heatmap');
    assert.equal(layers.length, 2);
    for (const t of layers) {
        assert.deepEqual(t.x, [0, 1, 2]);
        assert.deepEqual(t.y, [5 / 2, 15 / 2]);
    }
    assert.deepEqual(f.layout.xaxis.tickvals, [-0.5, 0.5, 1.5, 2.5]);
    assert.deepEqual(f.layout.xaxis.ticktext, ['1', '10', '100', '1000']);
    assert.equal(f.layout.xaxis.zeroline, false);
    const atValues = D.countFigure(norm({ ...config, binSpacing: { x: 'value' } }), table, opts());
    assert.deepEqual(atValues.data[0].x, [5.5, 55, 550]);
});

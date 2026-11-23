/**
 * The range control (static/js/utils/range-control-model.js, static/js/ui/range-control.js): the Cell Plot's colour
 * range, extracted so the Cell-Gene Plot's colour, size and 3D height and the Count Plot's colour read one rule.
 *
 *   - the extracted scales give the same answers as the Cell Plot's original code, on the cases it has (skewed, tied,
 *     centred at 0, constant, empty);
 *   - the component: a slider release commits a value of the drawn range, the field follows the slider, auto commits
 *     null, a refused text is said, a constant statistic has disabled sliders;
 *   - the 3D height range limits the bars; the Cell-Gene options carry `heightLimits`; the Count Plot's colour values
 *     are read off the figure.
 *
 * Run:  node --test annzarro/tests/js/range-control.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const M = await import('../../../static/js/utils/range-control-model.js');
const S = await import('../../../static/js/utils/slider-scales.js');
const D = await import('../../../static/js/panels/cell-gene/draw.js');
const O = await import('../../../static/js/panels/cell-gene/options.js');
const B = await import('../../../static/js/utils/bars-3d.js');
const { colourValues } = await import('../../../static/js/panels/cell-count/colour.js');
const { PLOT_PALETTES } = await import('../../../static/js/utils/plot-theme.js');

// the Cell Plot's colorSliderScales as it was before the extraction (panel-ui-update.js)
function original(values, centered) {
    if (!centered) {
        const scale = S.quantileScale(values);
        return scale && { min: scale, max: scale };
    }
    const abs = S.quantileScale(values, { transform: Math.abs });
    return abs && { min: S.mirroredScale(abs), max: abs };
}

const skewed = Array.from({ length: 500 }, (_, i) => (i < 450 ? i / 450 : 1 + (i - 449) ** 2 / 10));
const sparse = [...new Array(900).fill(0), ...Array.from({ length: 100 }, (_, i) => 1 + i / 10)];
const CASES = {
    skewed, sparse, mixed: [-2.5, 0, 1.25, 7.75, NaN], constant: [2.5, 2.5, 2.5], empty: [NaN, null], typed: new Float32Array([3, 1, 2, NaN, 9])
};
const positions = Array.from({ length: 41 }, (_, i) => i / 40);

for (const [name, values] of Object.entries(CASES)) {
    for (const centered of [false, true]) {
        test(`Cell Plot cases: ${name}${centered ? ', centred' : ''} gives the original scales`, () => {
            const was = original(values, centered);
            const now = M.rangeScales(values, centered);
            if (was === null) { assert.equal(now, null); return; }
            for (const which of ['min', 'max']) {
                assert.equal(now[which].min, was[which].min);
                assert.equal(now[which].max, was[which].max);
                assert.equal(now[which].constant, was[which].constant);
                for (const p of positions) assert.equal(now[which].fromPos(p), was[which].fromPos(p), `${which} ${p}`);
                for (const v of [-10, -2.5, 0, 0.3, 1.25, 7.75, 100]) {
                    assert.equal(now[which].toPos(v, 'low'), was[which].toPos(v, 'low'));
                    assert.equal(now[which].toPos(v, 'high'), was[which].toPos(v, 'high'));
                }
            }
        });
    }
}

test('sliderValue and sliderTrack are the scale\'s valueAt and trackValue, and the raw value with no scale', () => {
    const { max } = M.rangeScales(skewed, false);
    for (const t of [0, 1, 250, 777, S.SLIDER_STEPS]) {
        assert.equal(M.sliderValue(max, t), S.valueAt(max, t));
        assert.equal(M.sliderTrack(max, S.valueAt(max, t), 'high'), S.trackValue(max, S.valueAt(max, t), 'high'));
    }
    assert.equal(M.sliderValue(null, '12.5'), 12.5);
    assert.equal(M.sliderTrack(null, 7, 'low'), 7);
    assert.equal(M.autoTrack('low'), 0);
    assert.equal(M.autoTrack('high'), S.SLIDER_STEPS);
    assert.deepEqual(M.rangeEnds(max), { min: max.min, max: max.max });
    assert.equal(M.rangeEnds(null), null);
});

// --- the component, over a minimal DOM -------------------------------------------------------------------------

class Node_ {
    constructor(tag, attrs = {}) {
        this.tag = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.value = ''; this.disabled = false; this.dataset = {};
        this.classList = { toggle() {} };
        for (const [k, v] of Object.entries(attrs)) {
            if (k === 'data') for (const [dk, dv] of Object.entries(v)) { if (dv !== undefined) this.dataset[dk] = dv; }
            else if (k === 'on') for (const [e, f] of Object.entries(v)) this.addEventListener(e, f);
            else if (k === 'value') this.value = String(v);
            else this.attributes[k] = v;
        }
    }
    addEventListener(e, f) { (this.listeners[e] ||= []).push(f); }
    setAttribute(k, v) { this.attributes[k] = v; }
    fire(e, extra = {}) { for (const f of this.listeners[e] || []) f({ target: this, preventDefault() {}, ...extra }); }
}
const el = (tag, attrs = {}, ...kids) => { const n = new Node_(tag, attrs); n.children = kids; return n; };
globalThis.document = { activeElement: null };
const { createRangeControl } = await import('../../../static/js/ui/range-control.js');

function mount(over = {}) {
    const commits = [];
    const problems = [];
    const range = createRangeControl({ el, what: 'Size', ends: [{ key: 'min', label: 'Min', option: 'm0' }, { key: 'max', label: 'Max', option: 'm1' }],
        onCommit: (i, v) => commits.push([i, v]), onProblem: (m) => problems.push(m), ...over });
    return { range, commits, problems };
}
const buttons = (range) => range.element.children.map((row) => row.children[3]);

test('the sliders span the drawn values; auto shows the data ends in the placeholders', () => {
    const { range } = mount();
    range.set({ values: [2, 4, 6, 8, 10], limits: [null, null] });
    const [lo, hi] = range.sliders;
    assert.equal(lo.value, '0');
    assert.equal(hi.value, String(S.SLIDER_STEPS));
    assert.match(range.fields[0].placeholder, /2/);
    assert.match(range.fields[1].placeholder, /10/);
    assert.equal(range.fields[0].value, '', 'automatic: the box is empty');
    assert.equal(range.sliders[0].disabled, false);
});

test('a limit is shown on its slider and in its field', () => {
    const { range } = mount();
    range.set({ values: [2, 4, 6, 8, 10], limits: [null, 6] });
    assert.equal(range.fields[1].value, '6');
    assert.equal(Number(range.sliders[1].value), S.SLIDER_STEPS / 2);
});

test('moving a slider moves its field; releasing commits the value at that position', () => {
    const { range, commits } = mount();
    range.set({ values: [2, 4, 6, 8, 10], limits: [null, null] });
    const hi = range.sliders[1];
    hi.value = String(S.SLIDER_STEPS / 2);
    hi.fire('input');
    assert.equal(range.fields[1].value, '6');
    assert.deepEqual(commits, [], 'nothing committed while it moves');
    hi.fire('change');
    assert.deepEqual(commits, [[1, 6]]);
    // the ends are the data's own ends, exactly
    hi.value = String(S.SLIDER_STEPS);
    hi.fire('change');
    assert.deepEqual(commits[1], [1, 10]);
});

test('a typed number commits; empty and auto commit null; text that is no number is refused and said', () => {
    const { range, commits, problems } = mount();
    range.set({ values: [2, 4, 6, 8, 10], limits: [null, null] });
    range.fields[0].value = '3.5';
    range.fields[0].fire('change');
    assert.deepEqual(commits.at(-1), [0, 3.5]);
    range.set({ values: [2, 4, 6, 8, 10], limits: [3.5, null] });
    range.fields[0].value = '';
    range.fields[0].fire('change');
    assert.deepEqual(commits.at(-1), [0, null]);
    range.set({ values: [2, 4, 6, 8, 10], limits: [3.5, null] });
    buttons(range)[0].fire('click');
    assert.deepEqual(commits.at(-1), [0, null]);
    const before = commits.length;
    range.fields[1].value = 'x';
    range.fields[1].fire('change');
    assert.equal(commits.length, before);
    assert.match(problems.at(-1), /Enter a number/);
    assert.equal(range.fields[1].value, '', 'the refused text is not kept');
});

test('a constant or empty statistic has nothing to slide over; the fields still take a limit', () => {
    const { range } = mount();
    range.set({ values: [5, 5, 5], limits: [null, null] });
    assert.ok(range.sliders[0].disabled && range.sliders[1].disabled);
    range.set({ values: null, limits: [null, 3] });
    assert.ok(range.sliders[0].disabled);
    assert.equal(range.fields[1].value, '3');
});

test('a text field takes the parse of its panel (the Count Plot\'s)', () => {
    const { range, commits, problems } = mount({ inputType: 'text', parse: (t) => (t === 'ok' ? { ok: true, value: 7 } : { ok: false, message: 'no' }) });
    range.set({ values: [1, 2, 3], limits: [null, null] });
    range.fields[0].value = 'ok';
    range.fields[0].fire('keydown', { key: 'Enter' });
    assert.deepEqual(commits, [[0, 7]]);
    range.fields[0].value = 'bad';
    range.fields[0].fire('change');
    assert.equal(problems.at(-1), 'no');
});

// --- what the range does to a figure -----------------------------------------------------------------------------

const LIGHT = PLOT_PALETTES.light;
function model3d(height) {
    const colour = Float64Array.from([1, 2, 3, 4, 5, 6]);
    return {
        mode: 'heatmap', view: '3d',
        groups: [{ label: 'a', n: 10 }, { label: 'b', n: 10 }, { label: 'c', n: 10 }],
        rows: [{ label: 'G0', section: { index: 0, title: 's' } }, { label: 'G1', section: { index: 0, title: 's' } }],
        color: { id: 'mean|X', stat: 'mean', layer: 'X', scaling: 'none', values: colour, colorscale: 'Reds' },
        size: { none: '' }, height: { same: true, values: colour, ...height }
    };
}
const tops = (fig) => { const m = fig.data.find((t) => t.type === 'mesh3d'); return Array.from({ length: m.x.length / B.VERTICES_PER_BAR }, (_, b) => m.z[b * B.VERTICES_PER_BAR + 4]).sort((p, q) => p - q); };

test('the 3D height range limits the bars: Max caps, Min floors', () => {
    assert.deepEqual(tops(D.buildFigure(model3d({}), LIGHT)), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(tops(D.buildFigure(model3d({ max: 4 }), LIGHT)), [1, 2, 3, 4, 4, 4]);
    assert.deepEqual(tops(D.buildFigure(model3d({ min: 3 }), LIGHT)), [3, 3, 3, 4, 5, 6]);
});

test('a bar of 0 stays undrawn under a Min above 0', () => {
    const m = model3d({ min: 2 });
    m.height.values = Float64Array.from([0, 1, 3, 4, 5, 6]);
    assert.equal(tops(D.buildFigure(m, LIGHT)).length, 5);
});

test('heightLimits of the config reach the model\'s height; absent, none', () => {
    assert.deepEqual(O.figureExtras({ mode: 'heatmap', heightLimits: [1, 4] }).height, { min: 1, max: 4 });
    assert.deepEqual(O.figureExtras({ mode: 'heatmap', heightLimits: [null, 4] }).height, { max: 4 });
    assert.deepEqual(O.figureExtras({ mode: 'heatmap' }).height, {});
});

test('the size range keeps its stored fields: dotMin and dotMax', () => {
    assert.deepEqual({ min: O.figureExtras({ mode: 'dots', dotMin: 5, dotMax: 80 }).size.dotMin, max: O.figureExtras({ mode: 'dots', dotMin: 5, dotMax: 80 }).size.dotMax }, { min: 5, max: 80 });
});

test('the Count Plot\'s colour values are the figure\'s scale: z of a heatmap, marker colours of a bar chart', () => {
    assert.deepEqual(Array.from(colourValues([{ type: 'heatmap', z: [[1, null], [3, 4]], colorbar: {} }])), [1, 3, 4]);
    assert.deepEqual(Array.from(colourValues([{ type: 'bar', marker: { color: [0.1, null, 0.9], showscale: true } }])), [0.1, 0.9]);
    assert.equal(colourValues([{ type: 'heatmap', z: [[1, 2]], showscale: false }]), null, 'a level-coloured heatmap has no scale');
    assert.equal(colourValues([{ type: 'bar', marker: { color: '#999' } }]), null);
});

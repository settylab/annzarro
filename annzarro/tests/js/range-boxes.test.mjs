/**
 * The range boxes (static/js/ui/range-boxes.js): the Min, Max and Center boxes of a scale in the Cell-Gene and Count
 * Plots' Color pop-overs. An unset box says "auto" with the value drawn, a set box its number, a reset (the arrow) returns the
 * group to auto in one step; the 3D height range limits the bars; the size boxes are named by the size statistic.
 *
 * Run:  node --test annzarro/tests/js/range-boxes.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const D = await import('../../../static/js/panels/cell-gene/draw.js');
const O = await import('../../../static/js/panels/cell-gene/options.js');
const B = await import('../../../static/js/utils/bars-3d.js');
const { colourValues } = await import('../../../static/js/panels/cell-count/colour.js');
const { PLOT_PALETTES } = await import('../../../static/js/utils/plot-theme.js');
const { VOCABULARY } = await import('../../../static/js/utils/vocabulary.js');

class Node_ {
    constructor(tag, attrs = {}) {
        this.tag = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.value = ''; this.disabled = false; this.dataset = {};
        this.placeholder = ''; this.textContent = '';
        this.classList = { toggle() {} };
        for (const [k, v] of Object.entries(attrs)) {
            if (k === 'data') for (const [dk, dv] of Object.entries(v)) { if (dv !== undefined) this.dataset[dk] = dv; }
            else if (k === 'on') for (const [e, f] of Object.entries(v)) this.addEventListener(e, f);
            else if (k === 'placeholder') this.placeholder = v;
            else this.attributes[k] = v;
        }
    }
    addEventListener(e, f) { (this.listeners[e] ||= []).push(f); }
    setAttribute(k, v) { this.attributes[k] = v; }
    fire(e, extra = {}) { for (const f of this.listeners[e] || []) f({ target: this, preventDefault() {}, ...extra }); }
}
const el = (tag, attrs = {}, ...kids) => { const n = new Node_(tag, attrs); n.children = kids.map((k) => (typeof k === 'string' ? Object.assign(new Node_('#text'), { textContent: k }) : k)); if (typeof kids[0] === 'string') n.textContent = kids[0]; return n; };
globalThis.document = { activeElement: null };
const { createRangeBoxes, drawnRange } = await import('../../../static/js/ui/range-boxes.js');

function mount(over = {}) {
    const commits = []; const resets = []; const problems = [];
    const boxes = createRangeBoxes({ el, what: 'Size', ends: [{ label: 'Size min', option: 'a' }, { label: 'Size max', option: 'b' }, { label: 'Center', option: 'c', hint: false }],
        onCommit: (i, v) => commits.push([i, v]), onReset: () => resets.push(1), onProblem: (m) => problems.push(m), ...over });
    return { boxes, commits, resets, problems };
}

test('drawnRange is the smallest and largest finite value; null with none', () => {
    assert.deepEqual(drawnRange([3, NaN, 1, 9]), [1, 9]);
    assert.equal(drawnRange([NaN]), null);
    assert.equal(drawnRange(null), null);
    assert.equal(drawnRange(new Float64Array(0)), null);
});

test('an unset box shows the drawn value alone (its title says it is automatic); a set box shows its number; Center has no drawn value', () => {
    const { boxes } = mount();
    boxes.set({ limits: [null, null, null], drawn: [0.125, 87.4] });
    assert.equal(boxes.fields[0].placeholder, '0.125');
    assert.equal(boxes.fields[1].placeholder, '87.4');
    assert.equal(boxes.fields[2].placeholder, 'auto');
    assert.equal(boxes.fields[0].value, '');
    boxes.set({ limits: [2, null, 0], drawn: [0.125, 87.4] });
    assert.equal(boxes.fields[0].value, '2');
    assert.equal(boxes.fields[2].value, '0');
    boxes.set({ limits: [null, null, null], drawn: null });
    assert.equal(boxes.fields[0].placeholder, 'auto');
});

test('the reset is disabled while every box is auto and calls onReset once', () => {
    const { boxes, resets } = mount();
    boxes.set({ limits: [null, null, null] });
    assert.equal(boxes.reset.disabled, true);
    boxes.set({ limits: [null, 4, null] });
    assert.equal(boxes.reset.disabled, false);
    boxes.reset.fire('click');
    assert.equal(resets.length, 1);
});

test('typing commits a number; empty commits null; text that is no number is refused and said', () => {
    const { boxes, commits, problems } = mount();
    boxes.set({ limits: [null, null, null] });
    boxes.fields[1].value = '12.5';
    boxes.fields[1].fire('change');
    assert.deepEqual(commits, [[1, 12.5]]);
    boxes.set({ limits: [null, 12.5, null] });
    boxes.fields[1].value = '';
    boxes.fields[1].fire('keydown', { key: 'Enter' });
    assert.deepEqual(commits.at(-1), [1, null]);
    boxes.fields[0].value = 'x';
    boxes.fields[0].fire('change');
    assert.match(problems.at(-1), /Enter a number/);
    assert.equal(commits.length, 2);
    assert.equal(boxes.fields[0].value, '');
});

test('the labels follow the data when set() gives them', () => {
    const { boxes } = mount();
    boxes.set({ limits: [], labels: ['Size min (% expressing)', 'Size max (% expressing)', 'Center'] });
    assert.equal(boxes.fields[0].attributes['aria-label'], 'Size min (% expressing)');
});

test('the size boxes are worded by the statistic, not by "%"', () => {
    const W = VOCABULARY.cellGene;
    assert.equal(W.options.sizeMin, 'Size min');
    assert.equal(W.options.sizeMax, 'Size max');
    assert.equal(W.statistic.pct_expressing, '% expressing');
    assert.equal(W.options.dotMin, undefined, 'the "% at the smallest dot" wording is gone');
});

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
    const size = O.figureExtras({ mode: 'dots', dotMin: 5, dotMax: 80 }).size;
    assert.deepEqual([size.dotMin, size.dotMax], [5, 80]);
});

test('the Count Plot\'s colour values are the figure\'s scale: z of a heatmap, marker colours of a bar chart', () => {
    assert.deepEqual(Array.from(colourValues([{ type: 'heatmap', z: [[1, null], [3, 4]], colorbar: {} }])), [1, 3, 4]);
    assert.deepEqual(Array.from(colourValues([{ type: 'bar', marker: { color: [0.1, null, 0.9], showscale: true } }])), [0.1, 0.9]);
    assert.equal(colourValues([{ type: 'heatmap', z: [[1, 2]], showscale: false }]), null);
    assert.equal(colourValues([{ type: 'bar', marker: { color: '#999' } }]), null);
});

test('the title says what auto follows, in the style of the threshold box', () => {
    const { boxes } = mount();
    boxes.set({ limits: [null, 4, null], drawn: [0.125, 87.4] });
    assert.equal(boxes.fields[0].title, 'Follows the drawn values (smallest 0.125). Type a value to override it for this plot.');
    assert.equal(boxes.fields[1].title, 'Overrides the drawn values (set to 4). Clear to follow them.');
});

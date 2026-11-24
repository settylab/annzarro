/**
 * The Methods pop-over of a gene score's source (static/js/panels/score-options/methods-popover.js, decision 31) in a
 * recording DOM: every method is listed with its definition and its parameters, always; nothing is offered or withheld;
 * the button says which parameter is not at its default; Reset to defaults asks only when a score in use would change;
 * the down weighting shows only while Up/Down is on; a store event that changes nothing the pop-over shows touches no
 * node. The pop-over in a real page is annzarro/tests/browser/test_gene_score_options.py.
 *
 * Run:  node --test annzarro/tests/js/methods-popover.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { makeDom } = await import('../../../static/js/panels/gene-set-utilities/dom.js');
const { createMethodsPopover } = await import('../../../static/js/panels/score-options/methods-popover.js');
const O = await import('../../../static/js/utils/signature-options.js');
const G = await import('../../../static/js/utils/gene-signature.js');

// A document that counts every change to a node, so "no mutation" is a number.
function recordingDocument() {
    const log = [];
    const note = (what) => log.push(what);
    class Text { constructor(data) { this.nodeType = 3; this.data = data; this.parentNode = null; } get textContent() { return this.data; } }
    class Node {
        constructor(tag, doc) {
            this.nodeType = 1; this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.parentNode = null; this.childNodes = [];
            this.attrs = new Map(); this.listeners = new Map(); this._hidden = false; this._disabled = false; this._checked = false;
            this._value = ''; this._class = ''; this.dataset = new Proxy({}, { set: (t, k, v) => { if (t[k] !== v) note(`data-${k}`); t[k] = v; return true; } });
            this.style = new Proxy({}, { set: (t, k, v) => { note(`style-${k}`); t[k] = v; return true; } });
            this.classList = { toggle: (c, on) => { note('class'); return on; } };
        }
        get firstChild() { return this.childNodes[0] || null; }
        get className() { return this._class; }
        set className(v) { if (v !== this._class) note('class'); this._class = v; }
        get hidden() { return this._hidden; } set hidden(v) { if (v !== this._hidden) note('hidden'); this._hidden = v; }
        get disabled() { return this._disabled; } set disabled(v) { if (v !== this._disabled) note('disabled'); this._disabled = v; }
        get checked() { return this._checked; } set checked(v) { if (v !== this._checked) note('checked'); this._checked = v; }
        get value() { return this._value; } set value(v) { if (v !== this._value) note('value'); this._value = v; }
        get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
        set textContent(t) {
            if (t === this.textContent) return;
            note('text');
            for (const n of this.childNodes) n.parentNode = null;
            this.childNodes = t === '' ? [] : [Object.assign(new Text(String(t)), { parentNode: this })];
        }
        setAttribute(k, v) { if (this.attrs.get(k) !== String(v)) note(`attr-${k}`); this.attrs.set(k, String(v)); }
        getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
        addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
        appendChild(n) { note('append'); if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; }
        append(...ns) { for (const n of ns) this.appendChild(typeof n === 'string' ? new Text(n) : n); }
        removeChild(n) { note('remove'); this.childNodes.splice(this.childNodes.indexOf(n), 1); n.parentNode = null; return n; }
        contains(n) { for (let p = n; p; p = p.parentNode) if (p === this) return true; return false; }
        focus() { this.ownerDocument.activeElement = this; }
        select() {}
        walk(fn) { for (const c of this.childNodes) if (c.nodeType === 1) { fn(c); c.walk(fn); } }
        querySelector(sel) {
            const m = /^\[data-([a-z-]+)(?:="([^"]*)")?\]$/.exec(sel);
            let hit = null;
            if (m) {
                const key = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
                this.walk((n) => { if (!hit && key in n.dataset && (m[2] === undefined || n.dataset[key] === m[2])) hit = n; });
            }
            return hit;
        }
        queryAll(pred) { const out = []; this.walk(n => { if (pred(n)) out.push(n); }); return out; }
    }
    const doc = { activeElement: null, createElement: (t) => new Node(t, doc), createTextNode: (t) => new Text(t) };
    return { doc, log };
}

const recipe = (raw) => G.normalizeRecipe({ genes: ['A', 'B'], ...raw }).recipe;

function build({ raw = {}, directions = true, usage = [], layers = [] } = {}) {
    const { doc, log } = recordingDocument();
    const D = makeDom(doc);
    const state = { recipe: recipe(raw), usage, layers, applied: [] };
    const pop = createMethodsPopover({
        D, id: 'p1', directions, getRecipe: () => state.recipe,
        apply: (patch) => { state.applied.push(patch); state.recipe = { ...state.recipe, ...patch }; },
        getInUse: () => state.usage, getLayersInUse: () => state.layers
    });
    const el = pop.content;
    const click = (node) => { for (const fn of node.listeners.get('click') || []) fn(); };
    return { doc, log, state, pop, el, click };
}

test('every method is listed with its definition and parameters, and nothing is offered or withheld', () => {
    const { el } = build();
    assert.deepEqual(el.queryAll(n => n.dataset.method).map(n => n.dataset.method), [...O.METHODS]);
    assert.equal(el.queryAll(n => 'offerMethod' in n.dataset || 'layerOffer' in n.dataset).length, 0, 'no Offer boxes, no layer list');
    for (const info of O.METHOD_INFO) {
        const row = el.querySelector(`[data-method="${info.value}"]`);
        assert.ok(row.textContent.includes(info.label) && row.textContent.includes(info.definition), info.value);
    }
    for (const key of ['clip', 'bins', 'controls', 'seed', 'detect']) assert.ok(el.querySelector(`[data-param="${key}"]`), key);
    assert.equal(el.querySelector('[data-methods-intro]').textContent,
        'Plots and tables choose a method and a layer. These are the settings of each method, for every layer.');
});

test('the statement of a setting follows the setting: the clip line and the threshold line are redrawn with the value', () => {
    const { el, state, pop } = build();
    assert.equal(el.querySelector('[data-clip-help]').textContent, O.clipLine(10));
    assert.equal(el.querySelector('[data-detect-help]').textContent, O.thresholdLine(0));
    state.recipe = { ...state.recipe, clip: null, detect_above: 0.5 };
    pop.paint();
    assert.equal(el.querySelector('[data-clip-help]').textContent, O.clipLine(null));
    assert.equal(el.querySelector('[data-detect-help]').textContent, O.thresholdLine(0.5));
    assert.equal(el.querySelector('[data-param="clip"]').disabled, true, 'not clipped: the box is off');
    assert.equal(el.querySelector('[data-param="clip"]').value, '10', 'and keeps the last clip for when it is ticked again');
});

test('the button carries a dot and names each parameter not at its default; Reset per method only then', () => {
    const { pop, state, el } = build();
    assert.equal(pop.button.dataset.nondefault, 'false');
    assert.equal(pop.button.title, 'The settings of each score method');
    assert.equal(el.queryAll(n => 'resetMethod' in n.dataset && !n.hidden).length, 0);
    state.recipe = { ...state.recipe, clip: null, seed: 3 };
    pop.paint();
    assert.equal(pop.button.dataset.nondefault, 'true');
    assert.equal(pop.button.title, 'z-score mean: not clipped; control-adjusted: seed 3');
    assert.equal(pop.button.getAttribute('aria-label'), 'Methods: z-score mean: not clipped; control-adjusted: seed 3');
    assert.deepEqual(el.queryAll(n => 'resetMethod' in n.dataset && !n.hidden).map(n => n.dataset.resetMethod), ['zscore_mean', 'control_adjusted']);
});

test('a number is applied when valid and the last valid value comes back otherwise', () => {
    const { el, state } = build();
    const box = el.querySelector('[data-param="bins"]');
    const fire = (type) => { for (const fn of box.listeners.get(type) || []) fn(); };
    box.value = '1';
    fire('input');
    fire('change');
    assert.equal(box.value, '25', 'out of range: the last valid value');
    assert.deepEqual(state.applied, []);
    box.value = '40';
    fire('change');
    assert.deepEqual(state.applied, [{ bins: 40 }]);
});

test('Reset to defaults resets parameters only, and asks first only when a score in use would change', () => {
    // z-score mean is read by a plot and its clip is not the default: a reset changes that plot, so it asks
    let b = build({ raw: { clip: 3, seed: 2 }, usage: [{ value: 'zscore_mean', plots: 1, tables: 0 }] });
    b.click(b.el.querySelector('[data-reset-all]'));
    assert.deepEqual(b.state.applied, [], 'asked, nothing applied');
    assert.equal(b.el.querySelector('[data-reset-note]').hidden, false);
    assert.match(b.el.querySelector('[data-reset-note]').textContent, /^1 plot or table shows a score this changes\./);
    b.click(b.el.querySelector('[data-reset-anyway]'));
    assert.deepEqual(b.state.applied, [{ clip: 10, seed: null, bins: 25, controls: 50, detect_above: 0, down_weight: 'gene' }]);
    assert.equal('offered' in b.state.applied[0] || 'layers' in b.state.applied[0] || 'input' in b.state.applied[0], false, 'parameters only');
    // only a plain mean is read: the clip changes no number shown, so it resets at once
    b = build({ raw: { clip: 3 }, usage: [{ value: 'mean', plots: 2, tables: 0 }] });
    b.click(b.el.querySelector('[data-reset-all]'));
    assert.equal(b.state.applied.length, 1);
    assert.equal(b.el.querySelector('[data-reset-note]').hidden, true);
    assert.equal(b.el.querySelector('[data-reset-all]').disabled, true, 'at the defaults there is nothing to reset');
});

test('a gene table has no down genes: no weighting, and a reset leaves the weighting alone', () => {
    const b = build({ directions: false, raw: { clip: 3 } });
    assert.equal(b.el.queryAll(n => 'weighting' in n.dataset).length, 0);
    b.click(b.el.querySelector('[data-reset-all]'));
    assert.equal('down_weight' in b.state.applied[0], false);
});

test('the down weighting is under the two means only while Up/Down is on, and states the formula', () => {
    const { el, state, pop } = build();
    const shown = () => el.queryAll(n => 'weighting' in n.dataset && !n.hidden).map(n => n.dataset.weighting);
    assert.deepEqual(shown(), [], 'off: nothing about direction');
    assert.equal(el.querySelector('[data-direction-formula]').hidden, true);
    state.recipe = recipe({ genes: ['A'], down: ['B'] });
    pop.paint();
    assert.deepEqual(shown(), ['zscore_mean', 'mean']);
    assert.equal(el.querySelector('[data-down-weight-why]').hidden, false);
    assert.equal(el.querySelector('[data-direction-formula]').textContent, G.directionFormula(state.recipe));
    assert.equal(el.querySelector('[data-method="mean"]').querySelector('[data-signed]').textContent, G.downDefinition(state.recipe, 'mean'));
    const side = el.querySelector('[data-weighting="mean"]').queryAll(n => n.dataset.downWeight === 'side')[0];
    side.checked = true;
    for (const fn of side.listeners.get('change')) fn();
    assert.deepEqual(state.applied.at(-1), { down_weight: 'side' });
    assert.equal(pop.button.title, 'down genes: each side weighs equally');
});

test('Used by names the methods and layers plots and tables read', () => {
    const { el, state, pop } = build();
    assert.equal(el.querySelector('[data-used-by]').textContent, 'No plot or table shows this score yet.');
    state.usage = [{ value: 'zscore_mean', plots: 2, tables: 0 }, { value: 'mean', plots: 0, tables: 1 }];
    state.layers = [{ value: null, plots: 2, tables: 0 }, { value: 'counts', plots: 0, tables: 1 }];
    pop.paintUsage();
    assert.equal(el.querySelector('[data-used-by]').textContent, 'Used by 2 plots, 1 table: z-score mean, mean · X, counts');
    assert.equal(el.querySelector('[data-in-use="zscore_mean"]').textContent, '2 plots');
});

test('50 store events that change nothing the pop-over shows touch no node', () => {
    const { log, pop } = build();
    pop.paintUsage();
    const before = log.length;
    for (let i = 0; i < 50; i++) pop.paintUsage();
    assert.equal(log.length, before);
});

test('events that DO change who uses what repaint once per change, not once per event', () => {
    const { log, state, pop } = build();
    pop.paintUsage();
    let repaints = 0;
    let before = log.length;
    for (let i = 0; i < 50; i++) {
        if (i % 10 === 0) state.usage = [{ value: 'mean', plots: 1 + i / 10, tables: 0 }];
        pop.paintUsage();
        if (log.length !== before) { repaints++; before = log.length; }
    }
    assert.equal(repaints, 5, 'five changes of usage, five repaints');
});

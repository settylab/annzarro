/**
 * The shared offered section (static/js/panels/score-options/offered-section.js) in a recording DOM: over 50 store
 * events that change nothing the rows show, no node is touched; when who-uses-what does change, the rows are drawn
 * again once per change and not per event. The signature's wrapper (scoring-section.js) keeps its element ids, classes
 * and sentences. The panel in a real page is covered by annzarro/tests/browser/test_gene_score_options.py.
 *
 * Run:  node --test annzarro/tests/js/offered-section.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { makeDom } = await import('../../../static/js/panels/gene-set-utilities/dom.js');
const { createOfferedSection } = await import('../../../static/js/panels/score-options/offered-section.js');
const { createScoringSection, SCORING_HELP } = await import('../../../static/js/panels/score-options/scoring-section.js');
const O = await import('../../../static/js/utils/signature-options.js');
const M = await import('../../../static/js/utils/options-model.js');
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

function build() {
    const { doc, log } = recordingDocument();
    const D = makeDom(doc);
    const state = { recipe: recipe({}), usage: [] };
    const section = createScoringSection({
        D, id: 'p1', getRecipe: () => state.recipe, apply: (patch) => { state.recipe = { ...state.recipe, ...patch }; },
        getInputs: async () => ['X', 'counts'], getKind: async () => null,
        getInUse: () => state.usage, getLayersInUse: () => []
    });
    return { doc, log, state, section, D };
}

test('50 store events that change nothing the rows show touch no node, open or closed', () => {
    for (const open of [true, false]) {
        const { log, section } = build();
        section.paint();
        if (open) section.reveal();
        assert.ok(log.length > 0, 'drawing the section does mutate');
        const before = log.length;
        for (let i = 0; i < 50; i++) section.paintUsage();
        assert.equal(log.length, before, `open: ${open}`);
    }
});

test('events that DO change who uses what repaint once per change, not once per event', () => {
    const { log, state, section } = build();
    section.reveal();
    let repaints = 0;
    let before = log.length;
    for (let i = 0; i < 50; i++) {
        if (i % 10 === 0) state.usage = [{ value: 'mean', plots: 1 + i / 10, tables: 0 }];
        section.paintUsage();
        if (log.length !== before) { repaints++; before = log.length; }
    }
    assert.equal(repaints, 5, 'five changes of usage, five repaints');
});

test('the signature\'s wrapper keeps the ids, classes and sentences of the section it replaced', () => {
    const { section } = build();
    section.reveal();
    const el = section.element;
    assert.equal(el.getAttribute('aria-label'), 'Scores offered');
    assert.equal(el.className, 'gsig-scoring');
    assert.ok(el.querySelector('[data-aggregations-help]'));
    for (const method of O.offeredMethods(recipe({}))) assert.ok(el.querySelector(`[data-method="${method}"]`), method);
    assert.equal(el.querySelector('[data-clip-help]').textContent, O.clipLine(10));
    assert.equal(SCORING_HELP.where, el.querySelector('[data-aggregations-help]').textContent);
    assert.equal(section.state().lastClip, 10);
});

test('the statement of a setting follows the setting: the clip line and the threshold line are redrawn with the value', () => {
    const { state, section } = build();
    state.recipe = { ...state.recipe, offered: ['zscore_mean', 'detected'] };
    section.reveal();
    const el = section.element;
    assert.equal(el.querySelector('[data-clip-help]').textContent, O.clipLine(10));
    assert.equal(el.querySelector('[data-detect-help]').textContent, O.thresholdLine(0));
    state.recipe = { ...state.recipe, clip: null, detect_above: 0.5 };
    section.paint();
    assert.equal(el.querySelector('[data-clip-help]').textContent, O.clipLine(null));
    assert.equal(el.querySelector('[data-detect-help]').textContent, O.thresholdLine(0.5));
});

test('the shared section runs over a method table that is not the signature\'s', () => {
    const { doc } = recordingDocument();
    const D = makeDom(doc);
    const methods = [
        { value: 'pct', label: '% expressing', menu: '% expressing', needs: ['threshold'], unit: '0 to 100', definition: 'Share of cells above the threshold.' },
        { value: 'mean_expr', label: 'Mean of expressing cells', menu: 'mean of expressing cells', needs: ['threshold'], unit: 'layer units', definition: 'Average over the cells above the threshold.' }
    ];
    const model = M.createOptionsModel({
        methods, defaultMethod: 'pct', defaultOffered: ['pct'], defaultLayer: 'X',
        grade: (m, layer, kind) => (kind === 'signed' ? { grade: 'cannot', code: 'negative', reason: `Not available on '${layer}': negative values.` }
            : { grade: 'ok', code: '', reason: '' })
    });
    const state = { recipe: { input: 'X', method: 'pct', offered: ['pct'], layers: ['X'] } };
    const applied = [];
    const section = createOfferedSection({
        D, id: 'g1', model, title: 'Statistics offered', cls: 'cg-offered',
        text: { where: 'Plots pick from these.', layers: 'Choose among layers.', lastLayer: 'One layer stays.', lastMethod: 'One statistic stays.' },
        getRecipe: () => state.recipe, apply: (patch) => { applied.push(patch); state.recipe = { ...state.recipe, ...patch }; },
        getInputs: async () => ['X'], getKind: async () => null
    });
    section.reveal();
    const el = section.element;
    assert.equal(el.className, 'cg-offered');
    assert.equal(el.getAttribute('aria-label'), 'Statistics offered');
    assert.deepEqual(el.queryAll(n => n.dataset.method).map(n => n.dataset.method), ['pct', 'mean_expr']);
    assert.equal(el.querySelector('[data-offer-method="pct"]').disabled, true, 'the last statistic cannot be switched off');
    el.querySelector('[data-offer-method="mean_expr"]').checked = true;
    for (const fn of el.querySelector('[data-offer-method="mean_expr"]').listeners.get('change')) fn();
    assert.deepEqual(applied.at(-1).offered, ['pct', 'mean_expr']);
    assert.match(el.childNodes[0].textContent, /% expressing, mean of expressing cells · X/);
});

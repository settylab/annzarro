/**
 * `populateColumnSelector` must survive an axis returning to a focus-keyed
 * source (obsp / varp / layer).
 *
 * Switching an axis away from obsp stores the old column under
 * `settings.history.obsp.columns[key]` (listeners.js). Switching back then
 * evaluated `columns.includes(...)` in the obsp branch, but `columns` is only
 * declared (block-scoped) inside the obsm/varm branches. ES modules are strict,
 * so that was a ReferenceError that aborted the selector rebuild.
 *
 * Run:  node --test annzarro/tests/js/panel-axis-selector.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.document = {
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {} }),
    getElementById: () => null, addEventListener() {}, removeEventListener() {}
};
globalThis.Plotly = new Proxy({}, { get: () => () => Promise.resolve() });

/** Just enough jQuery for createSelect / setSelectValue on a fake <select>. */
function fakeSelect() {
    return { options: [], value: '', disabled: false };
}
globalThis.jQuery = function jQuery(arg) {
    if (typeof arg === 'string') {
        // '<option></option>'
        const opt = { value: '', text: '' };
        const w = {
            val(v) { opt.value = v; return w; },
            text(t) { opt.text = t; return w; },
            prop() { return w; },
            _opt: opt
        };
        return w;
    }
    const sel = arg._sel || arg;
    const w = {
        _sel: sel,
        prop(k, v) { if (k === 'disabled') sel.disabled = v; return w; },
        empty() { sel.options = []; return w; },
        append(o) { sel.options.push(o._opt); return w; },
        val(v) {
            if (v === undefined) return sel.options.length ? (sel.value || sel.options[0].value) : null;
            sel.value = v; return w;
        },
        find() {
            return { map(fn) { return { get: () => sel.options.map(o => fn.call({ _opt: o, _sel: { options: [o], value: o.value } })) }; } };
        },
        hasClass() { return false; },
        trigger() { return w; }
    };
    return w;
};

const { DataManager } = await import('../../../static/js/data-manager.js');
const { populateColumnSelector } = await import('../../../static/js/panels/plot-utilities/panel-ui-update.js');

DataManager.getFocusedCell = () => 'cell_7';
DataManager.getFocusedGene = () => 'GENE_A';

for (const [type, plotType] of [['obsp', 'cells'], ['varp', 'genes'], ['layer', 'cells'], ['layer', 'genes']]) {
    test(`returning to ${type} (${plotType}) with a remembered column does not throw`, () => {
        const settings = {
            type, key: 'k', column: '', locked: false,
            // What listeners.js writes when the axis is switched AWAY from `type`.
            history: { [type]: { key: 'k', columns: { k: 'remembered' } } }
        };
        assert.doesNotThrow(() =>
            populateColumnSelector(settings, fakeSelect(), 'x', plotType, {}));
        // Not locked, so the axis follows the current focus.
        const expected = (type === 'obsp' || (type === 'layer' && plotType === 'genes'))
            ? 'cell_7' : 'GENE_A';
        assert.equal(settings.column, expected);
    });
}

test('a locked history entry is restored for obsp', () => {
    const settings = {
        type: 'obsp', key: 'k', column: '', locked: false,
        history: { obsp: { key: 'k', locked: true, columns: { k: 'cell_3' } } }
    };
    populateColumnSelector(settings, fakeSelect(), 'x', 'cells', {});
    assert.equal(settings.column, 'cell_3');
});

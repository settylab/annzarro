/**
 * Stepping through the parts of a subset: the badge's "Part 3 of 957", the
 * ‹ › buttons and the typed part number (static/js/utils/subset.js and the
 * stepper in subset-dialog.js), and the `part` a deep link records.
 *
 * Run:  node --test annzarro/tests/js/subset-parts.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const els = {};
const mkEl = (id) => (els[id] = els[id] || {
    id, hidden: false, disabled: false, value: '', textContent: '', title: '', max: '',
    _on: {}, classList: { toggle() {}, add() {}, remove() {} },
    // the badge is written as spans (subset-dialog.js update)
    appendChild(c) { this.textContent += c.textContent; return c; },
    setAttribute(k, v) { this[k] = v; },
    addEventListener(type, fn) { (this._on[type] = this._on[type] || []).push(fn); },
    fire(type, ev = {}) { (this._on[type] || []).forEach(fn => fn(ev)); }
});
globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.document = { getElementById: mkEl, createElement: () => mkEl(Math.random()), addEventListener() {},
                        dispatchEvent() {}, body: { appendChild() {} }, querySelector: () => null };

globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '{}' });

const { describeParts, partSpec, outsideDetail, canonicalSubset, describeSubset, normalizeViewSubset } =
    await import('../../../static/js/utils/subset.js');
const { normalizeView } = await import('../../../static/js/utils/deeplink.js');
const { DataManager } = await import('../../../static/js/data-manager.js');
const { SubsetControl } = await import('../../../static/js/subset-dialog.js');

const info = (part, extra = {}) => ({ subset: canonicalSubset({ n: 100000, seed: 0, part, ...extra }), part,
    parts: 957, n: part === 956 ? 62334 : 100000, n_total: 95624334, n_eligible: 95624334 });

test('the badge says which part, counted from 1', () => {
    const p = describeParts(info(2));
    assert.equal(p.label, 'Part 3 of 957');
    assert.equal(p.display, 3);
    assert.ok(p.canPrev && p.canNext);
    assert.equal(describeParts(info(0)).canPrev, false);
    assert.equal(describeParts(info(956)).canNext, false);
    assert.equal(describeParts({ ...info(0), parts: 1 }), null, 'one part: no stepper');
    assert.equal(describeParts(null), null);
    assert.match(describeSubset(info(2)).title, /Part 3 of 957/);
    // the status strip's words, and the header badge's: "not in part 3 of 957"
    assert.equal(outsideDetail(info(2)), 'not in part 3 of 957');
    assert.equal(outsideDetail(null), 'not in the cell subset');
    assert.match(describeParts(info(5, { balance: 'drug' })).title, /largest groups only/);
});

test('stepping keeps the spec and changes only the part; part 0 is written without it', () => {
    assert.deepEqual(partSpec(info(2), 3), { n: 100000, seed: 0, part: 3 });
    assert.deepEqual(partSpec(info(1), 0), { n: 100000, seed: 0 });
    assert.equal(partSpec(info(0), -1), null, 'no part before the first');
    assert.equal(partSpec(info(956), 957), null, 'no part after the last');
    assert.deepEqual(partSpec(info(3), 99999, true), { n: 100000, seed: 0, part: 956 }, 'typed: clamped');
    assert.equal(partSpec(info(3), 3), null, 'the same part is no step');
    const balanced = info(4, { balance: 'drug', where: [{ col: 'moa', op: 'in', values: ['x'] }] });
    assert.deepEqual(partSpec(balanced, 5), canonicalSubset({ ...balanced.subset, part: 5 }));
});

test('deep links record the part; an old link without it is part 0', () => {
    assert.deepEqual(normalizeViewSubset({ n: 10, seed: 1, part: 4 }), { n: 10, seed: 1, part: 4 });
    assert.deepEqual(normalizeViewSubset({ n: 10, seed: 1 }), { n: 10, seed: 1 });
    assert.equal(normalizeViewSubset({ n: 10, seed: 1, part: -2 }), undefined, 'malformed: dropped');
    assert.deepEqual(normalizeView({ subset: { n: 10, seed: 1, part: 4 } }).subset, { n: 10, seed: 1, part: 4 });
});

test('the stepper in the stats bar shows the part and steps through onApply', async () => {
    let current = info(2);
    DataManager.getSubset = () => current;
    DataManager.getSubsetReply = () => current;
    DataManager.getCurrentDataset = () => '/d.zarr';
    const applied = [];
    SubsetControl.init({ onApply: (spec, opts) => { applied.push([spec, opts]); } });
    SubsetControl.update();
    assert.equal(els['subset-parts'].hidden, false);
    assert.equal(els['subset-part-input'].value, '3');
    assert.equal(els['subset-part-count'].textContent, '957');
    assert.equal(els['subset-part-prev'].disabled, false);

    els['subset-part-next'].fire('click');
    els['subset-part-prev'].fire('click');
    els['subset-part-input'].value = '900';
    els['subset-part-input'].fire('keydown', { key: 'Enter' });
    assert.deepEqual(applied.map(([s]) => s.part ?? 0), [3, 1, 899]);
    assert.ok(applied.every(([, o]) => o.step));

    current = info(956);
    SubsetControl.update();
    assert.equal(els['subset-part-next'].disabled, true);
    els['subset-part-next'].fire('click');
    assert.equal(applied.length, 3, 'nothing after the last part');

    current = { ...info(0), parts: 1 };
    SubsetControl.update();
    assert.equal(els['subset-parts'].hidden, true);
});

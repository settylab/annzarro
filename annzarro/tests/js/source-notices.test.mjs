/**
 * The wording of a source's notices (static/js/utils/source-notices.js): the same words for every provider, taken
 * from the provider's vocabulary; the one painter that plots and tables share; and the guarantee that moving the
 * gene-signature words there changed none of them.
 *
 * Run:  node --test annzarro/tests/js/source-notices.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { snapshotOf, STATES } from './notice-matrix.mjs';

const SN = await import('../../../static/js/utils/source-notices.js');
const N = await import('../../../static/js/utils/score-notices.js');
const C = await import('../../../static/js/utils/score-column.js');

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const SNAPSHOT = JSON.parse(readFileSync(new URL('./score-notice-sentences.json', import.meta.url), 'utf8'));

const RANKED = STATES.filter(state => !['ready', 'idle', 'someday'].includes(state));

// the vocabulary a cell grouping will bring (UX 5): nothing here is gene-signature wording
const GROUPING = { thing: 'grouping', source: 'grouping', result: 'grouping', Computing: 'Computing', tags: { computing: 'Grouping…' } };

test('every existing sentence of a score is byte-identical to the base', () => {
    const now = snapshotOf(N.describeScore, (s, c) => C.describeColumn(s, c), sha);
    assert.deepEqual(now.cases, SNAPSHOT.cases, 'the same cases were run');
    for (const state of Object.keys(SNAPSHOT.digests)) {
        assert.equal(now.digests[state], SNAPSHOT.digests[state], `state '${state}' says something different`);
    }
    for (const state of Object.keys(SNAPSHOT.columnDigests)) {
        assert.equal(now.columnDigests[state], SNAPSHOT.columnDigests[state], `table column, state '${state}'`);
    }
    assert.deepEqual(now.sentences, SNAPSHOT.sentences);
    assert.ok(SNAPSHOT.sentences.length > 150, 'the snapshot holds the sentences, not an empty list');
});

test('a fake vocabulary gives its own nouns: "Grouping \'G1\' was deleted."', () => {
    const note = SN.describeSource({ state: 'deleted', title: 'G1' }, {}, GROUPING);
    assert.equal(note.headline, "Grouping 'G1' was deleted.");
    assert.equal(note.tag.text, 'Grouping deleted');
    assert.equal(SN.describeSource({ state: 'deleted', title: '' }, {}, GROUPING).headline, 'The grouping was deleted.');
    assert.equal(SN.describeSource({ state: 'failed', title: 'G1', message: 'No memory.' }, {}, GROUPING).headline,
        "'G1' could not be computed: No memory.");
    assert.equal(SN.describeSource({ state: 'refused', title: 'G1' }, {}, GROUPING).tag.text, 'Grouping refused');
    assert.equal(SN.describeSource({ state: 'awaiting', title: 'G1', estimate: { seconds: 40 } }, {}, GROUPING).tag.text, 'Grouping not computed');
    assert.equal(SN.describeSource({ state: 'computing', title: 'G1' }, {}, GROUPING).tag.text, 'Grouping…');
    assert.equal(SN.describeSource({ state: 'queued', title: 'G1' }, { role: 'colour' }, GROUPING).headline,
        "'G1' is waiting for another grouping to finish. This plot has no color.");
    assert.equal(SN.describeSource({ state: 'cancelled', title: 'G1' }, { role: 'x' }, GROUPING).headline, "'G1' was cancelled.");
    for (const state of ['deleted', 'failed', 'refused', 'awaiting', 'cancelled', 'queued', 'computing', 'updating']) {
        const note = SN.describeSource({ state, title: 'G1' }, {}, GROUPING);
        assert.doesNotMatch(`${note.headline} ${note.text} ${note.tag.text}`, /score|signature|table/i, `${state} names no gene-score word`);
    }
});

test('a cycle is named by the vocabulary, not "Circular tables"', () => {
    const snap = { state: 'cycle', title: 'G1', cycle: ['G1', 'Genes A', 'G1'] };
    const note = SN.describeSource(snap, { role: 'x' }, GROUPING);
    assert.equal(note.tag.text, 'Circular dependency');
    assert.equal(note.headline, "'G1' and 'Genes A' depend on each other.");
    assert.equal(SN.describeSource(snap, { role: 'x' }, { ...GROUPING, tags: { cycle: 'Circular groupings' } }).tag.text, 'Circular groupings');
    const mixed = { ...snap, cycleKinds: ['grouping', 'table', 'grouping'] };
    assert.equal(SN.describeSource(mixed, { role: 'x' }, GROUPING).tag.text, 'Circular references', 'a ring through two kinds of panel');
    assert.equal(N.describeScore({ ...mixed, kind: 'table' }, { role: 'x' }).tag.text, 'Circular references', 'also for a table among groupings');
    assert.equal(N.describeScore({ ...snap, kind: 'table', cycleKinds: ['table', 'table', 'table'] }, { role: 'x' }).tag.text, 'Circular tables');
    assert.equal(N.describeScore({ ...snap, kind: 'table' }, { role: 'x' }).tag.text, 'Circular tables', 'the table-only wording is as before');
});

test('a vocabulary may say a state of its own, and an unknown state says nothing', () => {
    const own = { ...GROUPING, states: { nolevels: (snap, f) => f.out('nolevels', 'warning', 'No levels', `${f.t} has no levels.`, '', [f.choose]) } };
    assert.equal(SN.describeSource({ state: 'nolevels', title: 'G1' }, {}, own).headline, "'G1' has no levels.");
    assert.equal(SN.describeSource({ state: 'nolevels', title: 'G1' }, {}, GROUPING), null, 'a state the vocabulary does not know');
    assert.equal(SN.describeSource({ state: 'ready', title: 'G1' }, {}, GROUPING), null);
    assert.equal(SN.describeSource(null, {}, GROUPING), null);
});

test('of several notices the worst is stated; a state nobody ranked is never the worst', () => {
    const t = (state) => N.describeScore({ state, title: 'T' }, {});
    assert.equal(SN.worstNotice([t('computing'), t('failed'), null]).state, 'failed');
    assert.equal(SN.worstNotice([null, null]), null);
    // every ranked state outranks an unknown one, wherever it stands in the list (a defect of the base ranked it first)
    for (const state of RANKED) {
        const known = { state, severity: 'notice' };
        assert.equal(SN.worstNotice([{ state: 'someday' }, known]), known, `'${state}' beats an unknown state`);
        assert.equal(SN.worstNotice([known, { state: 'someday' }]), known);
    }
    assert.equal(SN.worstNotice([{ state: 'someday' }]).state, 'someday', 'alone, it is still said');
    assert.equal(N.worstNotice, SN.worstNotice, 'one function');
});

// --------------------------------------------------------------- the one painter

class El {
    constructor(tag) {
        this.tagName = tag; this.children = []; this.parentNode = null; this.dataset = {}; this.style = {};
        this.attrs = {}; this._cls = '';
        this.classList = { contains: (c) => this._cls.split(/\s+/).includes(c) };
    }
    get className() { return this._cls; }
    set className(v) { this._cls = v; }
    appendChild(n) { this.children.push(n); n.parentNode = this; return n; }
    remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
    setAttribute(k, v) { this.attrs[k] = v; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
}

test('plots and tables paint a notice through one painter, which mirrors the state into data-state', () => {
    globalThis.document = { createElement: (tag) => new El(tag) };
    try {
        const host = new El('div');
        const note = N.describeScore({ state: 'failed', title: 'T' }, {});
        SN.paintNotice(host, note);
        const overlay = host.children.find(c => c.classList.contains('score-notice'));
        assert.ok(overlay, 'the overlay is in the host');
        assert.equal(overlay.dataset.state, 'failed');
        assert.equal(host.dataset.sourceState, 'failed', 'the host says it too');
        SN.paintNotice(host, N.describeScore({ state: 'queued', title: 'T' }, {}));
        assert.equal(host.children.filter(c => c.classList.contains('score-notice')).length, 1, 'one overlay, replaced');
        assert.equal(host.dataset.sourceState, 'queued');
        SN.paintNotice(host, note, { overlay: false });
        assert.equal(host.children.some(c => c.classList.contains('score-notice')), false, 'an axis placeholder states it instead');
        assert.equal(host.dataset.sourceState, 'failed', 'but the state is still mirrored');
        SN.paintNotice(host, null);
        assert.equal(host.dataset.sourceState, undefined);
        assert.equal(host.children.length, 0);
    } finally {
        delete globalThis.document;
    }
});

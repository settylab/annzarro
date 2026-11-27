/**
 * The inputs of the notice-sentence snapshot (score-notice-sentences.json): every state of a score, with the
 * variations that change a word, through every role of a consumer. The `lapsed` rows are kept as inputs: since
 * decision 31 a lapsed snapshot says nothing of its own (no "Not offered"), and they pin that. The snapshot was taken from the base's
 * `describeScore` before the wording moved to utils/source-notices.js, so the test fails if one byte of any sentence,
 * tag, action or flag changes.
 */
export const STATES = ['nolayer', 'nodown', 'notcells', 'unset', 'deleted', 'off', 'cycle', 'failed', 'refused', 'ask', 'awaiting',
    'cancelled', 'noscore', 'nogenes', 'building', 'estimating', 'queued', 'computing', 'updating', 'ready', 'idle', 'someday'];

export const ROLES = ['colour', 'x', 'y', 'z', 'hover', 'column', 'inspect'];

/** Snapshot variants that change a sentence, as extras merged over a bare snapshot. */
export const EXTRAS = [
    {},
    { kind: 'table' },
    { estimate: { seconds: 30 } },
    { estimate: { seconds: 125 } },
    { estimate: { seconds: 9000 }, message: 'Use fewer genes.' },
    { estimate: {}, kind: 'table' },
    { message: 'The server stopped responding.' },
    { message: 'Gone.', kind: 'table' },
    { progress: { done: 31, total: 50 } },
    { progress: { done: 0, total: 0 } },
    { progress: { done: 1200, total: 25000 }, kind: 'table' },
    { reason: 'no_gene_present' },
    { reason: 'no_gene_present', kind: 'table' },
    { reason: 'other', message: 'Nothing to say.' },
    { layer: 'counts' },
    { method: 'mean' },
    { method: 'zscore_mean', kind: 'table' },
    { cycle: ['A', 'B', 'A'] },
    { cycle: ['A', 'B', 'C', 'A'], kind: 'table' },
    { gate: { reason: 'opening' }, kind: 'table' },
    { gate: { reason: 'building' }, kind: 'table' },
    { gate: { frozen: true }, kind: 'table' },
    { held: { edits: 1 } },
    { held: { edits: 3, seconds: 40 } },
    { held: { edits: 2, seconds: 125 }, kind: 'table' },
    { lapsed: true, source: 'Sig', sub: 'mean', layer: 'counts', ownInput: 'X' },
    { lapsed: true, sub: 'zscore_mean', layer: 'X', ownInput: 'X' },
    { lapsed: true, kind: 'table', source: 'Tab' },
    { lapsed: true }
];

/** [snapshot, ctx] pairs, in a fixed order. */
export function cases() {
    const out = [];
    for (const state of STATES) {
        for (const title of ['', 'T cell score']) {
            for (const extra of EXTRAS) {
                for (const role of ROLES) {
                    for (const sharers of [1, 3]) {
                        out.push([{ state, title, ...extra }, { role, sharers }]);
                    }
                }
            }
        }
    }
    out.push([null, {}], [undefined, {}]);
    return out;
}

/**
 * What the snapshot stores: one digest per state over every case of that state (a changed byte names the state), the
 * same for the table-column wording, and the sorted list of distinct sentences so a reviewer can read them.
 * @param {(snap: Object, ctx: Object) => (Object|null)} describe
 * @param {(snap: Object, ctx: Object) => (Object|null)} describeColumn
 * @param {(text: string) => string} hash
 */
export function snapshotOf(describe, describeColumn, hash) {
    const by = {};
    const columns = {};
    const said = new Set();
    for (const [snap, ctx] of cases()) {
        const key = snap ? snap.state : 'none';
        const note = describe(snap, ctx);
        (by[key] ||= []).push(JSON.stringify(note));
        if (note) {
            said.add([note.tag.text, note.severity, note.headline, note.text, ...note.actions.map(a => a.join('='))].join(' | '));
        }
        if (snap) (columns[key] ||= []).push(JSON.stringify(describeColumn(snap, { sharers: ctx.sharers })));
    }
    const digest = (lists) => Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, hash(v.join('\n'))]));
    return { cases: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.length])), digests: digest(by), columnDigests: digest(columns),
        sentences: [...said].sort() };
}

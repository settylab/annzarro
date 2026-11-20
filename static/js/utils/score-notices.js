import { DEFAULT_METHOD, methodShort as methodLabel } from './signature-options.js';
import { describeSource } from './source-notices.js';

/**
 * What a dependant of a gene-signature score says in each state (design 7.3, UX review 3.2): the gene-score
 * vocabulary for utils/source-notices.js, which holds the wording every source shares. A source is a handpicked
 * signature or a gene table (its genes are the rows passing its filter): the same states, their own nouns.
 */

export { durationText, worstNotice, PRIORITY } from './source-notices.js';

const TAGS = { cycle: 'Circular tables' };

const VOCABULARY = {
    signature: { thing: 'signature', source: 'source', result: 'score', Computing: 'Computing', tags: TAGS, off: 'Gene signatures are turned off on this server.' },
    table: { thing: 'table', source: 'source', result: 'score', Computing: 'Computing', tags: TAGS, off: 'Gene tables are turned off on this server.' }
};

/** The states only a gene score has: layers, down genes, a table's filter. Each returns undefined to leave the state generic. */
const OWN_STATES = {
    building(snap, f) {
        const opening = snap.gate && snap.gate.reason === 'opening';
        return f.out('building', 'notice', opening ? 'Opening table' : 'Building filter',
            opening ? `Waiting for ${f.T} to open, to score its genes.${f.none}`
                : `Building ${f.T} to find its genes, then scoring them.${f.none}`, '',
            snap.gate && snap.gate.frozen ? [f.open] : [['score-cancel', f.cancelLabel], f.open]);
    },
    ask(snap, f) {
        return f.out('ask', 'notice', 'Filter not built',
            `Building ${f.T} to find its genes will pause the page for a few seconds.${f.none}`, '',
            [['score-compute', 'Build filter'], f.open, f.choose]);
    },
    noscore(snap, f) {
        if (snap.reason !== 'no_gene_present') return undefined;
        return f.out('noscore', 'warning', 'No score', `None of the genes of ${f.T} are in this dataset.`, '', [f.open, f.choose]);
    },
    nolayer(snap, f) {
        return f.out('nolayer', 'warning', 'Layer not found', `Layer '${snap.layer || 'X'}' is not in this dataset, so ${f.t} has no score.`, '',
            [f.open, f.choose]);
    },
    nodown(snap, f) {
        return f.out('nodown', 'warning', 'Cannot score down genes',
            `${f.t} has down genes, which ${methodLabel(snap.method)} cannot score.${f.none}`, '', [f.open, f.choose]);
    },
    notcells(snap, f) {
        return f.out('notcells', 'notice', 'Not a cell source', 'Gene scores are a cell source; not available in a Gene Plot.', '', []);
    },
    unset(snap, f) {
        return f.out('unset', 'notice', 'No signature', 'No signature is chosen.', '', [f.choose]);
    },
    nogenes(snap, f) {
        return f.out('nogenes', 'notice', 'No genes',
            snap.kind === 'table' ? `No row of ${f.T} passes its filter, so there are no genes to score.` : `${f.t} has no genes yet.`, '', [f.open]);
    },
    ready(snap, f) {
        // the source stopped offering it: named by its own title (a table column's name already holds the method)
        if (!snap.lapsed) return undefined;
        return noLongerOffered(snap, snap.source ? `'${snap.source}'` : f.t, f.out);
    }
};

/**
 * The notice of one dependant's state, or null when nothing is to be said (a score that is ready and has no edits
 * waiting).
 * @param {Object} snap - from a handle's read()
 * @param {{role?: string, sharers?: number}} [ctx] - `role`: 'colour', 'x', 'y', 'z' or 'hover'
 * @returns {null|Object} see describeSource
 */
export function describeScore(snap, ctx = {}) {
    if (!snap) return null;
    const base = VOCABULARY[snap.kind === 'table' ? 'table' : 'signature'];
    return describeSource(snap, ctx, { ...base, states: OWN_STATES });
}

/** An option the signature stopped offering: kept, still drawing, said so, with the way back. */
function noLongerOffered(snap, t, out) {
    const m = methodLabel(snap.sub || DEFAULT_METHOD);
    const what = snap.layer && snap.layer !== snap.ownInput ? `${m} · ${snap.layer}` : m;
    const note = out('notoffered', 'warning', 'Not offered', `${t} no longer offers ${what}.`, '',
        [['score-offer', 'Offer it again'], ['score-choose', 'Choose another']]);
    note.blocksAxis = false;
    return note;
}

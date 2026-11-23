/**
 * The Cell-Gene Plot's states (0.8.0 step X3b; UX 3.5; CXG-17, CXG-19, CXG-27, SHR-27, SHR-32, SHR-41, SHR-47, SHR-48).
 *
 * What the plot area says in each state, decided from the snapshot of its cell axis (utils/group-sources.js) and what
 * the plot alone knows: how many genes it reads, on which layer, how many rows and groups its matrix has. Pure (no page
 * state; the checklist is the one piece of DOM, built with the panel's DOM builder), so Node tests hold every sentence.
 *
 * - THE MATRIX LIMIT (`gateMatrix`, CXG-17): decided before any request. With rows that cannot exceed the limit at the
 *   most groups a grouping holds, the groups and the genes go in one request; otherwise the genes are asked for only
 *   once the groups are known, and never above the limit.
 * - THE NOTICE (`describePlot`): the plot's own words for the states of UX 3.5, painted by the page's painter
 *   (utils/host-binding.js) with its progress bar (operator decision 21); every state it has no words of its own for
 *   (a gate upstream, a cycle, the grouping's own refusal) is the generic notice of utils/source-notices.js.
 * - THE STATE WORD (`plotState`): the panel's `data-state`, for the styles and the tests.
 * - WHAT A DRAWN PLOT ADDS (`matrixTag`, `oneCellPerGroup`): the strip's "28 groups × 63 rows" and the suggestion of
 *   a heatmap when every group is one cell. Under No size the Size layer select itself disables what cannot give it.
 *
 * Every word is VOCABULARY.cellGene.states's. Nothing here grows with genes, cells or groups per paint: a notice is
 * worded from counts the panel made once per plan or per drawing.
 */
import { VOCABULARY } from '../../utils/vocabulary.js';
import { describeSource, durationText, timeLeftText, queueOf } from '../../utils/source-notices.js';
import { matrixLimits } from '../../utils/cell-gene-model.js';
import { GROUPING_LIMITS } from '../../utils/cell-grouping.js';
import { compactCount, exactCount } from '../../utils/coverage.js';

const S = VOCABULARY.cellGene.states;
const SRC = VOCABULARY.cellGene.sources;
const P = VOCABULARY.progress;

/** The store's refusal of a request for its cost (utils/group-store.js), as against a grouping's own refusal. */
const COST_REFUSAL = 'groups_too_expensive';

// ================================================================================================ the matrix limit

/**
 * Whether the plot may ask for its genes now (CXG-17), decided from counts alone, before any request.
 * @param {{sections: Array<{rows: number, genes: number}>, groups: (number|null), features?: number,
 *   reads?: {genes: number, reads: number, cause: (string|null)}}} shape - each section's rows as drawn and genes read;
 *   `groups` the cell axis's groups when a ready reply says them, null while unknown; `features` the request's features
 *   and `reads` how often it reads each gene (cell-gene-model.js geneReads), for the server's limit in values (WP-4)
 * @returns {{ask: 'all'|'groups'|'none', tooLarge: (null|{groups: number, rows: number, count: number, limit: number,
 *   reason?: 'too_many_values', features?: number, reads?: Object})}}
 *   'all': the groups and the genes in one request; 'groups': the groups alone first (more groups than are known could
 *   exceed the limit); 'none': above the limit, the genes are not asked for
 */
export function gateMatrix({ sections, groups, features = 0, reads = null }) {
    if (matrixLimits({ groups: GROUPING_LIMITS.groups, sections, features }).ok) return { ask: 'all', tooLarge: null };
    if (!(typeof groups === 'number' && groups >= 0)) return { ask: 'groups', tooLarge: null };
    const said = matrixLimits({ groups, sections, features });
    if (said.ok) return { ask: 'all', tooLarge: null };
    const rows = sections.reduce((a, s) => a + s.rows, 0);
    if (said.reason === 'too_many_values') {
        return { ask: 'none', tooLarge: { groups, rows, count: said.count, limit: said.limit, reason: said.reason, features, reads } };
    }
    return { ask: 'none', tooLarge: { groups, rows, count: said.count, limit: said.limit } };
}

/** "3 genes", or "3 genes on 2 layers" when the request reads each gene on more than one layer or threshold (WP-4). */
function genesRead(plot) {
    const genes = S.genes(Math.max(0, (plot && plot.genes) || 0));
    const r = plot && plot.reads;
    if (!r || !r.cause || !(r.genes > 0)) return genes;
    return SRC.geneReads(genes, Math.round(r.reads / r.genes), r.cause);
}

// ================================================================================================ the notice

/** "10.5 billion", "420 million", "8,090": a count of stored values in words. */
function valuesText(n) {
    if (!(n >= 1e6)) return exactCount(Math.round(n || 0));
    const [div, unit] = n >= 1e9 ? [1e9, S.billion] : [1e6, S.million];
    const x = n / div;
    return `${x >= 100 ? Math.round(x) : x.toFixed(1).replace(/\.0$/, '')} ${unit}`;
}

/** The job ahead in the server's lane is this page's own (SHR-47): the other plot computing, when there is exactly one. */
function aheadOf(queue, plot) {
    if (!queue || queue.ahead !== 1 || !plot || typeof plot.ownJobAhead !== 'function') return null;
    return plot.ownJobAhead() || null;
}

/**
 * Which of the page's other plots is the one job ahead of this one in the server's lane (SHR-47): the plot computing
 * with nothing ahead of it, when exactly one does. The server never says whose a job is, so with two or none it is
 * not named.
 * @param {Array<{title: string, snap: (Object|null)}>} others - the other Cell-Gene Plots of this page
 * @returns {string|null}
 */
export function ownJobAhead(others) {
    const running = others.filter((o) => {
        const s = o.snap;
        if (!s || !['computing', 'updating'].includes(s.state) || !s.progress) return false;
        const q = queueOf(s.progress);
        return !!q && q.ahead === 0;
    });
    return running.length === 1 ? running[0].title : null;
}

/** Whether a frame of the server has arrived for the job (the first, `start`, carries its place): SHR-47. */
const framed = (progress) => !!(progress && progress.queue && typeof progress.queue === 'object');

/**
 * The plot's notice for a snapshot of its cell axis, or null when nothing is to be said.
 * @param {Object} snap - the handle's read()
 * @param {{role?: string, sharers?: number}} ctx - as utils/host-binding.js gives a provider's describe
 * @param {Object|null} plot - what the plot knows: `genes` (the genes it reads), `cells` (the cells shown), `layer`
 *   (the layer its genes are read on), `tooLarge` (gateMatrix's), `ownJobAhead()` (the title of this page's job ahead)
 * @param {Object} words - the generic notice's vocabulary (utils/source-notices.js) for every other state
 */
export function describePlot(snap, ctx, plot, words) {
    if (!snap) return null;
    const sharers = (ctx && ctx.sharers) || 1;
    const say = (state, severity, tag, headline, text, actions) => ({
        state, severity, tag: { text: tag, title: text ? `${headline} ${text}` : headline }, headline, text: text || '',
        actions, blocksAxis: !['updating', 'held'].includes(state)
    });
    const cancel = ['score-cancel', S.buttons.cancel(sharers)];
    const est = snap.estimate || {};
    const genes = genesRead(plot);
    const heavy = est.lane !== 'light';

    if (plot && plot.tooLarge) {
        const t = plot.tooLarge;
        if (t.reason === 'too_many_values') {
            const r = t.reads;
            const why = r && r.cause && r.genes > 0 ? `${SRC.readTwice[r.cause](Math.round(r.reads / r.genes))} ` : '';
            return say('refused', 'warning', S.tags.tooLarge,
                SRC.tooManyValues(VOCABULARY.count(t.groups, 'group'), SRC.features(t.features), exactCount(t.count), exactCount(t.limit)),
                `${why}${SRC.tooManyValuesWayOut}`, []);
        }
        return say('refused', 'warning', S.tags.tooLarge,
            S.tooLarge(VOCABULARY.count(t.groups, 'group'), S.rows(t.rows), exactCount(t.count), exactCount(t.limit)), S.tooLargeWayOut, []);
    }

    switch (snap.state) {
        case 'awaiting': {
            const cells = plot && typeof plot.cells === 'number' ? plot.cells : est.n_cells;
            return say('awaiting', 'notice', S.tags.awaiting,
                S.ask(genes, compactCount(Number(cells) || 0), durationText(est.seconds), valuesText(Number(est.entries))), P.keepWorking,
                [['score-compute', S.buttons.compute], ['fewer-genes', S.buttons.fewer]]);
        }
        case 'refused':
            if (snap.reason !== COST_REFUSAL) break;
            if (est.layout === 'csr' && plot && plot.layer) {
                return say('refused', 'warning', S.tags.refused,
                    S.refusedCsr(plot.layer, genes, plot.genes, durationText(est.seconds)), S.csrWayOut, []);
            }
            return say('refused', 'warning', S.tags.refused, S.refusedCost(durationText(est.seconds)), S.costWayOut, []);
        case 'failed':
            // a reason the page has its own sentence for is the generic notice's (a limit, a busy server)
            if (Object.hasOwn(VOCABULARY.reasons, snap.reason)) break;
            return say('failed', 'error', S.tags.failed, S.failed(String(snap.message || S.noAnswer).replace(/[.\s]+$/, '')), '',
                [['score-retry', S.buttons.retry]]);
        case 'ready':
            if (!snap.held) return null;
            return say('held', 'notice', S.tags.held,
                S.held(snap.held.edits, Number.isFinite(snap.held.seconds) ? durationText(snap.held.seconds) : ''), '',
                [['score-update', S.buttons.update]]);
        case 'queued': {
            // waiting for one of the page's own slots: its own computations are ahead
            const own = plot && typeof plot.ownJobAhead === 'function' ? plot.ownJobAhead() : null;
            return say('queued', 'notice', S.tags.queued, own ? S.waitingFor(own) : S.waiting, '', [cancel]);
        }
        case 'estimating':
        case 'computing':
        case 'updating': {
            const progress = snap.progress;
            const as = snap.state === 'updating' ? 'updating' : 'computing';
            if (!framed(progress)) {
                // nothing heard from the server yet: no number (SHR-47)
                return say(as, 'notice', S.tags.computing, S.waiting, '', [cancel]);
            }
            const queue = queueOf(progress);
            if (queue.ahead > 0) {
                const own = aheadOf(queue, plot);
                return say(as === 'updating' ? 'updating' : 'queued', 'notice', S.tags.queued, own ? S.waitingFor(own) : P.ahead(queue.ahead),
                    heavy ? P.keepWorking : '', [cancel]);
            }
            if (progress.stage === 'groups') {
                const cells = plot && typeof plot.cells === 'number' ? plot.cells : est.n_cells;
                return say(as, 'notice', S.tags.computing, S.grouping(exactCount(Number(cells) || 0)), '', [cancel]);
            }
            // computing, or computing while sharing the slot: one state, so it does not flicker between batches
            const items = progress.items && progress.items.total > 0 ? progress.items : null;
            const left = timeLeftText(progress);
            const reading = items ? S.reading(S.genes(items.total), items.done, items.total) : S.reading(genes, 0, 0);
            return say(as, 'notice', S.tags.computing, left ? `${reading} · ${left}` : reading,
                queue.sharing > 0 ? `${P.sharing(queue.sharing)}${heavy ? ` ${P.keepWorking}` : ''}` : '', [cancel]);
        }
        default:
            break;
    }
    return describeSource(snap, ctx, words);
}

// ================================================================================================ the state word

/**
 * The panel's state in one word (`data-state`).
 * @param {Object|null} snap - the cell axis's snapshot, null with no request
 * @param {{tooLarge?: boolean, drawn?: boolean}} opts - `drawn`: the drawing shows the snapshot's values
 * @returns {string} empty, toolarge, drawing, ready, held, updating, queued, computing, awaiting, refused, failed, ...
 */
export function plotState(snap, { tooLarge = false, drawn = false } = {}) {
    if (tooLarge) return 'toolarge';
    if (!snap) return 'empty';
    if (snap.state === 'ready') return !drawn ? 'drawing' : (snap.held ? 'held' : 'ready');
    const queue = framed(snap.progress) ? queueOf(snap.progress) : null;
    if (['estimating', 'computing'].includes(snap.state) && queue && queue.ahead > 0) return 'queued';
    return snap.state;
}

// ================================================================================================ a drawn plot

/**
 * The strip's tag of a drawn plot: "28 groups × 63 rows", with the cells of the matrix that have no value (CXG-16).
 * @param {number} groups
 * @param {number} rows
 * @param {number} missing - cells of the matrix with no value
 * @returns {{text: string, title: string}}
 */
export function matrixTag(groups, rows, missing) {
    const text = S.matrix(VOCABULARY.count(groups, 'group'), S.rows(rows));
    return { text, title: missing > 0 ? `${text} · ${S.noValue(missing)}` : text };
}

/**
 * Whether to suggest a heatmap (CXG-27): dots sized by % expressing over groups of one cell each, where the size can
 * only be 0 or 100.
 * @param {{mode: string, size: (Object|null), sized: boolean, groups: Array<{n: number}>}} opts - `sized`: the size is drawn
 */
export function oneCellPerGroup({ mode, size, sized, groups }) {
    if (mode !== 'dots' || !sized || !size || size.stat !== 'pct_expressing' || !groups.length) return false;
    for (const g of groups) if (g.n !== 1) return false;
    return true;
}

// ================================================================================================ the checklist

/**
 * The empty plot's checklist (UX 3.5): "1. Choose groups [ Groups ▾ ]  2. Add genes [ Add genes ▾ ]", each ticked as
 * done; each button goes to its control.
 * @param {{D: Object, on: {groups: () => void, genes: () => void}}} opts
 * @returns {{element: HTMLElement, paint: (done: {groups: boolean, genes: boolean}) => void}}
 */
export function createChecklist({ D, on }) {
    const { el } = D;
    const C = S.checklist;
    const step = (text, label, run) => el('li', { data: { done: 'false' } }, el('span', { class: 'cgene-checklist__text', text }), ' ',
        el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary cgene-checklist__go', on: { click: () => run() } }, label));
    const groups = step(C.groups, C.groupsButton, on.groups);
    const genes = step(C.genes, C.genesButton, on.genes);
    const element = el('ol', { class: 'cgene-checklist', aria: { label: C.label } }, groups, genes);
    return {
        element,
        paint(done) {
            groups.dataset.done = done.groups ? 'true' : 'false';
            genes.dataset.done = done.genes ? 'true' : 'false';
        }
    };
}

import { setStatusTag, setScoreNotice } from './panel-surface.js';

/**
 * What a dependant of a derived source (a gene-signature score today, a cell grouping next) says in each state, and
 * how it is painted. Pure wording: a state in, a notice out, so Node tests hold every sentence. The nouns come from the
 * provider's vocabulary, so a grouping says "Grouping 'G1' was deleted." where a signature says "Signature 'S' was
 * deleted." and no provider's word is written here.
 *
 * Every notice is an OVERLAY inside the plot area plus a short strip TAG, so the plot never moves. An axis that
 * cannot be drawn gets the same sentence as a placeholder. Actions are [action, label] pairs; the registry of
 * utils/source-actions.js runs them.
 *
 * Painting exists once (`paintNotice`): a plot and a table both use it.
 */

/**
 * What a provider calls things. `states` says the states only that provider has (a gene table's filter, a layer that
 * is missing); each is a function of the snapshot and the frame, or returns undefined to leave the state to the
 * generic wording.
 * @typedef {Object} Vocabulary
 * @property {string} thing - what the source is, in the middle of a sentence: 'signature', 'table', 'grouping'
 * @property {string} source - the tag word for a source that is gone: 'source', 'grouping'
 * @property {string} result - what the source makes: 'score', 'grouping'
 * @property {string} Computing - 'Computing'
 * @property {string} [off] - the sentence for a provider that is turned off on this server
 * @property {Record<string, string>} [tags] - tag text that replaces the default of a state ('computing', 'failed', ...)
 * @property {Record<string, (snap: Object, frame: Object) => (Object|null|undefined)>} [states]
 */

/** How long a computation will take, in the words of a person: "about 40 seconds", "about 2 minutes". */
export function durationText(seconds) {
    const s = seconds === null || seconds === undefined ? NaN : Number(seconds);
    if (!Number.isFinite(s) || s < 0) return 'a while';
    if (s < 90) {
        const n = Math.max(1, Math.round(s));
        return `about ${n} second${n === 1 ? '' : 's'}`;
    }
    const m = s / 60;
    if (m < 90) return `about ${Math.round(m)} minutes`;
    const h = m / 60;
    return `about ${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'}`;
}

/** Notice states, most urgent first: a plot with two sources states the worst. A state not listed is the least urgent. */
export const PRIORITY = ['nolayer', 'nodown', 'notcells', 'unset', 'deleted', 'off', 'cycle', 'failed', 'refused', 'ask', 'awaiting', 'cancelled', 'noscore',
    'nogenes', 'building', 'estimating', 'queued', 'computing', 'updating', 'held', 'notoffered'];

const RANK = new Map(PRIORITY.map((state, i) => [state, i]));

const capital = (word) => word.charAt(0).toUpperCase() + word.slice(1);

/** The sentence part of a count: "31 of 50 genes". */
function progressText(progress, unit) {
    if (!progress || !(progress.total > 0)) return '';
    return `${progress.done.toLocaleString('en-US')} of ${progress.total.toLocaleString('en-US')} ${unit}`;
}

/**
 * The notice of one dependant's state, or null when nothing is to be said (a source that is ready and has no edits
 * waiting).
 * @param {Object} snap - from a handle's read()
 * @param {{role?: string, sharers?: number}} [ctx] - `role`: 'colour', 'x', 'y', 'z' or 'hover'
 * @param {Vocabulary} vocabulary
 * @returns {null|{state: string, severity: string, tag: {text: string, title: string}, headline: string,
 *   text: string, actions: Array<[string, string]>, blocksAxis: boolean}}
 */
export function describeSource(snap, { role = 'colour', sharers = 1 } = {}, vocabulary) {
    if (!snap) return null;
    const { thing, source, result, Computing, tags = {}, states = {} } = vocabulary;
    const Result = capital(result);
    const tagOf = (state, fallback) => tags[state] || fallback;
    const t = snap.title ? `'${snap.title}'` : `The ${thing}`;
    const T = snap.title ? `'${snap.title}'` : `the ${thing}`;
    const none = role === 'colour' ? ' This plot has no colour.' : '';
    const cancelLabel = sharers > 1 ? `Cancel for ${sharers} plots` : 'Cancel';
    const out = (state, severity, tagText, headline, text, actions) => ({
        state, severity, tag: { text: tagText, title: text ? `${headline} ${text}` : headline }, headline, text: text || '',
        actions, blocksAxis: !['updating', 'held'].includes(state)
    });
    const choose = ['score-choose', 'Choose another'];
    const open = ['score-open', `Open ${thing}`];
    const frame = { out, t, T, none, cancelLabel, choose, open, thing, result, Result, tagOf };

    // a state only this provider has, or a provider's own words for a generic one
    if (typeof states[snap.state] === 'function') {
        const own = states[snap.state](snap, frame);
        if (own !== undefined) return own;
    }

    switch (snap.state) {
        case 'deleted':
            return out('deleted', 'warning', tagOf('deleted', `${capital(source)} deleted`),
                snap.title ? `${capital(thing)} ${t} was deleted.` : `The ${thing} was deleted.`, '', [choose]);
        case 'off':
            return out('off', 'warning', 'Turned off', vocabulary.off, '', [choose]);
        case 'failed':
            return out('failed', 'error', tagOf('failed', `${Result} failed`),
                `${t} could not be computed${snap.message ? `: ${trimStop(snap.message)}` : ''}.`, '', [['score-retry', 'Retry'], open]);
        case 'refused': {
            const seconds = snap.estimate && snap.estimate.seconds;
            const head = Number.isFinite(seconds) ? `${t} would take ${durationText(seconds)}, so it was not run.`
                : `${t} is too large to compute here, so it was not run.`;
            return out('refused', 'warning', tagOf('refused', `${Result} refused`), head, snap.message || '', [open, choose]);
        }
        case 'awaiting': {
            const seconds = snap.estimate && snap.estimate.seconds;
            return out('awaiting', 'notice', tagOf('awaiting', `${Result} not computed`),
                `${t} will take ${durationText(seconds)}.${none}`, '', [['score-compute', 'Compute'], choose]);
        }
        case 'cancelled':
            return out('cancelled', 'notice', tagOf('cancelled', `${Result} cancelled`), `${t} was cancelled.${none}`, '',
                [['score-compute', 'Compute'], choose]);
        case 'noscore':
            return out('noscore', 'warning', tagOf('noscore', `No ${result}`), snap.message || `${t} has no ${result}.`, '', [open, choose]);
        case 'queued':
            return out('queued', 'notice', tagOf('queued', `${Result} queued`), `${t} is waiting for another ${result} to finish.${none}`, '',
                [['score-cancel', cancelLabel]]);
        case 'estimating':
        case 'computing': {
            const prog = progressText(snap.progress, vocabulary.progressUnit || 'genes');
            return out(snap.state, 'notice', tagOf('computing', `${Result} computing`), `${Computing} ${t}${prog ? `: ${prog}` : ''}.${none}`, '',
                [['score-cancel', cancelLabel]]);
        }
        case 'updating':
            return out('updating', 'notice', tagOf('updating', `${Result} updating`), `Showing the previous ${t}. Updating.`, '',
                [['score-cancel', cancelLabel]]);
        case 'ready':
            if (snap.held) {
                const n = snap.held.edits;
                const when = Number.isFinite(snap.held.seconds) ? ` ${durationText(snap.held.seconds).replace(/^about/, 'About')}.` : '';
                return out('held', 'notice', tagOf('held', `${Result} out of date`),
                    `Showing the previous ${t}. ${n === 1 ? '1 change is' : `${n} changes are`} not applied.${when}`, '',
                    [['score-update', `Update ${result}`]]);
            }
            return null;
        default:
            return null;
    }
}

function trimStop(message) {
    return String(message).replace(/[.\s]+$/, '');
}

/**
 * Of several notices (a plot may use one source for x and another for colour), the one to show. A state the list
 * does not rank is the least urgent, so an unexpected state never hides a known problem.
 * @param {Array<Object|null>} notices
 * @returns {Object|null}
 */
export function worstNotice(notices) {
    let best = null;
    let rank = Infinity;
    for (const n of notices) {
        if (!n) continue;
        const r = RANK.has(n.state) ? RANK.get(n.state) : PRIORITY.length;
        if (r < rank) { best = n; rank = r; }
    }
    return best;
}

/**
 * Say a notice on a host (a plot's or a table's container): a strip tag and an overlay inside the host, so nothing
 * moves or resizes. Null clears both. The state is mirrored into `data-state` of the overlay and `data-source-state`
 * of the host, which is what a test or a style reads.
 * @param {HTMLElement} host
 * @param {Object|null} notice - from describeSource
 * @param {{overlay?: boolean}} [opts] - false when the host states the notice itself (an axis placeholder)
 */
export function paintNotice(host, notice, { overlay = true } = {}) {
    setStatusTag(host, 'score', notice && { text: notice.tag.text, severity: notice.severity === 'error' ? 'error' : 'warning',
        title: notice.tag.title, pop: { text: `${notice.headline}${notice.text ? ` ${notice.text}` : ''}`, actions: notice.actions } });
    setScoreNotice(host, notice && overlay ? { state: notice.state, headline: notice.headline, text: notice.text, actions: notice.actions } : null);
    if (host && host.dataset) {
        if (notice) host.dataset.sourceState = notice.state; else delete host.dataset.sourceState;
    }
}

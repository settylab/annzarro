/**
 * What a dependant of a gene-signature score says in each state (design 7.3,
 * UX review 3.2). Pure: a state in, wording and actions out, so Node tests
 * hold every sentence.
 *
 * Every notice is an OVERLAY inside the plot area plus a short strip TAG, so
 * the plot never moves. An axis that cannot be drawn gets the same sentence as
 * a placeholder. Actions are [action, label] pairs; main.js runs them
 * (utils/score-source.js `runScoreAction`).
 */

/** How long a score will take, in the words of a person: "about 40 seconds", "about 2 minutes". */
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

/** Notice states, most urgent first: a plot with two scores states the worst. */
export const PRIORITY = ['nolayer', 'notcells', 'unset', 'deleted', 'off', 'failed', 'refused', 'awaiting', 'cancelled', 'noscore', 'nogenes',
    'estimating', 'queued', 'computing', 'updating', 'held'];

/** The sentence part of a gene count: "31 of 50 genes". */
function progressText(progress) {
    if (!progress || !(progress.total > 0)) return '';
    return `${progress.done.toLocaleString('en-US')} of ${progress.total.toLocaleString('en-US')} genes`;
}

/**
 * The notice of one dependant's state, or null when nothing is to be said (a
 * score that is ready and has no edits waiting).
 * @param {Object} snap - from a handle's read()
 * @param {{role?: string, sharers?: number}} [ctx] - `role`: 'colour', 'x', 'y', 'z' or 'hover'
 * @returns {null|{state: string, severity: string, tag: {text: string, title: string}, headline: string,
 *   text: string, actions: Array<[string, string]>, blocksAxis: boolean}}
 */
export function describeScore(snap, { role = 'colour', sharers = 1 } = {}) {
    if (!snap) return null;
    const t = snap.title ? `'${snap.title}'` : 'The signature';
    const T = snap.title ? `'${snap.title}'` : 'the signature';
    const colour = role === 'colour';
    const none = colour ? ' This plot has no colour.' : '';
    const cancelLabel = sharers > 1 ? `Cancel for ${sharers} plots` : 'Cancel';
    const out = (state, severity, tagText, headline, text, actions) => ({
        state, severity, tag: { text: tagText, title: text ? `${headline} ${text}` : headline }, headline, text: text || '',
        actions, blocksAxis: !['updating', 'held'].includes(state)
    });
    const choose = ['score-choose', 'Choose another'];
    const open = ['score-open', 'Open signature'];

    switch (snap.state) {
        case 'deleted':
            return out('deleted', 'warning', 'Source deleted', snap.title ? `Signature ${t} was deleted.` : 'The signature was deleted.', '', [choose]);
        case 'off':
            return out('off', 'warning', 'Turned off', 'Gene signatures are turned off on this server.', '', [choose]);
        case 'failed':
            return out('failed', 'error', 'Score failed',
                `${t} could not be computed${snap.message ? `: ${trimStop(snap.message)}` : ''}.`, '', [['score-retry', 'Retry'], open]);
        case 'refused': {
            const seconds = snap.estimate && snap.estimate.seconds;
            const head = Number.isFinite(seconds) ? `${t} would take ${durationText(seconds)}, so it was not run.`
                : `${t} is too large to compute here, so it was not run.`;
            return out('refused', 'warning', 'Score refused', head, snap.message || '', [open, choose]);
        }
        case 'awaiting': {
            const seconds = snap.estimate && snap.estimate.seconds;
            return out('awaiting', 'notice', 'Score not computed',
                `${t} will take ${durationText(seconds)}.${none}`, '', [['score-compute', 'Compute'], choose]);
        }
        case 'cancelled':
            return out('cancelled', 'notice', 'Score cancelled', `${t} was cancelled.${none}`, '',
                [['score-compute', 'Compute'], choose]);
        case 'noscore': {
            const missing = snap.reason === 'no_gene_present';
            return out('noscore', 'warning', 'No score',
                missing ? `None of the genes of ${T} are in this dataset.` : (snap.message || `${t} has no score.`), '',
                [open, choose]);
        }
        case 'nolayer':
            return out('nolayer', 'warning', 'Layer not found', `Layer '${snap.layer || 'X'}' is not in this dataset, so ${t} has no score.`, '',
                [open, choose]);
        case 'notcells':
            return out('notcells', 'notice', 'Not a cell source', 'Gene scores are a cell source; not available in a Gene Plot.', '', []);
        case 'unset':
            return out('unset', 'notice', 'No signature', 'No signature is chosen.', '', [choose]);
        case 'nogenes':
            return out('nogenes', 'notice', 'No genes', `${t} has no genes yet.`, '', [open]);
        case 'queued':
            return out('queued', 'notice', 'Score queued', `${t} is waiting for another score to finish.${none}`, '',
                [['score-cancel', cancelLabel]]);
        case 'estimating':
        case 'computing': {
            const prog = progressText(snap.progress);
            return out(snap.state, 'notice', 'Score computing', `Computing ${t}${prog ? `: ${prog}` : ''}.${none}`, '',
                [['score-cancel', cancelLabel]]);
        }
        case 'updating':
            return out('updating', 'notice', 'Score updating', `Showing the previous ${t}. Updating.`, '',
                [['score-cancel', cancelLabel]]);
        case 'ready':
            if (snap.held) {
                const n = snap.held.edits;
                const when = Number.isFinite(snap.held.seconds) ? ` ${durationText(snap.held.seconds).replace(/^about/, 'About')}.` : '';
                return out('held', 'notice', 'Score out of date',
                    `Showing the previous ${t}. ${n === 1 ? '1 change is' : `${n} changes are`} not applied.${when}`, '',
                    [['score-update', 'Update score']]);
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
 * Of several notices (a plot may use one score for x and another for colour),
 * the one to show.
 * @param {Array<Object|null>} notices
 * @returns {Object|null}
 */
export function worstNotice(notices) {
    let best = null;
    let rank = Infinity;
    for (const n of notices) {
        if (!n) continue;
        const r = PRIORITY.indexOf(n.state);
        if (r < rank) { best = n; rank = r; }
    }
    return best;
}

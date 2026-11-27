import { setStatusTag, setScoreNotice, setStatusProgress } from './panel-surface.js';
import { VOCABULARY } from './vocabulary.js';
import { limit, limitDefault } from './limits.js';
import { askPolicy, panelOfHost } from './ask-policy.js';

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
 * Painting exists once (`paintNotice`), and so does deciding what a host shows: utils/host-binding.js's painter
 * gathers the notices of every provider on a host and paints the worst of them here, with its progress bar
 * (`progressBar`, operator decision 21).
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
 * @property {string} [progressUnit] - what a progress count counts: 'genes' for a score; a grouping's stored entries
 *   (default 'genes')
 * @property {string} [cycleKind] - the kind of panel a ring made only of this provider's own is named for (default `thing`)
 * @property {string} [off] - the sentence for a provider that is turned off on this server
 * @property {Record<string, string>} [tags] - tag text that replaces the default of a state ('computing', 'failed', ...)
 * @property {string} [found] - what a table upstream is built to find: 'genes' for a score, 'cells' for a grouping
 * @property {{to: string, ing: string}} [act] - what the source does with them: {to: 'score', ing: 'scoring'}
 * @property {(snap: Object) => (string|null)} [upstreamTitle] - the title of the table a gate waits on, when it is not
 *   the source itself (a grouping's table factor); the source's own title otherwise
 * @property {string} [waitingNote] - said under a queue position (SHR-47): 'Groupings and counts keep working.' for a
 *   computation that holds the heavy slot
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

/** The refusal reasons that are a cost: the estimate's seconds were over the refuse limit (the server's `tier` is `refused`). */
const COST_REASONS = Object.freeze(['score_too_expensive', 'groups_too_expensive']);

/**
 * Whether a refused snapshot is a refusal by cost and says so with its seconds: its reason is a cost reason (or none is
 * given), and the estimate's seconds are over the limit the estimate reports (`max_s`; no limit reported: taken as over).
 * A refusal for any other limit never quotes the estimate, which was made before it and is usually small.
 * @param {Object} snap
 */
export function isCostRefusal(snap) {
    if (!snap || snap.state !== 'refused') return false;
    if (snap.reason && !COST_REASONS.includes(snap.reason)) return false;
    const est = snap.estimate || {};
    const seconds = Number(est.seconds);
    if (est.seconds === null || est.seconds === undefined || !Number.isFinite(seconds)) return false;
    return !(Number(est.max_s) > 0) || seconds > Number(est.max_s);
}

/**
 * A length of time in whole units, for a limit: "10 minutes", "30 minutes", "2 hours", "45 seconds". Not the rounded
 * "about" of durationText: a limit is exact.
 * @param {number} seconds
 */
// export-unused-ok: a test holds the wording of a limit
export function limitText(seconds) {
    const s = Number(seconds);
    if (!(s > 0) || !Number.isFinite(s)) return '';
    const unit = (n, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
    if (s % 3600 === 0) return unit(s / 3600, 'hour');
    if (s % 60 === 0) return unit(s / 60, 'minute');
    return unit(Math.round(s), 'second');
}

/** A tried run says it stops by itself: "Stops by itself after 30 minutes." (from the first frame's deadline, else the estimate's). */
function triedNote(snap) {
    if (!snap || !snap.forced) return '';
    const limit = limitText((snap.progress && snap.progress.deadline_s) || (snap.estimate && snap.estimate.try && snap.estimate.try.max_s));
    return limit ? `Stops by itself after ${limit}.` : '';
}

/** The run a refused-by-time snapshot may be tried as: {max_s}, or null (not a cost refusal, or the server says no). */
function tryOf(snap) {
    if (!isCostRefusal(snap)) return null;
    const t = snap.estimate && snap.estimate.try;
    return t && t.allowed ? { max_s: Number(t.max_s) } : null;
}

/** The same for a cancelled run whose estimate is still over the limit: its [Compute] is [Try anyway]. */
function cancelledTry(snap) {
    const est = snap && snap.estimate;
    if (!est || est.tier !== 'refused' || !est.try || !est.try.allowed) return null;
    return { max_s: Number(est.try.max_s) };
}

/** Why a time refusal has no way on, in words (estimate.try.why), or ''. */
function noTryWhy(snap) {
    const t = snap && snap.estimate && snap.estimate.try;
    if (!t || t.allowed) return '';
    const limit = limitText(t.max_s);
    if (t.why === 'too_long') return limit ? `That is more than ten times the ${limit} a run may be given here.` : '';
    if (t.why === 'off') return 'This server does not run jobs over the limit.';
    return '';
}

/** "(runs over 10 minutes are not started by themselves)", or '' when the limit is not known. */
export const startLimitText = (estimate) => {
    const limit = limitText(estimate && estimate.max_s);
    return limit ? ` (runs over ${limit} are not started by themselves)` : '';
};

/**
 * What a notice gains from "Try anyway" and "Don't ask again for this panel" (aggregation-unify-080.md 14.3), whoever
 * worded it: a refusal by cost that the server says may be tried gets [Try anyway] first and the tick of level
 * 'try'; one it says may not says why, with no button; the question of the confirm tier gets the tick of level
 * 'confirm'; a cancelled run that is still over the limit gets [Try anyway] for its [Compute]. The button is the
 * provider's own 'score-compute' (accept, which sends `force` for a refused estimate). Returns the notice itself.
 * @param {Object} snap
 * @param {Object|null} notice
 */
export function withTry(snap, notice) {
    if (!notice || !snap) return notice;
    const retarget = (label) => notice.actions.map(a => (a[0] === 'score-compute' ? ['score-compute', label] : a));
    if (notice.state === 'refused' && snap.state === 'refused' && isCostRefusal(snap)) {
        if (tryOf(snap)) {
            return { ...notice, actions: [['score-compute', 'Try anyway'], ...notice.actions.filter(a => a[0] !== 'score-compute')], tick: 'try' };
        }
        const why = noTryWhy(snap);
        return why ? { ...notice, text: notice.text ? `${notice.text} ${why}` : why } : notice;
    }
    if (notice.state === 'awaiting') return { ...notice, tick: 'confirm' };
    if (notice.state === 'cancelled' && cancelledTry(snap)) return { ...notice, actions: retarget('Try anyway'), tick: 'try' };
    return notice;
}

/**
 * What a grouping's figures of a refusal for its size say ("has 19,000 groups: a grouping holds up to 2,000"), from the
 * route's `refused` ({reason, count, limit}); null without figures or for another reason.
 * @param {{reason?: string, count?: number, limit?: number}|null} refused
 */
export function sizeRefusalText(refused) {
    if (!refused || !Number.isFinite(Number(refused.count)) || !Number.isFinite(Number(refused.limit))) return null;
    const W = VOCABULARY.word;
    const PL = VOCABULARY.plural;
    const fmt = (n) => Number(n).toLocaleString('en-US');
    if (refused.reason === 'too_many_groups') return `has ${fmt(refused.count)} ${PL.group}: a ${W.grouping} holds up to ${fmt(refused.limit)}`;
    if (refused.reason === 'too_many_levels') return `has a ${W.factor} with ${fmt(refused.count)} ${PL.level}: a ${W.factor} holds up to ${fmt(refused.limit)}`;
    return null;
}

/** The states of a dependant whose value is still on its way. */
const PENDING_STATES = Object.freeze(['idle', 'estimating', 'queued', 'computing', 'updating']);

/**
 * What a dependant without its value says in its plot's coverage (utils/coverage.js gap kinds): 'pending' while the
 * value is on its way ("not ready yet"), '' when the dataset truly lacks it (a layer or every gene not in it: the gap's
 * own "not in this dataset"), and 'stopped' for every other state ("not available": refused, failed, cancelled,
 * deleted, asks first).
 * @param {Object|null} snap
 * @returns {'pending'|'stopped'|''}
 */
export function coverageKindOf(snap) {
    if (!snap) return 'stopped';
    if (PENDING_STATES.includes(snap.state)) return 'pending';
    if (snap.state === 'nolayer' || (snap.state === 'noscore' && snap.reason === 'no_gene_present')) return '';
    return 'stopped';
}

/** Notice states, most urgent first: a plot with two sources states the worst. A state not listed is the least urgent. */
export const PRIORITY = ['nolayer', 'nodown', 'notcells', 'unset', 'deleted', 'off', 'cycle', 'failed', 'refused', 'stopped', 'ask', 'awaiting', 'cancelled', 'noscore',
    'nogenes', 'nofactors', 'building', 'estimating', 'queued', 'computing', 'updating', 'held'];

const RANK = new Map(PRIORITY.map((state, i) => [state, i]));

const capital = (word) => word.charAt(0).toUpperCase() + word.slice(1);

/** The sentence part of a count: "31 of 50 genes". */
function progressText(progress, unit) {
    if (!progress || !(progress.total > 0)) return '';
    return `${progress.done.toLocaleString('en-US')} of ${progress.total.toLocaleString('en-US')} ${unit}`;
}

/** Time left is said only after this share of the stored entries, and this much running time (SHR-48). */
const LEFT_AFTER_SHARE = 0.1;
const LEFT_AFTER_S = 5;

/**
 * "about 3 minutes left" (SHR-48, UX 3.5): from the stored entries done and in all, at the rate measured over the time
 * the job held its lane (`running_s`, waits and give-way pauses left out); never from a count of genes. Empty until
 * 10% of the entries and 5 s, or when the frame does not carry them.
 */
export function timeLeftText(progress) {
    if (!progress) return '';
    const done = Number(progress.entries_done);
    const total = Number(progress.entries_total);
    const ran = Number(progress.running_s);
    if (!(total > 0) || !(done > 0) || !(ran >= LEFT_AFTER_S) || done / total < LEFT_AFTER_SHARE) return '';
    const left = Math.max(0, total - done) / (done / ran);
    const sharing = !!(progress.queue && progress.queue.sharing > 0);
    return VOCABULARY.progress.left(durationText(left), sharing);
}

/** The server's place for a job (SHR-47): {ahead, sharing}, each a count, or null when the frame says nothing. */
export function queueOf(progress) {
    const q = progress && progress.queue;
    if (!q || typeof q !== 'object') return null;
    return { ahead: Math.max(0, Number(q.ahead) || 0), sharing: Math.max(0, Number(q.sharing) || 0) };
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
    const none = role === 'colour' ? ' This plot has no color.' : '';
    const cancelLabel = sharers > 1 ? `Cancel for ${sharers} plots` : 'Cancel';
    const out = (state, severity, tagText, headline, text, actions) => ({
        state, severity, tag: { text: tagText, title: text ? `${headline} ${text}` : headline }, headline, text: text || '',
        actions, blocksAxis: !['updating', 'held'].includes(state)
    });
    const choose = ['score-choose', 'Choose another'];
    const open = ['score-open', `Open ${thing}`];
    const frame = { out, t, T, none, cancelLabel, choose, open, thing, result, Result, tagOf };
    const act = vocabulary.act || { to: 'compute', ing: 'computing' };
    const found = vocabulary.found || 'values';
    // the table a gate waits on: the source itself (a gene table), or a table its recipe uses (a grouping's factor)
    const upstream = () => {
        const title = typeof vocabulary.upstreamTitle === 'function' ? vocabulary.upstreamTitle(snap) : null;
        return title ? `'${title}'` : T;
    };

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
        case 'cycle': {
            // sources that depend on each other, through whatever panels (a table, a grouping)
            const names = (snap.cycle || []).slice(0, -1).map(x => `'${x}'`);
            const ring = names.length === 2 ? `${names[0]} and ${names[1]} depend on each other.`
                : `${names.join(', ')} depend on each other in a circle.`;
            // the tag names the ring by the kind of panel in it: the provider's own word when every member is its kind
            const kinds = snap.cycleKinds || [];
            const own = kinds.every(k => k === (vocabulary.cycleKind || thing));
            return out('cycle', 'warning', own ? tagOf('cycle', 'Circular dependency') : 'Circular references', `${ring}${none}`, '', [open, choose]);
        }
        case 'failed': {
            // a reason the page has its own sentence for: a limit is a refusal (trying again gives the same answer),
            // a busy server or a set that no longer fits is a failure that Retry may mend
            const said = Object.hasOwn(VOCABULARY.reasons, snap.reason) ? VOCABULARY.reasons[snap.reason] : null;
            if (said && !said.retry) {
                return out('refused', 'warning', tagOf('refused', `${Result} refused`), `${t} was not computed.`, said.text, [open, choose]);
            }
            if (said) {
                return out('failed', 'error', tagOf('failed', `${Result} failed`), `${t} could not be computed.`, said.text,
                    [['score-retry', 'Retry'], open]);
            }
            return out('failed', 'error', tagOf('failed', `${Result} failed`),
                `${t} could not be computed${snap.message ? `: ${trimStop(snap.message)}` : ''}.`, '', [['score-retry', 'Retry'], open]);
        }
        case 'refused': {
            // Which limit refused it decides the sentence (operator 2026-11-25: a grouping over the groups limit said "would take
            // about 1 second, so it was not run", the estimate that came before it). Seconds are quoted only for a refusal by cost.
            const figures = snap.refused || (snap.header && snap.header.refused) || null;
            const size = sizeRefusalText(figures);
            if (size) {
                return out('refused', 'warning', tagOf('refused', `${Result} refused`), `${t} ${size}, so it was not computed.`, '', [open, choose]);
            }
            const said = Object.hasOwn(VOCABULARY.reasons, snap.reason) ? VOCABULARY.reasons[snap.reason] : null;
            if (said) {
                return out('refused', 'warning', tagOf('refused', `${Result} refused`), `${t} was not computed.`, said.text, [open, choose]);
            }
            // a gate of the page's own (nesting too deep, a table of too many cells): its figure and its limit, and the way out
            const gate = Object.hasOwn(VOCABULARY.gateRefusal, snap.reason) ? VOCABULARY.gateRefusal[snap.reason] : null;
            if (gate) {
                const figure = Number(snap.reason === 'nested_too_deep' ? snap.depth : snap.cells);
                const head = Number.isFinite(figure) && Number(snap.limit) > 0 ? gate.head(figure, Number(snap.limit)) : gate.headNoFigures;
                return out('refused', 'warning', tagOf('refused', `${Result} refused`), `${t} ${head}, so it was not computed.`, gate.wayOut, [open, choose]);
            }
            // an input the open dataset lacks is no question of size (it was said to be "too large to compute here")
            if (snap.reason === 'not_in_dataset') {
                return out('refused', 'warning', tagOf('refused', `${Result} refused`),
                    `${t} was not computed.`, snap.message || 'An input is not in this dataset.', [open, choose]);
            }
            if (isCostRefusal(snap)) {
                return out('refused', 'warning', tagOf('refused', `${Result} refused`),
                    `${t} was not run: it is estimated at ${durationText(snap.estimate.seconds)}${startLimitText(snap.estimate)}.`, snap.message || '', [open, choose]);
            }
            // no seconds to quote (or not by cost): the sentence of before when nothing was estimated, else only that it was not run
            const estimated = snap.estimate && Number.isFinite(Number(snap.estimate.seconds)) && snap.estimate.seconds !== null;
            const head = estimated ? `${t} was not run.` : `${t} is too large to compute here, so it was not run.`;
            return out('refused', 'warning', tagOf('refused', `${Result} refused`), head, snap.message || '', [open, choose]);
        }
        case 'awaiting': {
            const seconds = snap.estimate && snap.estimate.seconds;
            return out('awaiting', 'notice', tagOf('awaiting', `${Result} not computed`),
                `${t} will take ${durationText(seconds)}.${none}`, '', [['score-compute', 'Compute'], choose]);
        }
        case 'stopped': {
            const limit = limitText(snap.limitS || (snap.estimate && snap.estimate.try && snap.estimate.try.max_s));
            return out('stopped', 'warning', tagOf('stopped', `${Result} stopped`),
                `${t} was stopped${limit ? ` after ${limit}` : ''}, the server's limit for a tried run.`, 'Use fewer genes or groups, or a subset.',
                [['score-compute', 'Try again'], open, choose]);
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
            // not started: nothing of it is on screen yet, so nothing is running and there is nothing to cancel
            if (snap.notStarted) {
                return out(snap.state, 'notice', tagOf('idle', `${Result} not started`),
                    `${t} starts when it is on screen.${none}`, '', []);
            }
            const queue = queueOf(snap.progress);
            const note = vocabulary.waitingNote || '';
            // waiting in the server's lane (SHR-47): the place in line, not a count that is not moving
            if (queue && queue.ahead > 0) {
                return out('queued', 'notice', tagOf('queued', `${Result} queued`), `${VOCABULARY.progress.ahead(queue.ahead)}${none}`, note,
                    [['score-cancel', cancelLabel]]);
            }
            const prog = progressText(snap.progress, vocabulary.progressUnit || 'genes');
            const left = timeLeftText(snap.progress);
            const sharing = queue && queue.sharing > 0 ? VOCABULARY.progress.sharing(queue.sharing) : '';
            return out(snap.state, 'notice', tagOf('computing', `${Result} computing`),
                `${Computing} ${t}${prog ? `: ${prog}` : ''}${left ? ` · ${left}` : ''}.${none}`,
                [sharing ? `${sharing}${note ? ` ${note}` : ''}` : '', triedNote(snap)].filter(Boolean).join(' '),
                [['score-cancel', cancelLabel]]);
        }
        case 'building': {
            // the table it reads must be built (or opened) first: a gate of the source's own table or a table upstream
            const opening = snap.gate && snap.gate.reason === 'opening';
            const U = upstream();
            return out('building', 'notice', opening ? 'Opening table' : 'Building filter',
                opening ? `Waiting for ${U} to open, to ${act.to} its ${found}.${none}`
                    : `Building ${U} to find its ${found}, then ${act.ing} them.${none}`, '',
                snap.gate && snap.gate.frozen ? [open] : [['score-cancel', cancelLabel], open]);
        }
        case 'nofactors':
            // a grouping with no factor yet: nothing was asked (group-sources.js gates it)
            return out('nofactors', 'notice', `No ${VOCABULARY.plural.factor}`, `${VOCABULARY.phrase.noFactors(t)}${none}`, '', [open, choose]);
        case 'ask':
            return out('ask', 'notice', 'Filter not built',
                `Building ${upstream()} to find its ${found} will pause the page for a few seconds.${none}`, '',
                [['score-compute', 'Build filter'], open, choose]);
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

/** A wait longer than this shows a progress bar (operator decision 21), by default: by the server's estimate, or by the
 *  clock. The value in force is limits.progress_bar_s (`barAfterS`). */
// export-unused-ok: the default, for tests and the docs of the clock
export const BAR_AFTER_S = limitDefault('progress_bar_s');

/** Seconds of waiting after which a progress bar is shown: the server's limits.progress_bar_s (utils/limits.js). */
export function barAfterS() {
    return limit('progress_bar_s');
}

/** The notice states of a computation on its way, which may show a bar. */
const ON_ITS_WAY = Object.freeze(['estimating', 'queued', 'computing', 'updating']);

/**
 * The progress bar of a dependant's state (operator decision 21), or null for none.
 *
 * A bar is shown once the wait is long: the server's estimate is over 10 s, or the job has run 10 s (by the page's
 * clock, `elapsed`, or the server's `running_s`), whichever comes first; a shorter job keeps its text line. It is
 * DETERMINATE from the stored entries done and in all (SHR-48), or from the frame's count when it carries no entries;
 * a job waiting for the server or the page, and a phase that counts nothing, show an INDETERMINATE bar. There is never
 * a percentage that is not measured.
 * A load that keeps its drawing (a quiet one, shown in the strip) takes the clock only, `byEstimate: false`: it shows a
 * bar once the job has actually run 10 s, never on the estimate alone.
 * @param {Object} snap - a handle's snapshot
 * @param {number} elapsed - seconds since the page saw this job start waiting or computing
 * @param {{byEstimate?: boolean}} [opts]
 * @returns {null|{determinate: boolean, value?: number, max?: number}}
 */
export function progressBar(snap, elapsed, { byEstimate = true } = {}) {
    if (!snap || !ON_ITS_WAY.includes(snap.state)) return null;
    const p = snap.progress || null;
    const estimate = snap.estimate ? Number(snap.estimate.seconds) : NaN;
    const ran = p ? Number(p.running_s) : NaN;
    const after = barAfterS();
    // a run nobody was asked about (the panel's tick) or a tried one always shows its bar
    const long = snap.unasked || snap.forced || (byEstimate && Number.isFinite(estimate) && estimate > after) || elapsed >= after || (Number.isFinite(ran) && ran >= after);
    if (!long) return null;
    const queue = queueOf(p);
    if (snap.state !== 'computing' && snap.state !== 'updating') return { determinate: false };
    if (!p || (queue && queue.ahead > 0)) return { determinate: false };
    const counted = Number(p.entries_total) > 0 ? [Number(p.entries_done), Number(p.entries_total)] : [Number(p.done), Number(p.total)];
    const [done, total] = counted;
    if (!(total > 0) || !Number.isFinite(done)) return { determinate: false };
    return { determinate: true, value: Math.min(total, Math.max(0, done)), max: total };
}

/**
 * Put a progress bar in `box` (a notice's card or an axis placeholder), under the sentence and above the buttons, or
 * take it away. One element per box, kept across repaints of the card's text. `role="progressbar"`, 0 to 100, with no `aria-valuenow` while indeterminate,
 * and the notice's sentence as `aria-valuetext`.
 * @param {HTMLElement|null} box
 * @param {null|{determinate: boolean, value?: number, max?: number}} bar
 * @param {string} sentence
 */
export function paintProgress(box, bar, sentence) {
    if (!box || typeof box.querySelector !== 'function') return;
    let el = box.querySelector(':scope > .source-progress');
    if (!bar) {
        if (el) el.remove();
        return;
    }
    if (!el) {
        el = document.createElement('div');
        el.className = 'source-progress';
        el.setAttribute('role', 'progressbar');
        el.setAttribute('aria-valuemin', '0');
        el.setAttribute('aria-valuemax', '100');
        const fill = document.createElement('div');
        fill.className = 'source-progress__fill';
        el.appendChild(fill);
    }
    // under the sentence, above the buttons; a repaint of the card's text put a new row of buttons in
    const buttons = box.querySelector(':scope > .coverage-placeholder__do');
    if (buttons ? el.nextElementSibling !== buttons : el.parentNode !== box) box.insertBefore(el, buttons);
    el.dataset.mode = bar.determinate ? 'determinate' : 'indeterminate';
    el.setAttribute('aria-valuetext', sentence);
    const fill = el.firstElementChild;
    if (bar.determinate) {
        const pct = Math.round((100 * bar.value) / bar.max);
        el.setAttribute('aria-valuenow', String(pct));
        fill.style.width = `${pct}%`;
    } else {
        el.removeAttribute('aria-valuenow');
        fill.style.width = '';
    }
}

/** A notice's whole sentence: its headline and its text. */
export const sentenceOf = (notice) => `${notice.headline}${notice.text ? ` ${notice.text}` : ''}`;

/**
 * The slim bar in a plot's status strip for a load that keeps its drawing (the overlay would cover it): the notice's
 * sentence as its aria-valuetext, and beside it the time left, or the notice's tag until the time left is known. Null
 * takes it away.
 * @param {HTMLElement} host
 * @param {null|{determinate: boolean, value?: number, max?: number}} bar - progressBar's
 * @param {Object} [notice] - the notice held back
 * @param {Object} [snap] - its snapshot, for the time left
 */
export function paintStripProgress(host, bar, notice = null, snap = null) {
    setStatusProgress(host, bar && notice ? {
        determinate: bar.determinate, pct: bar.determinate ? Math.round((100 * bar.value) / bar.max) : undefined,
        sentence: sentenceOf(notice), text: timeLeftText(snap && snap.progress) || notice.tag.text
    } : null);
}

/**
 * Say a notice on a host (a plot's or a table's container): a strip tag and an overlay inside the host, so nothing
 * moves or resizes. Null clears both. The state is mirrored into `data-state` of the overlay and `data-source-state`
 * of the host, which is what a test or a style reads. A notice's `progress` (progressBar's) is drawn in its card.
 * Call it through utils/host-binding.js's painter, which knows every provider on the host.
 * @param {HTMLElement} host
 * @param {Object|null} notice - from describeSource, with `progress` when the painter gives it one
 * @param {{overlay?: boolean}} [opts] - false when the host states the notice itself (an axis placeholder)
 */
export function paintNotice(host, notice, { overlay = true } = {}) {
    const ticked = !!(notice && notice.tick && askPolicy.covers(panelOfHost(host), notice.tick));
    setStatusTag(host, 'score', notice && { text: notice.tag.text, severity: notice.severity === 'error' ? 'error' : 'warning',
        title: notice.tag.title, pop: { text: sentenceOf(notice), actions: notice.actions, tick: notice.tick, ticked } });
    setScoreNotice(host, notice && overlay ? { state: notice.state, headline: notice.headline, text: notice.text, actions: notice.actions,
        tick: notice.tick, ticked } : null);
    if (notice && overlay && host && typeof host.querySelector === 'function') {
        paintProgress(host.querySelector(':scope > .score-notice .filter-notice__card'), notice.progress || null, sentenceOf(notice));
    }
    if (host && host.dataset) {
        if (notice) host.dataset.sourceState = notice.state; else delete host.dataset.sourceState;
    }
}

/**
 * The strip's tag of a panel that starts long computations without asking (aggregation-unify-080.md 14.5): shown while
 * the panel's tick is on, first among the strip's tags; its pop-over has [Ask again]. Null takes it away.
 * @param {HTMLElement} host
 * @param {string|null} level - the panel's level ('confirm', 'try') or null
 */
export function paintUnasked(host, level) {
    const after = limitText(limit('try_max_s')) || '30 minutes';
    setStatusTag(host, 'unasked', level && {
        text: 'Runs without asking', severity: 'notice',
        title: `This panel starts long computations without asking (each stops after ${after}). Click to change.`,
        pop: { text: `Long computations in this panel start without asking. Each can be cancelled and stops by itself after ${after}.`,
            actions: [['ask-again', 'Ask again']] }
    });
}

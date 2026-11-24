import { setStatusTag, setScoreNotice, setStatusProgress } from './panel-surface.js';
import { VOCABULARY } from './vocabulary.js';

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
export const PRIORITY = ['nolayer', 'nodown', 'notcells', 'unset', 'deleted', 'off', 'cycle', 'failed', 'refused', 'ask', 'awaiting', 'cancelled', 'noscore',
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
                `${Computing} ${t}${prog ? `: ${prog}` : ''}${left ? ` · ${left}` : ''}.${none}`, sharing ? `${sharing}${note ? ` ${note}` : ''}` : '',
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

/** A wait longer than this shows a progress bar (operator decision 21): by the server's estimate, or by the clock. */
export const BAR_AFTER_S = 10;

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
    const long = (byEstimate && Number.isFinite(estimate) && estimate > BAR_AFTER_S) || elapsed >= BAR_AFTER_S || (Number.isFinite(ran) && ran >= BAR_AFTER_S);
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
    setStatusTag(host, 'score', notice && { text: notice.tag.text, severity: notice.severity === 'error' ? 'error' : 'warning',
        title: notice.tag.title, pop: { text: sentenceOf(notice), actions: notice.actions } });
    setScoreNotice(host, notice && overlay ? { state: notice.state, headline: notice.headline, text: notice.text, actions: notice.actions } : null);
    if (notice && overlay && host && typeof host.querySelector === 'function') {
        paintProgress(host.querySelector(':scope > .score-notice .filter-notice__card'), notice.progress || null, sentenceOf(notice));
    }
    if (host && host.dataset) {
        if (notice) host.dataset.sourceState = notice.state; else delete host.dataset.sourceState;
    }
}

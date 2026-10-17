/**
 * The rules of the toast notices (main.js _showNotification), kept pure so
 * that they are testable: how severe a notice is, which one may replace
 * which, and how long one stays.
 */

/** Least to most severe. */
export const SEVERITY = Object.freeze({ success: 0, info: 1, warning: 2, error: 3 });

/** The rank of a notice type; an unknown type counts as info. */
export function severityRank(type) {
    return type in SEVERITY ? SEVERITY[type] : SEVERITY.info;
}

/**
 * A notice may replace the one shown only if it is at least as severe: an
 * error is never wiped by the info notice that follows it. A lower one is
 * stacked below instead.
 * @param {string} shown - type of the notice on screen
 * @param {string} incoming - type of the new notice
 * @returns {boolean}
 */
export function mayReplace(shown, incoming) {
    return severityRank(incoming) >= severityRank(shown);
}

/** Reading time: about 200 ms a word. */
export const MS_PER_WORD = 200;
/** A success confirms something the user did: short. */
export const MIN_SUCCESS_MS = 4000;
/** Info and warning: long enough to notice, and to read a short sentence. */
export const MIN_NOTICE_MS = 6000;
/** No timed notice outlasts this; anything longer is read from the close button's side. */
export const MAX_NOTICE_MS = 40000;

/**
 * How long a notice stays (ms; 0 = until closed). An error stays until
 * closed. Otherwise the time scales with the words of title and message,
 * with a floor by type. An explicit duration wins.
 * @param {string} type
 * @param {string} title
 * @param {string} message
 * @param {number} [explicit] - the caller's own duration
 * @returns {number}
 */
export function noticeDuration(type, title, message, explicit = undefined) {
    if (explicit !== undefined && explicit !== null) return explicit;
    if (type === 'error') return 0;
    const words = `${title || ''} ${message || ''}`.split(/\s+/).filter(Boolean).length;
    const floor = type === 'success' ? MIN_SUCCESS_MS : MIN_NOTICE_MS;
    return Math.min(MAX_NOTICE_MS, Math.max(floor, words * MS_PER_WORD));
}

/**
 * Of the toasts on screen, those a new one replaces and those it stays
 * below.
 * @param {Array<{id: string, type: string}>} shown
 * @param {string} incoming - type of the new notice
 * @returns {{replace: string[], keep: string[]}} ids
 */
export function planReplacement(shown, incoming) {
    const replace = [];
    const keep = [];
    for (const t of shown) (mayReplace(t.type, incoming) ? replace : keep).push(t.id);
    return { replace, keep };
}

// ---- message builders -------------------------------------------------------------------------
// Notices that more than one place raises say the same thing: one builder each.

/**
 * Several notices of one moment as one toast, so that the second does not
 * replace the first: the first as it is, the others as paragraphs that
 * begin with their titles.
 * @param {Array<{title: string, message: string}>} notices
 * @returns {{title: string, message: string}|null}
 */
export function joinNotices(notices) {
    const list = (notices || []).filter(Boolean);
    if (!list.length) return null;
    const [first, ...rest] = list;
    return {
        title: first.title,
        message: [first.message, ...rest.map(n => `${n.title}: ${n.message}`)].join('\n\n')
    };
}

/**
 * A focus (from a link, a panel set or the dataset's own) on a cell the
 * subset does not show, on a server that cannot read a cell outside it.
 * @param {string} cell
 * @returns {{title: string, message: string}}
 */
export function focusOutsideSubsetNotice(cell) {
    return {
        title: 'Focused cell not in the subset',
        message: `${cell} is not among the cells shown, so it is not focused. `
            + 'This server cannot read a cell outside the subset.'
    };
}

/**
 * A view saved, or a link made, before a large store's names were checked.
 * @param {'saved'|'link'} what
 * @returns {{title: string, message: string}}
 */
export function fingerprintPendingNotice(what) {
    return {
        title: what === 'link' ? 'Link made before the names were checked' : 'Saved before the names were checked',
        message: 'This store\'s cell and gene names are still being checked, so the view records only its '
            + 'size and fields. '
            + (what === 'link' ? 'Make the link again in a minute to include them.' : 'Save again in a minute to include them.')
    };
}

/**
 * Columns that followed the focused cell or gene in an older view and were
 * removed when it was restored with nothing focused, from one or several
 * tables of one restore.
 * @param {Array<{title: string, keys: string[]}>} removed - per table
 * @returns {{title: string, message: string}|null}
 */
export function removedColumnsNotice(removed) {
    const list = (removed || []).filter(r => r && r.keys && r.keys.length);
    if (!list.length) return null;
    const why = 'It followed the focused cell or gene, and nothing was focused when the view was restored. '
        + 'Add it again from the cell or gene you want.';
    if (list.length === 1 && list[0].keys.length === 1) {
        return { title: `${list[0].title}: column ${list[0].keys[0]} removed`, message: why };
    }
    const count = list.reduce((n, r) => n + r.keys.length, 0);
    return {
        title: `${count} columns removed`,
        message: `${list.map(r => `${r.title}: ${r.keys.join(', ')}`).join('\n')}\n\n`
            + why.replace('It followed', 'They followed').replace('Add it again', 'Add them again')
    };
}

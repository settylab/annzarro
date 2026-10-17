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

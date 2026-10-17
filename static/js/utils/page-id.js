/**
 * This page's id: random, new at every load (a reload of the same tab gets
 * a new one). The autosave, the restore marker and the crash marker carry
 * it, so the next page knows which saved session a marker is about.
 */
function randomId() {
    try {
        if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
    } catch { /* not a secure context */ }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const PAGE_ID = randomId();
/** When this page started (ms since the epoch). */
export const PAGE_START = Date.now();

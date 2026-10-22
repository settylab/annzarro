/**
 * Copy text to the clipboard, also on a plain-http page.
 *
 * navigator.clipboard exists only in a secure context (https or localhost), but a cluster node is
 * often served over plain http. There the legacy document.execCommand('copy') on a hidden
 * textarea still works while a key press or click is being handled, so it is the fallback.
 *
 * Call copyText inside the handler of the key or click, with nothing awaited before it: the
 * fallback then runs synchronously in the gesture when navigator.clipboard is missing.
 */

/** Copy through a hidden textarea and execCommand; true if the browser took it. Never throws. */
export function legacyCopy(text, doc = globalThis.document) {
    if (!doc || !doc.body || typeof doc.execCommand !== 'function') return false;
    const before = doc.activeElement;
    const sel = typeof doc.getSelection === 'function' ? doc.getSelection() : null;
    const ranges = [];
    if (sel) for (let i = 0; i < sel.rangeCount; i++) ranges.push(sel.getRangeAt(i));
    const box = doc.createElement('textarea');
    box.value = String(text);
    box.setAttribute('readonly', '');
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText = 'position:fixed;top:0;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none';
    let ok = false;
    try {
        doc.body.appendChild(box);
        box.focus({ preventScroll: true });
        box.select();
        box.setSelectionRange(0, box.value.length);
        ok = doc.execCommand('copy') === true;
    } catch { /* ok stays false */ } finally {
        box.remove();
        try {
            if (sel) {
                sel.removeAllRanges();
                ranges.forEach(r => sel.addRange(r));
            }
            if (before && typeof before.focus === 'function' && doc.activeElement !== before) before.focus({ preventScroll: true });
        } catch { /* restoring focus is best effort */ }
    }
    return ok;
}

/**
 * Copy `text`. Resolves true if it was copied, false if neither way worked; never rejects.
 * @param {string} text
 * @param {{nav?: object, doc?: Document, secure?: boolean}} [env]  for tests
 * @returns {Promise<boolean>}
 */
export function copyText(text, env = {}) {
    const nav = env.nav || globalThis.navigator;
    const doc = env.doc || globalThis.document;
    const secure = env.secure !== undefined ? env.secure : globalThis.isSecureContext !== false;
    if (secure && nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
        let pending;
        try { pending = Promise.resolve(nav.clipboard.writeText(text)); } catch (err) { pending = Promise.reject(err); }
        return pending.then(() => true, () => legacyCopy(text, doc));
    }
    return Promise.resolve(legacyCopy(text, doc));
}

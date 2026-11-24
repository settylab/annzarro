/**
 * The inline name editor of AnnZarro: a text field with a check and a cross, and one set of rules for every way out.
 *
 *   Enter or the check          saves and leaves
 *   Escape or the cross         cancels and leaves (the pop-over's own Escape stands aside: the field is `data-az-own-escape`)
 *   Tab / Shift+Tab             saves, and tells the caller to edit the next / previous item (`onSave(text, +1 | -1)`)
 *   a click elsewhere           saves, once the click has landed
 *   Alt+C                       opens the color picker of the optional swatch
 *
 * A way out happens once. Moving the editor to another row, or redrawing it, blurs the field too, and is NO way out: a
 * click-away is decided a moment after the blur and only if the focus is then outside the editor, so the next item's
 * editor, opened by Tab and focused a tick later, is never closed by the blur of the one before it (0.8.0 bug).
 *
 * The caller owns what saving means (`onSave`) and where the editor sits; this owns the controls and the rules.
 */

/**
 * @param {Object} opts
 * @param {(tag: string, props?: Object, ...kids: any[]) => HTMLElement} opts.el - the DOM helper (D.el)
 * @param {string} [opts.value] - the field's first text
 * @param {{input: string, ok: string, cancel: string}} opts.classes - class names of the three controls
 * @param {{field: string, ok: string, cancel: string, hint: string}} opts.labels - accessible names and the keys hint
 * @param {(text: string, move: number) => void} opts.onSave - the text; `move` is 0, or 1 / -1 after Tab / Shift+Tab
 * @param {() => void} opts.onCancel
 * @param {(text: string) => void} [opts.onInput]
 * @param {HTMLInputElement} [opts.swatch] - a color input shown beside the field; Alt+C and Escape work from the field and it
 * @returns {{input: HTMLInputElement, ok: HTMLElement, cancel: HTMLElement, attach: (container: HTMLElement) => void,
 *   save: () => void, rearm: () => void, isDone: () => boolean}} `attach` watches a container (the editor's box or row) for the click-away;
 *   `save` saves and leaves from outside (a closing pop-over); `rearm` makes an editor that was left (and is reused for another item) ready to be left again
 */
export function inlineRename({ el, value = '', classes, labels, onSave, onCancel, onInput, swatch }) {
    let finished = false;
    const input = el('input', { type: 'text', class: classes.input, value, autocomplete: 'off', spellcheck: 'false',
        title: labels.hint, data: { azOwnEscape: '' }, aria: { label: labels.field, description: labels.hint } });
    const ok = el('button', { type: 'button', class: classes.ok, title: 'Save the name', data: { azOwnEscape: '' }, aria: { label: labels.ok } }, '✓');
    const cancel = el('button', { type: 'button', class: classes.cancel, title: 'Cancel', data: { azOwnEscape: '' }, aria: { label: labels.cancel } }, '✕');

    /** Leave the field once: `keep` saves it, `move` (1 or -1) asks for the next or previous item's editor. */
    function leave(keep, move = 0) {
        if (finished) return;
        finished = true;
        if (keep) onSave(input.value, move); else onCancel();
    }
    const escape = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); leave(false); } };

    input.addEventListener('input', () => { if (onInput) onInput(input.value); });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); leave(true); }
        else if (e.key === 'Tab') { e.preventDefault(); leave(true, e.shiftKey ? -1 : 1); }
        else if (e.altKey && e.key.toLowerCase() === 'c' && swatch) {
            e.preventDefault();
            if (typeof swatch.showPicker === 'function') { try { swatch.showPicker(); } catch { swatch.click(); } } else swatch.click();
        } else escape(e);
    });
    for (const b of [ok, cancel]) {
        b.addEventListener('keydown', escape);
        b.addEventListener('mousedown', (e) => e.preventDefault());       // a press keeps the focus in the field
    }
    if (swatch) {
        swatch.addEventListener('keydown', escape);
        swatch.dataset.azOwnEscape = '';
    }
    ok.addEventListener('click', () => leave(true));
    cancel.addEventListener('click', () => leave(false));

    /**
     * Leaving the field by a click saves it, after the click has landed (a redraw between press and release would take the
     * control pressed from under it): the first of the click, the release or a short timer decides. The decision is made on
     * where the focus is THEN, so a blur caused by moving or redrawing the editor, which takes the focus back at once, is not one.
     */
    function attach(container) {
        container.addEventListener('focusout', (e) => {
            if (finished || (e.relatedTarget && container.contains(e.relatedTarget))) return;
            let done = false;
            const later = () => {
                if (done) return;
                done = true;
                document.removeEventListener('click', later, true);
                document.removeEventListener('pointerup', later, true);
                setTimeout(() => { if (!finished && input.isConnected && !container.contains(document.activeElement)) leave(true); }, 0);
            };
            document.addEventListener('click', later, true);
            document.addEventListener('pointerup', later, true);
            setTimeout(later, 350);
        });
    }

    return { input, ok, cancel, attach, save: () => leave(true), rearm: () => { finished = false; }, isDone: () => finished };
}

/**
 * The two selects a consumer of a score picks in (decision 31): the method, then the layer, each listing every entry.
 * A pair that cannot be computed is a disabled option in the other select, with the reason as its title; the select
 * the user touches wins, and the other moves only when its value became impossible, saying so once.
 *
 * The entries and the rule come from the source (utils/score-source.js scorePairMenus, scorePairAfter); this file only
 * fills and wires the selects, for the add rows that hold a pair of their own until Add (a Cell Table's chooser, a
 * Cell Grouping's Score factor). A plot's axis keeps its pair in its setting (panel-ui-update.js takeSubKey).
 */

/**
 * Fill a select with graded entries, keeping it when they are the same, and choose `value`. The select's own title
 * is the chosen entry's text, then its reason when it has one.
 * @param {HTMLSelectElement} select
 * @param {Array<{value: string, text: string, disabled?: boolean, title?: string, alt?: string}>} entries
 * @param {string|null} value
 */
export function fillChoiceSelect(select, entries, value) {
    const same = select.options.length === entries.length && entries.every((e, i) => {
        const o = select.options[i];
        return o.value === e.value && o.textContent === e.text && o.disabled === !!e.disabled && o.title === (e.title || '')
            && (o.dataset.alt || '') === (e.alt || '');
    });
    if (!same) {
        select.replaceChildren(...entries.map((e) => {
            const o = new Option(e.text, e.value);
            o.disabled = !!e.disabled;
            o.title = e.title || '';
            if (e.alt) o.dataset.alt = e.alt;       // another name the entry is found by (a filter field matches it too)
            return o;
        }));
    }
    if (value !== null && value !== undefined) select.value = value;
    const chosen = select.selectedOptions && select.selectedOptions[0];
    select.title = chosen ? [chosen.textContent, chosen.title].filter(Boolean).join(': ') : '';
}

/**
 * Wire a method select and a layer select that hold a pair until the caller reads it.
 * @param {Object} opts
 * @param {HTMLSelectElement|null} [opts.method] - the method select; null when the caller chooses the method another
 *   way (the aggregation button) and calls `pick('method', value)` itself
 * @param {HTMLSelectElement} opts.layer
 * @param {() => {method: string, layer: string}} opts.start - where the pair starts (and starts again on `reset`)
 * @param {(pair) => {methods: Array, layers: Array}} opts.menus - the graded entries for a pair
 * @param {(changed: 'method'|'layer', value: string, pair) => {method: string, layer: string, say?: string}} opts.after
 * @param {HTMLElement} [opts.note] - where a move of the other select is said
 * @param {() => void} [opts.onPaint] - after every paint (a method button redraws its symbol and its grading here)
 * @returns {{value: () => {method: string, layer: string}, reset: () => void, pick: (changed: 'method'|'layer', value: string) => void}}
 */
export function bindPairSelects({ method = null, layer, start, menus, after, note = null, onPaint = null }) {
    let pair = start();
    const paint = () => {
        const m = menus(pair);
        if (method) fillChoiceSelect(method, m.methods, pair.method);
        fillChoiceSelect(layer, m.layers, pair.layer);
        layer.hidden = !m.layers.length;
        if (onPaint) onPaint();
    };
    const pick = (changed, value) => {
        const p = after(changed, value, pair);
        pair = { method: p.method, layer: p.layer };
        paint();
        if (note) note.textContent = p.say || '';
    };
    if (method) method.addEventListener('change', () => pick('method', method.value));
    layer.addEventListener('change', () => pick('layer', layer.value));
    paint();
    return {
        pick,
        value: () => ({ ...pair }),
        reset() { pair = start(); paint(); if (note) note.textContent = ''; }
    };
}

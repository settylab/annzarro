/**
 * The aggregation button (axis-aggregate-picker-080): a compact button holding the symbol of the aggregation in force,
 * that opens a menu of every aggregation as symbol and name. Used by the axis rows of the Cell and Gene plots, and
 * built to be used wherever a statistic is chosen from a table of methods (the Cell-Gene Plot's): it knows no axis,
 * only the table it is given.
 *
 * `methods()` is asked whenever the menu opens or the button is drawn, so grading that changes (a layer's kind becomes
 * known) shows at once: {options: [{value, name, symbol: {text, over}, disabled?, title?}], chosen}. The menu marks the
 * chosen entry with a check, lists a disabled one greyed with its reason beneath, and takes the arrow keys of a pop-over
 * menu. Choosing an entry calls `onPick(value)`.
 *
 * Optionally a setting that goes with the aggregation (the Cell-Gene Plot's "Expressed above"): `fields()` lists number
 * boxes drawn under the entries, `onField(key, text)` hears a change, and `suffix()` is text after the symbol on the
 * button (">1"), so a value in force never hides behind a closed pop-over. A caller that gives none gets what it had.
 *
 * Also optional: an entry may carry `heading` (drawn above it when it differs from the entry before: a one-row section's
 * "Combine the gene rows" and "Score each cell"), and `pressed()` marks the button as set away from its default (accent
 * fill, `aria-pressed`).
 */
import { createPopover } from './popover.js';
import { symbolSpan } from '../utils/aggregation-symbols.js';

/** A number box under the entries: its label, the box, a change or Enter hands the text on. */
function fieldRow(f, onField) {
    const row = document.createElement('div');
    row.className = 'az-pop-field axis-agg-field';
    const name = document.createElement('span');
    name.className = 'az-pop-field__label';
    name.textContent = f.label;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.min = '0';
    input.className = 'form-control form-control-sm az-pop-num';
    input.dataset.field = f.key;
    input.value = f.value;
    input.placeholder = f.placeholder || '';
    input.title = f.title || '';
    input.setAttribute('aria-label', f.label);
    // the pop-over is a menu: the arrow keys inside a box belong to the box, and Escape first ends an edit
    input.dataset.azOwnEscape = '';
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); if (onField) onField(f.key, input.value); }
        else if (e.key === 'Escape') { input.value = f.value; input.blur(); }       // ends the edit; the next Escape closes the menu
        else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) e.stopPropagation();
    });
    input.addEventListener('change', () => { if (onField) onField(f.key, input.value); });
    row.append(name, input);
    return row;
}

/**
 * @param {Object} options
 * @param {string|(() => string)} options.label - what is chosen: "Aggregation" (a function when a set's name is in it)
 * @param {string} [options.axis] - copied to `data-axis` (a test hook)
 * @param {() => ({options: Array<Object>, chosen: string}|null)} options.methods
 * @param {(value: string) => void} options.onPick
 * @param {() => Array<{key: string, label: string, value: string, placeholder?: string, title?: string}>} [options.fields]
 * @param {(key: string, text: string) => void} [options.onField]
 * @param {() => string} [options.suffix]
 * @param {() => boolean} [options.pressed]
 * @returns {{button: HTMLButtonElement, update: () => void, destroy: () => void}}
 */
export function createAggregationButton({ label, axis = '', methods, onPick, fields = null, onField = null, suffix = null, pressed = null }) {
    // a label may be a function: a set's name in it can change while the button stays
    const nameOf = () => (typeof label === 'function' ? label() : label);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-sm btn-outline-secondary axis-agg-btn';
    button.dataset.axis = axis;
    const popover = createPopover({
        anchor: button, name: 'aggregation', title: nameOf(), menu: true,
        render: (body) => {
            const held = methods();
            if (!held) return;
            let heading = null;
            for (const o of held.options) {
                if (o.heading && o.heading !== heading) {
                    heading = o.heading;
                    const title = document.createElement('div');
                    title.className = 'az-pop-section__title axis-agg-heading';
                    title.setAttribute('role', 'presentation');
                    title.textContent = heading;
                    body.append(title);
                }
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'axis-agg-item';
                item.setAttribute('role', 'menuitem');
                item.setAttribute('aria-checked', String(o.value === held.chosen));
                item.dataset.agg = o.value;
                item.disabled = !!o.disabled;
                item.title = o.title || '';
                const name = document.createElement('span');
                name.className = 'axis-agg-name';
                name.textContent = o.name;
                item.append(symbolSpan(o.symbol), name);
                if (o.disabled && o.title) {
                    const why = document.createElement('span');
                    why.className = 'axis-agg-why';
                    why.textContent = o.title;
                    item.append(why);
                }
                item.addEventListener('click', () => onPick(o.value));
                body.append(item);
            }
            for (const f of fields ? fields() : []) body.append(fieldRow(f, onField));
        }
    });
    function update() {
        const held = methods();
        const chosen = held && held.options.find((o) => o.value === held.chosen);
        const extra = suffix ? suffix() : '';
        button.replaceChildren(...(chosen ? [symbolSpan(chosen.symbol, 'axis-agg-sym axis-agg-sym--button')] : []));
        if (chosen && extra) {
            const tail = document.createElement('span');
            tail.className = 'axis-agg-suffix';
            tail.textContent = extra;
            button.append(tail);
        }
        const text = chosen ? `${nameOf()}: ${chosen.name}${extra ? ` ${extra}` : ''}` : nameOf();
        if (pressed) {
            const on = !!pressed();
            button.classList.toggle('active', on);
            button.setAttribute('aria-pressed', String(on));
        }
        button.title = text;
        button.setAttribute('aria-label', text);
    }
    update();
    return { button, update, destroy() { popover.destroy(); button.remove(); } };
}

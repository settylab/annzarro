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
 */
import { createPopover } from './popover.js';
import { symbolSpan } from '../utils/aggregation-symbols.js';

/**
 * @param {Object} options
 * @param {string} options.label - what is chosen: "Aggregation"
 * @param {string} [options.axis] - copied to `data-axis` (a test hook)
 * @param {() => ({options: Array<Object>, chosen: string}|null)} options.methods
 * @param {(value: string) => void} options.onPick
 * @returns {{button: HTMLButtonElement, update: () => void, destroy: () => void}}
 */
export function createAggregationButton({ label, axis = '', methods, onPick }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-sm btn-outline-secondary axis-agg-btn';
    button.dataset.axis = axis;
    const popover = createPopover({
        anchor: button, name: 'aggregation', title: label, menu: true,
        render: (body) => {
            const held = methods();
            if (!held) return;
            for (const o of held.options) {
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
        }
    });
    function update() {
        const held = methods();
        const chosen = held && held.options.find((o) => o.value === held.chosen);
        button.replaceChildren(...(chosen ? [symbolSpan(chosen.symbol, 'axis-agg-sym axis-agg-sym--button')] : []));
        const text = chosen ? `${label}: ${chosen.name}` : label;
        button.title = text;
        button.setAttribute('aria-label', text);
    }
    update();
    return { button, update, destroy() { popover.destroy(); button.remove(); } };
}

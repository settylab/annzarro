/**
 * Methods ▾ of a source of cells: a Cell Grouping and a Cell Table (decision 34, offered-removal-080.md 10.2). The source
 * sets the parameters of each statistic over its cells, for every layer; plots choose the statistic and the layer, and
 * nothing is gated. It mirrors the Methods ▾ of a Gene Signature and a Gene Table (section 3).
 *
 *   Methods ▾
 *   Statistics over a group's cells. Plots choose the statistic and the layer; these settings apply on every layer.
 *   Mean                       Average over the group's cells, zeros included.
 *   % expressing               Share of the group's cells above the threshold, 0 to 100.
 *   Mean of expressing cells   Average over the cells above the threshold.
 *     Expressed above [ 0 ]    Used by % expressing and mean of expressing cells. Now: above 0.
 *   Sum                        Total over the group's cells (pseudobulk).
 *   SD                         Spread over the group's cells.
 *   Used by: Cell-Gene Plot 1 (% expressing · counts)
 *                                                    [Reset to defaults]
 *
 * The statistics and their parameters are the tables of utils/group-statistics.js (STATISTIC_INFO, METHOD_PARAMS), so
 * a parameter added there is listed here. The surface is the pop-over primitive (ui/popover.js): Escape and a click
 * outside close it, and opening it moves no box of the panel. The button carries a dot while a parameter is not at its
 * default, and its title says which, so no setting hides behind the closed pop-over.
 *
 * A number is checked on Enter or on leaving the box: an invalid one keeps the last valid value and says what is
 * expected. Nothing here computes: `apply` makes the edit (one undo step of a grouping) and the readers follow.
 */
import { createPopover } from '../../ui/popover.js';
import { parseThresholdText, figure } from '../../utils/options-model.js';
import { buttonNote } from '../../utils/options-model.js';
import { STATISTIC_INFO, METHOD_PARAMS, METHODS_TEXT, methodsSummary } from '../../utils/group-statistics.js';

/**
 * @param {Object} o
 * @param {{el: Function, clear: Function}} o.D - the DOM builder (panels/gene-set-utilities/dom.js)
 * @param {string} o.id - the panel's id, for unique element ids
 * @param {string} [o.intro] - the first sentence (a table speaks of its cells, a grouping of a group's)
 * @param {(m: Object) => string} [o.definitionOf] - a statistic's definition (a table speaks of the table's cells)
 * @param {() => Object} o.getFields - the method fields now (a grouping's recipe, a table's `methods`)
 * @param {(patch: Object, label: string) => void} o.apply - set the fields of `patch` (undefined: back to the default)
 * @param {() => string[]} [o.usedBy] - one line per reader: "Cell-Gene Plot 1 (% expressing · counts)"
 * @returns {{element: HTMLElement, paint: () => void, reveal: () => void, isOpen: () => boolean, destroy: () => void}}
 */
export function createCellMethods({ D, id, intro = METHODS_TEXT.intro, definitionOf = (m) => m.definition, getFields, apply, usedBy = () => [] }) {
    const { el } = D;
    const sid = (x) => `cmeth-${x}-${id}`;

    const labelSpan = el('span', { text: METHODS_TEXT.label });
    const caret = el('span', { class: 'cmeth__caret', aria: { hidden: 'true' }, text: '▾' });
    const button = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary cmeth__toggle', id: sid('toggle'), data: { methods: '' } },
        labelSpan, ' ', caret);

    // ------------------------------------------------------------ the parameter boxes

    const boxes = new Map();
    function paramBlock(param) {
        const input = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false',
            class: 'form-control form-control-sm az-pop-num cmeth__number', id: sid(param.key), data: { param: param.key },
            aria: { label: param.name, describedby: `${sid(`${param.key}-help`)} ${sid(`${param.key}-error`)}` } });
        const help = el('small', { class: 'cmeth__help az-pop-help', id: sid(`${param.key}-help`), data: { paramHelp: param.key } });
        const error = el('div', { class: 'cmeth__error az-pop-error', id: sid(`${param.key}-error`), role: 'alert' });
        const read = () => {
            const v = getFields()[param.key];
            return typeof v === 'number' && Number.isFinite(v) ? v : param.default;
        };
        function commit() {
            const p = parseThresholdText(input.value);
            if (!p.ok) {
                error.textContent = p.error;
                input.value = String(read());
                return;
            }
            error.textContent = '';
            if (p.value === read()) { input.value = String(p.value); return; }
            apply({ [param.key]: p.value === param.default ? undefined : p.value }, `${param.label.toLowerCase()} ${figure(p.value)}`);
        }
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
        input.addEventListener('change', commit);
        boxes.set(param.key, { input, help, error, read, param });
        return el('div', { class: 'cmeth__param az-pop-field', data: { paramRow: param.key } },
            el('label', { class: 'cmeth__param-label az-pop-field__label', for: sid(param.key), text: param.label }),
            el('span', { class: 'az-pop-field__control' }, input), help, error);
    }

    // ------------------------------------------------------------ the body

    const list = el('div', { class: 'cmeth__list' });
    for (const m of STATISTIC_INFO) {
        const params = METHOD_PARAMS.filter((p) => p.after === m.value).map(paramBlock);
        list.append(el('details', { class: 'az-pop-section cmeth__stat', open: true },
            el('summary', { class: 'az-pop-section__title' }, el('span', { class: 'cmeth__name', data: { method: m.value }, text: m.label })),
            el('div', { class: 'az-pop-section__body' }, el('small', { class: 'cmeth__definition az-pop-help', text: definitionOf(m) }), ...params)));
    }
    const used = el('div', { class: 'cmeth__used az-pop-help', data: { usedBy: '' } });
    const reset = el('button', { type: 'button', class: 'btn btn-sm btn-link az-pop-reset cmeth__reset', on: { click: resetAll } }, METHODS_TEXT.reset);
    const body = el('div', { class: 'az-pop-options cmeth', id: sid('body') },
        el('p', { class: 'az-pop-intro cmeth__intro', text: intro }), list,
        el('div', { class: 'az-pop-section__foot cmeth__foot' }, used, reset));

    function resetAll() {
        const patch = {};
        for (const { param, read } of boxes.values()) if (read() !== param.default) patch[param.key] = undefined;
        if (Object.keys(patch).length) apply(patch, 'reset methods');
    }

    const pop = createPopover({ anchor: button, name: 'methods', title: METHODS_TEXT.title, wide: true,
        render: (host) => { host.append(body); paint(); return () => body.remove(); } });

    // ------------------------------------------------------------ paint

    function paint() {
        const fields = getFields() || {};
        let changed = false;
        for (const { input, help, read, param } of boxes.values()) {
            if (input.ownerDocument.activeElement !== input) input.value = String(read());
            help.textContent = param.line(fields);
            if (read() !== param.default) changed = true;
        }
        const summary = methodsSummary(fields);
        const said = buttonNote(summary ? [summary] : []);
        // the note is absent at the default, not hidden
        button.replaceChildren(...(said ? [labelSpan, ' ', el('span', { class: 'az-btn-note', text: `· ${said}` }), ' ', caret]
            : [labelSpan, ' ', caret]));
        button.title = summary ? `${METHODS_TEXT.plainTitle}: ${summary}` : METHODS_TEXT.plainTitle;
        reset.disabled = !changed;
        const lines = usedBy();
        used.textContent = lines.length ? `Used by: ${lines.join('; ')}` : METHODS_TEXT.notUsed;
    }

    paint();
    return {
        element: button,
        paint,
        /** Open the pop-over (its anchor must be shown). */
        reveal: () => { if (!pop.isOpen()) pop.open(); },
        isOpen: () => pop.isOpen(),
        destroy: () => pop.destroy()
    };
}

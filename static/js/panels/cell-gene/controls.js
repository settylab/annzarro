/**
 * The Cell-Gene Plot's controls (0.8.0 step X3a; UX 3.1, 3.2 and 7; CXG-2, CXG-11).
 *
 * - THE CHOICES (pure, Node-tested): what the Groups selects list (categorical obs columns; groupings, with the ones
 *   that would close a loop unavailable and why, decision 15), the cell axis as the page's group sources name it, and
 *   what the Color and Size selects list (the statistics the grouping offers on the layers it offers, graded on what
 *   each layer holds, and Cell count; a held choice no longer offered stays, marked, SHR-26).
 * - THE CONTROL GRID (`createControls`): What (Groups, Mode), Values (Color, Scale, Size), Layout (Swap axes). The
 *   section list of UX 3.2 sits in the What group (`createSectionList`). Toggle Controls hides the grid
 *   (`data-panel-controls`).
 *
 * Cluster ▾ and Plot Options are X5's (panels/cell-gene/options.js): `createControls` leaves `layoutSlot`, the end of
 * the Layout group, for them.
 */
import { VOCABULARY } from '../../utils/vocabulary.js';
import { normalizeGrouping } from '../../utils/cell-grouping.js';
import { GROUP_STATISTICS_MODEL, ALWAYS_OFFERED, STATISTIC_INFO } from '../../utils/group-statistics.js';
import { SCALINGS } from '../../utils/cell-gene-model.js';
import { loopReason } from '../../utils/panel-references.js';
import { GROUP_AXIS, OFFER_OTHER, aggregationEntries, aggregationValue, aggregationHelp } from './sections.js';

const CG = VOCABULARY.cellGene;

/** "New grouping…" in the Groups key list. */
const NEW_GROUPING = '__new_grouping__';
const NUMERIC = /^(u?int|float)\d*$/;

// ================================================================================================ the choices

/** The obs columns a cell axis can be: categorical ones (CXG-2), never the index. */
function categoricalColumns(structure) {
    const obs = (structure && structure.obs) || {};
    const index = obs.index || '_index';
    const info = obs.columns_info || {};
    return (obs.columns || []).filter((c) => c !== '_index' && c !== index && !NUMERIC.test(String((info[c] || {}).type || '')));
}

/**
 * What the Groups key select lists: the categorical obs columns, and the groupings, each unavailable with its reason
 * when choosing it would close a loop (operator decision 15).
 * @param {{structure: Object, self: string, groupings: Array<{id: string, title: string}>, loops: (self: string, id: string) => boolean}} opts
 * @returns {{obs: string[], groupings: Array<{id: string, title: string, disabled: boolean, reason: (string|null)}>}}
 */
export function axisChoices({ structure, self, groupings, loops }) {
    return {
        obs: categoricalColumns(structure),
        groupings: groupings.map((g) => {
            const disabled = !!loops(self, g.id);
            return { id: g.id, title: g.title, disabled, reason: disabled ? loopReason(g.title, 'plot') : null };
        })
    };
}

/**
 * The id the page's group sources know the cell axis by: a grouping's own id, or the plot's own axis (`prefix` is
 * utils/group-host.js AXIS_PREFIX); null when none.
 */
export function axisSourceId(panelId, axis, prefix) {
    if (!axis || !axis.key) return null;
    return axis.type === 'obs' ? `${prefix}${panelId}` : axis.key;
}

const _axisRecipes = new Map();
/**
 * An obs column as a grouping of one factor with no panel (CXG-2): the same object while the column is the same, so
 * the group sources normalise it once.
 */
export function axisRecipe(axis) {
    const key = axis && axis.type === 'obs' ? axis.key : '';
    if (!_axisRecipes.has(key)) {
        _axisRecipes.set(key, normalizeGrouping(key ? { partitionings: [{ source: { type: 'obs', key } }] } : {}).recipe);
    }
    return _axisRecipes.get(key);
}

const menuOf = (stat) => (STATISTIC_INFO.find((m) => m.value === stat) || { menu: stat }).menu;

/** The value of a statistic choice in a select: `stat@layer`, or `count`. */
export function statisticValue(spec) {
    return spec.stat === ALWAYS_OFFERED ? ALWAYS_OFFERED : `${spec.stat}@${spec.layer}`;
}

/** What a Color or Size value stands for. */
export function parseStatistic(value) {
    if (value === ALWAYS_OFFERED) return { stat: ALWAYS_OFFERED };
    const at = String(value).lastIndexOf('@');
    return { stat: value.slice(0, at), layer: value.slice(at + 1) };
}

/**
 * What the Color and Size selects list (CXG-11, SHR-26, SHR-27): the statistics the grouping offers on the layers it
 * offers and the dataset has, those a layer cannot give left out, then Cell count. With an obs column as the cell
 * axis, the defaults of SHR-26. A held choice that is no longer offered, or that its layer cannot give, stays listed
 * and marked, so the select shows what is drawn.
 * @param {{recipe: (Object|null), layers: string[], kinds: Object<string, string>, held: Object}} opts
 * @returns {Array<{value: string, label: string, title?: string, lapsed?: boolean}>}
 */
export function statisticChoices({ recipe, layers, kinds, held }) {
    const r = recipe || normalizeGrouping({}).recipe;
    const graded = GROUP_STATISTICS_MODEL.gradedOptions(r, layers, kinds);
    const out = graded.filter((o) => o.grade !== 'cannot')
        .map((o) => ({ value: `${o.method}@${o.layer}`, label: o.label, ...(o.note ? { title: o.note } : {}) }));
    if (held && held.stat !== ALWAYS_OFFERED && !out.some((o) => o.value === statisticValue(held))) {
        const cannot = graded.find((o) => o.method === held.stat && o.layer === held.layer);
        out.push(cannot
            ? { value: statisticValue(held), label: `${cannot.fullLabel} (not available)`, title: cannot.reason, lapsed: true }
            : { value: statisticValue(held), label: `${menuOf(held.stat)} · ${held.layer} (no longer offered)`, lapsed: true });
    }
    out.push({ value: ALWAYS_OFFERED, label: CG.statistic.count });
    return out;
}

// ================================================================================================ the control grid

function options(D, select, list) {
    D.clear(select);
    for (const o of list) {
        const opt = D.el('option', { value: o.value, text: o.label, title: o.title || undefined });
        if (o.disabled) opt.disabled = true;
        select.appendChild(opt);
    }
}

/**
 * The control grid of UX 3.1.
 * @param {Object} opts
 * @param {Object} opts.D - the DOM builder (gene-set-utilities/dom.js)
 * @param {string} opts.id - the panel id (unique names)
 * @param {() => Object} opts.model - {axis, choices: {obs, groupings}, mode, color: {value, list}, size: {value, list},
 *   scale, swap}
 * @param {Object} opts.on - axis(axis), newGrouping(), mode(mode), color(value), size(value), scale(value), swap(on)
 * @param {HTMLElement} opts.sections - the section list's element, in the What group
 * @param {HTMLElement} opts.addGenes - Add genes, in the What group
 */
export function createControls({ D, id, model, on, sections, addGenes }) {
    const { el } = D;
    const field = (label, control, cls) => el('label', { class: `cgene-field ${cls || ''}` }, el('span', { class: 'cgene-field__label', text: label }), control);
    let typeShown = null;          // the type select's value while no key of it is chosen yet

    const axisType = el('select', { class: 'form-select form-select-sm cgene-axis-type', aria: { label: 'Groups: source type' },
        on: { change: () => { typeShown = axisType.value; paintKeys(); } } });
    options(D, axisType, [{ value: 'obs', label: 'obs' }, { value: GROUP_AXIS, label: GROUP_AXIS }]);
    const axisKey = el('select', { class: 'form-select form-select-sm cgene-axis-key', aria: { label: `Groups: column or ${VOCABULARY.word.grouping}` },
        on: { change: onKey } });

    const modeName = `cgene-mode-${id}`;
    const radio = (value, label) => el('label', { class: 'cgene-radio' },
        el('input', { type: 'radio', name: modeName, value, on: { change: (e) => { if (e.target.checked) on.mode(value); } } }), ` ${label}`);
    const mode = el('div', { class: 'cgene-mode', role: 'radiogroup', aria: { label: 'Mode' } }, radio('dots', 'Dots'), radio('heatmap', 'Heatmap'));

    const color = el('select', { class: 'form-select form-select-sm cgene-color', aria: { label: 'Color' }, on: { change: () => on.color(color.value) } });
    const scaleSel = el('select', { class: 'form-select form-select-sm cgene-scale', aria: { label: 'Scale' }, on: { change: () => on.scale(scaleSel.value) } });
    options(D, scaleSel, SCALINGS.map((s) => ({ value: s, label: CG.scaling[s] })));
    const size = el('select', { class: 'form-select form-select-sm cgene-size', aria: { label: 'Size' }, on: { change: () => on.size(size.value) } });
    const sizeField = field('Size', size, 'cgene-field--size');
    const swap = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary cgene-swap', aria: { pressed: 'false' },
        on: { click: () => on.swap(swap.getAttribute('aria-pressed') !== 'true') } }, 'Swap axes');
    const layoutSlot = el('div', { class: 'cgene-layout-slot' });

    const what = el('div', { class: 'cgene-group cgene-group--what', role: 'group', aria: { label: 'What' } },
        el('div', { class: 'cgene-row' }, field('Groups', el('span', { class: 'cgene-axis' }, axisType, axisKey)), field('Mode', mode)),
        el('div', { class: 'cgene-genes' }, el('div', { class: 'cgene-genes__head' }, el('span', { class: 'cgene-field__label', text: 'Genes' }), addGenes), sections));
    const values = el('div', { class: 'cgene-group cgene-group--values', role: 'group', aria: { label: 'Values' } },
        field('Color', color), field('Scale', scaleSel), sizeField);
    const layout = el('div', { class: 'cgene-group cgene-group--layout', role: 'group', aria: { label: 'Layout' } }, swap, layoutSlot);
    const element = el('div', { class: 'cgene-controls', 'data-panel-controls': '' }, what, values, layout);

    function onKey() {
        const v = axisKey.value;
        if (!v) return;
        if (v === NEW_GROUPING) { on.newGrouping(); return; }
        typeShown = null;
        on.axis({ type: axisType.value, key: v });
    }

    function paintKeys() {
        const m = model();
        const type = typeShown || (m.axis ? m.axis.type : 'obs');
        axisType.value = type;
        D.clear(axisKey);
        const chosen = m.axis && m.axis.type === type ? m.axis.key : '';
        if (!chosen) axisKey.appendChild(el('option', { value: '', text: 'Choose…' }));
        if (type === 'obs') {
            for (const c of m.choices.obs) axisKey.appendChild(el('option', { value: c, text: c }));
        } else {
            for (const g of m.choices.groupings) {
                const o = el('option', { value: g.id, text: g.title, title: g.reason || undefined });
                if (g.disabled) o.disabled = true;
                axisKey.appendChild(o);
            }
            axisKey.appendChild(el('option', { value: NEW_GROUPING, text: 'New grouping…' }));
        }
        if (chosen && ![...axisKey.options].some((o) => o.value === chosen)) {
            axisKey.insertBefore(el('option', { value: chosen, text: `${chosen} (not in this dataset)` }), axisKey.firstChild);
        }
        axisKey.value = chosen;
    }

    function paint() {
        const m = model();
        paintKeys();
        for (const input of mode.querySelectorAll('input')) input.checked = input.value === m.mode;
        options(D, color, m.color.list);
        color.value = m.color.value;
        options(D, size, m.size.list);
        size.value = m.size.value;
        sizeField.hidden = m.mode !== 'dots';
        scaleSel.value = m.scale;
        swap.setAttribute('aria-pressed', m.swap ? 'true' : 'false');
        swap.classList.toggle('active', !!m.swap);
    }

    return { element, layoutSlot, paint };
}

// ================================================================================================ the section list

/**
 * Add genes ▾ (UX 3.2): the signatures and gene tables under their headings, then New signature….
 * @param {{D: Object, id: string, sources: () => Array<{heading: string, items: Array<{id: string, title: string}>}>,
 *   on: {add: (id: string) => void, newSignature: () => void}}} opts
 */
export function createAddGenes({ D, id, sources, on }) {
    const { el } = D;
    let open = false;
    const button = el('button', { type: 'button', class: 'btn btn-sm btn-outline-primary cgene-add',
        aria: { haspopup: 'menu', expanded: 'false', controls: `cgene-add-menu-${id}` }, on: { click: () => toggle() } }, 'Add genes ▾');
    const menu = el('div', { class: 'cgene-add-menu', id: `cgene-add-menu-${id}`, role: 'menu', hidden: true, on: { keydown: onMenuKey } });
    const element = el('div', { class: 'cgene-add-wrap' }, button, menu);

    function item(text, run) {
        return el('button', { type: 'button', role: 'menuitem', class: 'cgene-add-item', on: { click: () => { close(); run(); } } }, text);
    }

    function paint() {
        D.clear(menu);
        for (const group of sources()) {
            if (!group.items.length) continue;
            menu.appendChild(el('div', { role: 'group', class: 'cgene-add-group', aria: { label: group.heading } },
                el('div', { class: 'cgene-add-heading', aria: { hidden: 'true' }, text: group.heading }),
                group.items.map((s) => item(s.title, () => on.add(s.id)))));
        }
        menu.appendChild(item('New signature…', () => on.newSignature()));
        menu.hidden = !open;
        button.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function toggle() {
        open = !open;
        paint();
        if (open) { const first = menu.querySelector('[role="menuitem"]'); if (first) first.focus(); }
    }

    function close() {
        if (!open) return;
        open = false;
        paint();
    }

    function onMenuKey(e) {
        const items = [...menu.querySelectorAll('[role="menuitem"]')];
        const i = items.indexOf(document.activeElement);
        if (e.key === 'Escape') { close(); button.focus(); e.preventDefault(); e.stopPropagation(); }
        else if (e.key === 'ArrowDown') { (items[(i + 1) % items.length] || button).focus(); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { (items[(i - 1 + items.length) % items.length] || button).focus(); e.preventDefault(); }
        else if (e.key === 'Tab') close();
    }

    return { element, close, paint };
}

const SECTION_OPS = Object.freeze([
    { op: 'duplicate', label: 'Duplicate' },
    { op: 'remove', label: 'Remove' },
    { op: 'open', label: 'Open source' },
    { op: 'up', label: 'Move up' },
    { op: 'down', label: 'Move down' }
]);

/**
 * The section list of UX 3.2: one row per section with its title (edited in place), its source when the title is its
 * own, its gene count, Genes / One row and ⋯; a one-row section's Color and Size selects with their help lines and
 * threshold boxes. Reordered by ⋯, by Alt+Up and Alt+Down on the focused row, and by drag (UX 7).
 * @param {Object} opts
 * @param {Object} opts.D
 * @param {string} opts.id
 * @param {() => {sections: Object[], dots: boolean}} opts.model - each section: {title, source (shown when it differs),
 *   line, note, rows, color: {held, options, lapsedLabel, layer}, size: {...}}
 * @param {Object} opts.on - rows(i, rows), title(i, text), op(i, op), move(from, to), aggregation(i, which, value),
 *   above(i, which, text)
 */
export function createSectionList({ D, id, model, on }) {
    const { el } = D;
    const list = el('ul', { class: 'cgene-sections', role: 'list', aria: { label: 'Gene sections' } });
    let menuAt = null;
    let drawnKey = null;
    let dragFrom = null;

    function aggregationBlock(i, which, part) {
        const held = part.held;
        const select = el('select', { class: 'form-select form-select-sm cgene-section__agg', data: { which },
            aria: { label: `${which === 'color' ? 'Color' : 'Size'} of the row` },
            on: { change: () => {
                const value = select.value;
                // Offer other scores… opens the source and changes nothing here: the select shows what is drawn
                if (value === OFFER_OTHER) select.value = aggregationValue(held);
                on.aggregation(i, which, value);
            } } });
        for (const group of aggregationEntries({ held, options: part.options, lapsedLabel: part.lapsedLabel })) {
            select.appendChild(el('optgroup', { label: group.heading },
                group.entries.map((e) => el('option', { value: e.value, text: e.label, class: e.lapsed ? 'cgene-lapsed' : undefined }))));
        }
        select.value = aggregationValue(held);
        const thresholded = held.agg === 'score_pct_above';
        const above = el('input', { type: 'number', step: 'any', class: 'form-control form-control-sm cgene-section__above', data: { which },
            aria: { label: 'Threshold' }, hidden: !thresholded, value: thresholded ? String(held.above || 0) : '0',
            on: { change: () => on.above(i, which, above.value), keydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); on.above(i, which, above.value); } } } });
        const help = el('div', { class: 'cgene-section__help', data: { which }, text: aggregationHelp(held, part.layer) });
        return el('div', { class: 'cgene-section__value', data: { which } },
            el('span', { class: 'cgene-field__label', text: which === 'color' ? 'Color' : 'Size' }), select, above, help);
    }

    function rowsGroup(i, rows) {
        const name = `cgene-rows-${id}-${i}`;
        const radio = (value, label) => el('label', { class: 'cgene-radio' },
            el('input', { type: 'radio', name, value, checked: rows === value, on: { change: (e) => { if (e.target.checked) on.rows(i, value); } } }), ` ${label}`);
        return el('div', { class: 'cgene-section__rows', role: 'radiogroup', aria: { label: 'Show as' } }, radio('genes', 'Genes'), radio('set', 'One row'));
    }

    function sectionMenu(i, n) {
        const menu = el('div', { class: 'cgene-section__menu', role: 'menu', hidden: menuAt !== i });
        for (const { op, label } of SECTION_OPS) {
            const disabled = (op === 'up' && i === 0) || (op === 'down' && i === n - 1);
            menu.appendChild(el('button', { type: 'button', role: 'menuitem', class: 'cgene-section__menu-item', data: { op }, disabled,
                on: { click: () => { menuAt = null; on.op(i, op); repaint(); } } }, label));
        }
        return menu;
    }

    function commitTitle(i, input) {
        if (input.value !== input.defaultValue) on.title(i, input.value);
    }

    function row(s, i, n) {
        const title = el('input', { type: 'text', class: 'form-control form-control-sm cgene-section__title', value: s.title, aria: { label: 'Section title' },
            on: { keydown: (e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitTitle(i, title); }
                else if (e.key === 'Escape') { title.value = title.defaultValue; title.blur(); }
            }, blur: () => commitTitle(i, title) } });
        title.defaultValue = s.title;
        const menuBtn = el('button', { type: 'button', class: 'btn btn-sm btn-link cgene-section__menu-btn', aria: { haspopup: 'menu', label: `More for ${s.title}` },
            on: { click: (e) => { e.stopPropagation(); menuAt = menuAt === i ? null : i; repaint(); } } }, '⋯');
        const head = el('div', { class: 'cgene-section__head' },
            el('span', { class: 'cgene-section__grip', aria: { hidden: 'true' }, text: '≡' }), title,
            s.source ? el('span', { class: 'cgene-section__source', text: s.source }) : null,
            el('span', { class: 'cgene-section__count', text: s.line }),
            rowsGroup(i, s.rows), el('span', { class: 'cgene-section__more' }, menuBtn, sectionMenu(i, n)));
        const li = el('li', { class: 'cgene-section', tabindex: '0', draggable: 'true', data: { index: i }, aria: { label: s.title } }, head,
            s.note ? el('div', { class: 'cgene-section__note', role: 'note', text: s.note }) : null,
            s.rows === 'set' ? el('div', { class: 'cgene-section__values' }, aggregationBlock(i, 'color', s.color),
                s.size ? aggregationBlock(i, 'size', s.size) : null) : null);
        li.addEventListener('keydown', (e) => {
            if (e.target !== li || !e.altKey) return;
            if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); on.move(i, i - 1); }
            else if (e.key === 'ArrowDown' && i < n - 1) { e.preventDefault(); on.move(i, i + 1); }
        });
        li.addEventListener('dragstart', (e) => { dragFrom = i; if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; });
        li.addEventListener('dragover', (e) => { if (dragFrom !== null) e.preventDefault(); });
        li.addEventListener('drop', (e) => { e.preventDefault(); if (dragFrom !== null && dragFrom !== i) on.move(dragFrom, i); dragFrom = null; });
        return li;
    }

    /** Draw the list again, keeping the focus on the same control of the same section. */
    function repaint() {
        const m = model();
        const active = document.activeElement;
        const at = active && list.contains(active) ? active.closest('.cgene-section') : null;
        const focus = at ? { index: at.dataset.index, cls: active === at ? null : active.className.split(' ').find((c) => c.startsWith('cgene-section__')),
            which: active.dataset ? active.dataset.which : undefined } : null;
        D.clear(list);
        m.sections.forEach((s, i) => list.appendChild(row(s, i, m.sections.length)));
        if (!focus) return;
        const li = list.querySelector(`.cgene-section[data-index="${focus.index}"]`);
        if (!li) return;
        const target = focus.cls ? li.querySelector(`.${focus.cls}${focus.which ? `[data-which="${focus.which}"]` : ''}`) : li;
        if (target) target.focus();
    }

    /** Paint when what the list shows changed (never per frame). */
    function paint() {
        const key = JSON.stringify(model(), (k, v) => (typeof v === 'function' ? undefined : v));
        if (key === drawnKey) return;
        drawnKey = `${key}${menuAt}`;
        repaint();
        drawnKey = key;
    }

    /** The ⋯ menu closes on a click elsewhere. */
    function closeMenus() {
        if (menuAt === null) return;
        menuAt = null;
        repaint();
    }

    /** Focus a section (after a move, Alt+Up keeps it under the cursor). */
    function focus(i) {
        const li = list.querySelector(`.cgene-section[data-index="${i}"]`);
        if (li) li.focus();
    }

    return { element: list, paint, closeMenus, focus };
}

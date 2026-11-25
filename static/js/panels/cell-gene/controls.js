/**
 * The Cell-Gene Plot's controls (0.8.0 step X3a; UX 3.1, 3.2 and 7; CXG-2, CXG-11).
 *
 * - THE CHOICES (pure, Node-tested): what the Groups selects list (categorical obs columns; groupings, with the ones
 *   that would close a loop unavailable and why, decision 15), the cell axis as the page's group sources name it, and
 *   what Color and Size each list (WP-4, decision 31): a statistic select (all five statistics, graded on the layer the
 *   measure reads, and Cell count) and a layer select (all the dataset's layers, graded for the statistic), on a
 *   grouping axis or an obs one alike; a pair a layer cannot give is disabled with its reason, and a held
 *   one stays, marked "(not available)" (SHR-27). These are utils/group-statistics.js `statisticChoices` and
 *   `statisticLayerChoices` with the Cell-Gene Plot's words.
 * - THE CONTROL GRID (`createControls`): What (Groups, Mode), Values (Color, Scale, Size, each `statistic of layer
 *   above threshold`); Swap axes, returned as `swap`, is a button of the shared plot toolbar. The
 *   section list of UX 3.2 sits in the What group (`createSectionList`). Toggle Controls hides the grid
 *   (`data-panel-controls`).
 *
 * Cluster ▾ and Plot Options are X5's (panels/cell-gene/options.js), on the shared plot toolbar; `createControls`
 * leaves `layoutSlot`, at the end of the grid, for a panel with no toolbar.
 */
import { VOCABULARY } from '../../utils/vocabulary.js';
import { normalizeGrouping } from '../../utils/cell-grouping.js';
import { CELL_COUNT, STATISTIC_INFO, statisticChoices, statisticLayerChoices, statisticPairAfter } from '../../utils/group-statistics.js';
import { SCALINGS, MODE_INFO, modeShowsChannel, scalingGrade } from '../../utils/cell-gene-model.js';
import { loopReason } from '../../utils/panel-references.js';
import { createPopover } from '../../ui/popover.js';
import { createAggregationButton } from '../../ui/aggregation-button.js';
import { MEASURE_SYMBOLS } from '../../utils/aggregation-symbols.js';
import { GROUP_AXIS, SAME_AS_COLOR, needsThreshold } from './sections.js';

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

const infoOf = (stat) => STATISTIC_INFO.find((m) => m.value === stat) || null;
const nameOf = (stat) => (stat === CELL_COUNT ? CG.statistic.count : (infoOf(stat) || { label: stat }).label);
const DEFAULT_LAYER = 'X';

/** An entry of SO-1's graded lists as a select's option: the Cell-Gene Plot's own name, the reason as the title. */
function asOption(e, name) {
    const mark = e.lapsed ? / \((not available|not in this dataset)\)$/.exec(e.label) : null;
    const out = { value: e.value, label: mark ? `${name}${mark[0]}` : name };
    if (e.lapsed) out.lapsed = true;
    if (e.title) out.title = e.title;
    if (e.disabled) out.disabled = true;
    return out;
}

/**
 * What a measure's statistic select lists (decision 31, SHR-27): all five statistics, each graded on the layer the
 * measure reads (one that layer cannot give disabled with its reason, a `warn` one with its note as the title; a held
 * one that cannot be given stays, "(not available)"), then Cell count.
 * @param {{kinds: Object<string, string>, held: {stat: string, layer?: string}}} opts
 * @returns {Array<{value: string, label: string, title?: string, disabled?: boolean, lapsed?: boolean}>}
 */
// export-unused-ok: WP-12's Height measure lists the same choices; the panel reads them through measureModel
export function statisticList({ kinds, held, consumer }) {
    const layer = held.stat === CELL_COUNT ? null : held.layer || DEFAULT_LAYER;
    return statisticChoices({ layer, kinds, held: held.stat, consumer }).map((e) => asOption(e, nameOf(e.value)));
}

/**
 * What a measure's layer select lists (decision 31, SHR-27): every layer of the dataset, graded for the statistic (one
 * that cannot give it disabled with its reason, a `warn` one with its note); a held layer the dataset lacks or that
 * cannot give it stays, marked. Empty for Cell count, which reads no layer.
 * @param {{datasetLayers: string[], kinds: Object<string, string>, stat: string, held: {stat: string, layer?: string}}} opts
 */
// export-unused-ok: WP-12's Height measure lists the same choices; the panel reads them through measureModel
export function layerList({ datasetLayers, kinds, stat, held }) {
    return statisticLayerChoices({ method: stat, datasetLayers, kinds, held: held.layer || undefined }).map((e) => asOption(e, e.value));
}

/**
 * A measure after its statistic changed (decision 31): the layer it read, when that layer can give the statistic; else
 * the first that can, and `say` names the move once ("Layer changed to logged: % expressing cannot be computed on 'X'.").
 * @returns {{layer: string, say: string}}
 */
export function pickLayer({ datasetLayers, kinds, stat, preferred }) {
    const r = statisticPairAfter('method', stat, { layer: preferred || DEFAULT_LAYER }, { datasetLayers, kinds });
    return { layer: r.layer || preferred || DEFAULT_LAYER, say: r.say || '' };
}

// ================================================================================================ the control grid

function options(D, select, list) {
    D.clear(select);
    for (const o of list) {
        const opt = D.el('option', { value: o.value, text: o.label, title: o.title || undefined, class: o.lapsed ? 'cgene-lapsed' : undefined });
        if (o.disabled) opt.disabled = true;
        select.appendChild(opt);
    }
}

/**
 * One measure's row (aggregation-unify-080.md 5.1.1): `Color [logged ▾] [x̄]`. The layer it is read on (hidden for Cell
 * count), then the aggregation button: the statistic as its symbol, the menu of every statistic graded on the layer, and
 * the threshold box (decision 35's "Expressed above") in the menu, shown on the button when the measure has one of its own.
 */
function measureRow(D, which, label, on) {
    const { el } = D;
    let held = null;                // the model last painted: the button's entries and the threshold read it
    const layer = el('select', { class: `form-select form-select-sm cgene-${which}-layer`, aria: { label: `${label}: layer` },
        on: { change: () => on.layer(which, layer.value) } });
    const symbolOf = (value) => (value === SAME_AS_COLOR ? MEASURE_SYMBOLS.same : MEASURE_SYMBOLS[value]) || MEASURE_SYMBOLS.same;
    const button = createAggregationButton({
        label: `${label}: aggregation`, axis: which,
        methods: () => (held ? { options: held.stats.map((e) => ({ value: e.value, name: e.label, symbol: symbolOf(e.value),
            disabled: !!e.disabled, title: e.title || '' })), chosen: held.stat } : null),
        onPick: (value) => on.stat(which, value),
        // a threshold of the measure's own shows on the button: no setting hides behind a closed pop-over
        suffix: () => (held && held.threshold !== null && held.own !== null ? `>${held.own}` : ''),
        fields: () => {
            const m = held;
            if (!m || m.threshold === null) return [];
            const g = m.grouping;
            // on a grouping axis the box overrides the grouping's Expressed above (decision 35): empty while it follows it
            return [{ key: 'above', label: CG.sources.above, value: g && m.own === null ? '' : String(m.threshold),
                placeholder: g ? CG.sources.thresholdAuto(g.value) : '',
                title: !g ? CG.sources.thresholdHelp : m.own === null ? CG.sources.thresholdFollows(g.title, g.value) : CG.sources.thresholdOverrides(g.title, g.value) }];
        },
        onField: (key, text) => on.above(which, text)
    });
    button.button.classList.add(`cgene-${which}`, 'cgene-agg');
    const element = el('label', { class: `cgene-field cgene-field--${which} cgene-measure` }, el('span', { class: 'cgene-field__label', text: label }),
        el('span', { class: 'cgene-measure__parts' }, layer, button.button));
    function paint(m) {
        held = m;
        options(D, layer, m.layers);
        layer.hidden = !m.layers.length;
        if (m.layers.length) layer.value = m.layer;
        button.update();
    }
    return { element, paint };
}

/**
 * What a measure shows (the panel's model of it): `threshold` (the one in force) null when the statistic uses none;
 * `own` the measure's stored threshold or null; `grouping` `{title, value}` of the axis grouping, whose Expressed above a
 * measure with no threshold of its own follows (decision 35), or null on an obs axis.
 */
export function measureModel({ spec, datasetLayers, kinds, threshold, grouping = null, consumer }) {
    const own = typeof spec.detect_above === 'number' && Number.isFinite(spec.detect_above) ? spec.detect_above : null;
    return {
        stat: spec.stat, layer: spec.layer,
        stats: statisticList({ kinds, held: spec, consumer }),
        layers: layerList({ datasetLayers, kinds, stat: spec.stat, held: spec }),
        threshold: spec.stat !== CELL_COUNT && needsThreshold(spec.stat) ? threshold : null,
        own, grouping
    };
}

/**
 * The control grid of UX 3.1.
 * @param {Object} opts
 * @param {Object} opts.D - the DOM builder (gene-set-utilities/dom.js)
 * @param {() => Object} opts.model - {axis, choices: {obs, groupings}, mode, color, size, height (measureModel each;
 *   height's statistics start with Same as Color), view3d, scale, swap}
 * @param {Object} opts.on - axis(axis), newGrouping(), mode(mode), stat(which, value), layer(which, value),
 *   above(which, text), scale(value), swap(on)
 * @param {HTMLElement} opts.sections - the section list's element, in the What group
 * @param {HTMLElement} opts.addGenes - Add genes, in the What group
 */
export function createControls({ D, model, on, sections, addGenes }) {
    const { el } = D;
    const field = (label, control, cls) => el('label', { class: `cgene-field ${cls || ''}` }, el('span', { class: 'cgene-field__label', text: label }), control);
    let typeShown = null;          // the type select's value while no key of it is chosen yet

    const axisType = el('select', { class: 'form-select form-select-sm cgene-axis-type', aria: { label: 'Groups: source type' },
        on: { change: () => { typeShown = axisType.value; paintKeys(); } } });
    options(D, axisType, [{ value: 'obs', label: 'obs' }, { value: GROUP_AXIS, label: VOCABULARY.sourceType.grouping }]);
    const axisKey = el('select', { class: 'form-select form-select-sm cgene-axis-key', aria: { label: `Groups: column or ${VOCABULARY.word.grouping}` },
        on: { change: onKey } });

    const mode = el('select', { class: 'form-select form-select-sm cgene-mode', aria: { label: 'Mode' }, on: { change: () => on.mode(mode.value) } });
    options(D, mode, MODE_INFO.map((m) => ({ value: m.value, label: m.label })));

    const color = measureRow(D, 'color', 'Color', on);
    const scaleSel = el('select', { class: 'form-select form-select-sm cgene-scale', aria: { label: 'Scale' }, on: { change: () => on.scale(scaleSel.value) } });
    let scaleFor = null;           // the Color statistic the options were graded for
    const paintScale = (colorStat) => {
        if (scaleFor === colorStat) return;
        scaleFor = colorStat;
        options(D, scaleSel, SCALINGS.map((s) => {
            const g = scalingGrade(s, colorStat);
            return { value: s, label: CG.scaling[s], disabled: !g.ok, title: g.ok ? '' : g.reason };
        }));
    };
    paintScale('mean');
    const size = measureRow(D, 'size', 'Size', on);
    // the 3D bars' height (UX 6b, WP-12): its statistic select starts with Same as Color; shown while 3D is on
    const height = measureRow(D, 'height', CG.view3d.height, on);
    height.element.title = CG.view3d.heightHelp;
    const swap = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary cgene-swap', aria: { pressed: 'false' },
        on: { click: () => on.swap(swap.getAttribute('aria-pressed') !== 'true') } }, 'Swap axes');
    const layoutSlot = el('div', { class: 'cgene-layout-slot' });

    // one packed block (aggregation-unify-080.md 5.2): Groups, Mode, Color, Size, Scale (Height in 3D) and Add genes wrap
    // together, then the section list, one line to a section
    const head = el('div', { class: 'cgene-group cgene-group--head', role: 'group', aria: { label: 'Plot setup' } },
        el('div', { class: 'cgene-row' }, field('Groups', el('span', { class: 'cgene-axis' }, axisType, axisKey)), field('Mode', mode),
            color.element, size.element, field('Scale', scaleSel), height.element, addGenes));
    const genes = el('div', { class: 'cgene-genes' }, sections);
    // Swap axes is a panel action of the shared plot toolbar (panels/cell-gene.js puts it there, after 3D; operator,
    // 2026-11-23: in a group of its own it was often pushed onto a line by itself); the slot is options.js's fallback
    const element = el('div', { class: 'cgene-controls', 'data-panel-controls': '' }, head, genes, layoutSlot);

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
        mode.value = m.mode;
        color.paint(m.color);
        size.paint(m.size);
        size.element.hidden = !modeShowsChannel(m.mode, 'size');
        if (m.height) height.paint(m.height);
        height.element.hidden = !m.height || !m.view3d;
        paintScale(m.color.stat);      // the two z-scores are disabled under a z-score mean Color, with the reason
        scaleSel.value = m.scale;
        swap.setAttribute('aria-pressed', m.swap ? 'true' : 'false');
        swap.classList.toggle('active', !!m.swap);
    }

    return { element, layoutSlot, swap, paint };
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
 * own, its gene count, Genes / One row, for a one-row section its one gene-step button, and ⋯. Reordered by ⋯, by Alt+Up
 * and Alt+Down on the focused row, and by drag (UX 7).
 * @param {Object} opts
 * @param {Object} opts.D
 * @param {() => {sections: Object[]}} opts.model - each section: {title, source (shown when it differs), line, note, rows,
 *   step: {step, pressed, name, label, reading, entries}|null}: the one-row section's gene step, whether it is off the
 *   default, the button's accessible name and tooltip, and the menu's entries (symbol, name, heading, reason)
 * @param {Object} opts.on - rows(i, rows), title(i, text), op(i, op), move(from, to), genes(i, step)
 */
export function createSectionList({ D, model, on }) {
    const { el } = D;
    const list = el('ul', { class: 'cgene-sections', role: 'list', aria: { label: 'Gene sections' } });
    let drawnKey = null;
    let dragFrom = null;
    const steps = new Map();       // section index -> the row's aggregation button, kept across repaints
    const menus = new Map();       // section index -> {button, pop}: the row's ⋯ button and its menu, kept across repaints

    /**
     * The one button of a one-row section (aggregation-unify-080.md 10.2): its gene step as a symbol, plain on the default and
     * accent when set away from it; its menu lists the ways to combine the gene rows, then the source's score methods, each
     * greyed with its reason when Color or Size rules it out. Kept across repaints, so an open menu and the focus stay.
     */
    function stepButton(s, i) {
        let held = steps.get(i);
        if (!held) {
            const part = () => (model().sections[i] || {}).step || null;
            const made = createAggregationButton({
                label: 'One row', axis: `row-${i}`,
                methods: () => {
                    const p = part();
                    return p ? { options: p.entries, chosen: p.step } : null;
                },
                onPick: (value) => on.genes(i, value),
                pressed: () => !!(part() || {}).pressed
            });
            made.button.classList.add('cgene-section__step');
            held = made;
            steps.set(i, held);
        }
        const p = s.step;
        held.update();
        held.button.setAttribute('aria-label', p.label);
        held.button.title = p.reading;
        return held.button;
    }

    /** Keep the buttons of the one-row sections only. */
    function syncSteps(m) {
        for (const [i, held] of [...steps]) {
            const s = m.sections[i];
            if (!s || s.rows !== 'set') { held.destroy(); steps.delete(i); }
        }
    }

    function rowsSelect(i, rows) {
        const select = el('select', { class: 'form-select form-select-sm cgene-section__rows', aria: { label: 'Show as' },
            on: { change: () => on.rows(i, select.value) } },
            el('option', { value: 'genes', text: 'Genes' }), el('option', { value: 'set', text: 'One row' }));
        select.value = rows;
        return select;
    }

    /**
     * The ⋯ button of a section and its menu: a menu pop-over of ui/popover.js, in the page's one top layer, so no part of
     * the panel (the control grid's scroller, the plot and its modebar) covers or clips it (operator, 2026-11-23: items
     * under the plot could not be clicked). Filled on every open from the list as it is then.
     */
    function menuButton(s, i) {
        let held = menus.get(i);
        if (!held) {
            const button = el('button', { type: 'button', class: 'btn btn-sm btn-link cgene-section__menu-btn' }, '⋯');
            const pop = createPopover({ anchor: button, name: 'section-menu', title: 'Section', menu: true,
                render: (body) => { fillMenu(i, body); } });
            held = { button, pop };
            menus.set(i, held);
        }
        held.button.setAttribute('aria-label', `More for ${s.title}`);
        return held.button;
    }

    function fillMenu(i, body) {
        D.clear(body);
        const n = model().sections.length;
        for (const { op, label } of SECTION_OPS) {
            const disabled = (op === 'up' && i === 0) || (op === 'down' && i === n - 1);
            body.appendChild(el('button', { type: 'button', role: 'menuitem', class: 'cgene-section__menu-item', data: { op }, disabled,
                on: { click: () => on.op(i, op) } }, label));
        }
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
        const head = el('div', { class: 'cgene-section__head' },
            el('span', { class: 'cgene-section__grip', aria: { hidden: 'true' }, text: '≡' }), title,
            s.source ? el('span', { class: 'cgene-section__source', text: s.source }) : null,
            el('span', { class: 'cgene-section__count', text: s.line }),
            rowsSelect(i, s.rows), s.rows === 'set' ? stepButton(s, i) : null, el('span', { class: 'cgene-section__more' }, menuButton(s, i)));
        const li = el('li', { class: 'cgene-section', tabindex: '0', draggable: 'true', data: { index: i }, aria: { label: s.title } }, head,
            s.note ? el('div', { class: 'cgene-section__note', role: 'note', text: s.note }) : null);
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
        syncSteps(m);
        for (const [i, held] of [...menus]) if (i >= m.sections.length) { held.pop.destroy(); menus.delete(i); }
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
        repaint();
        drawnKey = key;
    }

    /** Close a ⋯ menu that is open (the pop-over closes itself on a click elsewhere and on Escape). */
    function closeMenus() {
        for (const held of menus.values()) if (held.pop.isOpen()) held.pop.close('api');
    }

    /** Focus a section (after a move, Alt+Up keeps it under the cursor). */
    function focus(i) {
        const li = list.querySelector(`.cgene-section[data-index="${i}"]`);
        if (li) li.focus();
    }

    return { element: list, paint, closeMenus, focus };
}

/**
 * The controls of the Cell Count Plot (UX 4.1, 4.2, 4.4, 4.5; CNT-1 to CNT-4, CNT-6, CNT-17, CNT-21): the DOM side.
 *
 * Top to bottom: Mode; X (Slices for a pie); Y; Color by with its arrangement; Height or Color, with the source of a
 * statistic or the factor of the most frequent level under it; Labels, Sort by height, Reverse, Horizontal, Log axis and
 * Ring; the density row (Smoothing, Scale by level size, Image); and the toolbar: Save as grouping, Color, Download CSV
 * and Undo. A row the mode does not read is hidden, and what it holds stays stored: one muted line lists it ("Kept for
 * other modes"). A numeric input carries the compact binning line, which opens the shared binning control in a pop-over;
 * a categorical one offers Choose levels in a pop-over; Color opens the colour map, its range and the level palette in
 * one. A pop-over never changes the size or flow of the panel (ui/popover.js, WP-6a). What each choice writes is controls-model.js's; panels/cell-count.js commits
 * every change as one undoable step. Interface words come from utils/vocabulary.js.
 *
 * The x, y, Color by, statistic and factor selects are the cell plot's (CNT-2): the same markup, filled by
 * plot-utilities `setupAxisSelector`, with the same focus following and lock for `layer` and `obsp` (CNT-17), and the
 * providers a cell plot lists (a gene score, a grouping).
 */
import { VOCABULARY } from '../../utils/vocabulary.js';
import { sourceName } from '../../utils/cell-grouping.js';
import { binsRange, binSpacingOf, splitUsed } from '../../utils/count-plot-model.js';
import { levelRows, tickLevel, tickAll, tickNone, setRest, BINNING_SLOT } from '../cell-grouping/factors.js';
import { getSource } from '../../utils/source-registry.js';
import { createPopover } from '../../ui/popover.js';
import { Config } from '../../config.js';
import { scaleOptionLabel } from '../../utils/color-scales.js';
import { listAvailableColormaps } from '../plot-utilities/colors.js';
import { DEFAULT_COLORSCALE } from './colour.js';
import {
    colorUse, parseColourLimit, rowsOf, inputText, measureSourceName, keptLine, binningLine, forControl, fromControl, valueChoices, valueChoiceOf, applyValueChoice,
    setMode, shownConfig, inputFromSource, sourceFromSetting, settingOf, drawOptions, labelChoices, parseAdjust
} from './controls-model.js';

const C = VOCABULARY.countPlot;
const P = VOCABULARY.phrase;
const CL = C.colour;
const COLOR_MAPS = Object.freeze((Config && Config.DEFAULTS && Config.DEFAULTS.COLOR_SCALES) || [DEFAULT_COLORSCALE]);

// ================================================================================================ the view

const ARRANGEMENT_WORD = (mode, id) => (mode === 'histogram' && id === 'dodge' ? C.arrangement.overlay : C.arrangement[id]);

/** The input rows of the bar: `field` in the config, the select's axis name and the roles its type menu lists. */
const INPUT_ROWS = Object.freeze([
    { field: 'x', axis: 'count-x', roles: ['x'] },
    { field: 'y', axis: 'count-y', roles: ['x'] },
    { field: 'split', axis: 'split', roles: ['color'] }
]);

/**
 * The control bar of a count plot.
 * @param {Object} opts
 * @param {Object} opts.D - the DOM builder (gene-set-utilities/dom.js)
 * @param {string} opts.id - the panel id
 * @param {() => Object} opts.model - what to draw: {config, structure, titleOf, focusedGene, focusedCell, infos: {x?, y?,
 *   split?} (each input's axis of the reply shown, with `counts`), levelsOf(field) (an input's levels when no reply
 *   shows them: a refused plan's, asked for alone; null meanwhile), levelsSaid(field) (why they did not come, with its way
 *   out, or null), undo: ?string (the label of the step), drawable(mode)}
 * @param {Object} opts.on - what the user did: commit(config, label), silent(config) (focus following, no step),
 *   undo(), csv(), setupAxis(rowEl, axis, setting, roles) (fills a row's selects), wayOut(action) (a way out's button, states.js)
 * @returns {{element: HTMLElement, paint: Function, destroy: Function}}
 */
export function createControls({ D, id, model, on }) {
    const { el } = D;
    const histories = new Map();          // a row's remembered sources by type, as a cell plot keeps them
    const rows = new Map();               // field -> row
    const editors = new Map();            // `${field}` -> {row, kind, btn, pop, body, ctl, mounts}: the levels or binning pop-over of an input

    const option = (value, text, extra = {}) => {
        const o = el('option', { value, text });
        if (extra.disabled) { o.disabled = true; o.title = extra.title || ''; }
        return o;
    };

    // ---------------------------------------------------------------- Mode
    const modeSelect = el('select', { class: 'form-select form-select-sm ccnt-mode', id: `ccnt-mode-${id}`,
        on: { change: () => commit({ ...setMode(model().config, modeSelect.value) }, `mode ${C.modes[modeSelect.value]}`) } });
    const modeRow = el('div', { class: 'ctl-row ccnt-row ccnt-row--mode' },
        el('label', { class: 'ctl-label', for: `ccnt-mode-${id}`, text: C.rows.mode }), modeSelect);

    function fillModes() {
        D.clear(modeSelect);
        const m = model();
        for (const g of C.modeGroups) {
            const og = el('optgroup', { label: g.label });
            for (const mode of g.modes) {
                const drawable = m.drawable(mode);
                og.appendChild(option(mode, C.modes[mode], { disabled: !drawable, title: drawable ? '' : C.notDrawn(C.modes[mode]) }));
            }
            modeSelect.appendChild(og);
        }
        modeSelect.value = m.config.mode;
    }

    // ---------------------------------------------------------------- an input row (the cell plot's selects)
    function selectsRow(field, axis, label) {
        const typeId = `${axis}-type-select-ccnt-${id}`;
        const labelEl = el('label', { class: 'axis-selector-label ctl-label', for: typeId, text: label });
        const type = el('select', { class: 'form-select form-select-sm axis-type-select', data: { axis }, id: typeId });
        const key = el('select', { class: 'form-select form-select-sm axis-key-select', data: { axis }, disabled: true, aria: { label: `${label} key` } });
        const column = el('select', { class: 'form-select form-select-sm axis-column-select', data: { axis }, disabled: true, aria: { label: `${label} column` } });
        const selector = el('div', { class: 'axis-selector' }, type, key, column);
        const extra = el('span', { class: 'ccnt-row__extra' });
        const element = el('div', { class: 'axis-selector-container ctl-row ccnt-row', data: { row: field } }, labelEl, selector, extra);
        return { field, axis, element, labelEl, type, key, column, selector, extra, setting: null, sig: null };
    }

    function inputRow(spec) {
        const row = selectsRow(spec.field, spec.axis, C.rows[spec.field]);
        row.roles = spec.roles;
        row.wrap = el('div', { class: 'ccnt-input', data: { input: spec.field } }, row.element);
        wireSelects(row, () => inputOf(row.field), (source) => commitInput(row.field, source));
        rows.set(spec.field, row);
        return row;
    }

    /** What a row's field holds in the config now. */
    function inputOf(field) {
        const c = model().config;
        if (field === 'measure') return c.measure || null;
        if (field === 'factor') return c.value && c.value.kind === 'top_level' ? c.value.factor || null : null;
        return c[field] || null;
    }

    function commitInput(field, source) {
        const c = model().config;
        const next = { ...c };
        const was = inputOf(field);
        const p = inputFromSource(was, source);
        if (field === 'measure') {
            if (!p) return;
            next.measure = { ...(c.measure || {}), source: p.source };
            if (p.locked) next.measure.locked = true;
            commit(next, `${C.rows.source.toLowerCase()} ${measureSourceName(p.source, model().titleOf)}`);
            return;
        }
        if (field === 'factor') {
            if (!p) return;
            next.value = { kind: 'top_level', factor: p };
            commit(next, `${C.value.topLevel.replace('…', '')} ${sourceName(p.source, model().titleOf)}`);
            return;
        }
        if (p) next[field] = p; else delete next[field];
        commit(next, p ? `${C.rows[field]} ${inputText(p.source, model().titleOf)}` : `no ${C.rows[field]}`);
    }

    /**
     * The three selects of a row, as a cell plot's: a type change keeps what the row last had of the new type, a key
     * change keeps the row's column, a provider entity listed under obs switches the type, and a provider's "New …"
     * entry makes one beside this panel.
     */
    function wireSelects(row, stored, apply) {
        const setup = () => on.setupAxis(row.element, row.axis, row.setting, row.roles);
        const remember = (type, key, column) => {
            const h = row.setting.history;
            h[type] = { ...(h[type] || {}), key, columns: { ...((h[type] && h[type].columns) || {}), [key]: column } };
        };
        row.type.addEventListener('change', () => {
            const s = row.setting;
            const now = row.type.value;
            if (s.type === now) return;
            remember(s.type, s.key, s.column);
            s.type = now;
            s.key = getSource(now) ? ((s.history[now] && s.history[now].key) || '') : s.key;
            if (now === 'none') { apply(null); return; }
            setup();
            apply(sourceFromSetting(s));
        });
        row.key.addEventListener('change', () => {
            const s = row.setting;
            let value = row.key.value;
            const listed = parseListed(value);
            if (listed) {
                s.history[listed.type] = { ...(s.history[listed.type] || {}), key: listed.key };
                row.type.value = listed.type;
                row.type.dispatchEvent(new Event('change'));
                return;
            }
            const provider = getSource(s.type);
            if (provider && provider.newEntity && value === provider.newEntity.value) {
                const made = provider.newEntity.run(id);
                if (!made) { row.key.value = s.key || ''; return; }
                value = made.getId();
                s.column = '';
            }
            remember(s.type, s.key, s.column);
            s.key = value;
            setup();
            apply(sourceFromSetting(s));
        });
        row.column.addEventListener('change', () => {
            const s = row.setting;
            const provider = getSource(s.type);
            if (provider) {
                if (on.takeSubKey(s, row.column)) apply(sourceFromSetting(s));
                return;
            }
            s.column = row.column.value;
            apply(sourceFromSetting(s));
        });
        // the cell plot's lock and refocus buttons, appended by setupAxisSelector for layer and obsp
        row.selector.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const s = row.setting;
            if (btn.classList.contains('axis-lock-btn')) {
                const holder = stored();
                if (!holder) return;
                lockInput(row.field, !holder.locked);
            } else if (btn.classList.contains('axis-refocus-btn')) {
                const m = model();
                const want = s.type === 'obsp' ? m.focusedCell : m.focusedGene;
                if (!want) return;
                s.column = want;
                apply(sourceFromSetting(s));
            }
        });
        row.sync = () => {
            const holder = stored();
            const source = holder ? holder.source : null;
            const sig = JSON.stringify([source, !!(holder && holder.locked), model().structureVersion]);
            if (row.sig === sig) return;
            row.sig = sig;
            if (!histories.has(row.field)) histories.set(row.field, {});
            row.setting = settingOf(holder, histories.get(row.field));
            if (!holder && row.field !== 'split') {
                // nothing chosen yet: the type menu with a blank first entry, and nothing in the other two
                row.setting.type = '';
                D.clear(row.type);
                row.type.appendChild(option('', '—'));
                for (const c of on.typeChoices(row.roles)) row.type.appendChild(option(c.value, c.text));
                row.type.value = '';
                row.type.disabled = false;
                for (const select of [row.key, row.column]) { D.clear(select); select.disabled = true; }
                return;
            }
            setup();
            keepStoredColumn(row, source);
        };
    }

    /**
     * A layer or obsp source restored from a link keeps its gene or cell while there is no focus to follow; with a
     * focus, an unlocked one follows it (CNT-17) as a cell plot's does, with no step of its own.
     */
    function keepStoredColumn(row, source) {
        const s = row.setting;
        if (!source || !(source.type === 'layer' || source.type === 'obsp') || !source.column || s.column === source.column) return;
        const m = model();
        const focus = source.type === 'layer' ? m.focusedGene : m.focusedCell;
        if (focus && !s.locked) return;
        s.column = source.column;
        D.clear(row.column);
        row.column.appendChild(option(source.column, source.column));
        row.column.value = source.column;
    }

    function lockInput(field, locked) {
        const c = model().config;
        const next = { ...c };
        const flip = (holder) => {
            const out = { ...holder };
            if (locked) out.locked = true; else delete out.locked;
            return out;
        };
        if (field === 'measure') next.measure = flip(c.measure);
        else if (field === 'factor') next.value = { ...c.value, factor: flip(c.value.factor) };
        else next[field] = flip(c[field]);
        commit(next, `${locked ? 'lock' : 'unlock'} ${C.rows[field] || field}`);
    }

    const parseListed = (value) => (on.parseListed ? on.parseListed(value) : null);

    // ---------------------------------------------------------------- binning and levels of an input (pop-overs)
    /**
     * The button of an input's levels or binning editor and its pop-over, made once and kept while the input's kind stays:
     * a repaint draws the same button again, so an open pop-over keeps its anchor.
     */
    function editorOf(row, kind, name) {
        let entry = editors.get(row.field);
        if (entry && entry.kind !== kind) { destroyEditor(row.field); entry = null; }
        if (entry) { entry.name = name; return entry; }
        const btn = el('button', { type: 'button', class: `btn btn-sm btn-link ${kind === 'binning' ? 'ccnt-bins' : 'ccnt-choose'}`, data: { input: row.field } });
        entry = { row, kind, name, btn, body: null, ctl: null, mounts: [], pop: null };
        entry.pop = createPopover({
            anchor: btn, name: kind, wide: true, title: '',
            render: (body, ctl) => {
                entry.body = body;
                entry.ctl = ctl;
                const title = body.parentElement && body.parentElement.querySelector('.az-popover-title');
                if (title) title.textContent = `${kind === 'binning' ? 'Bins of' : 'Levels of'} ${entry.name}`;
                fillEditor(entry);
                return () => {
                    for (const mounted of entry.mounts.splice(0)) if (mounted && mounted.destroy) mounted.destroy();
                    entry.body = entry.ctl = null;
                };
            }
        });
        editors.set(row.field, entry);
        return entry;
    }

    function destroyEditor(field) {
        const entry = editors.get(field);
        if (!entry) return;
        entry.pop.destroy();
        editors.delete(field);
    }

    /** The editor's body drawn from the model now; the focused control stays focused. */
    function fillEditor(entry) {
        if (!entry.body) return;
        const m = model();
        const { row, body } = entry;
        const p = m.config[row.field] || null;
        if (!p) { entry.ctl.close(); return; }
        const focusables = () => [...body.querySelectorAll('input, button, select')].filter((e) => !e.disabled);
        const at = focusables().indexOf(document.activeElement);
        for (const mounted of entry.mounts.splice(0)) if (mounted && mounted.destroy) mounted.destroy();
        D.clear(body);
        if (entry.kind === 'binning') {
            const host = el('div', { class: 'ccnt-binning' });
            body.appendChild(host);
            if (BINNING_SLOT.mount) {
                const max = binsRange(m.config.mode, row.field).max;
                entry.mounts.push(BINNING_SLOT.mount(host, {
                    partitioning: forControl(p, m.config.mode), info: m.infos[row.field] || null, kind: 'count', max, titleOf: m.titleOf,
                    commit: (next, label) => {
                        const c = model().config;
                        commit({ ...c, [row.field]: fromControl(next, c.mode) }, label);
                    },
                    // how the bins are drawn: a 2D histogram and a histogram only; a density is smoothed on a linear grid
                    ...(['hist2d', 'histogram'].includes(m.config.mode) && ['x', 'y'].includes(row.field) ? { spacing: {
                        value: binSpacingOf(m.config, row.field),
                        set: (value) => {
                            const c = model().config;
                            commit({ ...c, binSpacing: { ...c.binSpacing, [row.field]: value } }, `${value === 'even' ? 'even' : 'value-placed'} bins of ${C.rows[row.field] || row.field}`);
                        }
                    } } : {}),
                    close: () => entry.pop.close('button')
                }));
            }
        } else {
            body.appendChild(el('div', { class: 'ccnt-levels' }, ...levelChooser(row.field, p, m.infos[row.field] || (m.levelsOf ? m.levelsOf(row.field) : null), m)));
        }
        if (at >= 0) { const again = focusables()[at]; if (again) again.focus({ preventScroll: true }); }
        entry.ctl.update();
    }

    function paintInputExtras(row, p, m, shownRows) {
        const numeric = !!p && m.isNumeric(p.source);
        const binned = numeric && shownRows.binned.includes(row.field);
        const kind = !p || (numeric && !binned) ? null : binned ? 'binning' : 'levels';
        if (!kind) {
            destroyEditor(row.field);
            D.clear(row.extra);
            return;
        }
        const entry = editorOf(row, kind, sourceName(p.source, m.titleOf));
        const text = kind === 'binning' ? binningLine(p, m.config.mode) : C.buttons.chooseLevels;
        entry.btn.textContent = `${text} ▾`;
        if (row.extra.firstChild !== entry.btn) row.extra.replaceChildren(entry.btn);
        if (entry.pop.isOpen()) fillEditor(entry);
    }

    function levelChooser(field, p, info, m) {
        // the levels did not come (refused for their number, or failed): why, and the way out when there is one
        const said = !info && m.levelsSaid ? m.levelsSaid(field) : null;
        if (said) {
            return [el('div', { class: 'ccnt-levels__note', role: 'status', data: { state: said.state } },
                el('p', { class: 'ccnt-levels__said', text: said.text }),
                ...said.actions.map(([action, label]) => el('button', { type: 'button', class: 'btn btn-sm btn-outline-primary', data: { action },
                    on: { click: () => on.wayOut(action) } }, label)))];
        }
        if (!info) return [el('div', { class: 'ccnt-levels__wait', text: `${VOCABULARY.plural.level[0].toUpperCase()}${VOCABULARY.plural.level.slice(1)} follow once the cells are counted.` })];
        const set = (next, label) => commit({ ...model().config, [field]: next }, label);
        const rowsOfLevels = levelRows(p, info, m.labelsOf(field));
        const name = sourceName(p.source, m.titleOf);
        const list = el('ul', { class: 'ccnt-levels__list', role: 'list', aria: { label: VOCABULARY.plural.level } }, rowsOfLevels.map((r) => {
            const li = el('li', { class: 'ccnt-level', data: { id: r.id } });
            const label = el('span', { class: 'ccnt-level__label', text: r.label });
            const n = el('span', { class: 'ccnt-level__n', text: r.n === null ? '' : Number(r.n).toLocaleString('en-US') });
            if (r.tickable) {
                const box = el('input', { type: 'checkbox', checked: r.ticked, aria: { label: r.label } });
                box.addEventListener('change', () => set(tickLevel(p, info, r.id, box.checked), `${box.checked ? 'tick' : 'untick'} ${r.label}`));
                li.append(el('label', { class: 'ccnt-level__tick' }, box, label), n);
            } else {
                li.append(label, n);
            }
            return li;
        }));
        const restName = `ccnt-rest-${id}-${field}`;
        const rest = (value, text) => el('label', { class: 'ccnt-rest-opt' },
            el('input', { type: 'radio', class: 'ccnt-rest', name: restName, value, checked: (p.rest === 'exclude') === (value === 'exclude'),
                on: { change: () => set(setRest(p, value), value === 'exclude' ? 'leave unticked levels out' : 'group unticked levels') } }), ` ${text}`);
        return [
            list,
            el('div', { class: 'ccnt-rest-row', role: 'radiogroup', aria: { label: 'Unticked levels' } },
                el('span', { text: 'Unticked levels ' }), rest('other', `Count as '${P.other(name)}'`), rest('exclude', 'Leave out')),
            el('div', { class: 'ccnt-levels__actions' },
                el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', on: { click: () => set(tickAll(p), 'tick all levels') } }, 'Tick all'),
                el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', on: { click: () => set(tickNone(p), 'tick no level') } }, 'Tick none'))
        ];
    }

    // ---------------------------------------------------------------- Color by's arrangement
    const arrangement = el('span', { class: 'ccnt-arrangement', role: 'radiogroup', aria: { label: 'Arrangement' } });
    function paintArrangement(m, shownRows) {
        D.clear(arrangement);
        const ids = shownRows.arrangement;
        // means are never added or shared out of 100%, so a statistic is always drawn side by side: no choice to offer
        arrangement.hidden = !ids.length || !m.config.split || (m.config.value && m.config.value.kind === 'measure');
        const now = m.config.arrangement || 'stack';
        const group = `ccnt-arr-${id}`;
        for (const a of ids) {
            const input = el('input', { type: 'radio', name: group, value: a, checked: a === now, class: 'ccnt-arrangement__input',
                on: { change: () => {
                    const next = { ...model().config };
                    if (a === 'stack') delete next.arrangement; else next.arrangement = a;
                    commit(next, `${ARRANGEMENT_WORD(m.config.mode, a).toLowerCase()} bars`);
                } } });
            arrangement.appendChild(el('label', { class: 'ccnt-arrangement__opt' }, input, ` ${ARRANGEMENT_WORD(m.config.mode, a)}`));
        }
    }

    // ---------------------------------------------------------------- Height / Color, with its source or its factor
    const valueSelect = el('select', { class: 'form-select form-select-sm ccnt-value', id: `ccnt-value-${id}`,
        on: { change: () => chooseValue(valueSelect.value) } });
    const valueLabel = el('label', { class: 'ctl-label', for: `ccnt-value-${id}` });
    const valueHelp = el('span', { class: 'ccnt-help ccnt-value__help' });
    const valueRow = el('div', { class: 'ctl-row ccnt-row ccnt-row--value' }, valueLabel, valueSelect, valueHelp);
    const measureRow = selectsRow('measure', 'measure', C.rows.source);
    measureRow.roles = ['x'];
    const above = el('input', { type: 'text', class: 'form-control form-control-sm ccnt-above', inputmode: 'decimal', placeholder: '0',
        autocomplete: 'off', aria: { label: C.rows.above }, title: 'The threshold of % above: a cell counts when its value is above it.' });
    const aboveWrap = el('label', { class: 'ccnt-above-wrap' }, `${C.rows.above} `, above);
    measureRow.extra.appendChild(aboveWrap);
    wireSelects(measureRow, () => inputOf('measure'), (source) => commitInput('measure', source));
    rows.set('measure', measureRow);
    const factorRow = selectsRow('factor', 'factor', C.rows.factor);
    factorRow.roles = ['x'];
    const fade = el('input', { type: 'checkbox', class: 'ccnt-fade',
        on: { change: () => { const next = { ...model().config }; if (fade.checked) next.fade = true; else delete next.fade; commit(next, fade.checked ? 'fade by share' : 'no fade'); } } });
    factorRow.extra.appendChild(el('label', { class: 'ccnt-fade-wrap' }, fade, ` ${C.buttons.fade}`));
    wireSelects(factorRow, () => inputOf('factor'), (source) => commitInput('factor', source));
    rows.set('factor', factorRow);

    function commitAbove() {
        const c = model().config;
        if (!c.measure) return;
        const text = above.value.trim();
        const value = text === '' ? undefined : Number(text);
        if (value !== undefined && !Number.isFinite(value)) { above.value = c.measure.above === undefined ? '' : String(c.measure.above); return; }
        if (value === c.measure.above) return;
        const measure = { ...c.measure };
        if (value === undefined) delete measure.above; else measure.above = value;
        commit({ ...c, measure }, `above ${value === undefined ? 0 : value}`);
    }
    above.addEventListener('change', commitAbove);
    above.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitAbove(); } });

    function chooseValue(choice) {
        const m = model();
        const next = applyValueChoice(m.config, choice, m.valueDefaults());
        const entry = valueChoices(m.config).find((c) => c.value === choice);
        if (!next) { valueSelect.value = valueChoiceOf(m.config); return; }
        commit(next, `${rowsOf(m.config.mode).value === 'color' ? C.rows.color : C.rows.height} ${entry ? entry.label.replace('…', '') : choice}`);
    }

    function paintValue(m, shownRows) {
        const kind = shownRows.value;
        valueRow.hidden = !kind;
        measureRow.element.hidden = true;
        factorRow.element.hidden = true;
        if (!kind) return;
        valueLabel.textContent = kind === 'color' ? C.rows.color : C.rows.height;
        D.clear(valueSelect);
        const groups = new Map();
        for (const c of valueChoices(m.config)) {
            const o = option(c.value, c.label);
            o.title = c.help;
            if (!c.group) { valueSelect.appendChild(o); continue; }
            if (!groups.has(c.group)) {
                groups.set(c.group, el('optgroup', { label: C.value.groups[c.group] }));
                valueSelect.appendChild(groups.get(c.group));
            }
            groups.get(c.group).appendChild(o);
        }
        const choice = valueChoiceOf(m.config);
        valueSelect.value = choice;
        const entry = valueChoices(m.config).find((c) => c.value === choice);
        valueHelp.textContent = entry ? entry.help : '';
        if (choice.startsWith('stat:')) {
            measureRow.element.hidden = false;
            measureRow.sync();
            dropCategorical(measureRow);
            aboveWrap.hidden = choice !== 'stat:pct_above';
            if (document.activeElement !== above) above.value = m.config.measure.above === undefined ? '' : String(m.config.measure.above);
        }
        if (choice === 'top_level') {
            factorRow.element.hidden = false;
            factorRow.sync();
            fade.checked = m.config.fade === true;
        }
    }

    /** A statistic needs numbers: a categorical provider (a grouping) is not listed in its type menu. */
    function dropCategorical(row) {
        for (const o of [...row.type.options]) {
            const provider = getSource(o.value);
            if (provider && provider.valueType === 'categorical' && o.value !== row.setting.type) o.remove();
        }
    }

    // ---------------------------------------------------------------- Labels, sort, reverse, horizontal, log axis, ring
    const labelsSelect = el('select', { class: 'form-select form-select-sm ccnt-labels', id: `ccnt-labels-${id}`,
        on: { change: () => {
            const next = { ...model().config };
            if (labelsSelect.value === 'none') delete next.labels; else next.labels = labelsSelect.value;
            commit(next, `labels ${C.labels[labelsSelect.value].toLowerCase()}`);
        } } });
    const pressed = (cls, text, field, value) => {
        const btn = el('button', { type: 'button', class: `btn btn-sm btn-outline-secondary ${cls}`, aria: { pressed: 'false' },
            on: { click: () => {
                const next = { ...model().config };
                const on2 = btn.getAttribute('aria-pressed') !== 'true';
                if (on2) next[field] = value; else delete next[field];
                commit(next, `${on2 ? '' : 'no '}${text.toLowerCase()}`.trim());
            } } }, text);
        return btn;
    };
    const sortBtn = pressed('ccnt-sort', C.buttons.sort, 'sort', 'height');
    const reverseBtn = pressed('ccnt-reverse', C.buttons.reverse, 'reverse', true);
    const horizontalBtn = pressed('ccnt-horizontal', C.buttons.horizontal, 'horizontal', true);
    const logBox = el('input', { type: 'checkbox', class: 'ccnt-log',
        on: { change: () => { const next = { ...model().config }; if (logBox.checked) next.log = true; else delete next.log; commit(next, logBox.checked ? 'log count axis' : 'linear count axis'); } } });
    const ringBox = el('input', { type: 'checkbox', class: 'ccnt-ring',
        on: { change: () => { const next = { ...model().config }; if (ringBox.checked) next.ring = true; else delete next.ring; commit(next, ringBox.checked ? 'ring' : 'pie'); } } });
    const logWrap = el('label', { class: 'ccnt-opt' }, logBox, ` ${C.buttons.log}`);
    const ringWrap = el('label', { class: 'ccnt-opt' }, ringBox, ` ${C.buttons.ring}`);
    const labelsRow = el('div', { class: 'ctl-row ccnt-row ccnt-row--labels' },
        el('label', { class: 'ctl-label', for: `ccnt-labels-${id}`, text: C.rows.labels }), labelsSelect, sortBtn, reverseBtn, horizontalBtn, logWrap, ringWrap);

    // the density row: Smoothing, Scale by level size, Image, and what the bandwidth and the floor were
    const adjust = el('input', { type: 'text', class: 'form-control form-control-sm ccnt-adjust', inputmode: 'decimal', placeholder: '1',
        autocomplete: 'off', id: `ccnt-adjust-${id}`, aria: { label: C.buttons.adjust } });
    const adjustNote = el('span', { class: 'ccnt-help ccnt-adjust__problem', role: 'alert' });
    const commitAdjust = () => {
        const c = model().config;
        const r = parseAdjust(adjust.value);
        adjustNote.textContent = r.ok ? '' : r.message;
        if (!r.ok) { adjust.value = c.adjust === undefined ? '' : String(c.adjust); return; }
        if (r.value === (c.adjust === undefined ? 1 : c.adjust)) return;
        const next = { ...c };
        if (r.value === 1) delete next.adjust; else next.adjust = r.value;
        commit(next, `bandwidth adjust ${r.value}`);
    };
    adjust.addEventListener('change', commitAdjust);
    adjust.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitAdjust(); } });
    // `off` is what unticking stores (nothing, unless the field's default is the ticked state)
    const toggleField = (cls, field, value, text, off = () => undefined) => {
        const box = el('input', { type: 'checkbox', class: cls,
            on: { change: () => { const next = { ...model().config }; const stored = box.checked ? value : off(next);
                if (stored === undefined) delete next[field]; else next[field] = stored; commit(next, `${box.checked ? '' : 'no '}${text.toLowerCase()}`.trim()); } } });
        return { box, wrap: el('label', { class: 'ccnt-opt' }, box, ` ${text}`) };
    };
    const bySize = toggleField('ccnt-bysize', 'scale', 'size', C.buttons.bySize);
    // with a Color by the image is the default, so leaving it is stored
    const image = toggleField('ccnt-image', 'style', 'image', C.buttons.image, (c) => (c.split ? 'contours' : undefined));
    const densityNotes = el('div', { class: 'ccnt-help ccnt-density-notes' });
    const densityRow = el('div', { class: 'ctl-row ccnt-row ccnt-row--density' },
        el('label', { class: 'ctl-label', for: `ccnt-adjust-${id}`, text: C.buttons.adjust }), adjust, adjustNote, bySize.wrap, image.wrap, densityNotes);

    function paintLabels(m, shownRows) {
        const o = drawOptions(m.config);
        D.clear(labelsSelect);
        for (const c of labelChoices(m.config)) labelsSelect.appendChild(option(c.value, c.label));
        labelsSelect.value = o.labels;
        labelsSelect.hidden = !shownRows.labels;
        labelsRow.querySelector('label.ctl-label').hidden = !shownRows.labels;
        const show = (btn, visible, isOn) => { btn.hidden = !visible; btn.setAttribute('aria-pressed', String(!!isOn)); btn.classList.toggle('active', !!isOn); };
        show(sortBtn, shownRows.sort, o.sort === 'height');
        show(reverseBtn, shownRows.reverse, o.reverse);
        show(horizontalBtn, shownRows.horizontal, o.horizontal);
        logWrap.hidden = !shownRows.log;
        logBox.checked = o.log;
        ringWrap.hidden = !shownRows.ring;
        ringBox.checked = o.ring;
        // a row with nothing in it is not drawn (a density's modes have no Labels, a pie has no Log axis)
        labelsRow.hidden = !(shownRows.labels || shownRows.sort || shownRows.reverse || shownRows.horizontal || shownRows.log || shownRows.ring);
        densityRow.hidden = !shownRows.density;
        if (document.activeElement !== adjust) adjust.value = m.config.adjust === undefined ? '' : String(m.config.adjust);
        bySize.wrap.hidden = !(shownRows.density && m.config.split);
        bySize.box.checked = o.scale === 'size';
        image.wrap.hidden = shownRows.density !== 2;
        image.box.checked = o.style === 'image';
        densityNotes.textContent = shownRows.density && m.notes ? [m.notes.bandwidth, m.notes.floor].filter(Boolean).join(' ') : '';
        densityNotes.hidden = !densityNotes.textContent;
    }

    // ---------------------------------------------------------------- the toolbar: Save as grouping, Color, Download CSV, Undo
    const saveBtn = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary ccnt-save-btn', on: { click: () => on.saveAsGrouping() } },
        C.saveGrouping.button);
    const colorBtn = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary ccnt-color-btn' }, `${CL.button} ▾`);
    // temporary: Download CSV goes to Plot Options ▸ Export when the shared Plot Options land (WP-5a)
    const csvBtn = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary ccnt-csv', on: { click: () => on.csv() } }, C.buttons.csv);
    const undoBtn = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary ccnt-undo', disabled: true, on: { click: () => on.undo() } }, C.buttons.undo);
    const toolbar = el('div', { class: 'ccnt-toolbar' }, saveBtn, colorBtn, el('span', { class: 'ccnt-toolbar__gap' }), csvBtn, undoBtn);

    // Color: the colour map, Reverse, the range, the level palette. Every edit applies live as one undoable step.
    const colorPop = createPopover({
        anchor: colorBtn, name: 'color', title: CL.title,
        render: (body, ctl) => {
            colorState.body = body;
            colorState.ctl = ctl;
            fillColor();
            return () => { colorState.body = colorState.ctl = null; };
        }
    });
    const colorState = { body: null, ctl: null };

    const withColor = (change, label) => {
        const c = model().config;
        const color = { ...(c.color || {}) };
        change(color);
        const next = { ...c };
        if (Object.keys(color).length) next.color = color; else delete next.color;
        commit(next, label);
    };

    function fillColor() {
        if (!colorState.body) return;
        const m = model();
        const use = colorUse(m.config);
        const c = m.config.color || {};
        const body = colorState.body;
        const focusables = () => [...body.querySelectorAll('input, button, select')].filter((e) => !e.disabled);
        const at = focusables().indexOf(document.activeElement);
        D.clear(body);
        const line = (...kids) => el('div', { class: 'ccnt-color__line' }, ...kids);
        const idOf = (k) => `ccnt-color-${k}-${id}`;
        if (use.map) {
            const map = el('select', { class: 'form-select form-select-sm ccnt-color-map', id: idOf('map'),
                on: { change: () => withColor((o) => { if (map.value === DEFAULT_COLORSCALE) delete o.map; else o.map = map.value; }, `color map ${map.value}`) } });
            for (const scale of COLOR_MAPS) map.appendChild(option(scale, scaleOptionLabel(scale)));
            map.value = COLOR_MAPS.includes(c.map) ? c.map : DEFAULT_COLORSCALE;
            const reverse = el('input', { type: 'checkbox', class: 'ccnt-color-reverse', checked: c.reverse === true,
                on: { change: () => withColor((o) => { if (reverse.checked) o.reverse = true; else delete o.reverse; }, reverse.checked ? 'reverse color map' : 'color map as is') } });
            body.append(line(el('label', { for: idOf('map'), text: CL.map }), map),
                line(el('label', { class: 'ccnt-opt' }, reverse, ` ${CL.reverse}`)));
            const problem = el('span', { class: 'ccnt-help ccnt-color__problem', role: 'alert' });
            const limit = (key, text) => {
                const input = el('input', { type: 'text', class: `form-control form-control-sm ccnt-color-${key}`, id: idOf(key), inputmode: 'decimal',
                    autocomplete: 'off', placeholder: CL.auto, value: Number.isFinite(c[key]) ? String(c[key]) : '' });
                const apply = () => {
                    const r = parseColourLimit(input.value);
                    problem.textContent = r.ok ? '' : r.message;
                    if (!r.ok) { input.value = Number.isFinite(c[key]) ? String(c[key]) : ''; return; }
                    if (r.value === (Number.isFinite(c[key]) ? c[key] : undefined)) return;
                    withColor((o) => { if (r.value === undefined) delete o[key]; else o[key] = r.value; }, `color ${text.toLowerCase()} ${r.value === undefined ? 'auto' : r.value}`);
                };
                input.addEventListener('change', apply);
                input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
                return el('span', { class: 'ccnt-color__limit' }, el('label', { for: idOf(key), text: text }), input);
            };
            body.append(line(limit('min', CL.min), limit('max', CL.max), limit('center', CL.center)), problem);
            if (Number.isFinite(c.center) && Number.isFinite(c.min) && Number.isFinite(c.max)) body.append(el('p', { class: 'ccnt-help', text: CL.centerNote }));
        }
        if (use.palette) {
            const palette = el('select', { class: 'form-select form-select-sm ccnt-color-palette', id: idOf('palette'),
                on: { change: () => withColor((o) => { if (palette.value) o.palette = palette.value; else delete o.palette; }, `level palette ${palette.value || 'default'}`) } });
            palette.appendChild(option('', CL.paletteDefault));
            for (const name of listAvailableColormaps()['Discrete Palettes']) palette.appendChild(option(name, name));
            palette.value = c.palette || '';
            if (palette.value !== (c.palette || '')) palette.value = '';
            body.append(line(el('label', { for: idOf('palette'), text: CL.palette }), palette));
        }
        body.append(line(el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary ccnt-color-reset', disabled: !m.config.color,
            on: { click: () => { const next = { ...model().config }; delete next.color; commit(next, 'reset color'); } } }, CL.reset)));
        if (at >= 0) { const again = focusables()[at]; if (again) again.focus({ preventScroll: true }); }
        colorState.ctl.update();
    }

    function paintToolbar(m) {
        const use = colorUse(m.config);
        colorBtn.hidden = !(use.map || use.palette);
        if (colorBtn.hidden && colorPop.isOpen()) colorPop.close('api');
        else if (colorPop.isOpen()) fillColor();
        saveBtn.hidden = !m.canSave;
        saveBtn.disabled = !m.canExport;
        csvBtn.disabled = !m.canExport;
    }

    // ---------------------------------------------------------------- the bar
    const xRow = inputRow(INPUT_ROWS[0]);
    const yRow = inputRow(INPUT_ROWS[1]);
    const splitRow = inputRow(INPUT_ROWS[2]);
    splitRow.extra.after(arrangement);
    const setsSlot = el('div', { class: 'ccnt-sets', hidden: true });
    const kept = el('div', { class: 'ccnt-kept', role: 'note' });
    const element = el('div', { class: 'ccnt-controls', 'data-panel-controls': '' },
        modeRow, xRow.wrap, yRow.wrap, splitRow.wrap, setsSlot, valueRow, measureRow.element, factorRow.element, labelsRow, densityRow, kept, toolbar);

    function commit(next, label) {
        on.commit(next, label);
    }

    let modesFilled = false;
    function paint() {
        const m = model();
        const shownRows = rowsOf(m.config.mode);
        if (!modesFilled) { fillModes(); modesFilled = true; }
        modeSelect.value = m.config.mode;
        xRow.labelEl.textContent = shownRows.slices ? C.rows.slices : C.rows.x;
        xRow.wrap.hidden = !shownRows.x;
        yRow.wrap.hidden = !shownRows.y;
        splitRow.wrap.hidden = !shownRows.split || !splitUsed(shownConfig(m.config));
        setsSlot.hidden = !shownRows.sets;
        if (m.structure) {
            for (const row of [xRow, yRow, splitRow]) {
                if (row.wrap.hidden) { destroyEditor(row.field); continue; }
                row.sync();
                paintInputExtras(row, m.config[row.field] || null, m, shownRows);
            }
        }
        paintArrangement(m, shownRows);
        if (m.structure) paintValue(m, shownRows); else valueRow.hidden = true;
        paintLabels(m, shownRows);
        paintToolbar(m);
        kept.textContent = keptLine(m.config, m.titleOf);
        kept.hidden = !kept.textContent;
        undoBtn.disabled = !m.undo;
        undoBtn.title = m.undo ? `Undo: ${m.undo}` : 'Nothing to undo';
        undoBtn.setAttribute('aria-label', m.undo ? `Undo: ${m.undo}` : C.buttons.undo);
    }

    return {
        element,
        /** Where the sets of Venn and UpSet are drawn (V1). */
        setsElement: setsSlot,
        paint,
        /**
         * Open an input's Choose levels or binning pop-over and focus it: the way out of a refusal (UX 4.3).
         * @param {string} field - 'x' or 'y'
         * @param {'levels'|'binning'} what
         */
        reveal(field, what) {
            const entry = editors.get(field);
            if (!entry || entry.kind !== what) return;
            entry.pop.open();
        },
        /** The selects are filled again: the dataset or the panels changed (a provider's entities, the structure). */
        refill() {
            for (const row of rows.values()) row.sig = null;
            modesFilled = false;
        },
        destroy() {
            for (const field of [...editors.keys()]) destroyEditor(field);
            colorPop.destroy();
        }
    };
}

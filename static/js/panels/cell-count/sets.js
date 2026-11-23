/**
 * The Sets row of a count plot in Venn and UpSet mode (UX 4.6, UX 2.8; CNT-5, CNT-11 to CNT-13, SHR-38), and the
 * drawing of those two modes.
 *
 * `installSets(PARTS)` fills panels/cell-count.js's seams: `PARTS.sets` (`mount(host, ctx)` draws the set list in the
 * Sets row; `memberFor(set)` is a set's member on the wire) and `PARTS.draw.venn` / `.upset` (the figure: the SetPlot of
 * utils/set-plot-model.js, drawn by draw-sets.js `buildFigure`).
 *
 * The list: one row per set, lettered, with its text, its cells, its cells without a value ("312 without a value,
 * counted as out"), its tag, and ⋯, which opens the kind's inline row (UX 4.6) with Rename and Remove. Add set offers
 * the five kinds and stops at 16. Every edit is one undoable step through the panel's `commit`.
 *
 * A group set names one group of a grouping (utils/group-reference.js). The grouping is watched through the page's
 * group sources as a plot (consumer kind 'plot', role 'set'), which shares its request with everything else that reads
 * it; its groups by key with their default labels (group-sources.js `labelsOf`) say where each group set stands:
 * "Group changed" with the sentence once and Keep / Choose another; one line with Keep all / Review for several; "no
 * longer a group". After Keep a set follows its key, and its stored labels are updated through the panel's `silent`
 * (no history step). Menus that pick a panel mark a choice that would close a loop (decision 15).
 *
 * Nothing here runs per paint of the plot: the list is drawn again only when what it shows changes.
 */
import { VOCABULARY } from '../../utils/vocabulary.js';
import { DataManager } from '../../data-manager.js';
import { makeDom } from '../gene-set-utilities/dom.js';
import {
    SET_KINDS, setKind, setText, memberOnWire, setStates, setPlotModel, upsetOptions, parseUpsetOption, withUpsetOption,
    canAddSet, panelChoices, categoryChoices, groupingOfSet, isBooleanColumn, universeLine, setCounts
} from '../../utils/set-plot-model.js';
import { keepGroup, referToGroup } from '../../utils/group-reference.js';
import { canonKey } from '../../utils/level-id.js';
import { GROUPING_LIMITS } from '../../utils/cell-grouping.js';
import { buildFigure } from './draw-sets.js';
import { settingOf, sourceFromSetting, isNumericSource } from './controls-model.js';
import { setupAxisSelector, takeSubKey } from '../plot-utilities/panel-ui-update.js';
import { groupSources, panelOf, typeOf, structureRead, sourceTitleOf, titleOfPanel } from '../../utils/group-host.js';
import { TABLE_SOURCE, GROUP_SOURCE } from '../cell-grouping/factors.js';

const W = VOCABULARY.countSets;
const C = VOCABULARY.countPlot;
const SET_MODES = Object.freeze(['venn', 'upset']);
const OPS = Object.freeze(['>', '>=', '<', '<=']);
/** The panel types whose panels a set can name, by the source type that names them. */
const PANEL_TYPES = Object.freeze({ [TABLE_SOURCE]: 'cell-table', [GROUP_SOURCE]: 'cell-grouping' });
/** The consumer whose providers a condition's selects list: the cell plot's, as the count plot's other selects. */
const MENU_CONSUMER = 'cell-plot';

/** panel id -> its mounted set list */
const instances = new Map();

/** The panels of a type, as a menu lists them. */
function panelsOfType(type) {
    const pm = globalThis.PanelManager;
    if (!pm) return [];
    return pm.getAllPanels().filter((p) => typeOf(p) === type).map((p) => ({ id: p.getId(), title: p.getTitle() }));
}

/** The obs columns a kind lists: booleans for a boolean column, the other non-numeric ones for levels. */
function obsColumns(structure, kind) {
    const obs = structure && structure.obs;
    if (!obs) return [];
    const index = obs.index;
    return (obs.columns || []).filter((c) => c !== '_index' && c !== index).filter((c) => (kind === 'boolean'
        ? isBooleanColumn(structure, c) : !isBooleanColumn(structure, c) && !isNumericSource({ type: 'obs', key: c }, structure)));
}

/** dataset + column -> {ids, labels} | {tooMany} | Promise: the categories a "Levels of a column" set picks from. */
const categoryCache = new Map();

/**
 * The categories of an obs column as level ids, most frequent first (the obs route's whole-column ranking), or null
 * while they load (`onLoaded` is called once they are in). A column of more categories than a grouping's level limit
 * is not listed: a condition or a grouping is the way there.
 */
function categoriesOf(structure, column, onLoaded) {
    const dataset = DataManager.getCurrentDataset();
    const key = `${dataset}\u0001${column}`;
    const got = categoryCache.get(key);
    if (got && !(got instanceof Promise)) return got;
    if (got) return null;
    const info = structure.obs.columns_info[column] || {};
    const n = Number.isInteger(info.n_categories) ? info.n_categories : 0;
    if (n > GROUPING_LIMITS.levels) {
        const out = { tooMany: n };
        categoryCache.set(key, out);
        return out;
    }
    const ranks = Array.from({ length: n }, (_, i) => i);
    const loading = DataManager.loadCategoryLabels(dataset, column, ranks).then((labels) => {
        categoryCache.set(key, categoryChoices(ranks.map((r) => labels.get(r))));
        onLoaded();
    }, (error) => {
        categoryCache.delete(key);
        console.error('Count plot sets:', error);
    });
    categoryCache.set(key, loading);
    return null;
}

/** Two sets are the same request: the same source and the same member on the wire (a stored name or Keep aside). */
const wireOf = (set) => JSON.stringify([set.source, memberOnWire(set) || null]);

// ================================================================================================ the drawing

/** The Venn and UpSet figure (cell-count.js `PARTS.draw[mode].figure`). */
function figure(config, table, opts) {
    const inst = instances.get(opts.panelId);
    const sets = config.sets || [];
    const names = sets.map((set) => setText(set, inst ? inst.textContext() : { titleOf: sourceTitleOf, structure: structureRead() }));
    const states = inst ? inst.statesOf(sets).rows.map((r) => r.state) : [];
    const plot = setPlotModel(config, table, { names, states, words: { ...(opts.words || C), measureSource: opts.measureSource } });
    if (inst) inst.drew(sets, plot, states);
    const fig = buildFigure(plot, opts.theme, {
        width: inst ? inst.width() : undefined, colorscale: opts.options && opts.options.colorscale, colour: opts.options && opts.options.colour
    });
    return { data: fig.data, layout: fig.layout };
}

/**
 * Fill the count plot's seams for sets.
 * @param {{sets: ?Object, draw: Object}} parts - panels/cell-count.js `PARTS`
 */
export function installSets(parts) {
    parts.sets = { mount, memberFor: memberOnWire };
    const part = Object.freeze({ figure });
    for (const mode of SET_MODES) parts.draw[mode] = part;
}

// ================================================================================================ the list

/**
 * Draw the set list into the Sets row.
 * @param {HTMLElement} host - the Sets row (controls.js `setsElement`)
 * @param {{panelId: string, config: () => Object, commit: (config: Object, label: string) => void,
 *   silent: (config: Object) => void, visible: () => boolean, redraw: () => void}} ctx
 * @returns {{paint: () => void, destroy: () => void}}
 */
function mount(host, ctx) {
    const D = makeDom(document);
    const { el } = D;
    const id = ctx.panelId;
    /** grouping id -> its handle, while a group set or an open menu reads it */
    const watches = new Map();
    /** grouping id -> the session's memory of the changes said (group-reference.js `seen`) */
    const seen = new Map();
    /** grouping id -> the state and reply last heard, so a progress frame redraws nothing */
    const heard = new Map();
    let drawn = { sets: null, plot: null };
    let drawnStates = '';
    const expanded = new Set();
    /** set index -> what its open row holds before it is committed (a grouping chosen, a condition's selects) */
    const holders = new Map();
    let draft = null;
    let reviewing = false;
    let renaming = -1;
    let problem = '';
    let paintedFrom = null;
    let groupsVersion = 0;
    let pendingSilent = false;
    let alive = true;

    const addSelect = el('select', { class: 'form-select form-select-sm ccnt-sets__add', aria: { label: W.add },
        on: { change: () => { const kind = addSelect.value; addSelect.value = ''; if (kind) { draft = { kind, history: {} }; paint(); } } } });
    const head = el('div', { class: 'ctl-row ccnt-sets__head' }, el('span', { class: 'ctl-label', text: C.rows.sets }), addSelect);
    const summary = el('div', { class: 'ccnt-sets__summary', role: 'status', hidden: true }, el('p', { class: 'ccnt-sets__summary-text' }),
        el('span', { class: 'ccnt-sets__summary-actions' }));
    const list = el('ol', { class: 'ccnt-sets__list' });
    const universe = el('div', { class: 'ccnt-sets__universe', hidden: true });
    const upset = el('div', { class: 'ctl-row ccnt-sets__upset', hidden: true });
    const upsetProblem = el('div', { class: 'ccnt-sets__problem', role: 'alert', hidden: true });
    host.append(head, summary, list, universe, upset, upsetProblem);
    buildUpsetLine();
    instances.set(id, api());

    // ---------------------------------------------------------------- the groupings read

    function labelledOf(gid) {
        const h = watches.get(gid);
        const snap = h ? h.read() : null;
        return snap && snap.state === 'ready' && snap.values && snap.values.reply ? groupSources().sources.labelsOf(gid, snap.values.reply) : null;
    }

    /** The groups of a grouping as its menu lists them: key and name, or null while they are computed. */
    function groupsOf(gid) {
        const h = watches.get(gid);
        const snap = h ? h.read() : null;
        if (!snap || snap.state !== 'ready' || !snap.values || !snap.values.reply) return null;
        const reply = snap.values.reply;
        const names = groupSources().sources.namesOf(gid, reply);
        return reply.groups.map((g, i) => ({ key: g.key, name: names[i] }));
    }

    function seenOf(gid) {
        if (!seen.has(gid)) seen.set(gid, new Map());
        return seen.get(gid);
    }

    const statesCtx = {
        exists: (pid) => !!panelOf(pid),
        labelledOf,
        seenOf,
        titleOf: (gid) => titleOfPanel(gid)
    };

    /** Watch every grouping a group set or the open menu names; release the others. */
    function syncWatches(config) {
        const want = new Set();
        if (SET_MODES.includes(config.mode)) {
            for (const set of config.sets || []) { const g = groupingOfSet(set); if (g && panelOf(g)) want.add(g); }
            for (const h of [draft, ...[...holders.values()].map((x) => x.holder)]) if (h && h.grouping && panelOf(h.grouping)) want.add(h.grouping);
        }
        for (const [gid, h] of watches) if (!want.has(gid)) { h.release(); watches.delete(gid); heard.delete(gid); }
        for (const gid of want) {
            if (watches.has(gid)) continue;
            watches.set(gid, groupSources().sources.watch(gid, {
                consumer: { kind: 'plot', role: 'set', panelId: id }, option: {}, visible: ctx.visible,
                onChange: (snap) => {
                    // a progress frame changes nothing the list shows: only a new state or a new reply does
                    const now = `${snap && snap.state}`;
                    const reply = snap && snap.values ? snap.values.reply : null;
                    const was = heard.get(gid);
                    if (was && was.state === now && was.reply === reply) return;
                    heard.set(gid, { state: now, reply });
                    groupsVersion++;
                    if (alive) groupsChanged();
                }
            }));
        }
    }

    /** A grouping's groups arrived or moved: the list says it, and the drawing when a set's state changed. */
    function groupsChanged() {
        paint();
        const now = JSON.stringify(setStates(drawn.sets || [], statesCtx).rows.map((r) => r.state));
        if (drawn.plot && now !== drawnStates) ctx.redraw();
    }

    /** What the open row of set `i` holds: the set itself until the row changes something not yet committed. */
    function holderOf(i, set) {
        const sig = JSON.stringify(set);
        const was = holders.get(i);
        if (was && was.sig === sig) return was.holder;
        const holder = { source: set.source, member: set.member, history: {} };
        holders.set(i, { sig, holder });
        return holder;
    }

    // ---------------------------------------------------------------- texts

    function textContext() {
        return {
            titleOf: sourceTitleOf, structure: structureRead(),
            separatorOf: (gid) => { const l = labelledOf(gid); return l ? l.separator : ' | '; }
        };
    }

    /** The drawn set of a set of the config now, by its request: its size and cells without a value. */
    function drawnSetOf(set) {
        if (!drawn.plot) return null;
        const at = drawn.sets.findIndex((s) => wireOf(s) === wireOf(set));
        return at >= 0 ? drawn.plot.sets[at] : null;
    }

    // ---------------------------------------------------------------- commits

    function commitSets(sets, label) {
        ctx.commit({ ...ctx.config(), sets }, label);
    }

    function replaceSet(i, next, label) {
        const sets = [...(ctx.config().sets || [])];
        sets[i] = next;
        commitSets(sets, label);
    }

    /** A set made or edited in a row: the draft is added (and its row stays open for levels), a set is replaced. */
    function apply(at, set) {
        const name = setText(set, textContext());
        if (at === 'draft') {
            // the draft's input may report a change once more as its row goes (a blur after Enter)
            if (!draft) return;
            const sets = [...(ctx.config().sets || []), set];
            const kind = draft.kind;
            draft = null;
            if (kind === 'levels') expanded.add(sets.length - 1);
            commitSets(sets, `add ${VOCABULARY.word.set} ${name}`);
            return;
        }
        const was = ctx.config().sets[at];
        replaceSet(at, was.name ? { ...set, name: was.name } : set, `${VOCABULARY.word.set} ${name}`);
    }

    function remove(i) {
        const sets = [...(ctx.config().sets || [])];
        const [gone] = sets.splice(i, 1);
        expanded.clear();
        holders.clear();
        renaming = -1;
        commitSets(sets, `remove ${VOCABULARY.word.set} ${setText(gone, textContext())}`);
    }

    function keep(i) {
        const set = ctx.config().sets[i];
        const labelled = labelledOf(groupingOfSet(set));
        if (!labelled) return;
        replaceSet(i, { ...set, member: keepGroup(set.member, labelled) }, `keep ${VOCABULARY.word.group} ${setText(set, textContext())}`);
    }

    function keepAll(rows) {
        const sets = (ctx.config().sets || []).map((set, i) => {
            if (rows[i].state !== 'changed') return set;
            const labelled = labelledOf(groupingOfSet(set));
            return labelled ? { ...set, member: keepGroup(set.member, labelled) } : set;
        });
        reviewing = false;
        commitSets(sets, `keep ${VOCABULARY.plural.group}`);
    }

    function chooseAnother(i) {
        expanded.add(i);
        paint(true);
        const select = list.querySelector(`.ccnt-set[data-set-index="${i}"] select[data-field="group"], .ccnt-set[data-set-index="${i}"] select`);
        if (select) select.focus();
    }

    /** Following sets whose labels moved: their new labels, stored with no history step (UX 2.8). */
    function storeFollowed(rows) {
        if (pendingSilent || !rows.some((r) => r.update)) return;
        pendingSilent = true;
        queueMicrotask(() => {
            pendingSilent = false;
            if (!alive) return;
            const config = ctx.config();
            const now = setStates(config.sets || [], statesCtx).rows;
            if (!now.some((r) => r.update)) return;
            ctx.silent({ ...config, sets: config.sets.map((set, i) => (now[i] && now[i].update ? { ...set, member: now[i].update } : set)) });
        });
    }

    // ---------------------------------------------------------------- the UpSet line

    function buildUpsetLine() {
        const sort = el('select', { class: 'form-select form-select-sm', data: { upset: 'sort' }, aria: { label: W.sort },
            on: { change: () => { problem = ''; ctx.commit(withUpsetOption(ctx.config(), 'sort', sort.value), `${W.sort.toLowerCase()} ${W.sortBy[sort.value]}`); } } },
        ...['size', 'degree'].map((v) => el('option', { value: v, text: W.sortBy[v] })));
        const number = (field, label) => {
            const input = el('input', { type: 'text', inputmode: 'numeric', class: 'form-control form-control-sm ccnt-sets__number', data: { upset: field }, aria: { label } });
            const take = () => {
                const parsed = parseUpsetOption(field, input.value);
                if (!parsed.ok) { problem = parsed.message; paint(true); return; }
                problem = '';
                ctx.commit(withUpsetOption(ctx.config(), field, parsed.value), `${label.toLowerCase()} ${parsed.value}`);
                paint(true);
            };
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); take(); } });
            input.addEventListener('change', take);
            return [el('label', { class: 'ctl-label', text: label }), input];
        };
        upset.append(el('label', { class: 'ctl-label', text: W.sort }), sort, ...number('top', W.top), ...number('minSize', W.minSize));
    }

    function paintUpsetLine(config) {
        upset.hidden = config.mode !== 'upset';
        upsetProblem.hidden = upset.hidden || !problem;
        upsetProblem.textContent = problem;
        if (upset.hidden) return;
        const o = upsetOptions(config);
        upset.querySelector('[data-upset="sort"]').value = o.sort;
        for (const field of ['top', 'minSize']) {
            const input = upset.querySelector(`[data-upset="${field}"]`);
            if (document.activeElement !== input || !problem) input.value = String(o[field]);
        }
    }

    // ---------------------------------------------------------------- the inline row of each kind

    function option(value, text, extra = {}) {
        const o = el('option', { value, text });
        if (extra.disabled) { o.disabled = true; o.title = extra.title || ''; }
        if (extra.selected) o.selected = true;
        return o;
    }

    /** A select of panels (tables or groupings), with a choice that would close a loop unavailable and why. */
    function panelSelect(field, type, chosen, onPick) {
        const choices = panelChoices(panelsOfType(type), id);
        const select = el('select', { class: 'form-select form-select-sm', data: { field }, aria: { label: W.kinds[field === 'table' ? 'table' : 'group'] },
            on: { change: () => { if (select.value) onPick(select.value); } } },
        option('', W.choose, { selected: !chosen }),
        ...choices.map((c) => option(c.value, c.label, { disabled: c.disabled, title: c.title, selected: c.value === chosen })));
        return select;
    }

    /** The editor of one set (`at` its index) or of the draft: what the kind's inline row of UX 4.6 holds. */
    function editor(at, kind, holder) {
        const structure = structureRead();
        const row = el('div', { class: 'ctl-row ccnt-set__editor', data: { kind } });
        const problemEl = el('div', { class: 'ccnt-set__problem', role: 'alert', hidden: !holder.problem }, holder.problem || '');
        switch (kind) {
            case 'table':
                row.append(panelSelect('table', PANEL_TYPES[TABLE_SOURCE], holder.source && holder.source.key,
                    (key) => apply(at, { source: { type: TABLE_SOURCE, key } })));
                break;
            case 'boolean': {
                const chosen = holder.source && holder.source.key;
                const select = el('select', { class: 'form-select form-select-sm', data: { field: 'column' }, aria: { label: W.kinds.boolean },
                    on: { change: () => { if (select.value) apply(at, { source: { type: 'obs', key: select.value }, member: { levels: ['c:true'] } }); } } },
                option('', W.choose, { selected: !chosen }), ...obsColumns(structure, 'boolean').map((c) => option(c, c, { selected: c === chosen })));
                row.append(select);
                break;
            }
            case 'levels': row.append(...levelsEditor(at, holder, structure)); break;
            case 'condition': row.append(...conditionEditor(at, holder, structure)); break;
            default: row.append(...groupEditor(at, holder));
        }
        return [row, problemEl];
    }

    function levelsEditor(at, holder, structure) {
        const column = holder.source && holder.source.key;
        const chosen = (holder.member && holder.member.levels) || [];
        const select = el('select', { class: 'form-select form-select-sm', data: { field: 'column' }, aria: { label: W.kinds.levels },
            on: { change: () => {
                if (!select.value) return;
                holder.source = { type: 'obs', key: select.value };
                holder.member = { levels: [] };
                paint(true);
            } } },
        option('', W.choose, { selected: !column }), ...obsColumns(structure, 'levels').map((c) => option(c, c, { selected: c === column })));
        const box = el('div', { class: 'ccnt-set__levels' });
        if (column && structure) {
            const cats = categoriesOf(structure, column, () => { if (alive) paint(true); });
            if (!cats) box.textContent = '…';
            else if (cats.tooMany) box.textContent = W.tooManyCategories(cats.tooMany, GROUPING_LIMITS.levels);
            else {
                cats.ids.forEach((lid, i) => {
                    const input = el('input', { type: 'checkbox', class: 'form-check-input', value: lid, checked: chosen.includes(lid),
                        on: { change: () => {
                            const next = input.checked ? [...chosen, lid] : chosen.filter((x) => x !== lid);
                            if (!next.length) return;
                            apply(at, { source: { type: 'obs', key: column }, member: { levels: next } });
                        } } });
                    box.append(el('label', { class: 'form-check form-check-inline' }, input, ` ${cats.labels[i]}`));
                });
            }
        }
        return [select, box];
    }

    function conditionEditor(at, holder, structure) {
        if (!holder.setting) holder.setting = settingOf(holder.source ? { source: holder.source } : null, holder.history || (holder.history = {}));
        const s = holder.setting;
        const axis = `set-${at}`;
        const type = el('select', { class: 'form-select form-select-sm axis-type-select', data: { axis }, aria: { label: W.kinds.condition } });
        const key = el('select', { class: 'form-select form-select-sm axis-key-select', data: { axis }, disabled: true });
        const column = el('select', { class: 'form-select form-select-sm axis-column-select', data: { axis }, disabled: true });
        const selector = el('div', { class: 'axis-selector' }, type, key, column);
        const op = el('select', { class: 'form-select form-select-sm', data: { field: 'op' }, aria: { label: C.rows.above } },
            ...OPS.map((o) => option(o, W.ops[o], { selected: (holder.member ? holder.member.op : '>') === o })));
        const value = el('input', { type: 'text', inputmode: 'decimal', class: 'form-control form-control-sm ccnt-sets__number', data: { field: 'value' },
            value: holder.member && Number.isFinite(holder.member.value) ? String(holder.member.value) : '' });
        const setup = () => { if (structure) setupAxisSelector(selector, axis, s, 'cells', structure, { consumer: MENU_CONSUMER, roles: ['x'] }); };
        const take = () => {
            const source = sourceFromSetting(s);
            const v = Number(String(value.value).trim());
            const say = (text) => { holder.problem = text; const p = selector.closest('.ccnt-set').querySelector('.ccnt-set__problem'); p.textContent = text; p.hidden = !text; };
            if (!source || !isNumericSource(source, structure)) { say(W.needsNumber); return; }
            if (String(value.value).trim() === '' || !Number.isFinite(v)) { say(W.needsValue); return; }
            holder.problem = '';
            apply(at, { source, member: { op: op.value, value: v } });
        };
        type.addEventListener('change', () => { s.type = type.value; s.key = ''; s.column = ''; setup(); });
        key.addEventListener('change', () => { s.key = key.value; setup(); });
        column.addEventListener('change', () => { if (s.type && takeSubKey(s, column, id)) return; s.column = column.value; });
        op.addEventListener('change', () => { if (value.value.trim() !== '') take(); });
        value.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); take(); } });
        value.addEventListener('change', take);
        queueMicrotask(setup);
        return [selector, op, value];
    }

    function groupEditor(at, holder) {
        const gid = holder.grouping || (holder.source && holder.source.key) || '';
        const pick = panelSelect('grouping', PANEL_TYPES[GROUP_SOURCE], gid, (next) => {
            holder.grouping = next;
            paint(true);
        });
        if (!gid) return [pick];
        const groups = groupsOf(gid);
        const chosen = holder.member && holder.source && holder.source.key === gid ? canonKey(holder.member.group) : '';
        const select = el('select', { class: 'form-select form-select-sm', data: { field: 'group' }, aria: { label: W.kinds.group },
            on: { change: () => {
                const labelled = labelledOf(gid);
                const ref = labelled && select.value ? referToGroup(labelled, JSON.parse(select.value)) : null;
                if (ref) apply(at, { source: { type: GROUP_SOURCE, key: gid }, member: ref });
            } } },
        option('', groups ? (groups.length ? W.choose : W.noGroups) : W.computingGroups, { selected: !chosen }),
        ...(groups || []).map((g) => option(canonKey(g.key), g.name, { selected: canonKey(g.key) === chosen })));
        return [pick, select];
    }

    // ---------------------------------------------------------------- rows

    function noteBox(note, show, i) {
        const box = el('div', { class: 'ccnt-set__note', role: 'status', hidden: !show });
        box.append(el('p', { text: show ? note.text : '' }));
        if (show) for (const a of note.actions) box.append(actionButton(a, i));
        return box;
    }

    function actionButton(action, i) {
        return el('button', { type: 'button', class: 'btn btn-sm btn-outline-primary', data: { setAction: action.id },
            on: { click: () => (action.id === 'keep' ? keep(i) : chooseAnother(i)) } }, action.label);
    }

    function setRow(set, i, row, showNotes, texts) {
        const kind = setKind(set, structureRead());
        const drawnSet = drawnSetOf(set);
        const counts = drawnSet ? setCounts(drawnSet) : { cells: '', noValue: '' };
        const following = kind === 'group' && set.member.follow === true && row.state === 'ok';
        const name = texts[i] + (following ? ` ${W.follows}` : '');
        const tag = row.state === 'deleted' ? W.deleted : (row.note ? row.note.tag : '');
        const nameEl = renaming === i ? renameInput(set, i)
            : el('button', { type: 'button', class: 'btn btn-link btn-sm ccnt-set__name', title: W.buttons.rename, on: { click: () => { renaming = i; paint(true); } } }, name);
        const more = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary ccnt-set__more', aria: { label: W.buttons.more, expanded: expanded.has(i) },
            on: { click: () => { if (expanded.has(i)) expanded.delete(i); else expanded.add(i); paint(true); } } }, '⋯');
        const li = el('li', { class: 'ccnt-set', data: { setIndex: i, state: row.state, kind } },
            el('div', { class: 'ctl-row ccnt-set__line' },
                el('span', { class: 'ccnt-set__letter', text: 'ABCDEFGHIJKLMNOP'[i] }), nameEl,
                el('span', { class: 'ccnt-set__count', text: counts.cells }),
                el('span', { class: 'ccnt-set__novalue', text: counts.noValue }),
                el('span', { class: 'ccnt-set__tag', text: tag }), more));
        const show = !!row.note && !!row.note.text && (showNotes || row.state === 'gone');
        li.append(noteBox(row.note || { text: '', actions: [] }, show, i));
        // a set whose panel is gone keeps its row, marked deleted, with Choose another (SHR-38)
        if (row.state === 'deleted') li.querySelector('.ccnt-set__line').insertBefore(actionButton({ id: 'chooseAnother', label: W.buttons.chooseAnother }, i), more);
        const edit = el('div', { class: 'ccnt-set__edit', hidden: !expanded.has(i) });
        if (expanded.has(i)) {
            edit.append(...editor(i, kind, holderOf(i, set)));
            const actions = el('div', { class: 'ctl-row ccnt-set__actions' });
            if (row.note && row.state === 'changed') for (const a of row.note.actions) actions.append(actionButton(a, i));
            actions.append(
                el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', data: { setAction: 'rename' }, on: { click: () => { renaming = i; paint(true); } } }, W.buttons.rename),
                el('button', { type: 'button', class: 'btn btn-sm btn-outline-danger', data: { setAction: 'remove' }, on: { click: () => remove(i) } }, W.buttons.remove));
            edit.append(actions);
        }
        li.append(edit);
        return li;
    }

    function renameInput(set, i) {
        const input = el('input', { type: 'text', class: 'form-control form-control-sm ccnt-set__name', value: set.name || '', aria: { label: W.renameLabel },
            placeholder: setText({ ...set, name: undefined }, textContext()) });
        let done = false;
        const finish = (save) => {
            if (done) return;
            done = true;
            renaming = -1;
            const text = input.value.trim();
            if (!save || text === (set.name || '')) { paint(true); return; }
            const next = { ...set };
            if (text) next.name = text; else delete next.name;
            replaceSet(i, next, `rename ${VOCABULARY.word.set} ${text || setText(next, textContext())}`);
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') finish(false); });
        input.addEventListener('blur', () => finish(true));
        queueMicrotask(() => input.focus());
        return input;
    }

    function draftRow() {
        const li = el('li', { class: 'ccnt-set ccnt-set--draft', data: { kind: draft.kind } });
        li.append(el('div', { class: 'ctl-row ccnt-set__line' }, el('span', { class: 'ccnt-set__letter', text: 'ABCDEFGHIJKLMNOP'[(ctx.config().sets || []).length] }),
            el('span', { class: 'ccnt-set__kind', text: W.kinds[draft.kind] }),
            el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', data: { setAction: 'cancel' }, on: { click: () => { draft = null; paint(true); } } }, W.buttons.remove)));
        li.append(...editor('draft', draft.kind, draft));
        return li;
    }

    // ---------------------------------------------------------------- paint

    function paint(force = false) {
        if (!alive) return;
        const config = ctx.config();
        syncWatches(config);
        if (!SET_MODES.includes(config.mode)) return;
        const sets = config.sets || [];
        const states = setStates(sets, statesCtx);
        storeFollowed(states.rows);
        const texts = sets.map((set) => setText(set, textContext()));
        const add = canAddSet(config);
        const from = JSON.stringify([config, states, texts, groupsVersion, [...holders.values()].map((x) => x.holder), drawn.plot && drawn.plot.universe, drawn.plot && drawn.plot.inNone,
            drawn.plot && drawn.plot.sets.map((s) => s.size), [...expanded], draft, reviewing, renaming, problem]);
        if (!force && from === paintedFrom) return;
        paintedFrom = from;

        // Add set
        if (!addSelect.options.length) {
            addSelect.append(option('', W.add), ...SET_KINDS.map((k) => option(k, W.kinds[k])));
        }
        addSelect.disabled = !add.ok;
        addSelect.title = add.ok ? '' : add.reason;

        // one line for several changes
        const many = states.summary;
        summary.hidden = !many;
        D.clear(summary.querySelector('.ccnt-sets__summary-actions'));
        if (many) {
            summary.querySelector('p').textContent = many.text;
            for (const a of many.actions) {
                summary.querySelector('.ccnt-sets__summary-actions').append(el('button', { type: 'button', class: 'btn btn-sm btn-outline-primary', data: { setAction: a.id },
                    on: { click: () => { if (a.id === 'keepAll') keepAll(states.rows); else { reviewing = true; paint(true); } } } }, a.label));
            }
        } else reviewing = false;

        D.clear(list);
        sets.forEach((set, i) => list.append(setRow(set, i, states.rows[i], !many || reviewing, texts)));
        if (draft) list.append(draftRow());
        universe.hidden = !drawn.plot;
        universe.textContent = drawn.plot ? universeLine(drawn.plot) : '';
        paintUpsetLine(config);
    }

    function api() {
        return {
            textContext,
            statesOf: (sets) => setStates(sets, statesCtx),
            /** The drawing of these sets was made: their sizes go in the rows. */
            drew(sets, plot, rowStates) {
                drawn = { sets, plot };
                drawnStates = JSON.stringify(rowStates);
                queueMicrotask(() => paint());
            },
            /** The plot's width in pixels: an UpSet moves its set sizes under the matrix when it is narrow. */
            width() {
                const plot = host.closest('.ccnt-panel') && host.closest('.ccnt-panel').querySelector('.ccnt-plot');
                return plot && plot.clientWidth ? plot.clientWidth : undefined;
            }
        };
    }

    function destroy() {
        alive = false;
        for (const h of watches.values()) h.release();
        watches.clear();
        instances.delete(id);
        D.clear(host);
    }

    return { paint: () => paint(), destroy };
}

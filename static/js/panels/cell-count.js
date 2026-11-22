/**
 * Cell Count Plot panel (UX 4; CNT-1 to CNT-4, CNT-6, CNT-17, CNT-21).
 *
 * How many cells fall where, or a statistic of the cells where they fall: bars, a histogram, a pie, a 2D histogram and a
 * heatmap here, densities (V3) and Venn and UpSet (V1, V2) as they are built. Every mode is one `grid` request to the
 * cell_groups route (CNT-8), made by utils/count-plot-model.js from the stored config, so the panel holds no per-cell
 * data and draws the same at 100k and at 100M cells.
 *
 * The panel is a source of groups of the page (utils/group-host.js `groupSources()`, through `groupSource()` below, in
 * count-plot-model.js `gridShape`): the grid of its config is computed, cached, gated and shared there as a grouping's
 * groups are, and it watches its own grid as a plot. A config is a link's and a panel set's, and every edit is one
 * undoable step; a gene or cell that an input follows (CNT-17) moves with the focus and is no step.
 *
 * SEAMS for the steps after this one (`PARTS`):
 *   C2b  `states`: what the plot area says for a plan that is not ready and for the route's states, and the strip
 *        (UX 4.3, 4.7): `describe(snap, ctx) -> {text, actions: [[id, label]]} | null`. Until then a plain sentence.
 *        Save as grouping and Show as table go in Plot Options.
 *   V1   `sets`: `mount(host, ctx)` draws the set list in the Sets row (UX 4.6); `ctx.memberFor(set)` is then the wire
 *        form of a set's member, which planGrid asks for.
 *   V1, V2, V3  `draw[mode]`: `figure(config, table, opts) -> {data, layout}` for a mode draw.js does not draw. A mode
 *        with no drawing is listed in Mode, unavailable with the reason, and asks for nothing.
 *
 * It touches no DOM until init(): a closed count plot restored from a link or a panel set is constructed and never
 * initialised, and asks for nothing.
 */
import { PanelManager } from '../panel-manager.js';
import { DataManager } from '../data-manager.js';
import { makeDom } from './gene-set-utilities/dom.js';
import { noDatasetScreenHtml } from '../utils/no-dataset-screen.js';
import { setControlsVisible, syncControlsWithDataset } from '../utils/controls-visibility.js';
import { UndoStack } from '../utils/gene-signature.js';
import { normalizeCountPlot, gridShape, planGrid, readGrid, countTable, levelLabelsOf } from '../utils/count-plot-model.js';
import { countFigure, countCsv, DRAWN_MODES } from './cell-count/draw.js';
import { densityFigure, DENSITY_MODES } from './cell-count/draw-density.js';
import { createControls } from './cell-count/controls.js';
import {
    countReferences, shownConfig, drawOptions, inputNames, shownLabels, followFocus, measureSourceName, levelTotals,
    isNumericSource, levelCountOf, valueDefaults, rowsOf
} from './cell-count/controls-model.js';
import {
    groupSources, panelOf, isOpen, cycleIds, loadStructure, structureRead, resetStructure, sourceTitleOf
} from '../utils/group-host.js';
import { registerReferences } from '../utils/panel-references.js';
import { VOCABULARY } from '../utils/vocabulary.js';
import { describeSource } from '../utils/source-notices.js';
import { setupAxisSelector, typeChoices, takeSubKey } from './plot-utilities/panel-ui-update.js';
import { parseAlsoListed } from '../utils/source-registry.js';
import { PLOT_PALETTES } from '../utils/plot-theme.js';
import { currentTheme, THEME_EVENT } from '../utils/theme.js';
import { groupColours } from './plot-utilities/colors.js';
import { drawPlot } from '../utils/panel-surface.js';
import { Coverage, GAP } from '../utils/coverage.js';
import { installSets } from './cell-count/sets.js';
import './partition-options/binning-control.js';

const TYPE = 'cell-count';
/** Keys of a configuration that are the panel's own, not the plot's. */
const PANEL_KEYS = ['id', 'title', 'controlsVisible', '_closed', 'active'];
const C = VOCABULARY.countPlot;
/** The consumer whose providers the selects list (CNT-2): the cell plot's. */
const MENU_CONSUMER = 'cell-plot';

registerReferences(TYPE, countReferences);

/**
 * What later steps add to the panel (see the module's SEAMS).
 * @type {{states: ?{describe: Function}, sets: ?{mount: Function}, draw: Object<string, {figure: Function}>}}
 */
// export-unused-ok: C2b, V1, V2 and V3 register their parts here
export const PARTS = { states: null, sets: null, draw: {} };
installSets(PARTS);

/** Whether a mode can be drawn in this build. */
const drawable = (mode) => DRAWN_MODES.includes(mode) || DENSITY_MODES.includes(mode) || !!PARTS.draw[mode];

/** The words a notice of the route's states uses for a count (utils/source-notices.js `describeSource`). */
const NOTICE_WORDS = Object.freeze({
    thing: 'count', source: 'count', result: 'count', Computing: 'Counting', progressUnit: 'values', found: 'cells',
    act: { to: 'count', ing: 'counting' }, tags: { computing: 'Counting…' }, cycleKind: 'count'
});

/** States that pass by themselves: the plot keeps its drawing and the strip says the count is on its way. */
const ON_ITS_WAY = Object.freeze(['estimating', 'queued', 'computing', 'updating']);

const fmt = (n) => Number(n).toLocaleString('en-US');

/**
 * A plain sentence for a plan that asks nothing (C2b says these with their way out, UX 4.3).
 * @param {Object} snap - a snapshot whose state is the plan's
 * @param {(field: string) => string} nameOf - the name of an input
 */
function planSentence(snap, nameOf) {
    const mode = C.modes[snap.mode] || snap.mode;
    if (snap.state === 'empty') return C.empty[snap.reason] || '';
    if (snap.reason === 'needs_numeric') return C.needsNumeric(mode, C.rows[snap.input], nameOf(snap.input));
    if (snap.reason === 'too_many_sets' && snap.mode === 'venn') return C.tooManySets;
    if (Array.isArray(snap.over) && snap.over.length) {
        const i = snap.inputs.indexOf(snap.over[0]);
        const noun = snap.reason === 'too_many_bins' ? 'bins' : VOCABULARY.plural.level;
        return `${nameOf(snap.over[0])} has ${fmt(snap.counts[i])} ${noun}; ${mode} shows up to ${fmt(snap.limits[i])}.`;
    }
    if (snap.reason === 'grid_too_large') return `${mode} would count ${fmt(snap.counts[0])} cells of a grid; it counts up to ${fmt(snap.limits[0])}.`;
    return '';
}

/**
 * What the plot shows of the cells shown (the panel surface states it): the cells counted, and the cells left out, each
 * reason apart: without a value on an input, outside an excluded range, in levels left out.
 * @param {Object} table - from countTable
 * @param {Object} names - the inputs' names
 */
function coverageOf(table, names) {
    const gaps = [];
    let accounted = 0;
    for (const [input, n] of Object.entries(table.noValue)) {
        if (!(n > 0)) continue;
        gaps.push({ reason: GAP.FILTERED, detail: `without a value for ${names[input] || input}`, source: names[input] || '', count: n });
        accounted += n;
    }
    if (table.outside > 0) {
        gaps.push({ reason: GAP.FILTERED, detail: 'outside the range', source: '', count: table.outside });
        accounted += table.outside;
    }
    const rest = table.shown - table.total - accounted;
    if (rest > 0) gaps.push({ reason: GAP.FILTERED, detail: `in ${VOCABULARY.plural.level} left out`, source: '', count: rest });
    return new Coverage({ shown: table.total, total: table.shown, unit: 'cells', gaps });
}

/** Whether a snapshot is a plan's own (no input yet, an input the mode cannot use, a limit), not the route's. */
const isPlanState = (snap) => !!snap && (snap.state === 'empty' || snap.state === 'unusable' || (snap.state === 'refused' && Array.isArray(snap.inputs)));

(function () {
    /**
     * @param {HTMLElement} container
     * @param {Object} options - a saved configuration
     */
    function CellCountPanel(container, options = {}) {
        const _id = options.id || `${TYPE}-${Date.now()}`;
        let _title = options.title || 'Cell Count Plot 1';
        let _controlsVisible = options.controlsVisible;
        let _config = configFrom(options);
        const _undo = new UndoStack();

        // derived, never saved
        let _initialized = false;
        let _dom = null;
        let D = null;
        let _controls = null;
        let _sets = null;
        let _handle = null;
        let _snap = null;
        let _visible = true;
        let _observer = null;
        let _resize = null;
        let _structureVersion = 0;
        /** store key -> the config that made its grid */
        const _made = new Map();
        /** What the plot and the controls were last drawn from: drawn again only when one of these changes */
        let _drawnFrom = null;
        let _controlsFrom = null;
        let _drawing = null;                 // {config, table, labels, names} of the drawing shown, for the CSV
        let _infos = {};
        let _labelMaps = {};
        let _notes = null;
        let _drawSerial = 0;
        const _listeners = [];
        /** the shape and the shown config of `_config`, made once per config */
        let _shape = null;
        let _shownOf = { config: null, shown: null };

        function configFrom(raw) {
            const fields = {};
            for (const [k, v] of Object.entries(raw || {})) if (!PANEL_KEYS.includes(k)) fields[k] = v;
            return normalizeCountPlot(fields).config;
        }

        /** The config as the mode shows it (controls.js `shownConfig`), the same object until the config changes. */
        function shown() {
            if (_shownOf.config !== _config) _shownOf = { config: _config, shown: shownConfig(_config) };
            return _shownOf.shown;
        }

        // ---------------------------------------------------------------- what the page's group sources read

        /** What planGrid asks of the page: which sources are numbers, how many levels an input has. */
        const page = {
            isNumeric: (source) => isNumericSource(source, structureRead()),
            levelCount: (p) => levelCountOf(p, structureRead()),
            memberFor: (set) => {
                if (PARTS.sets && PARTS.sets.memberFor) return PARTS.sets.memberFor(set);
                throw new Error('A set\'s member on the wire comes with the sets (V1).');
            }
        };

        /** This panel as a source of groups: its config, read in count-plot-model.js `gridShape`. */
        function groupSource() {
            if (!_shape) _shape = gridShape(page);
            return { title: _title, kind: 'count', recipe: () => shown(), shape: _shape };
        }

        // ---------------------------------------------------------------- life cycle

        function init() {
            D = makeDom(document);
            _initialized = true;
            buildDom();
            listen(document, 'focusedGeneChanged', onFocus);
            listen(document, 'focusedCellChanged', onFocus);
            listen(window, THEME_EVENT, () => { _drawnFrom = null; draw(); });
            const loaded = DataManager.isDatasetLoaded();
            _dom.noData.style.display = loaded ? 'none' : 'flex';
            syncControlsWithDataset(_dom.controls, loaded);
            if (typeof IntersectionObserver !== 'undefined') {
                _observer = new IntersectionObserver((entries) => {
                    const now = !!entries[entries.length - 1].isIntersecting;
                    if (now === _visible) return;
                    _visible = now;
                    groupSources().sources.visibilityChanged();
                });
                _observer.observe(_dom.root);
            }
            if (typeof ResizeObserver !== 'undefined') {
                let frame = 0;
                _resize = new ResizeObserver(() => {
                    cancelAnimationFrame(frame);
                    frame = requestAnimationFrame(() => { if (_dom && _dom.plot._fullLayout && window.Plotly) window.Plotly.Plots.resize(_dom.plot); });
                });
                _resize.observe(_dom.plotArea);
            }
            paint();
            return loaded ? datasetReady() : undefined;
        }

        async function datasetReady() {
            try { await loadStructure(); } catch (error) { console.error(`Cell count plot ${_id}:`, error); }
            if (!_initialized) return;
            _structureVersion++;
            if (_controls) _controls.refill();
            follow();
            watch();
            groupSources().sources.recheck();
            refresh();
        }

        function refresh() {
            if (_handle) { _snap = _handle.read(); noteKey(_snap); }
            paint();
        }

        function listen(target, type, fn) {
            target.addEventListener(type, fn);
            _listeners.push([target, type, fn]);
        }

        /** Drop the DOM, the listeners and the handle. The config stays: a closed count plot is still its config. */
        function cleanup() {
            for (const [target, type, fn] of _listeners.splice(0)) target.removeEventListener(type, fn);
            release();
            if (_observer) _observer.disconnect();
            if (_resize) _resize.disconnect();
            _observer = _resize = null;
            if (_controls) _controls.destroy();
            if (_sets) _sets.destroy();
            _sets = null;
            if (_dom && window.Plotly && _dom.plot) window.Plotly.purge(_dom.plot);
            _controls = null;
            _initialized = false;
            _dom = null;
            _drawnFrom = _controlsFrom = _drawing = null;
            container.innerHTML = '';
        }

        // ---------------------------------------------------------------- the grid

        /** Watch the grid while the mode can be drawn; a mode with no drawing asks for nothing. */
        function watch() {
            if (!_initialized || !DataManager.isDatasetLoaded()) return;
            if (!drawable(_config.mode)) { release(); return; }
            if (_handle) return;
            _handle = groupSources().sources.watch(_id, {
                consumer: { kind: 'plot', panelId: _id, role: 'panel' }, option: {},
                visible: () => _visible && !!_dom && _dom.root.isConnected,
                onChange: (snap) => { _snap = snap; noteKey(snap); paint(); }
            });
            _snap = _handle.read();
            noteKey(_snap);
        }

        function release() {
            if (_handle) _handle.release();
            _handle = null;
            _snap = null;
        }

        /**
         * The config that made a key's grid: the config now when the grid shown is of it (ready, nothing held or being
         * checked: a change of style or arrangement asks for nothing and is drawn at once), else the one noted when the
         * key was first read, which keeps the previous drawing right while an edit computes.
         */
        function noteKey(snap) {
            const key = snap && (snap.shownKey || snap.key);
            if (!key) return;
            const st = groupSources().sources.status(_id);
            const current = snap.state === 'ready' && !snap.held && !(st && (st.held || st.checking));
            if (current || !_made.has(key)) _made.set(key, shown());
            if (_made.size > 20) _made.delete(_made.keys().next().value);
        }

        /** The inputs of a config's grid, in the order of its axes (planGrid's), or null when it asks nothing. */
        const _inputs = new WeakMap();
        /** config -> its grid request as text: two configs with the same text read the same grid */
        const _requests = new WeakMap();
        function inputsOf(config) {
            if (!_inputs.has(config)) {
                let plan;
                // a mode whose plan needs a part not built yet (a set's member on the wire) asks nothing
                try { plan = planGrid(config, page); } catch { plan = null; }
                _inputs.set(config, plan && plan.state === 'ready' ? plan.inputs : null);
                _requests.set(config, plan && plan.state === 'ready' ? JSON.stringify(plan.request) : null);
            }
            return _inputs.get(config);
        }

        /** The reply read with the names of its groupings' levels, the same object while the reply and names are. */
        const _named = new WeakMap();
        function namedValues(values) {
            const reading = groupSources().sources.replyOf(_id, values.reply);
            const was = _named.get(values);
            if (was && was.reply === reading) return was;
            const out = { reply: reading, counts: values.counts, measures: values.measures };
            _named.set(values, out);
            return out;
        }

        /** The table shown and the config that made it, or null when there is nothing to draw. */
        function shownTable() {
            const snap = _snap;
            if (!snap || !snap.values || !snap.values.reply || isPlanState(snap)) return null;
            const key = snap.shownKey || snap.key;
            const made = _made.get(key) || shown();
            const inputs = inputsOf(made);
            if (!inputs) return null;
            let grid;
            try { grid = readGrid(namedValues(snap.values)); } catch (error) {
                console.error(`Cell count plot ${_id}:`, error);
                return null;
            }
            if (grid.dims.length !== inputs.length) return null;
            return { made, inputs, grid };
        }

        // ---------------------------------------------------------------- the config

        function getConfig() {
            const cfg = { title: _title, ..._config };
            if (_controlsVisible !== undefined) cfg.controlsVisible = _controlsVisible;
            return cfg;
        }

        /** One undoable step: the config becomes `next`. */
        function commit(next, label) {
            const before = _config;
            const now = normalizeCountPlot(next).config;
            if (JSON.stringify(now) === JSON.stringify(before)) { paint(); return; }
            _undo.push(label, [JSON.stringify(before)]);
            _config = now;
            changed();
        }

        /** The config follows the focus (CNT-17): no step of its own, as a cell plot's axis. */
        function silent(next) {
            _config = normalizeCountPlot(next).config;
            changed();
        }

        function undo() {
            const step = _undo.pop();
            if (!step) return false;
            _config = normalizeCountPlot(JSON.parse(step.before[0])).config;
            changed();
            return true;
        }

        /** The config changed: the grid, the saved state and the history hear it. */
        function changed() {
            if (_initialized) {
                watch();
                groupSources().sources.sourceChanged(_id);
                paint();
            }
            if (window.sessionManager && typeof window.sessionManager.notifyPanelUpdate === 'function') window.sessionManager.notifyPanelUpdate();
        }

        function updateConfig(config) {
            if (!config) return;
            if (config.title && config.title !== _title) { _title = config.title; groupSources().sources.sourceChanged(_id); _drawnFrom = null; paint(); }
            if (config.controlsVisible !== undefined) {
                _controlsVisible = config.controlsVisible;
                showControls();
            }
            const keys = Object.keys(config).filter((k) => !PANEL_KEYS.includes(k));
            if (!keys.length) return;
            // Back and Forward give a whole configuration (it has the version); a remap gives the fields it rewrote
            _config = configFrom('version' in config ? config : { ..._config, ...config });
            if (_initialized) changed();
        }

        function onFocus() {
            if (!_initialized) return;
            follow();
        }

        /** Unlocked layer and obsp sources take the focused gene and cell. */
        function follow() {
            const next = followFocus(_config, { gene: DataManager.getFocusedGene() || null, cell: focusedCellName() });
            if (next) silent(next);
        }

        function focusedCellName() {
            const c = DataManager.getFocusedCell && DataManager.getFocusedCell();
            return typeof c === 'string' ? c : (c && c.name) || null;
        }

        // ---------------------------------------------------------------- DOM

        function buildDom() {
            const { el } = D;
            const root = el('div', { class: 'ccnt-panel', data: { panelId: _id } });
            root.insertAdjacentHTML('afterbegin', noDatasetScreenHtml(_id));
            _controls = createControls({ D, id: _id, model: controlsModel, on: {
                commit, undo: () => undo(), csv: downloadCsv,
                setupAxis: (rowEl, axis, setting, roles) => {
                    const structure = structureRead();
                    if (structure) setupAxisSelector(rowEl, axis, setting, 'cells', structure, { consumer: MENU_CONSUMER, roles });
                },
                typeChoices: (roles) => typeChoices('cells', MENU_CONSUMER, roles),
                takeSubKey: (setting, select) => takeSubKey(setting, select, _id),
                parseListed: parseAlsoListed
            } });
            const plot = el('div', { class: 'ccnt-plot', id: `ccnt-plot-${_id}` });
            const state = el('div', { class: 'ccnt-state', role: 'status', aria: { live: 'polite' }, hidden: true },
                el('p', { class: 'ccnt-state__text' }), el('div', { class: 'ccnt-state__actions' }));
            const plotArea = el('div', { class: 'ccnt-plot-area' }, plot, state);
            const strip = el('div', { class: 'ccnt-strip', role: 'status', aria: { live: 'polite' } });
            root.append(_controls.element, plotArea, strip);
            root.addEventListener('keydown', onKey);
            container.innerHTML = '';
            container.appendChild(root);
            _dom = { root, controls: _controls.element, plot, plotArea, state, strip, noData: root.querySelector(`#loading-screen-${_id}`) };
            if (PARTS.sets && PARTS.sets.mount) {
                _sets = PARTS.sets.mount(_controls.setsElement, { panelId: _id, config: () => _config, commit, silent,
                    visible: () => _visible && !!_dom && _dom.root.isConnected, redraw: () => { _drawnFrom = null; paint(); } });
            }
            showControls();
        }

        function showControls() {
            if (!_dom) return;
            const visible = _controlsVisible !== false;
            if (!visible || _dom.controls.dataset.controlsHidden === 'true') setControlsVisible(_dom.controls, visible);
        }

        function onKey(e) {
            const typing = e.target && (e.target.tagName === 'INPUT' && e.target.type === 'text');
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing) {
                if (undo()) e.preventDefault();
            }
        }

        function controlsModel() {
            const step = _undo.peek();
            return {
                config: _config, structure: structureRead(), structureVersion: _structureVersion, titleOf: sourceTitleOf,
                focusedGene: DataManager.getFocusedGene() || null, focusedCell: focusedCellName(),
                infos: _infos, labelsOf: (field) => _labelMaps[field] || new Map(),
                isNumeric: page.isNumeric, drawable, undo: step ? step.label : null, canExport: !!_drawing, notes: _notes,
                valueDefaults: () => valueDefaults(_config, structureRead(), DataManager.getFocusedGene() || null)
            };
        }

        // ---------------------------------------------------------------- paint

        function paint() {
            if (!_dom) return;
            draw();
            paintState();
            const from = [_config, structureRead(), _structureVersion, _undo.peek(), _infos, !!_drawing, _notes];
            if (!_controlsFrom || from.some((x, i) => x !== _controlsFrom[i])) {
                _controlsFrom = from;
                _controls.paint();
                if (_sets) _sets.paint();
            }
        }

        /** The plot, made again only when the table, the config or the theme changed: never per progress frame. */
        function draw() {
            const found = shownTable();
            const theme = currentTheme() === 'dark' ? 'dark' : 'light';
            const live = shown();
            const from = [found && found.grid, found && found.made, live, theme, _title];
            if (_drawnFrom && from.every((x, i) => x === _drawnFrom[i])) return;
            _drawnFrom = from;
            if (!found || !window.Plotly) {
                if (window.Plotly && _dom.plot._fullLayout) window.Plotly.purge(_dom.plot);
                _drawing = null;
                _drawSerial++;
                _notes = null;
                _infos = {};
                _labelMaps = {};
                delete _dom.root.dataset.drawn;
                return;
            }
            const { made, grid, inputs } = found;
            // a style edit of the config shown is drawn from the config now (a pie of the bars' counts collects its small
            // slices); an edit that computes keeps the config that made the grid
            const config = made === live || sameGrid(made, live) ? live : made;
            const table = countTable(config, grid, inputs);
            const names = inputNames(config, sourceTitleOf);
            const labels = shownLabels(config, table, live, sourceTitleOf);
            const levels = table.axes.filter((a) => a.input === 'split' || (config.mode === 'pie' && a.input === 'x')).map((a) => a.levels.length);
            const n = (table.top ? table.top.levels.length : 0) + levels.reduce((p, k) => p + k, 0);
            const opts = {
                options: drawOptions(config), words: C, inputNames: names, labels, palette: groupColours(Math.max(1, n)), theme: PLOT_PALETTES[theme],
                measureSource: config.measure ? measureSourceName(config.measure.source, sourceTitleOf) : undefined, titleOf: sourceTitleOf, panelId: _id
            };
            const part = PARTS.draw[config.mode];
            const fig = part ? part.figure(config, table, opts)
                : DENSITY_MODES.includes(config.mode) ? densityFigure(config, table, opts) : countFigure(config, table, opts);
            // a density's sentences (UX 4.4): the bandwidth and the floor in Plot Options, the range in the strip
            _notes = fig.notes || null;
            const serial = ++_drawSerial;
            delete _dom.root.dataset.drawn;
            const root = _dom.root;
            drawPlot(_dom.plot, fig.data, { ...fig.layout, autosize: true }, { displaylogo: false, responsive: true },
                coverageOf(table, names), 'cells').then(() => {
                // what a test or a style reads: the mode drawn, once the drawing is of the config now
                if (serial === _drawSerial && config === live) root.dataset.drawn = config.mode;
            }, (error) => console.error(`Cell count plot ${_id}:`, error));
            _drawing = { config, table, labels, names };
            // what Choose levels and the binning control read: each input's axis of the reply, with its cells per level
            const defaults = levelLabelsOf(config, table, sourceTitleOf);
            _infos = {};
            _labelMaps = {};
            inputs.forEach((input, a) => {
                if (input.input === 'sets' || input.input === 'factor') return;
                const totals = levelTotals(grid, a);
                _infos[input.input] = { ...grid.axes[a], counts: grid.axes[a].levels.map((_, i) => totals[i]) };
                const t = table.axes.findIndex((x) => x.input === input.input);
                if (t >= 0) _labelMaps[input.input] = defaults[t];
            });
        }

        /** Two configs whose grids are the same request: what one draws, the other can (a mode that reads the same inputs). */
        function sameGrid(a, b) {
            if (!inputsOf(a) || !inputsOf(b) || _requests.get(a) !== _requests.get(b)) return false;
            const st = groupSources().sources.status(_id);
            return !!_snap && _snap.state === 'ready' && !_snap.held && !(st && (st.held || st.checking));
        }

        /** What the plot area and the strip say: a plan that asks nothing, the route's states, and Counting… meanwhile. */
        function paintState() {
            const snap = _snap;
            const box = _dom.state;
            const text = box.querySelector('.ccnt-state__text');
            const actions = box.querySelector('.ccnt-state__actions');
            D.clear(actions);
            let say = null;
            let strip = '';
            if (!DataManager.isDatasetLoaded()) say = null;
            else if (!drawable(_config.mode)) say = { state: 'unavailable', text: C.notDrawn(C.modes[_config.mode]), actions: [] };
            else if (snap && PARTS.states && PARTS.states.describe) say = PARTS.states.describe(snap, { panelId: _id, config: _config });
            else if (isPlanState(snap)) say = { state: snap.state, text: planSentence(snap, nameOfInput), actions: [] };
            else if (snap && ON_ITS_WAY.includes(snap.state)) {
                const cells = (DataManager.getCells() || []).length;
                if (_drawing) strip = C.counting(cells);
                else say = { state: snap.state, text: C.counting(cells), actions: [['score-cancel', 'Cancel']] };
            } else if (snap && snap.state !== 'ready') {
                const notice = describeSource({ ...snap, title: _title }, { role: 'x' }, NOTICE_WORDS);
                if (notice) say = { state: notice.state, text: `${notice.headline}${notice.text ? ` ${notice.text}` : ''}`, actions: notice.actions };
            }
            box.hidden = !say;
            box.dataset.state = say ? say.state : (snap ? snap.state : 'none');
            _dom.root.dataset.state = snap ? snap.state : 'none';
            text.textContent = say ? say.text : '';
            for (const [action, label] of (say && say.actions) || []) {
                const run = actionRun(action);
                if (!run) continue;
                actions.appendChild(D.el('button', { type: 'button', class: 'btn btn-sm btn-outline-primary ccnt-action', data: { action },
                    on: { click: run } }, label));
            }
            if (!strip && _notes && snap && snap.state === 'ready') strip = [_notes.range, _notes.floor].filter(Boolean).join(' ');
            _dom.strip.textContent = strip;
        }

        function nameOfInput(field) {
            const p = field === 'factor' ? _config.value && _config.value.factor : _config[field];
            return p && p.source ? inputNames({ x: p }, sourceTitleOf).x : C.rows[field] || field;
        }

        /** What a notice's button does here, or null when it does nothing here. */
        function actionRun(action) {
            const h = _handle;
            switch (action) {
                case 'score-compute': return h ? () => h.compute() : null;
                case 'score-cancel': return h ? () => h.cancel() : null;
                case 'score-retry': return h ? () => h.retry() : null;
                case 'score-update': return () => groupSources().sources.update(_id);
                case 'score-open': {
                    const ring = cycleIds(_id) || [];
                    const target = (_snap && _snap.table) || ring.find((x) => x !== _id);
                    return target ? () => openPanel(target) : null;
                }
                case 'score-choose': return () => { const first = _dom.controls.querySelector('[data-row="x"] select'); if (first) first.focus(); };
                default: return null;
            }
        }

        function openPanel(pid) {
            const p = panelOf(pid);
            if (!p) return;
            if (isOpen(p)) {
                const tile = document.querySelector(`.tile[data-tile-id="${CSS.escape(pid)}"]`);
                if (tile) tile.scrollIntoView({ block: 'nearest' });
                return;
            }
            PanelManager.reopenClosedPanel(pid, { nextTo: _id });
        }

        /** The CSV of the plotted table (CNT-23). */
        function downloadCsv() {
            if (!_drawing) return;
            const { config, table, labels, names } = _drawing;
            const text = countCsv(config, table, { labels, inputNames: names, headers: C.csv, titleOf: sourceTitleOf });
            const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `${_title.replace(/[^\w.-]+/g, '_') || 'count'}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 0);
        }

        // ---------------------------------------------------------------- events from the page

        function onDataUpdate(updateType) {
            if (!_initialized) return undefined;
            if (updateType === 'datasetChanged') {
                _dom.noData.style.display = 'none';
                syncControlsWithDataset(_dom.controls, true);
                resetStructure();
                groupSources().sources.contextChanged();
                return datasetReady();
            }
            if (updateType === 'subsetChanged' || updateType === 'partChanged') {
                groupSources().sources.contextChanged();
                paint();
            }
            return undefined;
        }

        /** Panels were added, closed, reopened or renamed: the menus' lists and the names of inputs may have changed. */
        function onPanelsChanged() {
            if (!_initialized) return;
            groupSources().sources.recheck();
            _structureVersion++;
            if (_controls) _controls.refill();
            _drawnFrom = null;
            paint();
        }

        function _debugState() {
            const snap = _snap;
            return JSON.parse(JSON.stringify({
                config: _config, state: snap ? snap.state : null, reason: snap ? snap.reason || null : null, undo: _undo.steps.length,
                drawn: _drawing ? _drawing.config.mode : null, rows: _drawing ? _drawing.table.rows : null, rowsShown: rowsOf(_config.mode)
            }));
        }

        return {
            init,
            cleanup,
            destroy: cleanup,
            onDataUpdate,
            onPanelsChanged,
            getId: () => _id,
            getTitle: () => _title,
            setTitle(title) { _title = title; groupSources().sources.sourceChanged(_id); _drawnFrom = null; paint(); },
            getType: () => TYPE,
            getConfig,
            updateConfig,
            setConfig: updateConfig,
            groupSource,
            // for the steps after this one, and the tests
            undo,
            _debugState
        };
    }

    PanelManager.registerPanelType('cell-count', CellCountPanel);
})();

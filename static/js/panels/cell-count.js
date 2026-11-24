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
 * WHAT IT SAYS (panels/cell-count/states.js). A plan that asks nothing (no X, an input the mode cannot use, a limit of
 * the mode, UX 4.2 and 4.3) is said in the plot area's own box with its way out (Bin it, Choose levels, Remove Color
 * by, Show as Bar), which acts on this config. The route's states (computing, queued, asks first, refused, failed,
 * a cycle, out of date) go through the page's painter (utils/host-binding.js) as provider 'count-grid', as every
 * source's do: the overlay while there is no drawing, the strip's bar of a long wait that keeps the drawing (decision
 * 21), and the buttons routed by the action registry. A drawn plot's strip says the cells counted and those left out
 * (CNT-22). Save as grouping (panels/cell-count/save-grouping.js) is on the toolbar, and a click on a bar, slice or
 * rectangle opens it too (CNT-21). There is no Show as table (operator ruling, 2026-11-23); Download CSV stays on the toolbar
 * until the shared Plot Options (WP-5a) take it into Export.
 *
 * SEAMS for the steps after this one (`PARTS`):
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
import { pointsRefusal } from './cell-count/density-points.js';
import { pointsRefused, pointsKey, loadCellPoints, pointsForFigure } from './cell-count/density-points-load.js';
import { createControls } from './cell-count/controls.js';
import { colourValues } from './cell-count/colour.js';
import {
    countReferences, shownConfig, drawOptions, inputNames, shownLabels, followFocus, measureSourceName, levelTotals,
    isNumericSource, levelCountOf, valueDefaults, rowsOf
} from './cell-count/controls-model.js';
import {
    AXIS_PREFIX, groupSources, panelOf, isOpen, cycleIds, loadStructure, structureRead, resetStructure, sourceTitleOf
} from '../utils/group-host.js';
import { GROUPING } from '../utils/group-sources.js';
import { registerReferences } from '../utils/panel-references.js';
import { VOCABULARY } from '../utils/vocabulary.js';
import { createHostBinding, isVisible, PENDING } from '../utils/host-binding.js';
import { actions } from '../utils/source-actions.js';
import { isPlanState, describePlan, wayOut, gridNotice, levelsNote } from './cell-count/states.js';
import { saveOffered, savePlan, openSaveDialog } from './cell-count/save-grouping.js';
import { setupAxisSelector, typeChoices, takeSubKey } from './plot-utilities/panel-ui-update.js';
import { parseAlsoListed } from '../utils/source-registry.js';
import { PLOT_PALETTES, modebarOf, MODEBAR_REMOVE } from '../utils/plot-theme.js';
import { currentTheme, THEME_EVENT } from '../utils/theme.js';
import { groupColours } from './plot-utilities/colors.js';
import { drawPlot } from '../utils/panel-surface.js';
import { colourBar } from './plot-utilities/colour-bar.js';
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
 * @type {{sets: ?{mount: Function}, draw: Object<string, {figure: Function}>}}
 */
// export-unused-ok: V1, V2 and V3 register their parts here
export const PARTS = { sets: null, draw: {} };
installSets(PARTS);

/** Whether a mode can be drawn in this build. */
const drawable = (mode) => DRAWN_MODES.includes(mode) || DENSITY_MODES.includes(mode) || !!PARTS.draw[mode];

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


/**
 * The figure's colour bars made by the Cell Plot's builder (plot-utilities/colour-bar.js) from the Cell Plot's default
 * settings: the title along the bar on its right, the same font, thickness, length and position. What the figure sets for
 * itself (the title text, a percent tick format) is kept. Changes the traces in place.
 */
function withSharedColourBars(fig) {
    const share = (holder, key) => {
        const bar = holder && holder[key];
        if (!bar) return;
        const own = {};
        for (const k of ['tickformat', 'tickvals', 'ticktext']) if (bar[k] !== undefined) own[k] = bar[k];
        holder[key] = { ...colourBar({}, bar.title && bar.title.text), ...own };
    };
    for (const trace of fig.data) {
        share(trace, 'colorbar');
        share(trace.marker, 'colorbar');
    }
    return fig;
}

/** The panel type of a grouping, which Save as grouping makes. */
const GROUPING_TYPE = 'cell-grouping';

/** The page's provider of a count plot's notices and their buttons (utils/host-binding.js, utils/source-actions.js). */
const PROVIDER = 'count-grid';
const ROLE = 'grid';

const panelOfHost = (host) => (host && host.__azPanelId ? panelOf(host.__azPanelId) : null);
const cellsShown = () => (DataManager.getCells() || []).length;

/** One record per plot host: the handle of the plot's own grid. The route's states are painted by the page's painter. */
const binding = createHostBinding({
    id: PROVIDER,
    open: (host, role, setting, onChange) => {
        const handle = groupSources().sources.watch(setting.id, {
            consumer: { kind: 'plot', role: 'panel', panelId: setting.id, host }, option: {},
            visible: () => isVisible(host),
            onChange: (snap) => { onChange(snap); const p = panelOfHost(host); if (p) p.snapshotChanged(snap); }
        });
        return { id: setting.id, handle, host };
    },
    matches: (rec, setting) => rec.id === setting.id,
    describe: (snap, ctx) => gridNotice(snap, ctx, cellsShown()),
    visibilityChanged: () => groupSources().sources.visibilityChanged()
});

/** Show a panel: an open one is scrolled to, a closed one reopens beside `nextTo` with the same id. */
function openPanel(id, nextTo) {
    const p = panelOf(id);
    if (!p) return;
    if (isOpen(p)) {
        const tile = document.querySelector(`.tile[data-tile-id="${CSS.escape(id)}"]`);
        if (tile) tile.scrollIntoView({ block: 'nearest' });
        return;
    }
    PanelManager.reopenClosedPanel(id, { nextTo });
}

/** The panel a notice's Open button shows: the table a gate waits on, or the other panel of a cycle. */
function openTarget(rec) {
    const snap = rec.handle.read();
    const ring = cycleIds(rec.id) || [];
    return (snap && snap.table) || ring.find((x) => x !== rec.id) || null;
}

actions.register({
    id: PROVIDER,
    owns: (host) => !!(host && host.__azCellCount),
    actions: {
        'score-compute': { target: (host) => binding.shownRecord(host), run: (rec) => { rec.handle.compute(); } },
        'score-cancel': { target: (host) => binding.shownRecord(host), run: (rec) => { rec.handle.cancel(); } },
        'score-retry': { target: (host) => binding.shownRecord(host), run: (rec) => { rec.handle.retry(); } },
        'score-update': { target: (host) => binding.shownRecord(host), run: (rec) => { groupSources().sources.update(rec.id); } },
        'score-open': { target: (host) => { const rec = binding.shownRecord(host); return rec ? openTarget(rec) : null; },
            run: (id, host) => { openPanel(id, host.__azPanelId); } },
        'score-choose': { target: (host) => host.__azChooser || null, run: (select) => { select.focus(); } }
    }
});

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
        /** The cells of a 2D density's Cell points layer: {key, state: 'none'|'loading'|'ready'|'refused'|'failed', data?, why?} */
        let _points = { key: null, state: 'none' };
        let _pointsAbort = null;
        let _controlsFrom = null;
        let _drawing = null;                 // {config, table, labels, names} of the drawing shown, for the CSV
        let _infos = {};
        let _labelMaps = {};
        let _notes = null;
        /** The numbers the colour scale is drawn over (the Color pop-over's range sliders) */
        let _colourData = null;
        let _drawSerial = 0;
        /** Choose levels of an input no reply shows yet (a refused plan): its levels, asked for alone (axisSource) */
        let _levelSource = null;
        let _levelHandle = null;
        let _levelInfo = null;
        /** Save as grouping's dialog, while open */
        let _dialog = null;
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

        /**
         * The levels of one input that no reply shows (a plan refused for its levels, UX 4.3), as a grouping of that
         * input alone: what Choose levels lists, at 'axis:<id>' of the page's group sources. Null when none is wanted.
         */
        function axisSource() {
            return _levelSource ? { title: _title, kind: 'count', recipe: () => _levelSource, shape: GROUPING } : null;
        }

        /**
         * Choose levels of `field`: the drawn reply's levels, else those of the input asked for alone (one light request,
         * never the grid), null meanwhile. Called while the controls paint, so it never paints itself.
         */
        function levelsOf(field) {
            if (_infos[field]) {
                // the plot draws this input now: its reply lists every category, and the input alone is not needed
                if (_levelSource && _levelSource.field === field) releaseLevels();
                return _infos[field];
            }
            const p = _config[field];
            if (!p || !_initialized || !DataManager.isDatasetLoaded()) return null;
            const key = JSON.stringify(p.source);
            if (!_levelSource || _levelSource.key !== key) {
                _levelSource = { version: 1, partitionings: [{ source: p.source }], key, field };
                _levelInfo = null;
                const id = AXIS_PREFIX + _id;
                if (_levelHandle) groupSources().sources.sourceChanged(id);
                else {
                    _levelHandle = groupSources().sources.watch(id, {
                        consumer: { kind: 'inspect', role: 'levels', panelId: _id }, option: {},
                        visible: () => _visible && !!_dom && _dom.root.isConnected,
                        onChange: (snap) => { if (takeLevels(snap)) { _controlsFrom = null; paint(); } }
                    });
                }
                takeLevels(_levelHandle.read());
            }
            return _levelInfo && _levelInfo.key === key ? _levelInfo.info : null;
        }

        /** Keep the levels of a ready reply of the input asked for alone; whether they are new. */
        function takeLevels(snap) {
            if (!snap || !_levelSource) return false;
            if (snap.state === 'refused' || snap.state === 'failed') {
                // what Choose levels says instead (states.js levelsNote), with the route's figures of a size refusal
                const header = snap.key ? groupSources().store.snapshot(snap.key).header : null;
                const said = { ...snap, refused: header && header.refused ? header.refused : snap.refused };
                const was = _levelInfo && _levelInfo.said;
                if (was && was.state === said.state && was.reason === said.reason && was.message === said.message) return false;
                _levelInfo = { key: _levelSource.key, info: null, said };
                return true;
            }
            if (_levelInfo && _levelInfo.said) {
                // asked again (Retry): the note goes while it comes
                _levelInfo = null;
                return true;
            }
            const reply = snap.state === 'ready' && snap.values && snap.values.reply;
            const info = reply && reply.partitionings && reply.partitionings[0];
            if (!info || (_levelInfo && _levelInfo.info === info)) return false;
            _levelInfo = { key: _levelSource.key, info };
            return true;
        }

        /** What Choose levels of `field` says when its levels did not come (refused or failed), or null. */
        function levelsSaid(field) {
            if (!_levelSource || _levelSource.field !== field || !_levelInfo || !_levelInfo.said || !_config[field]) return null;
            return levelsNote(_levelInfo.said, { field, name: nameOfInput(field), numeric: page.isNumeric(_config[field].source) });
        }

        function releaseLevels() {
            if (_levelHandle) _levelHandle.release();
            _levelHandle = null;
            _levelSource = _levelInfo = null;
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
            releaseLevels();
            if (_dialog) _dialog.close();
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

        /** Watch the grid while the mode can be drawn, through the page's binding; a mode with no drawing asks for nothing. */
        function watch() {
            if (!_initialized || !_dom || !DataManager.isDatasetLoaded()) return;
            if (!drawable(_config.mode)) { release(); return; }
            if (_handle) return;
            _handle = binding.recordFor(_dom.plot, ROLE, { id: _id }).handle;
            _snap = _handle.read();
            noteKey(_snap);
        }

        function release() {
            if (_dom) binding.releaseHost(_dom.plot);
            _handle = null;
            _snap = null;
        }

        /** The store said something of the grid (the binding's onChange): a progress frame costs a read and a paint. */
        function snapshotChanged(snap) {
            if (!_initialized) return;
            _snap = snap;
            noteKey(snap);
            paint();
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
                commit, undo: () => undo(), csv: downloadCsv, saveAsGrouping, wayOut: takeWayOut,
                setupAxis: (rowEl, axis, setting, roles) => {
                    const structure = structureRead();
                    if (structure) setupAxisSelector(rowEl, axis, setting, 'cells', structure, { consumer: MENU_CONSUMER, roles });
                },
                typeChoices: (roles) => typeChoices('cells', MENU_CONSUMER, roles),
                takeSubKey: (setting, select) => takeSubKey(setting, select, _id),
                parseListed: parseAlsoListed
            } });
            const plot = el('div', { class: 'ccnt-plot', id: `ccnt-plot-${_id}` });
            // what the plot area says for a plan that asks nothing: the sentence (the live region) and its way out beside it
            const state = el('div', { class: 'ccnt-state', role: 'status', aria: { live: 'polite' }, hidden: true }, el('p', { class: 'ccnt-state__text' }));
            const stateBox = el('div', { class: 'ccnt-state-box', hidden: true }, state, el('div', { class: 'ccnt-state__actions' }));
            // what the plot is doing while it keeps its drawing ("Counting N cells…"): a small overlay in its top-left corner
            const working = el('div', { class: 'ccnt-working', role: 'status', aria: { live: 'polite' }, hidden: true });
            const plotArea = el('div', { class: 'ccnt-plot-area' }, working, plot, stateBox);
            // the page's painter and action registry find this plot's records and buttons by these
            plot.__azPanelId = _id;
            plot.__azCellCount = true;
            plot.__azChooser = _controls.element.querySelector('[data-row="x"] select');
            root.append(_controls.element, plotArea);
            root.addEventListener('keydown', onKey);
            container.innerHTML = '';
            container.appendChild(root);
            _dom = { root, controls: _controls.element, plot, plotArea, state, stateBox, working,
                noData: root.querySelector(`#loading-screen-${_id}`) };
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
                isNumeric: page.isNumeric, drawable, undo: step ? step.label : null, canExport: !!_drawing, canSave: saveOffered(_config), notes: _notes, colourData: _colourData, densityNote: densityNote(), levelsOf, levelsSaid,
                valueDefaults: () => valueDefaults(_config, structureRead(), DataManager.getFocusedGene() || null)
            };
        }

        // ---------------------------------------------------------------- paint

        function paint() {
            if (!_dom) return;
            draw();
            paintState();
            const from = [_config, structureRead(), _structureVersion, _undo.peek(), _infos, !!_drawing, _notes, _levelInfo, _points, _colourData];
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
            const from = [found && found.grid, found && found.made, live, theme, _title, _points];
            if (_drawnFrom && from.every((x, i) => x === _drawnFrom[i])) return;
            _drawnFrom = from;
            if (!found || !window.Plotly) {
                if (window.Plotly && _dom.plot._fullLayout) window.Plotly.purge(_dom.plot);
                _drawing = null;
                _drawSerial++;
                _notes = null;
                _colourData = null;
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
            const opts = {
                options: drawOptions(config), words: C, inputNames: names, labels, palette: groupColours(1, config.color && config.color.palette),
                theme: PLOT_PALETTES[theme],
                measureSource: config.measure ? measureSourceName(config.measure.source, sourceTitleOf) : undefined, titleOf: sourceTitleOf, panelId: _id
            };
            const wantsPoints = config.mode === 'density2d' && opts.options.layers && opts.options.layers.points;
            if (wantsPoints) {
                const sa = table.axes.findIndex((x) => x.input === 'split');
                const loaded = pointsFor(config);
                if (loaded) opts.points = pointsForFigure(loaded, sa >= 0 ? table.axes[sa].levels : null);
            } else if (_points.state !== 'none') {
                if (_pointsAbort) _pointsAbort.abort();
                _points = { key: null, state: 'none' };
            }
            const part = PARTS.draw[config.mode];
            const fig = part ? part.figure(config, table, opts)
                : DENSITY_MODES.includes(config.mode) ? densityFigure(config, table, opts) : countFigure(config, table, opts);
            withSharedColourBars(fig);
            // a density's sentences (UX 4.4): the bandwidth and the floor in Plot Options, the range in the strip
            _notes = fig.notes || null;
            _colourData = colourValues(fig.data);
            const serial = ++_drawSerial;
            delete _dom.root.dataset.drawn;
            const root = _dom.root;
            const plot = _dom.plot;
            drawPlot(plot, fig.data, { ...fig.layout, autosize: true, modebar: modebarOf(PLOT_PALETTES[theme].textColor) },
                { displaylogo: false, responsive: true, modeBarButtonsToRemove: [...MODEBAR_REMOVE] },
                coverageOf(table, names), 'cells').then(() => {
                // a click on a bar, slice or rectangle offers Save as grouping (CNT-21); a purge drops the listener
                if (typeof plot.removeAllListeners === 'function') plot.removeAllListeners('plotly_click');
                if (typeof plot.on === 'function') plot.on('plotly_click', saveAsGrouping);
                // what a test or a style reads: the mode drawn, once the drawing is of the config now
                if (serial === _drawSerial && config === live) root.dataset.drawn = config.mode;
            }, (error) => console.error(`Cell count plot ${_id}:`, error));
            _drawing = { config, table, labels, names, grid, inputs };
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

        /**
         * The cells of the Cell points layer for this config, once loaded: null while they load, or when the layer is
         * refused or failed (the strip says why). A change of the sources or of the cells shown loads them again.
         */
        function pointsFor(config) {
            const total = cellsShown();
            const why = pointsRefused(config, structureRead(), total);
            if (why) {
                if (_points.state !== 'refused' || _points.why.kind !== why.kind || _points.why.input !== why.input || _points.why.total !== why.total) _points = { key: null, state: 'refused', why };
                return null;
            }
            const key = pointsKey(config, total);
            if (_points.key === key) return _points.state === 'ready' ? _points.data : null;
            if (_pointsAbort) _pointsAbort.abort();
            const control = new AbortController();
            _pointsAbort = control;
            _points = { key, state: 'loading' };
            const settle = (next) => { if (control.signal.aborted) return; _points = { key, ...next }; _drawnFrom = null; paint(); };
            loadCellPoints(config, { structure: structureRead(), signal: control.signal })
                .then((data) => settle({ state: 'ready', data }), (error) => settle({ state: 'failed', why: String(error && error.message || error) }));
            return null;
        }

        /** What the strip says of the Cell points layer: that it loads, why it cannot be drawn, or how many cells it draws. */
        function pointsStatus() {
            if (!(shown().mode === 'density2d' && drawOptions(shown()).layers.points)) return '';
            if (_points.state === 'loading') return C.points.loading;
            if (_points.state === 'refused') return pointsRefusal(_points.why);
            if (_points.state === 'failed') return C.points.failed(_points.why);
            return (_notes && _notes.points) || '';
        }

        /** Two configs whose grids are the same request: what one draws, the other can (a mode that reads the same inputs). */
        function sameGrid(a, b) {
            if (!inputsOf(a) || !inputsOf(b) || _requests.get(a) !== _requests.get(b)) return false;
            const st = groupSources().sources.status(_id);
            return !!_snap && _snap.state === 'ready' && !_snap.held && !(st && (st.held || st.checking));
        }

        /**
         * What the plot area and the strip say. A plan that asks nothing is said in the plot area's box with its way out
         * (states.js); the route's states are the page's painter's, over the plot while there is no drawing and, for a
         * load that keeps the drawing, as the strip's bar once the wait is long. The strip says the cells counted.
         */
        function paintState() {
            const snap = _snap;
            const box = _dom.state;
            const text = box.querySelector('.ccnt-state__text');
            const buttons = _dom.stateBox.querySelector('.ccnt-state__actions');
            let say = null;
            if (DataManager.isDatasetLoaded()) {
                say = !drawable(_config.mode) ? { state: 'unavailable', text: C.notDrawn(C.modes[_config.mode]), actions: [] }
                    : describePlan(snap, { config: shown(), nameOf: nameOfInput, isNumeric: page.isNumeric });
            }
            box.hidden = _dom.stateBox.hidden = !say;
            box.dataset.state = say ? say.state : (snap ? snap.state : 'none');
            _dom.root.dataset.state = snap ? snap.state : 'none';
            text.textContent = say ? say.text : '';
            // the way out's buttons are made again only when they change, so a repaint keeps the focus on one
            const ways = (say && say.actions) || [];
            const key = ways.map((a) => a.join('\u0001')).join('\u0002');
            if (buttons.dataset.ways !== key) {
                buttons.dataset.ways = key;
                D.clear(buttons);
                for (const [action, label] of ways) {
                    buttons.appendChild(D.el('button', { type: 'button', class: 'btn btn-sm btn-outline-primary ccnt-action', data: { action },
                        on: { click: () => takeWayOut(action) } }, label));
                }
            }
            // a load that keeps its drawing says nothing over it: the strip says it, and the painter's bar after 10 s
            const rec = binding.recordsOf(_dom.plot).get(ROLE);
            if (rec) rec.quiet = !!_drawing;
            binding.paint(_dom.plot);
            const doing = workingText(snap);
            _dom.working.textContent = doing;
            _dom.working.hidden = !doing;
        }

        /** What the plot is doing while it keeps its drawing: Counting… and loading the cell points. Gone once it is ready. */
        function workingText(snap) {
            if (!snap || !_drawing) return '';
            if (PENDING.includes(snap.state) && snap.state !== 'idle') return C.counting(cellsShown());
            if (snap.state === 'ready' && shown().mode === 'density2d' && drawOptions(shown()).layers.points && _points.state === 'loading') return C.points.loading;
            return '';
        }

        /**
         * What a density says of itself, for the note under its controls: the range its curve covers, the bandwidth floor
         * and what the Cell points layer draws or why not. Facts of the drawing, not of its progress (the cells counted
         * and left out are the coverage banner's).
         */
        function densityNote() {
            if (!_notes || !_drawing || !DENSITY_MODES.includes(_drawing.config.mode)) return '';
            const points = pointsStatus();
            return [_notes.bandwidth, _notes.range, _notes.floor, points === C.points.loading ? '' : points].filter(Boolean).join(' ');
        }

        function nameOfInput(field) {
            const config = shown();
            const p = field === 'factor' ? config.value && config.value.factor : config[field];
            return p && p.source ? inputNames({ x: p }, sourceTitleOf).x : C.rows[field] || field;
        }

        /** A way out of a plan's state (states.js): one undoable step, a control opened in place, or both. */
        function takeWayOut(action) {
            if (action.startsWith('levels-retry:')) { if (_levelHandle) _levelHandle.retry(); return; }
            const way = wayOut(action, _config);
            if (!way) return;
            if (way.config) commit(way.config, way.label);
            if (way.reveal && _controls) _controls.reveal(way.reveal.field, way.reveal.what);
        }

        /** Save as grouping (CNT-7): the dialog of what the drawn plot would make; Save makes a Cell Grouping beside it. */
        function saveAsGrouping() {
            if (!_drawing || !_dom || !saveOffered(_drawing.config)) return;
            const { config, grid, inputs, names } = _drawing;
            const plan = savePlan(config, grid, inputs, { nameOf: (field) => names[field] || C.rows[field] || field });
            if (_dialog) _dialog.close();
            _dialog = openSaveDialog(D, _dom.plotArea, plan, {
                save: (recipe) => { PanelManager.createPanelNextTo(GROUPING_TYPE, _id, recipe); },
                close: () => { _dialog = null; }
            });
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
            axisSource,
            snapshotChanged,
            // for the steps after this one, and the tests
            undo,
            _debugState
        };
    }

    PanelManager.registerPanelType('cell-count', CellCountPanel);
})();

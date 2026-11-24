/**
 * Cell-Gene Plot panel (0.8.0 step X3a; CXG-1 to CXG-8, CXG-11, CXG-18, PER; UX 3.1, 3.2 and 7).
 *
 * The dot plot and the group heatmap of scanpy: groups of cells on one axis (a grouping, or an obs column treated as a
 * grouping of one factor with no panel, CXG-2), genes on the other in SECTIONS, each a signature's or a gene table's
 * genes, shown one row per gene or as one aggregated row (CXG-3). Its configuration (plan 1.6, `cell-gene` version 1;
 * panels/cell-gene/sections.js) is all that a link, a panel set and a history entry carry (PER-1); every edit is one
 * undoable step.
 *
 * ONE REQUEST. The plot is one consumer (kind `plot`) of the page's group sources (utils/group-host.js): it watches its
 * cell axis with the features it draws as its option, and changes the option when they change. The group store holds
 * the groups and each feature apart, so a feature held is never asked for again: adding a gene asks for that gene
 * alone, and a change of statistic, scaling, order or style asks for nothing (CXG-18). The features are named by
 * sections.js `planFeatures`, which asks for a section's genes once however many rows and aggregations read them (OD
 * 15) and for a score only when a one-row section reads one (CXG-9). The option also declares the statistics it reads
 * (`statistics`), so a grouping counts this plot among its users.
 *
 * NOTICES go through the page's painter (utils/host-binding.js), with this panel's records and its action provider,
 * so a computing, refused or failed plot says so over the plot as every source does, with its progress bar.
 *
 * SEAMS for the steps after this one:
 *   X3b  panels/cell-gene/states.js: the states of UX 3.5 (the plot's notices, worded from what the plot knows by
 *        `plotFacts()`; the matrix limit, decided in `sync()` before any request; the checklist; the strip's tags and
 *        the heatmap hint of a drawn plot). `_debugState().state` is what the tests read.
 *   X4b  draw-annotations.js adds brackets, strips, totals and dendrograms to the figure `drawFigure` builds; the rows
 *        carry their section ({index, title}), and order()'s blocks are kept in `_shown.order` for the dendrograms.
 *   X5   options.js mounts Cluster ▾ and Plot Options in the control grid's `layoutSlot` (`PARTS.options`), sets the
 *        style fields with `ctx.set(patch, label)`, and says what they add to the figure (`figureExtras`,
 *        `barSettings`). A section added while the others are drawn shows placeholder rows until its genes are read
 *        (CXG-18, `pendingRows`).
 *
 * 3D (UX 6b, WP-12). `view: '3d'` draws the matrix as bars (draw.js figure3d), the height a third measure: "Same as
 * Color" (no `height` stored) or a statistic of its own, read in the same request (`planFeatures` adds a feature only
 * for a layer or threshold Color and Size do not read). Over the bar cap the plot is drawn in 2D and the strip says why.
 * The camera is kept in the configuration as the user turns it, without an undo step; Reset camera clears it.
 *
 * It touches no DOM until init(): a closed plot restored from a link or a panel set is constructed and never
 * initialised, and computes nothing (PER-5).
 */
import { PanelManager } from '../panel-manager.js';
import { DataManager } from '../data-manager.js';
import { makeDom } from './gene-set-utilities/dom.js';
import { noDatasetScreenHtml } from '../utils/no-dataset-screen.js';
import { setControlsVisible, syncControlsWithDataset } from '../utils/controls-visibility.js';
import { setStatusTag } from '../utils/panel-surface.js';
import { UndoStack, serverRecipe } from '../utils/gene-signature.js';
import { AXIS_PREFIX, groupSources, panelOf, typeOf, isOpen, titleOfPanel, hasGene, loadStructure, structureRead, resetStructure, sourceTitleOf } from '../utils/group-host.js';
import { registerReferences, wouldLoop, dependsOn } from '../utils/panel-references.js';
import { createHostBinding, isVisible } from '../utils/host-binding.js';
import { GROUPING } from '../utils/group-sources.js';
import { actions } from '../utils/source-actions.js';
import { sourceList, scoreChoices, openSignature, onSourceStatus } from '../utils/score-source.js';
import { createSourceAdapter, KIND_HEADING } from '../utils/score-source-panels.js';
import { TableResolver, findCycle } from '../utils/table-resolver.js';
import { KIND_CLIENT } from './score-options/score-options.js';
import { layerKeys } from '../utils/structure-keys.js';
import {
    statisticGrade, negativeValuesSentence, defaultMeasures
} from '../utils/group-statistics.js';
import { SIGNATURE_MODEL } from '../utils/signature-options.js';
import { withoutLegacy } from '../utils/options-model.js';
import { parseThresholdText } from '../utils/options-model.js';
import { geneReads } from '../utils/cell-gene-model.js';
import { createCellGeneOrder } from '../utils/cell-gene-order.js';
import { buildFigure, colourBars, sceneLabels, DEFAULT_CAMERA } from './cell-gene/draw.js';
import { roundCamera } from '../utils/view-rounding.js';
import { recordCameraOnRelease } from '../utils/scene-camera.js';
import { exportPlot, copyPlotToClipboard } from './plot-utilities/plot-aesthetics-menu.js';
import { createPlotToolbar } from '../ui/plot-toolbar.js';
import { PLOT_PALETTES } from '../utils/plot-theme.js';
import { resolveStyle } from './plot-utilities/options-schema.js';
import { applyPlotStyle, styleTheme, cellGeneLegend } from './plot-utilities/plot-style.js';
import { drawPlot, fitToContainer } from '../utils/panel-surface.js';
import { Coverage } from '../utils/coverage.js';
import { currentTheme, THEME_EVENT } from '../utils/theme.js';
import { VOCABULARY } from '../utils/vocabulary.js';
import {
    normalizeCellGene, cellGeneReferences, addSection, duplicateSection, removeSection, moveSection, setSectionRows,
    setSectionTitle, setRowAggregation, rowAggregationOf, sectionTitle, sectionGenes, sectionLine, tooManyGenesText,
    aggregationAfter, effectiveAggregation, planFeatures, buildMatrix, heightOf, withGroupingThreshold, SAME_AS_COLOR, GROUP_AXIS
} from './cell-gene/sections.js';
import {
    measureModel, pickLayer, axisChoices, axisSourceId, axisRecipe, createControls, createAddGenes,
    createSectionList
} from './cell-gene/controls.js';
import {
    gateMatrix, describePlot, ownJobAhead, plotState, matrixTag, oneCellPerGroup, createChecklist
} from './cell-gene/states.js';
import { OPTIONS_PART, figureExtras, barSettings, view3dGate } from './cell-gene/options.js';
import { CLICKS_PART } from './cell-gene/clicks.js';
import { effectiveSmall } from '../utils/cell-grouping.js';
import { RESERVED } from '../utils/level-id.js';

const TYPE = 'cell-gene';
const GROUPING_TYPE = 'cell-grouping';
const DEFAULT_TITLE = 'Cell-Gene Plot 1';
/** Keys of a saved configuration that are the panel's own, not the plot's. */
const PANEL_KEYS = ['id', 'title', 'controlsVisible', '_closed', 'active'];
/** The provider id of this panel's notices and their buttons (utils/host-binding.js, utils/source-actions.js). */
const PROVIDER = 'cell-gene';
const ROLE = 'axis';

registerReferences(TYPE, cellGeneReferences);

/**
 * The parts drawn into the panel: `{mount(slot, ctx) -> {update(), destroy()}}`. Cluster ▾ and Plot Options go in the
 * Layout group (panels/cell-gene/options.js); the clicks on the plot (CXG-15) in its area (panels/cell-gene/clicks.js).
 */
const PARTS = Object.freeze({ options: OPTIONS_PART, clicks: CLICKS_PART });

const W = VOCABULARY.word;
const STATES = VOCABULARY.cellGene.states;
const W3 = VOCABULARY.cellGene.view3d;
/** A turn of the 3D camera is stored once it has rested this long (UX 6b: debounced). */
const CAMERA_STORE_MS = 250;
const CGV = VOCABULARY.cellGene;

/** What a notice calls things (utils/source-notices.js): the plot waits on its groups. */
const NOTICE_WORDS = Object.freeze({
    thing: W.grouping, source: W.grouping, result: 'plot', Computing: 'Computing',
    progressUnit: 'values', found: 'cells', act: { to: 'group', ing: W.grouping },
    tags: { computing: 'Computing…' }, cycleKind: W.grouping,
    off: 'Cell Grouping is turned off on this server.'
});

// ================================================================================================ the page's records

/** The panel of a plot host, for the binding's hooks. */
const panelOfHost = (host) => (host && host.__azPanelId ? panelOf(host.__azPanelId) : null);

const binding = createHostBinding({
    id: PROVIDER,
    open: (host, role, setting, onChange) => {
        const consumer = { kind: 'plot', role, panelId: host.__azPanelId, host };
        const handle = groupSources().sources.watch(setting.axisId, {
            consumer, option: setting.option,
            visible: () => isVisible(host),
            onChange: (snap) => { onChange(snap); const p = panelOfHost(host); if (p) p.snapshotChanged(snap); }
        });
        return { axisId: setting.axisId, handle, optionKey: setting.optionKey, host, consumer };
    },
    matches: (rec, setting) => rec.axisId === setting.axisId,
    // the plot's own words (UX 3.5) from what its panel knows; the generic notice for every other state
    describe: (snap, ctx) => { const p = ctx && ctx.consumer ? panelOf(ctx.consumer.panelId) : null; return describePlot(snap, ctx, p ? p.plotFacts() : null, NOTICE_WORDS); },
    stillUsed: (rec) => { const p = panelOfHost(rec.host); return !p || p.axisId() === rec.axisId; },
    refresh: (host) => { const p = panelOfHost(host); if (p) p.redraw(); },
    visibilityChanged: () => groupSources().sources.visibilityChanged()
});

actions.register({
    id: PROVIDER,
    owns: (host) => !!(host && host.__azCellGene),
    actions: {
        'score-compute': { target: (host) => binding.shownRecord(host), run: (rec) => { rec.handle.compute(); } },
        'score-cancel': { target: (host) => binding.shownRecord(host), run: (rec) => { rec.handle.cancel(); } },
        'score-retry': { target: (host) => binding.shownRecord(host), run: (rec) => { rec.handle.retry(); } },
        'score-update': { target: (host) => binding.shownRecord(host), run: (rec) => { groupSources().sources.update(rec.axisId); } },
        'score-open': { target: (host) => { const rec = binding.shownRecord(host); return rec && typeOf(panelOf(rec.axisId)) === GROUPING_TYPE ? rec : null; },
            run: (rec, host) => { openPanel(rec.axisId, host.__azPanelId); } },
        'score-choose': { target: (host) => (host.__azChooser ? host.__azChooser : null), run: (select) => { select.focus(); } },
        // Asks first (UX 3.5): Fewer genes opens the section list
        'fewer-genes': { target: (host) => (binding.shownRecord(host) ? panelOfHost(host) : null), run: (panel) => { panel.fewerGenes(); } }
    }
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

/** The signatures and gene tables, as the score machinery reads them (score-source-panels.js), tables through the resolver. */
const sourceAdapter = createSourceAdapter({
    panel: panelOf, active: isOpen, geneNames: () => DataManager.getGenes(),
    resolver: {
        need: (id, dependant) => TableResolver.need(id, dependant),
        accept: (id) => TableResolver.accept(id),
        cancel: (id) => TableResolver.cancel(id),
        retry: (id) => TableResolver.retry(id),
        cycleOf: (id) => findCycle(id, dependsOn) || null
    }
});

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

(function () {
    /**
     * @param {HTMLElement} container
     * @param {Object} options - a saved configuration
     */
    function CellGenePanel(container, options = {}) {
        const _id = options.id || `${TYPE}-${Date.now()}`;
        let _title = options.title || DEFAULT_TITLE;
        let _controlsVisible = options.controlsVisible;
        let _config = configFrom(options);
        const _undo = new UndoStack();
        /** A new plot whose Color and Size the user has not chosen: they follow matrix kind (decision 24) */
        let _fresh = !options || (!('color' in options) && !('size' in options));

        // derived, never saved
        let _initialized = false;
        let D = null;
        let _dom = null;
        let _controls = null;
        /** The shared plot toolbar of the grid (ui/plot-toolbar.js). */
        let _toolbar = null;
        let _sections = null;
        let _addGenes = null;
        let _checklist = null;
        const _parts = [];
        const _listeners = [];
        let _message = '';
        let _kinds = {};
        let _kindsOf = null;
        /** layers whose kind is still being asked for */
        let _kindsPending = 0;
        /** section source id -> {recipe key, genes, missing, total, ...}: read when a source changes, never per paint */
        const _resolved = new Map();
        /** source id -> stop listening */
        const _watching = new Map();
        /** source id -> the status it last said, to tell an edit from a progress frame */
        const _lastStatus = new Map();
        let _plan = null;
        /** values of the store -> the plan they were asked with (a value shown while another computes keeps its own) */
        const _planOf = new WeakMap();
        const _order = createCellGeneOrder();
        /** what the plot last drew from, so a repaint with the same inputs draws nothing */
        let _shown = null;
        /** A drawing Plotly threw on: {key} of the values it was of, until a drawing succeeds. */
        let _drawFailed = null;
        let _drawToken = 0;
        let _state = 'empty';
        let _resize = null;
        let _refit = null;
        /** A redraw building the figure once more at the plot's settled size (redraw's end): no third build from it. */
        let _settling = false;
        /** gateMatrix's decision for the plan it was made for (CXG-17): what the plot asks of the server now */
        let _gate = { ask: 'all', tooLarge: null, planKey: null, axis: null, groupsOf: null };
        /** the cell axis's applied recipe as last seen: the recipe its groups are of while edits wait or are checked */
        let _applied = null;
        /** the obs column's recipe the page's group sources were last told of for this plot's own cell axis */
        let _axisRecipeSaid = null;
        /** pendingRows's answer for the plan last looked at (CXG-18): {now, held, rows} */
        let _pending = { now: null, held: null, rows: null };

        function configFrom(raw) {
            const fields = {};
            for (const [k, v] of Object.entries(raw || {})) if (!PANEL_KEYS.includes(k)) fields[k] = v;
            return normalizeCellGene(fields).config;
        }

        // ---------------------------------------------------------------- life cycle

        function init() {
            D = makeDom(document);
            _initialized = true;
            buildDom();
            listen(document, 'click', (e) => {
                const tile = `.tile[data-tile-id="${CSS.escape(_id)}"]`;
                if (!_dom || e.target.closest(`${tile} .cgene-section__more, ${tile} .cgene-add-wrap, ${tile} .cgene-checklist__go, [data-popover="section-menu"]`)) return;
                _sections.closeMenus();
                _addGenes.close();
            });
            listen(window, THEME_EVENT, () => { _shown = null; redraw(); });
            // a gene table's filter changed: the genes of its sections may have
            listen(document, 'annzarro:table-filtered', (e) => { if (e.detail && _config.sections.some((s) => s.source === e.detail.id)) sourceEdited(e.detail.id); });
            const loaded = DataManager.isDatasetLoaded();
            _dom.noData.style.display = loaded ? 'none' : 'flex';
            syncControlsWithDataset(_dom.controls, loaded);
            paint();
            return loaded ? datasetReady() : undefined;
        }

        async function datasetReady() {
            try { await loadStructure(); } catch (error) { console.error(`Cell-Gene Plot ${_id}:`, error); }
            if (!_initialized) return;
            readKinds();
            changed({ quiet: true });
        }

        function listen(target, type, fn) {
            target.addEventListener(type, fn);
            _listeners.push([target, type, fn]);
        }

        /** Drop the DOM, the listeners, the records and the handle. The configuration stays: a closed plot is still a plot. */
        function cleanup() {
            for (const [target, type, fn] of _listeners.splice(0)) target.removeEventListener(type, fn);
            for (const stop of _watching.values()) stop();
            _watching.clear();
            if (_dom) binding.releaseHost(_dom.plot);
            if (_resize) _resize.disconnect();
            _resize = null;
            clearTimeout(_refit);
            for (const part of _parts.splice(0)) if (part && part.destroy) part.destroy();
            if (_dom && window.Plotly) window.Plotly.purge(_dom.plot);
            _initialized = false;
            _dom = null;
            _shown = null;
            container.innerHTML = '';
        }

        // ---------------------------------------------------------------- what the dataset holds

        function datasetLayers() {
            const s = structureRead();
            return s ? layerKeys(s) : ['X'];
        }

        /** What each layer holds (core/matrix_kind.py), asked once per dataset: % expressing cannot be read on a signed one. */
        function readKinds() {
            const dataset = DataManager.getCurrentDataset();
            if (_kindsOf === dataset) return;
            _kindsOf = dataset;
            _kinds = {};
            const layers = datasetLayers();
            _kindsPending = layers.length;
            const settled = () => {
                if (_kindsOf !== dataset) return;
                _kindsPending--;
                if (_kindsPending <= 0) freshDefaults();
            };
            for (const layer of layers) {
                Promise.resolve(KIND_CLIENT.kind(dataset, layer, { suggest: false })).then((reply) => {
                    if (_kindsOf !== dataset) return;
                    if (reply && reply.kind) {
                        _kinds = { ..._kinds, [layer]: reply.kind };
                        // a new plot's measures follow the kinds (decision 24): the plan may read differently
                        _plan = null;
                        _shown = null;
                        sync();
                        paint();
                        redraw();
                    }
                    settled();
                }, settled);
            }
        }

        /**
         * A new plot's Color and Size from what the layers hold (operator ruling Q2), once every layer's kind is known:
         * the mean on the log-normalised layer and % expressing on the counts layer when both are identified. Not an
         * edit, so no undo step; never once the user has chosen either.
         */
        function freshDefaults() {
            if (!_fresh || _kindsPending > 0) return;
            const next = withFreshMeasures(_config);
            if (next === _config) return;
            _config = normalizeCellGene(next).config;
            changed();
        }

        /**
         * `config` with a fresh plot's Color and Size (decision 24, kept by decision 32 on both axis kinds) from all the
         * dataset's layers, or `config` itself when they would not change, the user chose them, or kinds are still asked
         * for. On a grouping axis this may read two layers, as on an obs one.
         */
        function withFreshMeasures(config) {
            if (!_fresh || _kindsPending > 0) return config;
            const d = defaultMeasures(datasetLayers(), _kinds);
            const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
            if (same(d.color, config.color) && same(d.size, config.size)) return config;
            return { ...config, color: d.color, size: d.size };
        }

        /** The grouping of the cell axis, when it is one, or null (an obs column, or none). */
        function axisGrouping() {
            const axis = _config.cellAxis;
            if (!axis || axis.type !== GROUP_AXIS) return null;
            const p = panelOf(axis.key);
            return typeOf(p) === GROUPING_TYPE ? p : null;
        }

        /**
         * The grouping's expression threshold (its method parameter, decision 34), for a measure with none of its own
         * (CXG-9). 0 on an obs axis.
         */
        function baseThreshold() {
            const g = axisGrouping();
            const r = g ? g.getRecipe() : null;
            return r && isNumber(r.detect_above) ? r.detect_above : 0;
        }

        // ---------------------------------------------------------------- the sections' genes

        /** Watch each section's source for edits (its genes), and stop watching the ones no section names. */
        function watchSources() {
            const wanted = new Set(_config.sections.map((s) => s.source));
            for (const [id, stop] of [..._watching]) {
                if (!wanted.has(id)) { stop(); _watching.delete(id); _lastStatus.delete(id); _resolved.delete(id); }
            }
            for (const id of wanted) {
                if (_watching.has(id)) continue;
                _watching.set(id, onSourceStatus(id, (status) => {
                    // a progress frame of the source's score changes no gene: only an edit, or a source no one reads, is looked at
                    const said = `${status.exists}|${status.state}|${status.key}|${JSON.stringify(status.held)}`;
                    if (status.dependants && _lastStatus.get(id) === said) return;
                    _lastStatus.set(id, said);
                    sourceEdited(id);
                }));
            }
        }

        /** A source's genes may have changed: read them again, and ask for what is new. */
        function sourceEdited(id) {
            const was = _resolved.get(id);
            _resolved.delete(id);
            const now = resolveSource(id);
            if (was && now && was.key === now.key && was.optionsKey === now.optionsKey) { _resolved.set(id, was); paint(); return; }
            _plan = null;
            sync();
            paint();
            redraw();
        }

        /**
         * A section source as the plot reads it: its genes in the dataset, how many it has and lacks, why it has none, its
         * score recipe per method and layer. Read once per change of the source.
         */
        function resolveSource(id) {
            if (_resolved.has(id)) return _resolved.get(id);
            const src = sourceAdapter.get(id);
            let out;
            if (!src) {
                out = { key: 'gone', kind: null, title: titleOfPanel(id), genes: [], total: 0, missing: 0, recipe: null,
                    empty: 'Its signature or gene table is gone.' };
            } else {
                const gate = src.gate(_id);
                if (gate) {
                    out = { key: `gate|${gate.state}`, kind: src.kind, title: src.title, genes: [], total: 0, missing: 0, recipe: null,
                        empty: gate.message || `Waiting for ${src.title}.` };
                } else {
                    const recipe = src.recipe();
                    const counted = sectionGenes(recipe, hasGene);
                    const over = tooManyGenesText(src.title, counted.total);
                    out = { key: JSON.stringify([recipe.genes, recipe.down, recipe.input, recipe.method]), kind: src.kind, title: src.title, recipe,
                        total: counted.total, missing: counted.missing, down: counted.down, genes: over ? [] : counted.genes, note: over,
                        empty: over || (counted.genes.length ? null : `No gene of ${src.title} is in this dataset.`) };
                }
            }
            // a score parameter (clip, bins, …) changes what a score aggregation reads; the retired offer does not
            out.optionsKey = out.recipe ? JSON.stringify(withoutLegacy(out.recipe)) : '';
            const scored = new Map();
            out.scoreRecipe = (column, layer) => {
                if (!out.recipe) return null;
                const k = `${column}\u0001${layer}`;
                if (!scored.has(k)) scored.set(k, serverRecipe({ ...out.recipe, method: column, input: layer }));
                return scored.get(k);
            };
            _resolved.set(id, out);
            return out;
        }

        // ---------------------------------------------------------------- the request

        function axisId() { return axisSourceId(_id, _config.cellAxis, AXIS_PREFIX); }

        /** What this plot asks of the group sources now, made once per configuration and source edit. */
        function currentPlan() {
            if (_plan) return _plan;
            const dots = _config.mode === 'dots';
            const entries = _config.sections.map((section) => {
                const r = resolveSource(section.source);
                return { section, genes: r.genes, down: r.down || 0, title: sectionTitle(section, () => r.title), empty: r.empty, scoreRecipe: r.scoreRecipe };
            });
            const threshold = baseThreshold();
            const features = planFeatures({ sections: entries, color: _config.color, size: dots && sizeDrawn() ? _config.size : null,
                height: heightOf(_config), threshold });
            const rowsOf = new Array(entries.length).fill(0);
            for (const row of features.rows) rowsOf[row.section]++;
            const wires = features.features.map((f) => f.wire);
            _plan = { ...features, threshold, entries, reads: geneReads(wires), featureCount: wires.length, option: { features: features.features.map((f) => f.wire), statistics: features.statistics },
                optionKey: features.features.map((f) => f.key).join('\u0003') + JSON.stringify(features.statistics),
                // what the matrix limit and the notices read: each section's rows and genes, the genes read
                shape: entries.map((e, i) => ({ rows: rowsOf[i], genes: e.genes.length })),
                geneCount: new Set(features.features.filter((f) => f.wire.kind === 'gene').map((f) => f.wire.name)).size };
            return _plan;
        }

        /** Whether Size can be read on its layer (SHR-27): a size the layer cannot give is drawn as one size, said so. */
        function sizeProblem() {
            const s = _config.size;
            if (!s || s.stat === 'count') return null;
            const g = statisticGrade(s.stat, s.layer, _kinds[s.layer]);
            return g.grade === 'cannot' ? negativeValuesSentence(s.stat, s.layer) : null;
        }
        const sizeDrawn = () => !sizeProblem();

        /** Watch the cell axis with what the plot draws, or stop: nothing is asked with no groups or no genes (CXG-2). */
        function sync() {
            if (!_dom) return;
            const host = _dom.plot;
            const id = axisId();
            if (!id || !_config.sections.length || !DataManager.isDatasetLoaded()) {
                binding.releaseHost(host);
                _gate = { ask: 'all', tooLarge: null, planKey: null, axis: null, groupsOf: null };
                return;
            }
            const plan = currentPlan();
            const gate = gateFor(plan, id);
            // above the limit, or while the groups that decide it are not known, the groups alone (CXG-17)
            const option = gate.ask === 'all' ? plan.option : { features: [], statistics: plan.option.statistics };
            const optionKey = gate.ask === 'all' ? plan.optionKey : `\u0004${JSON.stringify(plan.option.statistics)}`;
            const rec = binding.recordFor(host, ROLE, { axisId: id, option, optionKey });
            // the plan first: a value ready at once (every feature held) is read with the plan that asked for it
            rec.plan = plan;
            if (rec.optionKey !== optionKey) {
                rec.optionKey = optionKey;
                rec.handle.setOption(option);
            }
            binding.schedulePaint(host);
        }

        /**
         * The matrix limit for a plan (CXG-17), decided before its genes are asked for: from the groups a ready reply of
         * the cell axis says, when the rows could exceed the limit. A plan let through stays let through while its own
         * request computes (its groups are pending then, not unknown).
         */
        function gateFor(plan, id) {
            if (_gate.planKey === plan.optionKey && _gate.axis === id && _gate.ask === 'all') return _gate;
            const known = knownGroups(id);
            _gate = { ...gateMatrix({ sections: plan.shape, groups: known ? known.count : null, features: plan.featureCount, reads: plan.reads }), planKey: plan.optionKey, axis: id,
                groupsOf: known ? known.groupsOf : null };
            return _gate;
        }

        /**
         * The groups of the cell axis as a ready reply of its current groups says them (this plot's, or another
         * consumer's, such as the grouping panel's), with the groups they are of; null while no ready reply has them.
         */
        function knownGroups(id) {
            for (const h of groupSources().sources.handlesOf(id)) {
                const snap = h.read();
                const reply = snap.state === 'ready' && snap.values ? snap.values.reply : null;
                if (reply && Array.isArray(reply.groups)) return { count: reply.groups.length, groupsOf: groupsIdentity(id) };
            }
            return null;
        }

        /**
         * What the cell axis's groups are of now: the recipe its consumers show (the stored one, unless edits wait for
         * Update or for their estimate, when it is the one last applied) and the cells shown. A count is good while
         * this stays the same.
         */
        function groupsIdentity(id) {
            const st = groupSources().sources.status(id);
            if (!_applied || _applied.id !== id || (!st.held && !st.checking)) {
                const g = axisGrouping();
                _applied = { id, recipe: g ? g.getRecipe() : axisRecipe(_config.cellAxis) };
            }
            return { recipe: _applied.recipe, subset: DataManager.getSubsetParam() || '' };
        }

        const sameGroups = (a, b) => !!a && !!b && a.recipe === b.recipe && a.subset === b.subset;

        /** Decide the limit again (the groups became known, or changed). */
        function regate() {
            _gate = { ..._gate, planKey: null };
            sync();
        }


        function record() {
            return _dom ? binding.recordsOf(_dom.plot).get(ROLE) || null : null;
        }

        // ---------------------------------------------------------------- the configuration

        /** The saved configuration: the title, the plot's fields and the panel's own page state. */
        function getConfig() {
            const cfg = { title: _title, ..._config };
            if (_controlsVisible !== undefined) cfg.controlsVisible = _controlsVisible;
            return cfg;
        }

        /** One undoable step: the configuration becomes `next`. */
        function commit(next, label, { said = '' } = {}) {
            if (JSON.stringify(next) === JSON.stringify(_config)) return;
            _undo.push(label, [JSON.stringify(_config)]);
            _config = normalizeCellGene(next).config;
            _message = said;
            changed();
        }

        function undo() {
            const step = _undo.pop();
            if (!step) return false;
            _config = normalizeCellGene(JSON.parse(step.before[0])).config;
            _message = `Undone: ${step.label}.`;
            changed();
            return true;
        }

        /** The configuration changed: what is asked, what is drawn, the saved state and the history follow. */
        function changed({ quiet = false } = {}) {
            _plan = null;
            axisRecipeChanged();
            watchSources();
            sync();
            paint();
            redraw();
            if (!quiet && window.sessionManager && typeof window.sessionManager.notifyPanelUpdate === 'function') window.sessionManager.notifyPanelUpdate();
        }

        /**
         * An obs cell axis is this plot's own source ('axis:<id>', group-host.js), read through `axisSource()`: a new
         * column is a new recipe under the same id, which the group sources hear of only when told. Untold, the plot
         * kept drawing the groups of the column it had (an edit, Undo, Back or Forward of Groups), while a link of the
         * same configuration drew the new ones.
         */
        function axisRecipeChanged() {
            const axis = _config.cellAxis;
            const recipe = axis && axis.type === 'obs' ? axisRecipe(axis) : null;
            if (!recipe || recipe === _axisRecipeSaid) return;
            const had = _axisRecipeSaid;
            _axisRecipeSaid = recipe;
            if (had && _initialized) groupSources().sources.sourceChanged(axisId());
        }

        function updateConfig(config) {
            if (!config) return;
            if (config.title && config.title !== _title) { _title = config.title; paint(); }
            if (config.controlsVisible !== undefined) {
                _controlsVisible = config.controlsVisible;
                showControls();
            }
            const keys = Object.keys(config).filter((k) => !PANEL_KEYS.includes(k));
            if (!keys.length) return;
            if (keys.includes('color') || keys.includes('size')) _fresh = false;
            // Back and Forward give a whole configuration (it has the version); a remap gives the fields it rewrote.
            // Either way the configuration as saved, with no undo step
            _config = configFrom('version' in config ? config : { ..._config, ...config });
            _resolved.clear();
            if (_initialized) changed({ quiet: true });
        }

        // ---------------------------------------------------------------- edits

        const sectionName = (i) => sectionTitle(_config.sections[i], titleOfPanel);

        function setAxis(axis) {
            // a fresh plot's Color and Size follow the layers' kinds (decision 24), in the same step
            commit(withFreshMeasures({ ..._config, cellAxis: axis }), `groups ${axis.type === 'obs' ? axis.key : titleOfPanel(axis.key)}`);
        }

        function newGrouping() {
            const panel = PanelManager.createPanelNextTo(GROUPING_TYPE, _id);
            if (panel) setAxis({ type: GROUP_AXIS, key: panel.getId() });
        }

        function addGenesFrom(id) {
            commit(addSection(_config, id), `add genes of ${titleOfPanel(id)}`);
        }

        function newSignature() {
            const panel = PanelManager.createPanelNextTo('gene-signature', _id);
            if (panel) addGenesFrom(panel.getId());
        }

        function sectionOp(i, op) {
            const name = sectionName(i);
            const n = _config.sections.length;
            if (op === 'duplicate') commit(duplicateSection(_config, i, name), `duplicate ${name}`);
            else if (op === 'remove') commit(removeSection(_config, i), `remove ${name}`, { said: `Removed ${name}.` });
            else if (op === 'open') openSignature(_config.sections[i].source, _id);
            else if (op === 'up' && i > 0) move(i, i - 1);
            else if (op === 'down' && i < n - 1) move(i, i + 1);
        }

        function move(from, to) {
            const name = sectionName(from);
            commit(moveSection(_config, from, to), `move ${name}`, { said: `${name} moved to position ${to + 1} of ${_config.sections.length}` });
            _sections.focus(to);
        }

        /** A one-row section's Color or Size: its kind, or a score's method or layer (decision 31, item 7). */
        function setAggregation(i, which, part, value) {
            const section = _config.sections[i];
            if (!section) return;
            const held = effectiveAggregation(rowAggregationOf(section, which), _config[which], resolveSource(section.source).down);
            const next = aggregationAfter(held, part, value, scoreChoices(section.source, { method: held.column, layer: held.layer }, { datasetLayers: datasetLayers() }));
            if (!next) { paint(); return; }
            commit(setRowAggregation(_config, i, which, next.agg), `${which === 'color' ? 'color' : 'size'} of ${sectionName(i)}`, { said: next.say });
        }

        function setAbove(i, which, text) {
            const section = _config.sections[i];
            const held = section && effectiveAggregation(rowAggregationOf(section, which), _config[which], resolveSource(section.source).down);
            const v = Number(text);
            if (!held || held.agg !== 'score_pct_above' || text === '' || !Number.isFinite(v)) { paint(); return; }
            const next = { ...held };
            if (v === 0) delete next.above; else next.above = v;
            commit(setRowAggregation(_config, i, which, next), `threshold of ${sectionName(i)}`);
        }

        // ---------------------------------------------------------------- DOM

        function buildDom() {
            const { el } = D;
            const root = el('div', { class: 'cgene-panel', data: { panelId: _id, state: 'empty' } });
            root.insertAdjacentHTML('afterbegin', noDatasetScreenHtml(_id));
            _addGenes = createAddGenes({ D, id: _id, sources: addSources, on: { add: addGenesFrom, newSignature } });
            _sections = createSectionList({ D, id: _id, model: sectionsModel, on: {
                rows: (i, rows) => commit(setSectionRows(_config, i, rows), `${sectionName(i)} as ${rows === 'set' ? 'one row' : 'genes'}`),
                title: (i, text) => commit(setSectionTitle(_config, i, text), `rename ${sectionName(i)}`),
                op: sectionOp, move, aggregation: setAggregation, above: setAbove
            } });
            _controls = createControls({ D, id: _id, model: controlsModel, sections: _sections.element, addGenes: _addGenes.element, on: {
                axis: setAxis, newGrouping,
                mode: (mode) => commit({ ..._config, mode }, mode === 'dots' ? 'show as dots' : 'show as a heatmap'),
                stat: setStat, layer: setLayer, above: setThreshold,
                scale: (value) => commit({ ..._config, scale: value }, 'scale'),
                swap: (on) => commit({ ..._config, swap: on }, 'swap axes')
            } });
            const undoBtn = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary cgene-undo', disabled: true, on: { click: () => undo() } }, 'Undo');
            const message = el('div', { class: 'cgene-message', role: 'status', aria: { live: 'polite' } });
            _checklist = createChecklist({ D, on: {
                groups: () => { revealControls(); _dom.controls.querySelector('.cgene-axis-type').focus(); },
                genes: () => { revealControls(); _dom.controls.querySelector('.cgene-add').click(); }
            } });
            const checklist = _checklist.element;
            // One cell per group (CXG-27): the size can only be 0 or 100, so a heatmap says more
            const hint = el('div', { class: 'cgene-hint', role: 'status', hidden: true },
                el('span', { text: STATES.oneCell }), ' ',
                el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary cgene-hint__do',
                    on: { click: () => commit({ ..._config, mode: 'heatmap' }, 'show as a heatmap') } }, STATES.buttons.heatmap));
            const plot = el('div', { class: 'cgene-plot', role: 'img', aria: { label: _title } });
            plot.__azPanelId = _id;
            plot.__azCellGene = true;
            plot.__azChooser = null;
            const area = el('div', { class: 'cgene-area' }, plot, el('div', { class: 'cgene-empty' }, checklist));
            // Cluster ▾, Color ▾ and Plot Options are pop-overs (cell-gene/options.js), out of the panel's flow
            // the shared plot toolbar (ui/plot-toolbar.js): [3D] [Swap axes] [Cluster ▾] [Color ▾] ... [Undo] [Plot Options], as in every plot
            _toolbar = createPlotToolbar({ className: 'cgene-toolbar', undo: undoBtn });
            _controls.element.append(_toolbar.element);
            root.append(_controls.element, message, hint, area);
            root.addEventListener('keydown', onKey);
            container.innerHTML = '';
            container.appendChild(root);
            plot.__azChooser = root.querySelector('.cgene-axis-key');
            _dom = { root, controls: _controls.element, undoBtn, message, checklist, hint, plot, area,
                noData: root.querySelector(`#loading-screen-${_id}`) };
            if (typeof ResizeObserver !== 'undefined') {
                _resize = new ResizeObserver(() => {
                    if (!_dom || !_dom.plot._fullLayout) return;
                    fitToContainer(_dom.plot);
                    // the figure is laid out in px (labels that fit, legend lines, dots that fill their cells): a new
                    // size, once it settles, builds it again (no request; the values are the same)
                    clearTimeout(_refit);
                    _refit = setTimeout(refit, 150);
                });
                _resize.observe(area);
                // the plot itself too: the status strip under it takes height from it inside the same area
                _resize.observe(plot);
            }
            showControls();
            mountParts();
        }

        /** A statistic setting keeps its own threshold across a change of statistic or layer (CXG-9). */
        const withThreshold = (spec) => (isNumber(spec.detect_above) ? { detect_above: spec.detect_above } : {});
        const measureName = (which) => which;

        /** A measure's statistic (WP-4, decision 31): its layer stays when it can give the statistic, else the first that can, said once. */
        function setStat(which, stat) {
            if (which === 'height') { setHeightStat(stat); return; }
            _fresh = false;
            const spec = _config[which];
            if (stat === 'count') {
                commit({ ..._config, [which]: { ...withThreshold(spec), stat } }, `${measureName(which)} statistic`);
                return;
            }
            const { layer, say } = pickLayer({ datasetLayers: datasetLayers(), kinds: _kinds, stat, preferred: spec.layer });
            commit({ ..._config, [which]: { ...withThreshold(spec), stat, layer } }, `${measureName(which)} statistic`, { said: say });
        }

        /**
         * Height's statistic (UX 6b): Same as Color stores none; a statistic of its own starts from Color's layer and
         * threshold, so the bars read what the colors read until a layer is chosen.
         */
        function setHeightStat(stat) {
            if (stat === SAME_AS_COLOR) {
                const next = { ..._config };
                delete next.height;
                commit(next, 'height same as color');
                return;
            }
            const spec = _config.height || _config.color;
            if (stat === 'count') {
                commit({ ..._config, height: { ...withThreshold(spec), stat } }, 'height statistic');
                return;
            }
            const { layer, say } = pickLayer({ datasetLayers: datasetLayers(), kinds: _kinds, stat, preferred: spec.layer || _config.color.layer });
            commit({ ..._config, height: { ...withThreshold(spec), stat, layer } }, 'height statistic', { said: say });
        }

        /** A measure's layer (WP-4): Color and Size may read different layers; each gene is then read on both. */
        function setLayer(which, layer) {
            if (which !== 'height') _fresh = false;
            commit({ ..._config, [which]: { ..._config[which], layer } }, `${measureName(which)} layer`);
        }

        /**
         * A measure's expression threshold, beside it (WP-4): a number from 0 up, else the box shows the one in force. On a
         * grouping axis the box is an override of the grouping's Expressed above (decision 35): emptied, the measure follows
         * the grouping again.
         */
        function setThreshold(which, text) {
            const spec = _config[which];
            if (axisGrouping() && String(text).trim() === '') {
                if (!spec || !isNumber(spec.detect_above)) { paint(); return; }
                if (which !== 'height') _fresh = false;
                const next = { ...spec };
                delete next.detect_above;
                commit({ ..._config, [which]: next }, `${measureName(which)} threshold follows the grouping`);
                return;
            }
            const p = parseThresholdText(text);
            if (!p.ok) { paint(); return; }
            if (spec && spec.detect_above === p.value) { paint(); return; }
            if (which !== 'height') _fresh = false;
            commit({ ..._config, [which]: { ...spec, detect_above: p.value } }, `${measureName(which)} threshold`);
        }

        function mountParts() {
            const ctx = {
                panelId: _id, D, config: () => _config, set: (patch, label) => commit({ ..._config, ...patch }, label), undo,
                // the drawing as last drawn, for the clustering's sentences and Download CSV
                drawn: () => (_shown && _shown.model ? { model: _shown.model, order: _shown.order } : null),
                // the recipe the cell axis's groups are of, for "Within <first factor>"
                recipe: shownRecipe, titleOf: sourceTitleOf,
                title: () => _title,
                // the matrix drawn, for the 3D cap; the image export of Plot Options
                shape: () => (_shown ? { rows: _shown.rows, groups: _shown.groups } : null),
                exportImage: (format, settings = {}) => { if (_dom && _shown) exportPlot(_dom.plot, format, settings, 'full'); },
                copyImage: (settings) => { if (_dom && _shown) copyPlotToClipboard(_dom.plot, settings); },
                // the shared Plot Options (WP-5a): a whole configuration as one undoable step, or (the session default
                // followed) without one; the plot's size on screen, for an export of the size shown
                commit: (next, label) => commit(next, label),
                replace: (next) => { _config = normalizeCellGene(next).config; changed(); },
                plotSize: () => (_dom ? { width: _dom.plot.clientWidth, height: _dom.plot.clientHeight } : {}),
                plot: () => (_dom ? _dom.plot : null),
                toolbar: _toolbar,
                // a tag of the plot's status strip (the clustering's sentences)
                tag: (kind, tag) => { if (_dom) setStatusTag(_dom.plot, kind, tag); }
            };
            _parts.push(PARTS.options.mount(_controls.layoutSlot, ctx));
            // [3D] [Swap axes] [Cluster ▾] [Color ▾] … [Undo] [⚙ Plot Options] (decision 39): Swap axes after 3D, both views
            if (_toolbar) _toolbar.add({ actions: [_controls.swap] });
            // a gene clicked is focused; a group's label offers Open grouping when the groups are a grouping's (CXG-15)
            _parts.push(PARTS.clicks.mount(_dom.area, {
                D, plot: _dom.plot, drawn: () => (_shown ? _shown.model : null),
                grouping: () => { const g = axisGrouping(); return g ? g.getId() : null; },
                open: (id) => openPanel(id, _id),
                focus: (gene) => DataManager.setFocusedGene(gene), focused: () => DataManager.getFocusedGene()
            }));
        }

        /** The grouping recipe the cell axis's groups are of: the one last applied, or the stored one. */
        function shownRecipe() {
            const id = axisId();
            return id ? groupsIdentity(id).recipe : null;
        }

        /** Toggle Controls: the control grid hides, the plot stays. */
        function showControls() {
            if (!_dom) return;
            const visible = _controlsVisible !== false;
            if (!visible || _dom.controls.dataset.controlsHidden === 'true') setControlsVisible(_dom.controls, visible);
        }

        function onKey(e) {
            const typing = e.target && (e.target.tagName === 'INPUT' && (e.target.type === 'text' || e.target.type === 'number'));
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing) {
                if (undo()) e.preventDefault();
            }
        }

        // ---------------------------------------------------------------- models of the controls

        function addSources() {
            const list = sourceList();
            return ['signature', 'table'].map((kind) => ({ heading: KIND_HEADING[kind], items: list.filter((s) => s.kind === kind) }));
        }

        function measure(spec) {
            const g = axisGrouping();
            return measureModel({ spec, datasetLayers: datasetLayers(), kinds: _kinds, threshold: isNumber(spec.detect_above) ? spec.detect_above : baseThreshold(),
                grouping: g ? { title: g.getTitle(), value: baseThreshold() } : null });
        }

        /** Height's row: its own measure, or Same as Color (Color's statistics listed after it, no layer, no threshold). */
        function heightModel() {
            const own = _config.height;
            const m = measure(own || _config.color);
            const stats = [{ value: SAME_AS_COLOR, label: W3.sameAsColor }, ...m.stats];
            return own ? { ...m, stats } : { ...m, stat: SAME_AS_COLOR, layer: undefined, stats, layers: [], threshold: null };
        }

        function controlsModel() {
            const all = PanelManager.getAllPanels().filter((p) => typeOf(p) === GROUPING_TYPE).map((p) => ({ id: p.getId(), title: p.getTitle() }));
            return {
                axis: _config.cellAxis || null,
                choices: axisChoices({ structure: structureRead(), self: _id, groupings: all, loops: wouldLoop }),
                mode: _config.mode,
                // each measure: statistic, layer (all of them, graded: SHR-27, decision 31) and its threshold (WP-4)
                color: measure(_config.color),
                size: measure(_config.size),
                // 3D's Height (UX 6b): Same as Color first; shown while 3D is on, kept while it is off
                height: heightModel(),
                view3d: _config.view === '3d',
                scale: _config.scale || 'none',
                swap: !!_config.swap
            };
        }

        /** "z-score mean · X": the method and layer a score aggregation reads. */
        function scoreOptionName(agg) {
            return `${SIGNATURE_MODEL.methodShort(agg.column)} · ${agg.layer || 'X'}`;
        }

        /**
         * What a one-row section's Color or Size shows (decision 31, item 7): its label, and for a score kind the method
         * and layer selects (score-source.js scoreChoices: every method and layer, graded for the section's source).
         */
        function sectionPart(section, which, layer) {
            const down = resolveSource(section.source).down || 0;
            const held = effectiveAggregation(rowAggregationOf(section, which), _config[which], down);
            if (!held.column) return { held, layer, down, label: CGV.aggregation[held.agg], methods: null, layers: null };
            const label = CGV.scoreAggregation[held.agg](scoreOptionName(held));
            const c = scoreChoices(section.source, { method: held.column, layer: held.layer }, { datasetLayers: datasetLayers() });
            const entry = (e, name) => ({ value: e.value, label: e.lapsed ? `${name} (not available)` : name, title: e.title, disabled: e.disabled, lapsed: e.lapsed });
            const methods = c ? c.methods.map((e) => entry(e, SIGNATURE_MODEL.methodShort(e.value)))
                : [{ value: held.column, label: SIGNATURE_MODEL.methodShort(held.column) }];
            const layers = c ? c.layers.map((e) => ({ value: e.value, label: e.label, title: e.title, disabled: e.disabled, lapsed: e.lapsed }))
                : [{ value: held.layer || 'X', label: held.layer || 'X' }];
            return { held, layer, down, label, methods, layers };
        }

        function sectionsModel() {
            const dots = _config.mode === 'dots';
            return {
                dots,
                sections: _config.sections.map((section) => {
                    const r = resolveSource(section.source);
                    const title = sectionTitle(section, () => r.title);
                    const part = (which, layer) => sectionPart(section, which, layer);
                    return {
                        title, source: title !== r.title ? r.title : null, rows: section.rows,
                        line: r.kind ? sectionLine(r) : r.empty, note: r.kind && r.empty ? r.empty : null,
                        color: part('color', _config.color.layer || 'X'),
                        size: dots ? part('size', _config.size.layer || 'X') : null
                    };
                })
            };
        }

        // ---------------------------------------------------------------- painting

        /** The plot's state in one word (data-state), for the styles and the tests (states.js plotState). */
        function stateOf() {
            if (!DataManager.isDatasetLoaded()) return 'nodata';
            if (!_config.cellAxis || !_config.sections.length) return 'empty';
            const rec = record();
            if (!rec) return 'empty';
            const snap = rec.handle.read();
            const state = plotState(snap, { tooLarge: !!_gate.tooLarge, drawn: !!_shown && _shown.key === (snap.shownKey || snap.key) });
            // the values came but Plotly threw drawing them: failed, not "drawing" for good
            return state === 'drawing' && _drawFailed && _drawFailed.key === (snap.shownKey || snap.key) ? 'failed' : state;
        }

        /** What the plot's notices are worded from (states.js describePlot): counts made once per plan, nothing per gene. */
        function plotFacts() {
            const plan = _plan;
            const cells = DataManager.getCells();
            return {
                genes: plan ? plan.geneCount : 0,
                // each gene read once per layer and threshold (WP-4): the notices count both layers
                reads: plan ? plan.reads : null,
                cells: cells && Number.isFinite(Number(cells.length)) ? Number(cells.length) : null,
                layer: (_config.color && _config.color.layer) || null,
                tooLarge: _gate.tooLarge,
                ownJobAhead: () => ownJobAhead(PanelManager.getActivePanels()
                    .filter((p) => typeOf(p) === TYPE && p.getId() !== _id && typeof p.axisSnapshot === 'function')
                    .map((p) => ({ title: p.getTitle(), snap: p.axisSnapshot() })))
            };
        }

        /** The controls, shown when Toggle Controls hid them: a notice's or the checklist's button goes to one. */
        function revealControls() {
            if (_controlsVisible === false) { _controlsVisible = true; showControls(); }
        }

        /** Asks first, Fewer genes (UX 3.5): the section list, at its first section. */
        function fewerGenes() {
            if (!_dom) return;
            revealControls();
            if (_config.sections.length) _sections.focus(0);
            else _dom.controls.querySelector('.cgene-add').focus();
        }

        /**
         * The store said something of the cell axis: the state word follows, and groups ready that are not drawn yet are
         * drawn (a progress frame costs a read of the handle and nothing else).
         */
        function snapshotChanged(snap) {
            if (!_dom) return;
            // the grouping's Expressed above was edited (Methods ▾, decision 34): it is outside the grouping's hash, so the
            // groups stay; the measures that follow it are read again at the new threshold
            if (_plan && _plan.threshold !== baseThreshold()) {
                _plan = null;
                sync();
                paint();
                redraw();
                return;
            }
            // the groups changed since they were counted (the grouping was edited): unknown again, so with rows that could
            // exceed the limit the groups go first, before any gene (CXG-17, Q4)
            if (_gate.ask === 'all' && _gate.groupsOf && !sameGroups(groupsIdentity(axisId()), _gate.groupsOf)) {
                regate();
                paint();
                redraw();
                return;
            }
            // the groups the limit waits for are known, or the groups changed: decide again (CXG-17)
            if (snap.state === 'ready' && snap.values && snap.values.reply && Array.isArray(snap.values.reply.groups)) {
                const grown = _plan && gateMatrix({ sections: _plan.shape, groups: snap.values.reply.groups.length, features: _plan.featureCount,
                    reads: _plan.reads }).ask !== 'all';
                if (_gate.ask !== 'all' || grown) {
                    regate();
                    paint();
                    redraw();
                    return;
                }
            }
            if (snap.state === 'ready' && snap.values && (!_shown || _shown.key !== (snap.shownKey || snap.key))) { redraw(); return; }
            // a color changed in the grouping: the strips and their legend are drawn again, with nothing asked of the server
            if (snap.state === 'ready' && snap.values && snap.values.reply && _shown && _shown.colours
                && groupSources().sources.coloursOf(axisId(), snap.values.reply).factors !== _shown.colours) { redraw(); return; }
            // a section added while the others are drawn: its placeholder rows, once per plan, not per progress frame (CXG-18)
            if (snap.state === 'updating' && snap.values && _plan && _pending.now !== _plan && _planOf.has(snap.values) && _planOf.get(snap.values) !== _plan) {
                redraw();
                return;
            }
            _state = stateOf();
            _dom.root.dataset.state = _state;
        }

        function paint() {
            if (!_dom) return;
            _controls.paint();
            _sections.paint();
            _state = stateOf();
            _dom.root.dataset.state = _state;
            _checklist.paint({ groups: !!_config.cellAxis, genes: !!_config.sections.length });
            // No size (SHR-27): the dots at one size, said in the strip
            const noSize = _config.mode === 'dots' && _state !== 'empty' ? sizeProblem() : null;
            setStatusTag(_dom.plot, 'cgene-nosize', noSize ? { text: STATES.tags.noSize, title: noSize, severity: 'warning', pop: { text: noSize } } : null);
            _dom.hint.hidden = !(_shown && _shown.oneCell && _config.mode === 'dots');
            _dom.area.classList.toggle('cgene-area--empty', _state === 'empty');
            const step = _undo.peek();
            _dom.undoBtn.disabled = !step;
            _dom.undoBtn.title = step ? `Undo: ${step.label}` : 'Nothing to undo';
            _dom.undoBtn.setAttribute('aria-label', step ? `Undo: ${step.label}` : 'Undo');
            _dom.message.textContent = _message;
            _dom.plot.setAttribute('aria-label', _title);
            for (const part of _parts) if (part && part.update) part.update();
        }

        // ---------------------------------------------------------------- drawing

        /** Draw what the store holds for the cell axis (the figure of panels/cell-gene/draw.js). Never asks for anything. */
        async function redraw() {
            if (!_dom) return;
            const token = ++_drawToken;
            const rec = record();
            const snap = rec ? rec.handle.read() : null;
            if (snap && snap.state === 'ready' && snap.values && !_planOf.has(snap.values)) _planOf.set(snap.values, rec.plan || currentPlan());
            const values = snap && snap.values;
            let plan = values ? _planOf.get(values) : null;
            // a newer plan asking for the same features reads these values as well, and may read them differently: a
            // Height of its own on Color's layer adds no feature but gives each row its height (UX 6b)
            if (plan && snap.state === 'ready' && _plan && _plan !== plan && _plan.optionKey === plan.optionKey) {
                plan = _plan;
                _planOf.set(values, plan);
            }
            // the genes were not asked for (above the limit, or the groups first): there is nothing to draw
            if (_gate.ask !== 'all' && snap && snap.state === 'ready') { clearPlot(); paint(); return; }
            if (!values || !plan || !values.reply) {
                if (!rec || !snap || !snap.values) clearPlot();
                paint();
                return;
            }
            const key = snap.shownKey || snap.key;
            // while other features compute, the drawing stays as it is (it was made with the settings of its own request),
            // except that a section added meanwhile is drawn with placeholder rows (CXG-18)
            let shownPlan = plan;
            let pending = null;
            if (snap.state !== 'ready') {
                const now = currentPlan();
                pending = snap.state === 'updating' && now !== plan ? pendingRows(now, plan) : null;
                if (pending) shownPlan = now;
            }
            // only rows added to a drawing: a quiet recompute, said by the placeholder rows and, past 10 s, the strip's bar,
            // never an overlay (decision 21); a first draw or an edit that changes the drawing keeps its notice
            if (rec.quiet !== !!pending) {
                rec.quiet = !!pending;
                binding.paint(_dom.plot);
            }
            if (snap.state !== 'ready' && !pending && _shown) { paint(); return; }
            // the colors of the groups are an input: a color changed in the grouping draws the strips again, asking nothing
            const inputs = [values, shownPlan, _config, _kinds, currentTheme(), groupSources().sources.coloursOf(axisId(), values.reply).factors];
            if (_shown && _shown.inputs.every((x, i) => x === inputs[i])) { paint(); return; }
            let figure;
            let order;
            let model;
            let colours;
            try {
                ({ figure, order, model, colours } = await drawFigure(values, plan, shownPlan, pending));
            } catch (error) {
                console.error(`Cell-Gene Plot ${_id}:`, error);
                return;
            }
            if (token !== _drawToken || !_dom || !window.Plotly) return;
            // every group the reply has is drawn: the cells shown are covered; the matrix's own count is a tag of the strip
            try {
                await drawPlot(_dom.plot, figure.data, figure.layout, figure.config, Coverage.complete(values.reply.n_shown || 0, 'cells'), 'cells');
            } catch (error) {
                // Plotly threw part-way: the div holds half a figure, and the next Plotly.react, diffed against it,
                // redrew only part of the next one (operator, 2026-11-23: a heatmap whose annotations changed over the
                // dots). Start clean and say so; the next change draws afresh
                console.error(`Cell-Gene Plot ${_id}: the drawing failed`, error);
                if (token !== _drawToken || !_dom) return;
                window.Plotly.purge(_dom.plot);
                _shown = null;
                _drawFailed = { key };
                const why = String((error && error.message) || error).replace(/[.\s]+$/, '');
                setStatusTag(_dom.plot, 'cgene-notdrawn', { text: STATES.tags.notDrawn, title: STATES.notDrawn(why), severity: 'error' });
                paint();
                return;
            }
            if (token !== _drawToken || !_dom) return;
            if (_drawFailed) {
                _drawFailed = null;
                setStatusTag(_dom.plot, 'cgene-notdrawn', null);
            }
            setStatusTag(_dom.plot, 'cgene-matrix', matrixTag(figure.groups, figure.rows, figure.missing));
            // what a narrow width gave up so the matrix stays readable (draw.js fitMatrix)
            const gaveUp = (figure.hidden || []).map((part) => VOCABULARY.cellGene.narrow[part]).join(' ');
            setStatusTag(_dom.plot, 'cgene-narrow', gaveUp ? { text: VOCABULARY.cellGene.narrow.tag, title: gaveUp } : null);
            // 3D: what it leaves out; over the cap, why the plot is in 2D (UX 6b)
            const want3d = _config.view === '3d';
            setStatusTag(_dom.plot, 'cgene-3d', model.view === '3d' ? { text: W3.tag, title: W3.leftOut, pop: { text: W3.leftOut } }
                : want3d && figure.refused3d ? { text: W3.offTag, title: figure.refused3d, severity: 'warning', pop: { text: figure.refused3d } } : null);
            watchCamera(model.view === '3d' ? figure.labels3d : null);
            const oneCell = oneCellPerGroup({ mode: _config.mode, size: _config.size, sized: sizeDrawn(), groups: values.reply.groups || [] });
            _shown = { key, inputs, order, model, rows: figure.rows, groups: figure.groups, oneCell, colours };
            rec.drawnKey = key;
            // the figure is laid out in px for the plot's size when it was built; the drawing's notice and status strip
            // can take height from it since. Build it once more at the size it has now, before the panel says it is
            // drawn, so nothing redraws it later at idle (a menu opened on a label would lose its anchor)
            if (!_settling && sizeMoved(model.pixels)) {
                _settling = true;
                _shown = null;
                try { await redraw(); } finally { _settling = false; }
                return;
            }
            binding.paint(_dom.plot);
            paint();
        }

        /** Whether the plot's size differs from `px` (the size a figure was built for) by more than a pixel. */
        function sizeMoved(px) {
            return !!(px && _dom && (Math.abs(_dom.plot.clientWidth - px.width) > 1 || Math.abs(_dom.plot.clientHeight - px.height) > 1));
        }

        /** Draw again when the plot's size differs from the size its figure was built for. */
        function refit() {
            if (_shown && _shown.model && sizeMoved(_shown.model.pixels)) {
                _shown = null;
                redraw();
            }
        }

        function clearPlot() {
            if (_shown && _dom && window.Plotly) window.Plotly.purge(_dom.plot);
            if (_dom) { setStatusTag(_dom.plot, 'cgene-matrix', null); setStatusTag(_dom.plot, 'cgene-narrow', null); setStatusTag(_dom.plot, 'cgene-3d', null); }
            _shown = null;
        }

        /**
         * Keep the 3D camera in the configuration as the user turns it (UX 6b, Q17): stored once it rests, rounded, with no
         * undo step and no redraw; the default camera is stored as none. Off in 2D. The listener is set again on each draw
         * (a purge drops it). The category labels follow at once: turned to the other side, they change edge and anchor
         * (draw.js sceneLabels; `labels` is the drawing's labels3d, null in 2D).
         */
        function watchCamera(labels) {
            const on = !!labels;
            const gd = _dom && _dom.plot;
            if (!gd || typeof gd.on !== 'function') return;
            if (gd.__azCgCamera && typeof gd.removeListener === 'function') gd.removeListener('plotly_relayout', gd.__azCgCamera);
            gd.__azCgCamera = null;
            if (!on) return;
            // a turn released outside the plot is recorded too (scene-camera.js)
            recordCameraOnRelease();
            let timer = null;
            gd.__azCgCamera = (ev) => {
                const camera = ev && ev['scene.camera'];
                if (!camera) return;
                relabel(gd, labels, camera);
                clearTimeout(timer);
                timer = setTimeout(() => storeCamera(camera), CAMERA_STORE_MS);
            };
            gd.on('plotly_relayout', gd.__azCgCamera);
        }

        /** The labels for a camera, set only when an edge or an anchor changed (the relayout carries no camera). */
        function relabel(gd, labels, camera) {
            if (!window.Plotly || !gd.layout || !gd.layout.scene) return;
            const next = sceneLabels(labels, camera);
            const key = (list) => (list || []).map((a) => `${a.xanchor}|${a.x}|${a.y}`).join(',');
            if (key(next) === key(gd.layout.scene.annotations)) return;
            window.Plotly.relayout(gd, { 'scene.annotations': next });
        }

        const sameCamera = (a, b) => ['eye', 'center', 'up'].every((k) => ['x', 'y', 'z'].every((d) => Math.abs(((a[k] || {})[d] || 0) - ((b[k] || {})[d] || 0)) < 1e-3));

        /** The camera into the configuration: a view, like Cell Plot's zoom, so no undo step and no redraw. */
        function storeCamera(camera) {
            if (_config.view !== '3d') return;
            const rounded = roundCamera(camera);
            const next = { ..._config };
            if (sameCamera(rounded, DEFAULT_CAMERA)) delete next.camera; else next.camera = rounded;
            if (JSON.stringify(next) === JSON.stringify(_config)) return;
            _config = normalizeCellGene(next).config;
            if (window.sessionManager && typeof window.sessionManager.notifyPanelUpdate === 'function') window.sessionManager.notifyPanelUpdate();
        }

        /** Reset camera (the modebar): the default view, and no stored camera. */
        function resetCamera(gd) {
            if ('camera' in _config) {
                const next = { ..._config };
                delete next.camera;
                _config = normalizeCellGene(next).config;
                if (window.sessionManager && typeof window.sessionManager.notifyPanelUpdate === 'function') window.sessionManager.notifyPanelUpdate();
            }
            if (window.Plotly) window.Plotly.relayout(gd, { 'scene.camera': JSON.parse(JSON.stringify(DEFAULT_CAMERA)) });
        }

        /**
         * The rows of `now` whose features `held` (the plan the shown values were asked with) lacks, when they are whole
         * sections added while the others are drawn (CXG-18); null otherwise (an edit that changes every row keeps the
         * drawing as it is until its values come).
         */
        function pendingRows(now, held) {
            if (_pending.now === now && _pending.held === held) return _pending.rows;
            _pending = { now, held, rows: placeholderRows(now, held) };
            return _pending.rows;
        }

        function placeholderRows(now, held) {
            const have = new Set(held.features.map((f) => f.key));
            const keysOf = (part) => (!part ? [] : typeof part === 'string' ? [part] : part.key !== undefined ? [part.key] : part.keys || []);
            const missing = now.rows.map((row) => [...keysOf(row.color), ...keysOf(row.size)].some((k) => k && !have.has(k)));
            const partly = new Set();
            const whole = new Set();
            now.rows.forEach((row, r) => { (missing[r] ? whole : partly).add(row.section); });
            for (const section of whole) if (partly.has(section)) return null;
            return whole.size && partly.size ? missing : null;
        }

        /**
         * The figure of the values `asked` (the plan they were asked with) holds, in the order of cell-gene-order.js: `plan`
         * is the plan whose rows are drawn (the values' own, or a newer one whose `pending` rows are placeholders while
         * their genes are read).
         */
        async function drawFigure(values, asked, plan = asked, pending = null) {
            const reply = values.reply;
            const groups = reply.groups || [];
            const byKey = new Map(asked.features.map((f, i) => [f.key, values.features[i]]));
            const momentsOf = (key) => {
                const f = byKey.get(key);
                return f && f.moments && !(f.status && f.status.status === 'missing') ? f.moments : null;
            };
            const titles = plan.entries.map((e) => e.title);
            const matrix = buildMatrix(plan, momentsOf, groups, withGroupingThreshold(_config, baseThreshold()), {
                titleOf: (i) => titles[i],
                scoreName: (agg) => {
                    const name = scoreOptionName(agg);
                    return agg.agg === 'score_pct_above' ? `${VOCABULARY.cellGene.scoreAggregation.score_pct_above(name)} ${agg.above || 0}`
                        : VOCABULARY.cellGene.scoreAggregation.score_mean(name);
                }
            });
            const G = groups.length;
            const R = matrix.rows.length;
            const colorSettings = colourSettings(matrix.color);
            const style = figureExtras(_config);
            const bars = colourBars({ values: matrix.color.values, rows: R, groups: G }, barSections(matrix.rows), colorSettings);
            const orderSections = [];
            plan.rows.forEach((row) => {
                const last = orderSections[orderSections.length - 1];
                if (row.kind === 'gene' && last && last.kind === 'genes' && last.index === row.section) last.genes.push(row.label);
                else orderSections.push(row.kind === 'gene' ? { kind: 'genes', index: row.section, genes: [row.label] } : { kind: 'set' });
            });
            const parts = Array.isArray(reply.partitionings) ? reply.partitionings.length : 1;
            const order = await _order.order({ values: matrix.color.values, sections: orderSections, bars, groups, partitionings: parts,
                cluster: style.cluster, sortBySize: style.sortBySize });
            const names = groupSources().sources.namesOf(axisId(), reply);
            const permute = (arr) => (arr ? reorder(arr, order.rows, order.groups, G) : arr);
            const coloured = groupSources().sources.coloursOf(axisId(), reply);
            const colours = coloured.factors;
            // each group's own colour and names, for the Group band (decision 38)
            const extras = figureExtras(_config, { reply, recipe: shownRecipe(), order, titleOf: sourceTitleOf, colors: colours,
                groups: { colours: coloured.groups, generated: coloured.generated, names } });
            const look = resolveStyle(_config, TYPE);
            const rows = Array.from(order.rows, (r, k) => {
                const row = matrix.rows[r];
                const prev = k > 0 ? matrix.rows[order.rows[k - 1]] : null;
                return { kind: row.kind, label: row.label, section: row.section, own: row.own, pending: !!(pending && pending[r]),
                    gapBefore: prev && prev.section.index !== row.section.index ? extras.gap : 0 };
            });
            const sizeNone = sizeProblem();
            // a small group kept as it is gets "small" after its label (CXG-14, SHR-12); the collected one is named so already
            const smallRule = effectiveSmall(shownRecipe() || {});
            const isSmall = (group) => smallRule.mode === 'keep' && group.n < smallRule.threshold
                && !(group.key.length === 1 && group.key[0] === RESERVED.small);
            const model = {
                mode: _config.mode, swap: !!_config.swap,
                pixels: { width: _dom.plot.clientWidth || 900, height: _dom.plot.clientHeight || 600 },
                groups: Array.from(order.groups, (g) => ({ label: names[g] || '', n: groups[g].n, small: isSmall(groups[g]) })),
                rows,
                color: { ...colorSettings, ...extras.color, values: permute(matrix.color.values), raw: permute(matrix.color.raw),
                    noExpressing: permute(matrix.color.noExpressing) },
                size: _config.mode !== 'dots' ? { none: '' } : sizeNone ? { none: sizeNone }
                    : { id: matrix.size.id, stat: matrix.size.stat, layer: matrix.size.layer, detectAbove: matrix.size.detectAbove,
                        ...extras.size, values: permute(matrix.size.values) },
                legend: extras.legend, plotTitle: extras.plotTitle, annotations: extras.annotations, outline: extras.outline, dotOpacity: extras.dotOpacity,
                // the shared Plot Options' legend column: space, columns, cap (WP-5a)
                legendLayout: cellGeneLegend(look),
                pendingText: pending ? pendingText(plan, pending) : ''
            };
            // 3D (UX 6b): within the bar cap; above it the plot is drawn in 2D and the strip says why
            const gate3d = _config.view === '3d' ? view3dGate({ rows: R, groups: G }) : null;
            if (gate3d && gate3d.ok && matrix.height) {
                model.view = '3d';
                model.height = { ...(matrix.height.same ? { same: true, values: model.color.values } : { ...matrix.height, values: permute(matrix.height.values) }), ...extras.height };
                if (_config.camera) model.camera = _config.camera;
            }
            // the shared Plot Options (WP-5a): the font and colours the builder measures with, then the rest of the look
            const figure = applyPlotStyle(buildFigure(model, styleTheme(look, PLOT_PALETTES[currentTheme() === 'dark' ? 'dark' : 'light'])), look, TYPE);
            if (gate3d && !gate3d.ok) figure.refused3d = gate3d.text;
            if (model.view === '3d' && window.Plotly && window.Plotly.Icons) {
                figure.config.modeBarButtonsToAdd = [{ name: 'resetCameraCellGene', title: W3.resetCamera, icon: window.Plotly.Icons.home, click: (gd) => resetCamera(gd) }];
            }
            // the cells of the matrix with no value, for the strip (CXG-16): once per drawing; placeholders are not missing
            let missing = 0;
            for (let r = 0; r < R; r++) {
                if (pending && pending[r]) continue;
                for (let i = r * G, end = i + G; i < end; i++) if (Number.isNaN(matrix.color.values[i])) missing++;
            }
            return { figure: { ...figure, rows: rows.length, groups: model.groups.length, missing }, order, model, colours };
        }

        /** "Reading 12 genes": what the placeholder rows of a plan say (CXG-18), from the genes of their sections. */
        function pendingText(plan, pending) {
            const genes = new Set();
            plan.rows.forEach((row, r) => { if (pending[r]) for (const g of plan.entries[row.section].genes) genes.add(g); });
            return STATES.reading(STATES.genes(genes.size), 0, 0);
        }

        /** The color bar's settings: the quantity, its scaling, and Plot Options' Min, Max, Center and title (draw.js colourBars). */
        function colourSettings(color) {
            return { id: color.id, stat: color.stat, layer: color.layer, detectAbove: color.detectAbove, scaling: color.scaling,
                ...barSettings(_config) };
        }

        /** The rows as colourBars reads them: a one-row section with a quantity of its own apart, every other row together. */
        function barSections(rows) {
            const out = [];
            let genes = null;
            rows.forEach((row, r) => {
                if (row.own && row.own.color) {
                    out.push({ title: row.section.title, rows: [r], own: row.own.color });
                } else {
                    if (!genes) { genes = { title: '', rows: [] }; out.push(genes); }
                    genes.rows.push(r);
                }
            });
            return out;
        }

        function reorder(arr, rows, groups, G) {
            const out = new arr.constructor(arr.length);
            for (let k = 0; k < rows.length; k++) {
                const from = rows[k] * G;
                for (let j = 0; j < G; j++) out[k * G + j] = arr[from + groups[j]];
            }
            return out;
        }

        // ---------------------------------------------------------------- events from the page

        function onDataUpdate(updateType) {
            if (!_initialized) return undefined;
            if (updateType === 'datasetChanged') {
                _dom.noData.style.display = 'none';
                syncControlsWithDataset(_dom.controls, true);
                resetStructure();
                _resolved.clear();
                _kindsOf = null;
                groupSources().sources.contextChanged();
                return datasetReady();
            }
            if (updateType === 'subsetChanged' || updateType === 'partChanged') {
                groupSources().sources.contextChanged();
                paint();
            }
            return undefined;
        }

        /** Panels were added, closed, reopened or renamed: the sources, the menus and the titles may have changed. */
        function onPanelsChanged() {
            if (!_initialized) return;
            _resolved.clear();
            _plan = null;
            watchSources();
            sync();
            paint();
            _shown = null;
            redraw();
        }

        function _debugState() {
            const rec = record();
            const snap = rec ? rec.handle.read() : null;
            return JSON.parse(JSON.stringify({
                config: _config, state: _state, snap: snap ? snap.state : null, undo: _undo.size, ask: _gate.ask,
                groups: _shown ? _shown.groups : null, rows: _shown ? _shown.rows : null,
                features: _plan ? _plan.features.length : null
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
            setTitle(title) { _title = title; paint(); },
            getType: () => TYPE,
            getConfig,
            updateConfig,
            setConfig: updateConfig,
            /** The page's group sources read an obs cell axis through this (utils/group-host.js, 'axis:<id>'). */
            axisSource: () => (_config.cellAxis && _config.cellAxis.type === 'obs'
                ? { title: _config.cellAxis.key, kind: 'grouping', recipe: () => axisRecipe(_config.cellAxis), shape: GROUPING } : null),
            axisId,
            /** The cell axis's snapshot as this plot reads it, or null: another plot names this one as the job ahead. */
            axisSnapshot: () => { const rec = record(); return rec ? rec.handle.read() : null; },
            plotFacts,
            fewerGenes,
            redraw,
            snapshotChanged,
            undo,
            _debugState
        };
    }

    PanelManager.registerPanelType('cell-gene', CellGenePanel);
})();

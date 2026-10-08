/**
 * Cell Plots with millions of points.
 *
 * The regular path (plot-make.js) turns every series into plain JS arrays,
 * builds boolean masks, per-point name arrays and a permuted copy for the
 * colour sort, and hands Plotly per-point colours. Measured in Chromium on an
 * M3 Max that is 400-900 B of V8 heap per point; a tab's V8 heap is capped
 * near 4 GB whatever the flags (pointer compression), so it stops between
 * 5M (gene colour) and 20M (categorical) cells.
 *
 * This path keeps every per-point series in typed arrays (ArrayBuffers live
 * outside that heap) and gives Plotly only single-colour scattergl traces:
 *
 *   - categorical colour: one trace per category;
 *   - numeric colour: COLOR_BINS traces, one per colour step over
 *     [cmin, cmax], drawn in order of |value| (the regular path's colour
 *     sort), with a one-point trace carrying the colour bar;
 *   - every trace is cut into pieces of fewer than 100,000 points. At
 *     100,000 points and more scattergl builds a spatial index for hover
 *     (point-cluster, about 50 B of heap per point); below it, it does not.
 *
 * Plotly's own hover is off (hovermode false; there are no per-point names on
 * the traces). Hover, click and the focused-cell highlight come from a point
 * index over the drawn positions (utils/point-index.js, 8 B per point in typed
 * arrays; large-interact.js). What it gives up: 3D, table filters (a cell
 * table cannot list this many cells, so there is nothing to filter by), the
 * Hover picker's extra columns, and incremental updates (any change redraws). It is
 * used above largePlotPoints() (default 1M, so several regular plots fit side
 * by side). The panel says so (a status-strip tag), the controls it cannot
 * honour are disabled (large-plot-controls.js), and settings it cannot draw
 * are refused with a message (largePlotRefusal): far above the threshold the
 * regular path would close the tab.
 */
import { strongOnTopKey, plotlyColorscale } from '../../utils/color-scales.js';
import { DataManager } from '../../data-manager.js';
import { Config } from '../../config.js';
import { buildPlotLayout, withSubsetCoverage } from './plot-make.js';
import { getPositioningByLocation } from './plot-aesthetics-menu.js';
import { logColorbarTicks } from '../../utils/array-stats.js';
import { generateDiscreteColors, groupColours } from './colors.js';
import { LEGEND_PROXY, LEGEND_POINTS, COLOUR_BAR, attachViewportTracking } from './plot-make-helper.js';
import { drawPlot, drawPlaceholder, clearForDraw, fitToContainer, setStatusTag, resolveColorscale, Coverage, GAP } from '../../utils/panel-surface.js';
import { colourKind, DEFAULT_MODEL } from '../../utils/memory-guard.js';
import { probeForDraw, niceFloor, probeMessage } from '../../utils/alloc-probe.js';
import { releasePlot } from '../../utils/release-plot.js';
import { classifyFilterStats, compactCount, exactCount } from '../../utils/coverage.js';
import { LARGE_TYPES, formatPoints } from './large-plot-controls.js';
import { buildPointIndexSliced } from '../../utils/point-index.js';
import { attachLargeInteraction, highlightLargeFocus } from './large-interact.js';
import { updateColorControlsVisibility, updateColorSliderUI } from './panel-ui-update.js';
import { colourTitle } from '../../utils/plot-titles.js';
import { GROUP_COLOURS, LEGEND_NAMES, grouped, groupOf, groupLegendName, categoryCount } from '../../utils/categories.js';

/** Points above which a Cell Plot uses this mode (Config, server ui.defaults.large_plot_points). */
export function largePlotPoints() {
  const v = Config.DEFAULTS && Config.DEFAULTS.LARGE_PLOT_POINTS;
  return typeof v === 'number' && v >= 0 ? v : 1000000;
}
const TRACE_POINTS = 99999;      // < Plotly's TOO_MANY_POINTS (1e5)
const COLOR_BINS = 64;
const NA_COLOR = 'rgba(200, 200, 200, 1)';

const _an = (w) => (/^[aeiou]/i.test(w) ? 'an' : 'a');

/**
 * Null when large-plot mode can draw these settings, otherwise the sentence
 * the panel shows instead of a plot: what is not available at this size and
 * the two ways out. Only meaningful above largePlotPoints().
 * @param {Object} settings  cell plot settings
 * @param {number} n  points in the plot
 */
export function largePlotRefusal(settings, n) {
  const at = `is not available for ${formatPoints(n)} points: turn on a subset`;
  if (settings.z) return `3D ${at}, or turn 3D off`;
  if (settings.tableFilter && settings.tableFilter !== 'none') {
    return `A table filter ${at}, or set the table filter to None`;
  }
  for (const axis of ['x', 'y', 'color']) {
    const t = settings[axis] && settings[axis].type;
    if (LARGE_TYPES[axis].includes(t)) continue;
    return axis === 'color'
      ? `Colour by ${_an(t)} ${t} column ${at}, or choose an obs column or a gene`
      : `${axis === 'x' ? 'An x' : 'A y'} axis from ${t} ${at}, or choose an embedding (obsm), an obs column or a gene`;
  }
  return null;
}

/**
 * Null when this panel uses the large path, otherwise why not (below the
 * threshold, or settings the mode cannot draw).
 */
export function largePlotReason(settings, n) {
  if (!(n > largePlotPoints())) return `${n} cells (large path above ${largePlotPoints()})`;
  return largePlotRefusal(settings, n);
}

async function loadSeries(s, datasetPath, structure) {
  if (s.type === 'none') return null;
  if (s.type === 'obsm') {
    const v = await DataManager.loadVector(`${Config.API.OBSM}/${s.key}`,
      { dataset_path: datasetPath, column_name: String(s.column) });
    if (!v) throw new Error(`obsm.${s.key}.${s.column} is not numeric`);
    return { values: v };
  }
  if (s.type === 'layer') {
    const gi = DataManager.getGeneIndex(s.column);
    if (gi < 0) throw new Error(`gene ${s.column} is not in this dataset`);
    const v = await DataManager.loadVector(`${Config.API.LAYER}/${s.key}`,
      { dataset_path: datasetPath, cols: String(gi) });
    if (!v) throw new Error(`layer ${s.key} is not numeric`);
    return { values: v };
  }
  // obs: categorical columns as codes, anything else must be numeric
  const info = structure && structure.obs && structure.obs.columns_info
    && structure.obs.columns_info[s.key];
  if (info && info.type === 'categorical') {
    // past GROUP_COLOURS categories: codes ranked by the server and the
    // legend's few labels, never the column's label list
    return DataManager.loadCategoryCodes(datasetPath, s.key,
      { ranked: grouped(categoryCount(structure, 'obs', s.key) ?? 0) });
  }
  const v = await DataManager.loadVector(Config.API.OBS, { dataset_path: datasetPath, columns: s.key });
  if (!v) throw new Error(`obs.${s.key} is neither categorical nor numeric`);
  return { values: v };
}

function _parseColor(c) {
  if (typeof c !== 'string') return [0, 0, 0];
  if (c[0] === '#') {
    const h = c.length === 4 ? c.slice(1).split('').map(d => d + d).join('') : c.slice(1, 7);
    return [0, 2, 4].map(k => parseInt(h.slice(k, k + 2), 16));
  }
  const m = c.match(/[\d.]+/g);
  return m ? m.slice(0, 3).map(Number) : [0, 0, 0];
}

/** `n` colours along a Plotly colour scale (name or [[t, colour], ...]). */
async function sampleColorscale(scale, reverse, n) {
  let stops;
  try {
    stops = await resolveColorscale(scale);
    if (reverse) stops = stops.map(([t, c]) => [1 - t, c]).reverse();
  } catch {
    stops = null;
  }
  if (!Array.isArray(stops) || stops.length < 2) {
    stops = [[0, '#440154'], [0.25, '#3b528b'], [0.5, '#21918c'], [0.75, '#5ec962'], [1, '#fde725']];
  }
  const rgb = stops.map(([t, c]) => [t, _parseColor(c)]);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    let k = 1;
    while (k < rgb.length - 1 && rgb[k][0] < t) k++;
    const [t0, c0] = rgb[k - 1], [t1, c1] = rgb[k];
    const f = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
    const c = c0.map((v, j) => Math.round(v + f * (c1[j] - v)));
    out.push(`rgb(${c[0]},${c[1]},${c[2]})`);
  }
  return out;
}

/**
 * Group points by key with one counting sort: x/y permuted into contiguous
 * runs per key, as typed arrays, and the row of each (R). key[i] === drop leaves point i out. `pre` ({X, Y}) are buffers allocated
 * earlier (probeDraw) to be filled; they may be longer than `kept`.
 */
function groupByKey(x, y, key, nkeys, drop, pre = null) {
  const n = x.length;
  const start = new Float64Array(nkeys + 1);
  for (let i = 0; i < n; i++) { const k = key[i]; if (k !== drop) start[k + 1]++; }
  for (let k = 0; k < nkeys; k++) start[k + 1] += start[k];
  const kept = start[nkeys];
  const fill = start.slice(0, nkeys);
  // the probe's buffers (probeDraw), when big enough: filled, not copied
  const X = pre && pre.X && pre.X.length >= kept ? pre.X : new Float32Array(kept);
  const Y = pre && pre.Y && pre.Y.length >= kept ? pre.Y : new Float32Array(kept);
  const R = new Uint32Array(kept);           // the row of each point, for hover and click
  for (let i = 0; i < n; i++) {
    const k = key[i];
    if (k === drop) continue;
    const p = fill[k]++;
    X[p] = x[i];
    Y[p] = y[i];
    R[p] = i;
  }
  return { X, Y, R, start, kept };
}

/** Single-colour scattergl traces for points [a, b), cut below TRACE_POINTS. */
function pushTraces(traces, X, Y, a, b, name, color, settings) {
  traces.push(...chunkTraces(X, Y, a, b, name, color, settings));
}

/** Single-colour traces for points [a, b), cut below TRACE_POINTS, without legend entries. */
function chunkTraces(X, Y, a, b, name, color, settings) {
  const out = [];
  for (let p = a; p < b; p += TRACE_POINTS) {
    const q = Math.min(p + TRACE_POINTS, b);
    out.push({
      type: 'scattergl', mode: 'markers', name, legendgroup: name, showlegend: false, meta: LEGEND_POINTS,
      x: X.subarray(p, q), y: Y.subarray(p, q),
      hoverinfo: 'skip',
      marker: { size: settings.pointSize, opacity: settings.pointOpacity, color }
    });
  }
  return out;
}

/**
 * The legend entry of one category: a trace with no points, at full opacity,
 * in the category's legend group (clicking it toggles all its chunks). The
 * point traces carry the panel's opacity; Plotly would draw their legend
 * symbols just as pale.
 */
function legendTrace(name, color, settings, rank) {
  return { type: 'scattergl', mode: 'markers', name, legendgroup: name, showlegend: true, meta: LEGEND_PROXY,
    legendrank: rank, x: [null], y: [null], hoverinfo: 'skip',
    marker: { size: settings.pointSize, opacity: 1, color } };
}

/**
 * Chunk traces of several categories in an interleaved draw order. Drawing
 * each category whole, in list order, puts the last-drawn categories on top
 * of every other one where they overlap (at 50M Tahoe cells one cell line
 * covered the plot). Here every chunk is placed at its relative position
 * within its own category ((j + 0.5) / chunks), so all categories are spread
 * through the whole draw and none is drawn entirely on top.
 */
function interleave(groups) {
  const all = [];
  for (const g of groups) g.forEach((t, j) => all.push([(j + 0.5) / g.length, all.length, t]));
  all.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  return all.map(e => e[2]);
}

function titleFont(settings) {
  return { size: settings.fontSize ? settings.fontSize + 2 : 14,
    family: settings.fontFamily || 'Arial, Helvetica, sans-serif', color: settings.textColor || '#000000' };
}

/** The colour bar as the regular path draws it (plot-make.js, numerical branch). */
function colourBar(settings, title) {
  const pos = getPositioningByLocation(settings.legendPosition || 'right');
  return { title: { text: title, side: 'right', font: titleFont(settings) },
    x: pos.x, xanchor: pos.xanchor, y: pos.y, yanchor: pos.yanchor,
    titleside: pos.titleside, orientation: pos.orientation };
}

/**
 * The status-strip tag a panel carries while in this mode, from its first
 * draw: the limit is visible before anyone clicks. Its popover says why and
 * offers the subset that lifts it.
 * @param {number} n - points drawn
 */
export function largePlotTag(n) {
  const limit = largePlotPoints();
  return {
    text: 'Large plot',
    title: `Large-plot mode (${formatPoints(n)} points): hover, click and the focus highlight work; `
      + 'table filters, 3D and the Hover picker are off; use a subset for them',
    pop: {
      text: `Over ${exactCount(limit)} points (${compactCount(n)} here): drawn in a lighter mode to stay within `
        + 'browser memory. Hover and click work; table filters, 3D and extra hover columns do not.',
      actions: [['subset-regular', `Subset to \u2264${compactCount(limit)} for table filters`]]
    }
  };
}

/** The probe's group-key buffer when it is the right size, else a new one. */
function keyBuffer(pre, n) {
  return pre && pre.key && pre.key.length === n ? pre.key : new Uint16Array(n);
}

/**
 * The allocation probe of a draw (utils/alloc-probe.js): allocate what the
 * plot will need, now, before positions and colours are requested. Returns
 * the buffers the draw fills ({key, X, Y, logged?}). When the browser
 * refuses, throws an AllocationProbeError whose message offers a subset;
 * plot-make.js shows it (showProbeFailure) and no data request has gone out.
 * @param {Object} settings
 * @param {Object} structure
 */
function probeDraw(settings, structure) {
  const n = (DataManager.getCells() || []).length;
  return probeForDraw({ n, log: !!(settings.color && settings.color.log) && colourKind(settings, structure) === 'numeric',
    offPerPoint: DEFAULT_MODEL.large.off,
    eligible: n + (Number(DataManager.getCellsNotInSubset()) || 0) });
}

/**
 * Show that a plot could not be held: on a plot already drawn, a warning
 * tag in its strip (the plot stays); otherwise a placeholder with the
 * message and the way out (a subset).
 * @param {HTMLElement} plotContainer
 * @param {{message: string, n?: number}} error
 * @param {string} [source] - what ran out: 'browser memory' or 'WebGL'
 */
export function showProbeFailure(plotContainer, error, source = 'browser memory') {
  const live = Array.isArray(plotContainer.data) && plotContainer.data.length && plotContainer._fullLayout;
  const actions = [['subset', 'Subset…']];
  if (live) {
    setStatusTag(plotContainer, 'memory', { text: 'Not drawn: browser memory', severity: 'warning',
      title: error.message, pop: { text: error.message, actions } });
    return;
  }
  setStatusTag(plotContainer, 'memory', null);
  drawPlaceholder(plotContainer, Coverage.missing(GAP.UNAVAILABLE, error.message,
    { source, unit: 'cells', total: error.n ?? null }), 'cells', { actions });
}

/**
 * A lost WebGL context (the GPU ran out of memory, or the driver reset) ends
 * the plot: release it, say so in the words of a failed probe, offer a
 * subset and Redraw. The context is told it may come back (preventDefault);
 * when it does, the message says Redraw will work.
 */
function watchGpu(plotContainer, n) {
  if (plotContainer.__gpuWatch) { plotContainer.__gpuWatch.n = n; return; }
  const state = { n };
  plotContainer.__gpuWatch = state;
  // capture: the event does not bubble from the canvas
  plotContainer.addEventListener('webglcontextlost', (e) => {
    // a plot of ours that is up; releasePlot loses its contexts on purpose, after the plot is gone
    if (!plotContainer.__isLarge || !plotContainer._fullLayout || !e.target || !plotContainer.contains(e.target)) return;
    e.preventDefault();
    const canvas = e.target;
    const eligible = state.n + (Number(DataManager.getCellsNotInSubset()) || 0);
    const message = probeMessage(state.n, niceFloor(state.n / 2), eligible);
    plotContainer.__isLarge = false;
    drawPlaceholder(plotContainer, Coverage.missing(GAP.UNAVAILABLE, message,
      { source: 'WebGL', unit: 'cells', total: state.n }), 'cells',
      { actions: [['subset', 'Subset…'], ['redraw', 'Redraw']] });
    canvas.addEventListener('webglcontextrestored', () => {
      const box = plotContainer.querySelector('.coverage-placeholder');
      if (!box || box.querySelector('.coverage-placeholder__restored')) return;
      const note = document.createElement('div');
      note.className = 'coverage-placeholder__restored';
      note.textContent = 'The graphics context is back; Redraw can draw the plot again.';
      box.appendChild(note);
    }, { once: true });
  }, true);
}

// The draw in flight per panel. A panel's first load is usually asked for
// twice (the table-filter update finds no plot yet and refreshes); at these
// sizes a second concurrent load doubles the memory and the server's work.
const _inflight = new WeakMap();

/**
 * Load the series and draw the panel. Fills `data` with what the panel's
 * other code reads (`large`, `entities`, `generation`, `coverage`). A call
 * with the same settings while a draw is in flight joins that draw.
 */
export function createLargePlot(plotContainer, settings, data, container = null, id = null) {
  const sig = JSON.stringify([DataManager.getDatasetGeneration(), settings.x, settings.y, settings.color,
    settings.pointSize, settings.pointOpacity, settings.hideNaN, settings.hideOutliers, settings.colorMin,
    settings.colorMax, settings.colorScale, settings.colorReversed, settings.categoryPalette]);
  const current = _inflight.get(plotContainer);
  if (current && current.sig === sig) return current.promise;
  const promise = _drawLargePlot(plotContainer, settings, data, container, id).finally(() => {
    if (_inflight.get(plotContainer) && _inflight.get(plotContainer).promise === promise) {
      _inflight.delete(plotContainer);
    }
  });
  _inflight.set(plotContainer, { sig, promise });
  return promise;
}

async function _drawLargePlot(plotContainer, settings, data, container, id) {
  const t0 = performance.now();
  const datasetPath = DataManager.getCurrentDataset();
  const structure = await DataManager.getDatasetStructure();
  const generation = DataManager.getDatasetGeneration();
  Object.keys(data).forEach(k => delete data[k]);
  data.generation = null;
  data.entities = 'cells';
  // Before any request: the buffers this plot will need, allocated now. If the
  // browser cannot give them, nothing is requested (utils/alloc-probe.js).
  const pre = probeDraw(settings, structure);
  const [xs, ys, cs] = await Promise.all([
    loadSeries(settings.x, datasetPath, structure),
    loadSeries(settings.y, datasetPath, structure),
    loadSeries(settings.color, datasetPath, structure)
  ]);
  if (DataManager.getDatasetGeneration() !== generation) {
    throw new DOMException('Plot data is from a previous dataset', 'AbortError');
  }
  // the previous draw's index goes before the new one is built: never both; a build
  // still running for it is stopped
  if (plotContainer.__indexBuild) plotContainer.__indexBuild.cancelled = true;
  if (plotContainer.__largeState) plotContainer.__largeState.index = null;
  const t1 = performance.now();
  const x = xs.values, y = ys.values, n = x.length;
  const traces = [];
  let pts;                       // the drawn points {X, Y, R}: what the point index is built over
  // the regular path's layout, so both modes look the same
  const layout = buildPlotLayout(settings, null);
  layout.hovermode = false;
  let filtered;
  // why each dropped point is not drawn, the first reason that applies
  const only = { coords: 0, table: 0, nan: 0, outliers: 0 };

  if (cs && cs.codes) {
    // categorical: key = category, missing values last-but-drawn-first.
    // Ranked codes (more than GROUP_COLOURS categories): each cell's
    // category's rank over the whole column; key = colour group, rank mod
    // 64, one legend entry per group (utils/categories.js).
    const many = !!cs.ranked;
    const ncAll = many ? cs.used : cs.categories.length;
    const nc = many ? Math.min(ncAll, GROUP_COLOURS) : ncAll;
    const key = keyBuffer(pre, n);
    const NA = nc, DROP = nc + 1;
    for (let i = 0; i < n; i++) {
      const c = cs.codes[i];
      if (x[i] !== x[i] || y[i] !== y[i]) { key[i] = DROP; only.coords++; }
      else if (c === cs.MISSING) {
        key[i] = settings.hideNaN ? DROP : NA;
        if (settings.hideNaN) only.nan++;
      } else key[i] = many ? groupOf(c) : c;
    }
    const { X, Y, R, start, kept } = groupByKey(x, y, key, nc + 1, DROP, pre);
    pts = { X, Y, R };
    filtered = n - kept;
    // Colour groups: per group, the distinct ranks drawn (a bit set over the
    // ranks) and the three lowest, whose labels the legend names
    let groupNames = null;
    if (many) {
      const seen = new Uint8Array(Math.ceil(ncAll / 8) || 1);
      const distinct = new Float64Array(GROUP_COLOURS);
      const lowest = Array.from({ length: GROUP_COLOURS }, () => []);
      for (let i = 0; i < n; i++) {
        if (key[i] >= nc) continue;                 // NA or dropped
        const r = cs.codes[i];
        if (seen[r >> 3] & (1 << (r & 7))) continue;
        seen[r >> 3] |= 1 << (r & 7);
        const g = groupOf(r);
        distinct[g]++;
        const low = lowest[g];
        if (low.length < LEGEND_NAMES || r < low[low.length - 1]) {
          low.push(r);
          low.sort((a, b) => a - b);
          if (low.length > LEGEND_NAMES) low.pop();
        }
      }
      let labels = new Map();
      try {
        labels = await DataManager.loadCategoryLabels(datasetPath, settings.color.key, lowest.flat(),
          settings.color.type === 'var' ? 'var' : 'obs');
      } catch (err) {
        console.warn('Legend labels not loaded:', err && err.message);
      }
      groupNames = lowest.map((low, g) => {
        const names = low.map(r => labels.get(r) ?? `#${r}`);
        while (names.length < distinct[g]) names.push(null);   // counted for "+N more", never shown
        return groupLegendName(names);
      });
    }
    // The regular path's palette rule (processCategories): the colours stored
    // in uns.<key>_colors when the palette is 'uns' and they exist
    let palette = null;
    if (!many && settings.categoryPalette === 'uns' && settings.color.type === 'obs') {
      try {
        const r = await DataManager.loadUns({ datasetPath, unsKey: `${settings.color.key}_colors` });
        if (r && r.data) palette = Array.isArray(r.data) ? r.data : [r.data];
      } catch {
        palette = null;
      }
    }
    if (!palette || !palette.length) {
      // colour groups use the same 64-colour palette in every path
      const name = settings.categoryPalette && settings.categoryPalette !== 'uns' ? settings.categoryPalette : undefined;
      palette = many ? groupColours(GROUP_COLOURS, name) : generateDiscreteColors(nc, name);
    }
    // blank values at the bottom, then the categories interleaved; legend
    // entries in category order with NA last, as the regular path lists them
    traces.push(...chunkTraces(X, Y, start[NA], start[NA + 1], 'NA', NA_COLOR, settings));
    const groups = [];
    for (let k = 0; k < nc; k++) {
      const name = many ? groupNames[k] : String(cs.categories[k]);
      const color = palette[k % palette.length];
      if (start[k + 1] > start[k]) {
        groups.push(chunkTraces(X, Y, start[k], start[k + 1], name, color, settings));
        traces.push(legendTrace(name, color, settings, k + 1));
      }
    }
    if (start[NA + 1] > start[NA]) traces.push(legendTrace('NA', NA_COLOR, settings, 1001));
    traces.push(...interleave(groups));
    layout.showlegend = true;
    // legend as the regular path draws it (plot-make.js, categorical branch)
    const pos = getPositioningByLocation(settings.legendPosition || 'right');
    layout.legend = { ...(layout.legend || {}), title: { text: colourTitle(settings.color), font: titleFont(settings) },
      orientation: pos.legendOrientation, x: pos.legendX, y: pos.legendY,
      xanchor: pos.legendXanchor, yanchor: pos.legendYanchor };
  } else if (cs && cs.values) {
    // numeric: COLOR_BINS steps over [cmin, cmax]
    let v = cs.values;
    if (settings.color.log) {
      let floor = settings.color.logFloor;
      if (!(floor > 0)) { floor = Infinity; for (let i = 0; i < n; i++) if (v[i] > 0 && v[i] < floor) floor = v[i]; }
      const lv = pre && pre.logged && pre.logged.length === n ? pre.logged : new Float32Array(n), lf = Math.log10(floor);
      for (let i = 0; i < n; i++) lv[i] = v[i] !== v[i] ? NaN : (v[i] > floor ? Math.log10(v[i]) : lf);
      v = lv;
    }
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { const c = v[i]; if (c < lo) lo = c; if (c > hi) hi = c; }
    // Every change redraws here, a colour slider's too, so the range follows
    // the data (unless locked) only when the coloured values changed; on any
    // other redraw it is the range the user set. It used to be reset on every
    // redraw, after cmin/cmax were read: a dragged bound was drawn once, then
    // the boxes and settings went back to the data range.
    const source = JSON.stringify([generation, settings.color]);
    const keepRange = plotContainer._largeColorSource === undefined || plotContainer._largeColorSource === source;
    plotContainer._largeColorSource = source;
    // the colour range sliders move over percentiles of a sample of v
    if (container && id !== null) updateColorSliderUI(container, { color: v }, settings, id, keepRange);
    const cmin = settings.colorMin ?? lo, cmax = settings.colorMax ?? hi;
    const width = (cmax - cmin) / COLOR_BINS || 1;
    // draw order: the colour bar's top end last (|value| on a centred or
    // diverging map, else position on the bar: utils/color-scales.js strongOnTopKey)
    const strong = strongOnTopKey({ scale: settings.colorScale, centred: !!settings.centeringActive,
      min: cmin, max: cmax });
    const order = [...Array(COLOR_BINS).keys()]
      .sort((a, b) => strong(cmin + (a + 0.5) * width) - strong(cmin + (b + 0.5) * width) || a - b);
    const rank = new Uint16Array(COLOR_BINS);
    order.forEach((bin, r) => { rank[bin] = r + 1; });       // 0 = no value
    const DROP = COLOR_BINS + 1;
    const key = keyBuffer(pre, n);
    for (let i = 0; i < n; i++) {
      const c = v[i];
      if (x[i] !== x[i] || y[i] !== y[i]) { key[i] = DROP; only.coords++; continue; }
      if (c !== c) { key[i] = settings.hideNaN ? DROP : 0; if (settings.hideNaN) only.nan++; continue; }
      if (settings.hideOutliers && (c < cmin || c > cmax)) { key[i] = DROP; only.outliers++; continue; }
      const bin = Math.min(COLOR_BINS - 1, Math.max(0, Math.floor((c - cmin) / width)));
      key[i] = rank[bin];
    }
    const { X, Y, R, start, kept } = groupByKey(x, y, key, COLOR_BINS + 1, DROP, pre);
    pts = { X, Y, R };
    filtered = n - kept;
    const colors = await sampleColorscale(settings.colorScale, settings.colorReversed, COLOR_BINS);
    pushTraces(traces, X, Y, start[0], start[1], 'no value', NA_COLOR, settings);
    order.forEach((bin, r) => {
      pushTraces(traces, X, Y, start[r + 1], start[r + 2], `bin ${bin}`, colors[bin], settings);
    });
    // the colour bar: one invisible point carrying the scale
    const bar = colourBar(settings, colourTitle(settings.color));
    if (settings.color.log) {
      // labelled in original units over the drawn range, as applyLogColorbar does
      const ticks = logColorbarTicks(cmin, cmax);
      if (ticks) Object.assign(bar, { tickvals: ticks.tickvals, ticktext: ticks.ticktext });
    }
    traces.push({
      type: 'scattergl', mode: 'markers', x: [X[0]], y: [Y[0]], hoverinfo: 'skip', showlegend: false, meta: COLOUR_BAR,
      marker: { size: 0.1, opacity: 0, color: [cmin], cmin, cmax, colorscale: plotlyColorscale(settings.colorScale),
        reversescale: !!settings.colorReversed, showscale: true, colorbar: bar }
    });
    layout.showlegend = false;
  } else {
    const key = keyBuffer(pre, n);
    for (let i = 0; i < n; i++) key[i] = (x[i] !== x[i] || y[i] !== y[i]) ? 1 : 0;
    const { X, Y, R, start, kept } = groupByKey(x, y, key, 1, 1, pre);
    pts = { X, Y, R };
    filtered = n - kept;
    only.coords = filtered;
    pushTraces(traces, X, Y, start[0], start[1], 'cells', settings.pointColor || '#1f77b4', settings);
    layout.showlegend = false;
  }
  const t2 = performance.now();

  // every series here is whole or threw, so the gaps are the points dropped
  const coverage = withSubsetCoverage(classifyFilterStats({
    total: n, filtered, exclusive: only, xNaN: only.coords, yNaN: only.coords, zNaN: 0,
    hideNaNActive: !!settings.hideNaN, hideOutliersActive: !!settings.hideOutliers, tableFilterActive: false
  }, 'cells'));
  // Drawn from nothing, not into the graph shown: a Plotly.react into the
  // drawn large plot kept the old plot's calc and scene beside the new one
  // for good (1.93 -> 3.46 GB of JS heap at 95.6M points after a recolour,
  // a crashed tab at 150M). The view is kept in the settings, not the graph.
  if (plotContainer._fullLayout) releasePlot(plotContainer);
  clearForDraw(plotContainer);
  await drawPlot(plotContainer, traces, layout,
    { responsive: true, displayModeBar: true, displaylogo: false,
      modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d'] },
    coverage, 'cells');
  setStatusTag(plotContainer, 'large', largePlotTag(n));
  plotContainer.__isLarge = true;
  watchGpu(plotContainer, n);
  fitToContainer(plotContainer);
  // Plotly has no click handler here, but a zoom is kept like in the regular plot
  attachViewportTracking(plotContainer, settings);
  // the server's cell-name index, for a later focus by name (remote-names.js)
  DataManager.prewarmCellNames();
  if (container && id !== null) {
    updateColorControlsVisibility(container, cs && cs.codes ? 'categorical' : cs ? 'numerical' : 'constant', id);
  }
  const t3 = performance.now();
  // hover, click and the focus highlight: the index over the drawn points, built after the
  // plot is visible and in slices of the main thread, so input stays responsive; until it is
  // ready hover shows nothing and a click does nothing
  // (the probe's buffers may be longer than the points kept)
  const kept = n - filtered;
  const job = { cancelled: false };
  plotContainer.__indexBuild = job;
  const st = attachLargeInteraction(plotContainer, settings, null);
  const large = { n, traces: traces.length, filtered,
    load_ms: t1 - t0, build_ms: t2 - t1, draw_ms: t3 - t2, index_ms: null };
  data.large = large;
  buildPointIndexSliced(pts.X.subarray(0, kept), pts.Y.subarray(0, kept), pts.R, job).then((index) => {
    if (!index || job.cancelled || plotContainer.__largeState !== st) return;
    st.index = index;
    large.index_ms = performance.now() - t3;
    large.index_bytes = index.bytes;
    console.info(`Point index ready ${large.index_ms.toFixed(0)} ms after the draw (hover and click)`);
    highlightLargeFocus(plotContainer, settings);
  }).catch((err) => console.warn('Point index not built:', err && err.message));
  data.coverage = coverage;
  data.generation = generation;
  console.info(`Large cell plot: ${n} points in ${traces.length} traces; `
    + `load ${(t1 - t0).toFixed(0)} ms, build ${(t2 - t1).toFixed(0)} ms, draw ${(t3 - t2).toFixed(0)} ms`);
}

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
 * What it gives up: hover and click on points (hovermode false; there are no
 * per-point names on the traces), the focused-cell highlight, table filters,
 * 3D, and incremental updates (any change redraws). It is used above
 * largePlotPoints() (default 1M, so several regular plots fit side by side). The panel says so (a status-strip tag), the
 * controls it cannot honour are disabled (large-plot-controls.js), and
 * settings it cannot draw are refused with a message (largePlotRefusal):
 * far above the threshold the regular path would close the tab.
 */
import { DataManager } from '../../data-manager.js';
import { Config } from '../../config.js';
import { buildPlotLayout, withSubsetCoverage } from './plot-make.js';
import { getPositioningByLocation } from './plot-aesthetics-menu.js';
import { logColorbarTicks } from '../../utils/array-stats.js';
import { generateDiscreteColors } from './colors.js';
import { LEGEND_PROXY, LEGEND_POINTS, attachViewportTracking } from './plot-make-helper.js';
import { drawPlot, clearForDraw, fitToContainer, setStatusTag, nudgeStatusTag, resolveColorscale } from '../../utils/panel-surface.js';
import { releasePlot } from '../../utils/release-plot.js';
import { classifyFilterStats, compactCount, exactCount } from '../../utils/coverage.js';
import { LARGE_TYPES, formatPoints } from './large-plot-controls.js';
import { updateColorControlsVisibility, updateColorSliderUI } from './panel-ui-update.js';

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
    return DataManager.loadCategoryCodes(datasetPath, s.key);
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
 * runs per key, as typed arrays. key[i] === drop leaves point i out.
 */
function groupByKey(x, y, key, nkeys, drop) {
  const n = x.length;
  const start = new Float64Array(nkeys + 1);
  for (let i = 0; i < n; i++) { const k = key[i]; if (k !== drop) start[k + 1]++; }
  for (let k = 0; k < nkeys; k++) start[k + 1] += start[k];
  const kept = start[nkeys];
  const fill = start.slice(0, nkeys);
  const X = new Float32Array(kept), Y = new Float32Array(kept);
  for (let i = 0; i < n; i++) {
    const k = key[i];
    if (k === drop) continue;
    const p = fill[k]++;
    X[p] = x[i];
    Y[p] = y[i];
  }
  return { X, Y, start, kept };
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

/** The colour's axis title, as the regular path writes it. */
function colourTitle(settings) {
  return `${settings.color.type}.${settings.color.key}` + (settings.color.column ? `.${settings.color.column}` : '');
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
    text: 'Large plot: no hover/click',
    title: `Large-plot mode (${formatPoints(n)} points): hover, click and table filters are off; use a subset for them`,
    pop: {
      text: `Over ${exactCount(limit)} points (${compactCount(n)} here): drawn without hover, click or `
        + 'table filters to stay within browser memory.',
      actions: [['subset-regular', `Subset to \u2264${compactCount(limit)} to enable click`]]
    }
  };
}

/**
 * A click on the plot area of a large plot, which has no click: pulse the
 * strip's tag, and the first time per panel open its popover. A drag (zoom,
 * pan) is not a click, and neither is one on the modebar or legend.
 * @param {HTMLElement} plotContainer
 */
function watchLargeClicks(plotContainer) {
  if (plotContainer.__largeClicks) return;
  plotContainer.__largeClicks = true;
  // pointer events, not click: Plotly's drag layer takes the mouse between
  // press and release, so no click reaches the graph
  let down = null;
  plotContainer.addEventListener('pointerdown', (e) => {
    down = plotContainer.__isLarge && e.target.closest && e.target.closest('.draglayer, .nsewdrag')
      ? { x: e.clientX, y: e.clientY } : null;
  }, true);
  document.addEventListener('pointerup', (e) => {
    if (!down || !plotContainer.isConnected) { down = null; return; }
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved <= 4) nudgeStatusTag(plotContainer, 'large');
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
  const [xs, ys, cs] = await Promise.all([
    loadSeries(settings.x, datasetPath, structure),
    loadSeries(settings.y, datasetPath, structure),
    loadSeries(settings.color, datasetPath, structure)
  ]);
  if (DataManager.getDatasetGeneration() !== generation) {
    throw new DOMException('Plot data is from a previous dataset', 'AbortError');
  }
  const t1 = performance.now();
  const x = xs.values, y = ys.values, n = x.length;
  const traces = [];
  // the regular path's layout, so both modes look the same
  const layout = buildPlotLayout(settings, null);
  layout.hovermode = false;
  let filtered;
  // why each dropped point is not drawn, the first reason that applies
  const only = { coords: 0, table: 0, nan: 0, outliers: 0 };

  if (cs && cs.codes) {
    // categorical: key = category, missing values last-but-drawn-first
    const nc = cs.categories.length;
    const key = new Uint16Array(n);
    const NA = nc, DROP = nc + 1;
    for (let i = 0; i < n; i++) {
      const c = cs.codes[i];
      if (x[i] !== x[i] || y[i] !== y[i]) { key[i] = DROP; only.coords++; }
      else if (c === cs.MISSING) {
        key[i] = settings.hideNaN ? DROP : NA;
        if (settings.hideNaN) only.nan++;
      } else key[i] = c;
    }
    const { X, Y, start, kept } = groupByKey(x, y, key, nc + 1, DROP);
    filtered = n - kept;
    // The regular path's palette rule (processCategories): the colours stored
    // in uns.<key>_colors when the palette is 'uns' and they exist
    let palette = null;
    if (settings.categoryPalette === 'uns' && settings.color.type === 'obs') {
      try {
        const r = await DataManager.loadUns({ datasetPath, unsKey: `${settings.color.key}_colors` });
        if (r && r.data) palette = Array.isArray(r.data) ? r.data : [r.data];
      } catch {
        palette = null;
      }
    }
    if (!palette || !palette.length) {
      palette = generateDiscreteColors(nc, settings.categoryPalette && settings.categoryPalette !== 'uns'
        ? settings.categoryPalette : undefined);
    }
    // blank values at the bottom, then the categories interleaved; legend
    // entries in category order with NA last, as the regular path lists them
    traces.push(...chunkTraces(X, Y, start[NA], start[NA + 1], 'NA', NA_COLOR, settings));
    const groups = [];
    for (let k = 0; k < nc; k++) {
      const name = String(cs.categories[k]), color = palette[k % palette.length];
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
    layout.legend = { ...(layout.legend || {}), title: { text: colourTitle(settings), font: titleFont(settings) },
      orientation: pos.legendOrientation, x: pos.legendX, y: pos.legendY,
      xanchor: pos.legendXanchor, yanchor: pos.legendYanchor };
  } else if (cs && cs.values) {
    // numeric: COLOR_BINS steps over [cmin, cmax]
    let v = cs.values;
    if (settings.color.log) {
      let floor = settings.color.logFloor;
      if (!(floor > 0)) { floor = Infinity; for (let i = 0; i < n; i++) if (v[i] > 0 && v[i] < floor) floor = v[i]; }
      const lv = new Float32Array(n), lf = Math.log10(floor);
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
    // draw order: |bin centre| ascending, so the strongest values are on top
    const order = [...Array(COLOR_BINS).keys()]
      .sort((a, b) => Math.abs(cmin + (a + 0.5) * width) - Math.abs(cmin + (b + 0.5) * width) || a - b);
    const rank = new Uint16Array(COLOR_BINS);
    order.forEach((bin, r) => { rank[bin] = r + 1; });       // 0 = no value
    const DROP = COLOR_BINS + 1;
    const key = new Uint16Array(n);
    for (let i = 0; i < n; i++) {
      const c = v[i];
      if (x[i] !== x[i] || y[i] !== y[i]) { key[i] = DROP; only.coords++; continue; }
      if (c !== c) { key[i] = settings.hideNaN ? DROP : 0; if (settings.hideNaN) only.nan++; continue; }
      if (settings.hideOutliers && (c < cmin || c > cmax)) { key[i] = DROP; only.outliers++; continue; }
      const bin = Math.min(COLOR_BINS - 1, Math.max(0, Math.floor((c - cmin) / width)));
      key[i] = rank[bin];
    }
    const { X, Y, start, kept } = groupByKey(x, y, key, COLOR_BINS + 1, DROP);
    filtered = n - kept;
    const colors = await sampleColorscale(settings.colorScale, settings.colorReversed, COLOR_BINS);
    pushTraces(traces, X, Y, start[0], start[1], 'no value', NA_COLOR, settings);
    order.forEach((bin, r) => {
      pushTraces(traces, X, Y, start[r + 1], start[r + 2], `bin ${bin}`, colors[bin], settings);
    });
    // the colour bar: one invisible point carrying the scale
    const bar = colourBar(settings, colourTitle(settings));
    if (settings.color.log) {
      // whole decades labelled in original units, as applyLogColorbar does
      const ticks = logColorbarTicks(lo, hi);
      if (ticks) Object.assign(bar, { tickvals: ticks.tickvals, ticktext: ticks.ticktext });
    }
    traces.push({
      type: 'scattergl', mode: 'markers', x: [X[0]], y: [Y[0]], hoverinfo: 'skip', showlegend: false,
      marker: { size: 0.1, opacity: 0, color: [cmin], cmin, cmax, colorscale: settings.colorScale,
        reversescale: !!settings.colorReversed, showscale: true, colorbar: bar }
    });
    layout.showlegend = false;
  } else {
    const key = new Uint8Array(n);
    for (let i = 0; i < n; i++) key[i] = (x[i] !== x[i] || y[i] !== y[i]) ? 1 : 0;
    const { X, Y, start, kept } = groupByKey(x, y, key, 1, 1);
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
  watchLargeClicks(plotContainer);
  fitToContainer(plotContainer);
  // no click handler here, but a zoom is kept like in the regular plot
  attachViewportTracking(plotContainer, settings);
  // the server's cell-name index, for a later focus by name (remote-names.js)
  DataManager.prewarmCellNames();
  if (container && id !== null) {
    updateColorControlsVisibility(container, cs && cs.codes ? 'categorical' : cs ? 'numerical' : 'constant', id);
  }
  const t3 = performance.now();
  data.large = { n, traces: traces.length, filtered,
    load_ms: t1 - t0, build_ms: t2 - t1, draw_ms: t3 - t2 };
  data.coverage = coverage;
  data.generation = generation;
  console.info(`Large cell plot: ${n} points in ${traces.length} traces; `
    + `load ${(t1 - t0).toFixed(0)} ms, build ${(t2 - t1).toFixed(0)} ms, draw ${(t3 - t2).toFixed(0)} ms`);
}

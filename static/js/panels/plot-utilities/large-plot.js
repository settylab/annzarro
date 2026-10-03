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
 * 3D, and incremental updates (any change redraws). It is used only above
 * LARGE_PLOT_POINTS and only for the settings it supports (largePlotReason).
 */
import { DataManager } from '../../data-manager.js';
import { Config } from '../../config.js';
import { createLayout } from './plot-make-helper.js';
import { generateDiscreteColors } from './colors.js';
import { drawPlot } from '../../utils/panel-surface.js';
import { Coverage, GAP } from '../../utils/coverage.js';

export const LARGE_PLOT_POINTS = 1000000;
const TRACE_POINTS = 99999;      // < Plotly's TOO_MANY_POINTS (1e5)
const COLOR_BINS = 64;
const NA_COLOR = 'rgba(200, 200, 200, 1)';

/**
 * Null when this panel can use the large path, otherwise why not.
 * @param {Object} settings  cell plot settings
 * @param {number} n  cells in the plot
 */
export function largePlotReason(settings, n) {
  if (!(n > LARGE_PLOT_POINTS)) return `${n} cells (large path above ${LARGE_PLOT_POINTS})`;
  if (settings.z) return '3D';
  if (settings.tableFilter && settings.tableFilter !== 'none') return 'table filter';
  for (const axis of ['x', 'y', 'color']) {
    const t = settings[axis] && settings[axis].type;
    if (!['obsm', 'obs', 'layer', 'none'].includes(t) || (t === 'none' && axis !== 'color')) {
      return `${axis} from ${t}`;
    }
  }
  return null;
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
    // Plotly resolves a scale name ('Portland', ...) to its stops while it
    // draws; a one-point plot off screen does that without private API.
    const div = document.createElement('div');
    div.style.cssText = 'position:absolute;left:-9999px;width:40px;height:40px';
    document.body.appendChild(div);
    await Plotly.newPlot(div, [{ type: 'scatter', x: [0], y: [0], marker: { color: [0], colorscale: scale } }],
      { width: 40, height: 40 }, { staticPlot: true });
    stops = div._fullData[0].marker.colorscale;
    Plotly.purge(div);
    div.remove();
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
function pushTraces(traces, X, Y, a, b, name, color, settings, showlegend) {
  for (let p = a; p < b; p += TRACE_POINTS) {
    const q = Math.min(p + TRACE_POINTS, b);
    traces.push({
      type: 'scattergl', mode: 'markers', name, legendgroup: name,
      showlegend: showlegend && p === a,
      x: X.subarray(p, q), y: Y.subarray(p, q),
      hoverinfo: 'skip',
      marker: { size: settings.pointSize, opacity: settings.pointOpacity, color }
    });
  }
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
export function createLargePlot(plotContainer, settings, data) {
  const sig = JSON.stringify([DataManager.getDatasetGeneration(), settings.x, settings.y, settings.color,
    settings.pointSize, settings.pointOpacity, settings.hideNaN, settings.hideOutliers, settings.colorMin,
    settings.colorMax, settings.colorScale, settings.colorReversed, settings.categoryPalette]);
  const current = _inflight.get(plotContainer);
  if (current && current.sig === sig) return current.promise;
  const promise = _drawLargePlot(plotContainer, settings, data).finally(() => {
    if (_inflight.get(plotContainer) && _inflight.get(plotContainer).promise === promise) {
      _inflight.delete(plotContainer);
    }
  });
  _inflight.set(plotContainer, { sig, promise });
  return promise;
}

async function _drawLargePlot(plotContainer, settings, data) {
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
  const layout = createLayout(settings);
  layout.hovermode = false;
  layout.uirevision = 'large';
  let filtered;

  if (cs && cs.codes) {
    // categorical: key = category, missing values last-but-drawn-first
    const nc = cs.categories.length;
    const key = new Uint16Array(n);
    const NA = nc, DROP = nc + 1;
    for (let i = 0; i < n; i++) {
      const c = cs.codes[i];
      key[i] = (x[i] !== x[i] || y[i] !== y[i]) ? DROP
        : c === cs.MISSING ? (settings.hideNaN ? DROP : NA) : c;
    }
    const { X, Y, start, kept } = groupByKey(x, y, key, nc + 1, DROP);
    filtered = n - kept;
    const palette = generateDiscreteColors(nc, settings.categoryPalette && settings.categoryPalette !== 'uns'
      ? settings.categoryPalette : undefined);
    pushTraces(traces, X, Y, start[NA], start[NA + 1], 'NA', NA_COLOR, settings, true);
    for (let k = 0; k < nc; k++) {
      pushTraces(traces, X, Y, start[k], start[k + 1], String(cs.categories[k]),
        palette[k % palette.length], settings, true);
    }
    layout.showlegend = true;
    layout.legend = { ...(layout.legend || {}), title: { text: `obs.${settings.color.key}` } };
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
      if (x[i] !== x[i] || y[i] !== y[i]) { key[i] = DROP; continue; }
      if (c !== c) { key[i] = settings.hideNaN ? DROP : 0; continue; }
      if (settings.hideOutliers && (c < cmin || c > cmax)) { key[i] = DROP; continue; }
      const bin = Math.min(COLOR_BINS - 1, Math.max(0, Math.floor((c - cmin) / width)));
      key[i] = rank[bin];
    }
    const { X, Y, start, kept } = groupByKey(x, y, key, COLOR_BINS + 1, DROP);
    filtered = n - kept;
    const colors = await sampleColorscale(settings.colorScale, settings.colorReversed, COLOR_BINS);
    pushTraces(traces, X, Y, start[0], start[1], 'no value', NA_COLOR, settings, false);
    order.forEach((bin, r) => {
      pushTraces(traces, X, Y, start[r + 1], start[r + 2], `bin ${bin}`, colors[bin], settings, false);
    });
    // the colour bar: one invisible point carrying the scale
    const title = `${settings.color.type}.${settings.color.key}` + (settings.color.column ? `.${settings.color.column}` : '')
      + (settings.color.log ? ' (log10)' : '');
    traces.push({
      type: 'scattergl', mode: 'markers', x: [X[0]], y: [Y[0]], hoverinfo: 'skip', showlegend: false,
      marker: { size: 0.1, opacity: 0, color: [cmin], cmin, cmax, colorscale: settings.colorScale,
        reversescale: !!settings.colorReversed, showscale: true, colorbar: { title: { text: title, side: 'right' } } }
    });
    layout.showlegend = false;
  } else {
    const key = new Uint8Array(n);
    for (let i = 0; i < n; i++) key[i] = (x[i] !== x[i] || y[i] !== y[i]) ? 1 : 0;
    const { X, Y, start, kept } = groupByKey(x, y, key, 1, 1);
    filtered = n - kept;
    pushTraces(traces, X, Y, start[0], start[1], 'cells', settings.pointColor || '#1f77b4', settings, false);
    layout.showlegend = false;
  }
  const t2 = performance.now();

  let coverage = Coverage.complete(n, 'cells');
  if (filtered > 0) {
    coverage = Coverage.partial(n - filtered, n, GAP.FILTERED,
      `${filtered.toLocaleString()} cells without a value (or outside the colour range) are not drawn`,
      { source: 'filter', unit: 'cells' });
  }
  plotContainer.innerHTML = '';
  await drawPlot(plotContainer, traces, layout,
    { responsive: true, displayModeBar: true, displaylogo: false,
      modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d'] },
    coverage, 'cells');
  const t3 = performance.now();
  data.large = { n, traces: traces.length, filtered,
    load_ms: t1 - t0, build_ms: t2 - t1, draw_ms: t3 - t2 };
  data.coverage = coverage;
  data.generation = generation;
  console.info(`Large cell plot: ${n} points in ${traces.length} traces; `
    + `load ${(t1 - t0).toFixed(0)} ms, build ${(t2 - t1).toFixed(0)} ms, draw ${(t3 - t2).toFixed(0)} ms`);
}

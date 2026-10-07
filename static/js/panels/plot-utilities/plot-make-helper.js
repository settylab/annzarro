import { DataManager } from '../../data-manager.js';
import { generateDiscreteColors, groupColours } from './colors.js';
import { recordCameraOnRelease } from '../../utils/scene-camera.js';
import { GROUP_COLOURS, grouped, frequencyRanks, groupOf, groupLegendName } from '../../utils/categories.js';

/**
 * Generates a Plotly layout configuration based on the provided settings.
 *
 * @param {Object} settings - The settings object containing configuration for axes and grid.
 *   Expected structure:
 *     settings = {
 *       showGrid: boolean,
 *       pointSize: number,           // (optional, used elsewhere)
 *       x: { type: string, key: string, column?: string },
 *       y: { type: string, key: string, column?: string },
 *       z: { type: string, key: string, column?: string }  // Optional; if present, generate a 3D layout.
 *       viewport2D: { xrange: Array, yrange: Array },      // Optional; if present, restore 2D viewport
 *       viewport3D: { eye: Object, up: Object, center: Object } // Optional; if present, restore 3D camera position
 *     }
 *
 * @returns {Object} layout - The Plotly layout configuration.
 */
/**
 * Equal aspect: one unit on x is as long as one on y (settings.equalAspect,
 * kept in panel configs and links), so spatial coordinates are not
 * stretched to the tile's shape. 2D only.
 * @returns {Object} relayout keys
 */
export function aspectUpdate(settings) {
  const on = !!settings.equalAspect && !settings.z;
  return { 'yaxis.scaleanchor': on ? 'x' : null, 'yaxis.scaleratio': on ? 1 : null };
}

/**
 * An axis title: the user's own (Plot Options, or a view link's
 * xaxisTitle / yaxisTitle / zaxisTitle), else type.key.column.
 */
export function axisTitle(settings, axis) {
  const custom = settings[`${axis}axisTitle`];
  if (custom) return custom;
  const a = settings[axis];
  return `${a.type}.${a.key}` + (a.column ? `.${a.column}` : '');
}

export function createLayout(settings) {
  // Base axis settings for both 2D and 3D axes.
  const baseAxis = {
    showgrid: settings.showGrid,
    showline: settings.showGrid,
    zeroline: settings.showGrid,
    ticks: settings.showGrid ? '' : 'none',
    showticklabels: settings.showGrid
  };

  // Start with the basic layout.
  const layout = {
    autosize: true,
    margin: { l: 40, r: 40, t: 40, b: 40 },
    hovermode: 'closest',
    // Legend symbols at a readable size, not the plot's point size (3 px by
    // default made the category colours hard to match to their labels)
    legend: { itemsizing: 'constant' },
    // For 2D plots, xaxis and yaxis are defined.
    xaxis: {
      ...baseAxis,
      title: {
        text: axisTitle(settings, 'x'),
        font: {}
      }
    },
    yaxis: {
      ...baseAxis,
      title: {
        text: axisTitle(settings, 'y'),
        font: {}
      },
      ...(settings.equalAspect && !settings.z ? { scaleanchor: 'x', scaleratio: 1 } : {})
    }
  };

  // If a z-axis is provided, assume a 3D plot and configure a scene.
  if (settings.z) {
    layout.scene = {
      xaxis: {
        ...baseAxis,
        title: layout.xaxis.title
      },
      yaxis: {
        ...baseAxis,
        title: layout.yaxis.title
      },
      zaxis: {
        ...baseAxis,
        title: {
          text: axisTitle(settings, 'z'),
          font: {}
        }
      }
    };
    
    // Restore 3D camera position if available
    if (settings.viewport3D) {
      layout.scene.camera = {
        eye: settings.viewport3D.eye,
        up: settings.viewport3D.up,
        center: settings.viewport3D.center
      };
    }
    
    // Remove the 2D axis configuration for 3D plots.
    delete layout.xaxis;
    delete layout.yaxis;
  } else if (settings.viewport2D) {
    // Restore 2D axis ranges if available
    if (settings.viewport2D.xrange) {
      layout.xaxis.range = settings.viewport2D.xrange;
    }
    if (settings.viewport2D.yrange) {
      layout.yaxis.range = settings.viewport2D.yrange;
    }
  }

  return layout;
}

/**
  * Attaches a click handler to the plot container.
  * @param {HTMLElement} plotContainer - The container for the plot.
  * @param {Array<Object>} traces - The traces used in the plot.
  * @param {Object} data - The data object containing cell or gene names.
  * @param {Object} settings - The settings object for the plot.
*/
/**
 * The entity a click should focus, given points that overlap on screen.
 *
 * Plotly reports the point drawn on top, so a cell under a neighbour could
 * not be clicked (the paper's example monocyte). Candidates are all data
 * points within `radiusPx` of the mouse (the focused-cell marker excluded),
 * nearest to the mouse first. The first click focuses the nearest one; a
 * click on the same spot while one of them is focused moves to the next, so
 * repeated clicks reach every point there. 2D only.
 * @param {Object} [mouse] - {x, y} in plot-area pixels; defaults to the point
 * @returns {string} entity name to focus
 */
export function nextOverlappingEntity(gd, point, clicked, current, mouse = null, radiusPx = 4) {
  const fl = gd && gd._fullLayout;
  const xa = fl && fl.xaxis, ya = fl && fl.yaxis;
  if (!xa || !ya || typeof xa.c2p !== 'function' || !point || point.x === undefined) return clicked;
  if (gd.data.some(t => t && t.type === 'scatter3d')) return clicked;
  const mx = mouse ? mouse.x : xa.c2p(point.x), my = mouse ? mouse.y : ya.c2p(point.y);
  const found = new Map();
  for (const t of gd.data) {
    if (!t || !Array.isArray(t.x) || (typeof t.name === 'string' && t.name.includes('Focused'))) continue;
    const names = Array.isArray(t.customdata) ? t.customdata : t.text;
    if (!Array.isArray(names)) continue;
    for (let i = 0; i < t.x.length; i++) {
      const dx = xa.c2p(t.x[i]) - mx, dy = ya.c2p(t.y[i]) - my;
      if (Math.abs(dx) <= radiusPx && Math.abs(dy) <= radiusPx) {
        const d = dx * dx + dy * dy;
        if (!found.has(names[i]) || d < found.get(names[i])) found.set(names[i], d);
      }
    }
  }
  if (found.size < 2) return clicked;
  const ordered = [...found.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).map(e => e[0]);
  const at = ordered.indexOf(current);
  return at >= 0 ? ordered[(at + 1) % ordered.length] : ordered[0];
}

export function attachClickHandler(plotContainer, traces, data, settings) {
    attachGroupLegend(plotContainer);
    if (!plotContainer.__pointerTracked && plotContainer.addEventListener) {
      plotContainer.__pointerTracked = true;
      plotContainer.addEventListener('pointerdown', (ev) => {
        plotContainer.__lastPointer = { clientX: ev.clientX, clientY: ev.clientY };
      }, true);
    }
    // One click handler per graph: every redraw used to add another, so a
    // click ran setFocusedCell once per redraw so far.
    if (plotContainer.__azClickHandler && typeof plotContainer.removeListener === 'function') {
      plotContainer.removeListener('plotly_click', plotContainer.__azClickHandler);
    }
    const onClick = (e) => {
      if (!e || !e.points || e.points.length === 0) return;
  
      const point = e.points[0];
      const pointIndex = point.pointIndex;
      const traceIndex = point.curveNumber;
      
      // Determine if this is a gene plot or cell plot
      const isGenePlot = data.genes !== undefined;
      let entityName;
  
      // Since customdata now stores entity names directly, use it as the primary source
      if (point.customdata !== undefined) {
        entityName = point.customdata;
      } 
      // Fallback to trace text if customdata is not available
      else if (traces[traceIndex] && traces[traceIndex].text && pointIndex < traces[traceIndex].text.length) {
        entityName = traces[traceIndex].text[pointIndex];
      }
      
      if (!entityName) {
        console.warn(`No ${isGenePlot ? 'genes' : 'cells'} name found for clicked point`);
        return;
      }
      
      // Points drawn under a neighbour could not be clicked: Plotly reports
      // the one on top. Clicking the same spot again now steps through every
      // point within a few pixels of it.
      const current = isGenePlot ? DataManager.getFocusedGene() : DataManager.getFocusedCell();
      const area = plotContainer.querySelector && plotContainer.querySelector('.nsewdrag');
      const box = area && area.getBoundingClientRect ? area.getBoundingClientRect() : null;
      // scattergl click events carry no mouse event; use the last pointer
      // position recorded on the graph div
      const ev = plotContainer.__lastPointer || ((e.event && Number.isFinite(e.event.clientX)) ? e.event : null);
      const mouse = box && ev ? { x: ev.clientX - box.left, y: ev.clientY - box.top } : null;
      entityName = nextOverlappingEntity(plotContainer, point, entityName, current, mouse);

      if (isGenePlot) {
        DataManager.setFocusedGene(entityName, false);
      } else {
        DataManager.setFocusedCell(entityName, false);
      }
    };
    plotContainer.__azClickHandler = onClick;
    plotContainer.on('plotly_click', onClick);
    
    // Set up viewport state tracking
    attachViewportTracking(plotContainer, settings);
}

/**
 * Keep the view the user chose (zoom, pan, 3D camera) in the plot's settings,
 * so every redraw (a recolour, a part step, a link) draws it again.
 *
 * Only edits that set the view count. A relayout of anything else (the
 * coverage annotation, a legend title) once reset the 3D camera here, and
 * one handler was added per redraw. One handler per graph now, replaced on
 * each redraw so it writes to the current settings.
 *
 * @param {HTMLElement} plotContainer - The container for the plot.
 * @param {Object} settings - The settings object for the plot.
 */
export function attachViewportTracking(plotContainer, settings) {
  if (typeof plotContainer.on !== 'function') return;
  // a 3D turn released outside the plot is recorded too (scene-camera.js)
  recordCameraOnRelease();
  if (plotContainer.__azViewportHandler && typeof plotContainer.removeListener === 'function') {
    plotContainer.removeListener('plotly_relayout', plotContainer.__azViewportHandler);
  }
  const onRelayout = (eventData) => {
    if (!eventData) return;
    if (settings.z) {
      const camera = eventData['scene.camera'];
      if (camera) settings.viewport3D = { eye: camera.eye, up: camera.up, center: camera.center };
      return;
    }
    // Reset axes / double click: back to the axes Plotly fits
    if (eventData['xaxis.autorange'] === true || eventData['yaxis.autorange'] === true) {
      settings.viewport2D = null;
      return;
    }
    const range = (axis) => eventData[`${axis}.range`]
      || (eventData[`${axis}.range[0]`] !== undefined && eventData[`${axis}.range[1]`] !== undefined
        ? [eventData[`${axis}.range[0]`], eventData[`${axis}.range[1]`]] : null);
    const xrange = range('xaxis'), yrange = range('yaxis');
    if (!xrange && !yrange) return;
    // A zoom along one axis (a drag on its edge) keeps the other as drawn
    const fl = plotContainer._fullLayout || {};
    const shown = (axis) => (fl[axis] && Array.isArray(fl[axis].range) ? [...fl[axis].range] : null);
    settings.viewport2D = {
      xrange: xrange ? [...xrange] : (settings.viewport2D && settings.viewport2D.xrange) || shown('xaxis'),
      yrange: yrange ? [...yrange] : (settings.viewport2D && settings.viewport2D.yrange) || shown('yaxis')
    };
  };
  plotContainer.__azViewportHandler = onRelayout;
  plotContainer.on('plotly_relayout', onRelayout);
}

/**
 * The 2D axis ranges the user zoomed or panned to, as relayout keys, or null.
 * @param {Object} settings
 * @returns {Object|null}
 */
export function keptViewRanges(settings) {
  const v = !settings.z && settings.viewport2D;
  if (!v) return null;
  const out = {};
  if (Array.isArray(v.xrange)) out['xaxis.range'] = [...v.xrange];
  if (Array.isArray(v.yrange)) out['yaxis.range'] = [...v.yrange];
  return Object.keys(out).length ? out : null;
}
  

  /** Legend name of the trace holding points with no colour value. */
  export const NO_VALUE_CATEGORY = 'NA';

  /**
   * A categorical colour value that names no category: null, undefined, NaN,
   * '' or the string 'nan'. One definition for both places that ask: the NA
   * trace here, and Hide NaN in `createFilterMask`, so a point Hide NaN would
   * remove is exactly a point that is otherwise drawn under NA.
   */
  export function isMissingCategory(v) {
    return v === null || v === undefined || v === ''
      || (typeof v === 'number' && Number.isNaN(v))
      || (typeof v === 'string' && v.toLowerCase() === 'nan');
  }

  /**
   * Processes categorical data and generates Plotly traces.
   *
   * Every point handed in lands in exactly one trace, unless it is excluded on
   * purpose (`removeNonTableEntries`, which `createFilterMask` counts). This
   * used to build one trace per known category by strict equality and nothing
   * else, so a point whose value matched no category -- a missing value
   * (`null`, or `NaN`, which equals nothing) or a value absent from the
   * server's category list -- was in no trace and Plotly never drew it. No
   * Coverage was produced for it either, so the panel reported every point on
   * screen (settylab/annzarro#38). Now:
   *
   *  - a non-blank value missing from `catValues` becomes a category of its
   *    own, appended after the listed ones (it is data, and has a name);
   *  - a missing value (`isMissingCategory`) goes to one grey `NA` trace at
   *    the end of the legend -- unless Hide NaN removed it first, which
   *    `createFilterMask` counts.
   *
   * @param {Object} settings - Settings object containing plot configurations.
   * @param {Object} data - Data object containing x, y, and color values.
   * @param {Array<string>} catValues - Array of unique category values.
   * @param {Array<string>} [customColors=null] - Optional custom colors for categories.
   * @returns {Array<Object>} - Array of Plotly trace objects for each category.
   */
  export function processCategories(settings, data, catValues, customColors = null) {
    // Resolve every point to a category slot once. `slotOf[i]` is the index
    // into `categories`, or -1 for a blank value.
    const categories = Array.isArray(catValues) ? catValues.slice() : [];
    const slotByValue = new Map();
    categories.forEach((c, i) => { if (!slotByValue.has(c)) slotByValue.set(c, i); });
    const color = Array.isArray(data.color) ? data.color : [];
    const slotOf = new Array(color.length);
    for (let idx = 0; idx < color.length; idx++) {
      const v = color[idx];
      if (isMissingCategory(v)) { slotOf[idx] = -1; continue; }
      let slot = slotByValue.get(v);
      if (slot === undefined) {
        slot = categories.length;
        categories.push(v);
        slotByValue.set(v, slot);
      }
      slotOf[idx] = slot;
    }

    // Past GROUP_COLOURS categories (utils/categories.js) they are drawn in
    // colour groups: ranked by their points, rank r in colour r mod 64, one
    // trace and one legend entry per colour. A trace and a legend entry per
    // category hung the panel at a few thousand categories.
    const many = grouped(categories.length);

    // Generate a color palette
    let selectedPalette;
    
    // Check if custom colors are provided in settings.
    if (many) {
      // uns colours, one per category, would be a trace each again
      const name = settings.categoryPalette && settings.categoryPalette !== 'uns' ? settings.categoryPalette : undefined;
      try {
        selectedPalette = groupColours(GROUP_COLOURS, name);
      } catch {
        selectedPalette = groupColours(GROUP_COLOURS);
      }
    } else if (
      settings?.categoryPalette === "uns" &&
      customColors &&
      customColors.length > 0
    ) {
      selectedPalette = customColors;
    } else {
        try {
          if (settings.categoryPalette === "uns") {
            // If "uns" is selected but no custom colors are provided, fall back to default palette.
            selectedPalette = generateDiscreteColors(categories.length);
          } else {
            // Generate a color palette based on the provided palette name.
            selectedPalette = generateDiscreteColors(categories.length, settings.categoryPalette);
          }
        }
        catch (error) {
          console.error(`Error generating color palette "${settings.categoryPalette}": ${error}`);
          // Fallback to a default palette if the provided one fails.
          selectedPalette = generateDiscreteColors(categories.length);
        }
    }

    // Determine if this is a gene plot or cell plot
    const isGenePlot = data.genes !== undefined;
    const entityKey = isGenePlot ? 'genes' : 'cells';

    // Check if table filtering is active (for highlighting or removal)
    const isTableFilterActive = settings.tableFilter && settings.tableFilter !== 'none' && data.tableEntities;
    const inTable = idx => data.tableEntities.has(data[entityKey][idx]);

    // Partition the points: per category slot, blank, and not in the table.
    const bySlot = categories.map(() => []);
    const blankIndices = [];
    const nonTableIndices = [];
    for (let idx = 0; idx < slotOf.length; idx++) {
      if (isTableFilterActive && !inTable(idx)) {
        // Greyed out, or removed and counted by createFilterMask.
        if (!settings.removeNonTableEntries) nonTableIndices.push(idx);
        continue;
      }
      if (slotOf[idx] === -1) blankIndices.push(idx);
      else bySlot[slotOf[idx]].push(idx);
    }

    const makeTrace = (indices, name, markerColor, hoverLabel) => {
      const trace = {
        type: settings.z ? 'scatter3d' : 'scattergl',
        mode: 'markers',
        name,
        text: indices.map(idx => data[entityKey][idx]),
        customdata: indices.map(idx => data[entityKey][idx]), // Store entity names for click handling
        hovertemplate: `%{text}<br>x: %{x}<br>y: %{y}` + (settings.z ? `<br>z: %{z}` : '')
          + (hoverLabel !== null ? `<br>${hoverLabel}` : '') + `<extra></extra>`,
        x: indices.map(idx => data.x.values[idx]),
        y: indices.map(idx => data.y.values[idx]),
        marker: {
          size: settings.pointSize,
          opacity: settings.pointOpacity,
          color: markerColor
        },
        showlegend: true
      };
      // Add z-axis values for 3D plots if applicable.
      if (settings.z && data.z) {
        trace.z = indices.map(idx => data.z.values[idx]);
      }
      return trace;
    };

    const traces = [];

    // One trace for all non-table entities, drawn first so it sits at the bottom.
    if (nonTableIndices.length > 0) {
      traces.push(makeTrace(nonTableIndices, 'Not in table', 'rgba(180, 180, 180, 1.)', null));
    }

    // Points with no value, under the categories and last in the legend.
    if (blankIndices.length > 0) {
      const naTrace = makeTrace(blankIndices, NO_VALUE_CATEGORY, 'rgba(200, 200, 200, 1.)', 'no value');
      naTrace.legendrank = 1001;
      traces.push(naTrace);
    }

    if (many) {
      // Each category's rank over the WHOLE column (data.colorRankOf, from
      // the server's cached ranking) decides its colour, rank mod
      // GROUP_COLOURS: the same in every panel, subset, part and filter.
      // Without it (an older server) the points here are ranked instead.
      const global = data.colorRankOf instanceof Map ? data.colorRankOf : null;
      const local = global ? null : frequencyRanks(Uint32Array.from(bySlot, s => s.length));
      const rankOfSlot = (i) => {
        if (!global) return local.rankOf[i];
        const r = global.get(categories[i]);
        return r === undefined ? -1 : r;
      };
      // One trace in dataset order, each point in its group's colour: a trace
      // per colour drew the last colour over the other 63 wherever points
      // overlap. The legend rows are proxies (one per colour), and clicking
      // one hides that colour's points (attachGroupLegend).
      const present = selectedPalette.map(() => []);
      const groupOfSlot = new Int16Array(categories.length).fill(-1);
      let unranked = categories.length;
      bySlot.forEach((indices, i) => {
        if (indices.length === 0) return;
        let r = rankOfSlot(i);
        if (r < 0) r = unranked++;     // a value the ranking does not know: after every ranked one
        groupOfSlot[i] = groupOf(r);
        present[groupOfSlot[i]].push([r, i]);
      });
      const shown = [];
      for (let idx = 0; idx < slotOf.length; idx++) {
        const slot = slotOf[idx];
        if (slot >= 0 && groupOfSlot[slot] >= 0 && bySlot[slot].length && (!isTableFilterActive || inTable(idx))) shown.push(idx);
      }
      const all = {
        x: shown.map(idx => data.x.values[idx]),
        y: shown.map(idx => data.y.values[idx]),
        z: settings.z && data.z ? shown.map(idx => data.z.values[idx]) : null,
        names: shown.map(idx => data[entityKey][idx]),
        labels: shown.map(idx => String(categories[slotOf[idx]])),
        group: Uint8Array.from(shown, idx => groupOfSlot[slotOf[idx]]),
        hovertext: null
      };
      const trace = makeTrace([], 'colour groups', [], null);
      trace.showlegend = false;
      trace.meta = GROUP_POINTS;
      trace._azGroups = { all, palette: selectedPalette, hidden: new Set() };
      const view = groupView(trace._azGroups);
      Object.assign(trace.marker, groupColorscale(selectedPalette), { color: view.marker.color });
      delete view.marker;
      Object.assign(trace, view);
      // the template applyHoverInfo (plot-make.js hoverTemplateFor) sets: the
      // same one here spares a restyle of every point after the draw
      trace.hovertemplate = '%{text}<br>x: %{x:.4~g}<br>y: %{y:.4~g}' + (settings.z ? '<br>z: %{z:.4~g}' : '')
        + '%{hovertext}<extra></extra>';
      traces.push(trace);
      const proxies = [];
      present.forEach((members, g) => {
        if (members.length === 0) return;
        members.sort((p, q) => p[0] - q[0]);
        const p = { type: trace.type, mode: 'markers', name: groupLegendName(members.map(([, i]) => categories[i])),
          legendgroup: `az-group-${g}`, showlegend: true, meta: LEGEND_PROXY, x: [null], y: [null], hoverinfo: 'skip',
          marker: { size: settings.pointSize, opacity: 1, color: selectedPalette[g] }, legendrank: g + 1, _azGroup: g };
        if (settings.z) p.z = [null];
        proxies.push(p);
      });
      return withLegendProxies(traces, settings).concat(proxies);
    }

    categories.forEach((category, i) => {
      if (bySlot[i].length === 0) return; // Skip this category if there are no points
      traces.push(makeTrace(bySlot[i], category, selectedPalette[i % selectedPalette.length], category));
    });

    return withLegendProxies(traces, settings);
  }

  /** Trace `meta` of a legend proxy, and of the point traces whose legend entry it carries. */
  export const LEGEND_PROXY = 'az-legend';
  export const LEGEND_POINTS = 'az-points';
  /** Trace `meta` of the one trace that holds every colour group's points. */
  export const GROUP_POINTS = 'az-groups';

  /**
   * The points a colour-group trace shows: those of the groups not hidden,
   * in dataset order, with their colours, names and hover labels.
   * @param {{all: Object, palette: string[], hidden: Set<number>}} groups
   */
  export function groupView(groups) {
    const { all, hidden } = groups;
    if (!all.hovertext) all.hovertext = all.labels.map(label => `<br>${label}`);
    // nothing hidden: the arrays themselves, not a second copy of them
    if (hidden.size === 0) {
      const view = { x: all.x, y: all.y, text: all.names, customdata: all.names, _azLabels: all.labels,
        hovertext: all.hovertext, marker: { color: all.group } };
      if (all.z) view.z = all.z;
      return view;
    }
    const keep = [];
    for (let i = 0; i < all.group.length; i++) if (!hidden.has(all.group[i])) keep.push(i);
    const pick = (a) => keep.map(i => a[i]);
    const view = {
      x: pick(all.x), y: pick(all.y), text: pick(all.names), customdata: pick(all.names),
      _azLabels: pick(all.labels), hovertext: pick(all.hovertext),
      marker: { color: Uint8Array.from(keep, i => all.group[i]) }
    };
    if (all.z) view.z = pick(all.z);
    return view;
  }

  /**
   * The colour of each point as its group number through a stepped
   * colorscale of the palette: Plotly maps numbers to colours in bulk, where
   * a colour string per point was parsed one by one (6.2 s against 2.5 s at
   * 1M points, and 450 MB more).
   * @param {string[]} palette
   */
  export function groupColorscale(palette) {
    const n = palette.length;
    const scale = [];
    palette.forEach((c, k) => { scale.push([k / n, c], [(k + 1) / n, c]); });
    return { colorscale: scale, cmin: -0.5, cmax: n - 0.5, showscale: false };
  }

  /**
   * Hide or show colour groups of `gd`'s colour-group trace: a click on a
   * group's legend row toggles it, a double click shows only it (or, when it
   * is the only one shown, all again), as Plotly's legend does for traces.
   * @returns {boolean} whether `gd` has such a trace and `g` was handled
   */
  export function toggleColourGroup(gd, g, isolate = false) {
    const at = (gd.data || []).findIndex(t => t && t.meta === GROUP_POINTS && t._azGroups);
    if (at < 0) return false;
    const trace = gd.data[at];
    const groups = trace._azGroups;
    const rows = gd.data.map((t, i) => [t, i]).filter(([t]) => t && t._azGroup !== undefined);
    if (isolate) {
      const onlyThis = rows.every(([t]) => t._azGroup === g || groups.hidden.has(t._azGroup)) && !groups.hidden.has(g);
      groups.hidden = new Set(onlyThis ? [] : rows.map(([t]) => t._azGroup).filter(k => k !== g));
    } else if (groups.hidden.has(g)) {
      groups.hidden.delete(g);
    } else {
      groups.hidden.add(g);
    }
    const view = groupView(groups);
    trace._azLabels = view._azLabels;
    const update = { x: [view.x], y: [view.y], text: [view.text], customdata: [view.customdata],
      hovertext: [view.hovertext], 'marker.color': [view.marker.color] };
    if (view.z) update.z = [view.z];
    // one after the other: a restyle sent while one is drawing was lost
    const visible = rows.map(([t]) => (groups.hidden.has(t._azGroup) ? 'legendonly' : true));
    Promise.resolve(Plotly.restyle(gd, update, [at]))
      .then(() => Plotly.restyle(gd, { visible }, rows.map(([, i]) => i)))
      .catch((err) => console.warn('Colour group not toggled:', err && err.message));
    return true;
  }

  /** Legend clicks on colour-group rows (once per graph; the handlers read gd.data when clicked). */
  export function attachGroupLegend(gd) {
    if (!gd || gd.__azGroupLegend || typeof gd.on !== 'function') return;
    gd.__azGroupLegend = true;
    // Plotly sends a click for each click of a double click, then the double
    // click: a click waits out the double-click delay, as Plotly's own legend
    // does, and the second click of a pair cancels the first
    let pending = null;
    const groupOfEvent = (e) => {
      const t = e && e.data && e.data[e.curveNumber];
      return t && t._azGroup !== undefined ? t._azGroup : null;
    };
    gd.on('plotly_legendclick', (e) => {
      const g = groupOfEvent(e);
      if (g === null) return true;
      if (pending) {
        clearTimeout(pending);
        pending = null;
        return false;
      }
      const delay = (gd._context && gd._context.doubleClickDelay) || 300;
      pending = setTimeout(() => { pending = null; toggleColourGroup(gd, g); }, delay);
      return false;
    });
    gd.on('plotly_legenddoubleclick', (e) => {
      const g = groupOfEvent(e);
      if (g === null) return true;
      if (pending) clearTimeout(pending);
      pending = null;
      toggleColourGroup(gd, g, true);
      return false;
    });
  }

  /** True for a legend proxy trace (no points; styling restyles skip it). */
  export function isLegendProxy(trace) {
    return !!trace && trace.meta === LEGEND_PROXY;
  }

  /**
   * Legend entries at full opacity. Plotly draws a legend symbol with its
   * trace's marker opacity, so at a low point opacity the legend was as pale
   * as the points. Each trace's entry moves to a proxy trace with no points,
   * at full opacity, in the trace's legend group (clicking the entry still
   * hides and shows the points; double-click isolates them), appended after
   * the point traces so their indices do not change.
   */
  export function withLegendProxies(traces, settings) {
    const proxies = [];
    for (const t of traces) {
      if (t.showlegend === false) continue;
      t.legendgroup = t.legendgroup || t.name;
      t.showlegend = false;
      t.meta = LEGEND_POINTS;
      const p = { type: t.type, mode: 'markers', name: t.name, legendgroup: t.legendgroup, showlegend: true,
        meta: LEGEND_PROXY, x: [null], y: [null], hoverinfo: 'skip',
        marker: { size: settings.pointSize, opacity: 1, color: t.marker && t.marker.color } };
      if (t.type === 'scatter3d') p.z = [null];
      if (t.legendrank !== undefined) p.legendrank = t.legendrank;
      proxies.push(p);
    }
    return traces.concat(proxies);
  }
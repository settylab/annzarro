import { DataManager } from '../../data-manager.js';
import { RemoteNames } from '../../utils/remote-names.js';
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

/**
 * Names for the cells a plot holds as tokens (names fetched when needed,
 * DataManager.getCellsForPanel). The hover label reads `trace.text`, which
 * holds a cell's name once it is in the browser and '' before: when the
 * pointer lands on a point without one, its name is asked for, written into
 * the trace's text, and the label is drawn again from the pointer's position.
 * Names of points nearby are asked for with it, so moving on finds them.
 * One handler per graph.
 * @param {HTMLElement} plotContainer
 */
export function attachLazyNames(plotContainer) {
    if (!plotContainer || typeof plotContainer.on !== 'function') return;
    if (plotContainer.__azHoverNames && typeof plotContainer.removeListener === 'function') {
      plotContainer.removeListener('plotly_hover', plotContainer.__azHoverNames);
    }
    const onHover = (e) => {
      const cells = DataManager.getCells();
      if (!e || !Array.isArray(e.points) || !(cells instanceof RemoteNames)) return;
      for (const p of e.points) {
        const id = p.customdata;
        if (!RemoteNames.isToken(id)) continue;
        const i = RemoteNames.tokenIndex(id);
        const known = cells.peek(i);
        const trace = p.fullData || (plotContainer._fullData && plotContainer._fullData[p.curveNumber]);
        if (known !== undefined) {
          // the label was drawn before the name was here (an earlier hover)
          if (trace && Array.isArray(trace.text) && trace.text[p.pointNumber] !== known) {
            trace.text[p.pointNumber] = known;
            redrawHover(plotContainer);
          }
          continue;
        }
        cells.nameAt(i).then((name) => {
          if (typeof name !== 'string') return;
          for (const t of [trace, plotContainer.data && plotContainer.data[p.curveNumber]]) {
            if (t && Array.isArray(t.text)) t.text[p.pointNumber] = name;
          }
          // still on that point: show the name
          const now = plotContainer._hoverdata && plotContainer._hoverdata[0];
          if (now && now.curveNumber === p.curveNumber && now.pointNumber === p.pointNumber) redrawHover(plotContainer);
        }).catch(() => {});
      }
    };
    plotContainer.__azHoverNames = onHover;
    plotContainer.on('plotly_hover', onHover);
}

/** Draw the hover label again where the pointer is (Plotly reads the trace's text when it draws). */
function redrawHover(plotContainer) {
    const at = plotContainer.__pointerAt;
    const area = plotContainer.querySelector && plotContainer.querySelector('.nsewdrag');
    if (!at || !area || typeof MouseEvent === 'undefined') return;
    area.dispatchEvent(new MouseEvent('mousemove', { clientX: at.clientX, clientY: at.clientY, bubbles: true }));
}

export function attachClickHandler(plotContainer, traces, data, settings) {
    if (!plotContainer.__pointerTracked && plotContainer.addEventListener) {
      plotContainer.__pointerTracked = true;
      plotContainer.addEventListener('pointerdown', (ev) => {
        plotContainer.__lastPointer = { clientX: ev.clientX, clientY: ev.clientY };
      }, true);
      plotContainer.addEventListener('pointermove', (ev) => {
        plotContainer.__pointerAt = { clientX: ev.clientX, clientY: ev.clientY };
      }, true);
    }
    attachLazyNames(plotContainer);
    // One click handler per graph: every redraw used to add another, so a
    // click ran setFocusedCell once per redraw so far.
    if (plotContainer.__azClickHandler && typeof plotContainer.removeListener === 'function') {
      plotContainer.removeListener('plotly_click', plotContainer.__azClickHandler);
    }
    const onClick = async (e) => {
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
      let current = isGenePlot ? DataManager.getFocusedGene() : DataManager.getFocusedCell();
      // names fetched when needed: the plot holds tokens, the focus a name
      const cells = isGenePlot ? null : DataManager.getCells();
      const byToken = cells instanceof RemoteNames && RemoteNames.isToken(entityName);
      if (byToken) current = cells.tokenOf(current);
      const area = plotContainer.querySelector && plotContainer.querySelector('.nsewdrag');
      const box = area && area.getBoundingClientRect ? area.getBoundingClientRect() : null;
      // scattergl click events carry no mouse event; use the last pointer
      // position recorded on the graph div
      const ev = plotContainer.__lastPointer || ((e.event && Number.isFinite(e.event.clientX)) ? e.event : null);
      const mouse = box && ev ? { x: ev.clientX - box.left, y: ev.clientY - box.top } : null;
      entityName = nextOverlappingEntity(plotContainer, point, entityName, current, mouse);
      if (byToken) {
        entityName = await DataManager.nameOfCell(entityName);
        if (!entityName) return;
      }

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
  const followView = () => { if (typeof plotContainer.__azFollowView === 'function') plotContainer.__azFollowView(); };
  const onRelayout = (eventData) => {
    if (!eventData) return;
    // automatic point size and opacity for the points now in view (listeners.js)
    if (trackView(eventData) && !settings.z) followView();
  };
  const trackView = (eventData) => {
    if (settings.z) {
      const camera = eventData['scene.camera'];
      if (camera) settings.viewport3D = { eye: camera.eye, up: camera.up, center: camera.center };
      return !!camera;
    }
    // Reset axes / double click: back to the axes Plotly fits
    if (eventData['xaxis.autorange'] === true || eventData['yaxis.autorange'] === true) {
      settings.viewport2D = null;
      return true;
    }
    const range = (axis) => eventData[`${axis}.range`]
      || (eventData[`${axis}.range[0]`] !== undefined && eventData[`${axis}.range[1]`] !== undefined
        ? [eventData[`${axis}.range[0]`], eventData[`${axis}.range[1]`]] : null);
    const xrange = range('xaxis'), yrange = range('yaxis');
    if (!xrange && !yrange) return false;
    // A zoom along one axis (a drag on its edge) keeps the other as drawn
    const fl = plotContainer._fullLayout || {};
    const shown = (axis) => (fl[axis] && Array.isArray(fl[axis].range) ? [...fl[axis].range] : null);
    settings.viewport2D = {
      xrange: xrange ? [...xrange] : (settings.viewport2D && settings.viewport2D.xrange) || shown('xaxis'),
      yrange: yrange ? [...yrange] : (settings.viewport2D && settings.viewport2D.yrange) || shown('yaxis')
    };
    return true;
  };
  plotContainer.__azViewportHandler = onRelayout;
  plotContainer.on('plotly_relayout', onRelayout);
  // a redraw that keeps a zoomed view was drawn with the style for every point
  if (settings.viewport2D && !settings.z) followView();
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
    // ranked codes without labels (hover off, plot-make.js loadAxisData) are
    // always colour groups: the values are the ranks
    const many = !!data.colorRanked || grouped(categories.length);

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
        text: DataManager.cellLabels(indices.map(idx => data[entityKey][idx])),
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
      const ranked = !!data.colorRanked;
      const global = data.colorRankOf instanceof Map ? data.colorRankOf : null;
      const local = ranked || global ? null : frequencyRanks(Uint32Array.from(bySlot, s => s.length));
      const rankOfSlot = (i) => {
        if (ranked) return categories[i];
        if (!global) return local.rankOf[i];
        const r = global.get(categories[i]);
        return r === undefined ? -1 : r;
      };
      // per colour: its categories on this plot, by rank (the legend names
      // the largest present ones first)
      const present = selectedPalette.map(() => []);
      const byColour = selectedPalette.map(() => []);
      let unranked = categories.length;
      bySlot.forEach((indices, i) => {
        if (indices.length === 0) return;
        let r = rankOfSlot(i);
        if (r < 0) r = unranked++;     // a value the ranking does not know: after every ranked one
        const g = groupOf(r);
        present[g].push([r, i]);
        for (const idx of indices) byColour[g].push(idx);
      });
      byColour.forEach((indices, g) => {
        if (indices.length === 0) return;
        const members = present[g].sort((p, q) => p[0] - q[0]);
        // ranked: no labels were read; the legend's names came with the ranks
        const name = ranked ? (data.colorGroupNames && data.colorGroupNames[g]) || ''
          : groupLegendName(members.map(([, i]) => categories[i]));
        const trace = makeTrace(indices, name, selectedPalette[g], null);
        if (ranked) {
          // no label to show: no hover box (a template would override hoverinfo)
          trace.hoverinfo = 'none';
          trace.hovertemplate = '';
        } else {
          trace._azLabels = indices.map(idx => String(categories[slotOf[idx]]));
          trace.hovertext = trace._azLabels.map(label => `<br>${label}`);
          trace.hovertemplate = trace.hovertemplate.replace('<extra></extra>', '%{hovertext}<extra></extra>');
        }
        trace.legendrank = g + 1;
        traces.push(trace);
      });
      return withLegendProxies(traces, settings);
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
  /** Trace `meta` of the one invisible point that carries a large plot's colour bar. */
  export const COLOUR_BAR = 'az-colorbar';

  /** True for a legend proxy trace (no points; styling restyles skip it). */
  export function isLegendProxy(trace) {
    return !!trace && trace.meta === LEGEND_PROXY;
  }

  /** True for a trace the point size and opacity leave alone: a legend proxy or a colour bar's point. */
  export function keepsOwnMarker(trace) {
    return isLegendProxy(trace) || (!!trace && trace.meta === COLOUR_BAR);
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
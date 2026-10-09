import { strongOnTopKey, plotlyColorscale } from '../../utils/color-scales.js';
import { DataManager } from '../../data-manager.js';
import { outsideDetail } from '../../utils/subset.js';
import { createLayout, processCategories, attachClickHandler, isMissingCategory, keptViewRanges, keepsOwnMarker } from './plot-make-helper.js';
import { autoPointCount, debounced } from '../../utils/view-point-style.js';
import { highlightFocusedEntity, noteFocusOutside, updatePlotElements, restyleMarkers } from './plot-update.js';
import { updateColorSliderUI, updateColorControlsVisibility, showPointStyle, showColorSortControl } from './panel-ui-update.js';
import { applyAutoPointStyle, pointStyleBase, greyMarker } from '../../utils/point-style.js';
export { pointStyleBase };
import { getPositioningByLocation, applyAllAestheticSettings, initializeAestheticsSettings } from './plot-aesthetics-menu.js';
import { arrayMin, arrayMax, inferValueType, logColorValues, logColorbarTicks } from '../../utils/array-stats.js';
import {
  Coverage, GAP, classifyColumn, classifyValues, classifyMatrixColumn,
  classifyError, classifyFilterStats, missingEntity, unreadableCell, classifyFocusRow
} from '../../utils/coverage.js';
import { drawPlot, clearForDraw, drawPlaceholder, setStatusTag } from '../../utils/panel-surface.js';
import { largePlotPoints, largePlotRefusal, createLargePlot, showProbeFailure } from './large-plot.js';
import { recordLoad } from '../../utils/subset-presets.js';
import { updateLargePlotControls } from './large-plot-controls.js';
import { Config } from '../../config.js';
import { colourKind } from '../../utils/memory-guard.js';
import { selectionOnCells, staleText } from '../../utils/closed-table.js';
import { colourTitle } from '../../utils/plot-titles.js';
import { NO_HOVER } from './hover-columns.js';
import { categoryCount, grouped, GROUP_COLOURS, LEGEND_NAMES, groupLegendLabel, hoverOffFor, hoverIsOff } from '../../utils/categories.js';
import { releasePlot } from '../../utils/release-plot.js';
import { cancelLoads } from '../../utils/load-scope.js';
import {
  drawCheck, reserve, commit, cancel, refusalText, crashedDrawing, takeOverride, markIfRisky, unmark, hoverLabelsCheck
} from '../../utils/memory-guard-ui.js';

// the loads of a panel that the Cancel button can stop (utils/load-scope.js)
const CANCELLABLE = new Set(['full-plot', 'axis-data', 'recolour', 'table-data']);

/**
 * Manages loading indicators for plot operations with built-in counter to handle
 * concurrent loading operations properly.
 */
class LoadingIndicator {
  constructor() {
    this._counters = new WeakMap(); // Use WeakMap to avoid memory leaks
    this._instanceId = Date.now().toString(36); // Unique instance identifier
  }

  /**
   * Generate a stable ID for a container
   * @param {HTMLElement} container - The container element
   * @returns {string} - A stable identifier
   */
  _getContainerId(container) {
    // If container already has an ID or data-id attribute, use it
    if (container.id) return container.id;
    if (container.dataset.id) return container.dataset.id;
    
    // If container doesn't have an ID, generate one and store it
    if (!container.dataset.loadingId) {
      // Create a stable ID based on DOM position
      const domPath = [];
      let node = container;
      while (node && node !== document.body) {
        const siblings = Array.from(node.parentNode?.children || []);
        const index = siblings.indexOf(node);
        domPath.unshift(index);
        node = node.parentNode;
      }
      
      // Create a stable ID that persists for this DOM element
      const stableId = `loading-container-${this._instanceId}-${domPath.join('-')}`;
      container.dataset.loadingId = stableId;
    }
    
    return container.dataset.loadingId;
  }

  /**
   * Shows a loading indicator for the specified container if not already showing
   * @param {HTMLElement} plotContainer - The container to show loading indicator in
   * @param {string} operation - Identifier for the loading operation
   * @returns {void}
   */
  show(plotContainer, operation) {
    if (!plotContainer) return;
    
    // Generate a stable container ID
    const containerId = this._getContainerId(plotContainer);
    
    // Initialize counter map for this container if needed
    if (!this._counters.has(plotContainer)) {
      this._counters.set(plotContainer, new Map());
    }
    
    const operationCounts = this._counters.get(plotContainer);
    const currentCount = operationCounts.get(operation) || 0;
    operationCounts.set(operation, currentCount + 1);
    
    // Only modify DOM if this is the first concurrent operation of this type
    if (currentCount === 0) {
      const overlayId = `loading-overlay-${containerId}-${operation}`;
      // Check if overlay already exists and remove it if it does (handles edge cases)
      const existingOverlay = document.getElementById(overlayId);
      if (existingOverlay) existingOverlay.remove();
      
      // Create new overlay
      const overlay = document.createElement('div');
      overlay.id = overlayId;
      overlay.className = 'loading-overlay';
      overlay.dataset.operation = operation; // Store operation for fallback cleanup
      overlay.dataset.containerId = containerId; // Store containerId for fallback cleanup
      // Cancel appears after a moment (css), so a quick load does not flash it
      const cancellable = CANCELLABLE.has(operation);
      overlay.innerHTML = '<div class="spinner"></div> Loading axis data...' + (cancellable
        ? '<button type="button" class="btn btn-sm btn-outline-secondary load-cancel" title="Stop loading and keep what is shown">Cancel</button>' : '');
      if (cancellable) {
        overlay.onclick = (e) => {
          if (e.target.closest('.load-cancel')) cancelLoads(plotContainer, true);
        };
      }
      
      // Make sure container has position relative/absolute for proper overlay
      const containerPosition = window.getComputedStyle(plotContainer).position;
      if (containerPosition === 'static') {
        plotContainer.style.position = 'relative';
      }
      
      plotContainer.appendChild(overlay);
    }
  }

  /**
   * Hides the loading indicator for the specified container
   * @param {HTMLElement} plotContainer - The container to hide loading indicator in
   * @param {string} operation - Identifier for the loading operation 
   * @returns {void}
   */
  hide(plotContainer, operation) {
    if (!plotContainer) return;
    
    // Get the stable container ID
    const containerId = this._getContainerId(plotContainer);
    
    // Find and remove operation counts
    if (this._counters.has(plotContainer)) {
      const operationCounts = this._counters.get(plotContainer);
      const currentCount = operationCounts.get(operation) || 0;
      
      if (currentCount <= 1) {
        // Last or only operation is complete
        operationCounts.delete(operation);
        
        // Remove any overlay for this operation
        const overlayId = `loading-overlay-${containerId}-${operation}`;
        const overlay = document.getElementById(overlayId);
        if (overlay) {
          overlay.remove();
        } else {
          // Fallback: find by data attributes if ID approach fails
          const fallbackOverlays = plotContainer.querySelectorAll(
            `.loading-overlay[data-operation="${operation}"][data-container-id="${containerId}"]`
          );
          fallbackOverlays.forEach(el => el.remove());
        }
      } else {
        // Decrement counter for concurrent operations
        operationCounts.set(operation, currentCount - 1);
      }
      
      // Clean up the container entry if no more operations
      if (operationCounts.size === 0) {
        this._counters.delete(plotContainer);
      }
    } else {
      // Fallback: if counter tracking failed, attempt cleanup by data attributes
      const allOverlays = plotContainer.querySelectorAll(
        `.loading-overlay[data-operation="${operation}"]`
      );
      allOverlays.forEach(el => el.remove());
    }
  }
  
  /**
   * Clean up all loading indicators for a container when it's being destroyed
   * @param {HTMLElement} plotContainer - The container being destroyed
   */
  cleanupContainer(plotContainer) {
    if (!plotContainer) return;
    
    // First, delete the counter entry
    if (this._counters.has(plotContainer)) {
      this._counters.delete(plotContainer);
    }
    
    // Then remove all loading overlays from the container
    const overlays = plotContainer.querySelectorAll('.loading-overlay');
    overlays.forEach(overlay => overlay.remove());
  }
}

// Create a singleton instance
export const loadingIndicator = new LoadingIndicator();

// Make loadingIndicator globally available for cleanup.
//
// Guarded because an UNGUARDED touch here is why nothing in this repo has ever
// executed `loadAxisData`. This is the only module-scope global reference in
// the file, so without the guard the whole module throws on import under
// `node --test`, and a test cannot reach the function no matter how it is
// written. That is not a testing inconvenience -- it is the structural reason a
// `ReferenceError` in this file's catch block survived four commits and two
// review rounds while every suite stayed green. See
// `annzarro/tests/js/axis-coverage.test.mjs`, which imports this module.
if (typeof window !== 'undefined') {
  window.loadingIndicator = loadingIndicator;
}

/**
 * Each colour group's legend name from ranked codes alone: the group's
 * lowest ranks among the points (its largest categories) by name, and how
 * many more it has. Reads LEGEND_NAMES labels per colour, at most 192.
 * @returns {Promise<string[]>} GROUP_COLOURS names ('' for an empty colour)
 */
async function rankedGroupNames(datasetPath, key, slot, codes, missing, signal = null) {
  let top = 0;
  for (let i = 0; i < codes.length; i++) if (codes[i] !== missing && codes[i] > top) top = codes[i];
  const present = new Uint8Array(top + 1);
  for (let i = 0; i < codes.length; i++) if (codes[i] !== missing) present[codes[i]] = 1;
  const lowest = Array.from({ length: GROUP_COLOURS }, () => []);
  const total = new Float64Array(GROUP_COLOURS);
  for (let r = 0; r <= top; r++) {
    if (!present[r]) continue;
    const g = r % GROUP_COLOURS;
    total[g]++;
    if (lowest[g].length < LEGEND_NAMES) lowest[g].push(r);
  }
  const labels = await DataManager.loadCategoryLabels(datasetPath, key, lowest.flat(), slot, signal);
  return lowest.map((ranks, g) => (total[g] ? groupLegendLabel(ranks.map(r => labels.get(r) ?? String(r)), total[g]) : ''));
}

/** Below this many labels a hover's labels are not worth a guard check (65,536: a few MB). */
let HOVER_GUARD_MIN = 65536;

/** For tests: check hover labels from `n` labels on (a small fixture's). */
export function _setHoverGuardMin(n) { HOVER_GUARD_MIN = n; }

/**
 * Whether the hover labels of categorical column `slot.key` (`count`
 * categories, `points` points) fit the browser: the memory guard's check
 * with the cost measured for labels (memory-guard.js labelCost) and the
 * column's label length from three of its labels. A refusal is said on the
 * plot's status line with the guard's numbers; the plot stays coloured.
 */
async function hoverLabelsFit(datasetPath, slot, key, count, points, plotContainer, signal = null) {
  const labels = Math.min(count, points);
  if (!(labels > HOVER_GUARD_MIN)) return true;
  let chars = 16;   // when no label could be read: about a cell barcode
  try {
    const sample = [...(await DataManager.loadCategoryLabels(datasetPath, key, [0, 1, 2], slot, signal)).values()].map(String);
    if (sample.length) chars = sample.reduce((a, l) => a + l.length, 0) / sample.length;
  } catch (error) {
    if (error && error.name === 'AbortError') throw error;
    // the guard's estimate with the default length
  }
  const result = hoverLabelsCheck({ points, labels, chars });
  const refused = result.verdict === 'block';
  if (plotContainer) {
    setStatusTag(plotContainer, `hover-memory-${slot}.${key}`, result.verdict === 'ok' ? null : {
      text: refused ? 'Hover off: browser memory' : 'Hover over the memory budget', severity: 'warning', title: result.why,
      pop: { text: `Hover labels of ${slot}.${key} (${labels.toLocaleString('en-US')}) ${refused ? 'not read' : 'read'}: ${result.why}.` }
    });
  }
  return !refused;
}

/**
 * Whether turning a plot's hover on with `settings.hoverInfo` fits the
 * browser: every categorical hover column, and the colour column's labels
 * when the plot was coloured without them (`colourRanked`). Checked before
 * the pick is applied, so a refused pick leaves the hover as it was.
 */
export async function hoverPickFits(settings, plotType, plotContainer, colourRanked) {
  const datasetPath = DataManager.getCurrentDataset();
  const structure = await DataManager.getDatasetStructure(datasetPath).catch(() => null);
  const shown = plotType === 'genes' ? DataManager.getGenes() : DataManager.getCells();
  const points = shown && typeof shown.length === 'number' ? shown.length : 0;
  const columns = (Array.isArray(settings.hoverInfo) ? settings.hoverInfo : [])
    .filter(h => h && (h.type === 'obs' || h.type === 'var') && h.key && h.key !== '_index' && !h.column);
  const c = settings.color;
  if (colourRanked && c && (c.type === 'obs' || c.type === 'var')) columns.push({ type: c.type, key: c.key });
  for (const h of columns) {
    const count = categoryCount(structure, h.type, h.key);
    if (count !== null && !(await hoverLabelsFit(datasetPath, h.type, h.key, count, points, plotContainer))) return false;
  }
  return true;
}

/** Show a plot's hover setting in its Hover picker ("No hover" when off). */
export function showHoverChoice(plotContainer, panel) {
  const id = plotContainer && plotContainer.id ? plotContainer.id.replace(/^plot-container-/, '') : null;
  const select = id && typeof document !== 'undefined' ? document.getElementById(`hover-columns-${id}`) : null;
  if (!select || !select.options) return;
  const none = Array.from(select.options).find(o => o.value === NO_HOVER);
  if (none) none.selected = hoverIsOff(panel.hoverOff);
  if (hoverIsOff(panel.hoverOff)) for (const o of select.options) if (o.value !== NO_HOVER) o.selected = false;
}

/**
 * Loads data for a specific axis from an anndata-derived source.
 * 
 * @param {Object} settings - Axis settings object.
 * @param {string} [plotType=null] - Optional plot type ('cells' or 'genes') to determine context.
 * @param {HTMLElement} [plotContainer=null] - Container to show loading indicator in.
 * @param {{role?: 'colour'|null}} [opts] - role 'colour': an obs/var column with
 *    up to GROUP_COLOURS categories is loaded with every category (palette and
 *    legend order); one with more, with the labels of the points only, which
 *    are drawn in colour groups (utils/categories.js).
 * @returns {Promise<Object>} - Resolves to an object with:
 *    - values: The data values,
 *    - type: Data type ('numerical', 'categorical', 'constant', or 'string'),
 *    - categories: (optional) Category definitions.
 */
export async function loadAxisData(settings, plotType = null, plotContainer = null, { role = null, panel = null, signal = null } = {}) {
  if (!settings) {
    throw new Error(`loadAxisData: settings is undefined`);
  }

  // DECLARED OUTSIDE THE `try` ON PURPOSE. The catch block below reads all four
  // of these. `let`/`const` are block-scoped, so while they lived inside the
  // `try` the catch could not see them and threw
  // `ReferenceError: coverage is not defined` -- and `error.coverage ||`
  // short-circuits, so it fired on exactly the paths that carry NO
  // classification, i.e. every path `classifyError` exists for. Measured 5 of 5
  // (HTTP 500, cap_exceeded, not_found, network drop, unknown axis type): the
  // user was shown "plot data: failed to read -- coverage is not defined".
  //
  // It also silently killed a feature: the axis-specific troubleshooting hints
  // below key on the message containing "Failed to load data for", which the
  // ReferenceError replaced.
  //
  // `node --check` passes on the broken form; ESLint's `no-undef` catches it
  // (`npm run lint`, run in CI). Keep these here.
  //
  // Only work that CANNOT throw belongs here, though: this region is outside
  // both the `catch` and the `finally`, so anything raised in it escapes
  // unclassified, unwrapped, and with the loading indicator still up. Fixing
  // the scope bug by hoisting widened that region from 3 lines to 39 and put
  // two `DataManager` calls inside it. So `expected` is DECLARED here and
  // ASSIGNED inside the `try`, and `loadingIndicator.show()` has moved in there
  // too. `unit` and `source` read only the arguments.
  let coverage = null;
  let expected = null;
  const unit = plotType === 'genes' ? 'genes' : 'cells';
  const source = `${settings.type}.${settings.key}`
    + (settings.column ? `.${settings.column}` : '');

  /**
   * A column measured RELATIVE to a focused cell or gene, where that entity is
   * not available -- either the dataset does not have it (the common case after
   * switching dataset with a panel still pointing at the old focus) or nothing
   * is focused yet.
   *
   * This DOES NOT THROW, and that is the point. It used to
   * `throw new Error('Focused cell not found in dataset')`, which failed the
   * whole plot load and rendered a red "Error loading data" box with
   * troubleshooting hints -- for a known, named, expected condition on a panel
   * whose actual data loaded fine. That is the same category error as the table
   * reporting "failed to read" for a column that is simply absent: a missing
   * SELECTION is not a read failure.
   *
   * Instead it yields a full-length blank series and the reason. The series
   * keeps `expected` length so every downstream length invariant holds, and its
   * values are NaN so nothing is drawn for it -- the plot renders, the
   * highlight is simply absent, and the notice says why. Which severity the
   * panel ends up at is decided by `Coverage.merge` from the SLOT this series
   * fills, not here: as a colour contributor it DESCRIBES points that are drawn
   * anyway, so the plot is complete and merely uncoloured; as an x/y/z
   * contributor it RESTRICTS, and "no cells shown" is then the truth.
   */
  const blankFocusSeries = (kind, name) => ({
    values: Array(typeof expected === 'number' ? expected : 0).fill(NaN),
    coverage: missingEntity(kind, name, { source, unit, total: expected }),
    dataType: 'numerical'
  });
  // The same for a cell located by DataManager.locateCell that cannot be read
  const blankCellSeries = (cell, name) => ({
    values: Array(typeof expected === 'number' ? expected : 0).fill(NaN),
    coverage: unreadableCell(cell || (name ? { name } : null), { source, unit, total: expected }),
    dataType: 'numerical'
  });

  try {
    // Inside the try: everything below can throw, and must be classified when
    // it does. The `finally` hides the indicator whether or not it was shown.
    if (plotContainer) {
      loadingIndicator.show(plotContainer, 'axis-data');
    }
    const entities = plotType === 'genes' ? DataManager.getGenes() : DataManager.getCells();
    expected = Array.isArray(entities) ? entities.length : null;

    const { type, key, column } = settings;
    const datasetPath = DataManager.getCurrentDataset();
    const rowsArr = null; // Filtering no longer applies

    let data, values, dataType;
    let categories = null;
    let rankOf = null;   // colour groups: category label -> rank over the whole column
    let groupNames = null;   // colour groups read without labels: each colour's legend name

    // --- Helper Functions ---
    // Returns at most maxSample elements of an array.
    function sampleArray(arr, maxSample = 100) {
      return arr.length > maxSample ? arr.slice(0, maxSample) : arr;
    }

    /**
     * Infer whether the sampled values are mostly numeric or categorical.
     * Booleans count as categorical.
     * @param {Array} arr - Array of values.
     * @returns {string} - 'numerical' or 'categorical'.
     */
    function determineDataType(arr) {
      return inferValueType(arr);
    }

    // Convert non-null booleans to strings.
    function convertBooleans(arr) {
      return arr.map(v => (v === null || v === undefined) ? v : String(v));
    }

    // Convert values to numbers when possible while preserving the array length.
    function processNumericValues(arr) {
      return arr.map(v => {
        if (v === null || v === undefined) return NaN;
        if (typeof v === 'number') return v;
        if (typeof v === 'object' && v && 'value' in v) return v.value;
        if (typeof v === 'string') {
          const parsed = parseFloat(v);
          return isNaN(parsed) ? NaN : parsed;
        }
        return NaN;
      });
    }

    // SPECIAL CASE: 'none' type (constant color).
    if (type === 'none') {
      const isGenePlot = plotType === 'genes';
      if (isGenePlot) {
        const genes = DataManager.getGenes();
        const geneCount = genes ? genes.length : 100;
        values = Array(geneCount).fill(1);
      } else {
        const cells = DataManager.getCells();
        const cellCount = cells ? cells.length : 100;
        values = Array(cellCount).fill(1);
      }
      dataType = 'constant';
      // A constant series is synthesised, not read: it covers every entity.
      return { values, type: dataType, categories, coverage: Coverage.complete(values.length, unit) };
    }

    // Common pattern for most data types.
    switch (type) {
      case 'obs':
      case 'var': {
        const loadMethod = type === 'obs' ? DataManager.loadObs : DataManager.loadVar;
        let categoriesWanted;
        if (role === 'colour') {
          // the structure says how many categories the column has
          let structure = null;
          try {
            structure = await DataManager.getDatasetStructure(datasetPath);
          } catch {
            structure = null;
          }
          const count = categoryCount(structure, type, key);
          categoriesWanted = count !== null && grouped(count) ? 'used' : 'all';
          // Past HOVER_OFF_LABELS labels the plot's hover starts off ("No
          // hover", utils/categories.js), and with the hover off a grouped
          // colour needs no label: the ranks colour it, and a few labels
          // name the legend's entries.
          const shownEntities = plotType === 'genes' ? DataManager.getGenes() : DataManager.getCells();
          const points = shownEntities && typeof shownEntities.length === 'number' ? shownEntities.length : 0;
          if (panel) {
            const off = hoverOffFor(panel.hoverOff, count, points);
            if (off === undefined) delete panel.hoverOff; else panel.hoverOff = off;
            // hover on: its labels must fit the browser (the memory guard)
            if (categoriesWanted === 'used' && !hoverIsOff(panel.hoverOff)
                && !(await hoverLabelsFit(datasetPath, type, key, count, points, plotContainer, signal))) panel.hoverOff = true;
            showHoverChoice(plotContainer, panel);
          }
          if (categoriesWanted === 'used' && panel && hoverIsOff(panel.hoverOff) && !rowsArr) {
            const r = await DataManager.loadCategoryCodes(datasetPath, key, { ranked: true, slot: type, signal });
            if (r && r.ranked && (typeof expected !== 'number' || r.codes.length === expected)) {
              values = Array.from(r.codes, c => (c === r.MISSING ? null : c));
              groupNames = await rankedGroupNames(datasetPath, key, type, r.codes, r.MISSING, signal);
              return { values, type: 'categorical', categories: null, coverage: classifyValues({ values, expected, unit, source }),
                rankOf: null, ranked: true, groupNames };
            }
          }
        }
        // Colour groups (utils/categories.js): each point's category's rank
        // over the WHOLE column, so a category's colour does not depend on
        // the cells shown (subset, part, filter) or on the panel
        const ranked = categoriesWanted === 'used'
          ? DataManager.loadCategoryCodes(datasetPath, key, { ranked: true, slot: type, signal }) : null;
        data = await loadMethod({ datasetPath, columns: [key], rows: rowsArr, categories: categoriesWanted, signal });
        // classifyColumn encodes the server's measured semantics: key ABSENT
        // means the column is not in this dataset; key present but empty on a
        // non-empty dataset means the read FAILED. Those two look identical in
        // the response body and need opposite responses from the user.
        coverage = classifyColumn({
          column: key, response: data, expected, unit, source
        });
        if (!data.data || !data.data[key] || data.data[key].length === 0) {
          console.warn(`No data found for ${type}.${key} (${coverage.worstReason})`);
          const err = new Error(coverage.lines()[0] || `No data found for column '${key}' in ${type} table`);
          err.coverage = coverage;
          throw err;
        }
        values = data.data[key];
        if (ranked) {
          const r = await ranked;
          if (r && r.ranked && r.codes.length === values.length) {
            rankOf = new Map();
            for (let i = 0; i < values.length; i++) {
              if (r.codes[i] !== r.MISSING && !rankOf.has(values[i])) rankOf.set(values[i], r.codes[i]);
            }
          }
        }
        if (data.categories && data.categories[key]) {
          dataType = 'categorical';
          categories = data.categories[key];
        } else {
          dataType = determineDataType(values);
          if (dataType === 'categorical') {
            values = convertBooleans(values);
          }
        }
        break;
      }
      case 'obsm':
      case 'varm': {
        const loadMethod = type === 'obsm' ? DataManager.loadObsm : DataManager.loadVarm;
        data = await loadMethod({
          datasetPath,
          [type === 'obsm' ? 'obsmKey' : 'varmKey']: key,
          columnName: column,
          rows: rowsArr,
          signal
        });
        if (!data.data || data.data.length === 0) {
          // Measured live: a missing obsm/varm key returns 200 with "data": [].
          // On a dataset with entities that cannot be a legitimate empty read.
          // The rule lives in `classifyMatrixColumn` rather than here, because
          // the TABLE reads this identical body and used to call it a failed
          // read -- `unavailable` (warning) beside `failed` (error) on one page.
          console.warn(`No data points received for ${type}.${key}.${column}`);
          coverage = classifyMatrixColumn({
            values: data.data, expected, unit, source, key
          });
          const err = new Error(coverage.lines()[0] || `No data points found for ${key}.${column}`);
          err.coverage = coverage;
          throw err;
        }
        values = data.data;
        dataType = 'numerical';
        break;
      }
      case 'obsp':
      case 'varp': {
        if (!key) {
          // A dataset without any obsp/varp matrix leaves the key selector
          // empty, and the request became `/data/obsp/` with no key: a 404
          // reported as "failed to read -- Not found". Nothing failed; the
          // dataset has no such matrix. Say so without asking the server, as
          // a blank series so the rest of the plot still renders.
          values = Array(typeof expected === 'number' ? expected : 0).fill(NaN);
          coverage = Coverage.missing(GAP.UNAVAILABLE,
            `this dataset has no ${type} matrices`,
            { source: type, unit, total: expected });
          dataType = 'numerical';
          break;
        }
        if (type === 'obsp') {
          // The cell's row over the cells shown; a cell the subset does not
          // show (another part, filtered out) is read by its dataset row
          const cell = await DataManager.locateCell(column);
          if (!DataManager.cellRowParams(cell)) {
            // Render the plot without the highlight; do not fail the load.
            ({ values, coverage, dataType } = blankCellSeries(cell, column));
            break;
          }
          data = await DataManager.loadObsp({ datasetPath, obspKey: key, cell, signal });
        } else {
          const focusIndex = DataManager.getGeneIndex(column);
          if (focusIndex === -1) {
            ({ values, coverage, dataType } = blankFocusSeries('gene', column));
            break;
          }
          data = await DataManager.loadVarp({ datasetPath, varpKey: key, rows: [focusIndex], signal });
        }
        if (data.data && Array.isArray(data.data) && data.data.length > 0) {
          const firstRow = data.data[0];
          values = Array.isArray(firstRow) ? firstRow : ((firstRow !== undefined && firstRow !== null) ? [firstRow] : []);
        } else {
          // Through the SHARED rule, not a hand-built verdict. The server
          // answers `200 {"data": []}` for an absent obsp/varp/layer key
          // exactly as it does for obsm -- measured against the live service --
          // so "returned nothing for the focused cell" at `error` severity
          // asserted a read failure of an existing key that the response body
          // cannot distinguish, while the table called the same body
          // "not in this dataset" at `warning`. That is B1's shape.
          console.warn(`Invalid or empty ${type} data received`);
          values = [];
          coverage = classifyMatrixColumn({
            values: data.data, expected, unit, source, key
          });
        }
        // Preserve length: map nulls/undefined to NaN.
        values = values.map(v => (v === null || v === undefined) ? NaN : v);
        const sample = sampleArray(values);
        if (sample.every(v => typeof v === 'object')) {
          values = processNumericValues(values);
          dataType = 'numerical';
        } else if (sample.every(v => typeof v === 'string')) {
          dataType = 'categorical';
        } else {
          dataType = 'numerical';
        }
        break;
      }
      case 'layer': {
        if (plotType === 'genes') {
          const cell = await DataManager.locateCell(column);
          if (!DataManager.cellRowParams(cell)) {
            ({ values, coverage, dataType } = blankCellSeries(cell, column));
            break;
          }
          data = await DataManager.loadLayer({
            datasetPath,
            layerName: key,
            cell,
            cols: null,
            signal
          });
          if (data.data && Array.isArray(data.data) && data.data.length > 0) {
            values = Array.isArray(data.data[0]) ? data.data[0] : data.data;
          } else {
            console.warn('Empty or invalid layer data received for gene plot');
            values = [];
            coverage = classifyMatrixColumn({
              values: data.data, expected, unit, source, key
            });
          }
          dataType = 'numerical';
        } else {
          const geneIndex = DataManager.getGeneIndex(column);
          if (geneIndex === -1) {
            ({ values, coverage, dataType } = blankFocusSeries('gene', column));
            break;
          }
          data = await DataManager.loadLayer({
            datasetPath,
            layerName: key,
            rows: rowsArr,
            cols: [geneIndex],
            signal
          });
          if (data.data && Array.isArray(data.data)) {
            if (data.data.length > 0) {
              if (Array.isArray(data.data[0])) {
                try {
                  values = data.data.map(row => (row[0] === undefined ? NaN : row[0]));
                } catch (e) {
                  console.error('Error extracting values from 2D array:', e);
                  values = Array(data.data.length).fill(NaN);
                }
              } else {
                values = data.data;
              }
            } else {
              console.warn('Empty layer data array received');
              values = [];
              coverage = classifyMatrixColumn({
                values: data.data, expected, unit, source, key
              });
            }
          } else {
            // Through the shared rule like every other matrix verdict. This
            // was the last hand-built one, and it was the last divergence:
            // both surfaces already agreed that a non-array body is FAILED,
            // but only the plot said WHICH format arrived. Agreement on the
            // verdict with disagreement on the sentence is still a divergence,
            // so the better sentence moved into the rule rather than the
            // weaker one being matched.
            console.warn(`Unexpected data format received: ${typeof data.data}`);
            values = [];
            coverage = classifyMatrixColumn({
              values: data.data, expected, unit, source, key
            });
          }
          if (values.length > 0) {
            const sample = sampleArray(values);
            if (sample.every(v => typeof v === 'object')) {
              values = processNumericValues(values);
            } else if (sample.every(v => typeof v === 'string')) {
              values = values.map(v => {
                if (v === null || v === undefined) return NaN;
                const parsed = parseFloat(v);
                return isNaN(parsed) ? NaN : parsed;
              });
            }
          }
          dataType = 'numerical';
        }
        break;
      }
      default:
        throw new Error(`Unknown data type: ${type}`);
    }

    // Reconcile length against the entity count even on the success path: a
    // short series is a partial read, and saying so is the point of the module.
    //
    // The classifier is chosen by MEMBER KIND, mirroring the table, which tags
    // every matrix-shaped path with `matrixKey`. An empty series extracted from
    // an obsp/varp/layer row means the same thing there as it does here, and
    // routing only SOME of these paths through the shared rule is how the
    // boundary moved rather than closed last time: the sites the fix reached
    // agreed and the ones just past it did not.
    if (!coverage) {
      const MATRIX = ['obsm', 'varm', 'obsp', 'varp', 'layer'];
      // obsp/varp/layer are sliced AT one entity (settings.column). A slice
      // that is full length and all blank means that entity is not covered by
      // the matrix, and the user needs to be told which entity and what to
      // pick instead -- see classifyFocusRow.
      const sliceKind = settings.type === 'obsp' ? 'cell'
        : settings.type === 'varp' ? 'gene'
        : settings.type === 'layer' ? (plotType === 'genes' ? 'cell' : 'gene')
        : null;
      coverage = sliceKind
        ? classifyFocusRow({
            values, expected, unit, source, key: settings.key,
            kind: sliceKind, name: settings.column, focused: !settings.locked
          })
        : MATRIX.includes(settings.type)
          ? classifyMatrixColumn({ values, expected, unit, source, key: settings.key })
          : classifyValues({ values, expected, unit, source });
    }
    return { values, type: dataType, categories, coverage, rankOf, ranked: false, groupNames };
  } catch (error) {
    // a load that was stopped is not a failed read
    if (error && error.name === 'AbortError') throw error;
    console.error('Error loading data for settings', settings, 'error:', error);
    const wrapped = new Error(`Failed to load data for (${settings.type}.${settings.key}${settings.column ? '.' + settings.column : ''}) error: ${error.message}`);
    // Carry the classification with the error so the panel can state a REASON
    // rather than only a symptom. An error raised before any classification
    // was made is classified here from the HTTP status / server reason code.
    wrapped.coverage = error.coverage
      || coverage
      || classifyError(error, { unit, source, total: expected });
    throw wrapped;
  } finally {
    // Hide loading indicator if container was provided
    if (plotContainer) {
      loadingIndicator.hide(plotContainer, 'axis-data');
    }
  }
}



/**
 * Make the automatic size and opacity follow the points actually drawn:
 * those the subset holds, less the ones the plot's own filters hide (a
 * table filter that removes the other rows, Hide NaN, Hide outliers) and
 * the ones a table link greys out (filterStats.shown).
 * @param {HTMLElement} plotContainer
 * @param {Object} settings
 * @param {number} drawn - points left after the filters
 * @param {string|number} [id] - the panel, to refresh its size and opacity boxes
 * @returns {boolean} whether size or opacity changed (markers need a restyle)
 */
export function followDrawnPoints(plotContainer, settings, drawn, id = plotContainer.__azPanelId) {
  plotContainer._drawnCount = drawn;
  const changed = applyAutoPointStyle(settings, autoPointCount(plotContainer, settings, keepsOwnMarker), pointStyleBase());
  if (changed && id !== undefined) showPointStyle(id, settings);
  return changed;
}

/**
 * Loads data for all axes and then creates the plot.
 *
 * @param {HTMLElement} container - The container element for the panel/controls.
 * @param {HTMLElement} plotContainer - The Plotly plot container element.
 * @param {Object} settings - The settings object for the plot (e.g., axes settings for x, y, z, color).
 * @param {Object} data - A mutable data cache object (e.g., { x, y, z, color, cells, ... }).
 * @param {string|number} id - A unique identifier used to build element selectors.
 * @param {boolean} isFirstLoad - Flag indicating if this is the first load of the panel.
 * @param {AbortSignal} [signal] - Optional abort signal to allow cancellation.
 *
 * @returns {Promise<void>}
 */
export async function loadDataAndCreatePlot(container, plotContainer, settings, data, id, isFirstLoad = false, signal = null) {
  // the subset dialog's load-time estimate learns from these draws
  const started = performance.now();
  // the browser memory guard's ledger: reserved before the draw, committed
  // once it is drawn, cancelled otherwise (memoryGate)
  let reserved = 0, drawn = false, overlay = false;
  try {
    // Check if operation is already aborted before doing anything
    if (signal && signal.aborted) {
      throw new DOMException('Plot creation aborted', 'AbortError');
    }
    // a load that was cancelled before has its tag until a new one starts
    setStatusTag(plotContainer, 'cancelled', null);
    
    // Determine if this is a gene or cell plot based on settings
    const isGenePlot = data.entities == 'genes'

    // A panel made while the dataset opens (within a second on a large store)
    // came here before the names did and said the dataset had none, for good.
    // Wait for them; only an opened dataset without names gets that sentence.
    if (DataManager.namesPending()) {
      loadingIndicator.show(plotContainer, 'names');
      try {
        await DataManager.whenNamesLoaded();
      } finally {
        loadingIndicator.hide(plotContainer, 'names');
      }
      if (signal && signal.aborted) {
        throw new DOMException('Plot creation aborted', 'AbortError');
      }
    }
    
    if (isGenePlot) {
      // Validate that genes exist for gene plots
      const genes = DataManager.getGenes();
      if (!genes || !genes.length) {
        drawPlaceholder(plotContainer, Coverage.missing(GAP.UNAVAILABLE,
          'this dataset reported no gene names, so there is nothing to plot against',
          { source: 'var names', unit: 'genes' }), 'genes');
        return;
      }
    } else {
      // Validate that cells exist for cell plots
      const cells = DataManager.getCells();
      if (!cells || !cells.length) {
        drawPlaceholder(plotContainer, Coverage.missing(GAP.UNAVAILABLE,
          'this dataset reported no cell names, so there is nothing to plot against',
          { source: 'obs names', unit: 'cells' }), 'cells');
        return;
      }
    }
    
    // Size and opacity the user has not set follow the number of points
    // drawn: the subset, or every cell (utils/point-style.js)
    const nPoints = (isGenePlot ? DataManager.getGenes() : DataManager.getCells()).length;
    plotContainer._pointCount = nPoints;
    plotContainer._drawnCount = nPoints;   // narrowed by the filters once the data is read (followDrawnPoints)
    plotContainer.__azPanelId = id;
    // in a zoomed view kept from the graph drawn now, the points in that view
    // (utils/view-point-style.js; checked again once the new graph is drawn)
    applyAutoPointStyle(settings, autoPointCount(plotContainer, settings, keepsOwnMarker), pointStyleBase());
    // and after every zoom or pan, once it has settled (plot-make-helper.js
    // attachViewportTracking calls it). Here, not with the controls: a panel
    // whose controls are hidden has none.
    if (plotContainer.__azFollowView) plotContainer.__azFollowView.cancel();
    plotContainer.__azFollowView = debounced(() => {
      if (!settings.autoPointSize && !settings.autoPointOpacity) return;
      if (!plotContainer._fullLayout) return;
      if (applyAutoPointStyle(settings, autoPointCount(plotContainer, settings, keepsOwnMarker), pointStyleBase())) {
        showPointStyle(id, settings);
        restyleMarkers(plotContainer, settings).catch(err => console.warn('Point size/opacity not updated:', err && err.message));
      }
    });
    showPointStyle(id, settings);
    showColorSortControl(id, settings);

    // Check again for abort signal before showing loading indicator
    if (signal && signal.aborted) {
      throw new DOMException('Plot creation aborted', 'AbortError');
    }

    // Will it fit next to the other panels? (utils/memory-guard-ui.js)
    const token = await memoryGate(plotContainer, settings, id, isGenePlot, nPoints);
    if (token === null) return;
    reserved = token;

    // Show loading indicator
    loadingIndicator.show(plotContainer, 'full-plot');
    overlay = true;

    // Validate each axis (x, y, z, color) in settings.
    for (const axis of ['x', 'y', 'z', 'color']) {
      // Skip z-axis if not used.
      if (axis === 'z' && !settings.z) continue;
      const axisSettings = settings[axis];
      if (!axisSettings) {
        throw new Error(`No settings found for ${axis} axis`);
      }
      if (!axisSettings.type) {
        drawPlaceholder(plotContainer, Coverage.missing(GAP.UNAVAILABLE,
          `no data source is selected for the ${axis}-axis`,
          { source: `${axis}-axis`, unit: data.entities || 'values' }));
        return;
      }
      
      // For 'obsm'/'varm' type, ensure key and column are provided.
      if (axisSettings.type === 'obsm' || axisSettings.type === 'varm') {
        if (!axisSettings.key || axisSettings.key === '') {
          drawPlaceholder(plotContainer, Coverage.missing(GAP.UNAVAILABLE,
            `no ${axisSettings.type} key is selected for the ${axis}-axis`,
            { source: `${axis}-axis`, unit: data.entities || 'values' }));
          return;
        }
        if (axisSettings.column === undefined || axisSettings.column === null || axisSettings.column === '') {
          // Query the global dataset structure.
          const ds = await DataManager.getDatasetStructure();
          
          // Handle both obsm and varm
          const dfCollection = axisSettings.type === 'obsm' ? ds?.obsm?.dataframes : ds?.varm?.dataframes;
          if (ds && dfCollection && dfCollection[axisSettings.key]) {
            const df = dfCollection[axisSettings.key];
            if (df.columns && df.columns.length > 0) {
              if (axis === 'x') {
                axisSettings.column = df.columns[0];
              } else if (axis === 'y') {
                axisSettings.column = df.columns.length >= 2 ? df.columns[1] : df.columns[0];
              } else if (axis === 'z') {
                axisSettings.column = df.columns.length >= 3 ? df.columns[2] : df.columns[0];
              } else if (axis === 'color') {
                axisSettings.column = df.columns.length >= 4 ? df.columns[3] : df.columns[0];
              }
            } else {
              axisSettings.column = '0';
            }
          } else {
            axisSettings.column = '0';
          }
        }
      }
    }

    // Millions of cells: typed arrays and single-colour traces (large-plot.js).
    // Its notice is cleared here and put back once a large draw succeeds.
    if (!isGenePlot) {
      const nCells = (DataManager.getCells() || []).length;
      const large = nCells > largePlotPoints();
      updateLargePlotControls(container, large, largePlotPoints());
      if (large) {
        const refusal = largePlotRefusal(settings, nCells);
        if (refusal) {
          // The regular path cannot draw this many points (the tab runs out
          // of memory). Say what is not available and keep any plot drawn.
          if (Array.isArray(plotContainer.data) && plotContainer.data.length) {
            setStatusTag(plotContainer, 'refused', { text: 'Not drawn: see why', severity: 'warning',
              title: refusal, pop: { text: refusal, actions: [['subset-regular', 'Subset\u2026']] } });
          } else {
            drawPlaceholder(plotContainer, Coverage.missing(GAP.UNAVAILABLE, refusal,
              { source: 'large-plot mode', unit: 'cells', total: nCells }), 'cells');
          }
          return;
        }
        setStatusTag(plotContainer, 'refused', null);
        await createLargePlot(plotContainer, settings, data, container, id, signal);
        drawn = true;
        recordLoad({ n: nCells, seconds: (performance.now() - started) / 1000, large: true });
        // no marker in large-plot mode, but the line that the focus is not shown
        noteFocusOutside(plotContainer, data, settings, 'cells');
        // again after the draw: panel code that ran meanwhile may have reset a toggle
        updateLargePlotControls(container, true, largePlotPoints());
        return;
      }
    }
    plotContainer.__isLarge = false;
    setStatusTag(plotContainer, 'refused', null);
    setStatusTag(plotContainer, 'large', null);
    setStatusTag(plotContainer, 'focus', null);

    // Reset cached data without changing its reference. Until this load
    // finishes, `data.generation` is null: the series are half-built, and
    // incremental updates (a table filter, a focus change) must leave them
    // alone (isPlotDataCurrent in plot-update.js).
    const generation = DataManager.getDatasetGeneration();
    // the cells these series are of: a part step keeps the generation
    const subsetKey = DataManager.getSubsetParam();
    Object.keys(data).forEach(key => delete data[key]);
    data.generation = null;
    
    // Set up the appropriate entity list (cells or genes)
    if (isGenePlot) {
      const genes = DataManager.getGenes();
      Object.assign(data, {
        x: null,
        y: null,
        z: null,
        color: null,
        genes: genes,
        entities: "genes",
        coverage: null
      });
    } else {
      const cells = DataManager.getCells();
      Object.assign(data, {
        x: null,
        y: null,
        z: null,
        color: null,
        cells: cells,
        entities: "cells",
        coverage: null
      });
    }

    // Determine the plot type for loading the appropriate data
    const plotType = isGenePlot ? 'genes' : 'cells';
    
    // Check for abort before starting data loading
    if (signal && signal.aborted) {
      throw new DOMException('Plot creation aborted before data loading', 'AbortError');
    }
    
    // Build an array of promises to load axis and color data concurrently.
    const loadPromises = [
      (async () => {
        // Check for abort signal at each async step
        if (signal && signal.aborted) {
          throw new DOMException('X axis data loading aborted', 'AbortError');
        }
        data.x = await loadAxisData(settings.x, plotType, plotContainer, { signal });
      })(),
      (async () => {
        if (signal && signal.aborted) {
          throw new DOMException('Y axis data loading aborted', 'AbortError');
        }
        data.y = await loadAxisData(settings.y, plotType, plotContainer, { signal });
      })()
    ];

    if (settings.z) {
      loadPromises.push(
        (async () => {
          if (signal && signal.aborted) {
            throw new DOMException('Z axis data loading aborted', 'AbortError');
          }
          data.z = await loadAxisData(settings.z, plotType, plotContainer, { signal });
        })()
      );
    }

    // Load color data concurrently.
    loadPromises.push(
      (async () => {
          if (signal && signal.aborted) {
            throw new DOMException('Color data loading aborted', 'AbortError');
          }
          // A colour column that cannot be read must not destroy an otherwise
          // usable plot. Before this, any failing axis rejected Promise.all and
          // the whole panel became an error box -- so a broken colour column
          // hid the perfectly good x/y scatter behind it. Draw the points, fall
          // back to a constant colour, and STATE that the colour is missing.
          let colorData;
          try {
            colorData = await loadAxisData(settings.color, plotType, plotContainer, { role: 'colour', panel: settings, signal });
          } catch (colorError) {
            if (colorError && colorError.name === 'AbortError') throw colorError;
            console.warn('Colour data unavailable; plotting uncoloured:', colorError);
            const n = (DataManager[isGenePlot ? 'getGenes' : 'getCells']() || []).length;
            // Every point is still drawn in the fallback colour, so this
            // coverage must not drag the panel's merged `shown` to zero and
            // claim no cells are on screen -- the same class of lie in the
            // opposite direction. That is what `ROLE.DESCRIBES` says, and
            // saying it lets the loader's REAL reason survive: a colour column
            // absent from the dataset now reads "not in this dataset" here
            // exactly as it does on the table, instead of being flattened to a
            // generic read failure by a hand-built substitute.
            colorData = {
              values: Array(n).fill(1),
              type: 'constant',
              categories: null,
              coverage: (colorError.coverage
                || classifyError(colorError, {
                     unit: isGenePlot ? 'genes' : 'cells',
                     source: 'colour', total: n
                   })).asDescribing()
            };
          }
          data.color = colorData.values;
          data.colorType = colorData.type;
          applyLogColor(data, settings);
          data.colorCategories = colorData.categories;
          data.colorRankOf = colorData.rankOf || null;
          data.colorRanked = !!colorData.ranked;
          data.colorGroupNames = colorData.groupNames || null;
          data.colorCoverage = colorData.coverage || null;
          // Update any color control UI in the container.
          updateColorControlsVisibility(container, data.colorType, id);
      })()
    );

    // Add table filter
    loadPromises.push(
      (async () => {
        if (signal && signal.aborted) {
          throw new DOMException('Table entities data loading aborted', 'AbortError');
        }
        await updateTableEntities(data, settings, plotContainer);
      })()
    );

    try {
      // Wait until all data is loaded or one of them is aborted
      await Promise.all(loadPromises).catch(error => {
        // If this is an abort error, capture it but don't throw yet
        // This prevents multiple abort errors from cascading
        if (error.name === 'AbortError') {
          console.debug('Data loading aborted in one of the load promises');
          // Mark signal as aborted if it wasn't already
          if (signal && !signal.aborted && signal.abort) {
            signal.abort();
          }
        } else {
          // For non-abort errors, rethrow immediately
          throw error;
        }
      });
      
      // Single check for abortion after all promises complete or fail
      if (signal && signal.aborted) {
        throw new DOMException('Plot creation aborted', 'AbortError');
      }
      // The dataset changed while this load was in flight: its series belong
      // to the previous dataset. Drop them; the load started for the new
      // dataset draws the plot.
      if (DataManager.getDatasetGeneration() !== generation) {
        throw new DOMException('Plot data is from a previous dataset', 'AbortError');
      }
    } catch (error) {
      // For abort errors, make sure we only throw a standardized error
      if (error.name === 'AbortError') {
        throw new DOMException('Plot creation aborted', 'AbortError');
      } else {
        // For other errors, rethrow as-is
        throw error;
      }
    }

    // Combine every series' coverage into the panel's. A series whose loader
    // returned no coverage becomes UNREPORTED here rather than disappearing --
    // that is what stops a new axis type from silently reintroducing the gap.
    const unit = isGenePlot ? 'genes' : 'cells';
    data.coverage = panelLoadCoverage(data, settings, unit);
    data.generation = generation;
    data.subsetKey = subsetKey;

    // Validate that x and y axes have data.
    if (data.x && data.x.values && data.x.values.length > 0 &&
        data.y && data.y.values && data.y.values.length > 0) {
      console.log(`Creating plot with ${data.x.values.length} data points`);
      data.hoverExtra = await loadHoverColumns(settings, isGenePlot ? 'genes' : 'cells', plotContainer, signal);
      if (signal && signal.aborted) {
        throw new DOMException('Plot creation aborted', 'AbortError');
      }
      await createPlot(container, plotContainer, settings, data, id, isFirstLoad);
      drawn = true;
      await applyHoverInfo(plotContainer, data, settings);
      await applyLogColorbar(plotContainer, data, settings);
      await sortTracesByColor(plotContainer, settings);
      updateColorControlsVisibility(container, data.colorType, id);
      if (!isGenePlot) recordLoad({ n: data.x.values.length, seconds: (performance.now() - started) / 1000 });
    } else {
      console.error('Insufficient data for plotting');
      const nx = data.x && data.x.values ? data.x.values.length : 0;
      const ny = data.y && data.y.values ? data.y.values.length : 0;
      // Say WHICH axis is empty and WHY, not just that the plot is empty.
      let cov = data.coverage;
      if (nx === 0) cov = cov.withGap(GAP.EMPTY, 'the x-axis series has no values', 'x-axis');
      if (ny === 0) cov = cov.withGap(GAP.EMPTY, 'the y-axis series has no values', 'y-axis');
      drawPlaceholder(plotContainer, cov, unit);
    }
  } catch (error) {
    if (error && error.name === 'AllocationProbeError') {
      // the browser could not hold the plot's buffers (utils/alloc-probe.js):
      // nothing was requested; the panel says so and offers a subset
      console.warn(error.message);
      showProbeFailure(plotContainer, error);
    } else if (error && error.name === 'AbortError') {
      // Skip error display for abort errors - they're expected during cancellation
      if (window.Config && window.Config.DEBUG_MODE) {
        console.debug('Plot loading was aborted:', error.message);
      }
    } else {
      console.error('Error loading plot data:', error);

      // clear data
      plotContainer.data = [];
      
      // Create a more detailed error message
      // `suggestedActions` used to live here too. Its only writer was the
      // focused-cell arm below, which no longer exists, so it was left always
      // empty and still concatenated into the hint markup -- an inert branch in
      // a change whose whole subject is inert branches.
      let errorDetails = '';
      
      // Check if the error is related to a specific axis
      if (error.message && error.message.includes('Failed to load data for')) {
        // Extract the axis information
        const axisInfo = error.message.match(/\((.*?)\)/);
        if (axisInfo && axisInfo[1]) {
          const [type, key, column] = axisInfo[1].split('.');
          
          // Create a more user-friendly error message
          if (type && key) {
            errorDetails = `<br><br><strong>Failed data:</strong> ${type} "${key}"`;
            if (column) {
              errorDetails += `, column "${column}"`;
            }
            
            // Add potential solutions based on the error type
            errorDetails += '<br><br><strong>Possible solutions:</strong><ul>';
            
            if (type === 'layer') {
              errorDetails += '<li>Check if the selected layer exists in the dataset</li>';
              errorDetails += '<li>Verify that the specified cell/gene is valid</li>';
            } else if (type === 'obsm' || type === 'varm') {
              errorDetails += '<li>Check if the embedding or reduction exists</li>';
              errorDetails += '<li>Verify that the column index or name is valid</li>';
            } else if (type === 'obsp' || type === 'varp') {
              // Reaching here now means the MATRIX itself could not be read.
              // An absent or unfocused cell/gene no longer arrives as an error
              // at all -- it renders the plot and states itself in the coverage
              // notice -- so the advice that used to live here ("ensure a
              // cell/gene is focused", plus a block keyed on the message
              // "Focused cell not found") described a failure this code no
              // longer produces, and pointed at a matrix that had loaded fine.
              // Stale advice on a real failure is worse than none: it sends the
              // reader to the wrong question.
              errorDetails += '<li>Check if the connectivity matrix exists in this dataset</li>';
              errorDetails += '<li>Check the server log for a read error on this key</li>';
            } else if (type === 'obs' || type === 'var') {
              errorDetails += '<li>Check if the column name exists in the obs/var table</li>';
            }
            
            errorDetails += '</ul>';
          }
        }
      }
      
      // Only update the UI for actual errors, not abort errors.
      // The classification carried on the error says WHY; the existing
      // troubleshooting hints are kept underneath it as the "what to do next".
      const unit = data && data.entities === 'genes' ? 'genes' : 'cells';
      drawPlaceholder(
        plotContainer,
        error.coverage || Coverage.missing(GAP.FAILED, error.message || 'unknown error',
          { source: 'plot data', unit }),
        unit
      );
      if (errorDetails) {
        const extra = document.createElement('div');
        extra.className = 'coverage-placeholder__hints';
        extra.innerHTML = errorDetails;
        plotContainer.appendChild(extra);
      }
    }
  } finally {
    // Always hide the loading indicator in the finally block to ensure it happens
    // regardless of success, error or abortion; once, and only if this load
    // showed it: a newer load of the panel may have its own up by now
    if (overlay) loadingIndicator.hide(plotContainer, 'full-plot');
    if (reserved) {
      unmark();
      if (drawn && plotContainer.isConnected) {
        commit(id, null, reserved);
      } else {
        cancel(id, reserved);
        // drawn into a panel closed meanwhile: free it now, not at GC
        if (drawn) releasePlot(plotContainer);
      }
    }
  }
}

/**
 * The browser memory check before a plot is drawn: every way a plot is
 * drawn passes here (a new, duplicated, reopened or restored panel, a subset
 * change, a full redraw). A plot that would not fit next to what the other
 * panels hold is not drawn, and its status strip says why and what helps;
 * a plot that was being drawn when the previous page died waits for "Draw
 * anyway". With ui.memory.enforce warn it is drawn, with a warning tag.
 * @returns {Promise<number|null>} null when refused; else the draw's ledger
 *   token (0: the check failed and nothing was reserved)
 */
async function memoryGate(plotContainer, settings, id, isGenePlot, n) {
  const unit = isGenePlot ? 'genes' : 'cells';
  const large = !isGenePlot && n > largePlotPoints();
  let structure = null;
  try { structure = await DataManager.getDatasetStructure(); } catch { /* colour kind unknown: numeric, the costliest */ }
  const p = {
    id, kind: isGenePlot ? 'gene-plot' : 'cell-plot', n, large, colour: colourKind(settings, structure),
    threeD: !!settings.z,
    livePlot: !!(plotContainer._fullLayout && Array.isArray(plotContainer.data) && plotContainer.data.length)
  };
  const override = takeOverride(id);
  const crashed = override ? null : crashedDrawing(id);
  let result;
  try {
    result = drawCheck(p);
  } catch (error) {
    // the guard must never be why a plot is not drawn
    console.warn('Browser memory check failed; drawing without it', error);
    return 0;
  }
  let refusal = null;
  if (crashed) {
    refusal = { text: 'Not drawn: the tab ended last time',
      why: `The browser tab ended (most likely out of memory) while it drew this plot of ${Number(crashed.n || n).toLocaleString('en-US')} points. `
        + 'Draw it anyway, or show fewer cells first.',
      actions: [['draw-anyway', 'Draw anyway'], ['subset', 'Subset\u2026']] };
  } else if (result.verdict === 'block' && !override) {
    refusal = { text: 'Not drawn: browser memory',
      why: refusalText(result, 'Close a plot, or show fewer cells (a smaller subset).'),
      actions: [['subset', 'Subset\u2026']] };
  }
  if (refusal) {
    // no plot yet: the placeholder says it (with the way out); a plot drawn
    // before stays, and its strip says this one was not drawn
    if (!p.livePlot) {
      drawPlaceholder(plotContainer, Coverage.missing(GAP.UNAVAILABLE, refusal.why,
        { source: 'browser memory', unit, total: n }), unit, { actions: refusal.actions });
    } else {
      setStatusTag(plotContainer, 'memory', { text: refusal.text, severity: 'warning', title: refusal.why,
        pop: { text: refusal.why, actions: refusal.actions } });
    }
    return null;
  }
  setStatusTag(plotContainer, 'memory', result.verdict === 'warn'
    ? { text: 'Over the memory budget', severity: 'warning', title: result.why,
        pop: { text: refusalText(result, 'It is drawn anyway (ui.memory.enforce: warn); the tab may run out of memory.'),
          actions: [['subset', 'Subset\u2026']] } }
    : null);
  const token = reserve(id, p);
  markIfRisky(result, { panel: id, n, action: 'draw' });
  return token;
}


/**
 * Creates a Plotly plot.
 *
 * @param {HTMLElement} container - DOM element that holds the panel.
 * @param {HTMLElement} plotContainer - DOM element that holds the plot.
 * @param {Object} settings - Object with plot configuration (axes, colors, palettes, etc).
 * @param {Object} data - Data object containing x, y (and optionally z), cells/genes, color, etc.
 * @param {string|number} id - An identifier used to connect the plot to UI controls.
 * @param {boolean} isFirstLoad - Flag indicating if this is the first load of the panel.
 *
 * @returns {Promise<void>}
 */
/**
 * Create a filter mask and statistics for data points based on various criteria
 * 
 * @param {Object} data - Data object containing all data values
 * @param {Object} settings - Plot settings
 * @returns {Object} - Object containing indexMask and filter statistics
 */
/**
 * A cell panel's coverage with the cells the subset (or its part) does not
 * show counted in: the total becomes the dataset's, as in the header's
 * "Cells: 50 of 200", and one reason says where the rest are.
 * @param {Coverage} coverage
 * @param {string} [unit]  'cells' (the default) or 'genes', which no subset limits
 * @returns {Coverage}
 */
export function withSubsetCoverage(coverage, unit = 'cells') {
  if (unit !== 'cells') return coverage;
  return coverage.withOutside(DataManager.getCellsNotInSubset(), outsideDetail(DataManager.getSubset()));
}

/**
 * The panel's LOAD coverage, assembled from the series CURRENTLY IN `data`.
 *
 * This is a function, and exported, for one reason: `data.coverage` used to be
 * written at exactly one place -- the full render -- while `data[axis]` is
 * replaced without it on the incremental paths (`plot-update.js`'s
 * `refocusAxisOnEntity`, `listeners.js`'s axis dropdown). So on every
 * incremental render `data.coverage` described the PREVIOUS x while `data.x`
 * held the new one, and anything reading the two together was comparing a
 * series against a statement about a different series.
 *
 * That was not hypothetical. It made the suppression in `classifyFilterStats`
 * delete a filter line on the strength of the FRESH axis while the sentence
 * that was supposed to replace it came from the STALE panel value, which did
 * not carry it -- so picking an unfocused `obsp` column on x produced the
 * headline "No cells shown (of 200)" and NO reason at all, while the loader
 * had produced a perfectly good one. Silence, which is the defect this whole
 * module exists to end.
 *
 * Both paths now call this for x/y/z, so those cannot drift again.
 *
 * `colorCoverage` had the same one-writer/two-readers shape until
 * `loadColorDataAndUpdatePlot` (the incremental colour path: colour dropdown,
 * colour refocus) started writing it too (settylab/annzarro#40). Before that,
 * after switching to a healthy colour column the panel still announced the
 * OLD column's failure, and a refocus onto an entity the colour matrix does
 * not cover left the plot grey with no reason given.
 *
 * @param {Object} data  The panel's data object; reads `x`/`y`/`z`.coverage
 *   and `colorCoverage`.
 * @param {Object} settings  Reads `z` (present or not) and `color.type`.
 * @param {string} unit  'cells' | 'genes'.
 * @returns {Coverage}
 */
export function panelLoadCoverage(data, settings, unit) {
  const axisCoverages = ['x', 'y', 'z'].map(axis => {
    if (axis === 'z' && !settings.z) return null;
    const series = data[axis];
    if (!series) return null;
    return series.coverage || Coverage.unreported(unit);
  }).filter(Boolean);
  if (settings.color && settings.color.type && settings.color.type !== 'none') {
    // Colour DESCRIBES the points; it does not decide which of them Plotly
    // draws. A short or failed colour array drops no points, so its `shown`
    // must not enter the panel's minimum. See ROLE in utils/coverage.js.
    axisCoverages.push((data.colorCoverage || Coverage.unreported(unit)).asDescribing());
  }
  return Coverage.merge(axisCoverages, unit);
}

/**
 * Axis ranges that do not move when Hide NaN / Hide Outliers drop points.
 *
 * Those options REMOVE points, and Plotly's autorange then fitted the axes
 * to what was left, so toggling Hide Outliers zoomed the plot. While either
 * is on, the 2D axes are pinned to the extent of ALL points (with Plotly-
 * like 5% padding); with both off, autorange is back.
 *
 * A zoom or pan the user chose comes first: the axes stay where the user put
 * them. Returning autorange here reset that view on every recolour.
 * @param {Object} data - plot data (x.values, y.values)
 * @param {Object} settings
 * @returns {Object|null} relayout keys, or null for 3D plots
 */
export function stableAxisRanges(data, settings) {
  if (settings.z) return null;
  const kept = keptViewRanges(settings);
  if (kept) return kept;
  if (!(settings.hideNaN || settings.hideOutliers)) {
    return { 'xaxis.autorange': true, 'yaxis.autorange': true };
  }
  const extent = (values) => {
    let lo = Infinity, hi = -Infinity;
    for (const v of values || []) {
      if (typeof v === 'number' && Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
    }
    if (lo === Infinity) return null;
    const pad = hi > lo ? (hi - lo) * 0.05 : (Math.abs(lo) * 0.05 || 0.5);
    return [lo - pad, hi + pad];
  };
  const out = {};
  const x = extent(data.x && data.x.values);
  const y = extent(data.y && data.y.values);
  if (x) out['xaxis.range'] = x;
  if (y) out['yaxis.range'] = y;
  return Object.keys(out).length ? out : null;
}

/**
 * Hover labels: the configured hoverInfo columns, numbers to 4 significant
 * digits.
 *
 * `hoverInfo` ([{type, key, column?}], saved in configs and links) was never
 * read: every trace had a hard-coded name / x / y / c template, and c came
 * out raw (3.347795285435495e-8). Now each data trace gets one template
 * (x, y, z and colour as %{..:.4~g}, the category for categorical traces)
 * plus a per-point `hovertext` with the hoverInfo columns. Points are matched
 * to rows by their name (trace.text), so any trace split works.
 */
export async function loadHoverColumns(settings, plotType, plotContainer = null, signal = null) {
  const wanted = (Array.isArray(settings.hoverInfo) ? settings.hoverInfo : [])
    .filter(h => h && h.type && h.key && h.key !== '_index');
  const out = [];
  const datasetPath = DataManager.getCurrentDataset();
  const structure = wanted.length ? await DataManager.getDatasetStructure(datasetPath).catch(() => null) : null;
  const shown = plotType === 'genes' ? DataManager.getGenes() : DataManager.getCells();
  const points = shown && typeof shown.length === 'number' ? shown.length : 0;
  for (const h of wanted) {
    // a categorical column's labels: only if they fit the browser
    const count = (h.type === 'obs' || h.type === 'var') && !h.column ? categoryCount(structure, h.type, h.key) : null;
    if (count !== null && !(await hoverLabelsFit(datasetPath, h.type, h.key, count, points, plotContainer, signal))) continue;
    try {
      const loaded = await loadAxisData({ type: h.type, key: h.key, column: h.column || '' }, plotType, null, { signal });
      if (loaded && Array.isArray(loaded.values)) {
        out.push({ label: h.column ? `${h.key}.${h.column}` : h.key, values: loaded.values });
      }
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      console.warn(`Hover column ${h.type}.${h.key} not loaded:`, err && err.message);
    }
  }
  return out;
}

export function formatHoverValue(v) {
  if (v === null || v === undefined) return 'NA';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 'NA';
    return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(4)));
  }
  return String(v);
}

export function hoverTemplateFor(trace, settings, data) {
  let t = '%{text}<br>x: %{x:.4~g}<br>y: %{y:.4~g}';
  if (settings.z) t += '<br>z: %{z:.4~g}';
  if (trace.marker && Array.isArray(trace.marker.color) && trace.marker.colorscale !== undefined) {
    t += data.colorLog ? '<br>log10 c: %{marker.color:.4~g}' : '<br>c: %{marker.color:.4~g}';
  } else if (Array.isArray(trace._azLabels)) {
    // a colour group's trace (many categories): each point's category is in hovertext
    return t + '%{hovertext}<extra></extra>';
  } else if (data.colorType === 'categorical' && trace.name && trace.name !== 'Not in table') {
    t += `<br>${trace.name}`;
  }
  if (data.hoverExtra && data.hoverExtra.length) t += '%{hovertext}';
  return t + '<extra></extra>';
}

function sameHovertext(a, b) {
  if (a === null) return b === undefined || b === null;
  if (!Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export async function applyHoverInfo(plotContainer, data, settings) {
  if (!plotContainer || !Array.isArray(plotContainer.data) || typeof Plotly === 'undefined') return;
  const names = data[data.entities] || [];
  const extra = data.hoverExtra || [];
  const rowOf = extra.length ? new Map(names.map((n, i) => [n, i])) : null;
  const templates = [], hovertexts = [], hoverinfos = [], indices = [];
  plotContainer.data.forEach((trace, i) => {
    if (!trace || !Array.isArray(trace.text) || (typeof trace.name === 'string' && trace.name.includes('Focused'))) return;
    // "No hover" (settings.hoverOff): no label, the click still focuses. A
    // hovertemplate overrides hoverinfo, so it is emptied too.
    const off = hoverIsOff(settings.hoverOff);
    const template = off ? '' : hoverTemplateFor(trace, settings, data);
    const hoverinfo = off ? 'none' : 'all';
    const labels = Array.isArray(trace._azLabels) ? trace._azLabels : null;
    const hovertext = rowOf || labels ? trace.text.map((name, j) => {
      const r = rowOf ? rowOf.get(name) : undefined;
      const own = labels ? `<br>${labels[j]}` : '';
      return own + (r === undefined ? '' : extra.map(e => `<br>${e.label}: ${formatHoverValue(e.values[r])}`).join(''));
    }) : null;
    // A restyle recomputes the whole figure (1.3 s at 1M points with a
    // colour each): only traces whose hover changes are restyled.
    if (template === (trace.hovertemplate || '') && hoverinfo === (trace.hoverinfo || 'all')
        && sameHovertext(hovertext, trace.hovertext)) return;
    indices.push(i);
    templates.push(template);
    hovertexts.push(hovertext);
    hoverinfos.push(hoverinfo);
  });
  if (!indices.length) return;
  const update = { hovertemplate: templates, hoverinfo: hoverinfos };
  if (hovertexts.some(h => h !== null)) update.hovertext = hovertexts.map((h, k) => h || plotContainer.data[indices[k]].hovertext || null);
  try {
    await Plotly.restyle(plotContainer, update, indices);
  } catch (err) {
    console.warn('Hover labels not updated:', err && err.message);
  }
}

/**
 * Draw the strongest colour values on top.
 *
 * scattergl draws points in array order, so in a dense core a few large
 * values were buried under hundreds of small ones. For continuously
 * coloured traces the point arrays are reordered weakest first (missing
 * values first, so they sit at the bottom): the top end of the colour bar
 * last, i.e. by |colour| on a centred or diverging map and by position on
 * the bar on any other (utils/color-scales.js strongOnTopKey). On by default;
 * settings.sortByColor = false keeps data order.
 *
 * Incremental updates write arrays in DATA order, so updatePlotElements
 * calls unsortTraces first and sortTracesByColor last; the permutation lives
 * on the trace (_azOrder) only in between.
 */
const SORTED_ATTRS = ['x', 'y', 'z', 'text', 'customdata', 'hovertext', 'marker.color'];

function _get(trace, attr) {
  return attr === 'marker.color' ? (trace.marker && trace.marker.color) : trace[attr];
}

function _permuted(trace, order) {
  const n = order.length;
  const update = {};
  for (const attr of SORTED_ATTRS) {
    const arr = _get(trace, attr);
    if (!Array.isArray(arr) || arr.length !== n) continue;
    const out = [];
    for (let k = 0; k < n; k++) out.push(arr[order[k]]);
    update[attr] = [out];
  }
  return update;
}

/**
 * Point indexes by key ascending (|colour| by default; Strong on top passes
 * colorSortKey's), missing values and non-finite keys first, ties in index
 * order. A comparison sort took 120-310 ms at 1M points; this is a stable
 * radix sort of the keys as float64 bits (for keys >= 0 the bit patterns
 * sort as the numbers do), 16 bits per pass, a pass skipped when all points
 * share its digit (the low bits of float32 data are zero). A key below 0
 * falls back to a comparison sort.
 */
export function colorSortOrder(colors, key = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.abs(v) : -Infinity)) {
  const n = colors.length;
  const keys = new Float64Array(n);
  const words = new Uint32Array(keys.buffer);   // little endian: low word at 2i
  const has = new Uint8Array(n);
  let src = new Uint32Array(n);
  let missing = 0;
  for (let i = 0; i < n; i++) {
    const k = key(colors[i]);
    if (Number.isFinite(k)) {
      if (k < 0) return _comparisonSortOrder(colors, key);
      keys[i] = k + 0;      // -0 sorts as 0
      has[i] = 1;
    } else src[missing++] = i;
  }
  const order = new Array(n).fill(0);
  for (let k = 0; k < missing; k++) order[k] = src[k];
  let m = 0;
  for (let i = 0, k = missing; i < n; i++) {
    if (has[i]) src[k + m++] = i;
  }
  src = src.subarray(missing);
  let dst = new Uint32Array(m);
  const count = new Uint32Array(65537);
  for (let pass = 0; pass < 4; pass++) {
    const word = pass >> 1, shift = (pass & 1) * 16;
    count.fill(0);
    for (let k = 0; k < m; k++) count[((words[2 * src[k] + word] >>> shift) & 0xffff) + 1]++;
    if (count.some(c => c === m)) continue;
    for (let d = 0; d < 65536; d++) count[d + 1] += count[d];
    for (let k = 0; k < m; k++) {
      const i = src[k];
      dst[count[(words[2 * i + word] >>> shift) & 0xffff]++] = i;
    }
    const t = src; src = dst; dst = t;
  }
  for (let k = 0; k < m; k++) order[missing + k] = src[k];
  return order;
}

function _comparisonSortOrder(colors, key) {
  const keys = colors.map(key);
  return colors.map((_, i) => i).sort((a, b) => keys[a] - keys[b] || a - b);
}

/**
 * Strong on top's key for these colour values under the panel's settings
 * (utils/color-scales.js strongOnTopKey): the drawn range is the set
 * Min/Max, else the values' own.
 */
export function colorSortKey(colors, settings, trace = null) {
  let min = settings.colorMin, max = settings.colorMax;
  if (min == null || max == null) {
    let lo = Infinity, hi = -Infinity;
    for (const v of colors) if (typeof v === 'number' && Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (min == null) min = lo;
    if (max == null) max = hi;
  }
  // the map as the trace draws it, else as the settings name it
  const m = (trace && trace.marker) || {};
  const scale = typeof m.colorscale === 'string' ? m.colorscale : settings.colorScale;
  return strongOnTopKey({ scale, centred: !!settings.centeringActive, min, max });
}

/**
 * Whether strong-on-top reorders points: on (the default) in a 2D plot. In
 * 3D depth decides which points are in front, so the sort means nothing
 * there and is skipped; settings.sortByColor is kept for 2D.
 */
export function colorSortApplies(settings) {
  return !!settings && settings.sortByColor !== false && !settings.z;
}

export async function sortTracesByColor(gd, settings) {
  if (!gd || !Array.isArray(gd.data) || !colorSortApplies(settings) || typeof Plotly === 'undefined') return;
  for (let i = 0; i < gd.data.length; i++) {
    const t = gd.data[i];
    if (t && t.type === 'scatter3d') continue;
    const colors = t && t.marker && t.marker.color;
    if (!Array.isArray(colors) || t.marker.colorscale === undefined || t._azOrder) continue;
    const order = colorSortOrder(colors, colorSortKey(colors, settings, t));
    if (order.every((v, k) => v === k)) continue;
    try {
      await Plotly.restyle(gd, _permuted(t, order), [i]);
      gd.data[i]._azOrder = order;
    } catch (err) {
      console.warn('Colour sort skipped:', err && err.message);
    }
  }
}

export async function unsortTraces(gd) {
  if (!gd || !Array.isArray(gd.data) || typeof Plotly === 'undefined') return;
  for (let i = 0; i < gd.data.length; i++) {
    const t = gd.data[i];
    if (!t || !t._azOrder) continue;
    const order = t._azOrder;
    const inverse = new Array(order.length);
    order.forEach((orig, pos) => { inverse[orig] = pos; });
    delete t._azOrder;
    try {
      await Plotly.restyle(gd, _permuted(t, inverse), [i]);
    } catch (err) {
      console.warn('Colour unsort skipped:', err && err.message);
    }
  }
}

/**
 * Log colour scale (settings.color.log, floor settings.color.logFloor): the
 * colour values are replaced by log10(max(v, floor)), the raw ones kept in
 * data.colorRaw, and the colour bar is labelled in original units.
 */
export function applyLogColor(data, settings) {
  data.colorLog = null;
  if (!settings.color || !settings.color.log || data.colorType !== 'numerical' || !Array.isArray(data.color)) return;
  data.colorRaw = data.color;
  const { values, floor } = logColorValues(data.color, settings.color.logFloor ?? null);
  data.color = values;
  data.colorLog = { floor };
}

export async function applyLogColorbar(gd, data, settings) {
  if (!gd || !Array.isArray(gd.data) || typeof Plotly === 'undefined') return;
  const idx = gd.data.findIndex(t => t && t.marker && Array.isArray(t.marker.color) && t.marker.colorscale !== undefined);
  if (idx < 0) return;
  const update = {};
  if (data.colorLog) {
    // over the drawn range: the set Min/Max, else the data's
    let lo = settings.colorMin, hi = settings.colorMax;
    if (lo == null || hi == null) {
      const finite = data.color.filter(v => Number.isFinite(v));
      if (lo == null) lo = finite.length ? arrayMin(finite) : NaN;
      if (hi == null) hi = finite.length ? arrayMax(finite) : NaN;
    }
    const ticks = logColorbarTicks(lo, hi);
    update['marker.colorbar.tickvals'] = [ticks ? ticks.tickvals : null];
    update['marker.colorbar.ticktext'] = [ticks ? ticks.ticktext : null];
  } else {
    update['marker.colorbar.tickvals'] = [null];
    update['marker.colorbar.ticktext'] = [null];
  }
  try {
    await Plotly.restyle(gd, update, [idx]);
  } catch (err) {
    console.warn('Log colour bar not updated:', err && err.message);
  }
}

export function createFilterMask(data, settings) {
  // Initialize filter statistics
  const filterStats = {
    xNaN: 0,
    yNaN: 0,
    zNaN: 0,
    colorNaN: 0,
    colorOutliers: 0,
    tableFiltered: 0,
    total: data.x?.values?.length || 0,
    filtered: 0,
    hideNaNActive: settings.hideNaN === true,
    hideOutliersActive: settings.hideOutliers === true,
    tableFilterActive: settings.tableFilter && settings.tableFilter !== 'none',
    // Cells of the dataset that were never loaded: outside the cell subset
    notInSubset: data.entities === 'cells' ? DataManager.getCellsNotInSubset() : 0
  };

  const totalPts = data.x.values.length;
  if (totalPts === 0) return { indexMask: null, filterStats };

  // 1. Build per-axis masks & NaN-counts (loops: at 1M points the
  // map/filter/every closures were 50 ms of a recolour)
  const validMask = (values) => {
    const mask = new Array(values.length);
    let bad = 0;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      const ok = v != null && !isNaN(v);
      mask[i] = ok;
      if (!ok) bad++;
    }
    return { mask, bad };
  };
  const xValid = validMask(data.x.values);
  const xMask = xValid.mask;
  filterStats.xNaN = xValid.bad;

  const yValid = validMask(data.y.values);
  const yMask = yValid.mask;
  filterStats.yNaN = yValid.bad;

  let zMask = null;
  if (settings.z && data.z?.values) {
    const zValid = validMask(data.z.values);
    zMask = zValid.mask;
    filterStats.zNaN = zValid.bad;
  }

  // Table filtering uses pre-populated tableEntities and tableFilterMask
  const hasTableFilter = settings.tableFilter && settings.tableFilter !== 'none';
  const tableEntities = data.tableEntities;
  
  // Calculate table filtering statistics
  if (hasTableFilter && tableEntities) {
    if (settings.removeNonTableEntries) {
      const entityType = data.entities; // 'cells' or 'genes'
      // Calculate how many entities are not in the table when we want to remove them
      const nonTableCount = data[entityType].filter(entity => !tableEntities.has(entity)).length;
      filterStats.tableFiltered = nonTableCount;
    } else {
      // Don't count as filtered since they're just grayed out, not removed
      filterStats.tableFiltered = 0;
    }
  } else {
    filterStats.tableFiltered = 0;
  }
  
  // tableFilterMask is now created and managed in updateTableEntities function
  const tableFilterMask = data.tableFilterMask;

  // 4. Build color masks & stats (for numerical coloring)
  let colorValidMask = null;
  let colorRangeMask = null;

  if (data.colorType === 'numerical' && Array.isArray(data.color)) {
    // If table filtering is active, we only apply outlier filtering to table entities
    const applyToAll = !hasTableFilter || !tableEntities;
    
    // a) "valid number" mask - count NaNs for statistics
    if (settings.hideNaN) {
      if (applyToAll) {
        // Apply to all data points
        colorValidMask = data.color.map(v => v != null && !isNaN(v));
      } else {
        // Apply only to table entities
        colorValidMask = Array(totalPts).fill(true);
        
        // Mark NaN values within table entities as false
        data[data.entities].forEach((entity, i) => {
          if (tableEntities.has(entity)) {
            if (data.color[i] == null || isNaN(data.color[i])) {
              colorValidMask[i] = false;
            }
          }
        });
      }
      
      // Count what the mask REMOVES, not every NaN in the array. With a table
      // filter the mask only applies to table entities, and counting the
      // whole array printed "2 filtered out" under "5 of 6 shown"
      // (settylab/annzarro#37).
      filterStats.colorNaN = colorValidMask.filter(keep => !keep).length;
    }

    // b) "in-range" mask for outliers
    if (settings.hideOutliers) {
      const numericVals = data.color.filter(v => !isNaN(v));
      const cmin = settings.colorMin ?? arrayMin(numericVals);
      const cmax = settings.colorMax ?? arrayMax(numericVals);

      if (applyToAll) {
        // Apply to all data points
        colorRangeMask = data.color.map(v =>
          v == null        // always keep null
          || isNaN(v)      // always keep NaN
          || (v >= cmin && v <= cmax)
        );
      } else {
        // Apply only to table entities
        colorRangeMask = Array(totalPts).fill(true);
        
        // Mark outliers within table entities as false
        data[data.entities].forEach((entity, i) => {
          if (tableEntities.has(entity)) {
            const v = data.color[i];
            if (v != null && !isNaN(v) && (v < cmin || v > cmax)) {
              colorRangeMask[i] = false;
            }
          }
        });
      }
      
      // Count what the mask removes; see colorNaN above.
      filterStats.colorOutliers = colorRangeMask.filter(keep => !keep).length;
    }
  }

  // Categorical colour: Hide NaN hides points with no category. It used to
  // act on numerical colours only, so on a categorical colour it did nothing.
  // Without Hide NaN those points are drawn under NA (processCategories).
  if (data.colorType === 'categorical' && Array.isArray(data.color) && settings.hideNaN) {
    const applyToAll = !hasTableFilter || !tableEntities;
    colorValidMask = data.color.map((v, i) =>
      !isMissingCategory(v) || (!applyToAll && !tableEntities.has(data[data.entities][i])));
    // What the mask removes, as for numerical colours (settylab/annzarro#37).
    filterStats.colorNaN = colorValidMask.filter(keep => !keep).length;
  }

  // 5. Gather only the masks we need for explicit filtering
  const masks = [xMask, yMask];
  if (zMask) masks.push(zMask);
  
  // Only apply these filters if the corresponding settings are enabled
  if (colorValidMask && settings.hideNaN) masks.push(colorValidMask);
  if (colorRangeMask && settings.hideOutliers) masks.push(colorRangeMask);
  if (tableFilterMask && settings.removeNonTableEntries) masks.push(tableFilterMask);

  // 6. Build the final indexMask
  // (a point passes when every mask has it)
  const indexMask = new Array(totalPts);
  let kept = 0;
  let shown = 0;   // kept, and not greyed out by a table link: what the automatic point style counts
  for (let i = 0; i < totalPts; i++) {
    let keep = true;
    for (let m = 0; m < masks.length && keep; m++) keep = !!masks[m][i];
    indexMask[i] = keep;
    if (keep) {
      kept++;
      if (!tableFilterMask || tableFilterMask[i]) shown++;
    }
  }
  filterStats.shown = shown;

  // 7. Compute filtered count
  filterStats.filtered = totalPts - kept;

  // 8. Each hidden point once, under the first reason that applies, so the
  // reasons the panel names add up to `filtered` (classifyFilterStats)
  const only = { coords: 0, table: 0, nan: 0, outliers: 0 };
  const table = tableFilterMask && settings.removeNonTableEntries ? tableFilterMask : null;
  const nan = colorValidMask && settings.hideNaN ? colorValidMask : null;
  const outliers = colorRangeMask && settings.hideOutliers ? colorRangeMask : null;
  for (let i = 0; i < totalPts; i++) {
    if (indexMask[i]) continue;
    if (!xMask[i] || !yMask[i] || (zMask && !zMask[i])) only.coords++;
    else if (table && !table[i]) only.table++;
    else if (nan && !nan[i]) only.nan++;
    else if (outliers && !outliers[i]) only.outliers++;
  }
  filterStats.exclusive = only;

  return { indexMask, filterStats };
}

/**
 * Updates the table entities Set in the data object based on the current table selection
 * Also creates tableFilterMask for filtering operations
 * 
 * A CLOSED table's filter is applied by name (utils/closed-table.js): its
 * row indexes belong to the cells it was closed on. Cells it never had are
 * not shown, and the plot's status line says the filter is out of date.
 *
 * @param {Object} data - Data object to update with tableEntities
 * @param {Object} settings - Plot settings containing tableFilter
 * @param {HTMLElement} [plotContainer] - where to say a closed table's filter is out of date
 * @returns {Promise<boolean>} - Promise resolving to true if tableEntities changed, false otherwise
 */
export async function updateTableEntities(data, settings, plotContainer = null) {
  // Check if table filtering is active
  const hasTableFilter = settings.tableFilter && settings.tableFilter !== 'none';
  const stale = (s) => {
    data.tableFilterStale = s;
    if (plotContainer) {
      setStatusTag(plotContainer, 'table-stale', s ? { text: 'Table filter out of date', severity: 'warning', title: s.text,
        pop: { text: s.text, actions: [['reopen-table', 'Reopen table'], ['table-filter-off', 'Stop filtering']] } } : null);
    }
  };
  
  // If no table filter is active, remove any existing tableEntities and tableFilterMask
  if (!hasTableFilter) {
    stale(null);
    // Always treat switching to "none" as a change that needs visual update
    if (data.tableEntities || data.tableFilterMask) {
      delete data.tableEntities;
      delete data.tableFilterMask;
      return true; // Indicate that we changed the data
    } else {
      return true; // Still indicate a change to force visual update
    }
  }
  
  // Save current state for comparison
  const currentTableEntities = data.tableEntities;
  
  // Try to get the table panel from PanelManager
  const tablePanel = window.PanelManager && window.PanelManager.getPanel(settings.tableFilter);
  if (!tablePanel) {
    console.warn(`Table panel ${settings.tableFilter} not found`);
    return false;
  }
  
  // Get the table settings which contains currentEntries property
  const tableConfig = tablePanel.getConfig && tablePanel.getConfig();
  if (!tableConfig || !Array.isArray(tableConfig.currentEntries)) {
    console.warn("Table has no current entries configuration");
    return false;
  }
  
  // Create a new Set of table entities
  let newTableEntities = new Set();
  const entityType = data.entities; // 'cells' or 'genes'
  const entities = entityType === 'cells' ? DataManager.getCells() : DataManager.getGenes();
  const closed = !!(window.PanelManager && window.PanelManager.getActivePanels
    && !window.PanelManager.getActivePanels().includes(tablePanel));

  if (closed) {
    // by name, on the cells shown now
    const { passing, unknown } = selectionOnCells(tableConfig.closedSelection || null, data[entityType] || []);
    newTableEntities = passing;
    const name = (tablePanel.getTitle && tablePanel.getTitle()) || settings.tableFilter;
    stale(unknown > 0 ? { table: settings.tableFilter, unknown, text: staleText(name, unknown, entityType) } : null);
  } else {
    stale(null);
    // Get entity names based on indices in the table
    tableConfig.currentEntries.forEach(index => {
      if (entities && index < entities.length) {
        const entityName = entities[index];
        if (entityName) {
          newTableEntities.add(entityName);
        }
      }
    });
  }
  
  // Compare with existing tableEntities to see if they've changed
  let changed = false;
  if (!currentTableEntities || tableSetsDiffer(currentTableEntities, newTableEntities)) {
    // Store the new Set in the data object
    data.tableEntities = newTableEntities;
    
    // Also create a tableFilterMask for filtering operations
    const entities = data[entityType];
    if (entities && entities.length > 0) {
      // Create a boolean mask that includes only entities present in the table
      data.tableFilterMask = entities.map(entity => newTableEntities.has(entity));
    } else {
      data.tableFilterMask = null;
    }
    
    changed = true;
  }
  
  return changed;
}

/**
 * Helper function to compare two Sets
 * @private
 */
function tableSetsDiffer(set1, set2) {
  // Check if sizes differ first (quick check)
  if (set1.size !== set2.size) return true;
  
  // Compare contents
  for (const item of set1) {
    if (!set2.has(item)) return true;
  }
  
  return false;
}

/**
 * Apply a filter mask to data
 * 
 * @param {Object} data - Data object containing all data values
 * @param {Array<boolean>} indexMask - Boolean mask indicating which points to keep
 * @returns {Object} - Filtered data object
 */
export function applyFilterMask(data, indexMask) {
  if (!indexMask) return data;
  
  const entityType = data.entities;
  const entities = data[entityType];

  const keep = [];
  for (let i = 0; i < indexMask.length; i++) if (indexMask[i]) keep.push(i);
  const pick = (values) => {
    const out = [];
    for (let k = 0; k < keep.length; k++) out.push(values[keep[k]]);
    return out;
  };

  const filteredData = {
    ...data,
    x: { ...data.x, values: pick(data.x.values) },
    y: { ...data.y, values: pick(data.y.values) }
  };

  if (data.z) {
    filteredData.z = { ...data.z, values: pick(data.z.values) };
  }

  filteredData.color = pick(data.color);
  filteredData[entityType] = pick(entities);
  
  // Generate proper customdata with entity names
  // This provides direct access to the entity names for click handlers
  filteredData.customdata = pick(entities);
  
  // Keep track of the mask
  filteredData.indexMask = indexMask;

  return filteredData;
}

/**
 * Filter data points based on various criteria
 * 
 * @param {Object} data - Data object containing all data values
 * @param {Object} settings - Plot settings
 * @returns {Object} - Object containing filtered data and filter statistics
 */
export function filterDataPoints(data, settings) {
  // First create the mask and statistics
  const { indexMask, filterStats } = createFilterMask(data, settings);
  
  // Then apply the mask to the data
  const filteredData = applyFilterMask(data, indexMask);
  
  // Add the statistics to the result
  filteredData.filterStats = filterStats;
  
  return { data: filteredData, filterStats };
}

/**
 * The Cell/Gene Plot layout from the panel's settings: axes, grid, zero lines,
 * fonts, margins, colours and interaction, with the settings' defaults filled
 * in. Shared by the regular path (createPlot) and large-plot mode
 * (large-plot.js), so the two look the same.
 * @param {Object} settings  panel settings (defaults are written into it)
 * @param {Object|null} data  the panel's series, for stable axis ranges under
 *   Hide NaN / Hide Outliers; null to skip that
 * @returns {Object} Plotly layout
 */
export function buildPlotLayout(settings, data) {
  const defaults = (window.Config && window.Config.DEFAULTS && window.Config.DEFAULTS.PLOT_AESTHETICS) || {};

  // Apply default aesthetic settings if not already set
  initializeAestheticsSettings(settings);
  
  // Ensure ALL aesthetic settings are set explicitly
  settings.showGrid = settings.showGrid !== undefined ? settings.showGrid : defaults.SHOW_GRID || true;
  settings.showAxisTitles = settings.showAxisTitles !== undefined ? settings.showAxisTitles : defaults.SHOW_AXIS_TITLES || true;
  settings.showAxisLabels = settings.showAxisLabels !== undefined ? settings.showAxisLabels : defaults.SHOW_AXIS_LABELS || true;
  settings.showAxisLines = settings.showAxisLines !== undefined ? settings.showAxisLines : defaults.SHOW_AXIS_LINES || true;
  settings.showZeroLines = settings.showZeroLines !== undefined ? settings.showZeroLines : defaults.SHOW_ZERO_LINES || false;
  settings.showLegend = settings.showLegend !== undefined ? settings.showLegend : defaults.SHOW_LEGEND || true;
  
  // Colors with fallbacks
  settings.bgColor = settings.bgColor || defaults.BG_COLOR || '#ffffff';
  settings.gridColor = settings.gridColor || defaults.GRID_COLOR || '#e6e6e6';
  settings.axisColor = settings.axisColor || defaults.AXIS_COLOR || '#000000';
  settings.textColor = settings.textColor || defaults.TEXT_COLOR || '#000000';
  settings.zeroLineColor = settings.zeroLineColor || defaults.ZERO_LINE_COLOR || '#cccccc';
  settings.backdropColor = settings.backdropColor || defaults.BACKDROP_COLOR || '#f0f0f0';
  
  // Fonts and sizing
  settings.fontSize = settings.fontSize || defaults.FONT_SIZE || 12;
  settings.fontFamily = settings.fontFamily || defaults.FONT_FAMILY || 'Arial, Helvetica, sans-serif';
  
  // Margins with fallbacks
  if (!settings.margins) {
    settings.margins = defaults.MARGINS || { l: 80, r: 80, t: 80, b: 60, pad: 4 };
  }
  
  // Export options
  settings.exportWidth = settings.exportWidth || defaults.EXPORT_WIDTH || 1200;
  settings.exportHeight = settings.exportHeight || defaults.EXPORT_HEIGHT || 800;
  settings.scaleExport = settings.scaleExport !== undefined ? settings.scaleExport : defaults.SCALE_EXPORT || false;
  
  // Legend settings
  settings.legendPosition = settings.legendPosition || defaults.LEGEND_POSITION || 'right';
  
  // Interaction settings
  settings.enableZoom = settings.enableZoom !== undefined ? settings.enableZoom : defaults.ENABLE_ZOOM || true;
  settings.enablePan = settings.enablePan !== undefined ? settings.enablePan : defaults.ENABLE_PAN || true;
  settings.showHoverInfo = settings.showHoverInfo !== undefined ? settings.showHoverInfo : defaults.SHOW_HOVER_INFO || true;

  // Build layout with our pure helper
  const layout = createLayout(settings);
  // Hide NaN / Hide Outliers remove points; keep the axes where all points are
  const pinned = data ? stableAxisRanges(data, settings) : null;
  if (pinned && pinned['xaxis.range']) layout.xaxis = { ...layout.xaxis, range: pinned['xaxis.range'], autorange: false };
  if (pinned && pinned['yaxis.range']) layout.yaxis = { ...layout.yaxis, range: pinned['yaxis.range'], autorange: false };
  
  // Ensure font and color settings are applied to the layout globally
  layout.font = {
    family: settings.fontFamily,
    size: settings.fontSize,
    color: settings.textColor
  };
  
  // Initialize settings with defaults if not set
  settings.axisLineWidth = settings.axisLineWidth || defaults.AXIS_LINE_WIDTH || 1;
  settings.gridLineWidth = settings.gridLineWidth || defaults.GRID_LINE_WIDTH || 1;
  settings.zeroLineWidth = settings.zeroLineWidth || defaults.ZERO_LINE_WIDTH || 1;
  settings.backdropColor = settings.backdropColor || defaults.BACKDROP_COLOR || '#f0f0f0';
  settings.showBackdrop = settings.showBackdrop !== undefined ? settings.showBackdrop : defaults.SHOW_BACKDROP;
  
  // Apply line width settings
  layout.xaxis = layout.xaxis || {};
  layout.yaxis = layout.yaxis || {};
  layout.xaxis.linewidth = settings.axisLineWidth;
  layout.yaxis.linewidth = settings.axisLineWidth;
  layout.xaxis.gridwidth = settings.gridLineWidth;
  layout.yaxis.gridwidth = settings.gridLineWidth;
  layout.xaxis.zerolinewidth = settings.zeroLineWidth;
  layout.yaxis.zerolinewidth = settings.zeroLineWidth;
  layout.xaxis.ticks = settings.showAxisLabels !== false ? 'outside' : 'none';
  layout.yaxis.ticks = settings.showAxisLabels !== false ? 'outside' : 'none';
  
  // Apply text color to all axis title fonts and tick fonts
  if (settings.z) { // 3D plot
    // Make sure all required objects exist
    layout.scene = layout.scene || {};
    layout.scene.xaxis = layout.scene.xaxis || {};
    layout.scene.yaxis = layout.scene.yaxis || {};
    layout.scene.zaxis = layout.scene.zaxis || {};
    
    // Initialize and set title fonts with proper color
    layout.scene.xaxis.title = layout.scene.xaxis.title || { text: '', font: {} };
    layout.scene.yaxis.title = layout.scene.yaxis.title || { text: '', font: {} };
    layout.scene.zaxis.title = layout.scene.zaxis.title || { text: '', font: {} };
    
    if (typeof layout.scene.xaxis.title === 'string') {
      const text = layout.scene.xaxis.title;
      layout.scene.xaxis.title = { text: text, font: {} };
    }
    if (typeof layout.scene.yaxis.title === 'string') {
      const text = layout.scene.yaxis.title;
      layout.scene.yaxis.title = { text: text, font: {} };
    }
    if (typeof layout.scene.zaxis.title === 'string') {
      const text = layout.scene.zaxis.title;
      layout.scene.zaxis.title = { text: text, font: {} };
    }
    
    // Set font properties including color
    layout.scene.xaxis.title.font = layout.scene.xaxis.title.font || {};
    layout.scene.yaxis.title.font = layout.scene.yaxis.title.font || {};
    layout.scene.zaxis.title.font = layout.scene.zaxis.title.font || {};
    
    layout.scene.xaxis.title.font.family = settings.fontFamily;
    layout.scene.yaxis.title.font.family = settings.fontFamily;
    layout.scene.zaxis.title.font.family = settings.fontFamily;
    
    layout.scene.xaxis.title.font.size = settings.fontSize + 2;
    layout.scene.yaxis.title.font.size = settings.fontSize + 2;
    layout.scene.zaxis.title.font.size = settings.fontSize + 2;
    
    layout.scene.xaxis.title.font.color = settings.textColor;
    layout.scene.yaxis.title.font.color = settings.textColor;
    layout.scene.zaxis.title.font.color = settings.textColor;
    
    // Initialize and set tick fonts
    layout.scene.xaxis.tickfont = layout.scene.xaxis.tickfont || {};
    layout.scene.yaxis.tickfont = layout.scene.yaxis.tickfont || {};
    layout.scene.zaxis.tickfont = layout.scene.zaxis.tickfont || {};
    
    layout.scene.xaxis.tickfont.family = settings.fontFamily;
    layout.scene.yaxis.tickfont.family = settings.fontFamily;
    layout.scene.zaxis.tickfont.family = settings.fontFamily;
    
    layout.scene.xaxis.tickfont.size = settings.fontSize;
    layout.scene.yaxis.tickfont.size = settings.fontSize;
    layout.scene.zaxis.tickfont.size = settings.fontSize;
    
    layout.scene.xaxis.tickfont.color = settings.textColor;
    layout.scene.yaxis.tickfont.color = settings.textColor;
    layout.scene.zaxis.tickfont.color = settings.textColor;
    
    // Apply line width settings for 3D
    layout.scene.xaxis.linewidth = settings.axisLineWidth;
    layout.scene.yaxis.linewidth = settings.axisLineWidth;
    layout.scene.zaxis.linewidth = settings.axisLineWidth;
    
    layout.scene.xaxis.gridwidth = settings.gridLineWidth;
    layout.scene.yaxis.gridwidth = settings.gridLineWidth;
    layout.scene.zaxis.gridwidth = settings.gridLineWidth;
    
    layout.scene.xaxis.zerolinewidth = settings.zeroLineWidth;
    layout.scene.yaxis.zerolinewidth = settings.zeroLineWidth;
    layout.scene.zaxis.zerolinewidth = settings.zeroLineWidth;
    
    // Apply zero line visibility and color
    layout.scene.xaxis.zeroline = settings.showZeroLines;
    layout.scene.yaxis.zeroline = settings.showZeroLines;
    layout.scene.zaxis.zeroline = settings.showZeroLines;
    layout.scene.xaxis.zerolinecolor = settings.zeroLineColor;
    layout.scene.yaxis.zerolinecolor = settings.zeroLineColor;
    layout.scene.zaxis.zerolinecolor = settings.zeroLineColor;
    
  } else { // 2D plot
    // Make sure all required objects exist
    layout.xaxis = layout.xaxis || {};
    layout.yaxis = layout.yaxis || {};
    
    // Initialize and set title fonts with proper color
    layout.xaxis.title = layout.xaxis.title || { text: '', font: {} };
    layout.yaxis.title = layout.yaxis.title || { text: '', font: {} };
    
    if (typeof layout.xaxis.title === 'string') {
      const text = layout.xaxis.title;
      layout.xaxis.title = { text: text, font: {} };
    }
    if (typeof layout.yaxis.title === 'string') {
      const text = layout.yaxis.title;
      layout.yaxis.title = { text: text, font: {} };
    }
    
    // Set font properties including color
    layout.xaxis.title.font = layout.xaxis.title.font || {};
    layout.yaxis.title.font = layout.yaxis.title.font || {};
    
    layout.xaxis.title.font.family = settings.fontFamily;
    layout.yaxis.title.font.family = settings.fontFamily;
    
    layout.xaxis.title.font.size = settings.fontSize + 2;
    layout.yaxis.title.font.size = settings.fontSize + 2;
    
    layout.xaxis.title.font.color = settings.textColor;
    layout.yaxis.title.font.color = settings.textColor;
    
    // Initialize and set tick fonts
    layout.xaxis.tickfont = layout.xaxis.tickfont || {};
    layout.yaxis.tickfont = layout.yaxis.tickfont || {};
    
    layout.xaxis.tickfont.family = settings.fontFamily;
    layout.yaxis.tickfont.family = settings.fontFamily;
    
    layout.xaxis.tickfont.size = settings.fontSize;
    layout.yaxis.tickfont.size = settings.fontSize;
    
    layout.xaxis.tickfont.color = settings.textColor;
    layout.yaxis.tickfont.color = settings.textColor;
    
    // Apply zero line visibility and color
    layout.xaxis.zeroline = settings.showZeroLines;
    layout.yaxis.zeroline = settings.showZeroLines;
    layout.xaxis.zerolinecolor = settings.zeroLineColor;
    layout.yaxis.zerolinecolor = settings.zeroLineColor;
  }

  // Apply aesthetic settings from the settings object
  if (settings) {
    // Apply margin settings if defined
    if (settings.margins) {
      layout.margin = settings.margins;
    }

    // Apply background color settings
    if (settings.bgColor) {
      layout.paper_bgcolor = settings.bgColor;
      layout.plot_bgcolor = settings.bgColor;
      
      // For 3D plots, also set the scene background and backdrop colors
      if (settings.z) {
        layout.scene = layout.scene || {};
        layout.scene.bgcolor = settings.bgColor;
        
        // Set backdrop color for each axis
        layout.scene.xaxis = layout.scene.xaxis || {};
        layout.scene.yaxis = layout.scene.yaxis || {};
        layout.scene.zaxis = layout.scene.zaxis || {};
        
        layout.scene.xaxis.showbackground = settings.showBackdrop;
        layout.scene.yaxis.showbackground = settings.showBackdrop;
        layout.scene.zaxis.showbackground = settings.showBackdrop;
        layout.scene.xaxis.backgroundcolor = settings.backdropColor;
        layout.scene.yaxis.backgroundcolor = settings.backdropColor;
        layout.scene.zaxis.backgroundcolor = settings.backdropColor;
      }
    }

    // Apply axis visibility settings
    if (settings.showAxisTitles === false) {
      if (settings.z) {
        if (layout.scene && layout.scene.xaxis && layout.scene.xaxis.title) layout.scene.xaxis.title.text = '';
        if (layout.scene && layout.scene.yaxis && layout.scene.yaxis.title) layout.scene.yaxis.title.text = '';
        if (layout.scene && layout.scene.zaxis && layout.scene.zaxis.title) layout.scene.zaxis.title.text = '';
      } else {
        if (layout.xaxis && layout.xaxis.title) layout.xaxis.title.text = '';
        if (layout.yaxis && layout.yaxis.title) layout.yaxis.title.text = '';
      }
    }
    
    // Apply tick label visibility
    if (settings.showAxisLabels === false) {
      if (settings.z) {
        if (layout.scene && layout.scene.xaxis) layout.scene.xaxis.showticklabels = false;
        if (layout.scene && layout.scene.yaxis) layout.scene.yaxis.showticklabels = false;
        if (layout.scene && layout.scene.zaxis) layout.scene.zaxis.showticklabels = false;
      } else {
        if (layout.xaxis) layout.xaxis.showticklabels = false;
        if (layout.yaxis) layout.yaxis.showticklabels = false;
      }
    }
    
    // Apply axis line visibility
    if (settings.showAxisLines === false) {
      if (settings.z) {
        if (layout.scene && layout.scene.xaxis) layout.scene.xaxis.showline = false;
        if (layout.scene && layout.scene.yaxis) layout.scene.yaxis.showline = false;
        if (layout.scene && layout.scene.zaxis) layout.scene.zaxis.showline = false;
      } else {
        if (layout.xaxis) layout.xaxis.showline = false;
        if (layout.yaxis) layout.yaxis.showline = false;
      }
    }

    // Apply legend settings
    if (settings.showLegend === false) {
      layout.showlegend = false;
    }

    // Apply interaction settings
    if (settings.showHoverInfo === false) {
      layout.hovermode = false;
    }

    if (settings.enableZoom === false) {
      if (settings.z) {
        layout.scene = layout.scene || {};
      } else {
        layout.xaxis = layout.xaxis || {};
        layout.yaxis = layout.yaxis || {};
        layout.xaxis.fixedrange = true;
        layout.yaxis.fixedrange = true;
      }
    }
  }

  // Apply additional aesthetic settings to the layout before plotting
  // Update grid and zero line visibility based on settings
  if (settings.z) { // 3D plot
    layout.scene = layout.scene || {};
    layout.scene.xaxis = layout.scene.xaxis || {};
    layout.scene.yaxis = layout.scene.yaxis || {};
    layout.scene.zaxis = layout.scene.zaxis || {};
    
    // Apply grid visibility
    layout.scene.xaxis.showgrid = settings.showGrid;
    layout.scene.yaxis.showgrid = settings.showGrid;
    layout.scene.zaxis.showgrid = settings.showGrid;
    
    // Apply zero line visibility
    layout.scene.xaxis.zeroline = settings.showZeroLines;
    layout.scene.yaxis.zeroline = settings.showZeroLines;
    layout.scene.zaxis.zeroline = settings.showZeroLines;
  } else { // 2D plot
    // Apply grid visibility
    layout.xaxis.showgrid = settings.showGrid;
    layout.yaxis.showgrid = settings.showGrid;
    
    // Apply zero line visibility
    layout.xaxis.zeroline = settings.showZeroLines;
    layout.yaxis.zeroline = settings.showZeroLines;
  }

  // drawPlot reacts into a graph already drawn: what the user changed there
  // (zoom, camera, a category hidden from the legend) is kept while this is
  // the same, i.e. on other cells of the same dataset
  layout.uirevision = DataManager.getCurrentDataset() || 'view';

  return layout;
}

export async function createPlot(container, plotContainer, settings, data, id, isFirstLoad = false) {
  
  
  // Determine if this is a gene plot or cell plot
  const isGenePlot = settings && settings.highlightFocusedGene !== undefined;
  const entityKey = isGenePlot ? 'genes' : 'cells';
  const entities = data[entityKey];
  const highlightKey = isGenePlot ? 'highlightFocusedGene' : 'highlightFocusedCell';

  const unit = isGenePlot ? 'genes' : 'cells';
  // The panel's coverage starts from whatever the loaders reported. An absent
  // one is UNREPORTED, not "fine" -- see static/js/utils/coverage.js.
  let loadCoverage = (data.coverage instanceof Coverage)
    ? data.coverage : Coverage.unreported(unit);

  // Validate required data
  if (!data.x || !data.y) {
    drawPlaceholder(plotContainer, loadCoverage.withGap(GAP.EMPTY,
      'the x or y series was never loaded', 'axes'), unit);
    return;
  }
  if (!entities || entities.length === 0) {
    drawPlaceholder(plotContainer, loadCoverage.withGap(GAP.UNAVAILABLE,
      `this dataset supplied no ${unit} names, so points cannot be identified`,
      `${unit} names`), unit);
    return;
  }
  if (entities.length !== data.x.values.length) {
    console.warn(
      `${isGenePlot ? 'Gene' : 'Cell'} names count (${entities.length}) doesn't match data points count (${data.x.values.length})`
    );
    // This truncation used to be console-only. It changes what is on screen,
    // so it is a gap and the user is told.
    if (entities.length > data.x.values.length) {
      data[entityKey] = entities.slice(0, data.x.values.length);
      loadCoverage = loadCoverage.withGap(GAP.FAILED,
        `${unit} names (${entities.length}) and data points (${data.x.values.length}) disagree; `
        + 'the surplus names were dropped', `${unit} names`,
        entities.length - data.x.values.length);
    } else {
      loadCoverage = loadCoverage.withGap(GAP.FAILED,
        `only ${entities.length} ${unit} names are available for ${data.x.values.length} data points`,
        `${unit} names`, data.x.values.length - entities.length);
    }
  }

  // Create filter mask to gather statistics and handle filtering
  const { indexMask, filterStats } = createFilterMask(data, settings);
  // automatic size and opacity follow the points that are left to draw
  followDrawnPoints(plotContainer, settings, filterStats.shown, id);

  // What the loaders could not supply, plus what the filters removed. This is
  // the single value every draw call below is required to carry.
  // Per AXIS, not per panel: only the series that loaded x can explain x.
  const axisCoverage = {
    x: data.x && data.x.coverage, y: data.y && data.y.coverage,
    z: data.z && data.z.coverage
  };
  const panelCoverage = withSubsetCoverage(Coverage.merge(
    [loadCoverage, classifyFilterStats(filterStats, unit, { axisCoverage })],
    unit
  ), unit);
  
  // Apply the filter mask only if explicit filtering is enabled
  let filteredData = data;
  if (settings.hideNaN || settings.hideOutliers) {
    filteredData = applyFilterMask(data, indexMask);
  }
  
  // Prepare base trace (works for numerical and constant coloring)
  const baseTrace = {
    type: settings.z ? 'scatter3d' : 'scattergl',
    mode: 'markers',
    x: filteredData.x.values,
    y: filteredData.y.values,
    text: filteredData[entityKey],
    customdata: filteredData[entityKey],
    showlegend: false,
    hovertemplate:
      `%{text}<br>x: %{x}<br>y: %{y}` +
      (settings.z ? `<br>z: %{z}` : '') +
      (filteredData.colorType === 'numerical' ? `<br>c: %{marker.color}` : '') +
      `<extra></extra>`,
    marker: {
      size: settings.pointSize,
      opacity: settings.pointOpacity
    }
  };
  if (settings.z && filteredData.z) {
    baseTrace.z = filteredData.z.values;
  }

  const layout = buildPlotLayout(settings, data);

  // A graph already drawn stays, and the new points are drawn into it
  clearForDraw(plotContainer);

  // Branch for different color types
  if (filteredData.colorType === 'categorical') {
    // Remove colorscale if present
    delete baseTrace.marker.colorscale;

    // Derive the unique category values
    const catValues = filteredData.colorCategories || [...new Set(filteredData.color)];
    const colorKey = `${settings.color.key}_colors`;
    const datasetPath = DataManager.getCurrentDataset();
    
    try {
      // Load custom colors from uns
      const response = await DataManager.loadUns({
        datasetPath: datasetPath,
        unsKey: colorKey
      });
      
      let customColors = null;
      if (response && response.data) {
        customColors = Array.isArray(response.data)
          ? response.data
          : [response.data];
      }
      
      // Process categories using the uns (custom) colors if available.
      // The processCategories function now handles both table filtering modes:
      // 1. When removeNonTableEntries is true, only table entities are shown
      // 2. When removeNonTableEntries is false, non-table entities are shown in gray
      const categoricalTraces = processCategories(settings, filteredData, catValues, customColors);
      
      // Set up the legend
      layout.showlegend = true;
      layout.legend = { 
        ...(layout.legend || {}), 
        title: { 
          text: colourTitle(settings.color),
          font: { 
            size: settings.fontSize ? settings.fontSize + 2 : 14,
            family: settings.fontFamily || 'Arial, Helvetica, sans-serif',
            color: settings.textColor || '#000000'
          }
        }
      };

      // Position the legend based on settings
      const position = settings.legendPosition || 'right';
      const posConfig = getPositioningByLocation(position);
      
      layout.legend.orientation = posConfig.legendOrientation;
      layout.legend.x = posConfig.legendX;
      layout.legend.y = posConfig.legendY;
      layout.legend.xanchor = posConfig.legendXanchor;
      layout.legend.yanchor = posConfig.legendYanchor;
      
      // Create the plot with categorical traces
      await drawPlot(
        plotContainer,
        categoricalTraces,
        layout,
        window.plotlyDefaultConfig || {
          responsive: true,
          displayModeBar: true,
          displaylogo: false,
          modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d']
        },
        panelCoverage,
        unit
      );
      
      // Attach click handler and highlight focused entity if needed
      attachClickHandler(plotContainer, categoricalTraces, filteredData, settings);
      if (settings[highlightKey]) {
        highlightFocusedEntity(plotContainer, filteredData, settings);
      }
      return;
    } catch (error) {
      console.warn(`Error fetching custom colors from uns.${colorKey}:`, error);
      
      // Fallback: process without custom colors
      const categoricalTraces = processCategories(settings, filteredData, catValues);
      
      await drawPlot(
        plotContainer,
        categoricalTraces,
        layout,
        window.plotlyDefaultConfig || {
          responsive: true,
          displayModeBar: true,
          displaylogo: false,
          modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d']
        },
        panelCoverage,
        unit
      );
      
      attachClickHandler(plotContainer, categoricalTraces, filteredData, settings);
      if (settings[highlightKey]) {
        highlightFocusedEntity(plotContainer, filteredData, settings);
      }
      return;
    }
  } else if (filteredData.colorType === 'numerical') {
    // Check if table filtering is active but entries are not being removed
    if (settings.tableFilter && settings.tableFilter !== 'none' && 
        filteredData.tableEntities) {
      
      // For numerical coloring with table filtering, we need to create two traces:
      // 1. A trace for all entities not in the table (colored gray)
      // 2. A trace for entities in the table (colored by their numeric values)
      
      const entityKey = filteredData.entities === 'cells' ? 'cells' : 'genes';
      const tableEntities = filteredData.tableEntities;
      
      // Create arrays for table and non-table entities
      const tableIndices = [];
      const nonTableIndices = [];
      
      // Separate indices into table and non-table
      filteredData[entityKey].forEach((entity, idx) => {
        if (tableEntities.has(entity)) {
          tableIndices.push(idx);
        } else {
          nonTableIndices.push(idx);
        }
      });
      
      // Update color sliders with the loaded data while preserving saved settings
      updateColorSliderUI(container, filteredData, settings, id, isFirstLoad);
      
      let cmin = settings.colorMin;
      let cmax = settings.colorMax;
      
      // If either setting is not defined (i.e. null or undefined), compute valid values and update only the missing one.
      if (cmin == null || cmax == null) {
        const validValues = filteredData.color.filter(v => !isNaN(v));
      
        if (cmin == null) {
          cmin = arrayMin(validValues);
        }
        if (cmax == null) {
          cmax = arrayMax(validValues);
        }
      }
      
      // Common colorbar settings for table entities
      const colorbarSettings = {
        title: {
          text: colourTitle(settings.color),
          side: 'right',
          font: { 
            size: settings.fontSize ? settings.fontSize + 2 : 14,
            family: settings.fontFamily || 'Arial, Helvetica, sans-serif',
            color: settings.textColor || '#000000'
          }
        }
      };
      
      // Use the centralized positioning function
      const position = settings.legendPosition || 'right';
      const posConfig = getPositioningByLocation(position);
      
      colorbarSettings.x = posConfig.x;
      colorbarSettings.xanchor = posConfig.xanchor;
      colorbarSettings.y = posConfig.y;
      colorbarSettings.yanchor = posConfig.yanchor;
      colorbarSettings.titleside = posConfig.titleside;
      colorbarSettings.orientation = posConfig.orientation;
      
      const traces = [];
      
      // 1. Create trace for non-table entities (colored gray) - draw first (bottom layer)
      // Only do this when we're NOT removing non-table entries completely
      if (!settings.removeNonTableEntries && nonTableIndices.length > 0) {
        const nonTableTrace = {
          type: settings.z ? 'scatter3d' : 'scattergl',
          mode: 'markers',
          name: 'Not in table',
          text: nonTableIndices.map(idx => filteredData[entityKey][idx]),
          customdata: nonTableIndices.map(idx => filteredData[entityKey][idx]),
          hovertemplate: `%{text}<br>x: %{x}<br>y: %{y}` + 
                        (settings.z ? `<br>z: %{z}` : '') + 
                        `<extra></extra>`,
          x: nonTableIndices.map(idx => filteredData.x.values[idx]),
          y: nonTableIndices.map(idx => filteredData.y.values[idx]),
          marker: {
            ...greyMarker(settings, filteredData.x.values.length),
            color: 'rgba(180, 180, 180, 1.)',
          },
          showlegend: false
        };
        
        // Add z-axis values for 3D plots if applicable
        if (settings.z && filteredData.z) {
          nonTableTrace.z = nonTableIndices.map(idx => filteredData.z.values[idx]);
        }
        
        traces.push(nonTableTrace);
      }
      
      // 2. Create trace for table entities (colored normally) - draw second (top layer)
      if (tableIndices.length > 0) {
        // For table entities, apply outlier and NaN filtering if enabled
        const tableFilteredIndices = tableIndices.filter(idx => {
          // Only apply outlier and NaN filtering to table entities
          let keepPoint = true;
          
          // Apply color NaN filtering if enabled
          if (settings.hideNaN && (filteredData.color[idx] === null || isNaN(filteredData.color[idx]))) {
            keepPoint = false;
          }
          
          // Apply outlier filtering if enabled
          if (keepPoint && settings.hideOutliers) {
            const colorVal = filteredData.color[idx];
            if (colorVal !== null && !isNaN(colorVal)) {
              const cmin = settings.colorMin ?? arrayMin(filteredData.color.filter(v => !isNaN(v)));
              const cmax = settings.colorMax ?? arrayMax(filteredData.color.filter(v => !isNaN(v)));
              if (colorVal < cmin || colorVal > cmax) {
                keepPoint = false;
              }
            }
          }
          
          return keepPoint;
        });
        
        const tableTrace = {
          type: settings.z ? 'scatter3d' : 'scattergl',
          mode: 'markers',
          name: settings.color.key || 'Value',
          text: tableFilteredIndices.map(idx => filteredData[entityKey][idx]),
          customdata: tableFilteredIndices.map(idx => filteredData[entityKey][idx]),
          hovertemplate: `%{text}<br>x: %{x}<br>y: %{y}` + 
                        (settings.z ? `<br>z: %{z}` : '') + 
                        `<br>c: %{marker.color}<extra></extra>`,
          x: tableFilteredIndices.map(idx => filteredData.x.values[idx]),
          y: tableFilteredIndices.map(idx => filteredData.y.values[idx]),
          marker: {
            size: settings.pointSize,
            opacity: settings.pointOpacity,
            color: tableFilteredIndices.map(idx => filteredData.color[idx]),
            colorscale: plotlyColorscale(settings.colorScale),
            reversescale: settings.colorReversed,
            cmin: cmin,
            cmax: cmax,
            colorbar: colorbarSettings
          },
          showlegend: false
        };
        
        // Add z-axis values for 3D plots if applicable
        if (settings.z && filteredData.z) {
          tableTrace.z = tableFilteredIndices.map(idx => filteredData.z.values[idx]);
        }
        
        traces.push(tableTrace);
      }
      
      await drawPlot(
        plotContainer,
        traces,
        layout,
        window.plotlyDefaultConfig || {
          responsive: true,
          displayModeBar: true,
          displaylogo: false,
          modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d']
        },
        panelCoverage,
        unit
      );
      
      attachClickHandler(plotContainer, traces, filteredData, settings);
    } 
    // Standard numerical coloring (no table filtering or entries being removed)
    else {
      // Numerical coloring branch.
      baseTrace.marker.color = filteredData.color;
      baseTrace.marker.colorscale = plotlyColorscale(settings.colorScale);
      baseTrace.marker.reversescale = settings.colorReversed;
      
      // Update color sliders with the loaded data while preserving saved settings
      updateColorSliderUI(container, filteredData, settings, id, isFirstLoad);
      
      let cmin = settings.colorMin;
      let cmax = settings.colorMax;
      
      // If either setting is not defined (i.e. null or undefined), compute valid values and update only the missing one.
      if (cmin == null || cmax == null) {
        const validValues = filteredData.color.filter(v => !isNaN(v));
      
        if (cmin == null) {
          cmin = arrayMin(validValues);
        }
        if (cmax == null) {
          cmax = arrayMax(validValues);
        }
      }
      
      baseTrace.marker.cmin = cmin;
      baseTrace.marker.cmax = cmax;
      baseTrace.marker.colorbar = {
        title: {
          text: colourTitle(settings.color),
          side: 'right',
          font: { 
            size: settings.fontSize ? settings.fontSize + 2 : 14,
            family: settings.fontFamily || 'Arial, Helvetica, sans-serif',
            color: settings.textColor || '#000000'
          }
        }
      };
  
      // Use the centralized positioning function
      const position = settings.legendPosition || 'right';
      const posConfig = getPositioningByLocation(position);
      
      baseTrace.marker.colorbar.x = posConfig.x;
      baseTrace.marker.colorbar.xanchor = posConfig.xanchor;
      baseTrace.marker.colorbar.y = posConfig.y;
      baseTrace.marker.colorbar.yanchor = posConfig.yanchor;
      baseTrace.marker.colorbar.titleside = posConfig.titleside;
      baseTrace.marker.colorbar.orientation = posConfig.orientation;
  
      await drawPlot(
        plotContainer,
        [baseTrace],
        layout,
        window.plotlyDefaultConfig || {
          responsive: true,
          displayModeBar: true,
          displaylogo: false,
          modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d']
        },
        panelCoverage,
        unit
      );
      attachClickHandler(plotContainer, [baseTrace], filteredData, settings);
    }
  } else if (filteredData.colorType === 'constant') {
    // Check if table filtering is active but entries are not being removed
    if (settings.tableFilter && settings.tableFilter !== 'none' && 
        filteredData.tableEntities) {
      
      // For constant coloring with table filtering, we need to create two traces:
      // 1. A trace for entities in the table (colored normally)
      // 2. A trace for entities not in the table (colored lighter gray)
      
      const entityKey = filteredData.entities === 'cells' ? 'cells' : 'genes';
      const tableEntities = filteredData.tableEntities;
      
      // Create arrays for table and non-table entities
      const tableIndices = [];
      const nonTableIndices = [];
      
      // Separate indices into table and non-table
      filteredData[entityKey].forEach((entity, idx) => {
        if (tableEntities.has(entity)) {
          tableIndices.push(idx);
        } else {
          nonTableIndices.push(idx);
        }
      });
      
      const traces = [];
      
      // 1. Create trace for non-table entities (lighter gray) - draw first (bottom layer)
      // Only do this when we're NOT removing non-table entries completely
      if (!settings.removeNonTableEntries && nonTableIndices.length > 0) {
        const nonTableTrace = {
          type: settings.z ? 'scatter3d' : 'scattergl',
          mode: 'markers',
          name: 'Not in table',
          text: nonTableIndices.map(idx => filteredData[entityKey][idx]),
          customdata: nonTableIndices.map(idx => filteredData[entityKey][idx]),
          hovertemplate: `%{text}<br>x: %{x}<br>y: %{y}` + 
                        (settings.z ? `<br>z: %{z}` : '') + 
                        `<extra></extra>`,
          x: nonTableIndices.map(idx => filteredData.x.values[idx]),
          y: nonTableIndices.map(idx => filteredData.y.values[idx]),
          marker: {
            ...greyMarker(settings, filteredData.x.values.length),
            color: 'rgba(180, 180, 180, 1.)'
          },
          showlegend: true
        };
        
        // Add z-axis values for 3D plots if applicable
        if (settings.z && filteredData.z) {
          nonTableTrace.z = nonTableIndices.map(idx => filteredData.z.values[idx]);
        }
        
        traces.push(nonTableTrace);
      }
      
      // 2. Create trace for table entities (normal constant color) - draw second (top layer)
      if (tableIndices.length > 0) {
        // For constant coloring, also apply outlier and NaN filtering if enabled
        const tableFilteredIndices = tableIndices.filter(idx => {
          // Only apply NaN filtering to table entities (outlier filtering doesn't apply to constant coloring)
          let keepPoint = true;
          
          // Apply x/y NaN filtering if enabled
          if (settings.hideNaN) {
            if (filteredData.x.values[idx] === null || isNaN(filteredData.x.values[idx]) ||
                filteredData.y.values[idx] === null || isNaN(filteredData.y.values[idx])) {
              keepPoint = false;
            }
          }
          
          return keepPoint;
        });
        
        const tableTrace = {
          type: settings.z ? 'scatter3d' : 'scattergl',
          mode: 'markers',
          name: 'Data points',
          text: tableFilteredIndices.map(idx => filteredData[entityKey][idx]),
          customdata: tableFilteredIndices.map(idx => filteredData[entityKey][idx]),
          hovertemplate: `%{text}<br>x: %{x}<br>y: %{y}` + 
                        (settings.z ? `<br>z: %{z}` : '') + 
                        `<extra></extra>`,
          x: tableFilteredIndices.map(idx => filteredData.x.values[idx]),
          y: tableFilteredIndices.map(idx => filteredData.y.values[idx]),
          marker: {
            size: settings.pointSize,
            opacity: settings.pointOpacity,
            color: 'rgba(150, 150, 150, 1.)'
          },
          showlegend: true
        };
        
        // Add z-axis values for 3D plots if applicable
        if (settings.z && filteredData.z) {
          tableTrace.z = tableFilteredIndices.map(idx => filteredData.z.values[idx]);
        }
        
        traces.push(tableTrace);
      }
      
      await drawPlot(
        plotContainer,
        traces,
        layout,
        window.plotlyDefaultConfig || {
          responsive: true,
          displayModeBar: true,
          displaylogo: false,
          modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d']
        },
        panelCoverage,
        unit
      );
      
      attachClickHandler(plotContainer, traces, filteredData, settings);
    }
    // Standard constant coloring (no table filtering or entries being removed)
    else {
      // Constant coloring branch.
      baseTrace.marker.color = 'rgba(150, 150, 150, 1.)';
      delete baseTrace.marker.colorscale;
      console.log('Using constant color for all points');
      
      await drawPlot(
        plotContainer,
        [baseTrace],
        layout,
        window.plotlyDefaultConfig || {
          responsive: true,
          displayModeBar: true,
          displaylogo: false,
          modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d']
        },
        panelCoverage,
        unit
      );
      attachClickHandler(plotContainer, [baseTrace], filteredData, settings);
    }
  }
  if (settings[highlightKey]) {
    highlightFocusedEntity(plotContainer, filteredData, settings);
  }
}
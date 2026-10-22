import { registerCameraExport, setStatusTag, nudgeStatusTag, exportWithCoverage } from '../../utils/panel-surface.js';
import { axisTitle, refreshScaleBar, flipRelayout } from './plot-make-helper.js';
import { hasLegendEntries } from '../../utils/legend-entries.js';
import { applyLegendOptions, legendOrientation, legendTitleText, legendTitleSize, DOT_SIZE_MIN, DOT_SIZE_MAX, DOT_SIZE_AUTO, COLUMNS_MAX,
    TITLE_SIZE_MIN, TITLE_SIZE_MAX, TITLE_GAP_MAX } from '../../utils/legend-options.js';
import { restyleMarkers, restyleFocus } from './plot-update.js';
import { FOCUS_DEFAULTS, FOCUS_SCALE_MAX, FOCUS_EDGE_MAX } from '../../utils/focus-style.js';
import {
  plotColour, isFollowing, followTheme, modebarColours, THEMED_COLOURS
} from '../../utils/plot-theme.js';
import { THEME_EVENT } from '../../utils/theme.js';
import {
  normalizePlotOptions, tickMarksOn, tickKeys, axisPaths, colorbarPosition, colorbarExtras, linkedMargins,
  SCALE_BAR_CORNERS, COLORBAR_POSITIONS, applyPreset, pickStyle, adoptStyle, exportOptions, STYLE_KEYS
} from './plot-options.js';
import { exportImage, fullImage, canSnapshot, snapshotSize } from '../../utils/plot-export.js';
import {
  hasSessionStyle, setSessionStyle, clearSessionStyle, effectiveStyle, onSessionStyleChange, STYLE_TYPES
} from '../../utils/session-style.js';
import { exportCheck, guarded, refusalText, bindingLabel } from '../../utils/memory-guard-ui.js';
/**
 * Plot Aesthetics Menu
 * 
 * This module provides a comprehensive menu system for controlling plot aesthetics and export options.
 * Features include grid visibility, axes customization, margin control, theme settings,
 * export formats (SVG, PNG), plot dimension controls, and more.
 */

/**
 * Sets up the aesthetic menu popover on an existing button and returns the cleanup function
 * @param {string} id - Panel ID
 * @param {HTMLElement} menuButton - Existing menu button element
 * @param {HTMLElement} container - Container element for passing to listeners
 * @param {HTMLElement} plotContainer - Plot container element (for applying changes)
 * @param {Object} settings - Plot settings object
 * @returns {Function} cleanup function to remove listeners and dispose popover
 */
export function createAestheticsMenu(id, menuButton, container, plotContainer, settings) {
  // Remove any existing popover
  const prev = bootstrap.Popover.getInstance(menuButton);
  if (prev) prev.dispose();

  // Initialize popover
  const popover = new bootstrap.Popover(menuButton, {
    trigger:    'click',
    placement:  'bottom',
    boundary:   'viewport',
    container:  'body',
    html:       true,
    sanitize:   false,
    customClass:'aesthetics-popover',
    title:      'Plot Options',
    content:    () => createPopoverContent(id, settings)
  });

  // Toggle active styling
  const onShown = () => {
    menuButton.classList.add('btn-aesthetics-active');
    menuButton.classList.remove('btn-outline-secondary');
    
    // Find the popover content element
    const popoverEl = document.querySelector('.aesthetics-popover .aesthetics-menu-content');
    if (popoverEl) {
      // Get margin values from data attributes
      const marginTop = popoverEl.getAttribute('data-margin-top');
      const marginBottom = popoverEl.getAttribute('data-margin-bottom');
      const marginLeft = popoverEl.getAttribute('data-margin-left');
      const marginRight = popoverEl.getAttribute('data-margin-right');
      
      // Set the input values
      const topInput = document.getElementById(`margin-top-${id}`);
      const bottomInput = document.getElementById(`margin-bottom-${id}`);
      const leftInput = document.getElementById(`margin-left-${id}`);
      const rightInput = document.getElementById(`margin-right-${id}`);
      
      if (topInput && marginTop) topInput.value = marginTop;
      if (bottomInput && marginBottom) bottomInput.value = marginBottom;
      if (leftInput && marginLeft) leftInput.value = marginLeft;
      if (rightInput && marginRight) rightInput.value = marginRight;
    }
    syncColourControls(id, settings);     // a colour that follows the theme has nothing to reset
    // Popper places the menu once; opening a group makes it taller and the old place goes stale, until
    // the first change of an option moves it, under the pointer. Follow the menu's size instead.
    const tip = document.querySelector('.aesthetics-popover');
    if (tip && typeof ResizeObserver === 'function') {
      sizeWatch?.disconnect();
      sizeWatch = new ResizeObserver(() => popover.update());
      sizeWatch.observe(tip);
    }
  };
  
  let sizeWatch = null;
  const onHide = () => {
    sizeWatch?.disconnect();
    sizeWatch = null;
    menuButton.classList.remove('btn-aesthetics-active');
    menuButton.classList.add('btn-outline-secondary');
  };
  
  menuButton.addEventListener('shown.bs.popover', onShown);
  menuButton.addEventListener('hide.bs.popover',  onHide);

  // Click-away handler: a press that starts outside the menu and button closes it. A drag that
  // starts inside (selecting text, a slider, a colour picker) and ends outside is a click on the
  // common ancestor, so the press target decides, not the click's.
  let pressedInside = null;     // set by pointerdown; null when a click came without one (synthetic)
  const onPress = (e) => {
    pressedInside = !!(e.target.closest && (menuButton.contains(e.target) || e.target.closest('.popover')));
  };
  const clickAway = (e) => {
    const inside = pressedInside !== null ? pressedInside : !!(menuButton.contains(e.target) || e.target.closest('.popover'));
    pressedInside = null;
    if (!e.target.isConnected) return;   // a control the menu drew again (a preset) is not outside it
    if (!inside) popover.hide();
  };
  document.addEventListener('pointerdown', onPress, true);
  document.addEventListener('click', clickAway);

  // Settings-change listener
  const onSettingsChange = (e) => {
    if (e.detail.id === id) popover.update();
  };
  document.addEventListener('plotSettingsChanged', onSettingsChange);

  // Wire up the controls inside the popover
  const cleanupListeners = setupAestheticsMenuListeners(container, settings, plotContainer, id);

  // Return cleanup function
  return function cleanup() {
    sizeWatch?.disconnect();
    popover.dispose();
    menuButton.removeEventListener('shown.bs.popover', onShown);
    menuButton.removeEventListener('hide.bs.popover',  onHide);
    document.removeEventListener('pointerdown', onPress, true);
    document.removeEventListener('click', clickAway);
    document.removeEventListener('plotSettingsChanged', onSettingsChange);
    cleanupListeners();
  };
}
  

/**
 * Creates the HTML content for the aesthetics popover
 * @param {string} id - Panel ID
 * @param {Object} settings - Plot settings object
 * @returns {string} - HTML string for popover content
 */
/** Sections the user opened, per panel; a menu opens again as it was left. */
const sectionOpen = new Map();
const OPEN_AT_FIRST = ['export'];      // a panel with no remembered state: only Export is open

/**
 * The opacity the grey points of a table filter are drawn at now, rounded, as text; '' while
 * there are none. The box shows it (it is automatic until the user types) so the arrows and
 * the spinner step from what is on screen.
 */
function drawnGreyOpacity(id) {
    const gd = typeof document !== 'undefined' && document.getElementById(`plot-container-${id}`);
    const t = gd && gd.data && gd.data.find(tr => tr && tr.name === 'Not in table' && tr.x);
    const o = t && t.marker && t.marker.opacity;
    return typeof o === 'number' && o > 0 && o <= 1 ? String(Math.round(o * 100) / 100) : '';
}

/** A collapsible group of the menu. */
function details(id, key, title, body) {
    const open = (sectionOpen.get(id) || new Set(OPEN_AT_FIRST)).has(key);
    return `<details class="aesthetics-section" data-section="${key}" data-panel="${escapeAttr(id)}"${open ? ' open' : ''}>
            <summary>${title}</summary>
            <div class="aesthetics-body">${body}</div>
        </details>`;
}

export function createPopoverContent(id, settings) {
    // Ensure all required settings have defaults
    initializeAestheticsSettings(settings);
    
    // Store the actual margin values in data attributes to prevent bootstrap.Popover 
    // from caching the HTML and causing incorrect values
    const marginTop = settings.margins?.t ?? 80;
    const marginBottom = settings.margins?.b ?? 60;
    const marginLeft = settings.margins?.l ?? 80;
    const marginRight = settings.margins?.r ?? 80;
    
    const marginsLinkedValue = marginTop;
    const scaleBarOk = !settings.z && !!settings.equalAspect;
    const scaleBarWhy = settings.z ? 'The scale bar is for 2D plots.'
        : 'Needs Equal aspect (the panel controls): without it a unit is not as long on y as on x.';
    const plotKind = settings.highlightFocusedGene !== undefined ? 'gene' : 'cell';

    // Create a custom ID to ensure we're getting fresh HTML each time
    const uniqueId = `aesthetics-${id}-${Date.now()}`;
    
    return `
    <div id="${uniqueId}" class="aesthetics-menu-content" 
         data-margin-top="${marginTop}" 
         data-margin-bottom="${marginBottom}" 
         data-margin-left="${marginLeft}"
         data-margin-right="${marginRight}">
        ${details(id, 'presets', 'Presets', `

            <div class="d-flex gap-2">
                <button type="button" class="btn btn-sm btn-outline-primary flex-fill" id="preset-publication-${id}"
                    title="White background, no grid, five ticks per axis, Arial at a larger size, a short colour bar with three ticks. The scale bar stays as it is">Publication</button>
                <button type="button" class="btn btn-sm btn-outline-primary flex-fill" id="preset-bare-${id}"
                    title="Only the points: no margins, legend, axis labels or grid. For figures and overlays.">Bare</button>
                <button type="button" class="btn btn-sm btn-outline-secondary flex-fill" id="preset-default-${id}"
                    title="${hasSessionStyle(`${plotKind}-plot`) ? 'Session default style: the look every plot on Default has' : 'Built-in style'}">Default</button>
            </div>
        `)}
        ${details(id, 'background', 'Background', `
            <!-- What is drawn behind the data. Each block is one option; a new one (cell outlines,
                 a stain image) is another block here, with its own Reset when it has a colour. -->

            <!-- Background Color -->
            <div class="mb-2">
                <label class="form-label mb-1">Colour</label>
                <div class="d-flex align-items-center gap-2">
                    <input type="color" class="form-control form-control-sm form-control-color" 
                        id="plot-bg-color-${id}" value="${plotColour(settings, 'bgColor')}" title="Choose background color">
                    <button class="btn btn-sm btn-outline-secondary" id="reset-bg-color-${id}">Reset</button>
                </div>
            </div>
            
            <!-- 3D Backdrop Settings (only shown for 3D plots) -->
            <div class="mb-2 ${settings.z ? '' : 'd-none'}" id="backdrop-container-${id}">
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <label class="form-label mb-0">3D Backdrop</label>
                    <div class="form-check form-switch">
                        <input class="form-check-input" type="checkbox" id="show-backdrop-${id}" 
                            ${settings.showBackdrop ? 'checked' : ''}>
                        <label class="form-check-label" for="show-backdrop-${id}">Show</label>
                    </div>
                </div>
                <div class="d-flex align-items-center gap-2">
                    <input type="color" class="form-control form-control-sm form-control-color" 
                        id="backdrop-color-${id}" value="${plotColour(settings, 'backdropColor')}" title="Choose 3D backdrop color">
                    <button class="btn btn-sm btn-outline-secondary" id="reset-backdrop-color-${id}">Reset</button>
                </div>
            </div>
        `)}
        ${details(id, 'axes', 'Axes and ticks', `
            
            <!-- Grid Controls -->
            <div class="form-check form-switch mb-2">
                <input class="form-check-input" type="checkbox" id="grid-toggle-${id}" 
                    ${settings.showGrid ? 'checked' : ''}>
                <label class="form-check-label" for="grid-toggle-${id}">Show Grid</label>
            </div>
            
            <!-- Grid Color -->
            <div class="mb-2">
                <label class="form-label mb-1">Grid Color</label>
                <div class="d-flex align-items-center gap-2">
                    <input type="color" class="form-control form-control-sm form-control-color" 
                        id="grid-color-${id}" value="${plotColour(settings, 'gridColor')}" title="Choose grid color">
                    <button class="btn btn-sm btn-outline-secondary" id="reset-grid-color-${id}">Reset</button>
                </div>
            </div>
            
            <!-- Axis Controls -->
            <div class="mb-2">
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="show-axis-titles-${id}" 
                        ${settings.showAxisTitles !== false ? 'checked' : ''}>
                    <label class="form-check-label" for="show-axis-titles-${id}">Show Axis Titles</label>
                </div>
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="show-axis-labels-${id}" 
                        ${settings.showAxisLabels !== false ? 'checked' : ''}>
                    <label class="form-check-label" for="show-axis-labels-${id}">Show Tick Labels</label>
                </div>
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="show-axis-lines-${id}" 
                        ${settings.showAxisLines !== false ? 'checked' : ''}>
                    <label class="form-check-label" for="show-axis-lines-${id}">Show Axis Lines</label>
                </div>
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="zero-lines-${id}" 
                        ${settings.showZeroLines ? 'checked' : ''}>
                    <label class="form-check-label" for="zero-lines-${id}">Show Zero Lines</label>
                </div>
                <!-- Direction: a view setting of this plot, never copied as a style -->
                <div class="form-check form-switch" title="${settings.z ? 'Axis directions can be flipped in 2D plots only.' : 'Run the y axis the other way, so y grows downwards (spatial coordinates are often read like that).'}">
                    <input class="form-check-input" type="checkbox" id="flip-y-${id}"
                        ${settings.flipY ? 'checked' : ''} ${settings.z ? 'disabled' : ''}>
                    <label class="form-check-label" for="flip-y-${id}">Flip y (grows downwards)</label>
                </div>
                <div class="form-check form-switch" title="${settings.z ? 'Axis directions can be flipped in 2D plots only.' : 'Run the x axis the other way, so x grows to the left.'}">
                    <input class="form-check-input" type="checkbox" id="flip-x-${id}"
                        ${settings.flipX ? 'checked' : ''} ${settings.z ? 'disabled' : ''}>
                    <label class="form-check-label" for="flip-x-${id}">Flip x (grows to the left)</label>
                </div>
                
                <!-- Line Width Settings -->
                <div class="mt-2">
                    <label class="form-label mb-1">Line Widths</label>
                    <div class="input-group input-group-sm mb-1">
                        <span class="input-group-text">Axis</span>
                        <input type="number" class="form-control" id="axis-line-width-${id}" 
                            value="${settings.axisLineWidth}" min="0.1" max="10" step="0.1">
                        <span class="input-group-text">px</span>
                    </div>
                    <div class="input-group input-group-sm mb-1">
                        <span class="input-group-text">Grid</span>
                        <input type="number" class="form-control" id="grid-line-width-${id}" 
                            value="${settings.gridLineWidth}" min="0.1" max="10" step="0.1">
                        <span class="input-group-text">px</span>
                    </div>
                    <div class="input-group input-group-sm">
                        <span class="input-group-text">Zero</span>
                        <input type="number" class="form-control" id="zero-line-width-${id}" 
                            value="${settings.zeroLineWidth}" min="0.1" max="10" step="0.1">
                        <span class="input-group-text">px</span>
                    </div>
                </div>
            </div>
            
            <!-- Axis Color -->
            <div class="mb-2">
                <label class="form-label mb-1">Axis Color</label>
                <div class="d-flex align-items-center gap-2">
                    <input type="color" class="form-control form-control-sm form-control-color" 
                        id="axis-color-${id}" value="${plotColour(settings, 'axisColor')}" title="Choose axis color">
                    <button class="btn btn-sm btn-outline-secondary" id="reset-axis-color-${id}">Reset</button>
                </div>
            </div>
            
            <!-- Zero Line Color -->
            <div class="mb-2">
                <label class="form-label mb-1">Zero Line Color</label>
                <div class="d-flex align-items-center gap-2">
                    <input type="color" class="form-control form-control-sm form-control-color" 
                        id="zero-line-color-${id}" value="${plotColour(settings, 'zeroLineColor')}" title="Choose zero line color">
                    <button class="btn btn-sm btn-outline-secondary" id="reset-zero-line-color-${id}">Reset</button>
                </div>
            </div>
            
            <!-- Ticks -->
            <div class="mb-2">
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="show-tick-marks-${id}"
                        ${tickMarksOn(settings) ? 'checked' : ''}>
                    <label class="form-check-label" for="show-tick-marks-${id}">Show Tick Marks</label>
                </div>
                <div class="input-group input-group-sm mt-1">
                    <span class="input-group-text">Ticks per axis</span>
                    <input type="number" class="form-control" id="tick-count-${id}" value="${settings.tickCount ?? ''}"
                        placeholder="auto" min="2" max="30" step="1" title="About this many ticks on each axis; empty: automatic">
                </div>
            </div>

            <!-- Spatial scale bar -->
            <div class="mb-2 scale-bar-options ${scaleBarOk ? '' : 'scale-bar-off'}" id="scale-bar-options-${id}">
                <div class="form-check form-switch" ${scaleBarOk ? '' : 'title="Needs Equal aspect"'}>
                    <input class="form-check-input" type="checkbox" id="show-scale-bar-${id}"
                        ${settings.showScaleBar ? 'checked' : ''} ${scaleBarOk ? '' : 'disabled'}>
                    <label class="form-check-label" for="show-scale-bar-${id}">Scale bar</label>
                </div>
                <div class="form-text mt-0 mb-1" id="scale-bar-note-${id}">${scaleBarOk ? 'A round length in coordinate units, about a fifth of the width in view; it follows the zoom.' : escapeAttr(scaleBarWhy)}</div>
                <div class="d-flex align-items-center gap-2 mb-1">
                    <span class="small text-nowrap">Size</span>
                    <input type="range" class="form-range flex-grow-1" id="scale-bar-size-${id}" min="25" max="400" step="5"
                        value="${Math.round(settings.scaleBarSize * 100)}" title="Length, line and label together" ${scaleBarOk ? '' : 'disabled'}>
                    <span class="small text-nowrap" id="scale-bar-size-value-${id}">${Math.round(settings.scaleBarSize * 100)}%</span>
                </div>
                <div class="input-group input-group-sm mb-1">
                    <span class="input-group-text">Unit</span>
                    <input type="text" class="form-control" id="scale-bar-unit-${id}" value="${escapeAttr(settings.scaleBarUnit)}"
                        maxlength="20" placeholder="optional, e.g. µm" ${scaleBarOk ? '' : 'disabled'}>
                </div>
                <select class="form-select form-select-sm" id="scale-bar-corner-${id}" title="Corner" ${scaleBarOk ? '' : 'disabled'}>
                    ${SCALE_BAR_CORNERS.map(c => `<option value="${c}" ${settings.scaleBarCorner === c ? 'selected' : ''}>${c.replace('-', ' ')}</option>`).join('')}
                </select>
            </div>

        `)}
        ${details(id, 'points', 'Points', `
            <div class="form-text mt-0 mb-1">The grey points a table filter leaves in the plot.</div>
            <div class="input-group input-group-sm mb-1">
                <span class="input-group-text">Size</span>
                <input type="number" class="form-control" id="not-in-table-scale-${id}"
                    value="${settings.notInTableScale ?? 1}" min="0.1" max="20" step="0.1"
                    title="Relative to the size their count gets automatically">
                <span class="input-group-text">x auto</span>
            </div>
            <div class="input-group input-group-sm mb-1">
                <span class="input-group-text">Opacity</span>
                <input type="number" class="form-control" id="not-in-table-opacity-${id}"
                    value="${settings.notInTableOpacity ?? drawnGreyOpacity(id)}" placeholder="auto" min="0.05" max="1" step="0.05" data-step-from="1">
            </div>
            <div class="d-flex align-items-center gap-2">
                <label class="form-label mb-0 me-2">Color</label>
                <input type="color" class="form-control form-control-sm form-control-color"
                    id="not-in-table-color-${id}" value="${plotColour(settings, 'notInTableColor')}" title="Choose the colour of the points not in the table">
                <button class="btn btn-sm btn-outline-secondary" id="reset-not-in-table-color-${id}">Reset</button>
            </div>
        `)}
        ${details(id, 'focused', `Focused ${plotKind}`, `
            <div class="form-text mt-0 mb-1">The marker on the focused ${plotKind}, while Highlight Focused ${plotKind === 'gene' ? 'Gene' : 'Cell'} is on.</div>
            <div class="input-group input-group-sm mb-1">
                <span class="input-group-text">Size</span>
                <input type="number" class="form-control" id="focused-scale-${id}"
                    value="${settings.focusedScale ?? FOCUS_DEFAULTS.scale}" min="0.1" max="${FOCUS_SCALE_MAX}" step="0.1"
                    title="Relative to the point size; ${FOCUS_DEFAULTS.scale} is five times as large">
                <span class="input-group-text">x points</span>
            </div>
            <div class="input-group input-group-sm mb-1">
                <span class="input-group-text">Opacity</span>
                <input type="number" class="form-control" id="focused-opacity-${id}"
                    value="${settings.focusedOpacity ?? FOCUS_DEFAULTS.opacity}" placeholder="${FOCUS_DEFAULTS.opacity}" min="0.05" max="1" step="0.05"
                    data-step-from="${FOCUS_DEFAULTS.opacity}" title="0 to 1; 1 is opaque">
            </div>
            <div class="input-group input-group-sm mb-1">
                <span class="input-group-text">Edge width</span>
                <input type="number" class="form-control" id="focused-edge-width-${id}"
                    value="${settings.focusedEdgeWidth ?? FOCUS_DEFAULTS.edgeWidth}" min="0" max="${FOCUS_EDGE_MAX}" step="0.5"
                    title="0: no edge">
                <span class="input-group-text">px</span>
            </div>
            <div class="d-flex align-items-center gap-2 mb-1">
                <label class="form-label mb-0 me-2">Fill</label>
                <input type="color" class="form-control form-control-sm form-control-color"
                    id="focused-color-${id}" value="${plotColour(settings, 'focusedColor')}" title="Choose the fill colour of the focused marker (also the ring of a cell outside the subset)">
                <button class="btn btn-sm btn-outline-secondary" id="reset-focused-color-${id}" ${resetState(settings, 'focusedColor')}>Reset</button>
                <div class="form-check mb-0 ms-1">
                    <input class="form-check-input" type="checkbox" id="focused-no-fill-${id}" ${settings.focusedNoFill !== false ? 'checked' : ''}
                        title="Draw the marker as an open circle: its edge only (at least 1 px wide)">
                    <label class="form-check-label" for="focused-no-fill-${id}">No fill</label>
                </div>
            </div>
            <div class="d-flex align-items-center gap-2">
                <label class="form-label mb-0 me-2">Edge</label>
                <input type="color" class="form-control form-control-sm form-control-color"
                    id="focused-edge-color-${id}" value="${plotColour(settings, 'focusedEdgeColor')}" title="Choose the edge colour of the focused marker">
                <button class="btn btn-sm btn-outline-secondary" id="reset-focused-edge-color-${id}" ${resetState(settings, 'focusedEdgeColor')}>Reset</button>
            </div>
        `)}
        ${details(id, 'legend', 'Legend and colour bar', `
            <div class="form-check form-switch mb-2">
                <input class="form-check-input" type="checkbox" id="show-legend-${id}" 
                    ${settings.showLegend !== false ? 'checked' : ''}>
                <label class="form-check-label" for="show-legend-${id}">Show Legend</label>
            </div>
            
            <div class="mb-2">
                <label class="form-label mb-1">Legend Position</label>
                <select class="form-select form-select-sm" id="legend-position-${id}">
                    <option value="right" ${(settings.legendPosition === 'right') ? 'selected' : ''}>Right</option>
                    <option value="left" ${(settings.legendPosition === 'left') ? 'selected' : ''}>Left</option>
                    <option value="top" ${(settings.legendPosition === 'top') ? 'selected' : ''}>Top</option>
                    <option value="bottom" ${(settings.legendPosition === 'bottom') ? 'selected' : ''}>Bottom</option>
                </select>
            </div>
            <!-- Legend of a categorical colouring: title, dots, columns -->
            <div class="mb-2">
                <div class="form-check form-switch mb-1">
                    <input class="form-check-input" type="checkbox" id="show-legend-title-${id}"
                        ${settings.showLegendTitle !== false ? 'checked' : ''}>
                    <label class="form-check-label" for="show-legend-title-${id}">Legend title</label>
                </div>
                <div class="input-group input-group-sm mb-1">
                    <span class="input-group-text">Title size</span>
                    <input type="number" class="form-control" id="legend-title-size-${id}" value="${settings.legendTitleSize ?? ''}"
                        placeholder="${legendTitleSize({ fontSize: settings.fontSize })}" min="${TITLE_SIZE_MIN}" max="${TITLE_SIZE_MAX}" step="1"
                        title="Size of the legend title; empty: 2 px above the text size">
                    <span class="input-group-text">px</span>
                    <button class="btn btn-outline-secondary" type="button" id="reset-legend-title-size-${id}" title="Back to the default size"
                        ${settings.legendTitleSize == null ? 'disabled' : ''}>Reset</button>
                </div>
                <div class="input-group input-group-sm mb-1">
                    <span class="input-group-text">Title gap</span>
                    <input type="number" class="form-control" id="legend-title-gap-${id}" value="${settings.legendTitleGap ?? ''}"
                        placeholder="auto" min="0" max="${TITLE_GAP_MAX}" step="1"
                        title="Space between the legend title and the first entry; empty: one blank line">
                    <span class="input-group-text">px</span>
                    <button class="btn btn-outline-secondary" type="button" id="reset-legend-title-gap-${id}" title="Back to the default gap"
                        ${settings.legendTitleGap == null ? 'disabled' : ''}>Reset</button>
                </div>
                <div class="input-group input-group-sm mb-1">
                    <span class="input-group-text">Dot size</span>
                    <input type="number" class="form-control" id="legend-dot-size-${id}" value="${settings.legendDotSize ?? ''}"
                        placeholder="${DOT_SIZE_AUTO}" min="${DOT_SIZE_MIN}" max="${DOT_SIZE_MAX}" step="1"
                        title="Size of the dots in the legend of a categorical colouring, independent of the points' size; empty: ${DOT_SIZE_AUTO} px">
                    <span class="input-group-text">px</span>
                    <button class="btn btn-outline-secondary" type="button" id="reset-legend-dot-size-${id}" title="Back to the default dots"
                        ${settings.legendDotSize == null ? 'disabled' : ''}>Reset</button>
                </div>
                <div class="input-group input-group-sm">
                    <span class="input-group-text">Columns</span>
                    <input type="number" class="form-control" id="legend-columns-${id}" value="${settings.legendColumns ?? ''}"
                        placeholder="1" min="1" max="${COLUMNS_MAX}" step="1"
                        title="Lay the legend out in this many columns; 1 or empty: one column. Labels too long for that many columns give fewer.">
                    <button class="btn btn-outline-secondary" type="button" id="reset-legend-columns-${id}" title="Back to one column"
                        ${settings.legendColumns == null ? 'disabled' : ''}>Reset</button>
                </div>
            </div>
            <!-- Colour bar -->
            <div class="mb-2">
                <label class="form-label mb-1">Colour bar</label>
                <select class="form-select form-select-sm mb-1" id="colorbar-position-${id}" title="Position">
                    ${COLORBAR_POSITIONS.map(c => `<option value="${c}" ${settings.colorbarPosition === c ? 'selected' : ''}>${c === 'legend' ? 'with the legend' : c}</option>`).join('')}
                </select>
                <div class="d-flex align-items-center gap-2 mb-1">
                    <span class="small text-nowrap">Length</span>
                    <input type="range" class="form-range flex-grow-1" id="colorbar-length-${id}" min="10" max="100" step="5"
                        value="${Math.round(settings.colorbarLength * 100)}" title="Length of the colour bar, % of the plot">
                    <span class="small text-nowrap" id="colorbar-length-value-${id}">${Math.round(settings.colorbarLength * 100)}%</span>
                </div>
                <div class="input-group input-group-sm">
                    <span class="input-group-text">Ticks</span>
                    <input type="number" class="form-control" id="colorbar-ticks-${id}" value="${settings.colorbarTicks ?? ''}"
                        placeholder="auto" min="2" max="30" step="1">
                </div>
            </div>

        `)}
        ${details(id, 'text', 'Text', `
            <!-- Font Settings -->
            <div class="mb-2">
                <label class="form-label mb-1">Font</label>
                <select class="form-select form-select-sm mb-2" id="font-family-${id}">
                    <option value="Arial, Helvetica, sans-serif" ${settings.fontFamily === 'Arial, Helvetica, sans-serif' ? 'selected' : ''}>Arial</option>
                    <option value="'Times New Roman', Times, serif" ${settings.fontFamily === "'Times New Roman', Times, serif" ? 'selected' : ''}>Times New Roman</option>
                    <option value="Courier, monospace" ${settings.fontFamily === 'Courier, monospace' ? 'selected' : ''}>Courier</option>
                    <option value="Georgia, serif" ${settings.fontFamily === 'Georgia, serif' ? 'selected' : ''}>Georgia</option>
                    <option value="'Trebuchet MS', sans-serif" ${settings.fontFamily === "'Trebuchet MS', sans-serif" ? 'selected' : ''}>Trebuchet MS</option>
                    <option value="Verdana, sans-serif" ${settings.fontFamily === 'Verdana, sans-serif' ? 'selected' : ''}>Verdana</option>
                </select>
                
                <div class="input-group input-group-sm mb-2">
                    <span class="input-group-text">Size</span>
                    <input type="number" class="form-control" id="font-size-${id}" 
                        value="${settings.fontSize || 12}" min="8" max="24" step="1">
                    <span class="input-group-text">px</span>
                    <button class="btn btn-outline-secondary" type="button" id="reset-font-size-${id}" title="Back to the default size"
                        ${(settings.fontSize || 12) === 12 ? 'disabled' : ''}>Reset</button>
                </div>
                
                <div class="d-flex align-items-center gap-2">
                    <label class="form-label mb-0 me-2">Color</label>
                    <input type="color" class="form-control form-control-sm form-control-color" 
                        id="text-color-${id}" value="${plotColour(settings, 'textColor')}" title="Choose text color">
                    <button class="btn btn-sm btn-outline-secondary" id="reset-text-color-${id}">Reset</button>
                </div>
            </div>
        `)}
        ${details(id, 'margins', 'Margins', `
            <div class="d-flex align-items-center gap-2 mb-1">
                <input type="range" class="form-range flex-grow-1" id="margin-all-${id}" min="0" max="200" step="1"
                    value="${marginsLinkedValue}" ${settings.marginsUnlinked ? 'disabled' : ''} title="All four sides">
                <input type="number" class="form-control form-control-sm" style="width: 4.5rem" id="margin-all-input-${id}"
                    value="${marginsLinkedValue}" min="0" max="200" ${settings.marginsUnlinked ? 'disabled' : ''}>
            </div>
            <div class="form-check form-switch mb-2">
                <input class="form-check-input" type="checkbox" id="margins-unlink-${id}" ${settings.marginsUnlinked ? 'checked' : ''}>
                <label class="form-check-label" for="margins-unlink-${id}">Set each side separately</label>
            </div>
            <div class="row g-2 ${settings.marginsUnlinked ? '' : 'd-none'}" id="margin-sides-${id}">
                <div class="col-6">
                    <label class="form-label mb-1">Top</label>
                    <input type="number" class="form-control form-control-sm margin-input" id="margin-top-${id}"
                        value="${marginTop}" min="0" max="200">
                </div>
                <div class="col-6">
                    <label class="form-label mb-1">Bottom</label>
                    <input type="number" class="form-control form-control-sm margin-input" id="margin-bottom-${id}"
                        value="${marginBottom}" min="0" max="200">
                </div>
                <div class="col-6">
                    <label class="form-label mb-1">Left</label>
                    <input type="number" class="form-control form-control-sm margin-input" id="margin-left-${id}"
                        value="${marginLeft}" min="0" max="200">
                </div>
                <div class="col-6">
                    <label class="form-label mb-1">Right</label>
                    <input type="number" class="form-control form-control-sm margin-input" id="margin-right-${id}"
                        value="${marginRight}" min="0" max="200">
                </div>
            </div>
            <button class="btn btn-sm btn-outline-secondary w-100 mt-2" id="reset-margins-${id}">Reset Margins</button>
        `)}
        ${details(id, 'export', 'Export', `
            ${exportButtonsHtml(id, settings)}
            
            <div class="mb-2">
                <label class="form-label mb-1">Dimensions</label>
                <div class="input-group input-group-sm mb-1">
                    <span class="input-group-text">Width</span>
                    <input type="number" class="form-control" id="plot-width-${id}" 
                        value="${settings.exportWidth || 1200}" min="100" max="5000">
                    <span class="input-group-text">px</span>
                </div>
                <div class="input-group input-group-sm">
                    <span class="input-group-text">Height</span>
                    <input type="number" class="form-control" id="plot-height-${id}" 
                        value="${settings.exportHeight || 800}" min="100" max="5000">
                    <span class="input-group-text">px</span>
                </div>
            </div>
            <div class="form-check form-switch mb-2">
                <input class="form-check-input" type="checkbox" id="scale-export-${id}" ${exportOptions(settings).scale > 1 ? 'checked' : ''}>
                <label class="form-check-label" for="scale-export-${id}"
                    title="Draw the image at twice the width and height, so it stays sharp in print; the PNG, JPEG and WEBP files are then twice the pixels set above">Export at 2x</label>
            </div>
            
        `)}
        ${details(id, 'apply', 'Apply to other panels', `

            <div id="apply-others-ask-${id}" class="d-none">
                <div class="small mb-1" id="apply-others-text-${id}"></div>
                <div class="d-flex gap-2">
                    <button type="button" class="btn btn-sm btn-primary flex-fill" id="apply-others-yes-${id}">Apply</button>
                    <button type="button" class="btn btn-sm btn-outline-secondary flex-fill" id="apply-others-no-${id}">Cancel</button>
                </div>
            </div>
            <button type="button" class="btn btn-sm btn-outline-secondary w-100" id="apply-others-${id}"
                title="Copy this plot's look (colours, axes, ticks, text, margins, legend, colour bar, scale bar, Not in table) to the other ${plotKind} plots. What they show is not touched.">Apply to other panels</button>
            <div class="small mt-1" id="apply-others-done-${id}" role="status"></div>
            <div class="d-flex align-items-center gap-2 small text-muted mt-2 mb-1">
                <span id="session-style-state-${id}">${settings.styleDefault === true ? 'On Default' : 'Own style'}</span>
                <a href="https://annzarro.readthedocs.io/en/latest/user-guide/plot-options.html#session-default-style" target="_blank" rel="noopener"
                    class="ms-auto" title="Guide: the session default style">Guide</a>
            </div>
            <button type="button" class="btn btn-sm btn-outline-secondary w-100" id="session-style-set-${id}"
                title="Make this the session default: every ${plotKind} plot on Default takes this look, now and when you change it. Plots with a look of their own keep it. It lasts for the session and travels with links, the autosave and panel sets.">Make this the session default</button>
            <button type="button" class="btn btn-sm btn-outline-secondary w-100 mt-1 ${hasSessionStyle(`${plotKind}-plot`) ? '' : 'd-none'}" id="session-style-reset-${id}"
                title="End the session default: ${plotKind} plots on Default are in the built-in style again">Reset to built-in default</button>
        `)}
    </div>
    `;
}

export { exportOptions };

const EXPORT_ADVICE = 'Export it as shown instead, close a plot, or show fewer cells.';

/**
 * The export buttons. A full-resolution export draws the plot again, which
 * needs about as much browser memory as the plot itself; when that does not
 * fit (utils/memory-guard-ui.js) its buttons are disabled with the reason
 * written under them, and the plot as shown on screen, which costs only its
 * pixels, is offered beside them.
 */
function exportButtonsHtml(id, settings) {
  const gd = document.getElementById(`plot-container-${id}`);
  let check;
  try { check = gd && gd._fullLayout ? exportCheck(gd, exportOptions(settings)) : null; } catch { check = null; }
  const blocked = !!check && check.verdict === 'block';
  const short = !!check && !check.fits;
  const why = short ? refusalText(check, EXPORT_ADVICE) : '';
  const off = blocked ? ` disabled aria-disabled="true" title="${escapeAttr(why)}"` : '';
  const full = ['jpeg', 'svg', 'webp', 'png'].map(f =>
    `<button class="btn btn-sm btn-outline-primary export-btn" data-format="${f}" data-how="full" id="download-${f}-${id}" data-id="${id}"${off}>
                    <i class="fas fa-file-image"></i> ${f.toUpperCase()}
                </button>`).join('');
  let shown = '';
  if (short && gd && canSnapshot(gd)) {
    const { width, height } = snapshotSize(gd);
    shown = `<div class="d-flex flex-wrap gap-2 mb-1 export-shown-row">
                <span class="small align-self-center">As shown (${width} \u00d7 ${height} px):</span>
                ${['png', 'svg'].map(f => `<button class="btn btn-sm btn-outline-primary export-btn" data-format="${f}" data-how="shown"
                    id="download-shown-${f}-${id}" data-id="${id}" title="The plot as it is on screen; needs only its pixels">
                    <i class="fas fa-camera"></i> ${f.toUpperCase()}</button>`).join('')}
            </div>`;
  }
  const note = short
    ? `<div class="small mb-2 export-memory-note ${blocked ? 'text-danger' : 'text-warning-emphasis'}" role="note">${escapeAttr(
        blocked ? `Full resolution: ${why}` : `Full resolution may run out of memory: ${why}`)}</div>`
    : '';
  return `<div class="d-flex flex-wrap gap-2 mb-2">${full}</div>${note}${shown}`;
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Initialize the settings object with default aesthetic settings if they don't exist
 * @param {Object} settings - The settings object to initialize
 */
export function initializeAestheticsSettings(settings) {
    // Import default aesthetics from Config
    const defaults = (window.Config && window.Config.DEFAULTS && window.Config.DEFAULTS.PLOT_AESTHETICS) || {
        // Grid settings
        SHOW_GRID: true,
        
        // Axes settings
        SHOW_AXIS_TITLES: true,
        SHOW_AXIS_LABELS: true,
        SHOW_AXIS_LINES: true,
        SHOW_ZERO_LINES: false,
        
        // Default colors (light theme)
        BG_COLOR: '#ffffff',
        GRID_COLOR: '#e6e6e6',
        AXIS_COLOR: '#000000',
        TEXT_COLOR: '#000000',
        ZERO_LINE_COLOR: '#cccccc',
        
        // Dark theme colors
        DARK_THEME: {
            BG_COLOR: '#1e1e1e',
            GRID_COLOR: '#444444',
            AXIS_COLOR: '#ffffff',
            TEXT_COLOR: '#ffffff',
            ZERO_LINE_COLOR: '#666666'
        },
        
        // Fonts
        FONT_SIZE: 12,
        FONT_FAMILY: 'Arial, Helvetica, sans-serif',
        
        // Margins
        MARGINS: { l: 80, r: 80, t: 80, b: 60, pad: 4 },
        
        // Legend settings
        SHOW_LEGEND: true,
        LEGEND_POSITION: 'right',
        
        // Export options
        EXPORT_WIDTH: 1200,
        EXPORT_HEIGHT: 800,
        SCALE_EXPORT: true,
        
        // Interaction settings
        ENABLE_ZOOM: true,
        ENABLE_PAN: true,
        SHOW_HOVER_INFO: true
    };
    
    // Grid and visibility
    settings.showGrid = settings.showGrid !== undefined ? settings.showGrid : defaults.SHOW_GRID;
    settings.showAxisTitles = settings.showAxisTitles !== undefined ? settings.showAxisTitles : defaults.SHOW_AXIS_TITLES;
    settings.showAxisLabels = settings.showAxisLabels !== undefined ? settings.showAxisLabels : defaults.SHOW_AXIS_LABELS;
    settings.showAxisLines = settings.showAxisLines !== undefined ? settings.showAxisLines : defaults.SHOW_AXIS_LINES;
    settings.showZeroLines = settings.showZeroLines !== undefined ? settings.showZeroLines : defaults.SHOW_ZERO_LINES;
    settings.showLegend = settings.showLegend !== undefined ? settings.showLegend : defaults.SHOW_LEGEND;
    
    // Colours are not filled in: a colour that is not set follows the app theme
    // (utils/plot-theme.js). normalizePlotOptions below migrates an older link.
    
    // 3D Backdrop settings
    settings.showBackdrop = settings.showBackdrop !== undefined ? settings.showBackdrop : defaults.SHOW_BACKDROP;
    
    // Line width settings
    settings.axisLineWidth = settings.axisLineWidth || defaults.AXIS_LINE_WIDTH || 1;
    settings.gridLineWidth = settings.gridLineWidth || defaults.GRID_LINE_WIDTH || 1;
    settings.zeroLineWidth = settings.zeroLineWidth || defaults.ZERO_LINE_WIDTH || 1;
    
    // Tick settings
    settings.tickDensity = settings.tickDensity || defaults.TICK_DENSITY || 'auto';
    
    // Fonts and sizing
    settings.fontSize = settings.fontSize || defaults.FONT_SIZE;
    settings.fontFamily = settings.fontFamily || defaults.FONT_FAMILY;
    
    // Margins
    settings.margins = settings.margins || { ...defaults.MARGINS };
    
    // Export options
    settings.exportWidth = settings.exportWidth || defaults.EXPORT_WIDTH;
    settings.exportHeight = settings.exportHeight || defaults.EXPORT_HEIGHT;
    settings.scaleExport = settings.scaleExport !== undefined ? settings.scaleExport : defaults.SCALE_EXPORT;
    
    // Legend settings
    settings.legendPosition = settings.legendPosition || defaults.LEGEND_POSITION;
    
    // Interaction settings
    settings.enableZoom = settings.enableZoom !== undefined ? settings.enableZoom : defaults.ENABLE_ZOOM;
    settings.enablePan = settings.enablePan !== undefined ? settings.enablePan : defaults.ENABLE_PAN;
    settings.showHoverInfo = settings.showHoverInfo !== undefined ? settings.showHoverInfo : defaults.SHOW_HOVER_INFO;

    // Options added later (ticks, colour bar, scale bar, margin link): defaults for configs without them
    normalizePlotOptions(settings);
}

/**
 * Setup event listeners for the aesthetics menu
 * @param {HTMLElement} container - Container element
 * @param {Object} settings - Plot settings object
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {string} id - Panel ID
 */
/**
 * Helper function to extract panel ID from container or plot container
 * @param {HTMLElement} element - Container or plot container
 * @returns {string} - The panel ID
 */
function getPanelId(element) {
    if (!element) return '';
    
    // First try direct ID attribute
    if (element.id) {
        if (element.id.startsWith('plot-container-')) {
            return element.id.replace('plot-container-', '');
        }
    }
    
    // Try to find it from the container
    const plotContainer = element.querySelector('[id^="plot-container-"]');
    if (plotContainer && plotContainer.id) {
        return plotContainer.id.replace('plot-container-', '');
    }
    
    // If all else fails, try to find it from the parent
    const parentPanel = element.closest('.panel');
    if (parentPanel && parentPanel.id) {
        return parentPanel.id;
    }
    
    return '';
}

export function setupAestheticsMenuListeners(container, settings, plotContainer, id) {
    // Ensure settings are initialized
    initializeAestheticsSettings(settings);
    if (plotContainer) plotContainer.__exportOptions = () => exportOptions(settings);
    
    // Create one-time event handlers using delegation for all menu controls
    const handleMenuEvent = function(e) {
        // Find the element that triggered the event
        const target = e.target;
        
        // Grid toggle
        if (target.id === `grid-toggle-${id}`) {
            settings.showGrid = target.checked;
            toggleGrid(plotContainer, settings);
            notifySettingsChanged(id, 'showGrid', settings.showGrid);
            return;
        }
        
        // Background color
        if (target.id === `plot-bg-color-${id}`) {
            settings.bgColor = target.value;
            updatePlotBackground(plotContainer, settings);
            notifySettingsChanged(id, 'bgColor', plotColour(settings, 'bgColor'));
            return;
        }
        
        // Reset bgColor: follow the app theme again
        if (target.id === `reset-bg-color-${id}`) {
            followTheme(settings, ['bgColor']);
            updateColorInputs(container, id, settings);
            updatePlotBackground(plotContainer, settings);
            notifySettingsChanged(id, 'bgColor', settings.bgColor);
            return;
        }
        
        // Toggle 3D backdrop visibility
        if (target.id === `show-backdrop-${id}`) {
            settings.showBackdrop = target.checked;
            update3DBackdrop(plotContainer, settings);
            notifySettingsChanged(id, 'showBackdrop', settings.showBackdrop);
            return;
        }
        
        // 3D Backdrop color
        if (target.id === `backdrop-color-${id}`) {
            settings.backdropColor = target.value;
            update3DBackdrop(plotContainer, settings);
            notifySettingsChanged(id, 'backdropColor', plotColour(settings, 'backdropColor'));
            return;
        }
        
        // Reset backdropColor: follow the app theme again
        if (target.id === `reset-backdrop-color-${id}`) {
            followTheme(settings, ['backdropColor']);
            updateColorInputs(container, id, settings);
            update3DBackdrop(plotContainer, settings);
            notifySettingsChanged(id, 'backdropColor', settings.backdropColor);
            return;
        }
        
        // Text color
        if (target.id === `text-color-${id}`) {
            settings.textColor = target.value;
            updateTextColor(plotContainer, settings);
            notifySettingsChanged(id, 'textColor', plotColour(settings, 'textColor'));
            return;
        }
        
        // Reset textColor: follow the app theme again
        if (target.id === `reset-text-color-${id}`) {
            followTheme(settings, ['textColor']);
            updateColorInputs(container, id, settings);
            updateTextColor(plotContainer, settings);
            notifySettingsChanged(id, 'textColor', settings.textColor);
            return;
        }
        
        // Grid color
        if (target.id === `grid-color-${id}`) {
            settings.gridColor = target.value;
            updateGridColor(plotContainer, settings);
            notifySettingsChanged(id, 'gridColor', plotColour(settings, 'gridColor'));
            return;
        }
        
        // Reset gridColor: follow the app theme again
        if (target.id === `reset-grid-color-${id}`) {
            followTheme(settings, ['gridColor']);
            updateColorInputs(container, id, settings);
            updateGridColor(plotContainer, settings);
            notifySettingsChanged(id, 'gridColor', settings.gridColor);
            return;
        }
        
        // Axis color
        if (target.id === `axis-color-${id}`) {
            settings.axisColor = target.value;
            updateAxisColor(plotContainer, settings);
            notifySettingsChanged(id, 'axisColor', plotColour(settings, 'axisColor'));
            return;
        }
        
        // Reset axisColor: follow the app theme again
        if (target.id === `reset-axis-color-${id}`) {
            followTheme(settings, ['axisColor']);
            updateColorInputs(container, id, settings);
            updateAxisColor(plotContainer, settings);
            notifySettingsChanged(id, 'axisColor', settings.axisColor);
            return;
        }
        
        // Zero line color
        if (target.id === `zero-line-color-${id}`) {
            settings.zeroLineColor = target.value;
            updateZeroLineColor(plotContainer, settings);
            notifySettingsChanged(id, 'zeroLineColor', plotColour(settings, 'zeroLineColor'));
            return;
        }
        
        // Reset zeroLineColor: follow the app theme again
        if (target.id === `reset-zero-line-color-${id}`) {
            followTheme(settings, ['zeroLineColor']);
            updateColorInputs(container, id, settings);
            updateZeroLineColor(plotContainer, settings);
            notifySettingsChanged(id, 'zeroLineColor', settings.zeroLineColor);
            return;
        }
        
        // Axis title visibility
        if (target.id === `show-axis-titles-${id}`) {
            settings.showAxisTitles = target.checked;
            updateAxisVisibility(plotContainer, settings);
            notifySettingsChanged(id, 'showAxisTitles', settings.showAxisTitles);
            return;
        }
        
        // Axis label visibility
        if (target.id === `show-axis-labels-${id}`) {
            settings.showAxisLabels = target.checked;
            updateAxisVisibility(plotContainer, settings);
            notifySettingsChanged(id, 'showAxisLabels', settings.showAxisLabels);
            return;
        }
        
        // Axis line visibility
        if (target.id === `show-axis-lines-${id}`) {
            settings.showAxisLines = target.checked;
            updateAxisVisibility(plotContainer, settings);
            notifySettingsChanged(id, 'showAxisLines', settings.showAxisLines);
            return;
        }
        
        // Zero line visibility
        if (target.id === `zero-lines-${id}`) {
            settings.showZeroLines = target.checked;
            updateAxisVisibility(plotContainer, settings);
            notifySettingsChanged(id, 'showZeroLines', settings.showZeroLines);
            return;
        }
        
        // Axis direction (a view setting: not in STYLE_KEYS, so no copy and no preset touches it)
        if (target.id === `flip-x-${id}` || target.id === `flip-y-${id}`) {
            const key = target.id === `flip-x-${id}` ? 'flipX' : 'flipY';
            settings[key] = target.checked;
            const fl = plotContainer._fullLayout;
            if (fl && !settings.z) {
                Promise.resolve(Plotly.relayout(plotContainer, flipRelayout(settings, fl)))
                    .then(() => refreshScaleBar(plotContainer, settings))
                    .catch(err => console.warn('Axis direction not changed:', err && err.message));
            }
            notifySettingsChanged(id, key, settings[key]);
            return;
        }

        // Axis line width
        if (target.id === `axis-line-width-${id}`) {
            settings.axisLineWidth = parseFloat(target.value);
            updateLineWidths(plotContainer, settings);
            notifySettingsChanged(id, 'axisLineWidth', settings.axisLineWidth);
            return;
        }
        
        // Grid line width
        if (target.id === `grid-line-width-${id}`) {
            settings.gridLineWidth = parseFloat(target.value);
            updateLineWidths(plotContainer, settings);
            notifySettingsChanged(id, 'gridLineWidth', settings.gridLineWidth);
            return;
        }
        
        // Zero line width
        if (target.id === `zero-line-width-${id}`) {
            settings.zeroLineWidth = parseFloat(target.value);
            updateLineWidths(plotContainer, settings);
            notifySettingsChanged(id, 'zeroLineWidth', settings.zeroLineWidth);
            return;
        }
        
        
        // Font family change
        if (target.id === `font-family-${id}`) {
            settings.fontFamily = target.value;
            updateFontFamily(plotContainer, settings);
            notifySettingsChanged(id, 'fontFamily', settings.fontFamily);
            return;
        }
        
        // Font size change
        if (target.id === `font-size-${id}`) {
            settings.fontSize = parseInt(target.value, 10);
            updateFontSize(plotContainer, settings);
            notifySettingsChanged(id, 'fontSize', settings.fontSize);
            syncOptionResets(id, settings);
            return;
        }
        if (target.id === `reset-font-size-${id}`) {
            settings.fontSize = 12;
            document.getElementById(`font-size-${id}`).value = 12;
            updateFontSize(plotContainer, settings);
            notifySettingsChanged(id, 'fontSize', settings.fontSize);
            syncOptionResets(id, settings);
            return;
        }
        
        // Margin changes
        if (target.id === `margin-top-${id}`) {
            settings.margins.t = parseInt(target.value, 10);
            updateMargins(plotContainer, settings);
            notifySettingsChanged(id, 'margins', settings.margins);
            return;
        }
        
        if (target.id === `margin-bottom-${id}`) {
            settings.margins.b = parseInt(target.value, 10);
            updateMargins(plotContainer, settings);
            notifySettingsChanged(id, 'margins', settings.margins);
            return;
        }
        
        if (target.id === `margin-left-${id}`) {
            settings.margins.l = parseInt(target.value, 10);
            updateMargins(plotContainer, settings);
            notifySettingsChanged(id, 'margins', settings.margins);
            return;
        }
        
        if (target.id === `margin-right-${id}`) {
            settings.margins.r = parseInt(target.value, 10);
            updateMargins(plotContainer, settings);
            notifySettingsChanged(id, 'margins', settings.margins);
            return;
        }
        
        // Reset margins
        if (target.id === `reset-margins-${id}`) {
            // Default margins
            settings.margins = { l: 80, r: 80, t: 80, b: 60, pad: 4 };
            
            settings.marginsUnlinked = false;
            syncMarginInputs(id, settings);
            
            // Apply the changes to the plot
            updateMargins(plotContainer, settings);
            notifySettingsChanged(id, 'margins', settings.margins);
            return;
        }
        
        // Legend visibility
        if (target.id === `show-legend-${id}`) {
            settings.showLegend = target.checked;
            updateLegendVisibility(plotContainer, settings);
            notifySettingsChanged(id, 'showLegend', settings.showLegend);
            return;
        }
        
        // Legend position - only update when selection changes, not on dropdown open
        if (target.id === `legend-position-${id}` && e.type === 'change') {
            settings.legendPosition = target.value;
            updateLegendPosition(plotContainer, settings);
            notifySettingsChanged(id, 'legendPosition', settings.legendPosition);
            return;
        }
        
        // Legend of a categorical colouring: title, dot size, columns
        if (target.id === `show-legend-title-${id}`) {
            settings.showLegendTitle = target.checked;
            applyLegendOptions(plotContainer, settings);
            notifySettingsChanged(id, 'showLegendTitle', settings.showLegendTitle);
            return;
        }
        const legendBox = LEGEND_BOXES.find(b => target.id === `${b.box}-${id}`);
        if (legendBox) {
            const n = parseInt(target.value, 10);
            if (target.value !== '' && !(n >= legendBox.min)) return;
            // empty is unset, and so is one column
            settings[legendBox.key] = target.value === '' || (legendBox.key === 'legendColumns' && n === 1) ? null : Math.min(n, legendBox.max);
            applyLegendOptions(plotContainer, settings,
                getPositioningByLocation(settings.legendPosition || 'right').legendOrientation);
            notifySettingsChanged(id, legendBox.key, settings[legendBox.key]);
            syncOptionResets(id, settings);
            return;
        }
        const legendReset = LEGEND_BOXES.find(b => target.id === `reset-${b.box}-${id}`);
        if (legendReset) {
            settings[legendReset.key] = null;
            document.getElementById(`${legendReset.box}-${id}`).value = '';
            applyLegendOptions(plotContainer, settings,
                getPositioningByLocation(settings.legendPosition || 'right').legendOrientation);
            notifySettingsChanged(id, legendReset.key, null);
            syncOptionResets(id, settings);
            return;
        }

        // Margins: one value for all four sides, or each side
        if (target.id === `margin-all-${id}` || target.id === `margin-all-input-${id}`) {
            const v = parseFloat(target.value);
            if (!Number.isFinite(v)) return;
            settings.margins = linkedMargins(settings, v);
            syncMarginInputs(id, settings);
            updateMargins(plotContainer, settings);
            return;
        }
        if (target.id === `margins-unlink-${id}`) {
            settings.marginsUnlinked = target.checked;
            if (!target.checked) settings.margins = linkedMargins(settings, settings.margins.t);   // one value again: the top one
            syncMarginInputs(id, settings);
            updateMargins(plotContainer, settings);
            return;
        }

        // Ticks
        if (target.id === `show-tick-marks-${id}`) {
            settings.showTickMarks = target.checked;
            relayoutTicks(plotContainer, settings);
            return;
        }
        if (target.id === `tick-count-${id}`) {
            const n = parseInt(target.value, 10);
            if (target.value !== '' && !(n >= 2)) return;
            settings.tickCount = target.value === '' ? null : Math.min(n, 30);
            relayoutTicks(plotContainer, settings);
            return;
        }

        // Colour bar
        if (target.id === `colorbar-position-${id}`) {
            settings.colorbarPosition = target.value;
            updateLegendPosition(plotContainer, settings);
            return;
        }
        if (target.id === `colorbar-length-${id}`) {
            settings.colorbarLength = Math.max(0.1, Math.min(1, parseInt(target.value, 10) / 100));
            const out = document.getElementById(`colorbar-length-value-${id}`);
            if (out) out.textContent = `${Math.round(settings.colorbarLength * 100)}%`;
            updateLegendPosition(plotContainer, settings);
            return;
        }
        if (target.id === `colorbar-ticks-${id}`) {
            const n = parseInt(target.value, 10);
            if (target.value !== '' && !(n >= 2)) return;
            settings.colorbarTicks = target.value === '' ? null : Math.min(n, 30);
            updateLegendPosition(plotContainer, settings);
            return;
        }

        // Spatial scale bar
        if (target.id === `show-scale-bar-${id}`) {
            settings.showScaleBar = target.checked;
            refreshScaleBar(plotContainer, settings);
            return;
        }
        if (target.id === `scale-bar-size-${id}`) {
            settings.scaleBarSize = Math.max(0.25, Math.min(4, parseInt(target.value, 10) / 100));
            const out = document.getElementById(`scale-bar-size-value-${id}`);
            if (out) out.textContent = `${Math.round(settings.scaleBarSize * 100)}%`;
            refreshScaleBar(plotContainer, settings);
            return;
        }
        if (target.id === `scale-bar-unit-${id}`) {
            settings.scaleBarUnit = target.value.trim().slice(0, 20);
            refreshScaleBar(plotContainer, settings);
            return;
        }
        if (target.id === `scale-bar-corner-${id}`) {
            settings.scaleBarCorner = target.value;
            refreshScaleBar(plotContainer, settings);
            return;
        }

        // Presets
        const preset = ['publication', 'bare', 'default'].find(name => target.id === `preset-${name}-${id}`);
        if (preset && e.type === 'click') {
            if (preset === 'default') followSessionDefault(settings, `${plotKindOf(settings)}-plot`);
            else applyPreset(settings, preset);
            relookPlot(plotContainer, settings);
            // the menu shows the new values: drawn again, the open groups as they are
            const body = document.querySelector('.aesthetics-popover .popover-body');
            if (body) body.innerHTML = createPopoverContent(id, settings);
            return;
        }

        // Apply this panel's look to the other plots of its kind, after a confirm in the menu
        if (target.id === `apply-others-${id}` && e.type === 'click') {
            const n = otherPlots(id).length;
            const text = document.getElementById(`apply-others-text-${id}`);
            const done = document.getElementById(`apply-others-done-${id}`);
            if (done) done.textContent = '';
            if (!n) {
                if (done) done.textContent = 'There are no other plots of this kind.';
                return;
            }
            if (text) text.textContent = `Replace the look of ${n} other plot${n === 1 ? '' : 's'} with this one's?`;
            document.getElementById(`apply-others-ask-${id}`)?.classList.remove('d-none');
            target.classList.add('d-none');
            return;
        }
        if ((target.id === `apply-others-no-${id}` || target.id === `apply-others-yes-${id}`) && e.type === 'click') {
            document.getElementById(`apply-others-ask-${id}`)?.classList.add('d-none');
            document.getElementById(`apply-others-${id}`)?.classList.remove('d-none');
            if (target.id === `apply-others-yes-${id}`) {
                const n = applyLookToOthers(id, settings);
                const done = document.getElementById(`apply-others-done-${id}`);
                if (done) done.textContent = `Applied to ${n} plot${n === 1 ? '' : 's'}.`;
            }
            return;
        }

        // The session default look: make this plot's the default, or go back to the built-in one
        if ((target.id === `session-style-set-${id}` || target.id === `session-style-reset-${id}`) && e.type === 'click') {
            const kind = plotKindOf(settings);
            const type = `${kind}-plot`;
            const reset = target.id === `session-style-reset-${id}`;
            if (reset) clearSessionStyle(type);
            else {
                const isSet = setSessionStyle(type, settings, builtinStyle());
                settings.styleDefault = true;       // its look is the default now
                if (!isSet) clearSessionStyle(type);
            }
            document.getElementById(`session-style-reset-${id}`)?.classList.toggle('d-none', !hasSessionStyle(type));
            const state = document.getElementById(`session-style-state-${id}`);
            if (state) state.textContent = settings.styleDefault === true ? 'On Default' : 'Own style';
            return;
        }

        // Not in table points: size scale, opacity, colour (greyMarker)
        if (target.id === `not-in-table-scale-${id}` || target.id === `not-in-table-opacity-${id}`
            || target.id === `not-in-table-color-${id}` || target.id === `reset-not-in-table-color-${id}`) {
            const v = parseFloat(target.value);
            if (target.id === `not-in-table-scale-${id}`) {
                if (!(v > 0)) return;
                settings.notInTableScale = v;
            } else if (target.id === `not-in-table-opacity-${id}`) {
                if (target.value === '') delete settings.notInTableOpacity;      // auto
                else if (v > 0 && v <= 1) settings.notInTableOpacity = v;
                else return;
            } else if (target.id === `not-in-table-color-${id}`) {
                settings.notInTableColor = target.value;
            } else {
                if (e.type !== 'click') return;
                followTheme(settings, ['notInTableColor']);
                const input = container.querySelector(`#not-in-table-color-${id}`);
                if (input) input.value = plotColour(settings, 'notInTableColor');
            }
            syncColourControls(id, settings);
            restyleMarkers(plotContainer, settings).catch(err => console.warn('Not-in-table style not updated:', err && err.message));
            return;
        }

        // The focused marker: size factor, opacity, edge width, fill and edge colour (utils/focus-style.js)
        const focusKey = {
            [`focused-scale-${id}`]: 'focusedScale', [`focused-opacity-${id}`]: 'focusedOpacity',
            [`focused-edge-width-${id}`]: 'focusedEdgeWidth', [`focused-color-${id}`]: 'focusedColor',
            [`focused-edge-color-${id}`]: 'focusedEdgeColor',
            [`reset-focused-color-${id}`]: 'focusedColor', [`reset-focused-edge-color-${id}`]: 'focusedEdgeColor'
        }[target.id];
        if (target.id === `focused-no-fill-${id}`) {
            if (e.type !== 'change') return;
            if (target.checked) {
                delete settings.focusedNoFill;      // the default
                // an open circle is its edge: without one it would vanish
                if (!((settings.focusedEdgeWidth ?? FOCUS_DEFAULTS.edgeWidth) >= 1)) settings.focusedEdgeWidth = 1;
            } else settings.focusedNoFill = false;      // stored: unset means no fill
            syncFocusedFill(id, settings);
            syncColourControls(id, settings);
            restyleFocus(plotContainer, settings).catch(err => console.warn('Focused marker style not updated:', err && err.message));
            return;
        }
        if (focusKey) {
            const v = parseFloat(target.value);
            if (target.id.startsWith('reset-')) {
                if (e.type !== 'click') return;
                followTheme(settings, [focusKey]);
                const input = document.getElementById(target.id.slice('reset-'.length));   // the menu is in <body>, not the panel
                if (input) input.value = plotColour(settings, focusKey);
            } else if (focusKey === 'focusedColor' || focusKey === 'focusedEdgeColor') {
                settings[focusKey] = target.value;
            } else if (target.value === '' || (focusKey === 'focusedOpacity' && v === FOCUS_DEFAULTS.opacity)) {
                delete settings[focusKey];          // the default
            } else if (focusKey === 'focusedScale' ? v > 0 && v <= FOCUS_SCALE_MAX
                : focusKey === 'focusedOpacity' ? v > 0 && v <= 1 : v >= 0 && v <= FOCUS_EDGE_MAX) {
                // no fill: the edge is all there is of the marker, so it stays at least 1 px (judged once the entry is done)
                if (focusKey === 'focusedEdgeWidth' && settings.focusedNoFill !== false && v < 1) {
                    if (e.type !== 'change') return;
                    target.value = 1;
                    settings[focusKey] = 1;
                } else settings[focusKey] = v;
            } else return;
            syncColourControls(id, settings);
            restyleFocus(plotContainer, settings).catch(err => console.warn('Focused marker style not updated:', err && err.message));
            return;
        }

        // Export width
        if (target.id === `plot-width-${id}`) {
            settings.exportWidth = parseInt(target.value, 10);
            notifySettingsChanged(id, 'exportWidth', settings.exportWidth);
            return;
        }
        
        // Export height
        if (target.id === `plot-height-${id}`) {
            settings.exportHeight = parseInt(target.value, 10);
            notifySettingsChanged(id, 'exportHeight', settings.exportHeight);
            return;
        }
        
        // Scale export
        if (target.id === `scale-export-${id}`) {
            settings.scaleExport = target.checked;
            notifySettingsChanged(id, 'scaleExport', settings.scaleExport);
            return;
        }
        
        
        // Show hover info
        if (target.id === `show-hover-info-${id}`) {
            settings.showHoverInfo = target.checked;
            updateHoverMode(plotContainer, settings);
            notifySettingsChanged(id, 'showHoverInfo', settings.showHoverInfo);
            return;
        }
        
        // Export button handler
        const exportBtn = target.closest('.export-btn');
        if (exportBtn) {
            // a click, not the change/input events this handler also gets
            if (e.type !== 'click' || exportBtn.disabled) return;
            const format = exportBtn.getAttribute('data-format');
            const targetId = exportBtn.getAttribute('data-id');
            if (targetId === id && format) {
                exportPlot(plotContainer, format, settings, exportBtn.getAttribute('data-how') || 'full');
            }
            return;
        }
        
        // Copy to clipboard
        if (target.id === `copy-to-clipboard-${id}` || target.closest(`#copy-to-clipboard-${id}`)) {
            copyPlotToClipboard(plotContainer, settings);
            return;
        }
    };

    // A change to the look made here is a look of the plot's own: it is no longer on Default
    // (the buttons that put it on Default or set the default say so themselves)
    const menuHandler = function(e) {
        // A press in a box or a list is not a change of it (its input/change events are): handling the click
        // re-applied the option and moved the menu before the arrow of a number box had been used.
        if (e.type === 'click' && e.target.matches && e.target.matches('input[type="number"], input[type="text"], input[type="range"], input[type="color"], select')) return;
        if (settings.styleDefault !== true) return handleMenuEvent(e);
        const look = JSON.stringify(pickStyle(settings));
        handleMenuEvent(e);
        if (settings.styleDefault === true && JSON.stringify(pickStyle(settings)) !== look) settings.styleDefault = false;
    };
    
    // which sections are open: the menu opens again as it was left
    const onToggle = (e) => {
        const d = e.target;
        if (!d || d.tagName !== 'DETAILS' || d.dataset.panel !== String(id)) return;
        const open = sectionOpen.get(id) || new Set(OPEN_AT_FIRST);
        if (d.open) open.add(d.dataset.section); else open.delete(d.dataset.section);
        sectionOpen.set(id, open);
    };
    document.addEventListener('toggle', onToggle, true);   // 'toggle' does not bubble

    // An empty number box shows its default as a placeholder; the arrows step from that, not from the minimum
    const onStepKey = (e) => {
        const t = e.target;
        if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || !t.matches || !t.matches('input[type="number"][data-step-from]')) return;
        if (t.value !== '' || !t.id.endsWith(`-${id}`)) return;
        e.preventDefault();
        t.value = t.dataset.stepFrom;
        if (e.key === 'ArrowUp') t.stepUp(); else t.stepDown();
        t.dispatchEvent(new Event('input', { bubbles: true }));
        t.dispatchEvent(new Event('change', { bubbles: true }));
    };

    // Use event delegation on document body for better event handling
    document.body.addEventListener('keydown', onStepKey);
    document.body.addEventListener('click', menuHandler);
    document.body.addEventListener('change', menuHandler);
    document.body.addEventListener('input', menuHandler);
    
    // Return a cleanup function to remove listeners when needed
    return function cleanup() {
        document.removeEventListener('toggle', onToggle, true);
        document.body.removeEventListener('keydown', onStepKey);
        document.body.removeEventListener('click', menuHandler);
        document.body.removeEventListener('change', menuHandler);
        document.body.removeEventListener('input', menuHandler);
    };
}

/**
 * Draw a plot's colours again, as they are now (the pinned ones and the app
 * theme's for the rest): axes, text, background, legend and colour bar text,
 * the toolbar, the grey of points not in the table, the scale bar. Used when
 * the colours change as a set and when the app theme switches.
 */
export function relookColours(plotContainer, settings) {
    if (!plotContainer || !plotContainer._fullLayout) return;
    applyThemeColors(plotContainer, settings);
    applyAllAestheticSettings(plotContainer, settings);
    restyleMarkers(plotContainer, settings).catch(() => {});
}

/** Every open plot takes the app theme's colours for what it has not set (the theme changed); returns how many were redrawn. */
export function relookAllPlots() {
    const pm = window.PanelManager;
    if (!pm || typeof pm.getActivePanels !== 'function') return 0;
    let n = 0;
    for (const panel of pm.getActivePanels()) {
        if (!panel.getId || !panel.getConfig) continue;
        const gd = document.getElementById(`plot-container-${panel.getId()}`);
        if (!gd || !gd._fullLayout) continue;
        const settings = panel.getConfig();
        relookColours(gd, settings);
        updateColorInputs(document.body, panel.getId(), settings);     // the menu shows what is drawn
        n += 1;
    }
    return n;
}

// The app theme switching (the header toggle, the system) redraws the plots' unset colours
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener(THEME_EVENT, () => { relookAllPlots(); });
}

/** Put the margin controls in step with settings.margins. */
function syncMarginInputs(id, settings) {
    const set = (suffix, v) => { const el = document.getElementById(`${suffix}-${id}`); if (el) el.value = v; };
    set('margin-top', settings.margins.t);
    set('margin-bottom', settings.margins.b);
    set('margin-left', settings.margins.l);
    set('margin-right', settings.margins.r);
    set('margin-all', settings.margins.t);
    set('margin-all-input', settings.margins.t);
    for (const suffix of ['margin-all', 'margin-all-input']) {
        const el = document.getElementById(`${suffix}-${id}`);
        if (el) el.disabled = !!settings.marginsUnlinked;
    }
    const unlink = document.getElementById(`margins-unlink-${id}`);
    if (unlink) unlink.checked = !!settings.marginsUnlinked;
    document.getElementById(`margin-sides-${id}`)?.classList.toggle('d-none', !settings.marginsUnlinked);
}

/** Tick marks, labels and count on every axis. */
function relayoutTicks(plotContainer, settings) {
    if (!plotContainer) return;
    Plotly.relayout(plotContainer, tickKeys(settings, axisPaths(settings))).catch(() => {});
}

/** The other plots of the same kind (cell or gene) as panel `id`: their panel objects. */
function otherPlots(id) {
    const pm = window.PanelManager;
    if (!pm || typeof pm.getActivePanels !== 'function') return [];
    const mine = pm.getActivePanels().find(p => p.getId && p.getId() === id);
    if (!mine) return [];
    return pm.getActivePanels().filter(p => p !== mine && p.getType && p.getType() === mine.getType()
        && document.getElementById(`plot-container-${p.getId()}`));
}

/** The plot drawn again from its settings, as after a preset or a copied look. */
function relookPlot(plotContainer, settings) {
    if (!plotContainer || !plotContainer._fullLayout) return;
    applyAllAestheticSettings(plotContainer, settings);
    restyleMarkers(plotContainer, settings).catch(() => {});
}

/** The kind a plot's settings are of: 'cell' or 'gene'. */
function plotKindOf(settings) {
    return settings.highlightFocusedGene !== undefined ? 'gene' : 'cell';
}

/** The built-in look as pickStyle gives it: what a plot starts with before any session default. */
export function builtinStyle() {
    const fresh = {};
    initializeAestheticsSettings(fresh);
    return pickStyle(fresh);
}

/** Put `settings` on Default: the built-in look with the session default of `type` on top. */
export function followSessionDefault(settings, type) {
    adoptStyle(settings, effectiveStyle(type, builtinStyle()));
    settings.styleDefault = true;
    return settings;
}

/**
 * Draw every open plot that is on Default (of `kind`, or all) in the session's default look, or the
 * built-in one when there is none: after the default is set, changed, reset or loaded.
 */
export function restyleDefaultPlots(kind = null) {
    const pm = typeof window !== 'undefined' ? window.PanelManager : null;
    if (!pm || typeof pm.getActivePanels !== 'function') return 0;
    let n = 0;
    for (const panel of pm.getActivePanels()) {
        const type = panel.getType && panel.getType();
        if (!(type in STYLE_TYPES) || (kind && type !== kind)) continue;
        const cfg = panel.getConfig();
        if (cfg.styleDefault !== true) continue;
        followSessionDefault(cfg, type);
        const next = { styleDefault: true };
        for (const k of STYLE_KEYS) next[k] = cfg[k];            // an unset option stays unset
        panel.setConfig(next);
        relookPlot(document.getElementById(`plot-container-${panel.getId()}`), panel.getConfig());
        n++;
    }
    return n;
}

// The person set or reset the default: the plots on Default follow it at once
onSessionStyleChange(() => restyleDefaultPlots());

/** Copy the look of panel `id` onto the other plots of its kind; returns how many. */
function applyLookToOthers(id, settings) {
    const style = pickStyle(settings);
    const others = otherPlots(id);
    for (const panel of others) {
        const cfg = panel.getConfig();
        adoptStyle(cfg, style);
        const next = { styleDefault: false };                      // a look of its own, whatever the default is
        for (const k of Object.keys(style)) next[k] = cfg[k];      // an unset option stays unset
        panel.setConfig(next);
        relookPlot(document.getElementById(`plot-container-${panel.getId()}`), panel.getConfig());
    }
    return others.length;
}

/**
 * Notify that settings have changed
 * @param {string} id - Panel ID
 * @param {string} setting - Setting name
 * @param {any} value - New setting value
 */
function notifySettingsChanged(id, setting, value) {
    const event = new CustomEvent('plotSettingsChanged', { 
        detail: { id, setting, value } 
    });
    document.dispatchEvent(event);
}

/**
 * Toggle grid visibility in the plot
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
export function toggleGrid(plotContainer, settings) {
    if (!plotContainer) return;
    
    const is3D = settings.z !== null;
    const update = {
        // 2D axes - only control grid lines, not axis lines, labels, etc.
        'xaxis.showgrid': settings.showGrid,
        'yaxis.showgrid': settings.showGrid
    };
    
    // For 3D plots
    if (is3D) {
        Object.assign(update, {
            'scene.xaxis.showgrid': settings.showGrid,
            'scene.yaxis.showgrid': settings.showGrid,
            'scene.zaxis.showgrid': settings.showGrid
        });
    }
    
    Plotly.relayout(plotContainer, update);
}

/**
 * Update font family
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function updateFontFamily(plotContainer, settings) {
    applyTextFont(plotContainer, settings);
}

/**
 * The panel's text on the plot, in one place: font family, size and colour of
 * the axes (titles and tick labels), the legend (title and items) and the
 * colour bar (title and tick labels, shared or the traces' own). A live change
 * of the font, size or text colour, a preset, a theme change and a plot drawn
 * from a link all come here. Set explicitly, so a change shows at once.
 */
function applyTextFont(plotContainer, settings) {
    if (!plotContainer) return;
    const family = settings.fontFamily || 'Arial, Helvetica, sans-serif';
    const size = settings.fontSize || 12;
    const colour = plotColour(settings, 'textColor');
    const text = (prefix, extra) => ({
        [`${prefix}.family`]: family, [`${prefix}.size`]: size + extra, [`${prefix}.color`]: colour
    });
    const update = {
        ...text('font', 0),
        ...text('legend.font', 0), ...text('legend.title.font', 2), 'legend.title.font.size': legendTitleSize(settings),
        ...text('coloraxis.colorbar.tickfont', 0), ...text('coloraxis.colorbar.title.font', 2)
    };
    for (const axis of axisPaths(settings)) Object.assign(update, text(`${axis}.tickfont`, 0), text(`${axis}.title.font`, 2));
    // the legend title's indent is spaces of the title's font (utils/legend-options.js)
    if (hasLegendEntries(plotContainer.data)) update['legend.title.text'] = legendTitleText(settings);
    Plotly.relayout(plotContainer, update);
    restyleColourBars(plotContainer,
        { ...text('marker.colorbar.tickfont', 0), ...text('marker.colorbar.title.font', 2) },
        { ...text('colorbar.tickfont', 0), ...text('colorbar.title.font', 2) });
}

/**
 * Restyle the colour bars of a plot: `markerUpdate` on the traces whose
 * marker has one (scatter), `traceUpdate` on those with a colorbar of their
 * own (heatmap, contour, surface). The focused-cell trace is left alone.
 */
function restyleColourBars(plotContainer, markerUpdate, traceUpdate) {
    (plotContainer.data || []).forEach((trace, i) => {
        if (!trace || (trace.name && String(trace.name).includes('Focused'))) return;
        if (trace.marker && trace.marker.colorbar) Plotly.restyle(plotContainer, markerUpdate, [i]);
        else if (trace.colorbar) Plotly.restyle(plotContainer, traceUpdate, [i]);
    });
}

/**
 * Update axis visibility settings
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function updateAxisVisibility(plotContainer, settings) {
    if (!plotContainer) return;
    
    const is3D = settings.z !== null;
    const update = {};
    
    // Title visibility
    if (settings.showAxisTitles !== undefined) {
        if (is3D) {
            update['scene.xaxis.title.text'] = settings.showAxisTitles ? 
                axisTitle(settings, 'x') : '';
            update['scene.yaxis.title.text'] = settings.showAxisTitles ? 
                axisTitle(settings, 'y') : '';
            update['scene.zaxis.title.text'] = settings.showAxisTitles ? 
                axisTitle(settings, 'z') : '';
        } else {
            update['xaxis.title.text'] = settings.showAxisTitles ? 
                axisTitle(settings, 'x') : '';
            update['yaxis.title.text'] = settings.showAxisTitles ? 
                axisTitle(settings, 'y') : '';
        }
    }
    
    // Tick labels, marks and count
    Object.assign(update, tickKeys(settings, axisPaths(settings)));
    
    // Axis line visibility
    if (settings.showAxisLines !== undefined) {
        if (is3D) {
            update['scene.xaxis.showline'] = settings.showAxisLines;
            update['scene.yaxis.showline'] = settings.showAxisLines;
            update['scene.zaxis.showline'] = settings.showAxisLines;
        } else {
            update['xaxis.showline'] = settings.showAxisLines;
            update['yaxis.showline'] = settings.showAxisLines;
        }
    }
    
    // Zero line visibility
    if (settings.showZeroLines !== undefined) {
        if (is3D) {
            update['scene.xaxis.zeroline'] = settings.showZeroLines;
            update['scene.yaxis.zeroline'] = settings.showZeroLines;
            update['scene.zaxis.zeroline'] = settings.showZeroLines;
        } else {
            update['xaxis.zeroline'] = settings.showZeroLines;
            update['yaxis.zeroline'] = settings.showZeroLines;
        }
    }
    
    if (Object.keys(update).length > 0) {
        Plotly.relayout(plotContainer, update);
    }
}

/**
 * Update line widths for axes, grid, and zero lines
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function updateLineWidths(plotContainer, settings) {
    if (!plotContainer) return;
    
    const is3D = settings.z !== null;
    const update = {};
    
    // Axis line width
    if (settings.axisLineWidth !== undefined) {
        if (is3D) {
            update['scene.xaxis.linewidth'] = settings.axisLineWidth;
            update['scene.yaxis.linewidth'] = settings.axisLineWidth;
            update['scene.zaxis.linewidth'] = settings.axisLineWidth;
        } else {
            update['xaxis.linewidth'] = settings.axisLineWidth;
            update['yaxis.linewidth'] = settings.axisLineWidth;
        }
    }
    
    // Grid line width
    if (settings.gridLineWidth !== undefined) {
        if (is3D) {
            update['scene.xaxis.gridwidth'] = settings.gridLineWidth;
            update['scene.yaxis.gridwidth'] = settings.gridLineWidth;
            update['scene.zaxis.gridwidth'] = settings.gridLineWidth;
        } else {
            update['xaxis.gridwidth'] = settings.gridLineWidth;
            update['yaxis.gridwidth'] = settings.gridLineWidth;
        }
    }
    
    // Zero line width
    if (settings.zeroLineWidth !== undefined) {
        if (is3D) {
            update['scene.xaxis.zerolinewidth'] = settings.zeroLineWidth;
            update['scene.yaxis.zerolinewidth'] = settings.zeroLineWidth;
            update['scene.zaxis.zerolinewidth'] = settings.zeroLineWidth;
        } else {
            update['xaxis.zerolinewidth'] = settings.zeroLineWidth;
            update['yaxis.zerolinewidth'] = settings.zeroLineWidth;
        }
    }
    
    if (Object.keys(update).length > 0) {
        Plotly.relayout(plotContainer, update);
    }
}


/**
 * Update plot background color
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function updatePlotBackground(plotContainer, settings) {
    applyThemeColors(plotContainer, settings);      // one set of colour keys: a colour changed by hand and one drawn from a link are the same plot
}

/**
 * Update 3D backdrop visibility and color
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function update3DBackdrop(plotContainer, settings) {
    if (!plotContainer || !settings.z) return;
    
    const update = {
        'scene.xaxis.showbackground': settings.showBackdrop,
        'scene.yaxis.showbackground': settings.showBackdrop,
        'scene.zaxis.showbackground': settings.showBackdrop,
        'scene.xaxis.backgroundcolor': plotColour(settings, 'backdropColor'),
        'scene.yaxis.backgroundcolor': plotColour(settings, 'backdropColor'),
        'scene.zaxis.backgroundcolor': plotColour(settings, 'backdropColor')
    };
    
    Plotly.relayout(plotContainer, update);
}

/**
 * Update text color
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function updateTextColor(plotContainer, settings) {
    applyThemeColors(plotContainer, settings);      // one set of colour keys: a colour changed by hand and one drawn from a link are the same plot
}

/**
 * Update grid color
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function updateGridColor(plotContainer, settings) {
    applyThemeColors(plotContainer, settings);      // one set of colour keys: a colour changed by hand and one drawn from a link are the same plot
}

/**
 * Update axis color
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function updateAxisColor(plotContainer, settings) {
    applyThemeColors(plotContainer, settings);      // one set of colour keys: a colour changed by hand and one drawn from a link are the same plot
}

/**
 * Update zero line color
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function updateZeroLineColor(plotContainer, settings) {
    applyThemeColors(plotContainer, settings);      // one set of colour keys: a colour changed by hand and one drawn from a link are the same plot
}

/**
 * Update the color input elements based on current settings
 * @param {HTMLElement} container - Container with the color inputs 
 * @param {string} id - Panel ID
 * @param {Object} settings - Plot settings
 */
export function updateColorInputs(container, id, settings) {
    if (!container) return;
    
    // If id wasn't provided, try to get it from the container
    if (!id) {
        id = getPanelId(container);
        if (!id) return;
    }
    
    // Now find and update the color inputs
    const bgColorInput = document.getElementById(`plot-bg-color-${id}`);
    const textColorInput = document.getElementById(`text-color-${id}`);
    const gridColorInput = document.getElementById(`grid-color-${id}`);
    const axisColorInput = document.getElementById(`axis-color-${id}`);
    const zeroLineColorInput = document.getElementById(`zero-line-color-${id}`);
    const backdropColorInput = document.getElementById(`backdrop-color-${id}`);
    const focusedColorInput = document.getElementById(`focused-color-${id}`);
    const focusedEdgeColorInput = document.getElementById(`focused-edge-color-${id}`);
    
    if (bgColorInput) bgColorInput.value = plotColour(settings, 'bgColor');
    if (textColorInput) textColorInput.value = plotColour(settings, 'textColor');
    if (gridColorInput) gridColorInput.value = plotColour(settings, 'gridColor');
    if (axisColorInput) axisColorInput.value = plotColour(settings, 'axisColor');
    if (zeroLineColorInput) zeroLineColorInput.value = plotColour(settings, 'zeroLineColor');
    if (backdropColorInput) backdropColorInput.value = plotColour(settings, 'backdropColor');
    if (focusedColorInput) focusedColorInput.value = plotColour(settings, 'focusedColor');
    if (focusedEdgeColorInput) focusedEdgeColorInput.value = plotColour(settings, 'focusedEdgeColor');
    syncColourControls(id, settings);
}

/** Show the Focused fill controls as the settings have them: the checkbox, and the edge width that is drawn. */
function syncFocusedFill(id, settings) {
    const noFill = document.getElementById(`focused-no-fill-${id}`);
    const width = document.getElementById(`focused-edge-width-${id}`);
    if (noFill) noFill.checked = settings.focusedNoFill !== false;
    if (width && settings.focusedEdgeWidth !== undefined) width.value = settings.focusedEdgeWidth;
}

/** The number boxes of the legend: the box's id, the setting, the least and the most it takes. */
const LEGEND_BOXES = [
    { box: 'legend-dot-size', key: 'legendDotSize', min: DOT_SIZE_MIN, max: DOT_SIZE_MAX },
    { box: 'legend-columns', key: 'legendColumns', min: 1, max: COLUMNS_MAX },
    { box: 'legend-title-size', key: 'legendTitleSize', min: TITLE_SIZE_MIN, max: TITLE_SIZE_MAX },
    { box: 'legend-title-gap', key: 'legendTitleGap', min: 0, max: TITLE_GAP_MAX }
];

/** A Reset button's state as drawn: disabled while its colour follows the theme (syncColourControls keeps it so). */
function resetState(settings, key) {
    return isFollowing(settings, key) ? 'disabled title="Following the app theme"' : 'title="Follow the app theme again"';
}

/** The Reset buttons of the number boxes (text size, legend dots and columns): disabled at the default, where there is nothing to reset. */
function syncOptionResets(id, settings) {
    const atDefault = { 'font-size': (settings.fontSize || 12) === 12, 'legend-dot-size': settings.legendDotSize == null,
                        'legend-columns': settings.legendColumns == null, 'legend-title-size': settings.legendTitleSize == null,
                        'legend-title-gap': settings.legendTitleGap == null };
    for (const [name, yes] of Object.entries(atDefault)) {
        const reset = document.getElementById(`reset-${name}-${id}`);
        if (reset) reset.disabled = yes;
    }
}

/** The ids of each colour's Reset button, by settings key. */
const RESET_IDS = {
    bgColor: 'reset-bg-color', backdropColor: 'reset-backdrop-color', textColor: 'reset-text-color',
    gridColor: 'reset-grid-color', axisColor: 'reset-axis-color', zeroLineColor: 'reset-zero-line-color',
    notInTableColor: 'reset-not-in-table-color',
    focusedColor: 'reset-focused-color', focusedEdgeColor: 'reset-focused-edge-color'
};

/** Show which colours follow the app theme: a following colour's Reset has nothing to do (disabled, with the reason as its tooltip). */
export function syncColourControls(id, settings) {
    for (const key of THEMED_COLOURS) {
        const reset = document.getElementById(`${RESET_IDS[key]}-${id}`);
        if (!reset) continue;
        const following = isFollowing(settings, key);
        reset.disabled = following;
        reset.title = following ? 'Following the app theme' : 'Follow the app theme again';
    }
}

/**
 * Apply theme colors to the plot
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
export function applyThemeColors(plotContainer, settings) {
    if (!plotContainer) return;
    
    // Apply theme to plot
    const is3D = settings.z !== null;
    const update = {
        'paper_bgcolor': plotColour(settings, 'bgColor'),
        'plot_bgcolor': plotColour(settings, 'bgColor'),
        'xaxis.gridcolor': plotColour(settings, 'gridColor'),
        'yaxis.gridcolor': plotColour(settings, 'gridColor'),
        'xaxis.color': plotColour(settings, 'axisColor'),
        'yaxis.color': plotColour(settings, 'axisColor'),
        'xaxis.linecolor': plotColour(settings, 'axisColor'), 
        'yaxis.linecolor': plotColour(settings, 'axisColor'),
        'xaxis.zerolinecolor': plotColour(settings, 'zeroLineColor'),
        'yaxis.zerolinecolor': plotColour(settings, 'zeroLineColor'),
        'xaxis.tickcolor': plotColour(settings, 'axisColor'),
        'yaxis.tickcolor': plotColour(settings, 'axisColor'),
        'modebar.color': modebarColours(settings).color,
        'modebar.activecolor': modebarColours(settings).activecolor
    };
    
    // For 3D plots
    if (is3D) {
        Object.assign(update, {
            'scene.bgcolor': plotColour(settings, 'bgColor'),
            'scene.xaxis.showbackground': settings.showBackdrop,
            'scene.yaxis.showbackground': settings.showBackdrop,
            'scene.zaxis.showbackground': settings.showBackdrop,
            'scene.xaxis.backgroundcolor': plotColour(settings, 'backdropColor'),
            'scene.yaxis.backgroundcolor': plotColour(settings, 'backdropColor'),
            'scene.zaxis.backgroundcolor': plotColour(settings, 'backdropColor'),
            'scene.xaxis.gridcolor': plotColour(settings, 'gridColor'),
            'scene.yaxis.gridcolor': plotColour(settings, 'gridColor'),
            'scene.zaxis.gridcolor': plotColour(settings, 'gridColor'),
            'scene.xaxis.color': plotColour(settings, 'axisColor'),
            'scene.yaxis.color': plotColour(settings, 'axisColor'),
            'scene.zaxis.color': plotColour(settings, 'axisColor'),
            'scene.xaxis.linecolor': plotColour(settings, 'axisColor'),
            'scene.yaxis.linecolor': plotColour(settings, 'axisColor'),
            'scene.zaxis.linecolor': plotColour(settings, 'axisColor'),
            'scene.xaxis.zerolinecolor': plotColour(settings, 'zeroLineColor'),
            'scene.yaxis.zerolinecolor': plotColour(settings, 'zeroLineColor'),
            'scene.zaxis.zerolinecolor': plotColour(settings, 'zeroLineColor'),
        });
    }
    
    Plotly.relayout(plotContainer, update);

    applyTextFont(plotContainer, settings);      // the text colour: axes, legend, colour bar
}

/**
 * Update font size in the plot
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function updateFontSize(plotContainer, settings) {
    applyTextFont(plotContainer, settings);
}

/**
 * Update plot margins
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function updateMargins(plotContainer, settings) {
    if (!plotContainer) return;
    
    const update = {
        'margin': settings.margins
    };
    
    Plotly.relayout(plotContainer, update);
}

/**
 * Where the legend goes so it does not sit on the colour bar.
 *
 * Legend and colour bar share one position setting (right by default, x 1.05
 * vs 1.02), so a plot that shows both, e.g. a numeric colour with a table
 * filter ('Not in table' in grey plus the colour bar of the rest), drew the
 * legend entry on top of the colour bar's title. When both are visible the
 * legend moves to a single row above the plot instead.
 *
 * @param {Array} data - plotDiv.data
 * @param {Object} posConfig - getPositioningByLocation(...) for the setting
 * @returns {Object} relayout keys for the legend
 */
export function legendPlacement(data, posConfig, settings = {}) {
  const traces = Array.isArray(data) ? data : [];
  const colorbar = traces.some(t => t && t.marker && t.marker.colorscale && t.marker.showscale !== false);
  const legendItems = traces.some(t => t && t.showlegend !== false
    && !(typeof t.name === 'string' && t.name.includes('Focused'))
    && !(t.marker && t.marker.colorscale));
  if (colorbar && legendItems) {
    return { 'legend.orientation': 'h', 'legend.x': 0, 'legend.xanchor': 'left',
             'legend.y': 1.02, 'legend.yanchor': 'bottom' };
  }
  return {
    'legend.orientation': legendOrientation(posConfig.legendOrientation, settings),
    'legend.x':           posConfig.legendX,
    'legend.y':           posConfig.legendY,
    'legend.xanchor':     posConfig.legendXanchor,
    'legend.yanchor':     posConfig.legendYanchor
  };
}

/**
 * Update legend & colorbar visibility
 * @param {HTMLElement} plotDiv  – Plotly graph div
 * @param {Object}      settings – Must include boolean settings.showLegend
 */
function updateLegendVisibility(plotDiv, settings) {
    if (!plotDiv || settings.showLegend === undefined) return;
    const show = settings.showLegend;

  
    // 2) Layout: any shared coloraxes (coloraxis, coloraxis2, etc.)
    let hasColoraxis = false;
    const layout = plotDiv.layout || {};
    Object.keys(layout)
      .filter(key => key.startsWith('coloraxis') && layout[key].showscale !== undefined)
      .forEach(ca => {
        Plotly.relayout(plotDiv, { [`${ca}.showscale`]: show });
        hasColoraxis = true;
      });
   
    // The legend, when there is one: which traces are entries is the
    // builders' to say (utils/legend-entries.js). Turning the legend on used
    // to give every trace without a colour scale an entry, the unnamed grey
    // trace of a plot coloured by nothing too, which read "trace 0".
    if (hasColoraxis) {
        Plotly.relayout(plotDiv, { showlegend: false, showscale: show });
    } else {
        Plotly.relayout(plotDiv, { showlegend: show && hasLegendEntries(plotDiv.data), showscale: false });
    }
    // 3) Per-trace colour bars: what differs from the trace as drawn, one restyle per attribute
    // (a restyle redraws the graph: one per trace took a second at 1M points with ~70 legend entries)
    const changes = new Map();     // attribute -> { idx: [], vals: [] }
    const want = (i, key, value, now) => {
        if ((now ?? false) === value) return;
        if (!changes.has(key)) changes.set(key, { idx: [], vals: [] });
        const c = changes.get(key);
        c.idx.push(i);
        c.vals.push(value);
    };
    plotDiv.data.forEach((trace, i) => {
        if (typeof trace.name === 'string' && (trace.name.includes('Focused'))) return;
        const hasMarkerCB = trace.marker && trace.marker.colorscale;
        const hasTraceCB  = ['heatmap','contour','surface'].includes(trace.type);
        const marker = trace.marker || {};

        if (hasMarkerCB) {
            // continuous scatter: hide from legend, toggle marker colorbar
            want(i, 'showlegend', false, trace.showlegend === undefined ? true : trace.showlegend);
            want(i, 'marker.showscale', show, marker.showscale);
        }
        else if (hasTraceCB) {
            // heatmap/contour/surface: hide from legend, toggle trace colorbar
            want(i, 'showlegend', false, trace.showlegend === undefined ? true : trace.showlegend);
            want(i, 'showscale', show, trace.showscale);
        }
        else {
            // categorical / other traces: no leftover colour bars
            if (trace.marker) want(i, 'marker.showscale', false, marker.showscale);
            if (trace.showscale !== undefined) want(i, 'showscale', false, trace.showscale);
        }
    });
    for (const [key, c] of changes) Plotly.restyle(plotDiv, { [key]: c.vals }, c.idx);

    // Legend entries next to a colour bar: keep them off it
    if (show) {
        Plotly.relayout(plotDiv, legendPlacement(plotDiv.data,
            getPositioningByLocation(settings.legendPosition || 'right'), settings));
    }
  }

/** Room, in px, between a bottom colour bar and the axes: the x-axis tick labels and title sit there. */
const BOTTOM_BAR_PAD = 70;

/**
 * Positioning configuration for legends and colorbars
 * Centralizes positioning logic for use across the application
 * @param {string} position - Position name: 'right', 'left', 'top', or 'bottom'
 * @returns {Object} - Positioning configuration object
 */
export function getPositioningByLocation(position) {
    const positioning = {
      right: {
        // Legend
        legendOrientation: 'v', legendX: 1.05, legendY: 0.5,
        legendXanchor: 'left', legendYanchor: 'middle',
        // Colorbar
        x: 1.02, xanchor: 'left', y: 0.5, yanchor: 'middle', ypad: 0, ticklabelposition: 'outside',
        orientation: 'v', titleside: 'right'
      },
      left: {
        legendOrientation: 'v', legendX: -0.05, legendY: 0.5,
        legendXanchor: 'right', legendYanchor: 'middle',
        x: -0.1, xanchor: 'right', y: 0.5, yanchor: 'middle', ypad: 0, ticklabelposition: 'outside',
        orientation: 'v', titleside: 'right'
      },
      top: {
        // above the axes, growing upwards: Plotly makes the top margin it needs. (A 15% paper offset with the
        // legend hanging down from it was less than the legend's own height in a short panel.)
        legendOrientation: 'h', legendX: 0.5, legendY: 1,
        legendXanchor: 'center', legendYanchor: 'bottom',
        // a horizontal bar lies wholly outside the axes: above them with its tick labels above it, or below
        // them (and their tick labels and title, hence ypad) with its tick labels below it
        x: 0.5, xanchor: 'center', y: 1, yanchor: 'bottom', ypad: 6, ticklabelposition: 'outside top',
        orientation: 'h', titleside: 'top'
      },
      bottom: {
        // below the axes' tick labels and title, hanging down: legend-below.js sets the offset in px, as a paper
        // fraction of the plot height, once the plot is drawn
        legendOrientation: 'h', legendX: 0.5, legendY: 0,
        legendXanchor: 'center', legendYanchor: 'top',
        x: 0.5, xanchor: 'center', y: 0, yanchor: 'top', ypad: BOTTOM_BAR_PAD, ticklabelposition: 'outside bottom',
        orientation: 'h', titleside: 'bottom'
      }
    };
    return positioning[position] || positioning.right;
  }
  
  /**
   * Update both legend and colorbar positions
   * @param {HTMLElement} plotContainer – the Plotly graph div
   * @param {Object} settings – must include settings.legendPosition
   */
  export function updateLegendPosition(plotContainer, settings) {
    if (!plotContainer) return;
    const posConfig = getPositioningByLocation(settings.legendPosition || 'right');
    // the colour bar has a position of its own (default: the legend's), a length and a tick count
    const barPos = getPositioningByLocation(colorbarPosition(settings));
    const barExtras = colorbarExtras(settings);
    const nticks = barExtras.nticks || 0;      // 0: Plotly's automatic
  
    // 1) Legend positioning (layout update), off the colour bar if both show
    Plotly.relayout(plotContainer, legendPlacement(plotContainer.data, posConfig, settings));
  

    // 2) Shared coloraxis: hide → update → show
    // ------------------------------------------------
    // hide any existing shared bar
    // update its geometry
    const coloraxisVisible = plotContainer.layout.coloraxis?.showscale ?? false;
    if (coloraxisVisible) {
        Plotly.relayout(plotContainer, {
        'coloraxis.colorbar.x':         barPos.x,
        'coloraxis.colorbar.y':         barPos.y,
        'coloraxis.colorbar.xanchor':   barPos.xanchor,
        'coloraxis.colorbar.yanchor':   barPos.yanchor,
        'coloraxis.colorbar.orientation': barPos.orientation,
        'coloraxis.colorbar.ypad':        barPos.ypad,
        'coloraxis.colorbar.ticklabelposition': barPos.ticklabelposition,
        'coloraxis.colorbar.titleside':   barPos.titleside,
        'coloraxis.colorbar.len':         barExtras.len,
        'coloraxis.colorbar.lenmode':     barExtras.lenmode,
        'coloraxis.colorbar.nticks':      nticks,
        'coloraxis.showscale': coloraxisVisible
        });
    }
  
    // 3) Per‑trace bars: hide → update → show
    // ------------------------------------------------
    plotContainer.data.forEach((trace, i) => {
      if (typeof trace.name === 'string' && trace.name.includes('Focused')) return;
  
      // scatter traces with marker.colorbar
      const isScatter = trace.marker && Array.isArray(trace.marker.color) && trace.marker.colorscale;
      // heatmap/contour/surface traces
      const isHeat   = trace.type && ['heatmap','contour','surface'].includes(trace.type) && trace.colorbar;

      const currentVisible = isScatter ? (trace.marker.showscale ?? true) : (trace.showscale ?? true);
  
      if (isScatter) {
        // 3a) Hide old colorbar
        Plotly.restyle(plotContainer, { 'marker.showscale': false }, [i]);
        // 3b) Update position/orientation + re‑show
        Plotly.restyle(plotContainer, {
          'marker.colorbar.x':          barPos.x,
          'marker.colorbar.y':          barPos.y,
          'marker.colorbar.xanchor':    barPos.xanchor,
          'marker.colorbar.yanchor':    barPos.yanchor,
          'marker.colorbar.orientation': barPos.orientation,
          'marker.colorbar.ypad':        barPos.ypad,
          'marker.colorbar.ticklabelposition': barPos.ticklabelposition,
          'marker.colorbar.titleside':   barPos.titleside,
          'marker.colorbar.len':         barExtras.len,
          'marker.colorbar.lenmode':     barExtras.lenmode,
          'marker.colorbar.nticks':      nticks,
          'marker.showscale':           currentVisible
        }, [i]);
      }
      else if (isHeat) {
        Plotly.restyle(plotContainer, { showscale: false }, [i]);
        Plotly.restyle(plotContainer, {
          'colorbar.x':          barPos.x,
          'colorbar.y':          barPos.y,
          'colorbar.xanchor':    barPos.xanchor,
          'colorbar.yanchor':    barPos.yanchor,
          'colorbar.orientation': barPos.orientation,
          'colorbar.ypad':        barPos.ypad,
          'colorbar.ticklabelposition': barPos.ticklabelposition,
          'colorbar.titleside':   barPos.titleside,
          'colorbar.len':         barExtras.len,
          'colorbar.lenmode':     barExtras.lenmode,
          'colorbar.nticks':      nticks,
          showscale:             currentVisible
        }, [i]);
      }
    });
  }

/**
 * Update hover mode (enable/disable hover info)
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function updateHoverMode(plotContainer, settings) {
    if (!plotContainer) return;
    
    const update = {
        'hovermode': settings.showHoverInfo ? 'closest' : false
    };
    
    Plotly.relayout(plotContainer, update);
}

// module‑scope flag
let _exportInProgress = false;

/**
 * Export the plot as an image
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {string} format            - 'svg', 'png', 'jpeg', 'webp'
 * @param {Object} settings          - may include exportWidth, exportHeight, scaleExport
 * @param {string} [how]             - 'full' (drawn again at the export's size) or 'shown' (as on screen)
 */
export async function exportPlot(plotContainer, format, settings, how = 'full') {
  if (!plotContainer) return;
  if (_exportInProgress) {
    console.warn('Export already in progress – please wait.');
    return;
  }
  const panelId = getPanelId(plotContainer);
  const downloadButton = document.getElementById(how === 'shown' ? `download-shown-${format}-${panelId}` : `download-${format}-${panelId}`);
  const opts = exportOptions(settings);
  if (format === 'svg') opts.scale = 1;      // vector: no pixels to sharpen, and the size stays as set
  const filename = 'plot_' + new Date()
    .toISOString()
    .replace(/[:.]/g, '-');

  // checked again at the click: the panels open may have changed since the menu was drawn
  const check = how === 'full' ? exportCheck(plotContainer, opts) : null;
  if (check && check.verdict === 'block') {
    refuseInStatus(plotContainer, 'exported', check);
    return;
  }
  _exportInProgress = true;
  const done = markBusy(downloadButton, 'Preparing image\u2026');
  try {
    await guarded(check, { panel: panelId, action: 'export', format }, () =>
      exportImage(plotContainer, how, { format, ...opts, filename }));
    setStatusTag(plotContainer, 'export', null);
  } catch (err) {
    console.error('Error exporting plot:', err);
    failInStatus(plotContainer, 'Export failed', 'The image could not be made; try again, or at a smaller size.');
  } finally {
    _exportInProgress = false;
    done();
  }
}

/**
 * An export or copy the memory check refused: the panel's status strip says so,
 * with the advice and (for an export) "Export as shown", as for the modebar camera.
 * @param {HTMLElement} gd - the plot
 * @param {'exported'|'copied'} verb
 * @param {Object} check - exportCheck's answer, with verdict 'block'
 */
function refuseInStatus(gd, verb, check) {
  const why = refusalText(check, EXPORT_ADVICE);
  setStatusTag(gd, 'memory', { text: `Not ${verb}: ${bindingLabel(check.binding)}`, severity: 'warning', title: why,
    pop: { text: why, actions: verb === 'exported' && canSnapshot(gd) ? [['export-shown', 'Export as shown']] : [] } });
  nudgeStatusTag(gd, 'memory');
}

/**
 * An export or copy that failed: a tag in the panel's status strip that stays
 * until the next export succeeds, not a message that vanishes in seconds.
 * @param {HTMLElement} gd - the plot
 * @param {string} text - the tag
 * @param {string} why - the sentence under it
 */
function failInStatus(gd, text, why) {
  setStatusTag(gd, 'export', { text, severity: 'error', title: why, pop: { text: why } });
  nudgeStatusTag(gd, 'export');
}

/**
 * Show on a button that its action is running (its label, and aria-busy for
 * assistive technology); the returned function puts the button back.
 * @param {HTMLElement|null} button
 * @param {string} label
 * @returns {Function}
 */
function markBusy(button, label) {
  if (!button) return () => {};
  const before = button.innerHTML;
  button.setAttribute('aria-busy', 'true');
  button.textContent = label;
  return () => { button.removeAttribute('aria-busy'); button.innerHTML = before; };
}

/** Say "Copied" on a button for a moment, then put its label back. */
function flashLabel(button, text, ms = 2000) {
  if (!button) return;
  const before = button.innerHTML;
  button.textContent = text;
  setTimeout(() => { button.innerHTML = before; }, ms);
}

/**
 * The modebar camera: a full-resolution PNG when it fits; otherwise the
 * status strip says why, with "Export as shown" (a click, never a reroute).
 */
registerCameraExport(async (gd, opts) => {
  // the panel's own export size and scale (Plot Options), else the toolbar's
  const o = typeof gd.__exportOptions === 'function' ? gd.__exportOptions()
    : { width: opts.width || 1200, height: opts.height || 800, scale: opts.scale || 1 };
  const check = exportCheck(gd, o);
  if (check.verdict === 'block') {
    refuseInStatus(gd, 'exported', check);
    return;
  }
  await guarded(check, { panel: getPanelId(gd), action: 'export', format: 'png' }, () =>
    exportImage(gd, 'full', { format: opts.format || 'png', ...o, filename: opts.filename || 'annzarro_plot' }));
});

/**
 * Copy the Plotly plot to clipboard as a PNG image: one image, drawn once
 * (full resolution when it fits in memory, else not copied).
 * @param {HTMLElement} plotContainer – Plotly graph div
 * @param {Object} settings – May include exportWidth, exportHeight
 */
async function copyPlotToClipboard(plotContainer, settings) {
    if (!plotContainer) return;
    const opts = { ...exportOptions(settings), scale: 1 };
    const copyBtn = document.getElementById(`copy-to-clipboard-${getPanelId(plotContainer)}`);
    const check = exportCheck(plotContainer, opts);
    if (check.verdict === 'block') {
      refuseInStatus(plotContainer, 'copied', check);
      return;
    }
    try {
      const dataUrl = await guarded(check, { panel: getPanelId(plotContainer), action: 'export', format: 'png' },
        () => exportWithCoverage(plotContainer, () => fullImage(plotContainer, { format: 'png', ...opts })));
      const blob = await fetch(dataUrl).then(res => res.blob());
      if (!navigator.clipboard || !window.ClipboardItem) throw new Error('Clipboard API not supported');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setStatusTag(plotContainer, 'export', null);
      flashLabel(copyBtn, 'Copied');
    } catch (err) {
      console.error('Copy to clipboard failed:', err);
      failInStatus(plotContainer, 'Not copied',
        navigator.clipboard && window.ClipboardItem
          ? 'The image could not be copied; use Download instead.'
          : 'The browser copies images only on https or localhost; use Download instead.');
    }
  }

/**
 * Apply all aesthetic settings to a plot
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
export function applyAllAestheticSettings(plotContainer, settings) {
    if (!plotContainer) return;
    
    // Ensure settings are initialized
    initializeAestheticsSettings(settings);
    
    // Apply all settings at once with a single relayout call
    const is3D = settings.z !== null;
    
    // The colours on screen: the ones the user set, the app theme's for the rest
    const gridColor = plotColour(settings, 'gridColor');
    const textColor = plotColour(settings, 'textColor');
    const axisColor = plotColour(settings, 'axisColor');
    const zeroLineColor = plotColour(settings, 'zeroLineColor');
    const bgColor = plotColour(settings, 'bgColor');
    
    // First, update the basic layout (without legend/colorbar details)
    const update = {
        // Basic layout
        'margin': settings.margins,
        'paper_bgcolor': bgColor,
        'plot_bgcolor': bgColor,
        'hovermode': settings.showHoverInfo ? 'closest' : false,
        
        // Legend position settings (actual visibility will be handled separately)
        'legend.orientation': legendOrientation((settings.legendPosition === 'left' || settings.legendPosition === 'right') ? 'v' : 'h', settings),
        'legend.x': settings.legendPosition === 'right' ? 1.05 : settings.legendPosition === 'left' ? -0.05 : 0.5,
        'legend.y': settings.legendPosition === 'top' ? 1 : settings.legendPosition === 'bottom' ? 0 : 0.5,
        'legend.xanchor': settings.legendPosition === 'right' ? 'left' : settings.legendPosition === 'left' ? 'right' : 'center',
        'legend.yanchor': settings.legendPosition === 'top' ? 'bottom' : settings.legendPosition === 'bottom' ? 'top' : 'middle',
        
        // Interaction
        'xaxis.fixedrange': !settings.enableZoom,
        'yaxis.fixedrange': !settings.enableZoom,
        
        // Set legend visibility (global setting), when there is a legend entry
        'showlegend': settings.showLegend !== false && hasLegendEntries(plotContainer.data),
        
        // 2D axes
        'xaxis.showgrid': settings.showGrid,
        'yaxis.showgrid': settings.showGrid,
        'xaxis.gridcolor': gridColor,
        'yaxis.gridcolor': gridColor,
        'xaxis.gridwidth': settings.gridLineWidth || 1,
        'yaxis.gridwidth': settings.gridLineWidth || 1,
        'xaxis.showline': settings.showAxisLines !== false,
        'yaxis.showline': settings.showAxisLines !== false,
        'xaxis.linecolor': axisColor,
        'yaxis.linecolor': axisColor,
        'xaxis.linewidth': settings.axisLineWidth || 1,
        'yaxis.linewidth': settings.axisLineWidth || 1,
        'xaxis.zeroline': settings.showZeroLines,
        'yaxis.zeroline': settings.showZeroLines,
        'xaxis.zerolinecolor': zeroLineColor,
        'yaxis.zerolinecolor': zeroLineColor,
        'xaxis.zerolinewidth': settings.zeroLineWidth || 1,
        'yaxis.zerolinewidth': settings.zeroLineWidth || 1,
        'xaxis.tickcolor': axisColor,
        'yaxis.tickcolor': axisColor,
        'xaxis.color': axisColor,
        'yaxis.color': axisColor,
        'xaxis.title.text': settings.showAxisTitles ? axisTitle(settings, 'x') : '',
        'yaxis.title.text': settings.showAxisTitles ? axisTitle(settings, 'y') : '',
        
    };
    
    // For 3D plots
    if (is3D) {
        const backdropColor = plotColour(settings, 'backdropColor');
        Object.assign(update, {
            'scene.bgcolor': bgColor,
            'scene.xaxis.showbackground': settings.showBackdrop,
            'scene.yaxis.showbackground': settings.showBackdrop,
            'scene.zaxis.showbackground': settings.showBackdrop,
            'scene.xaxis.backgroundcolor': backdropColor,
            'scene.yaxis.backgroundcolor': backdropColor,
            'scene.zaxis.backgroundcolor': backdropColor,
            'scene.xaxis.gridcolor': gridColor,
            'scene.yaxis.gridcolor': gridColor,
            'scene.zaxis.gridcolor': gridColor,
            'scene.xaxis.gridwidth': settings.gridLineWidth || 1,
            'scene.yaxis.gridwidth': settings.gridLineWidth || 1,
            'scene.zaxis.gridwidth': settings.gridLineWidth || 1,
            'scene.xaxis.showgrid': settings.showGrid,
            'scene.yaxis.showgrid': settings.showGrid,
            'scene.zaxis.showgrid': settings.showGrid,
            'scene.xaxis.showline': settings.showAxisLines !== false,
            'scene.yaxis.showline': settings.showAxisLines !== false,
            'scene.zaxis.showline': settings.showAxisLines !== false,
            'scene.xaxis.linecolor': axisColor,
            'scene.yaxis.linecolor': axisColor,
            'scene.zaxis.linecolor': axisColor,
            'scene.xaxis.linewidth': settings.axisLineWidth || 1,
            'scene.yaxis.linewidth': settings.axisLineWidth || 1,
            'scene.zaxis.linewidth': settings.axisLineWidth || 1,
            'scene.xaxis.zeroline': settings.showZeroLines,
            'scene.yaxis.zeroline': settings.showZeroLines,
            'scene.zaxis.zeroline': settings.showZeroLines,
            'scene.xaxis.zerolinecolor': zeroLineColor,
            'scene.yaxis.zerolinecolor': zeroLineColor,
            'scene.zaxis.zerolinecolor': zeroLineColor,
            'scene.xaxis.zerolinewidth': settings.zeroLineWidth || 1,
            'scene.yaxis.zerolinewidth': settings.zeroLineWidth || 1,
            'scene.zaxis.zerolinewidth': settings.zeroLineWidth || 1,
            'scene.xaxis.tickcolor': axisColor,
            'scene.yaxis.tickcolor': axisColor,
            'scene.zaxis.tickcolor': axisColor,
            'scene.xaxis.color': axisColor,
            'scene.yaxis.color': axisColor,
            'scene.zaxis.color': axisColor,
            'scene.xaxis.title.text': settings.showAxisTitles ? axisTitle(settings, 'x') : '',
            'scene.yaxis.title.text': settings.showAxisTitles ? axisTitle(settings, 'y') : '',
            'scene.zaxis.title.text': settings.showAxisTitles ? axisTitle(settings, 'z') : '',
            
        });
        
        // 3D interaction settings
        if (!settings.enableZoom && !settings.enablePan) {
            update['scene.camera'] = {
                up: { x: 0, y: 0, z: 1 },
                center: { x: 0, y: 0, z: 0 },
                eye: { x: 1.25, y: 1.25, z: 1.25 }
            };
        }
    }
    
    // Ticks: labels, marks and count
    Object.assign(update, tickKeys(settings, axisPaths(settings)));
    
    // Apply the basic layout first
    Plotly.relayout(plotContainer, update);
    
    // Then handle legend and colorbar visibility specifically based on trace type
    updateLegendVisibility(plotContainer, settings);
    updateLegendPosition(plotContainer, settings);
    applyTextFont(plotContainer, settings);
    applyLegendOptions(plotContainer, settings);
    refreshScaleBar(plotContainer, settings);
}
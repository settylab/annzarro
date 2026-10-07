import { registerCameraExport, setStatusTag, nudgeStatusTag, exportWithCoverage } from '../../utils/panel-surface.js';
import { axisTitle } from './plot-make-helper.js';
import { exportImage, fullImage, canSnapshot, snapshotSize } from '../../utils/plot-export.js';
import { exportCheck, guarded, refusalText } from '../../utils/memory-guard-ui.js';
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
  };
  
  const onHide = () => {
    menuButton.classList.remove('btn-aesthetics-active');
    menuButton.classList.add('btn-outline-secondary');
  };
  
  menuButton.addEventListener('shown.bs.popover', onShown);
  menuButton.addEventListener('hide.bs.popover',  onHide);

  // Click-away handler
  const clickAway = (e) => {
    if (!menuButton.contains(e.target) && !e.target.closest('.popover')) {
      popover.hide();
    }
  };
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
    popover.dispose();
    menuButton.removeEventListener('shown.bs.popover', onShown);
    menuButton.removeEventListener('hide.bs.popover',  onHide);
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
export function createPopoverContent(id, settings) {
    // Ensure all required settings have defaults
    initializeAestheticsSettings(settings);
    
    // Store the actual margin values in data attributes to prevent bootstrap.Popover 
    // from caching the HTML and causing incorrect values
    const marginTop = settings.margins?.t ?? 80;
    const marginBottom = settings.margins?.b ?? 60;
    const marginLeft = settings.margins?.l ?? 80;
    const marginRight = settings.margins?.r ?? 80;
    
    // Create a custom ID to ensure we're getting fresh HTML each time
    const uniqueId = `aesthetics-${id}-${Date.now()}`;
    
    return `
    <div id="${uniqueId}" class="aesthetics-menu-content" 
         data-margin-top="${marginTop}" 
         data-margin-bottom="${marginBottom}" 
         data-margin-left="${marginLeft}"
         data-margin-right="${marginRight}">
        <!-- Appearance Section -->
        <div class="aesthetics-section">
            <h6>Appearance</h6>
            
            <!-- Background Color -->
            <div class="mb-2">
                <label class="form-label mb-1">Background</label>
                <div class="d-flex align-items-center gap-2">
                    <input type="color" class="form-control form-control-sm form-control-color" 
                        id="plot-bg-color-${id}" value="${settings.bgColor || '#ffffff'}" title="Choose background color">
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
                        id="backdrop-color-${id}" value="${settings.backdropColor || '#f0f0f0'}" title="Choose 3D backdrop color">
                    <button class="btn btn-sm btn-outline-secondary" id="reset-backdrop-color-${id}">Reset</button>
                </div>
            </div>

            <!-- Color Theme Buttons -->
            <div class="mb-2">
                <label class="form-label mb-1">Apply Color Theme</label>
                <div class="d-flex gap-2">
                    <button type="button" class="btn btn-sm btn-outline-secondary" id="light-theme-${id}">
                        <i class="fas fa-sun"></i> Light Defaults
                    </button>
                    <button type="button" class="btn btn-sm btn-outline-secondary" id="dark-theme-${id}">
                        <i class="fas fa-moon"></i> Dark Theme
                    </button>
                </div>
            </div>
        </div>
        
        <!-- Axes Section -->
        <div class="aesthetics-section">
            <h6>Axes</h6>
            
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
                        id="grid-color-${id}" value="${settings.gridColor || '#e6e6e6'}" title="Choose grid color">
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
                        id="axis-color-${id}" value="${settings.axisColor || '#000000'}" title="Choose axis color">
                    <button class="btn btn-sm btn-outline-secondary" id="reset-axis-color-${id}">Reset</button>
                </div>
            </div>
            
            <!-- Zero Line Color -->
            <div class="mb-2">
                <label class="form-label mb-1">Zero Line Color</label>
                <div class="d-flex align-items-center gap-2">
                    <input type="color" class="form-control form-control-sm form-control-color" 
                        id="zero-line-color-${id}" value="${settings.zeroLineColor || '#cccccc'}" title="Choose zero line color">
                    <button class="btn btn-sm btn-outline-secondary" id="reset-zero-line-color-${id}">Reset</button>
                </div>
            </div>
            
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
                </div>
                
                <div class="d-flex align-items-center gap-2">
                    <label class="form-label mb-0 me-2">Color</label>
                    <input type="color" class="form-control form-control-sm form-control-color" 
                        id="text-color-${id}" value="${settings.textColor || '#000000'}" title="Choose text color">
                    <button class="btn btn-sm btn-outline-secondary" id="reset-text-color-${id}">Reset</button>
                </div>
            </div>
        </div>
        
        <!-- Margins Section -->
        <div class="aesthetics-section">
            <h6>Margins</h6>
            <div class="row g-2">
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
        </div>
        
        <!-- Legend Section -->
        <div class="aesthetics-section">
            <h6>Legend</h6>
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
        </div>
        
        <!-- Export Section -->
        <div class="aesthetics-section">
            <h6>Export</h6>
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
            
        </div>
    </div>
    `;
}

/** The export's pixel size and scale from the panel's settings. */
export function exportOptions(settings) {
  return { width: settings.exportWidth || 1200, height: settings.exportHeight || 800, scale: settings.scaleExport ? 2 : 1 };
}

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
        SCALE_EXPORT: false,
        
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
    
    // Colors
    settings.bgColor = settings.bgColor || defaults.BG_COLOR;
    settings.gridColor = settings.gridColor || defaults.GRID_COLOR;
    settings.axisColor = settings.axisColor || defaults.AXIS_COLOR;
    settings.textColor = settings.textColor || defaults.TEXT_COLOR;
    settings.zeroLineColor = settings.zeroLineColor || defaults.ZERO_LINE_COLOR;
    settings.backdropColor = settings.backdropColor || defaults.BACKDROP_COLOR;
    
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
    settings.margins = settings.margins || defaults.MARGINS;
    
    // Export options
    settings.exportWidth = settings.exportWidth || defaults.EXPORT_WIDTH;
    settings.exportHeight = settings.exportHeight || defaults.EXPORT_HEIGHT;
    settings.scaleExport = settings.scaleExport || defaults.SCALE_EXPORT;
    
    // Legend settings
    settings.legendPosition = settings.legendPosition || defaults.LEGEND_POSITION;
    
    // Interaction settings
    settings.enableZoom = settings.enableZoom !== undefined ? settings.enableZoom : defaults.ENABLE_ZOOM;
    settings.enablePan = settings.enablePan !== undefined ? settings.enablePan : defaults.ENABLE_PAN;
    settings.showHoverInfo = settings.showHoverInfo !== undefined ? settings.showHoverInfo : defaults.SHOW_HOVER_INFO;
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
    
    // Create one-time event handlers using delegation for all menu controls
    const menuHandler = function(e) {
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
            notifySettingsChanged(id, 'bgColor', settings.bgColor);
            return;
        }
        
        // Reset background color
        if (target.id === `reset-bg-color-${id}`) {
            const defaults = (window.Config && window.Config.DEFAULTS && window.Config.DEFAULTS.PLOT_AESTHETICS) || {};
            const colorInput = container.querySelector(`#plot-bg-color-${id}`);
            settings.bgColor = defaults.BG_COLOR || '#ffffff';
            if (colorInput) colorInput.value = settings.bgColor;
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
            notifySettingsChanged(id, 'backdropColor', settings.backdropColor);
            return;
        }
        
        // Reset backdrop color
        if (target.id === `reset-backdrop-color-${id}`) {
            const defaults = (window.Config && window.Config.DEFAULTS && window.Config.DEFAULTS.PLOT_AESTHETICS) || {};
            const colorInput = container.querySelector(`#backdrop-color-${id}`);
            settings.backdropColor = defaults.BACKDROP_COLOR || '#f0f0f0';
            if (colorInput) colorInput.value = settings.backdropColor;
            update3DBackdrop(plotContainer, settings);
            notifySettingsChanged(id, 'backdropColor', settings.backdropColor);
            return;
        }
        
        // Text color
        if (target.id === `text-color-${id}`) {
            settings.textColor = target.value;
            updateTextColor(plotContainer, settings);
            notifySettingsChanged(id, 'textColor', settings.textColor);
            return;
        }
        
        // Reset text color
        if (target.id === `reset-text-color-${id}`) {
            const defaults = (window.Config && window.Config.DEFAULTS && window.Config.DEFAULTS.PLOT_AESTHETICS) || {};
            const colorInput = container.querySelector(`#text-color-${id}`);
            settings.textColor = defaults.TEXT_COLOR || '#000000';
            if (colorInput) colorInput.value = settings.textColor;
            updateTextColor(plotContainer, settings);
            notifySettingsChanged(id, 'textColor', settings.textColor);
            return;
        }
        
        // Grid color
        if (target.id === `grid-color-${id}`) {
            settings.gridColor = target.value;
            updateGridColor(plotContainer, settings);
            notifySettingsChanged(id, 'gridColor', settings.gridColor);
            return;
        }
        
        // Reset grid color
        if (target.id === `reset-grid-color-${id}`) {
            const defaults = (window.Config && window.Config.DEFAULTS && window.Config.DEFAULTS.PLOT_AESTHETICS) || {};
            const colorInput = container.querySelector(`#grid-color-${id}`);
            settings.gridColor = defaults.GRID_COLOR || '#e6e6e6';
            if (colorInput) colorInput.value = settings.gridColor;
            updateGridColor(plotContainer, settings);
            notifySettingsChanged(id, 'gridColor', settings.gridColor);
            return;
        }
        
        // Axis color
        if (target.id === `axis-color-${id}`) {
            settings.axisColor = target.value;
            updateAxisColor(plotContainer, settings);
            notifySettingsChanged(id, 'axisColor', settings.axisColor);
            return;
        }
        
        // Reset axis color
        if (target.id === `reset-axis-color-${id}`) {
            const defaults = (window.Config && window.Config.DEFAULTS && window.Config.DEFAULTS.PLOT_AESTHETICS) || {};
            const colorInput = container.querySelector(`#axis-color-${id}`);
            settings.axisColor = defaults.AXIS_COLOR || '#000000';
            if (colorInput) colorInput.value = settings.axisColor;
            updateAxisColor(plotContainer, settings);
            notifySettingsChanged(id, 'axisColor', settings.axisColor);
            return;
        }
        
        // Zero line color
        if (target.id === `zero-line-color-${id}`) {
            settings.zeroLineColor = target.value;
            updateZeroLineColor(plotContainer, settings);
            notifySettingsChanged(id, 'zeroLineColor', settings.zeroLineColor);
            return;
        }
        
        // Reset zero line color
        if (target.id === `reset-zero-line-color-${id}`) {
            const defaults = (window.Config && window.Config.DEFAULTS && window.Config.DEFAULTS.PLOT_AESTHETICS) || {};
            const colorInput = container.querySelector(`#zero-line-color-${id}`);
            settings.zeroLineColor = defaults.ZERO_LINE_COLOR || '#cccccc';
            if (colorInput) colorInput.value = settings.zeroLineColor;
            updateZeroLineColor(plotContainer, settings);
            notifySettingsChanged(id, 'zeroLineColor', settings.zeroLineColor);
            return;
        }
        
        // Apply light theme defaults
        if (target.id === `light-theme-${id}` || target.closest(`#light-theme-${id}`)) {
            const defaults = (window.Config && window.Config.DEFAULTS && window.Config.DEFAULTS.PLOT_AESTHETICS) || {};
            
            // Apply light theme defaults - with fallbacks in case Config is not available
            settings.bgColor = defaults.BG_COLOR || '#ffffff';
            settings.gridColor = defaults.GRID_COLOR || '#e6e6e6';
            settings.axisColor = defaults.AXIS_COLOR || '#000000';
            settings.textColor = defaults.TEXT_COLOR || '#000000';
            settings.zeroLineColor = defaults.ZERO_LINE_COLOR || '#cccccc';
            settings.backdropColor = defaults.BACKDROP_COLOR || '#f0f0f0';
            
            // Update color inputs
            updateColorInputs(container, id, settings);
            
            // Apply to plot - use the full applyAllAestheticSettings for consistent handling
            applyAllAestheticSettings(plotContainer, settings);
            
            // Notify changes
            notifyMultipleSettingsChanged(id, [
                {setting: 'bgColor', value: settings.bgColor},
                {setting: 'gridColor', value: settings.gridColor},
                {setting: 'axisColor', value: settings.axisColor},
                {setting: 'textColor', value: settings.textColor},
                {setting: 'zeroLineColor', value: settings.zeroLineColor},
                {setting: 'backdropColor', value: settings.backdropColor},
                {setting: 'showBackdrop', value: settings.showBackdrop}
            ]);
            return;
        }
        
        // Apply dark theme
        if (target.id === `dark-theme-${id}` || target.closest(`#dark-theme-${id}`)) {
            const defaults = (window.Config && window.Config.DEFAULTS && window.Config.DEFAULTS.PLOT_AESTHETICS) || {};
            const darkTheme = defaults.DARK_THEME || {
                BG_COLOR: '#1e1e1e',
                GRID_COLOR: '#444444',
                AXIS_COLOR: '#ffffff',
                TEXT_COLOR: '#ffffff',
                ZERO_LINE_COLOR: '#666666'
            };
            
            // Apply dark theme
            settings.bgColor = darkTheme.BG_COLOR;
            settings.gridColor = darkTheme.GRID_COLOR;
            settings.axisColor = darkTheme.AXIS_COLOR;
            settings.textColor = darkTheme.TEXT_COLOR;
            settings.zeroLineColor = darkTheme.ZERO_LINE_COLOR;
            settings.backdropColor = darkTheme.BACKDROP_COLOR || '#121212';
            
            // Update color inputs
            updateColorInputs(container, id, settings);
            
            // Apply to plot - use the full applyAllAestheticSettings for consistent handling
            applyAllAestheticSettings(plotContainer, settings);
            
            // Notify changes
            notifyMultipleSettingsChanged(id, [
                {setting: 'bgColor', value: settings.bgColor},
                {setting: 'gridColor', value: settings.gridColor},
                {setting: 'axisColor', value: settings.axisColor},
                {setting: 'textColor', value: settings.textColor},
                {setting: 'zeroLineColor', value: settings.zeroLineColor},
                {setting: 'backdropColor', value: settings.backdropColor},
                {setting: 'showBackdrop', value: settings.showBackdrop}
            ]);
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
            
            // Update the input fields directly
            const marginTopInput = document.getElementById(`margin-top-${id}`);
            const marginBottomInput = document.getElementById(`margin-bottom-${id}`);
            const marginLeftInput = document.getElementById(`margin-left-${id}`);
            const marginRightInput = document.getElementById(`margin-right-${id}`);
            
            if (marginTopInput) marginTopInput.value = settings.margins.t;
            if (marginBottomInput) marginBottomInput.value = settings.margins.b;
            if (marginLeftInput) marginLeftInput.value = settings.margins.l;
            if (marginRightInput) marginRightInput.value = settings.margins.r;
            
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
    
    // Use event delegation on document body for better event handling
    document.body.addEventListener('click', menuHandler);
    document.body.addEventListener('change', menuHandler);
    document.body.addEventListener('input', menuHandler);
    
    // Return a cleanup function to remove listeners when needed
    return function cleanup() {
        document.body.removeEventListener('click', menuHandler);
        document.body.removeEventListener('change', menuHandler);
        document.body.removeEventListener('input', menuHandler);
    };
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
    if (!plotContainer) return;
    
    const is3D = settings.z !== null;
    const update = {
        'font.family': settings.fontFamily
    };
    
    if (is3D) {
        update['scene.xaxis.title.font.family'] = settings.fontFamily;
        update['scene.yaxis.title.font.family'] = settings.fontFamily;
        update['scene.zaxis.title.font.family'] = settings.fontFamily;
        update['scene.xaxis.tickfont.family'] = settings.fontFamily;
        update['scene.yaxis.tickfont.family'] = settings.fontFamily;
        update['scene.zaxis.tickfont.family'] = settings.fontFamily;
    } else {
        update['xaxis.title.font.family'] = settings.fontFamily;
        update['yaxis.title.font.family'] = settings.fontFamily;
        update['xaxis.tickfont.family'] = settings.fontFamily;
        update['yaxis.tickfont.family'] = settings.fontFamily;
    }
    
    Plotly.relayout(plotContainer, update);
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
    
    // Tick label visibility
    if (settings.showAxisLabels !== undefined) {
        if (is3D) {
            update['scene.xaxis.showticklabels'] = settings.showAxisLabels;
            update['scene.yaxis.showticklabels'] = settings.showAxisLabels;
            update['scene.zaxis.showticklabels'] = settings.showAxisLabels;
            update['scene.xaxis.ticks'] = settings.showAxisLabels ? 'outside' : 'none';
            update['scene.yaxis.ticks'] = settings.showAxisLabels ? 'outside' : 'none';
            update['scene.zaxis.ticks'] = settings.showAxisLabels ? 'outside' : 'none';
        } else {
            update['xaxis.showticklabels'] = settings.showAxisLabels;
            update['yaxis.showticklabels'] = settings.showAxisLabels;
            update['xaxis.ticks'] = settings.showAxisLabels ? 'outside' : 'none';
            update['yaxis.ticks'] = settings.showAxisLabels ? 'outside' : 'none';
        }
    }
    
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
    if (!plotContainer) return;
    
    const is3D = settings.z !== null;
    const update = {
        'paper_bgcolor': settings.bgColor,
        'plot_bgcolor': settings.bgColor
    };
    
    // For 3D plots, also update the scene background color
    if (is3D) {
        update['scene.bgcolor'] = settings.bgColor;
    }
    
    Plotly.relayout(plotContainer, update);
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
        'scene.xaxis.backgroundcolor': settings.backdropColor,
        'scene.yaxis.backgroundcolor': settings.backdropColor,
        'scene.zaxis.backgroundcolor': settings.backdropColor
    };
    
    Plotly.relayout(plotContainer, update);
}

/**
 * Update text color
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function updateTextColor(plotContainer, settings) {
    if (!plotContainer) return;
    
    const is3D = settings.z !== null;
    const update = {
        'font.color': settings.textColor
    };
    
    if (is3D) {
        update['scene.xaxis.title.font.color'] = settings.textColor;
        update['scene.yaxis.title.font.color'] = settings.textColor;
        update['scene.zaxis.title.font.color'] = settings.textColor;
        update['scene.xaxis.tickfont.color'] = settings.textColor;
        update['scene.yaxis.tickfont.color'] = settings.textColor;
        update['scene.zaxis.tickfont.color'] = settings.textColor;
    } else {
        update['xaxis.title.font.color'] = settings.textColor;
        update['yaxis.title.font.color'] = settings.textColor;
        update['xaxis.tickfont.color'] = settings.textColor;
        update['yaxis.tickfont.color'] = settings.textColor;
    }
    
    Plotly.relayout(plotContainer, update);
}

/**
 * Update grid color
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function updateGridColor(plotContainer, settings) {
    if (!plotContainer) return;
    
    const is3D = settings.z !== null;
    const update = {};
    
    if (is3D) {
        update['scene.xaxis.gridcolor'] = settings.gridColor;
        update['scene.yaxis.gridcolor'] = settings.gridColor;
        update['scene.zaxis.gridcolor'] = settings.gridColor;
    } else {
        update['xaxis.gridcolor'] = settings.gridColor;
        update['yaxis.gridcolor'] = settings.gridColor;
    }
    
    Plotly.relayout(plotContainer, update);
}

/**
 * Update axis color
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function updateAxisColor(plotContainer, settings) {
    if (!plotContainer) return;
    
    const is3D = settings.z !== null;
    const update = {};
    
    if (is3D) {
        update['scene.xaxis.color'] = settings.axisColor;
        update['scene.yaxis.color'] = settings.axisColor;
        update['scene.zaxis.color'] = settings.axisColor;
        update['scene.xaxis.linecolor'] = settings.axisColor;
        update['scene.yaxis.linecolor'] = settings.axisColor;
        update['scene.zaxis.linecolor'] = settings.axisColor;
    } else {
        update['xaxis.color'] = settings.axisColor;
        update['yaxis.color'] = settings.axisColor;
        update['xaxis.linecolor'] = settings.axisColor;
        update['yaxis.linecolor'] = settings.axisColor;
    }
    
    Plotly.relayout(plotContainer, update);
}

/**
 * Update zero line color
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function updateZeroLineColor(plotContainer, settings) {
    if (!plotContainer) return;
    
    const is3D = settings.z !== null;
    const update = {};
    
    if (is3D) {
        update['scene.xaxis.zerolinecolor'] = settings.zeroLineColor;
        update['scene.yaxis.zerolinecolor'] = settings.zeroLineColor;
        update['scene.zaxis.zerolinecolor'] = settings.zeroLineColor;
    } else {
        update['xaxis.zerolinecolor'] = settings.zeroLineColor;
        update['yaxis.zerolinecolor'] = settings.zeroLineColor;
    }
    
    Plotly.relayout(plotContainer, update);
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
    
    if (bgColorInput) bgColorInput.value = settings.bgColor;
    if (textColorInput) textColorInput.value = settings.textColor;
    if (gridColorInput) gridColorInput.value = settings.gridColor;
    if (axisColorInput) axisColorInput.value = settings.axisColor;
    if (zeroLineColorInput) zeroLineColorInput.value = settings.zeroLineColor;
    if (backdropColorInput) backdropColorInput.value = settings.backdropColor;
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
        'paper_bgcolor': settings.bgColor,
        'plot_bgcolor': settings.bgColor,
        'font.color': settings.textColor,
        'xaxis.gridcolor': settings.gridColor,
        'yaxis.gridcolor': settings.gridColor,
        'xaxis.color': settings.axisColor,
        'yaxis.color': settings.axisColor,
        'xaxis.linecolor': settings.axisColor, 
        'yaxis.linecolor': settings.axisColor,
        'xaxis.zerolinecolor': settings.zeroLineColor,
        'yaxis.zerolinecolor': settings.zeroLineColor,
        'xaxis.tickfont.color': settings.textColor,
        'yaxis.tickfont.color': settings.textColor,
        'xaxis.title.font.color': settings.textColor,
        'yaxis.title.font.color': settings.textColor
    };
    
    // For 3D plots
    if (is3D) {
        Object.assign(update, {
            'scene.bgcolor': settings.bgColor,
            'scene.xaxis.showbackground': settings.showBackdrop,
            'scene.yaxis.showbackground': settings.showBackdrop,
            'scene.zaxis.showbackground': settings.showBackdrop,
            'scene.xaxis.backgroundcolor': settings.backdropColor,
            'scene.yaxis.backgroundcolor': settings.backdropColor,
            'scene.zaxis.backgroundcolor': settings.backdropColor,
            'scene.xaxis.gridcolor': settings.gridColor,
            'scene.yaxis.gridcolor': settings.gridColor,
            'scene.zaxis.gridcolor': settings.gridColor,
            'scene.xaxis.color': settings.axisColor,
            'scene.yaxis.color': settings.axisColor,
            'scene.zaxis.color': settings.axisColor,
            'scene.xaxis.linecolor': settings.axisColor,
            'scene.yaxis.linecolor': settings.axisColor,
            'scene.zaxis.linecolor': settings.axisColor,
            'scene.xaxis.zerolinecolor': settings.zeroLineColor,
            'scene.yaxis.zerolinecolor': settings.zeroLineColor,
            'scene.zaxis.zerolinecolor': settings.zeroLineColor,
            'scene.xaxis.tickfont.color': settings.textColor,
            'scene.yaxis.tickfont.color': settings.textColor,
            'scene.zaxis.tickfont.color': settings.textColor,
            'scene.xaxis.title.font.color': settings.textColor,
            'scene.yaxis.title.font.color': settings.textColor,
            'scene.zaxis.title.font.color': settings.textColor
        });
    }
    
    Plotly.relayout(plotContainer, update);
}

/**
 * Notify that multiple settings have changed
 * @param {string} id - Panel ID
 * @param {Array} changes - Array of {setting, value} objects
 */
function notifyMultipleSettingsChanged(id, changes) {
    changes.forEach(change => {
        const event = new CustomEvent('plotSettingsChanged', { 
            detail: { id, setting: change.setting, value: change.value } 
        });
        document.dispatchEvent(event);
    });
}

/**
 * Update font size in the plot
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function updateFontSize(plotContainer, settings) {
    if (!plotContainer) return;
    
    const is3D = settings.z !== null;
    
    // Basic layout updates for axes
    const update = {
        'font.size': settings.fontSize,
        'xaxis.title.font.size': settings.fontSize + 2,
        'yaxis.title.font.size': settings.fontSize + 2,
        'xaxis.tickfont.size': settings.fontSize,
        'yaxis.tickfont.size': settings.fontSize,
        
        // Legend font settings
        'legend.title.font.size': settings.fontSize + 2,
        'legend.font.size': settings.fontSize,
        
        // Global colorbar font settings (if any)
        'coloraxis.colorbar.title.font.size': settings.fontSize + 2,
        'coloraxis.colorbar.tickfont.size': settings.fontSize
    };
    
    // For 3D plots
    if (is3D) {
        Object.assign(update, {
            'scene.xaxis.title.font.size': settings.fontSize + 2,
            'scene.yaxis.title.font.size': settings.fontSize + 2,
            'scene.zaxis.title.font.size': settings.fontSize + 2,
            'scene.xaxis.tickfont.size': settings.fontSize,
            'scene.yaxis.tickfont.size': settings.fontSize,
            'scene.zaxis.tickfont.size': settings.fontSize
        });
    }
    
    // Apply the layout updates
    Plotly.relayout(plotContainer, update);
    
    // Update trace-specific colorbar settings
    if (plotContainer.data) {
        plotContainer.data.forEach((trace, i) => {
            // Skip focused entity trace
            if (trace.name && trace.name.includes('Focused')) return;
            
            const traceUpdate = {};
            
            // Update marker.colorbar (for scatter plots with continuous color)
            if (trace.marker && trace.marker.colorbar) {
                traceUpdate['marker.colorbar.title.font.size'] = settings.fontSize + 2;
                traceUpdate['marker.colorbar.tickfont.size'] = settings.fontSize;
            }
            
            // Update colorbar directly (for heatmaps, contour plots)
            if (trace.colorbar) {
                traceUpdate['colorbar.title.font.size'] = settings.fontSize + 2;
                traceUpdate['colorbar.tickfont.size'] = settings.fontSize;
            }
            
            // Apply trace updates if we have any
            if (Object.keys(traceUpdate).length > 0) {
                Plotly.restyle(plotContainer, traceUpdate, [i]);
            }
        });
    }
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
export function legendPlacement(data, posConfig) {
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
    'legend.orientation': posConfig.legendOrientation,
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
   
    if (hasColoraxis) {
        Plotly.relayout(plotDiv, { showlegend: false, showscale: show });
    } else {
        Plotly.relayout(plotDiv, { showlegend: show, showscale: false });
    }
    // 3) Per-trace toggles
    plotDiv.data.forEach((trace, i) => {
        if (typeof trace.name === 'string' && (trace.name.includes('Focused'))) return;
        const update = {};
        const hasMarkerCB = trace.marker && trace.marker.colorscale;
        const hasTraceCB  = ['heatmap','contour','surface'].includes(trace.type);
    
        if (hasMarkerCB) {
            // continuous scatter: hide from legend, toggle marker colorbar
            update.showlegend             = false;
            update['marker.showscale']    = show;
        }
        else if (hasTraceCB) {
            // heatmap/contour/surface: hide from legend, toggle trace colorbar
            update.showlegend = false;
            update.showscale   = show;
        }
        else if (trace.meta === 'az-points') {
            // points whose legend entry is a proxy trace (withLegendProxies)
            update.showlegend = false;
        }
        else {
            // categorical / other traces: toggle legend, ensure no leftover colorbars
            update.showlegend          = hasColoraxis ? false : show;
            if (trace.marker) update['marker.showscale'] = false;
            if (trace.showscale !== undefined) update.showscale = false;
        }
    
        // apply if anything changed
        if (Object.keys(update).length) {
            Plotly.restyle(plotDiv, update, [i]);
        }
    });

    // Legend entries next to a colour bar: keep them off it
    if (show) {
        Plotly.relayout(plotDiv, legendPlacement(plotDiv.data,
            getPositioningByLocation(settings.legendPosition || 'right')));
    }
  }

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
        x: 1.02, xanchor: 'left', y: 0.5, yanchor: 'middle',
        orientation: 'v', titleside: 'right'
      },
      left: {
        legendOrientation: 'v', legendX: -0.05, legendY: 0.5,
        legendXanchor: 'right', legendYanchor: 'middle',
        x: -0.1, xanchor: 'right', y: 0.5, yanchor: 'middle',
        orientation: 'v', titleside: 'right'
      },
      top: {
        legendOrientation: 'h', legendX: 0.5, legendY: 1.15,
        legendXanchor: 'center', legendYanchor: 'top',
        x: 0.5, xanchor: 'center', y: 1.1, yanchor: 'top',
        orientation: 'h', titleside: 'top'
      },
      bottom: {
        legendOrientation: 'h', legendX: 0.5, legendY: -0.15,
        legendXanchor: 'center', legendYanchor: 'top',
        x: 0.5, xanchor: 'center', y: -0.1, yanchor: 'bottom',
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
  
    // 1) Legend positioning (layout update), off the colour bar if both show
    Plotly.relayout(plotContainer, legendPlacement(plotContainer.data, posConfig));
  

    // 2) Shared coloraxis: hide → update → show
    // ------------------------------------------------
    // hide any existing shared bar
    // update its geometry
    const coloraxisVisible = plotContainer.layout.coloraxis?.showscale ?? false;
    if (coloraxisVisible) {
        Plotly.relayout(plotContainer, {
        'coloraxis.colorbar.x':         posConfig.x,
        'coloraxis.colorbar.y':         posConfig.y,
        'coloraxis.colorbar.xanchor':   posConfig.xanchor,
        'coloraxis.colorbar.yanchor':   posConfig.yanchor,
        'coloraxis.colorbar.orientation': posConfig.orientation,
        'coloraxis.colorbar.titleside':   posConfig.titleside,
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
          'marker.colorbar.x':          posConfig.x,
          'marker.colorbar.y':          posConfig.y,
          'marker.colorbar.xanchor':    posConfig.xanchor,
          'marker.colorbar.yanchor':    posConfig.yanchor,
          'marker.colorbar.orientation': posConfig.orientation,
          'marker.colorbar.titleside':   posConfig.titleside,
          'marker.showscale':           currentVisible
        }, [i]);
      }
      else if (isHeat) {
        Plotly.restyle(plotContainer, { showscale: false }, [i]);
        Plotly.restyle(plotContainer, {
          'colorbar.x':          posConfig.x,
          'colorbar.y':          posConfig.y,
          'colorbar.xanchor':    posConfig.xanchor,
          'colorbar.yanchor':    posConfig.yanchor,
          'colorbar.orientation': posConfig.orientation,
          'colorbar.titleside':   posConfig.titleside,
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
  const filename = 'plot_' + new Date()
    .toISOString()
    .replace(/[:.]/g, '-');

  const showNotification = (message, autoHide = true, type = 'success') => {
      if (!downloadButton) return null;
      // Remove any existing notification
      const existingPopover = bootstrap.Popover.getInstance(downloadButton);
      if (existingPopover) existingPopover.dispose();
      
      // Create new notification popover
      const popover = new bootstrap.Popover(downloadButton, {
        content: message,
        placement: 'top',
        customClass: `notification-popover ${type}-notification`,
        trigger: 'manual',
        delay: { hide: 1500 }
      });
      
      // Show and auto-hide after 2 seconds
      popover.show();
      if (autoHide) {
        setTimeout(() => {
            if (popover) popover.dispose();
        }, 2000);
      }
      return popover;
      
    };

  // checked again at the click: the panels open may have changed since the menu was drawn
  const check = how === 'full' ? exportCheck(plotContainer, opts) : null;
  if (check && check.verdict === 'block') {
    showNotification(`Not exported: ${refusalText(check, EXPORT_ADVICE)}`, true, 'error');
    return;
  }
  _exportInProgress = true;
  const popoverContainer = showNotification("Preparing Image", false);
  try {
    await guarded(check, { panel: panelId, action: 'export', format }, () =>
      exportImage(plotContainer, how, { format, ...opts, filename }));
  } catch (err) {
    console.error('Error exporting plot:', err);
    // beside the button, as the other export outcomes are; not a blocking alert
    showNotification('Export failed; please try again', true, 'error');
  } finally {
    _exportInProgress = false;
    if (popoverContainer) popoverContainer.dispose();
  }
}

/**
 * The modebar camera: a full-resolution PNG when it fits; otherwise the
 * status strip says why, with "Export as shown" (a click, never a reroute).
 */
registerCameraExport(async (gd, opts) => {
  const o = { width: opts.width || 1200, height: opts.height || 800, scale: opts.scale || 1 };
  const check = exportCheck(gd, o);
  if (check.verdict === 'block') {
    const why = refusalText(check, EXPORT_ADVICE);
    setStatusTag(gd, 'memory', { text: 'Not exported: browser memory', severity: 'warning', title: why,
      pop: { text: why, actions: canSnapshot(gd) ? [['export-shown', 'Export as shown']] : [] } });
    nudgeStatusTag(gd, 'memory');
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
    const showNotification = (message, type = 'success') => {
      if (!copyBtn) return;
      const existingPopover = bootstrap.Popover.getInstance(copyBtn);
      if (existingPopover) existingPopover.dispose();
      const popover = new bootstrap.Popover(copyBtn, {
        content: message,
        placement: 'top',
        customClass: `notification-popover ${type}-notification`,
        trigger: 'manual',
        delay: { hide: 1500 }
      });
      popover.show();
      setTimeout(() => {
        if (popover) popover.dispose();
      }, 2000);
    };
    const check = exportCheck(plotContainer, opts);
    if (check.verdict === 'block') {
      showNotification(`Not copied: ${refusalText(check, EXPORT_ADVICE)}`, 'error');
      return;
    }
    try {
      const dataUrl = await guarded(check, { panel: getPanelId(plotContainer), action: 'export', format: 'png' },
        () => exportWithCoverage(plotContainer, () => fullImage(plotContainer, { format: 'png', ...opts })));
      const blob = await fetch(dataUrl).then(res => res.blob());
      if (!navigator.clipboard || !window.ClipboardItem) throw new Error('Clipboard API not supported');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      showNotification('Plot image copied to clipboard', 'success');
    } catch (err) {
      console.error('Copy to clipboard failed:', err);
      showNotification('Could not copy image', 'error');
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
    
    // Get colors - either from settings or from defaults
    const defaults = (window.Config && window.Config.DEFAULTS && window.Config.DEFAULTS.PLOT_AESTHETICS) || {};
    const gridColor = settings.gridColor || defaults.GRID_COLOR || '#e6e6e6';
    const textColor = settings.textColor || defaults.TEXT_COLOR || '#000000';
    const axisColor = settings.axisColor || defaults.AXIS_COLOR || '#000000';
    const zeroLineColor = settings.zeroLineColor || defaults.ZERO_LINE_COLOR || '#cccccc';
    const bgColor = settings.bgColor || defaults.BG_COLOR || '#ffffff';
    
    // First, update the basic layout (without legend/colorbar details)
    const update = {
        // Basic layout
        'margin': settings.margins,
        'paper_bgcolor': bgColor,
        'plot_bgcolor': bgColor,
        'font.color': textColor,
        'font.size': settings.fontSize,
        'font.family': settings.fontFamily || 'Arial, Helvetica, sans-serif',
        'hovermode': settings.showHoverInfo ? 'closest' : false,
        
        // Legend position settings (actual visibility will be handled separately)
        'legend.orientation': (settings.legendPosition === 'left' || settings.legendPosition === 'right') ? 'v' : 'h',
        'legend.x': settings.legendPosition === 'right' ? 1.05 : settings.legendPosition === 'left' ? -0.05 : 0.5,
        'legend.y': settings.legendPosition === 'top' ? 1.15 : settings.legendPosition === 'bottom' ? -0.15 : 0.5,
        'legend.xanchor': settings.legendPosition === 'right' ? 'left' : settings.legendPosition === 'left' ? 'right' : 'center',
        'legend.yanchor': settings.legendPosition === 'top' ? 'top' : settings.legendPosition === 'bottom' ? 'top' : 'middle',
        
        // Interaction
        'xaxis.fixedrange': !settings.enableZoom,
        'yaxis.fixedrange': !settings.enableZoom,
        
        // Set legend visibility (global setting)
        'showlegend': settings.showLegend !== false,
        
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
        'xaxis.ticks': settings.showAxisLabels !== false ? 'outside' : 'none',
        'yaxis.ticks': settings.showAxisLabels !== false ? 'outside' : 'none',
        'xaxis.tickcolor': axisColor,
        'yaxis.tickcolor': axisColor,
        'xaxis.showticklabels': settings.showAxisLabels !== false,
        'yaxis.showticklabels': settings.showAxisLabels !== false,
        'xaxis.color': axisColor,
        'yaxis.color': axisColor,
        'xaxis.title.text': settings.showAxisTitles ? axisTitle(settings, 'x') : '',
        'yaxis.title.text': settings.showAxisTitles ? axisTitle(settings, 'y') : '',
        'xaxis.title.font.size': settings.fontSize + 2,
        'yaxis.title.font.size': settings.fontSize + 2,
        'xaxis.title.font.family': settings.fontFamily || 'Arial, Helvetica, sans-serif',
        'yaxis.title.font.family': settings.fontFamily || 'Arial, Helvetica, sans-serif',
        'xaxis.title.font.color': textColor,
        'yaxis.title.font.color': textColor,
        'xaxis.tickfont.size': settings.fontSize,
        'yaxis.tickfont.size': settings.fontSize,
        'xaxis.tickfont.family': settings.fontFamily || 'Arial, Helvetica, sans-serif',
        'yaxis.tickfont.family': settings.fontFamily || 'Arial, Helvetica, sans-serif',
        'xaxis.tickfont.color': textColor,
        'yaxis.tickfont.color': textColor,
        
    };
    
    // For 3D plots
    if (is3D) {
        const backdropColor = settings.backdropColor || defaults.BACKDROP_COLOR || '#f0f0f0';
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
            'scene.xaxis.ticks': settings.showAxisLabels !== false ? 'outside' : 'none',
            'scene.yaxis.ticks': settings.showAxisLabels !== false ? 'outside' : 'none',
            'scene.zaxis.ticks': settings.showAxisLabels !== false ? 'outside' : 'none',
            'scene.xaxis.tickcolor': axisColor,
            'scene.yaxis.tickcolor': axisColor,
            'scene.zaxis.tickcolor': axisColor,
            'scene.xaxis.showticklabels': settings.showAxisLabels !== false,
            'scene.yaxis.showticklabels': settings.showAxisLabels !== false,
            'scene.zaxis.showticklabels': settings.showAxisLabels !== false,
            'scene.xaxis.color': axisColor,
            'scene.yaxis.color': axisColor,
            'scene.zaxis.color': axisColor,
            'scene.xaxis.title.text': settings.showAxisTitles ? axisTitle(settings, 'x') : '',
            'scene.yaxis.title.text': settings.showAxisTitles ? axisTitle(settings, 'y') : '',
            'scene.zaxis.title.text': settings.showAxisTitles ? axisTitle(settings, 'z') : '',
            'scene.xaxis.title.font.size': settings.fontSize + 2,
            'scene.yaxis.title.font.size': settings.fontSize + 2,
            'scene.zaxis.title.font.size': settings.fontSize + 2,
            'scene.xaxis.title.font.family': settings.fontFamily || 'Arial, Helvetica, sans-serif',
            'scene.yaxis.title.font.family': settings.fontFamily || 'Arial, Helvetica, sans-serif',
            'scene.zaxis.title.font.family': settings.fontFamily || 'Arial, Helvetica, sans-serif',
            'scene.xaxis.title.font.color': textColor,
            'scene.yaxis.title.font.color': textColor,
            'scene.zaxis.title.font.color': textColor,
            'scene.xaxis.tickfont.size': settings.fontSize,
            'scene.yaxis.tickfont.size': settings.fontSize,
            'scene.zaxis.tickfont.size': settings.fontSize,
            'scene.xaxis.tickfont.family': settings.fontFamily || 'Arial, Helvetica, sans-serif',
            'scene.yaxis.tickfont.family': settings.fontFamily || 'Arial, Helvetica, sans-serif',
            'scene.zaxis.tickfont.family': settings.fontFamily || 'Arial, Helvetica, sans-serif',
            'scene.xaxis.tickfont.color': textColor,
            'scene.yaxis.tickfont.color': textColor,
            'scene.zaxis.tickfont.color': textColor,
            
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
    
    // Apply the basic layout first
    Plotly.relayout(plotContainer, update);
    
    // Then handle legend and colorbar visibility specifically based on trace type
    updateLegendVisibility(plotContainer, settings);
    updateLegendPosition(plotContainer, settings);
}
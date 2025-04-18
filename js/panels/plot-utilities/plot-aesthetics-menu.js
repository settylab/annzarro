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
    
    return `
    <div class="aesthetics-menu-content">
        <!-- Appearance Section -->
        <div class="aesthetics-section">
            <h6>Appearance</h6>
            
            <!-- Grid Controls -->
            <div class="form-check form-switch mb-2">
                <input class="form-check-input" type="checkbox" id="grid-toggle-${id}" 
                    ${settings.showGrid ? 'checked' : ''}>
                <label class="form-check-label" for="grid-toggle-${id}">Show Grid</label>
            </div>

            <!-- Background Color -->
            <div class="mb-2">
                <label class="form-label mb-1">Background</label>
                <div class="d-flex align-items-center gap-2">
                    <input type="color" class="form-control form-control-sm form-control-color" 
                        id="plot-bg-color-${id}" value="${settings.bgColor || '#ffffff'}" title="Choose background color">
                    <button class="btn btn-sm btn-outline-secondary" id="reset-bg-color-${id}">Reset</button>
                </div>
            </div>

            <!-- Dark Mode Toggle -->
            <div class="form-check form-switch mb-2">
                <input class="form-check-input" type="checkbox" id="dark-mode-toggle-${id}" 
                    ${settings.darkMode ? 'checked' : ''}>
                <label class="form-check-label" for="dark-mode-toggle-${id}">Dark Mode</label>
            </div>
        </div>
        
        <!-- Axes Section -->
        <div class="aesthetics-section">
            <h6>Axes</h6>
            
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
            </div>
            
            <!-- Font Size -->
            <div class="mb-2">
                <label class="form-label mb-1">Font Size</label>
                <div class="input-group input-group-sm">
                    <input type="number" class="form-control" id="font-size-${id}" 
                        value="${settings.fontSize || 12}" min="8" max="24" step="1">
                    <span class="input-group-text">px</span>
                </div>
            </div>
        </div>
        
        <!-- Margins Section -->
        <div class="aesthetics-section">
            <h6>Margins</h6>
            <div class="row g-2">
                <div class="col-6">
                    <label class="form-label mb-1">Top</label>
                    <input type="number" class="form-control form-control-sm" id="margin-top-${id}" 
                        value="${settings.margins?.t || 80}" min="0" max="200">
                </div>
                <div class="col-6">
                    <label class="form-label mb-1">Bottom</label>
                    <input type="number" class="form-control form-control-sm" id="margin-bottom-${id}" 
                        value="${settings.margins?.b || 60}" min="0" max="200">
                </div>
                <div class="col-6">
                    <label class="form-label mb-1">Left</label>
                    <input type="number" class="form-control form-control-sm" id="margin-left-${id}" 
                        value="${settings.margins?.l || 80}" min="0" max="200">
                </div>
                <div class="col-6">
                    <label class="form-label mb-1">Right</label>
                    <input type="number" class="form-control form-control-sm" id="margin-right-${id}" 
                        value="${settings.margins?.r || 80}" min="0" max="200">
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
            <div class="d-flex flex-wrap gap-2 mb-2">
                <button class="btn btn-sm btn-outline-primary export-btn" data-format="jpeg" data-id="${id}">
                    <i class="fas fa-file-image"></i> JPEG
                </button>
                <button class="btn btn-sm btn-outline-primary export-btn" data-format="svg" data-id="${id}">
                    <i class="fas fa-file-image"></i> SVG
                </button>
                <button class="btn btn-sm btn-outline-primary export-btn" data-format="webp" data-id="${id}">
                    <i class="fas fa-file-image"></i> WEBP
                </button>
                <button class="btn btn-sm btn-outline-primary export-btn" data-format="png" data-id="${id}">
                    <i class="fas fa-file-image"></i> PNG
                </button>
                <button class="btn btn-sm btn-outline-secondary" id="copy-to-clipboard-${id}">
                    <i class="fas fa-clipboard"></i> Copy
                </button>
            </div>
            
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

/**
 * Initialize the settings object with default aesthetic settings if they don't exist
 * @param {Object} settings - The settings object to initialize
 */
export function initializeAestheticsSettings(settings) {
    // Grid and visibility
    settings.showGrid = settings.showGrid !== undefined ? settings.showGrid : true;
    settings.showAxisTitles = settings.showAxisTitles !== undefined ? settings.showAxisTitles : true;
    settings.showAxisLabels = settings.showAxisLabels !== undefined ? settings.showAxisLabels : true;
    settings.showAxisLines = settings.showAxisLines !== undefined ? settings.showAxisLines : true;
    settings.showZeroLines = settings.showZeroLines !== undefined ? settings.showZeroLines : false;
    settings.showLegend = settings.showLegend !== undefined ? settings.showLegend : true;
    
    // Colors and theme
    settings.bgColor = settings.bgColor || '#ffffff';
    settings.darkMode = settings.darkMode || false;
    
    // Fonts and sizing
    settings.fontSize = settings.fontSize || 12;
    
    // Margins
    settings.margins = settings.margins || { l: 80, r: 80, t: 80, b: 60, pad: 4 };
    
    // Export options
    settings.exportWidth = settings.exportWidth || 1200;
    settings.exportHeight = settings.exportHeight || 800;
    settings.scaleExport = settings.scaleExport || false;
    
    // Legend settings
    settings.legendPosition = settings.legendPosition || 'right';
    
    // Interaction settings
    settings.enableZoom = settings.enableZoom !== undefined ? settings.enableZoom : true;
    settings.enablePan = settings.enablePan !== undefined ? settings.enablePan : true;
    settings.showHoverInfo = settings.showHoverInfo !== undefined ? settings.showHoverInfo : true;
}

/**
 * Setup event listeners for the aesthetics menu
 * @param {HTMLElement} container - Container element
 * @param {Object} settings - Plot settings object
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {string} id - Panel ID
 */
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
            const colorInput = container.querySelector(`#plot-bg-color-${id}`);
            settings.bgColor = '#ffffff';
            if (colorInput) colorInput.value = settings.bgColor;
            updatePlotBackground(plotContainer, settings);
            notifySettingsChanged(id, 'bgColor', settings.bgColor);
            return;
        }
        
        // Dark mode toggle
        if (target.id === `dark-mode-toggle-${id}`) {
            settings.darkMode = target.checked;
            toggleDarkMode(plotContainer, settings);
            notifySettingsChanged(id, 'darkMode', settings.darkMode);
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
            const format = exportBtn.getAttribute('data-format');
            const targetId = exportBtn.getAttribute('data-id');
            if (targetId === id && format) {
                exportPlot(plotContainer, format, settings);
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
        // 2D axes
        'xaxis.showgrid': settings.showGrid,
        'yaxis.showgrid': settings.showGrid,
        'xaxis.showline': settings.showAxisLines !== false && settings.showGrid,
        'yaxis.showline': settings.showAxisLines !== false && settings.showGrid,
        'xaxis.zeroline': settings.showZeroLines && settings.showGrid,
        'yaxis.zeroline': settings.showZeroLines && settings.showGrid,
        'xaxis.ticks': settings.showGrid ? '' : 'none',
        'yaxis.ticks': settings.showGrid ? '' : 'none',
        'xaxis.showticklabels': settings.showAxisLabels !== false && settings.showGrid,
        'yaxis.showticklabels': settings.showAxisLabels !== false && settings.showGrid,
    };
    
    // For 3D plots
    if (is3D) {
        Object.assign(update, {
            'scene.xaxis.showgrid': settings.showGrid,
            'scene.yaxis.showgrid': settings.showGrid,
            'scene.zaxis.showgrid': settings.showGrid,
            'scene.xaxis.showline': settings.showAxisLines !== false && settings.showGrid,
            'scene.yaxis.showline': settings.showAxisLines !== false && settings.showGrid,
            'scene.zaxis.showline': settings.showAxisLines !== false && settings.showGrid,
            'scene.xaxis.zeroline': settings.showZeroLines && settings.showGrid,
            'scene.yaxis.zeroline': settings.showZeroLines && settings.showGrid,
            'scene.zaxis.zeroline': settings.showZeroLines && settings.showGrid,
            'scene.xaxis.ticks': settings.showGrid ? '' : 'none',
            'scene.yaxis.ticks': settings.showGrid ? '' : 'none',
            'scene.zaxis.ticks': settings.showGrid ? '' : 'none',
            'scene.xaxis.showticklabels': settings.showAxisLabels !== false && settings.showGrid,
            'scene.yaxis.showticklabels': settings.showAxisLabels !== false && settings.showGrid,
            'scene.zaxis.showticklabels': settings.showAxisLabels !== false && settings.showGrid,
        });
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
                (settings.xaxisTitle || `${settings.x.type}.${settings.x.key}${settings.x.column ? `.${settings.x.column}` : ''}`) : '';
            update['scene.yaxis.title.text'] = settings.showAxisTitles ? 
                (settings.yaxisTitle || `${settings.y.type}.${settings.y.key}${settings.y.column ? `.${settings.y.column}` : ''}`) : '';
            update['scene.zaxis.title.text'] = settings.showAxisTitles ? 
                (settings.zaxisTitle || `${settings.z.type}.${settings.z.key}${settings.z.column ? `.${settings.z.column}` : ''}`) : '';
        } else {
            update['xaxis.title.text'] = settings.showAxisTitles ? 
                (settings.xaxisTitle || `${settings.x.type}.${settings.x.key}${settings.x.column ? `.${settings.x.column}` : ''}`) : '';
            update['yaxis.title.text'] = settings.showAxisTitles ? 
                (settings.yaxisTitle || `${settings.y.type}.${settings.y.key}${settings.y.column ? `.${settings.y.column}` : ''}`) : '';
        }
    }
    
    // Tick label visibility
    if (settings.showAxisLabels !== undefined) {
        if (is3D) {
            update['scene.xaxis.showticklabels'] = settings.showAxisLabels;
            update['scene.yaxis.showticklabels'] = settings.showAxisLabels;
            update['scene.zaxis.showticklabels'] = settings.showAxisLabels;
        } else {
            update['xaxis.showticklabels'] = settings.showAxisLabels;
            update['yaxis.showticklabels'] = settings.showAxisLabels;
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
 * Update plot background color
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function updatePlotBackground(plotContainer, settings) {
    if (!plotContainer) return;
    
    const update = {
        'paper_bgcolor': settings.bgColor,
        'plot_bgcolor': settings.bgColor
    };
    
    Plotly.relayout(plotContainer, update);
}

/**
 * Toggle dark mode for the plot
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function toggleDarkMode(plotContainer, settings) {
    if (!plotContainer) return;
    
    const is3D = settings.z !== null;
    const gridColor = settings.darkMode ? '#444444' : '#e6e6e6';
    const textColor = settings.darkMode ? '#ffffff' : '#000000';
    const bgColor = settings.darkMode ? '#1e1e1e' : settings.bgColor || '#ffffff';
    
    const update = {
        'paper_bgcolor': bgColor,
        'plot_bgcolor': bgColor,
        'font.color': textColor,
        'xaxis.gridcolor': gridColor,
        'yaxis.gridcolor': gridColor,
        'xaxis.color': textColor,
        'yaxis.color': textColor
    };
    
    // For 3D plots
    if (is3D) {
        Object.assign(update, {
            'scene.xaxis.gridcolor': gridColor,
            'scene.yaxis.gridcolor': gridColor,
            'scene.zaxis.gridcolor': gridColor,
            'scene.xaxis.color': textColor,
            'scene.yaxis.color': textColor,
            'scene.zaxis.color': textColor,
            'scene.bgcolor': bgColor
        });
    }
    
    Plotly.relayout(plotContainer, update);
}

/**
 * Update font size in the plot
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function updateFontSize(plotContainer, settings) {
    if (!plotContainer) return;
    
    const is3D = settings.z !== null;
    const update = {
        'font.size': settings.fontSize,
        'xaxis.title.font.size': settings.fontSize + 2,
        'yaxis.title.font.size': settings.fontSize + 2,
        'xaxis.tickfont.size': settings.fontSize,
        'yaxis.tickfont.size': settings.fontSize
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
    
    Plotly.relayout(plotContainer, update);
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
 * Update legend & colorbar visibility
 * @param {HTMLElement} plotDiv  – Plotly graph div
 * @param {Object}      settings – Must include boolean settings.showLegend
 */
function updateLegendVisibility(plotDiv, settings) {
    if (!plotDiv || settings.showLegend === undefined) return;
    const show = settings.showLegend;
  
    // 1) Layout: overall legend on/off
    Plotly.relayout(plotDiv, { showlegend: show });
  
    // 2) Layout: any shared coloraxes (coloraxis, coloraxis2, etc.)
    const layout = plotDiv.layout || {};
    Object.keys(layout)
      .filter(key => key.startsWith('coloraxis') && layout[key].showscale !== undefined)
      .forEach(ca => {
        Plotly.relayout(plotDiv, { [`${ca}.showscale`]: show });
      });
  
    // 3) Per-trace toggles
    plotDiv.data.forEach((trace, i) => {
        if (typeof trace.name === 'string' && trace.name.includes('Focused')) return;
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
        else {
            // categorical / other traces: toggle legend, ensure no leftover colorbars
            update.showlegend          = show;
            if (trace.marker) update['marker.showscale'] = false;
            if (trace.showscale !== undefined) update.showscale = false;
        }
    
        // apply if anything changed
        if (Object.keys(update).length) {
            Plotly.restyle(plotDiv, update, [i]);
        }
    });
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
        x: -0.02, xanchor: 'right', y: 0.5, yanchor: 'middle',
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
  
    // 1) Legend positioning (layout update)
    Plotly.relayout(plotContainer, {
      'legend.orientation': posConfig.legendOrientation,
      'legend.x':           posConfig.legendX,
      'legend.y':           posConfig.legendY,
      'legend.xanchor':     posConfig.legendXanchor,
      'legend.yanchor':     posConfig.legendYanchor
    });
  
    // 2) Shared coloraxis: hide → update → show
    // ------------------------------------------------
    // hide any existing shared bar
    Plotly.relayout(plotContainer, { 'coloraxis.showscale': false });
    // update its geometry
    Plotly.relayout(plotContainer, {
      'coloraxis.colorbar.x':         posConfig.x,
      'coloraxis.colorbar.y':         posConfig.y,
      'coloraxis.colorbar.xanchor':   posConfig.xanchor,
      'coloraxis.colorbar.yanchor':   posConfig.yanchor,
      'coloraxis.colorbar.orientation': posConfig.orientation,
      'coloraxis.colorbar.titleside':   posConfig.titleside
    });
    // re‑show it
    Plotly.relayout(plotContainer, { 'coloraxis.showscale': true });
  
    // 3) Per‑trace bars: hide → update → show
    // ------------------------------------------------
    plotContainer.data.forEach((trace, i) => {
      if (typeof trace.name === 'string' && trace.name.includes('Focused')) return;
  
      // scatter traces with marker.colorbar
      const isScatter = trace.marker && Array.isArray(trace.marker.color) && trace.marker.colorscale;
      // heatmap/contour/surface traces
      const isHeat   = trace.type && ['heatmap','contour','surface'].includes(trace.type) && trace.colorbar;
  
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
          'marker.showscale':           true
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
          showscale:             true
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
 */
export async function exportPlot(plotContainer, format, settings) {
  if (!plotContainer) return;
  if (_exportInProgress) {
    console.warn('Export already in progress – please wait.');
    return;
  }
  _exportInProgress = true;

  const width  = settings.exportWidth  || 1200;
  const height = settings.exportHeight ||  800;
  const scale  = settings.scaleExport ? 2 : 1;
  const filename = 'plot_' + new Date()
    .toISOString()
    .replace(/[:.]/g, '-');

  const config = { format, width, height, scale, filename };

  try {
    await Plotly.downloadImage(plotContainer, config);
  } catch (err) {
    console.error('Error exporting plot:', err);
    alert('Failed to export plot. Please try again.');
  } finally {
    _exportInProgress = false;
  }
}

/**
 * Copy the Plotly plot to clipboard as a PNG image
 * @param {HTMLElement} plotContainer – Plotly graph div
 * @param {Object} settings – May include exportWidth, exportHeight
 */
async function copyPlotToClipboard(plotContainer, settings) {
    if (!plotContainer) return;
    const width  = settings.exportWidth  || 1200;
    const height = settings.exportHeight ||  800;
  
    try {
      // 1) Render plot to a data‐URL
      const dataUrl = await Plotly.toImage(plotContainer, {
        format: 'png', width, height, scale: 1
      });
  
      // 2) Convert the data‐URL to a Blob
      const blob = await fetch(dataUrl).then(res => res.blob());
  
      // 3) Attempt to write the blob into the clipboard
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]);
        alert('✔️ Plot image copied to clipboard!');
      } else {
        throw new Error('Clipboard API not supported');
      }
    }
    catch (err) {
      console.warn('Clipboard copy failed, downloading image instead:', err);
  
      // Fallback: force-download the PNG
      const downloadLink = document.createElement('a');
      downloadLink.href = URL.createObjectURL(
        await fetch(Plotly.toImage(plotContainer, { format:'png', width, height })).then(r=>r.blob())
      );
      downloadLink.download = `plot_${new Date().toISOString().replace(/[:.]/g,'-')}.png`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
  
      alert('Plot exported as PNG.');  
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
    const gridColor = settings.darkMode ? '#444444' : '#e6e6e6';
    const textColor = settings.darkMode ? '#ffffff' : '#000000';
    const bgColor = settings.darkMode ? '#1e1e1e' : settings.bgColor || '#ffffff';
    
    // First, update the basic layout (without legend/colorbar details)
    const update = {
        // Basic layout
        'margin': settings.margins,
        'paper_bgcolor': bgColor,
        'plot_bgcolor': bgColor,
        'font.color': textColor,
        'font.size': settings.fontSize,
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
        'xaxis.showline': settings.showAxisLines !== false && settings.showGrid,
        'yaxis.showline': settings.showAxisLines !== false && settings.showGrid,
        'xaxis.zeroline': settings.showZeroLines && settings.showGrid,
        'yaxis.zeroline': settings.showZeroLines && settings.showGrid,
        'xaxis.ticks': settings.showGrid ? '' : 'none',
        'yaxis.ticks': settings.showGrid ? '' : 'none',
        'xaxis.showticklabels': settings.showAxisLabels !== false && settings.showGrid,
        'yaxis.showticklabels': settings.showAxisLabels !== false && settings.showGrid,
        'xaxis.color': textColor,
        'yaxis.color': textColor,
        'xaxis.title.text': settings.showAxisTitles ? (settings.xaxisTitle || `${settings.x.type}.${settings.x.key}${settings.x.column ? `.${settings.x.column}` : ''}`) : '',
        'yaxis.title.text': settings.showAxisTitles ? (settings.yaxisTitle || `${settings.y.type}.${settings.y.key}${settings.y.column ? `.${settings.y.column}` : ''}`) : '',
        'xaxis.title.font.size': settings.fontSize + 2,
        'yaxis.title.font.size': settings.fontSize + 2,
        'xaxis.tickfont.size': settings.fontSize,
        'yaxis.tickfont.size': settings.fontSize
    };
    
    // For 3D plots
    if (is3D) {
        Object.assign(update, {
            'scene.bgcolor': bgColor,
            'scene.xaxis.gridcolor': gridColor,
            'scene.yaxis.gridcolor': gridColor,
            'scene.zaxis.gridcolor': gridColor,
            'scene.xaxis.showgrid': settings.showGrid,
            'scene.yaxis.showgrid': settings.showGrid,
            'scene.zaxis.showgrid': settings.showGrid,
            'scene.xaxis.showline': settings.showAxisLines !== false && settings.showGrid,
            'scene.yaxis.showline': settings.showAxisLines !== false && settings.showGrid,
            'scene.zaxis.showline': settings.showAxisLines !== false && settings.showGrid,
            'scene.xaxis.zeroline': settings.showZeroLines && settings.showGrid,
            'scene.yaxis.zeroline': settings.showZeroLines && settings.showGrid,
            'scene.zaxis.zeroline': settings.showZeroLines && settings.showGrid,
            'scene.xaxis.ticks': settings.showGrid ? '' : 'none',
            'scene.yaxis.ticks': settings.showGrid ? '' : 'none',
            'scene.zaxis.ticks': settings.showGrid ? '' : 'none',
            'scene.xaxis.showticklabels': settings.showAxisLabels !== false && settings.showGrid,
            'scene.yaxis.showticklabels': settings.showAxisLabels !== false && settings.showGrid,
            'scene.zaxis.showticklabels': settings.showAxisLabels !== false && settings.showGrid,
            'scene.xaxis.color': textColor,
            'scene.yaxis.color': textColor,
            'scene.zaxis.color': textColor,
            'scene.xaxis.title.text': settings.showAxisTitles ? (settings.xaxisTitle || `${settings.x.type}.${settings.x.key}${settings.x.column ? `.${settings.x.column}` : ''}`) : '',
            'scene.yaxis.title.text': settings.showAxisTitles ? (settings.yaxisTitle || `${settings.y.type}.${settings.y.key}${settings.y.column ? `.${settings.y.column}` : ''}`) : '',
            'scene.zaxis.title.text': settings.showAxisTitles ? (settings.zaxisTitle || `${settings.z.type}.${settings.z.key}${settings.z.column ? `.${settings.z.column}` : ''}`) : '',
            'scene.xaxis.title.font.size': settings.fontSize + 2,
            'scene.yaxis.title.font.size': settings.fontSize + 2,
            'scene.zaxis.title.font.size': settings.fontSize + 2,
            'scene.xaxis.tickfont.size': settings.fontSize,
            'scene.yaxis.tickfont.size': settings.fontSize,
            'scene.zaxis.tickfont.size': settings.fontSize
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
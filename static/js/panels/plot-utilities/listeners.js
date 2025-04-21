import { updateColorSliderUI, setupAxisSelector, showDropdownLoading } from './panel-ui-update.js';
import { loadAxisData } from './plot-make.js';
import { updatePlotElements, loadColorDataAndUpdatePlot, highlightFocusedEntity, removeHighlight } from './plot-update.js';
import { DataManager } from '../../data-manager.js';
import { 
  setupAestheticsMenuListeners, 
  createAestheticsMenu,
  applyAllAestheticSettings,
  initializeAestheticsSettings,
  createPopoverContent
} from './plot-aesthetics-menu.js';
import * as $ from '../../utils/jquery-helpers.js';

export function setupPlotEventListeners({
    plotContainer,
    controlsContainer,
    settings,
    plotType,
    data,
    id,
    loadDataAndCreatePlot,
    onFocusedCellChanged,
    onFocusedGeneChanged
  }) {

    const observer = setupResizeObserver(plotContainer);
    
    // Set up other listeners immediately
    setupAxisSelectorListeners(
        controlsContainer,
        plotContainer,
        settings,
        plotType,
        data,
        id,
        loadDataAndCreatePlot,
        onFocusedCellChanged,
        onFocusedGeneChanged);

    setupPlotControlListeners(
        controlsContainer,
        settings,
        plotContainer,
        plotType,
        data,
        id,
        loadDataAndCreatePlot,
        updatePlotElements
    );
    
    setupColorControls(
        controlsContainer,
        settings,
        data,
        plotContainer,
        id,
        loadDataAndCreatePlot,
    );

    return observer;
}


/**
 * Sets up a ResizeObserver to autosize a Plotly plot when its container resizes.
 * @param {HTMLElement} plotContainer - The DOM element containing the plot.
 * @returns {ResizeObserver|null} - The created ResizeObserver instance or null if not supported.
 */
export function setupResizeObserver(plotContainer) {
    // Add detailed debugging to identify the specific issue
    if (!plotContainer) {
      console.warn('ResizeObserver setup failed: plot container is null or undefined');
      return null;
    }
    
    if (!window.ResizeObserver) {
      console.warn('ResizeObserver setup failed: ResizeObserver API not supported by browser');
      return null;
    }
  
    let resizeTimeout = null;
  
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === plotContainer) {
          clearTimeout(resizeTimeout);
          resizeTimeout = setTimeout(() => {
            try {
              // Check if a Plotly plot exists by verifying the presence of plot data
              if (plotContainer.data && plotContainer.data.length > 0) {
                Plotly.relayout(plotContainer, { autosize: true });
              }
            } catch (error) {
              console.error('Error during Plotly.relayout:', error);
            }
          }, 5); // debounce
        }
      }
    });
  
    observer.observe(plotContainer);
    return observer;
}


/**
 * Sets up plot control listeners (e.g., 3D toggle, point size/opacity sliders, grid toggle,
 * highlight focused cell toggle, refresh plot, lock range) inside the provided container.
 *
 * @param {HTMLElement} controlsContainer - The container element for the control UI.
 * @param {Object} settings - Plot settings (e.g., settings.z, pointSize, pointOpacity,
 *                            showGrid, highlightFocusedCell, lockColorRange, etc.).
 * @param {HTMLElement} plotContainer - The Plotly plot container element.
 * @param {Object} data - Data cache object (e.g., { x, y, z, color, cells, colorType, … }).
 * @param {string|number} id - Unique identifier to build element selectors.
 * @param {Function} loadDataAndCreatePlot - Function to recreate the entire plot.
 * @param {Function} updatePlotElements - Function to update plot properties.
 */
export function setupPlotControlListeners(
    controlsContainer,
    settings,
    plotContainer,
    plotType,
    data,
    id,
    loadDataAndCreatePlot,
    updatePlotElements
  ) {
    // Use jQuery for element selection and event binding
    const $controlsContainer = jQuery(controlsContainer);
    
    // --- 3D Plot Toggle ---
    const $zAxisToggle = $controlsContainer.find(`#z-axis-toggle-${id}`);
    const $zAxisContainer = $controlsContainer.find(`#z-axis-container-${id}`);
    
    $zAxisToggle.on('click', async () => {
      const is3D = $zAxisToggle.hasClass('active');
      if (is3D) {
        // Disable 3D: reset classes, hide 3D controls, update settings
        $.updateButtonState($zAxisToggle, false);
        $zAxisToggle.attr('title', 'Enable 3D plot');
        $zAxisContainer.hide();
        settings.z = null;
        loadDataAndCreatePlot();
      } else {
        // Enable 3D: change button appearance, show controls
        $.updateButtonState($zAxisToggle, true);
        $zAxisToggle.attr('title', '3rd dimension active - click to disable');
        $zAxisContainer.show();
        
        if (!settings.z) {
          const yKey = settings.y?.key || '';
          let zColumn = '2';
          const datasetStructure = await DataManager.getDatasetStructure();
          const df = plotType === 'genes' 
            ? datasetStructure?.varm?.dataframes?.[yKey] 
            : datasetStructure?.obsm?.dataframes?.[yKey];
          const yCol = settings.y?.column;
          if (df?.columns?.length) {
            const yIdx = df.columns.indexOf(yCol);
            if (yIdx !== -1 && yIdx + 1 < df.columns.length) {
              zColumn = df.columns[yIdx + 1];
            } else {
              zColumn = df.columns.at(-1); // fallback to last column
            }
          }
          settings.z = { type: plotType === 'genes' ? 'varm' : 'obsm', key: yKey, column: zColumn };
          // Call the axis selector setup helper from the controls object.
          setupAxisSelector(controlsContainer, 'z', settings.z, plotType, datasetStructure);
        }
        loadDataAndCreatePlot();
      }
    });
  
    // --- Point Size Slider ---
    const $pointSizeSlider = $controlsContainer.find(`#point-size-${id}`);
    $pointSizeSlider.on('input', $.debounce((e) => {
      const newSize = parseFloat(e.target.value);
      settings.pointSize = newSize;
      updatePlotElements(plotContainer, data, settings, loadDataAndCreatePlot, { styling: true })
        .catch(error => {
          console.error("Error updating point size:", error);
          loadDataAndCreatePlot();
        });
    }, 5));
  
    // --- Point Opacity Slider ---
    const $pointOpacitySlider = $controlsContainer.find(`#point-opacity-${id}`);
    $pointOpacitySlider.on('input', $.debounce((e) => {
      const newOpacity = parseFloat(e.target.value);
      settings.pointOpacity = newOpacity;
      updatePlotElements(plotContainer, data, settings, loadDataAndCreatePlot, { styling: true })
        .catch(error => {
          console.error("Error updating point opacity:", error);
          loadDataAndCreatePlot();
        });
    }, 5));
    
    const $existingBtn = $controlsContainer.find(`#aesthetics-menu-btn-${id}`);
    const cleanupAesthetics = createAestheticsMenu(id, $existingBtn[0], controlsContainer, plotContainer, settings);
    plotContainer._aestheticsCleanup = cleanupAesthetics;
  
    // --- Highlight Focused Cell Toggle (conditional) ---
    const $highlightFocusedCellToggle = $controlsContainer.find(`#highlight-focused-cell-${id}`);
    if ($highlightFocusedCellToggle.length) {
      $.updateButtonState($highlightFocusedCellToggle, settings.highlightFocusedCell);
      
      $highlightFocusedCellToggle.on('click', () => {
        settings.highlightFocusedCell = !settings.highlightFocusedCell;
        $.updateButtonState($highlightFocusedCellToggle, settings.highlightFocusedCell);
        
        if (settings.highlightFocusedCell) {
          highlightFocusedEntity(plotContainer, data, settings, 'cells');
        } else {
          removeHighlight(plotContainer);
        }
      });
    }

    // --- Highlight Focused Gene Toggle (conditional) ---
    const $highlightFocusedGeneToggle = $controlsContainer.find(`#highlight-focused-gene-${id}`);
    if ($highlightFocusedGeneToggle.length) {
      $.updateButtonState($highlightFocusedGeneToggle, settings.highlightFocusedGene);
      
      $highlightFocusedGeneToggle.on('click', () => {
        settings.highlightFocusedGene = !settings.highlightFocusedGene;
        $.updateButtonState($highlightFocusedGeneToggle, settings.highlightFocusedGene);
        
        if (settings.highlightFocusedGene) {
          highlightFocusedEntity(plotContainer, data, settings, 'genes');
        } else {
          removeHighlight(plotContainer);
        }
      });
    }
  
    // --- Refresh Plot Button ---
    const $refreshPlotButton = $controlsContainer.find(`#refresh-plot-${id}`);
    $refreshPlotButton.on('click', () => {
      loadDataAndCreatePlot();
    });
  
    // --- Lock Range Button ---
    const $lockRangeButton = $controlsContainer.find(`#lock-range-${id}`);
    $.updateButtonState($lockRangeButton, settings.lockColorRange);
    
    $lockRangeButton.on('click', () => {
      settings.lockColorRange = !settings.lockColorRange;
      $.updateButtonState($lockRangeButton, settings.lockColorRange);
      
      // Optionally trigger a plot update if needed:
      updatePlotElements(plotContainer, data, settings, loadDataAndCreatePlot, { colorRange: true })
        .catch(error => {
          console.error("Error updating color range:", error);
          loadDataAndCreatePlot();
        });
    });
  }

/**
 * Set up color controls (e.g., color scale, opacity, color range inputs, centering, and outlier filtering)
 * for a plot. Uses elements inside the provided container.
 *
 * @param {HTMLElement} controlsContainer - The root element containing the color controls.
 * @param {Object} settings - The plot settings object.
 * @param {Object} data - The data cache object (e.g. { x, y, z, color, cells, colorType, … }).
 * @param {HTMLElement} plotContainer - The element that holds the Plotly plot.
 * @param {string|number} id - Unique identifier used to form element selectors.
 * @param {Function} loadDataAndCreatePlot - Function to reload the entire plot.
 * @param {Function} updatePlot - Function to update the plot visuals (without recreating it).
 */
export function setupColorControls(
    controlsContainer,
    settings,
    data,
    plotContainer,
    id,
    loadDataAndCreatePlot,
) {
    // Use jQuery for DOM manipulation
    const $container = jQuery(controlsContainer);

    // helper closure to avoid passing all parameters
    function _updatePlotElements(options = {}) {
        updatePlotElements(plotContainer, data, settings, loadDataAndCreatePlot, options)
            .catch(error => {
                console.error("Error in _updatePlotElements:", error);
                loadDataAndCreatePlot();
            });
    }

    function _updatePlot(fullDataUpdate = false) {
        console.log(`Updating plot (fullDataUpdate=${fullDataUpdate})`);
        
        if (fullDataUpdate) {
            updateColorSliderUI(controlsContainer, data, settings, id);
            // For full data updates, update colors and data
            _updatePlotElements({
                colors: true,
                colorRange: true, // Update the color range
                styling: true,
                layout: true
            });
        } else {
            updateColorSliderUI(controlsContainer, data, settings, id);
            // For visual-only updates
            _updatePlotElements({
                styling: true,
                colors: false,
                colorRange: settings.colorMin !== null || settings.colorMax !== null,
            });
        }
    }

    // --- Color scale selector ---
    const $colorScaleSelect = $container.find(`#color-scale-${id}`);
    $colorScaleSelect.on('change', (e) => {
        const newColorScale = jQuery(e.target).val();
        settings.colorScale = newColorScale;
        _updatePlotElements({ colors: true, colorScale: true });
    });

    // --- Category palette selector ---
    const $categoryPaletteSelect = $container.find(`#category-palette-${id}`);
    $categoryPaletteSelect.on('change', (e) => {
        settings.categoryPalette = jQuery(e.target).val();
        _updatePlotElements({
            colors: true
        });
    });

    // --- Color range inputs and sliders ---
    const $colorMinInput = $container.find(`#color-min-${id}`);
    const $colorMaxInput = $container.find(`#color-max-${id}`);
    const $colorMinSlider = $container.find(`#color-min-slider-${id}`);
    const $colorMaxSlider = $container.find(`#color-max-slider-${id}`);

    // Ensure centeringActive is defined.
    settings.centeringActive = settings.centeringActive || false;

    // Helper to update color range values without affecting slider UI
    function _updateColorRange(min, max, updateSliders = true, triggerPlotUpdate = true) {
        settings.colorMin = min !== '' ? parseFloat(min) : null;
        settings.colorMax = max !== '' ? parseFloat(max) : null;
        $colorMinInput.val(settings.colorMin !== null ? settings.colorMin : '');
        $colorMaxInput.val(settings.colorMax !== null ? settings.colorMax : '');

        if (updateSliders && data && data.color && Array.isArray(data.color)) {
            const validValues = data.color.filter((v) => !isNaN(v));
            const dataMin = Math.min(...validValues);
            const dataMax = Math.max(...validValues);
            $colorMinSlider.val(settings.colorMin !== null ? settings.colorMin : dataMin);
            $colorMaxSlider.val(settings.colorMax !== null ? settings.colorMax : dataMax);
        }

        if (triggerPlotUpdate) {
            _updatePlot(false); // false indicates "visual update only"
        }
    }

    // Update sliders and plot when input values change
    $colorMinInput.on('change', (e) => {
        const minValue = e.target.value !== '' ? parseFloat(e.target.value) : null;
        if (minValue !== null) {
            // Update the slider with the typed value
            $colorMinSlider.val(minValue);
            
            // Manually trigger the slider's input event to use existing handler
            $colorMinSlider.trigger('input');
        } else {
            _updateColorRange(minValue, settings.colorMax, true);
        }
    });

    $colorMaxInput.on('change', (e) => {
        const maxValue = e.target.value !== '' ? parseFloat(e.target.value) : null;
        if (maxValue !== null) {
            // Update the slider with the typed value
            $colorMaxSlider.val(maxValue);
            
            // Manually trigger the slider's input event to use existing handler
            $colorMaxSlider.trigger('input');
        } else {
            _updateColorRange(settings.colorMin, maxValue, true);
        }
    });

    // --- Direct slider update helper ---
    function updateColorRangeDirect(minOrMax, value) {
        if (!plotContainer || !plotContainer.data || !plotContainer.data[0] || !plotContainer.data[0].marker)
            return;
        const update = {};
        update[`marker.c${minOrMax}`] = value;
        Plotly.restyle(plotContainer, update, [0]);
    }

    // --- Hide outliers button ---
    const $hideOutliersButton = $container.find(`#hide-outliers-${id}`);
    $.updateButtonState($hideOutliersButton, settings.hideOutliers);
    
    $hideOutliersButton.on('click', () => {
        settings.hideOutliers = !settings.hideOutliers;
        $.updateButtonState($hideOutliersButton, settings.hideOutliers);
        _updatePlotElements({ filter: true });
    });
    
    // --- Hide NaN button ---
    const $hideNanButton = $container.find(`#hide-nan-${id}`);
    $.updateButtonState($hideNanButton, settings.hideNaN);
    
    $hideNanButton.on('click', () => {
        settings.hideNaN = !settings.hideNaN;
        $.updateButtonState($hideNanButton, settings.hideNaN);
        _updatePlotElements({ filter: true });
    });

    // --- Min slider --- use debounce for smoother performance
    $colorMinSlider.on('input', $.debounce((e) => {
        const minValue = parseFloat(e.target.value);
        $colorMinInput.val(minValue.toFixed(2));
        settings.colorMin = minValue;
        updateColorRangeDirect('min', minValue);
        _updatePlotElements({
            colors: false,
            colorRange: true,
            filter: settings.hideOutliers
        });
    }, 5));

    // --- Max slider --- use debounce for smoother performance
    $colorMaxSlider.on('input', $.debounce((e) => {
        const maxValue = parseFloat(e.target.value);
        $colorMaxInput.val(maxValue.toFixed(2));
        settings.colorMax = maxValue;
        updateColorRangeDirect('max', maxValue);
        _updatePlotElements({
            colors: false,
            colorRange: true,
            filter: settings.hideOutliers
        });
    }, 5));

    // --- Centering and reverse colormap controls ---
    const $centerColormapButton = $container.find(`#center-colormap-${id}`);
    $.updateButtonState($centerColormapButton, settings.centeringActive);
    
    $centerColormapButton.on('click', () => {
        settings.centeringActive = !settings.centeringActive;
        $.updateButtonState($centerColormapButton, settings.centeringActive);
        setupCenteringSliderListeners();
        updateColorSliderUI(controlsContainer, data, settings, id);
        _updatePlot(false);
    });

    const $reverseColormapButton = $container.find(`#reverse-colormap-${id}`);
    $.updateButtonState($reverseColormapButton, settings.colorReversed);
    
    $reverseColormapButton.on('click', () => {
        settings.colorReversed = !settings.colorReversed;
        $.updateButtonState($reverseColormapButton, settings.colorReversed);
        _updatePlotElements({ colorScale: true, colors: true });
    });

    // --- Centering slider listeners and helpers ---
    function setupCenteringSliderListeners() {
        const $csColorMinSlider = $container.find(`#color-min-slider-${id}`);
        const $csColorMaxSlider = $container.find(`#color-max-slider-${id}`);
        
        if (!$csColorMinSlider.length || !$csColorMaxSlider.length) return;
        
        $csColorMinSlider.off('input', centeringMinSliderHandler);
        $csColorMaxSlider.off('input', centeringMaxSliderHandler);
        
        if (settings.centeringActive) {
            $csColorMinSlider.on('input', centeringMinSliderHandler);
            $csColorMaxSlider.on('input', centeringMaxSliderHandler);
        }
    }

    function centeringMinSliderHandler(e) {
        if (!settings.centeringActive) return;
        const minValue = parseFloat(e.target.value);
        const $csColorMaxSlider = $container.find(`#color-max-slider-${id}`);
        const $csColorMaxInput = $container.find(`#color-max-${id}`);
        const $csColorMinInput = $container.find(`#color-min-${id}`);
        const maxValue = -minValue;
        settings.colorMin = minValue;
        settings.colorMax = maxValue;
        $csColorMinInput.val(minValue.toFixed(2));
        $csColorMaxInput.val(maxValue.toFixed(2));
        $csColorMaxSlider.val(maxValue);
        
        if (plotContainer && plotContainer.data && plotContainer.data[0] && plotContainer.data[0].marker) {
            Plotly.restyle(plotContainer, { 'marker.cmin': minValue, 'marker.cmax': maxValue }, [0]);
        }
    }

    function centeringMaxSliderHandler(e) {
        if (!settings.centeringActive) return;
        const maxValue = parseFloat(e.target.value);
        const $csColorMinSlider = $container.find(`#color-min-slider-${id}`);
        const $csColorMinInput = $container.find(`#color-min-${id}`);
        const $csColorMaxInput = $container.find(`#color-max-${id}`);
        const minValue = -maxValue;
        settings.colorMin = minValue;
        settings.colorMax = maxValue;
        $csColorMaxInput.val(maxValue.toFixed(2));
        $csColorMinInput.val(minValue.toFixed(2));
        $csColorMinSlider.val(minValue);
        
        if (plotContainer && plotContainer.data && plotContainer.data[0] && plotContainer.data[0].marker) {
            Plotly.restyle(plotContainer, { 'marker.cmin': minValue, 'marker.cmax': maxValue }, [0]);
        }
    }

    // Initialize centering listeners if needed
    setupCenteringSliderListeners();
}


/**
 * Setup listeners for all axis selector dropdowns (type, key, column)
 * @param {HTMLElement} controlsContainer - Root element containing the axis selectors
 * @param {Object} settings - Axis settings object
 * @param {string} plotType - Either 'cells' or 'genes'
 * @param {Object} data - Data cache for axis values
 * @param {string} id - Unique identifier for the plot
 * @param {Function} loadDataAndCreatePlot - Full plot rebuild
 * @param {Function} onFocusedCellChanged - Callback when cell focus is changed
 * @param {Function} onFocusedGeneChanged - Callback when gene focus is changed
 */
function setupAxisSelectorListeners(
    controlsContainer,
    plotContainer,
    settings,
    plotType,
    data,
    id,
    loadDataAndCreatePlot,
    onFocusedCellChanged,
    onFocusedGeneChanged
) {
  // Add defensive check - container must be defined
  if (!controlsContainer) {
    console.error('setupAxisSelectorListeners: container is undefined');
    return;
  }
  
  // Use jQuery for more efficient selectors and event binding
  const $container = jQuery(controlsContainer);
  
  // Type selectors
  $container.find('.axis-type-select').on('change', async function() {
    const axis = jQuery(this).data('axis');
    const newType = jQuery(this).val();
    const $keySelect = $container.find(`.axis-key-select[data-axis="${axis}"]`);
    const $columnSelect = $container.find(`.axis-column-select[data-axis="${axis}"]`);

    if (!$keySelect.length || !$columnSelect.length) {
      console.error(`Missing axis elements for ${axis}`);
      return;
    }

    if (settings[axis].type === newType) return;
    
    // Store the current values in history before changing them
    const oldType = settings[axis].type;
    const oldKey = settings[axis].key;
    const oldColumn = settings[axis].column;
    
    // Initialize history storage if needed
    if (!settings[axis].history) {
      settings[axis].history = {};
    }
    if (!settings[axis].history[oldType]) {
      settings[axis].history[oldType] = { key: oldKey, columns: {} };
    }
    
    // Store the current column for the current key
    if (oldKey && (oldType === 'obsm' || oldType === 'varm')) {
      if (!settings[axis].history[oldType].columns) {
        settings[axis].history[oldType].columns = {};
      }
      settings[axis].history[oldType].columns[oldKey] = oldColumn;
    }
    
    // Store the current key for the current type
    settings[axis].history[oldType].key = oldKey;
    
    // Now change the type
    settings[axis].type = newType;
    
    // Show loading indicators for key and column selects
    showDropdownLoading($keySelect[0]);
    showDropdownLoading($columnSelect[0]);

    const datasetStructure = await DataManager.getDatasetStructure();
    if (!datasetStructure) {
      console.error('No dataset structure');
      return;
    }
    
    setupAxisSelector(controlsContainer, axis, settings[axis], plotType, datasetStructure);
    
    if (newType === 'none' && axis === 'color') {
      await loadColorDataAndUpdatePlot(
        controlsContainer,
        plotContainer,
        settings,
        data,
        id,
        loadDataAndCreatePlot
      );
      return;
    }

    const cols = $.findAll('option', $columnSelect).map(o => o.value);
    const current = settings[axis].column;
    if (!cols.includes(current)) {
      // Define reasonable defaults based on axis
      const defaultIndex = { x: 0, y: 1, z: 2, color: 3 }[axis];
      
      // Only avoid _index for obs and var types
      let fallback;
      if (newType === 'obs' || newType === 'var') {
        // For obs and var types, strongly avoid _index
        const nonIndexValue = cols.find(c => c !== '_index');
        fallback = nonIndexValue || cols[0] || '';
      } else {
        // For other types, use simple positional mapping
        fallback = cols[defaultIndex] || cols[0] || '';
      }
      
      $.setSelectValue($columnSelect, fallback);
      settings[axis].column = fallback;
    } else {
      $.setSelectValue($columnSelect, current);
    }

    handleAxisUpdate(axis, plotType);
  });

  // Key selectors
  $container.find('.axis-key-select').on('change', async function() {
    const axis = jQuery(this).data('axis');
    const newKey = jQuery(this).val();
    const $columnSelect = $container.find(`.axis-column-select[data-axis="${axis}"]`);

    if (!$columnSelect.length) {
      console.error(`Missing column select for ${axis}`);
      return;
    }

    // Get current values before changing them
    const currentType = settings[axis].type;
    const oldKey = settings[axis].key;
    const oldColumn = settings[axis].column;
    
    // Store the current column for the current key before changing
    if (currentType === 'obsm' || currentType === 'varm') {
      // Initialize history storage if needed
      if (!settings[axis].history) {
        settings[axis].history = {};
      }
      if (!settings[axis].history[currentType]) {
        settings[axis].history[currentType] = { key: oldKey, columns: {} };
      }
      if (!settings[axis].history[currentType].columns) {
        settings[axis].history[currentType].columns = {};
      }
      
      // Store the old column for the old key
      if (oldKey && oldColumn) {
        settings[axis].history[currentType].columns[oldKey] = oldColumn;
      }
    }
    
    // Now change the key and clear the column
    settings[axis].key = newKey;
    settings[axis].column = undefined;
    
    // Show loading indicator for column select
    showDropdownLoading($columnSelect[0]);
    
    const datasetStructure = await DataManager.getDatasetStructure();
    if (!datasetStructure) {
      console.error('No dataset structure');
      return;
    }

    setupAxisSelector(controlsContainer, axis, settings[axis], plotType, datasetStructure);

    const cols = $.findAll('option', $columnSelect).map(o => o.value);
    const current = settings[axis].column;
    if (!cols.includes(current)) {
      // Define reasonable defaults based on axis
      const defaultIndex = { x: 0, y: 1, z: 2, color: 3 }[axis];
      
      // Only avoid _index for obs and var types
      let fallback;
      if (currentType === 'obs' || currentType === 'var') {
        // For obs and var types, strongly avoid _index
        const nonIndexValue = cols.find(c => c !== '_index');
        fallback = nonIndexValue || cols[0] || '';
      } else {
        // For other types, use simple positional mapping  
        fallback = cols[defaultIndex] || cols[0] || '';
      }
      
      $.setSelectValue($columnSelect, fallback);
      settings[axis].column = fallback;
    } else {
      $.setSelectValue($columnSelect, current);
    }

    handleAxisUpdate(axis, plotType);
  });

  // Column selectors
  $container.find('.axis-column-select').on('change', function() {
    const axis = jQuery(this).data('axis');
    settings[axis].column = jQuery(this).val();
    handleAxisUpdate(axis, plotType);
  });
  
  // Set up lock and refocus button handlers using event delegation
  setupSpecialButtonListeners(controlsContainer, settings, plotType, onFocusedCellChanged, onFocusedGeneChanged);

  /**
   * 
   * @param {*} axis 
   * @param {*} plotType 
   */
  function handleAxisUpdate(axis, plotType) {
    if (axis === 'color') {
        loadColorDataAndUpdatePlot(
            controlsContainer,
            plotContainer,
            settings,
            data,
            id,
            loadDataAndCreatePlot
          )
    } else if (['x', 'y', 'z'].includes(axis)) {
      loadAxisData(settings[axis], plotType, plotContainer).then(axisData => {
        if (axisData?.values) {
          data[axis] = axisData;
          updatePlotElements(
            plotContainer,
            data, 
            settings, 
            loadDataAndCreatePlot, 
            { 
              [`${axis}Axis`]: true, 
              layout: true 
            }
          ).catch(error => {
            console.error(`Error updating ${axis} axis:`, error);
            loadDataAndCreatePlot();
          });
        } else {
          loadDataAndCreatePlot();
        }
      }).catch(() => loadDataAndCreatePlot());
    } else {
      loadDataAndCreatePlot();
    }
  }
}

/**
 * Sets up event listeners for the special buttons (lock and refocus)
 * @param {HTMLElement} controlsContainer - The container element
 * @param {Object} settings - The settings object for the plot
 * @param {string} plotType - The plot type ('cells' or 'genes')
 * @param {Function} onFocusedCellChanged - Callback when focused cell changes
 * @param {Function} onFocusedGeneChanged - Callback when focused gene changes
 */
function setupSpecialButtonListeners(controlsContainer, settings, plotType, onFocusedCellChanged, onFocusedGeneChanged) {
  // Use jQuery for more efficient event delegation
  const $container = jQuery(controlsContainer);
  
  // Event delegation for button clicks
  $container.on('click', 'button[id^="lock-"], button[id^="refocus-"]', function(e) {
    e.preventDefault();
    e.stopPropagation();
    
    // Extract axis and button type
    const buttonId = jQuery(this).attr('id');
    const [buttonType, axis] = buttonId.split('-');
    const dataType = jQuery(this).data('type');

    let currentFocus;
    let executeFocusChange;
    let setFocus;

    if ((dataType === 'layer' && plotType === 'cells') || dataType === 'varp') {
      currentFocus = DataManager.getFocusedGene();
      executeFocusChange = onFocusedGeneChanged;
      setFocus = DataManager.setFocusedGene;
    } else if ((dataType === 'layer' && plotType === 'genes') || dataType === 'obsp') {
      currentFocus = DataManager.getFocusedCell();
      executeFocusChange = onFocusedCellChanged;
      setFocus = DataManager.setFocusedCell;
    }
    
    console.log(`Button ${buttonType} clicked for axis ${axis}, type: ${dataType}`);
    
    if (buttonType === 'lock' && settings[axis]) {
      // Handle lock button click
      settings[axis].locked = !settings[axis].locked;
      
      if (settings[axis].locked) {
        // Locking - update button style to locked state
        jQuery(this).html('<i class="fas fa-lock"></i>');
        $.updateButtonState(this, true);
        jQuery(this).attr('title', 'Unlock (follow focused element)');
        
        // Check if refocus button should be visible
        const $refocusButton = $container.find(`#refocus-${axis}`);
        const shouldShow = currentFocus && currentFocus !== settings[axis].column;
        $refocusButton.toggle(shouldShow);
      } else {
        // Unlocking - update button style to unlocked state
        jQuery(this).html('<i class="fas fa-lock-open"></i>');
        $.updateButtonState(this, false);
        jQuery(this).attr('title', 'Lock (keep current selection)');
        
        // Hide refocus button
        $container.find(`#refocus-${axis}`).hide();
        
        executeFocusChange(currentFocus);
      }
    } else if (buttonType === 'refocus') {
      const columnValue = settings[axis].column;
      setFocus(columnValue);

      // Hide the refocus button after clicking
      jQuery(this).hide();
    }
  });
}
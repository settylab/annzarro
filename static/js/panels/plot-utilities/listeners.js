import { updateColorSliderUI, setupAxisSelector, showDropdownLoading, defaultAxisType, focusedOptionLabel,
    colorSliderValue, showColorBound, showPointStyle, showScalePreview, colorBoundText } from './panel-ui-update.js';
import { applyAutoPointStyle } from '../../utils/point-style.js';
import { autoPointCount } from '../../utils/view-point-style.js';
import { loadAxisData, updateTableEntities, applyLogColor, loadHoverColumns, applyHoverInfo, pointStyleBase, loadingIndicator, hoverPickFits, showHoverChoice } from './plot-make.js';
import { hoverInfoFromSelection, hoverOffFromSelection, NO_HOVER } from './hover-columns.js';
import { updatePlotElements, loadColorDataAndUpdatePlot, highlightFocusedEntity, removeHighlight, restyleMarkers } from './plot-update.js';
import { DataManager } from '../../data-manager.js';
import { 
  setupAestheticsMenuListeners, 
  createAestheticsMenu,
  applyAllAestheticSettings,
  initializeAestheticsSettings,
  createPopoverContent
} from './plot-aesthetics-menu.js';
import * as $ from '../../utils/jquery-helpers.js';
import { aspectUpdate, keepsOwnMarker } from './plot-make-helper.js';
import { colorBoundFromData, colorBoundToData } from '../../utils/array-stats.js';
import { notify } from '../../utils/notify.js';
import { SLIDER_STEPS, pointSizeScale, opacityScale, valueAt, roundSig, snapPointSize } from '../../utils/slider-scales.js';
import { coalesce } from '../../utils/render-queue.js';

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
 * Whether the container's size differs from the size the plot was last drawn
 * at (Plotly's autosize reads the same computed width and height).
 *
 * The observer fires once as soon as it observes, and again whenever the
 * container's layout is touched, also when nothing moved. Each call was a
 * full relayout: right after the first render of 95.6M points that redrew
 * everything again, a 3.1 s freeze for a size that had not changed.
 * @param {HTMLElement} gd - The Plotly graph div.
 * @returns {boolean}
 */
export function sizeChanged(gd) {
    const full = gd && gd._fullLayout;
    if (!full || !full.width || !full.height) return true;
    const style = window.getComputedStyle ? window.getComputedStyle(gd) : null;
    const width = Math.round((style && parseFloat(style.width)) || gd.clientWidth || 0);
    const height = Math.round((style && parseFloat(style.height)) || gd.clientHeight || 0);
    if (!width || !height) return false;          // hidden or collapsed: nothing to fit
    return Math.abs(width - Math.round(full.width)) > 1 || Math.abs(height - Math.round(full.height)) > 1;
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
              if (plotContainer.data && plotContainer.data.length > 0
                  && sizeChanged(plotContainer)) {
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
          const zType = defaultAxisType(plotType, datasetStructure);
          settings.z = (zType === 'varm' || zType === 'obsm')
            ? { type: zType, key: yKey, column: zColumn }
            // No matrix source: let the selector pick an annotation column.
            : { type: zType, key: '', column: '' };
          // Call the axis selector setup helper from the controls object.
          setupAxisSelector(controlsContainer, 'z', settings.z, plotType, datasetStructure);
        }
        loadDataAndCreatePlot();
      }
    });
  
    // --- Point Size / Opacity Sliders ---
    // The sliders write settings on every input event; the restyle that shows
    // it is coalesced (utils/render-queue.js): at most one runs at a time and
    // the next starts only after it is painted, with the newest values.
    const redrawStyling = coalesce(
      () => restyleMarkers(plotContainer, settings),
      {
        onError: (error) => {
          console.error("Error updating point size/opacity:", error);
          loadDataAndCreatePlot();
        }
      }
    );
    // The tracks are log scales (utils/slider-scales.js); a value read off
    // one is rounded to two significant digits. The number box beside each
    // takes any value as typed (in px / alpha), also off the track's range.
    // Setting either one ends its automatic value (utils/point-style.js);
    // its auto button brings it back.
    // Sizes snap to the steps scattergl draws (2D); 3D markers take any size.
    const sizeSnap = (v, other) => (settings.z ? other(v) : snapPointSize(v));
    const pointStyle = (name, key, autoKey, scale, valid, snap) => {
      const $slider = $controlsContainer.find(`#${name}-${id}`);
      const $input = $controlsContainer.find(`#${name}-input-${id}`);
      $slider.on('input', (e) => {
        settings[key] = snap(valueAt(scale, e.target.value), roundSig);
        settings[autoKey] = false;
        showPointStyle(id, settings);
        redrawStyling();
      });
      $input.on('change', (e) => {
        const v = parseFloat(e.target.value);
        if (!valid(v)) { $input.val(settings[key]); return; }
        settings[key] = snap(v, (x) => x);
        settings[autoKey] = false;
        showPointStyle(id, settings);
        redrawStyling();
      });
      $controlsContainer.find(`#${name}-auto-${id}`).on('click', () => {
        settings[autoKey] = true;
        applyAutoPointStyle(settings, autoPointCount(plotContainer, settings, keepsOwnMarker), pointStyleBase());
        showPointStyle(id, settings);
        redrawStyling();
      });
    };
    pointStyle('point-size', 'pointSize', 'autoPointSize', pointSizeScale, (v) => v > 0, sizeSnap);
    pointStyle('point-opacity', 'pointOpacity', 'autoPointOpacity', opacityScale, (v) => v > 0 && v <= 1,
      (v, other) => other(v));
    
    // --- Hover columns: reload only those columns and relabel the traces ---
    const $hoverSelect = $controlsContainer.find(`#hover-columns-${id}`);
    let hoverGeneration = 0;
    $hoverSelect.on('change', async (e) => {
      const selected = Array.from(e.target.selectedOptions, o => o.value);
      const before = { hoverOff: settings.hoverOff, hoverInfo: settings.hoverInfo };
      const off = hoverOffFromSelection(selected, settings.hoverOff);
      settings.hoverOff = off;
      settings.hoverInfo = hoverInfoFromSelection(plotType, off ? [] : selected, settings.hoverInfo);
      for (const o of e.target.options) o.selected = off ? o.value === NO_HOVER : o.value !== NO_HOVER && selected.includes(o.value);
      // labels that do not fit the browser are not read: the pick is undone
      // and the status line gives the memory guard's numbers
      if (!off && !(await hoverPickFits(settings, plotType, plotContainer, !!data.colorRanked))) {
        Object.assign(settings, before);
        if (before.hoverOff === undefined) delete settings.hoverOff;
        const prior = new Set((before.hoverInfo || []).map(h => h && h.key));
        for (const o of e.target.options) o.selected = o.value !== NO_HOVER && prior.has(o.value);
        showHoverChoice(plotContainer, settings);
        return;
      }
      // a colour of many categories drawn without labels reads them now
      if (!off && data.colorRanked) {
        loadDataAndCreatePlot();
        return;
      }
      const mine = ++hoverGeneration;
      const extra = await loadHoverColumns(settings, plotType, plotContainer);
      if (mine !== hoverGeneration) return;   // a newer selection is loading
      data.hoverExtra = extra;
      await applyHoverInfo(plotContainer, data, settings);
    });

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
    // reloads the panel's data: re-checked on the server, past this browser's copies
    // (the server may wait for its next walk of the dataset, up to
    // server.refresh_min_interval_s: the panel shows it is busy meanwhile)
    $refreshPlotButton.on('click', async () => {
      loadingIndicator.show(plotContainer, 'refresh');
      try {
        await DataManager.reloadDatasetData();
      } finally {
        loadingIndicator.hide(plotContainer, 'refresh');
      }
      loadDataAndCreatePlot();
    });
    
    // --- Table Filter Controls ---
    // Add event listeners for table filter dropdown
    // Try different selector strategies to find the table filter dropdown
    let $tableFilterSelect = $controlsContainer.find(`#table-filter-${id}`);
    
    // If not found with the exact ID, try class selector
    if (!$tableFilterSelect.length) {
      $tableFilterSelect = $controlsContainer.find('.table-filter-select');
    }
    
    // If still not found, try partial ID match
    if (!$tableFilterSelect.length) {
      $tableFilterSelect = $controlsContainer.find('select[id*="table-filter"]');
    }
    
    if ($tableFilterSelect.length) {
      $tableFilterSelect.on('change', async () => {
        const selectedTableId = $tableFilterSelect.val();
        settings.tableFilter = selectedTableId;
        
        // First update the table entities asynchronously
        try {
          // Import updateTableEntities dynamically to avoid circular dependencies
          const entitiesChanged = await updateTableEntities(data, settings, plotContainer);
          
          // Then update the plot elements - only if table entities changed or filter was cleared
          if (entitiesChanged || !selectedTableId || selectedTableId === 'none') {
            updatePlotElements(plotContainer, data, settings, loadDataAndCreatePlot, { 
              filter: true, 
              colors: true 
            }).catch(error => {
              console.error("Error updating plot with table filter:", error);
              loadDataAndCreatePlot();
            });
          }
        } catch (error) {
          console.error("Error updating table entities:", error);
          loadDataAndCreatePlot();
        }
      });
    }
    
    // Add event listener for the remove non-table entries toggle button
    // Try different selector strategies to find the toggle button
    let $removeNonTableEntriesBtn = $controlsContainer.find(`#remove-non-table-entries-${id}`);
    
    // If not found with exact ID, try using title attribute
    if (!$removeNonTableEntriesBtn.length) {
      $removeNonTableEntriesBtn = $controlsContainer.find('button[title*="non-table entries"]');
    }
    
    // If still not found, try partial ID match
    if (!$removeNonTableEntriesBtn.length) {
      $removeNonTableEntriesBtn = $controlsContainer.find('button[id*="remove-non-table-entries"]');
    }
    
    if ($removeNonTableEntriesBtn.length) {
      $removeNonTableEntriesBtn.on('click', () => {
        settings.removeNonTableEntries = !settings.removeNonTableEntries;
        
        // Update button styling based on state
        $.updateButtonState($removeNonTableEntriesBtn, settings.removeNonTableEntries, 'btn-primary');
        $removeNonTableEntriesBtn.attr('title',
          `Remove non-table entries (${settings.removeNonTableEntries ? 'active' : 'inactive'})`);
        
        // We don't need to rebuild the tableEntities set, just apply the new filter setting
        // Now all filtering is separated - just update filter and colors
        updatePlotElements(plotContainer, data, settings, loadDataAndCreatePlot, { 
          filter: true, 
          colors: true 
        }).catch(error => {
          console.error("Error updating plot with table filter mode:", error);
          loadDataAndCreatePlot();
        });
      });
    }
  
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
        showScalePreview($container, id, settings);
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
        settings.colorMin = min !== '' && min !== null ? parseFloat(min) : null;
        settings.colorMax = max !== '' && max !== null ? parseFloat(max) : null;
        $colorMinInput.val(settings.colorMin !== null ? colorBoundText(settings, settings.colorMin) : '');
        $colorMaxInput.val(settings.colorMax !== null ? colorBoundText(settings, settings.colorMax) : '');

        if (updateSliders) {
            // an empty bound shows the data's end of the track
            if (settings.colorMin !== null) showColorBound($colorMinSlider, settings.colorMin, 'low');
            else $colorMinSlider.val(0);
            if (settings.colorMax !== null) showColorBound($colorMaxSlider, settings.colorMax, 'high');
            else $colorMaxSlider.val(SLIDER_STEPS);
        }

        if (triggerPlotUpdate) {
            _updatePlot(false); // false indicates "visual update only"
        }
    }

    // A typed bound is used as typed. It used to be passed through the
    // slider, whose step (range/500) and min/max snapped and clamped it, so
    // typing 0.0126 into Max on a 0..0.012 range did nothing.
    function _applyTypedBound(which, value) {
        const other = which === 'min' ? 'max' : 'min';
        settings[which === 'min' ? 'colorMin' : 'colorMax'] = value;
        const $slider = which === 'min' ? $colorMinSlider : $colorMaxSlider;
        // display only; the thumb may pin to an end, the setting does not
        showColorBound($slider, value, which === 'min' ? 'low' : 'high');
        updateColorRangeDirect(which, value);
        if (settings.centeringActive) {
            // centred scale: the other bound mirrors the typed one
            const mirrored = -value;
            settings[other === 'min' ? 'colorMin' : 'colorMax'] = mirrored;
            (other === 'min' ? $colorMinInput : $colorMaxInput).val(colorBoundText(settings, mirrored));
            showColorBound(other === 'min' ? $colorMinSlider : $colorMaxSlider, mirrored, other === 'min' ? 'low' : 'high');
            updateColorRangeDirect(other, mirrored);
        }
        _updatePlotElements({
            colors: false,
            colorRange: true,
            filter: settings.hideOutliers
        });
    }

    // The boxes take data values, also under Log (settings then hold log10):
    // typing 82 means 82, not 10^82. A value with no log10 is explained.
    function _typedBound(which, text) {
        const typed = text !== '' ? parseFloat(text) : null;
        if (typed === null || !Number.isFinite(typed)) return typed;
        const log = !!(settings.color && settings.color.log);
        const { value, note, refused } = colorBoundFromData(typed, log, which, data.colorLog ? data.colorLog.floor : null);
        if (refused || note) notify('Log colour scale', refused || note, 'warning');
        if (refused) return undefined;
        return value;
    }

    $colorMinInput.on('change', (e) => {
        const minValue = _typedBound('min', e.target.value);
        if (minValue === undefined) {
            $colorMinInput.val(colorBoundText(settings, settings.colorMin));
        } else if (minValue !== null && Number.isFinite(minValue)) {
            _applyTypedBound('min', minValue);
            $colorMinInput.val(colorBoundText(settings, minValue));
        } else {
            _updateColorRange(minValue, settings.colorMax, true);
        }
    });

    $colorMaxInput.on('change', (e) => {
        const maxValue = _typedBound('max', e.target.value);
        if (maxValue === undefined) {
            $colorMaxInput.val(colorBoundText(settings, settings.colorMax));
        } else if (maxValue !== null && Number.isFinite(maxValue)) {
            _applyTypedBound('max', maxValue);
        } else {
            _updateColorRange(settings.colorMin, maxValue, true);
        }
    });

    // --- Direct slider update helper ---
    function updateColorRangeDirect(minOrMax, value) {
        if (!plotContainer || !plotContainer.data || plotContainer.data.length === 0)
            return;
        
        const update = {};
        update[`marker.c${minOrMax}`] = value;
        
        // Check if we have table filtering (multiple traces) with numerical color
        const hasTableFilter = settings.tableFilter && settings.tableFilter !== 'none';
        const isNumericalColor = data.colorType === 'numerical';
        
        if (hasTableFilter && isNumericalColor && plotContainer.data.length > 1) {
            // In table filter mode, find the colored trace by matching a specific trace name
            // or by checking if it has a colorbar and numerical color values
            let coloredTraceIndex = -1;
            
            // First try to find a trace that matches the color key name (most reliable)
            for (let i = 0; i < plotContainer.data.length; i++) {
                const trace = plotContainer.data[i];
                
                // Skip traces that are named 'Not in table' which is used for gray points
                if (trace.name === 'Not in table') continue;
                
                // Check if this trace has a name matching the color key or if it has a colorbar
                const hasMatchingName = trace.name === settings.color.key; 
                const hasColorbar = trace.marker && trace.marker.colorbar;
                
                // Check if the trace has numerical coloring (not a constant color string)
                const hasNumericalColoring = trace.marker && 
                                           Array.isArray(trace.marker.color) && 
                                           trace.marker.color.length > 0;
                
                // If this trace matches our criteria, it's the one we want to update
                if (hasNumericalColoring && (hasMatchingName || hasColorbar)) {
                    coloredTraceIndex = i;
                    break;
                }
            }
            
            // If we found the colored trace, update it
            if (coloredTraceIndex !== -1 && plotContainer.data[coloredTraceIndex]?.marker) {
                Plotly.restyle(plotContainer, update, [coloredTraceIndex]);
                return;
            }
        }
        
        // If no specific trace found or no table filtering, try to find any trace with a colorbar
        for (let i = 0; i < plotContainer.data.length; i++) {
            const trace = plotContainer.data[i];
            if (trace.marker && trace.marker.colorbar && Array.isArray(trace.marker.color)) {
                Plotly.restyle(plotContainer, update, [i]);
                return;
            }
        }
        
        // Fallback: update the first trace if it has a marker
        if (plotContainer.data[0]?.marker) {
            Plotly.restyle(plotContainer, update, [0]);
        }
    }

    // --- Hide outliers button ---
    const $hideOutliersButton = $container.find(`#hide-outliers-${id}`);
    $.updateButtonState($hideOutliersButton, settings.hideOutliers);
    
    $hideOutliersButton.on('click', () => {
        settings.hideOutliers = !settings.hideOutliers;
        $.updateButtonState($hideOutliersButton, settings.hideOutliers);
        _updatePlotElements({ filter: true, colors: true });
    });
    
    // --- Strong-on-top button: draw the largest |colour| last (default on) ---
    const $sortByColorButton = $container.find(`#sort-by-color-${id}`);
    $.updateButtonState($sortByColorButton, settings.sortByColor !== false);
    $sortByColorButton.on('click', () => {
        settings.sortByColor = settings.sortByColor === false;
        $.updateButtonState($sortByColorButton, settings.sortByColor);
        _updatePlotElements({ colors: true });
    });

    // --- Log colour scale with a floor (settings.color.log / logFloor) ---
    const $logColorButton = $container.find(`#log-color-${id}`);
    const $logFloorInput = $container.find(`#log-floor-${id}`);
    $.updateButtonState($logColorButton, !!(settings.color && settings.color.log));
    if (settings.color && settings.color.logFloor != null) $logFloorInput.val(settings.color.logFloor);
    const _reapplyLog = () => {
        if (data.colorRaw && data.colorLog) data.color = data.colorRaw;   // back to linear values
        applyLogColor(data, settings);
        if (!settings.lockColorRange) { settings.colorMin = null; settings.colorMax = null; }
        // The range, the Min/Max boxes and the slider scales in the new units
        // now, as a Refresh would set them: the incremental restyle below
        // writes cmin/cmax only when they are set, so the trace kept the old
        // units' range (103..9950 against log10 colours) until a Refresh.
        updateColorSliderUI(controlsContainer, data, settings, id);
        _updatePlotElements({ colors: true, colorRange: true });
    };
    $logColorButton.on('click', () => {
        if (!settings.color) return;
        if (settings.lockColorRange) {
            // a locked range stays the same data values in the new units
            const was = !!settings.color.log;
            const floor = was ? (data.colorLog ? data.colorLog.floor : null) : null;
            const min = colorBoundToData(settings.colorMin, was), max = colorBoundToData(settings.colorMax, was);
            const lo = colorBoundFromData(min, !was, 'min', floor ?? settings.color.logFloor ?? null);
            const hi = colorBoundFromData(max, !was, 'max');
            if (lo.note || hi.refused) notify('Log colour scale', hi.refused || lo.note, 'warning');
            settings.colorMin = lo.value;
            settings.colorMax = hi.value;
        }
        settings.color.log = !settings.color.log;
        $.updateButtonState($logColorButton, settings.color.log);
        _reapplyLog();
    });
    $logFloorInput.on('change', (e) => {
        if (!settings.color) return;
        const v = parseFloat(e.target.value);
        settings.color.logFloor = Number.isFinite(v) && v > 0 ? v : null;
        if (settings.color.log) _reapplyLog();
    });

    // --- Equal aspect (settings.equalAspect) ---
    const $equalAspectButton = $container.find(`#equal-aspect-${id}`);
    $.updateButtonState($equalAspectButton, !!settings.equalAspect);
    $equalAspectButton.on('click', () => {
        settings.equalAspect = !settings.equalAspect;
        $.updateButtonState($equalAspectButton, settings.equalAspect);
        // refit both axes for the new constraint (unless hiding pins them)
        const refit = (settings.hideNaN || settings.hideOutliers) ? {} : { 'xaxis.autorange': true, 'yaxis.autorange': true };
        Promise.resolve().then(() => Plotly.relayout(plotContainer, { ...aspectUpdate(settings), ...refit }))
            .catch(err => console.warn('Aspect not changed:', err && err.message));
    });

    // --- Hide NaN button ---
    const $hideNanButton = $container.find(`#hide-nan-${id}`);
    $.updateButtonState($hideNanButton, settings.hideNaN);
    
    $hideNanButton.on('click', () => {
        settings.hideNaN = !settings.hideNaN;
        $.updateButtonState($hideNanButton, settings.hideNaN);
        _updatePlotElements({ filter: true, colors: true });
    });

    // --- Min slider --- use debounce for smoother performance
    $colorMinSlider.on('input', $.debounce((e) => {
        const minValue = colorSliderValue(e.target);
        $colorMinInput.val(colorBoundText(settings, minValue));
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
        const maxValue = colorSliderValue(e.target);
        $colorMaxInput.val(colorBoundText(settings, maxValue));
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
        _updatePlotElements({ colors: true, colorScale: true });
    });

    const $reverseColormapButton = $container.find(`#reverse-colormap-${id}`);
    $.updateButtonState($reverseColormapButton, settings.colorReversed);
    
    $reverseColormapButton.on('click', () => {
        settings.colorReversed = !settings.colorReversed;
        $.updateButtonState($reverseColormapButton, settings.colorReversed);
        showScalePreview($container, id, settings);
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
        const minValue = colorSliderValue(e.target);
        const $csColorMaxSlider = $container.find(`#color-max-slider-${id}`);
        const $csColorMaxInput = $container.find(`#color-max-${id}`);
        const $csColorMinInput = $container.find(`#color-min-${id}`);
        const maxValue = -minValue;
        settings.colorMin = minValue;
        settings.colorMax = maxValue;
        $csColorMinInput.val(colorBoundText(settings, minValue));
        $csColorMaxInput.val(colorBoundText(settings, maxValue));
        showColorBound($csColorMaxSlider, maxValue, 'high');
        
        // Update the plot with the new range values
        // Check if we have table filtering with numerical coloring
        const hasTableFilter = settings.tableFilter && settings.tableFilter !== 'none';
        const isNumericalColor = data.colorType === 'numerical';
        
        if (hasTableFilter && isNumericalColor && plotContainer.data.length > 1) {
            // In table filter mode, find the colored trace by matching criteria
            let coloredTraceIndex = -1;
            
            // First try to find a trace that matches the color key name or has a colorbar
            for (let i = 0; i < plotContainer.data.length; i++) {
                const trace = plotContainer.data[i];
                
                // Skip traces that are named 'Not in table' which is used for gray points
                if (trace.name === 'Not in table') continue;
                
                // Check if this trace has a name matching the color key or if it has a colorbar
                const hasMatchingName = trace.name === settings.color.key;
                const hasColorbar = trace.marker && trace.marker.colorbar;
                
                // Check if the trace has numerical coloring
                const hasNumericalColoring = trace.marker && 
                                            Array.isArray(trace.marker.color) && 
                                            trace.marker.color.length > 0;
                
                if (hasNumericalColoring && (hasMatchingName || hasColorbar)) {
                    coloredTraceIndex = i;
                    break;
                }
            }
            
            // If we found the colored trace, update it
            if (coloredTraceIndex !== -1 && plotContainer.data[coloredTraceIndex]?.marker) {
                Plotly.restyle(plotContainer, { 
                    'marker.cmin': minValue, 
                    'marker.cmax': maxValue 
                }, [coloredTraceIndex]);
                return;
            }
        }
        
        // If no specific trace found or no table filtering, find any trace with a colorbar
        for (let i = 0; i < plotContainer.data.length; i++) {
            const trace = plotContainer.data[i];
            if (trace.marker && trace.marker.colorbar && Array.isArray(trace.marker.color)) {
                Plotly.restyle(plotContainer, { 
                    'marker.cmin': minValue, 
                    'marker.cmax': maxValue 
                }, [i]);
                return;
            }
        }
        
        // Fallback: update the first trace if it exists
        if (plotContainer && plotContainer.data && plotContainer.data[0] && plotContainer.data[0].marker) {
            Plotly.restyle(plotContainer, { 
                'marker.cmin': minValue, 
                'marker.cmax': maxValue 
            }, [0]);
        }
    }

    function centeringMaxSliderHandler(e) {
        if (!settings.centeringActive) return;
        const maxValue = colorSliderValue(e.target);
        const $csColorMinSlider = $container.find(`#color-min-slider-${id}`);
        const $csColorMinInput = $container.find(`#color-min-${id}`);
        const $csColorMaxInput = $container.find(`#color-max-${id}`);
        const minValue = -maxValue;
        settings.colorMin = minValue;
        settings.colorMax = maxValue;
        $csColorMaxInput.val(colorBoundText(settings, maxValue));
        $csColorMinInput.val(colorBoundText(settings, minValue));
        showColorBound($csColorMinSlider, minValue, 'low');
        
        // Update the plot with the new range values
        // Check if we have table filtering with numerical coloring
        const hasTableFilter = settings.tableFilter && settings.tableFilter !== 'none';
        const isNumericalColor = data.colorType === 'numerical';
        
        if (hasTableFilter && isNumericalColor && plotContainer.data.length > 1) {
            // In table filter mode, find the colored trace by matching criteria
            let coloredTraceIndex = -1;
            
            // First try to find a trace that matches the color key name or has a colorbar
            for (let i = 0; i < plotContainer.data.length; i++) {
                const trace = plotContainer.data[i];
                
                // Skip traces that are named 'Not in table' which is used for gray points
                if (trace.name === 'Not in table') continue;
                
                // Check if this trace has a name matching the color key or if it has a colorbar
                const hasMatchingName = trace.name === settings.color.key;
                const hasColorbar = trace.marker && trace.marker.colorbar;
                
                // Check if the trace has numerical coloring
                const hasNumericalColoring = trace.marker && 
                                            Array.isArray(trace.marker.color) && 
                                            trace.marker.color.length > 0;
                
                if (hasNumericalColoring && (hasMatchingName || hasColorbar)) {
                    coloredTraceIndex = i;
                    break;
                }
            }
            
            // If we found the colored trace, update it
            if (coloredTraceIndex !== -1 && plotContainer.data[coloredTraceIndex]?.marker) {
                Plotly.restyle(plotContainer, { 
                    'marker.cmin': minValue, 
                    'marker.cmax': maxValue 
                }, [coloredTraceIndex]);
                return;
            }
        }
        
        // If no specific trace found or no table filtering, find any trace with a colorbar
        for (let i = 0; i < plotContainer.data.length; i++) {
            const trace = plotContainer.data[i];
            if (trace.marker && trace.marker.colorbar && Array.isArray(trace.marker.color)) {
                Plotly.restyle(plotContainer, { 
                    'marker.cmin': minValue, 
                    'marker.cmax': maxValue 
                }, [i]);
                return;
            }
        }
        
        // Fallback: update the first trace if it exists
        if (plotContainer && plotContainer.data && plotContainer.data[0] && plotContainer.data[0].marker) {
            Plotly.restyle(plotContainer, { 
                'marker.cmin': minValue, 
                'marker.cmax': maxValue 
            }, [0]);
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

    // Initialize history storage if needed
    if (!settings[axis].history) {
      settings[axis].history = {};
    }
    if (!settings[axis].history[oldType]) {
      settings[axis].history[oldType] = { key: oldKey, columns: {} };
    }
    
    // Store the current column for the current key
    if (!settings[axis].history[oldType].columns) {
      settings[axis].history[oldType].columns = {};
    }
    settings[axis].history[oldType].columns[oldKey] = oldColumn;
    
    // Store the current key for the current type
    settings[axis].history[oldType].key = oldKey;
    
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
    
    // Now change the key and clear the column
    settings[axis].key = newKey;
    
    // Show loading indicator for column select
    showDropdownLoading($columnSelect[0]);
    
    const datasetStructure = await DataManager.getDatasetStructure();
    if (!datasetStructure) {
      console.error('No dataset structure');
      return;
    }

    setupAxisSelector(controlsContainer, axis, settings[axis], plotType, datasetStructure);

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
    if (oldKey) {
      settings[axis].history[currentType].columns[oldKey] = oldColumn;
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
 * The column-menu label right after the padlock is clicked: 'Locked cell X'
 * for the cell the axis is now locked to, 'Focused cell Y' for the current
 * focus once unlocked. It used to keep the old wording until the panel was
 * rebuilt from a link.
 * @param {string} dataType - 'obsp' | 'varp' | 'layer'
 * @param {string} plotType - 'cells' | 'genes'
 * @param {Object} axisSettings - {column, locked}
 * @param {string|null} currentFocus
 * @returns {string|null}
 */
export function lockOptionLabel(dataType, plotType, axisSettings, currentFocus) {
  const entity = ((dataType === 'layer' && plotType === 'cells') || dataType === 'varp') ? 'genes' : 'cells';
  const shown = axisSettings.locked ? axisSettings.column : currentFocus;
  return shown ? focusedOptionLabel(entity, shown, !!axisSettings.locked) : null;
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
  $container.on('click', 'button.axis-lock-btn, button.axis-refocus-btn', function(e) {
    e.preventDefault();
    e.stopPropagation();
    
    // Extract axis and button type
    const buttonType = jQuery(this).hasClass('axis-lock-btn') ? 'lock' : 'refocus';
    const axis = jQuery(this).attr('data-axis');
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
      // Relabel the column menu now: it kept saying 'Focused cell ...' after
      // the padlock was clicked until the panel was rebuilt from a link
      const columnSelect = controlsContainer.querySelector(`.axis-column-select[data-axis="${axis}"]`);
      const label = lockOptionLabel(dataType, plotType, settings[axis], currentFocus);
      if (columnSelect && columnSelect.options[0] && label) columnSelect.options[0].text = label;
      // Tables offer every locked cell and gene as a column (panel-tracker.js)
      document.dispatchEvent(new CustomEvent('fixedEntitiesChanged', {
        detail: { axis, locked: settings[axis].locked, entity: settings[axis].column }
      }));
      
      if (settings[axis].locked) {
        // Locking - update button style to locked state
        jQuery(this).html('<i class="fas fa-lock"></i>');
        $.updateButtonState(this, true);
        jQuery(this).attr('title', 'Unlock (follow focused element)');
        
        // Check if refocus button should be visible
        const $refocusButton = $container.find(`.axis-refocus-btn[data-axis="${axis}"]`);
        const shouldShow = currentFocus && currentFocus !== settings[axis].column;
        $refocusButton.toggle(shouldShow);
      } else {
        // Unlocking - update button style to unlocked state
        jQuery(this).html('<i class="fas fa-lock-open"></i>');
        $.updateButtonState(this, false);
        jQuery(this).attr('title', 'Lock (keep current selection)');
        
        // Hide refocus button
        $container.find(`.axis-refocus-btn[data-axis="${axis}"]`).hide();
        
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
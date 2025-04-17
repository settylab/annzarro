import { DataManager } from '../../data-manager.js';
import { generateDiscreteColors } from './colors.js';

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
    // For 2D plots, xaxis and yaxis are defined.
    xaxis: {
      ...baseAxis,
      title: `${settings.x.type}.${settings.x.key}` + (settings.x.column ? `.${settings.x.column}` : '')
    },
    yaxis: {
      ...baseAxis,
      title: `${settings.y.type}.${settings.y.key}` + (settings.y.column ? `.${settings.y.column}` : '')
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
        title: `${settings.z.type}.${settings.z.key}` + (settings.z.column ? `.${settings.z.column}` : '')
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
export function attachClickHandler(plotContainer, traces, data, settings) {
    plotContainer.on('plotly_click', (e) => {
      if (!e || !e.points || e.points.length === 0) return;
  
      const point = e.points[0];
      const pointIndex = point.pointIndex;
      const traceIndex = point.curveNumber;
      
      // Determine if this is a gene plot or cell plot
      const isGenePlot = data.genes !== undefined;
      const entityKey = isGenePlot ? 'genes' : 'cells';
      let entityName;
  
      if (traces[traceIndex] && traces[traceIndex].text && pointIndex < traces[traceIndex].text.length) {
        entityName = traces[traceIndex].text[pointIndex];
      } else if (point.customdata !== undefined) {
        const entityIndex = point.customdata;
        if (data[entityKey] && entityIndex < data[entityKey].length) {
          entityName = data[entityKey][entityIndex];
        }
      }
      
      if (!entityName) {
        console.warn(`No ${isGenePlot ? 'genes' : 'cells'} name found for clicked point`);
        return;
      }
      
      if (isGenePlot) {
        DataManager.setFocusedGene(entityName, false);
      } else {
        DataManager.setFocusedCell(entityName, false);
      }
    });
    
    // Set up viewport state tracking
    attachViewportTracking(plotContainer, settings);
}

/**
 * Attaches event listeners to track the current viewport state on user interaction
 * and save it to the plot settings.
 * 
 * @param {HTMLElement} plotContainer - The container for the plot.
 * @param {Object} settings - The settings object for the plot.
 */
export function attachViewportTracking(plotContainer, settings) {
  // For 3D plots, track camera position
  if (settings.z) {
    plotContainer.on('plotly_relayout', function(eventData) {
      // Check if the event data includes 3D camera information
      if (eventData['scene.camera']) {
        // Initialize viewport3D if it doesn't exist
        if (!settings.viewport3D) {
          settings.viewport3D = {};
        }
        
        const camera = eventData['scene.camera'];
        settings.viewport3D = {
          eye: camera.eye,
          up: camera.up,
          center: camera.center
        };
      } else {
        // Reset the viewport3D to null to use default camera position
        settings.viewport3D = null;
      }
    });
  } 
  // For 2D plots, track axis ranges
  else {
    plotContainer.on('plotly_relayout', function(eventData) {
      // Check if the event includes axis range information
      const hasXRange = eventData['xaxis.range'] || eventData['xaxis.range[0]'];
      const hasYRange = eventData['yaxis.range'] || eventData['yaxis.range[0]'];
      
      if (hasXRange || hasYRange) {
        // Initialize viewport2D if it doesn't exist
        if (!settings.viewport2D) {
          settings.viewport2D = {};
        }
        
        // Handle range as array or as separate values
        if (eventData['xaxis.range']) {
          settings.viewport2D.xrange = eventData['xaxis.range'];
        } else if (eventData['xaxis.range[0]'] !== undefined && eventData['xaxis.range[1]'] !== undefined) {
          settings.viewport2D.xrange = [eventData['xaxis.range[0]'], eventData['xaxis.range[1]']];
        }
        
        if (eventData['yaxis.range']) {
          settings.viewport2D.yrange = eventData['yaxis.range'];
        } else if (eventData['yaxis.range[0]'] !== undefined && eventData['yaxis.range[1]'] !== undefined) {
          settings.viewport2D.yrange = [eventData['yaxis.range[0]'], eventData['yaxis.range[1]']];
        }
      }
      
      // Handle reset view (when autorange is true after double click or clicking "Reset axes" button)
      if (eventData['xaxis.autorange'] === true || eventData['yaxis.autorange'] === true) {
        // Reset the viewport2D to null to use default axis ranges
        settings.viewport2D = null;
      }
    });
  }
}
  

  /**
   * Processes categorical data and generates Plotly traces.
   * @param {Object} settings - Settings object containing plot configurations.
   * @param {Object} data - Data object containing x, y, and color values.
   * @param {Array<string>} catValues - Array of unique category values.
   * @param {Array<string>} [customColors=null] - Optional custom colors for categories.
   * @returns {Array<Object>} - Array of Plotly trace objects for each category.
   */
  export function processCategories(settings, data, catValues, customColors = null) {
    // If custom colors are provided from 'uns', store them
  
    let selectedPalette;
    
    // Check if custom colors are provided in settings.
    if (
      settings?.categoryPalette === "uns" &&
      customColors &&
      customColors.length > 0
    ) {
      selectedPalette = customColors;
    } else {
        try {
          if (settings.categoryPalette === "uns") {
            // If "uns" is selected but no custom colors are provided, fall back to default palette.
            selectedPalette = generateDiscreteColors(catValues.length);
          } else {
            // Generate a color palette based on the provided palette name.
            selectedPalette = generateDiscreteColors(catValues.length, settings.categoryPalette);
          }
        }
        catch (error) {
          console.error(`Error generating color palette "${settings.categoryPalette}": ${error}`);
          // Fallback to a default palette if the provided one fails.
          selectedPalette = generateDiscreteColors(catValues.length);
        }

    }
  
    const traces = [];
    
    // Determine if this is a gene plot or cell plot
    const isGenePlot = data.genes !== undefined;
    const entityKey = isGenePlot ? 'genes' : 'cells';
  
    // For each category, split the data into a separate Plotly trace.
    catValues.forEach((category, i) => {
      // Get indices of all points that belong to this category.
      const indices = data.color.reduce((acc, val, idx) => {
        if (val === category) acc.push(idx);
        return acc;
      }, []);
  
      if (indices.length === 0) return; // Skip this category if there are no points
  
      const categoryColor = selectedPalette[i % selectedPalette.length];
  
      // Build the trace object for this category.
      const catTrace = {
        type: settings.z ? 'scatter3d' : 'scattergl',
        mode: 'markers',
        name: category,
        text: indices.map(idx => data[entityKey][idx]),
        customdata: indices, // for click handling
        hovertemplate: `%{text}<br>x: %{x}<br>y: %{y}` + (settings.z ? `<br>z: %{z}` : '') + `<br>${category}<extra></extra>`,
        x: indices.map(idx => data.x.values[idx]),
        y: indices.map(idx => data.y.values[idx]),
        marker: {
          size: settings.pointSize,
          opacity: settings.pointOpacity,
          color: categoryColor
        },
        showlegend: true
      };
  
      // Add z-axis values for 3D plots if applicable.
      if (settings.z && data.z) {
        catTrace.z = indices.map(idx => data.z.values[idx]);
      }
  
      traces.push(catTrace);
    });
  
    return traces;
  }
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
    // Remove the 2D axis configuration for 3D plots.
    delete layout.xaxis;
    delete layout.yaxis;
  }

  return layout;
}

/**
  * Attaches a click handler to the plot container.
  * @param {HTMLElement} plotContainer - The container for the plot.
  * @param {Array<Object>} traces - The traces used in the plot.
  * @param {Object} data - The data object containing cell or gene names.
*/
export function attachClickHandler(plotContainer, traces, data) {
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
        console.warn(`No ${isGenePlot ? 'gene' : 'cell'} name found for clicked point`);
        return;
      }
      
      if (isGenePlot) {
        console.log(`Clicked on gene: ${entityName}`);
        DataManager.setFocusedGene(entityName, true);
      } else {
        console.log(`Clicked on cell: ${entityName}`);
        DataManager.setFocusedCell(entityName, true);
      }
    });
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
          // Try to generate a palette using the provided palette name.
          selectedPalette = generateDiscreteColors(catValues.length, settings.categoryPalette);
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
        hovertemplate: `%{text}<br>x: %{x}<br>y: %{y}` + (settings.z ? `<br>z: %{z}` : '') + `<extra></extra>`,
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
  };
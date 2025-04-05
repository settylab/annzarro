/**
 * Plot Manager Module
 * 
 * Handles plot creation and management using Plotly.js
 */

const PlotManager = (function() {
    // Private variables
    let _plots = {};
    let _colorScales = {
        sequential: ['Viridis', 'Plasma', 'Inferno', 'Magma', 'Cividis', 'Turbo'],
        diverging: ['RdBu', 'RdYlBu', 'RdYlGn', 'Spectral', 'PiYG'],
        categorical: ['Paired', 'Set1', 'Set2', 'Set3', 'Dark2', 'Pastel1']
    };
    
    /**
     * Initialize the plot manager
     */
    function init() {
        console.log('PlotManager initialized');
        
        // Listen for events
        document.addEventListener('dataLoaded', handleDataLoaded);
        document.addEventListener('geneFocusChanged', handleGeneFocusChanged);
        document.addEventListener('cellFocusChanged', handleCellFocusChanged);
        document.addEventListener('geneSetChanged', handleGeneSetChanged);
        document.addEventListener('cellSetChanged', handleCellSetChanged);
        
        // Handle window resize
        window.addEventListener('resize', handleResize);
    }
    
    /**
     * Create a scatter plot
     * @param {string} elementId - ID of the container element
     * @param {Object} config - Plot configuration
     * @returns {string} - Plot ID
     */
    async function createScatterPlot(elementId, config = {}) {
        const element = document.getElementById(elementId);
        if (!element) {
            console.error(`Element not found: ${elementId}`);
            return null;
        }
        
        // Generate a unique plot ID
        const plotId = `plot-${Date.now()}`;
        
        try {
            // Default config
            const defaultConfig = {
                type: 'scatter',
                xAxis: {
                    path: 'obsm/X_umap',
                    index: 0,
                    label: 'UMAP 1'
                },
                yAxis: {
                    path: 'obsm/X_umap',
                    index: 1,
                    label: 'UMAP 2'
                },
                zAxis: {
                    path: null,
                    index: null,
                    label: null
                },
                color: {
                    path: null,
                    label: null,
                    scale: 'Viridis',
                    range: [null, null],
                    clipValues: true
                },
                marker: {
                    size: 5,
                    opacity: 0.7
                },
                selection: {
                    cells: null,
                    genes: null
                },
                layout: {
                    title: '',
                    showLegend: true
                }
            };
            
            // Merge configs
            const mergedConfig = deepMerge(defaultConfig, config);
            
            // Get data
            let xData, yData, zData, colorData;
            
            // Get X axis data
            if (mergedConfig.xAxis.path === 'obsm/X_umap' && mergedConfig.xAxis.index === 0 && 
                mergedConfig.yAxis.path === 'obsm/X_umap' && mergedConfig.yAxis.index === 1) {
                // Common case: UMAP embedding
                console.log('Loading UMAP embedding for scatter plot');
                const embedding = await DataManager.loadObsm('X_umap', null, null);
                console.log('UMAP embedding loaded:', embedding ? `Array of ${embedding.length} items` : 'null or undefined');
                
                // Detailed debug logging
                if (embedding && embedding.length > 0) {
                    console.log('First 5 UMAP points:', embedding.slice(0, 5));
                    console.log('UMAP data type:', Array.isArray(embedding) ? 'Array' : typeof embedding);
                    
                    // Check for any null/undefined values
                    const hasNulls = embedding.some(row => row === null || row === undefined || 
                                                  !Array.isArray(row) || row.length < 2);
                    if (hasNulls) {
                        console.warn('UMAP data contains null/undefined values or rows with insufficient columns');
                    }
                }
                
                if (!embedding || embedding.length === 0) {
                    console.error('UMAP embedding is empty or missing');
                    throw new Error('UMAP data not available. Please check that the dataset contains UMAP coordinates in obsm/X_umap.');
                }
                
                // Extract coordinates and validate them
                xData = embedding.map(row => row[0]);
                yData = embedding.map(row => row[1]);
                
                // Validate coordinate data
                if (xData.some(val => val === null || val === undefined || isNaN(val)) ||
                    yData.some(val => val === null || val === undefined || isNaN(val))) {
                    console.error('UMAP coordinates contain invalid values');
                    throw new Error('UMAP data contains invalid coordinates. Please check the data quality.');
                }
                
                console.log(`Extracted coordinates: X (${xData.length} points), Y (${yData.length} points)`);
                console.log('X range:', [Math.min(...xData), Math.max(...xData)]);
                console.log('Y range:', [Math.min(...yData), Math.max(...yData)]);
            } else {
                // General case: load each axis separately
                console.log(`Loading axis data from paths: X=${mergedConfig.xAxis.path}, Y=${mergedConfig.yAxis.path}`);
                xData = await loadAxisData(mergedConfig.xAxis.path, mergedConfig.xAxis.index);
                yData = await loadAxisData(mergedConfig.yAxis.path, mergedConfig.yAxis.index);
                console.log(`Loaded axis data: X (${xData?.length || 0} points), Y (${yData?.length || 0} points)`);
            }
            
            // Get Z axis data if 3D plot
            if (mergedConfig.zAxis && mergedConfig.zAxis.path) {
                zData = await loadAxisData(mergedConfig.zAxis.path, mergedConfig.zAxis.index);
            }
            
            // Get color data if specified
            if (mergedConfig.color.path) {
                colorData = await loadAxisData(mergedConfig.color.path, mergedConfig.color.index);
            }
            
            // Apply selection filtering if needed
            let filterIndices = null;
            if (mergedConfig.selection && mergedConfig.selection.cells) {
                filterIndices = DataManager.getCellSet(mergedConfig.selection.cells);
            }
            
            // Apply filtering if needed
            if (filterIndices && filterIndices.length > 0) {
                xData = filterIndices.map(i => xData[i]);
                yData = filterIndices.map(i => yData[i]);
                
                if (zData) {
                    zData = filterIndices.map(i => zData[i]);
                }
                
                if (colorData) {
                    colorData = filterIndices.map(i => colorData[i]);
                }
            }
            
            // Create plot data
            const trace = {
                type: 'scatter' + (zData && zData.length > 0 ? '3d' : ''),
                mode: 'markers',
                x: xData,
                y: yData,
                marker: {
                    size: mergedConfig.marker.size,
                    opacity: mergedConfig.marker.opacity
                }
            };
            
            // Add z data if 3D
            if (zData && zData.length > 0) {
                trace.z = zData;
            }
            
            // Add color data if available
            if (colorData) {
                // Check if color data is categorical (strings/non-numeric)
                const isColorDataCategorical = colorData.some(value => 
                    typeof value === 'string' || isNaN(value)
                );
                
                if (isColorDataCategorical) {
                    // For categorical data, create a mapping of categories to colors
                    const uniqueCategories = [...new Set(colorData)].filter(val => val !== null);
                    console.log(`Detected categorical color data with ${uniqueCategories.length} unique values:`, uniqueCategories);
                    
                    // Get categorical color palette based on number of categories
                    let colorPalette;
                    if (uniqueCategories.length <= 10) {
                        // Use one of the categorical color scales
                        const categoryScale = mergedConfig.color.scale || _colorScales.categorical[0];
                        
                        // Create a color palette based on the number of categories
                        const getCategoryColors = (scale, count) => {
                            // Simplified color mapping for common scales
                            const colorMaps = {
                                'Paired': ['#a6cee3', '#1f78b4', '#b2df8a', '#33a02c', '#fb9a99', '#e31a1c', '#fdbf6f', '#ff7f00', '#cab2d6', '#6a3d9a', '#ffff99', '#b15928'],
                                'Set1': ['#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00', '#ffff33', '#a65628', '#f781bf', '#999999'],
                                'Set2': ['#66c2a5', '#fc8d62', '#8da0cb', '#e78ac3', '#a6d854', '#ffd92f', '#e5c494', '#b3b3b3'],
                                'Set3': ['#8dd3c7', '#ffffb3', '#bebada', '#fb8072', '#80b1d3', '#fdb462', '#b3de69', '#fccde5', '#d9d9d9', '#bc80bd', '#ccebc5', '#ffed6f'],
                                'Dark2': ['#1b9e77', '#d95f02', '#7570b3', '#e7298a', '#66a61e', '#e6ab02', '#a6761d', '#666666'],
                                'Pastel1': ['#fbb4ae', '#b3cde3', '#ccebc5', '#decbe4', '#fed9a6', '#ffffcc', '#e5d8bd', '#fddaec', '#f2f2f2']
                            };
                            
                            // Use the color map if available, otherwise fall back to simple colors
                            return colorMaps[scale] || 
                                ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'];
                        };
                        
                        colorPalette = getCategoryColors(categoryScale, uniqueCategories.length);
                    } else {
                        // For too many categories, use a hash function to assign colors
                        colorPalette = [];
                        for (let i = 0; i < uniqueCategories.length; i++) {
                            // Generate colors across the hue spectrum
                            const hue = (i * 137.5) % 360; // golden ratio to spread colors
                            colorPalette.push(`hsl(${hue}, 70%, 60%)`);
                        }
                    }
                    
                    // Create a mapping from category to color
                    const categoryToColor = {};
                    uniqueCategories.forEach((cat, i) => {
                        categoryToColor[cat] = colorPalette[i % colorPalette.length];
                    });
                    
                    // Map each data point to its color
                    trace.marker.color = colorData.map(cat => categoryToColor[cat] || '#cccccc');
                    
                    // Remove colorscale and colorbar for categorical data
                    delete trace.marker.colorscale;
                    delete trace.marker.colorbar;
                    
                    // Set up legend for categorical data
                    trace.showlegend = true;
                    trace.name = mergedConfig.color.label || 'Categories';
                    
                    // Create a separate trace for each category to build the legend
                    const traces = [trace];
                    uniqueCategories.forEach((cat, i) => {
                        // Only show a subset of categories in legend if there are too many
                        if (uniqueCategories.length > 20 && i >= 20) return;
                        
                        // Find indices for this category
                        const catIndices = [];
                        for (let j = 0; j < colorData.length; j++) {
                            if (colorData[j] === cat) {
                                catIndices.push(j);
                            }
                        }
                        
                        // Create a small sample trace for legend
                        traces.push({
                            name: cat,
                            mode: 'markers',
                            x: [null],
                            y: [null],
                            marker: {
                                color: categoryToColor[cat],
                                size: mergedConfig.marker.size
                            },
                            showlegend: true,
                            legendgroup: cat,
                            hoverinfo: 'none'
                        });
                    });
                    
                    // Save the traces array to be used later when creating the plot
                    mergedConfig._categoryTraces = traces;
                    console.log(`Created ${traces.length} traces for categorical legend`);
                } else {
                    // For numeric data, proceed with the normal colorscale approach
                    trace.marker.color = colorData;
                    
                    // Apply color range if specified
                    if (mergedConfig.color.range[0] !== null && mergedConfig.color.range[1] !== null) {
                        const [min, max] = mergedConfig.color.range;
                        
                        if (mergedConfig.color.clipValues) {
                            // Clip values to range
                            trace.marker.cmin = min;
                            trace.marker.cmax = max;
                        } else {
                            // Filter out points outside the range
                            const indices = [];
                            for (let i = 0; i < colorData.length; i++) {
                                if (colorData[i] >= min && colorData[i] <= max) {
                                    indices.push(i);
                                }
                            }
                            
                            trace.x = indices.map(i => trace.x[i]);
                            trace.y = indices.map(i => trace.y[i]);
                            trace.marker.color = indices.map(i => colorData[i]);
                            
                            if (trace.z) {
                                trace.z = indices.map(i => trace.z[i]);
                            }
                        }
                    }
                    
                    // Set color scale
                    trace.marker.colorscale = mergedConfig.color.scale;
                    
                    // Add color bar
                    trace.marker.colorbar = {
                        title: mergedConfig.color.label || '',
                        titleside: 'right'
                    };
                }
            }
            
            // Create layout
            const layout = {
                title: mergedConfig.layout.title || '',
                showlegend: mergedConfig.layout.showLegend,
                hovermode: 'closest',
                margin: { l: 60, r: 40, t: 50, b: 60, pad: 10 },
                xaxis: {
                    title: mergedConfig.xAxis.label || 'X Axis'
                },
                yaxis: {
                    title: mergedConfig.yAxis.label || 'Y Axis'
                }
            };
            
            // Add z-axis for 3D plots
            if (zData && zData.length > 0) {
                layout.scene = {
                    xaxis: { title: mergedConfig.xAxis.label || 'X Axis' },
                    yaxis: { title: mergedConfig.yAxis.label || 'Y Axis' },
                    zaxis: { title: mergedConfig.zAxis.label || 'Z Axis' }
                };
            }
            
            // Create plot
            console.log("Creating plot with data:", {
                points: trace.x?.length || 0,
                xRange: trace.x ? [Math.min(...trace.x), Math.max(...trace.x)] : 'N/A',
                yRange: trace.y ? [Math.min(...trace.y), Math.max(...trace.y)] : 'N/A'
            });
            
            // Ensure the element is visible and has dimensions
            element.style.visibility = 'visible';
            element.style.minHeight = '300px';
            
            // Use category traces if available for categorical data
            const plotData = mergedConfig._categoryTraces || [trace];
            
            await Plotly.newPlot(element, plotData, layout, {
                responsive: true,
                displayModeBar: true,
                modeBarButtonsToRemove: ['toImage', 'sendDataToCloud', 'resetScale2d']
            });
            
            // Force a resize to ensure plot renders properly
            window.dispatchEvent(new Event('resize'));
            
            // Store plot in registry
            _plots[plotId] = {
                element: element,
                config: mergedConfig,
                type: 'scatter',
                lastUpdate: Date.now()
            };
            
            // Add click event handler
            element.on('plotly_click', data => {
                handlePlotClick(plotId, data);
            });
            
            // Return the plot ID
            return plotId;
        } catch (error) {
            console.error('Error creating scatter plot:', error);
            
            // Show detailed error in element
            console.error('Error stack trace:', error.stack);
            
            try {
                if (config.error) {
                    // Use the provided error message from the config
                    element.innerHTML = `
                        <div class="alert alert-danger">
                            <h5>Error Creating Plot</h5>
                            <p>${config.error}</p>
                        </div>
                    `;
                } else {
                    // Show the error message with detailed information
                    element.innerHTML = `
                        <div class="alert alert-danger">
                            <h5>Error Creating Plot</h5>
                            <p>${error.message}</p>
                            <div class="mt-3">
                                <strong>Troubleshooting:</strong>
                                <ul>
                                    <li>Check if the dataset contains embedding data (UMAP, tSNE, PCA)</li>
                                    <li>Verify that 'obsm' section exists and contains embedding matrices</li>
                                    <li>Check browser console for detailed error logs</li>
                                </ul>
                            </div>
                        </div>
                    `;
                }
            } catch (errorHandlingError) {
                console.error('Error displaying error message:', errorHandlingError);
                element.innerHTML = '<div class="alert alert-danger">Error creating plot</div>';
            }
            
            return null;
        }
    }
    
    /**
     * Create a violin plot
     * @param {string} elementId - ID of the container element
     * @param {Object} config - Plot configuration
     * @returns {string} - Plot ID
     */
    async function createViolinPlot(elementId, config = {}) {
        const element = document.getElementById(elementId);
        if (!element) {
            console.error(`Element not found: ${elementId}`);
            return null;
        }
        
        // Generate a unique plot ID
        const plotId = `plot-${Date.now()}`;
        
        try {
            // Default config
            const defaultConfig = {
                xAxis: {
                    path: 'obs/leiden',
                    label: 'Cluster'
                },
                yAxis: {
                    path: 'obs/n_genes',
                    label: 'Number of Genes'
                },
                color: {
                    path: null,
                    scale: 'Viridis'
                },
                layout: {
                    title: '',
                    showLegend: true
                }
            };
            
            // Merge configs
            const mergedConfig = deepMerge(defaultConfig, config);
            
            // Get data
            let xData, yData;
            
            // Load X data (categorical)
            const xPath = mergedConfig.xAxis.path.split('/');
            if (xPath[0] === 'obs') {
                const obsData = await DataManager.loadObs(null, [xPath[1]]);
                xData = obsData[xPath[1]];
            } else {
                throw new Error('X axis for violin plot must be a categorical variable from obs');
            }
            
            // Load Y data (numerical)
            const yPath = mergedConfig.yAxis.path.split('/');
            if (yPath[0] === 'obs') {
                const obsData = await DataManager.loadObs(null, [yPath[1]]);
                yData = obsData[yPath[1]];
            } else if (yPath[0] === 'X' || yPath[0] === 'layers') {
                // For expression data, need focused gene
                const focusedGene = DataManager.getFocusedGene();
                if (!focusedGene) {
                    throw new Error('Expression plotting requires a focused gene');
                }
                
                // Get gene index
                const geneNames = await DataManager.loadGeneNames();
                const geneIndex = geneNames.indexOf(focusedGene);
                
                if (geneIndex === -1) {
                    throw new Error(`Gene not found: ${focusedGene}`);
                }
                
                // Load expression data
                if (yPath[0] === 'X') {
                    const exprData = await DataManager.loadX(null, [geneIndex]);
                    yData = exprData.map(row => row[0]);
                } else {
                    // Layers
                    const layer = yPath[1];
                    const exprData = await DataManager.loadLayer(layer, null, [geneIndex]);
                    yData = exprData.map(row => row[0]);
                }
            } else {
                throw new Error('Y axis data path not supported for violin plot');
            }
            
            // Group Y data by X categories
            const categories = [...new Set(xData)];
            const traces = [];
            
            for (const category of categories) {
                const indices = [];
                for (let i = 0; i < xData.length; i++) {
                    if (xData[i] === category) {
                        indices.push(i);
                    }
                }
                
                const categoryYData = indices.map(i => yData[i]);
                
                traces.push({
                    type: 'violin',
                    x: Array(categoryYData.length).fill(category),
                    y: categoryYData,
                    name: category,
                    box: {
                        visible: true
                    },
                    meanline: {
                        visible: true
                    }
                });
            }
            
            // Create layout
            const layout = {
                title: mergedConfig.layout.title || '',
                xaxis: {
                    title: mergedConfig.xAxis.label || 'X Axis'
                },
                yaxis: {
                    title: mergedConfig.yAxis.label || 'Y Axis'
                },
                violinmode: 'group',
                showlegend: mergedConfig.layout.showLegend,
                margin: { l: 60, r: 40, t: 50, b: 100, pad: 10 }
            };
            
            // Create plot
            await Plotly.newPlot(element, traces, layout, {
                responsive: true,
                displayModeBar: true,
                modeBarButtonsToRemove: ['toImage', 'sendDataToCloud']
            });
            
            // Store plot in registry
            _plots[plotId] = {
                element: element,
                config: mergedConfig,
                type: 'scatter',
                lastUpdate: Date.now()
            };
            
            // Return the plot ID
            return plotId;
        } catch (error) {
            console.error('Error creating violin plot:', error);
            console.error('Error stack trace:', error.stack);
            
            // Show detailed error in element
            if (mergedConfig.error) {
                // Use the provided error message from the config
                element.innerHTML = `
                    <div class="alert alert-danger">
                        <h5>Error Creating Plot</h5>
                        <p>${mergedConfig.error}</p>
                    </div>
                `;
            } else {
                // Show the error message with detailed information
                element.innerHTML = `
                    <div class="alert alert-danger">
                        <h5>Error Creating Violin Plot</h5>
                        <p>${error.message}</p>
                        <div class="mt-3">
                            <strong>Troubleshooting:</strong>
                            <ul>
                                <li>Check if the categorical variable exists in the dataset</li>
                                <li>Verify that gene expression data is available</li>
                                <li>Check browser console for detailed error logs</li>
                            </ul>
                        </div>
                    </div>
                `;
            }
            
            return null;
        }
    }
    
    /**
     * Create a heatmap
     * @param {string} elementId - ID of the container element
     * @param {Object} config - Plot configuration
     * @returns {string} - Plot ID
     */
    async function createHeatmap(elementId, config = {}) {
        const element = document.getElementById(elementId);
        if (!element) {
            console.error(`Element not found: ${elementId}`);
            return null;
        }
        
        // Generate a unique plot ID
        const plotId = `plot-${Date.now()}`;
        
        try {
            // Default config
            const defaultConfig = {
                data: {
                    path: 'X',
                    layer: null
                },
                rows: {
                    type: 'cells',
                    set: null,
                    max: 50
                },
                columns: {
                    type: 'genes',
                    set: null,
                    max: 50
                },
                color: {
                    scale: 'Viridis',
                    range: [null, null]
                },
                layout: {
                    title: '',
                    showLabels: true
                }
            };
            
            // Merge configs
            const mergedConfig = deepMerge(defaultConfig, config);
            
            // Load rows and columns
            let rowIndices = [];
            let columnIndices = [];
            let rowLabels = [];
            let columnLabels = [];
            
            // Handle rows (cells)
            if (mergedConfig.rows.type === 'cells') {
                if (mergedConfig.rows.set) {
                    // Use a specified cell set
                    rowIndices = DataManager.getCellSet(mergedConfig.rows.set);
                    if (rowIndices.length === 0) {
                        throw new Error(`Cell set empty or not found: ${mergedConfig.rows.set}`);
                    }
                } else {
                    // Use top N cells
                    const cellCount = DataManager.getDatasetInfo().n_obs || 0;
                    rowIndices = Array.from({ length: Math.min(cellCount, mergedConfig.rows.max) }, (_, i) => i);
                }
                
                // Get cell labels
                const cellNames = await DataManager.loadCellNames();
                rowLabels = rowIndices.map(i => cellNames[i]);
            } else {
                throw new Error('Unsupported row type for heatmap');
            }
            
            // Handle columns (genes)
            if (mergedConfig.columns.type === 'genes') {
                if (mergedConfig.columns.set) {
                    // Use a specified gene set
                    columnIndices = DataManager.getGeneSet(mergedConfig.columns.set);
                    if (columnIndices.length === 0) {
                        throw new Error(`Gene set empty or not found: ${mergedConfig.columns.set}`);
                    }
                } else if (DataManager.getFocusedGene()) {
                    // Use focused gene and related genes (placeholder for actual implementation)
                    const geneNames = await DataManager.loadGeneNames();
                    const focusedGene = DataManager.getFocusedGene();
                    const focusedIndex = geneNames.indexOf(focusedGene);
                    
                    if (focusedIndex !== -1) {
                        // For now just use the focused gene and surrounding genes
                        const startIndex = Math.max(0, focusedIndex - Math.floor(mergedConfig.columns.max / 2));
                        columnIndices = Array.from(
                            { length: Math.min(mergedConfig.columns.max, geneNames.length - startIndex) }, 
                            (_, i) => startIndex + i
                        );
                    } else {
                        // Fallback to first N genes
                        columnIndices = Array.from({ length: mergedConfig.columns.max }, (_, i) => i);
                    }
                } else {
                    // Use top N genes
                    const geneCount = DataManager.getDatasetInfo().n_vars || 0;
                    columnIndices = Array.from({ length: Math.min(geneCount, mergedConfig.columns.max) }, (_, i) => i);
                }
                
                // Get gene labels
                const geneNames = await DataManager.loadGeneNames();
                columnLabels = columnIndices.map(i => geneNames[i]);
            } else {
                throw new Error('Unsupported column type for heatmap');
            }
            
            // Load matrix data
            let matrixData;
            if (mergedConfig.data.path === 'X') {
                // Load from main matrix
                matrixData = await DataManager.loadX(rowIndices, columnIndices);
            } else if (mergedConfig.data.path === 'layers') {
                // Load from layer
                if (!mergedConfig.data.layer) {
                    throw new Error('Layer name not specified');
                }
                matrixData = await DataManager.loadLayer(mergedConfig.data.layer, rowIndices, columnIndices);
            } else {
                throw new Error(`Unsupported data path for heatmap: ${mergedConfig.data.path}`);
            }
            
            // Create trace
            const trace = {
                type: 'heatmap',
                z: matrixData,
                x: columnLabels,
                y: rowLabels,
                colorscale: mergedConfig.color.scale,
                showscale: true
            };
            
            // Apply color range if specified
            if (mergedConfig.color.range[0] !== null && mergedConfig.color.range[1] !== null) {
                trace.zmin = mergedConfig.color.range[0];
                trace.zmax = mergedConfig.color.range[1];
            }
            
            // Create layout
            const layout = {
                title: mergedConfig.layout.title || '',
                margin: { l: 100, r: 40, t: 50, b: 100, pad: 10 },
                xaxis: {
                    title: 'Genes',
                    showticklabels: mergedConfig.layout.showLabels
                },
                yaxis: {
                    title: 'Cells',
                    showticklabels: mergedConfig.layout.showLabels
                }
            };
            
            // Create plot
            await Plotly.newPlot(element, [trace], layout, {
                responsive: true,
                displayModeBar: true,
                modeBarButtonsToRemove: ['toImage', 'sendDataToCloud']
            });
            
            // Store plot in registry
            _plots[plotId] = {
                element: element,
                config: mergedConfig,
                type: 'scatter',
                lastUpdate: Date.now()
            };
            
            // Return the plot ID
            return plotId;
        } catch (error) {
            console.error('Error creating heatmap:', error);
            console.error('Error stack trace:', error.stack);
            
            // Show detailed error in element
            if (mergedConfig.error) {
                // Use the provided error message from the config
                element.innerHTML = `
                    <div class="alert alert-danger">
                        <h5>Error Creating Heatmap</h5>
                        <p>${mergedConfig.error}</p>
                    </div>
                `;
            } else {
                // Show the error message with detailed information
                element.innerHTML = `
                    <div class="alert alert-danger">
                        <h5>Error Creating Heatmap</h5>
                        <p>${error.message}</p>
                        <div class="mt-3">
                            <strong>Troubleshooting:</strong>
                            <ul>
                                <li>Check if the gene and cell data is available</li>
                                <li>Verify that expression data can be loaded</li>
                                <li>Reduce the number of cells/genes if the dataset is too large</li>
                                <li>Check browser console for detailed error logs</li>
                            </ul>
                        </div>
                    </div>
                `;
            }
            
            return null;
        }
    }
    
    /**
     * Load data for a specific axis
     * @param {string} path - Data path
     * @param {number} index - Index in array (if applicable)
     * @returns {Promise<Array>} - Array of values
     */
    async function loadAxisData(path, index) {
        if (!path) return null;
        
        console.log(`Loading axis data from path: ${path}, index: ${index !== undefined ? index : 'undefined'}`);
        
        // Handle direct paths from DataManager.loadDataByPath when needed
        if (path.includes('/') && path.split('/').length > 2) {
            console.log(`Using direct path loading for complex path: ${path}`);
            try {
                const data = await DataManager.loadDataByPath(path, null, null);
                if (Array.isArray(data)) {
                    return data;
                } else {
                    console.warn(`Data returned from ${path} is not an array:`, data);
                    return [];
                }
            } catch (e) {
                console.error(`Error loading data by path ${path}:`, e);
                throw new Error(`Failed to load ${path}: ${e.message}`);
            }
        }
        
        try {
            const pathParts = path.split('/');
            const component = pathParts[0];
            
            switch (component) {
                case 'X':
                    // Expression data - need a focused gene
                    const focusedGene = DataManager.getFocusedGene();
                    if (!focusedGene) {
                        console.error('No focused gene available for X expression plotting');
                        throw new Error('Expression plotting requires a focused gene. Please select a gene first.');
                    }
                    
                    console.log(`Loading X expression data for gene: ${focusedGene}`);
                    
                    // Get gene index with retry if needed
                    let geneNames = await DataManager.loadGeneNames();
                    if (!geneNames || geneNames.length === 0) {
                        console.warn('Gene names not available on first try, retrying...');
                        // Short delay and retry
                        await new Promise(resolve => setTimeout(resolve, 500));
                        geneNames = await DataManager.loadGeneNames();
                        
                        if (!geneNames || geneNames.length === 0) {
                            throw new Error('Failed to load gene names after retry. Dataset may be missing gene information.');
                        }
                    }
                    
                    const geneIndex = geneNames.indexOf(focusedGene);
                    
                    if (geneIndex === -1) {
                        console.error(`Gene '${focusedGene}' not found in gene list`);
                        throw new Error(`Gene not found: ${focusedGene}. Please select a valid gene from the dataset.`);
                    }
                    
                    console.log(`Loading X expression data for gene index: ${geneIndex}`);
                    
                    // Load data for this gene
                    const exprData = await DataManager.loadX(null, [geneIndex]);
                    if (!exprData || exprData.length === 0) {
                        throw new Error(`No expression data available for gene: ${focusedGene}`);
                    }
                    
                    const result = exprData.map(row => row[0]);
                    console.log(`Loaded X expression data: ${result.length} points`);
                    return result;
                
                case 'obs':
                    if (pathParts.length < 2) {
                        throw new Error('Invalid path for obs data: missing column name');
                    }
                    
                    const colName = pathParts[1];
                    console.log(`Loading obs data for column: ${colName}`);
                    
                    try {
                        // Get dataset info to check if column exists
                        const datasetInfo = DataManager.getDatasetInfo();
                        if (!datasetInfo || !datasetInfo.obs || !datasetInfo.obs.columns) {
                            console.error('No obs data available in dataset');
                            throw new Error(`Cannot load obs data: dataset info is missing`);
                        }
                        
                        console.log(`Available obs columns:`, datasetInfo.obs.columns);
                        
                        // Check if the column exists
                        if (!datasetInfo.obs.columns.includes(colName)) {
                            console.error(`Column '${colName}' not found in obs. Available columns: ${datasetInfo.obs.columns.join(', ')}`);
                            throw new Error(`Column '${colName}' not found in obs data. Available columns: ${datasetInfo.obs.columns.join(', ')}`);
                        }
                        
                        // Use empty array for row indices instead of null
                        // Pass true as the third parameter to get all cells
                        console.log(`Calling DataManager.loadObs with column: ${colName}`);
                        const obsData = await DataManager.loadObs([], [colName], true);
                        console.log(`Result from loadObs:`, obsData);
                        
                        // More detailed error checking
                        if (!obsData) {
                            throw new Error(`DataManager.loadObs returned null or undefined for column: ${colName}`);
                        }
                        
                        if (!obsData[colName]) {
                            console.error(`Column ${colName} not found in returned data:`, obsData);
                            
                            // Special case for empty response from server
                            if (Array.isArray(obsData) && obsData.length === 0) {
                                console.error(`Server returned empty data array for obs/${colName}`);
                                throw new Error(`Server API issue: Unable to load data for column '${colName}'. The backend returned an empty array. Please contact the server administrator.`);
                            } else {
                                throw new Error(`Column '${colName}' not found in returned data. Available: ${Object.keys(obsData).join(', ')}`);
                            }
                        }
                        
                        if (obsData[colName].length === 0) {
                            throw new Error(`Column '${colName}' exists but contains no data (empty array)`);
                        }
                        
                        console.log(`Loaded obs data for ${colName}: ${obsData[colName].length} values`);
                        return obsData[colName];
                    } catch (error) {
                        console.error(`Error loading obs column ${colName}:`, error);
                        // Rethrow with more helpful message
                        throw new Error(`Failed to load obs/${colName}: ${error.message}`);
                    }
                
                case 'var':
                    if (pathParts.length < 2) {
                        throw new Error('Invalid path for var data: missing column name');
                    }
                    
                    const varName = pathParts[1];
                    console.log(`Loading var data for column: ${varName}`);
                    
                    // Use empty array for row indices instead of null
                    const varData = await DataManager.loadVar([], [varName]);
                    if (!varData || !varData[varName] || varData[varName].length === 0) {
                        throw new Error(`No data available for var column: ${varName}`);
                    }
                    
                    console.log(`Loaded var data for ${varName}: ${varData[varName].length} values`);
                    return varData[varName];
                
                case 'obsm':
                    if (pathParts.length < 2) {
                        throw new Error('Invalid path for obsm data: missing obsm key');
                    }
                    
                    const obsmKey = pathParts[1];
                    console.log(`Loading obsm data for key: ${obsmKey}`);
                    
                    if (pathParts.length >= 3) {
                        // Dataframe column
                        const columnName = pathParts[2];
                        console.log(`Loading dataframe column from obsm/${obsmKey}: ${columnName}`);
                        
                        const columnData = await DataManager.loadObsm(obsmKey, null, null, columnName);
                        if (!columnData || columnData.length === 0) {
                            throw new Error(`No data available for obsm dataframe column: ${obsmKey}/${columnName}`);
                        }
                        
                        console.log(`Loaded obsm dataframe column ${obsmKey}/${columnName}: ${columnData.length} values`);
                        return columnData;
                    } else {
                        // Matrix column
                        console.log(`Loading matrix column from obsm/${obsmKey}, index: ${index || 0}`);
                        
                        const matrix = await DataManager.loadObsm(obsmKey, [], null);
                        if (!matrix || matrix.length === 0) {
                            throw new Error(`No data available for obsm matrix: ${obsmKey}`);
                        }
                        
                        // Check if the index is valid
                        if (matrix[0].length <= (index || 0)) {
                            throw new Error(`Invalid column index ${index} for obsm/${obsmKey}. Matrix only has ${matrix[0].length} columns.`);
                        }
                        
                        const columnData = matrix.map(row => row[index || 0]);
                        console.log(`Extracted obsm/${obsmKey} column ${index || 0}: ${columnData.length} values`);
                        return columnData;
                    }
                
                case 'varm':
                    if (pathParts.length < 2) {
                        throw new Error('Invalid path for varm data: missing varm key');
                    }
                    
                    const varmKey = pathParts[1];
                    console.log(`Loading varm data for key: ${varmKey}`);
                    
                    if (pathParts.length >= 3) {
                        // Dataframe column
                        const columnName = pathParts[2];
                        console.log(`Loading dataframe column from varm/${varmKey}: ${columnName}`);
                        
                        const columnData = await DataManager.loadVarm(varmKey, null, null, columnName);
                        if (!columnData || columnData.length === 0) {
                            throw new Error(`No data available for varm dataframe column: ${varmKey}/${columnName}`);
                        }
                        
                        console.log(`Loaded varm dataframe column ${varmKey}/${columnName}: ${columnData.length} values`);
                        return columnData;
                    } else {
                        // Matrix column
                        console.log(`Loading matrix column from varm/${varmKey}, index: ${index || 0}`);
                        
                        const matrix = await DataManager.loadVarm(varmKey, [], null);
                        if (!matrix || matrix.length === 0) {
                            throw new Error(`No data available for varm matrix: ${varmKey}`);
                        }
                        
                        // Check if the index is valid
                        if (matrix[0].length <= (index || 0)) {
                            throw new Error(`Invalid column index ${index} for varm/${varmKey}. Matrix only has ${matrix[0].length} columns.`);
                        }
                        
                        const columnData = matrix.map(row => row[index || 0]);
                        console.log(`Extracted varm/${varmKey} column ${index || 0}: ${columnData.length} values`);
                        return columnData;
                    }
                
                case 'layers':
                    if (pathParts.length < 2) {
                        throw new Error('Invalid path for layers data: missing layer name');
                    }
                    
                    const layer = pathParts[1];
                    console.log(`Loading layer data for: ${layer}`);
                    
                    // Expression data - need a focused gene
                    const focusedGeneLayer = DataManager.getFocusedGene();
                    if (!focusedGeneLayer) {
                        console.error('No focused gene available for layer expression plotting');
                        throw new Error('Expression plotting requires a focused gene. Please select a gene first.');
                    }
                    
                    console.log(`Loading layer expression data for gene: ${focusedGeneLayer}`);
                    
                    // Get gene index
                    const geneNamesLayer = await DataManager.loadGeneNames();
                    if (!geneNamesLayer || geneNamesLayer.length === 0) {
                        throw new Error('Failed to load gene names. Dataset may be missing gene information.');
                    }
                    
                    const geneIndexLayer = geneNamesLayer.indexOf(focusedGeneLayer);
                    
                    if (geneIndexLayer === -1) {
                        console.error(`Gene '${focusedGeneLayer}' not found in gene list`);
                        throw new Error(`Gene not found: ${focusedGeneLayer}. Please select a valid gene from the dataset.`);
                    }
                    
                    console.log(`Loading layer expression data for gene index: ${geneIndexLayer}`);
                    
                    // Load data for this gene
                    const layerData = await DataManager.loadLayer(layer, null, [geneIndexLayer]);
                    if (!layerData || layerData.length === 0) {
                        throw new Error(`No expression data available for gene: ${focusedGeneLayer} in layer: ${layer}`);
                    }
                    
                    const layerResult = layerData.map(row => row[0]);
                    console.log(`Loaded layer expression data: ${layerResult.length} points`);
                    return layerResult;
                
                default:
                    throw new Error(`Unsupported data component: ${component}. Valid options are X, obs, var, obsm, varm, layers.`);
            }
        } catch (error) {
            console.error(`Error loading axis data from ${path}:`, error);
            throw new Error(`Failed to load data from ${path}: ${error.message}`);
        }
    }
    
    /**
     * Handle plot click events
     * @param {string} plotId - Plot ID
     * @param {Object} data - Click event data
     */
    function handlePlotClick(plotId, data) {
        if (!plotId || !data || !data.points || data.points.length === 0) return;
        
        const plot = _plots[plotId];
        if (!plot) return;
        
        const point = data.points[0];
        
        // Determine what was clicked based on plot type and config
        if (plot.config.type === 'scatter') {
            // For scatter plots, set focused cell if showing cells
            if (plot.config.rows && plot.config.rows.type === 'cells') {
                // Find the cell index
                const pointIndex = point.pointIndex;
                
                // Get cell name
                DataManager.loadCellNames().then(cellNames => {
                    const cellName = cellNames[pointIndex];
                    if (cellName) {
                        DataManager.setFocusedCell(cellName);
                    }
                }).catch(error => {
                    console.error('Error getting cell name:', error);
                });
            }
        } else if (plot.config.type === 'heatmap') {
            // For heatmaps, set focused gene or cell depending on what was clicked
            if (point.y !== undefined && plot.config.rows && plot.config.rows.type === 'cells') {
                // Cell row clicked
                const cellName = point.y;
                DataManager.setFocusedCell(cellName);
            }
            
            if (point.x !== undefined && plot.config.columns && plot.config.columns.type === 'genes') {
                // Gene column clicked
                const geneName = point.x;
                DataManager.setFocusedGene(geneName);
            }
        }
    }
    
    /**
     * Update a plot
     * @param {string} plotId - Plot ID
     * @param {Object} config - Updated configuration
     */
    function updatePlot(plotId, config = {}) {
        // Normalize plotId to handle different formats
        const normalizedPlotId = plotId.includes('plot-') ? plotId : `plot-${plotId.replace('panel-', '')}`;
        console.log(`Looking for plot with ID: ${plotId} (normalized: ${normalizedPlotId})`);
        
        // Try multiple plot ID formats
        let plot = _plots[plotId] || _plots[normalizedPlotId];
        
        // Log all available plots for debugging
        console.log('Available plots:', Object.keys(_plots));
        
        if (!plot) {
            console.error(`Plot not found: ${plotId} (or ${normalizedPlotId})`);
            
            // If we have at least one plot and we're in a desperate situation, use the first one
            const plotIds = Object.keys(_plots);
            if (plotIds.length > 0) {
                const firstPlotId = plotIds[0];
                console.log(`Falling back to first available plot: ${firstPlotId}`);
                plot = _plots[firstPlotId];
            } else {
                return;
            }
        }
        
        console.log(`Updating plot ${plotId} with config:`, config);
        
        // Update config
        plot.config = deepMerge(plot.config, config);
        
        try {
            // Re-create the plot based on its type
            switch (plot.config.type) {
                case 'scatter':
                    // Use the element.id instead of element directly to ensure proper lookup
                    if (plot.element && plot.element.id) {
                        console.log(`Re-creating scatter plot in element ${plot.element.id}`);
                        createScatterPlot(plot.element.id, plot.config);
                    } else {
                        console.error('Plot element missing or has no ID');
                    }
                    break;
                case 'violin':
                    createViolinPlot(plot.element.id, plot.config);
                    break;
                case 'heatmap':
                    createHeatmap(plot.element.id, plot.config);
                    break;
                default:
                    console.error(`Unsupported plot type: ${plot.config.type}`);
            }
            
            // Update timestamp for tracking changes
            plot.lastUpdate = Date.now();
            
        } catch (error) {
            console.error('Error updating plot:', error);
            
            // Show error in plot area
            console.error('Error updating plot with config:', plot.config);
            console.error('Error details:', error);
            
            if (plot.element) {
                try {
                    const mergedConfig = plot.config; // Ensure mergedConfig is defined for error handling
                    plot.element.innerHTML = `
                        <div class="alert alert-danger">
                            <h5>Error Updating Plot</h5>
                            <p>${error.message}</p>
                            <div class="mt-3">
                                <strong>Troubleshooting:</strong>
                                <ul>
                                    <li>Verify that the selected data exists in the dataset</li>
                                    <li>Check that any required focused gene/cell is selected</li>
                                    <li>Try a different combination of axes</li>
                                </ul>
                            </div>
                        </div>
                    `;
                } catch (errorHandlingError) {
                    console.error('Error displaying error message:', errorHandlingError);
                    plot.element.innerHTML = '<div class="alert alert-danger">Error updating plot</div>';
                }
            }
        }
    }
    
    /**
     * Handle dataset loaded event
     * @param {Event} event - Dataset loaded event
     */
    function handleDataLoaded(event) {
        // No action by default, plots will be created explicitly
    }
    
    /**
     * Handle gene focus changed event
     * @param {Event} event - Gene focus changed event
     */
    function handleGeneFocusChanged(event) {
        // Update plots that depend on focused gene
        for (const plotId in _plots) {
            const plot = _plots[plotId];
            
            // Check if plot depends on focused gene
            let needsUpdate = false;
            
            if (plot.config.xAxis && plot.config.xAxis.path && 
                (plot.config.xAxis.path.startsWith('X/') || plot.config.xAxis.path.startsWith('layers/'))) {
                needsUpdate = true;
            }
            
            if (plot.config.yAxis && plot.config.yAxis.path && 
                (plot.config.yAxis.path.startsWith('X/') || plot.config.yAxis.path.startsWith('layers/'))) {
                needsUpdate = true;
            }
            
            if (plot.config.zAxis && plot.config.zAxis.path && 
                (plot.config.zAxis.path.startsWith('X/') || plot.config.zAxis.path.startsWith('layers/'))) {
                needsUpdate = true;
            }
            
            if (plot.config.color && plot.config.color.path && 
                (plot.config.color.path.startsWith('X/') || plot.config.color.path.startsWith('layers/'))) {
                needsUpdate = true;
            }
            
            // Update plot if needed
            if (needsUpdate) {
                updatePlot(plotId);
            }
        }
    }
    
    /**
     * Handle cell focus changed event
     * @param {Event} event - Cell focus changed event
     */
    function handleCellFocusChanged(event) {
        // Update plots that highlight focused cell
        // (Placeholder for implementation)
    }
    
    /**
     * Handle gene set changed event
     * @param {Event} event - Gene set changed event
     */
    function handleGeneSetChanged(event) {
        // Update plots that use gene sets
        for (const plotId in _plots) {
            const plot = _plots[plotId];
            
            // Check if plot uses the changed gene set
            if (plot.config.type === 'heatmap' && 
                plot.config.columns && 
                plot.config.columns.type === 'genes' && 
                plot.config.columns.set === event.detail.name) {
                
                updatePlot(plotId);
            }
        }
    }
    
    /**
     * Handle cell set changed event
     * @param {Event} event - Cell set changed event
     */
    function handleCellSetChanged(event) {
        // Update plots that use cell sets
        for (const plotId in _plots) {
            const plot = _plots[plotId];
            
            // Check if plot uses the changed cell set
            if ((plot.config.type === 'scatter' || plot.config.type === 'heatmap') && 
                plot.config.selection && 
                plot.config.selection.cells === event.detail.name) {
                
                updatePlot(plotId);
            }
        }
    }
    
    /**
     * Handle window resize
     */
    function handleResize() {
        // Resize all plots
        for (const plotId in _plots) {
            const plot = _plots[plotId];
            Plotly.Plots.resize(plot.element);
        }
    }
    
    /**
     * Deep merge two objects
     * @param {Object} target - Target object
     * @param {Object} source - Source object
     * @returns {Object} - Merged object
     */
    function deepMerge(target, source) {
        const result = {...target};
        
        for (const key in source) {
            if (source[key] instanceof Object && key in target && target[key] instanceof Object) {
                result[key] = deepMerge(target[key], source[key]);
            } else if (source[key] !== undefined) {
                result[key] = source[key];
            }
        }
        
        return result;
    }
    
    /**
     * Get available color scales
     * @returns {Object} - Color scales by category
     */
    function getColorScales() {
        return {..._colorScales};
    }
    
    // Public API
    return {
        init,
        createScatterPlot,
        createViolinPlot,
        createHeatmap,
        updatePlot,
        getColorScales
    };
})();

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    PlotManager.init();
});

// Export as module and global
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PlotManager;
} else {
    window.PlotManager = PlotManager;
}
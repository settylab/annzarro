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
                zAxis: null,
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
                const embedding = await DataManager.loadObsm('X_umap', null, null);
                xData = embedding.map(row => row[0]);
                yData = embedding.map(row => row[1]);
            } else {
                // General case: load each axis separately
                xData = await loadAxisData(mergedConfig.xAxis.path, mergedConfig.xAxis.index);
                yData = await loadAxisData(mergedConfig.yAxis.path, mergedConfig.yAxis.index);
            }
            
            // Get Z axis data if 3D plot
            if (mergedConfig.zAxis) {
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
                type: 'scatter' + (zData ? '3d' : ''),
                mode: 'markers',
                x: xData,
                y: yData,
                marker: {
                    size: mergedConfig.marker.size,
                    opacity: mergedConfig.marker.opacity
                }
            };
            
            // Add z data if 3D
            if (zData) {
                trace.z = zData;
            }
            
            // Add color data if available
            if (colorData) {
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
            if (zData) {
                layout.scene = {
                    xaxis: { title: mergedConfig.xAxis.label || 'X Axis' },
                    yaxis: { title: mergedConfig.yAxis.label || 'Y Axis' },
                    zaxis: { title: mergedConfig.zAxis.label || 'Z Axis' }
                };
            }
            
            // Create plot
            await Plotly.newPlot(element, [trace], layout, {
                responsive: true,
                displayModeBar: true,
                modeBarButtonsToRemove: ['toImage', 'sendDataToCloud', 'resetScale2d']
            });
            
            // Store plot in registry
            _plots[plotId] = {
                element: element,
                config: mergedConfig,
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
            
            // Show error in element
            element.innerHTML = `
                <div class="alert alert-danger">
                    <h5>Error Creating Plot</h5>
                    <p>${error.message}</p>
                </div>
            `;
            
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
                lastUpdate: Date.now()
            };
            
            // Return the plot ID
            return plotId;
        } catch (error) {
            console.error('Error creating violin plot:', error);
            
            // Show error in element
            element.innerHTML = `
                <div class="alert alert-danger">
                    <h5>Error Creating Plot</h5>
                    <p>${error.message}</p>
                </div>
            `;
            
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
                lastUpdate: Date.now()
            };
            
            // Return the plot ID
            return plotId;
        } catch (error) {
            console.error('Error creating heatmap:', error);
            
            // Show error in element
            element.innerHTML = `
                <div class="alert alert-danger">
                    <h5>Error Creating Heatmap</h5>
                    <p>${error.message}</p>
                </div>
            `;
            
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
        
        try {
            const pathParts = path.split('/');
            const component = pathParts[0];
            
            switch (component) {
                case 'X':
                    // Expression data - need a focused gene
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
                    
                    // Load data for this gene
                    const exprData = await DataManager.loadX(null, [geneIndex]);
                    return exprData.map(row => row[0]);
                
                case 'obs':
                    if (pathParts.length < 2) {
                        throw new Error('Invalid path for obs data');
                    }
                    
                    const colName = pathParts[1];
                    const obsData = await DataManager.loadObs(null, [colName]);
                    return obsData[colName];
                
                case 'var':
                    if (pathParts.length < 2) {
                        throw new Error('Invalid path for var data');
                    }
                    
                    const varName = pathParts[1];
                    const varData = await DataManager.loadVar(null, [varName]);
                    return varData[varName];
                
                case 'obsm':
                    if (pathParts.length < 2) {
                        throw new Error('Invalid path for obsm data');
                    }
                    
                    const obsmKey = pathParts[1];
                    
                    if (pathParts.length >= 3) {
                        // Dataframe column
                        const columnName = pathParts[2];
                        return await DataManager.loadObsm(obsmKey, null, null, columnName);
                    } else {
                        // Matrix column
                        const matrix = await DataManager.loadObsm(obsmKey, null, null);
                        return matrix.map(row => row[index || 0]);
                    }
                
                case 'varm':
                    if (pathParts.length < 2) {
                        throw new Error('Invalid path for varm data');
                    }
                    
                    const varmKey = pathParts[1];
                    
                    if (pathParts.length >= 3) {
                        // Dataframe column
                        const columnName = pathParts[2];
                        return await DataManager.loadVarm(varmKey, null, null, columnName);
                    } else {
                        // Matrix column
                        const matrix = await DataManager.loadVarm(varmKey, null, null);
                        return matrix.map(row => row[index || 0]);
                    }
                
                case 'layers':
                    if (pathParts.length < 2) {
                        throw new Error('Invalid path for layers data');
                    }
                    
                    const layer = pathParts[1];
                    
                    // Expression data - need a focused gene
                    const focusedGeneLayer = DataManager.getFocusedGene();
                    if (!focusedGeneLayer) {
                        throw new Error('Expression plotting requires a focused gene');
                    }
                    
                    // Get gene index
                    const geneNamesLayer = await DataManager.loadGeneNames();
                    const geneIndexLayer = geneNamesLayer.indexOf(focusedGeneLayer);
                    
                    if (geneIndexLayer === -1) {
                        throw new Error(`Gene not found: ${focusedGeneLayer}`);
                    }
                    
                    // Load data for this gene
                    const layerData = await DataManager.loadLayer(layer, null, [geneIndexLayer]);
                    return layerData.map(row => row[0]);
                
                default:
                    throw new Error(`Unsupported data component: ${component}`);
            }
        } catch (error) {
            console.error(`Error loading axis data from ${path}:`, error);
            throw error;
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
        const plot = _plots[plotId];
        if (!plot) {
            console.error(`Plot not found: ${plotId}`);
            return;
        }
        
        // Update config
        plot.config = deepMerge(plot.config, config);
        
        // Re-create the plot based on its type
        switch (plot.config.type) {
            case 'scatter':
                createScatterPlot(plot.element.id, plot.config);
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
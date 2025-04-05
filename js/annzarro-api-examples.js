/**
 * Annzarro API Examples
 * 
 * This file provides examples of correct backend API usage
 * for common visualization and data loading tasks.
 */

// Example singleton module pattern
const AnnzarroAPIExamples = (function() {
    // Private cache for API responses
    const _cache = {};
    
    /**
     * Clear the response cache
     */
    function clearCache() {
        Object.keys(_cache).forEach(key => {
            delete _cache[key];
        });
        console.log("Cache cleared");
    }
    
    /**
     * Example: Load dataset info with proper error handling
     * @param {string} datasetPath - Path to the dataset
     * @returns {Promise<Object>} - Dataset info object
     */
    async function loadDatasetInfo(datasetPath) {
        try {
            const cacheKey = `dataset_info_${datasetPath}`;
            
            // Check cache first
            if (_cache[cacheKey]) {
                console.log(`Using cached dataset info for: ${datasetPath}`);
                return _cache[cacheKey];
            }
            
            console.log(`Loading dataset info for: ${datasetPath}`);
            
            // Request dataset structure using the comprehensive endpoint
            const response = await fetch(
                `/api/v1/data/dataset_structure?dataset_path=${encodeURIComponent(datasetPath)}`
            );
            
            // Handle HTTP errors
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(
                    `Failed to load dataset info (${response.status} ${response.statusText}): ${errorText}`
                );
            }
            
            const data = await response.json();
            
            // Validate the response
            if (!data || data.error) {
                throw new Error(`API returned error: ${data.error || "Unknown error"}`);
            }
            
            // Cache the result
            _cache[cacheKey] = data;
            
            // Log some useful info about the dataset
            console.log(`Dataset loaded successfully: ${data.name}`);
            console.log(`- Cells: ${data.n_obs}`);
            console.log(`- Genes: ${data.n_vars}`);
            if (data.embeddings && data.embeddings.length > 0) {
                console.log(`- Available embeddings: ${data.embeddings.join(", ")}`);
            }
            
            return data;
        } catch (error) {
            // Detailed logging
            console.error("Error loading dataset info:", error);
            console.error("Error details:", error.stack);
            throw error; // Re-throw for caller to handle
        }
    }
    
    /**
     * Example: Load UMAP embedding with proper parameter handling
     * @param {string} datasetPath - Path to the dataset
     * @param {Array<number>} cellIndices - Optional cell indices to subset (null for all cells)
     * @param {number} maxCells - Maximum number of cells to return
     * @returns {Promise<Array>} - UMAP coordinates [[x1,y1], [x2,y2], ...]
     */
    async function loadUMAPEmbedding(datasetPath, cellIndices = null, maxCells = 10000) {
        try {
            // Create cache key based on parameters
            const cellKey = cellIndices ? cellIndices.join(',') : 'all';
            const cacheKey = `umap_${datasetPath}_${cellKey}_${maxCells}`;
            
            // Check cache first
            if (_cache[cacheKey]) {
                console.log(`Using cached UMAP data for: ${datasetPath}`);
                return _cache[cacheKey];
            }
            
            console.log(`Loading UMAP embedding for: ${datasetPath}`);
            
            // Create URL parameters
            const params = new URLSearchParams({
                dataset_path: datasetPath,
                max_cells: maxCells
            });
            
            // Add cell indices if provided
            if (cellIndices && cellIndices.length > 0) {
                params.append('rows', cellIndices.join(','));
            }
            
            // Make the API request
            const response = await fetch(`/api/v1/data/obsm/X_umap?${params}`);
            
            // Handle HTTP errors
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(
                    `Failed to load UMAP data (${response.status} ${response.statusText}): ${errorText}`
                );
            }
            
            const data = await response.json();
            
            // Validate the response
            if (!data || !data.data || !Array.isArray(data.data)) {
                throw new Error("API returned invalid UMAP data format");
            }
            
            // Log some info about the returned data
            console.log(`Loaded UMAP data: ${data.data.length} points`);
            
            // Additional validation - check for valid coordinates
            if (data.data.length > 0) {
                const firstPoint = data.data[0];
                if (!Array.isArray(firstPoint) || firstPoint.length < 2) {
                    throw new Error("UMAP data points have invalid format");
                }
                
                // Check for NaN values in coordinates
                const hasNaN = data.data.some(
                    point => isNaN(point[0]) || isNaN(point[1])
                );
                
                if (hasNaN) {
                    console.warn("UMAP data contains NaN values - this may cause visualization issues");
                }
            }
            
            // Cache the result
            _cache[cacheKey] = data.data;
            
            return data.data;
        } catch (error) {
            console.error("Error loading UMAP embedding:", error);
            console.error("Error details:", error.stack);
            throw error;
        }
    }
    
    /**
     * Example: Load observation (cell) data with correct parameters
     * @param {string} datasetPath - Path to the dataset
     * @param {Array<string>} columns - Column names to load
     * @param {Array<number>} cellIndices - Optional cell indices to subset (null for all cells)
     * @returns {Promise<Object>} - Object with column name keys and value arrays
     */
    async function loadObservationData(datasetPath, columns, cellIndices = null) {
        try {
            if (!columns || columns.length === 0) {
                throw new Error("No columns specified for observation data");
            }
            
            // Create cache key
            const colKey = columns.join(',');
            const cellKey = cellIndices ? cellIndices.join(',') : 'all';
            const cacheKey = `obs_${datasetPath}_${colKey}_${cellKey}`;
            
            // Check cache first
            if (_cache[cacheKey]) {
                console.log(`Using cached observation data for: ${datasetPath}, columns: ${colKey}`);
                return _cache[cacheKey];
            }
            
            console.log(`Loading observation data for: ${datasetPath}, columns: ${columns.join(', ')}`);
            
            // IMPORTANT: Use max_cells parameter, not fetch_all
            const params = new URLSearchParams({
                dataset_path: datasetPath,
                max_cells: 100000, // Use high value to ensure all data is returned
                columns: columns.join(',')
            });
            
            // Add cell indices if provided
            if (cellIndices && cellIndices.length > 0) {
                params.append('rows', cellIndices.join(','));
            }
            
            const response = await fetch(`/api/v1/data/obs?${params}`);
            
            // Handle HTTP errors
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(
                    `Failed to load observation data (${response.status} ${response.statusText}): ${errorText}`
                );
            }
            
            const result = await response.json();
            
            // Validate response
            if (!result || !result.data) {
                throw new Error("API returned invalid observation data format");
            }
            
            // Verify all requested columns are present
            const missingColumns = columns.filter(col => !result.data[col]);
            if (missingColumns.length > 0) {
                console.warn(`Some requested columns were not found: ${missingColumns.join(', ')}`);
            }
            
            // Log data lengths
            for (const column in result.data) {
                console.log(`Column ${column}: ${result.data[column].length} values`);
            }
            
            // Cache the result
            _cache[cacheKey] = result.data;
            
            return result.data;
        } catch (error) {
            console.error("Error loading observation data:", error);
            console.error("Error details:", error.stack);
            throw error;
        }
    }
    
    /**
     * Example: Load gene expression data for a specific gene
     * @param {string} datasetPath - Path to the dataset
     * @param {string} geneName - Name of the gene
     * @param {Array<number>} cellIndices - Optional cell indices to subset (null for all cells)
     * @returns {Promise<Array>} - Expression values array
     */
    async function loadGeneExpression(datasetPath, geneName, cellIndices = null) {
        try {
            if (!geneName) {
                throw new Error("No gene name specified");
            }
            
            // Create cache key
            const cellKey = cellIndices ? cellIndices.join(',') : 'all';
            const cacheKey = `expr_${datasetPath}_${geneName}_${cellKey}`;
            
            // Check cache first
            if (_cache[cacheKey]) {
                console.log(`Using cached expression data for gene: ${geneName}`);
                return _cache[cacheKey];
            }
            
            console.log(`Loading expression data for gene: ${geneName}`);
            
            // Step 1: Get gene names to find index
            const geneNamesResponse = await fetch(
                `/api/v1/data/genes?dataset_path=${encodeURIComponent(datasetPath)}`
            );
            
            if (!geneNamesResponse.ok) {
                throw new Error(`Failed to load gene names: ${geneNamesResponse.statusText}`);
            }
            
            const geneNamesResult = await geneNamesResponse.json();
            
            if (!geneNamesResult.genes || !Array.isArray(geneNamesResult.genes)) {
                throw new Error("Invalid gene names response format");
            }
            
            // Find gene index
            const geneIndex = geneNamesResult.genes.indexOf(geneName);
            if (geneIndex === -1) {
                throw new Error(`Gene "${geneName}" not found in dataset`);
            }
            
            console.log(`Found gene "${geneName}" at index: ${geneIndex}`);
            
            // Step 2: Get expression data
            const params = new URLSearchParams({
                dataset_path: datasetPath,
                cols: geneIndex.toString()
            });
            
            // Add cell indices if provided
            if (cellIndices && cellIndices.length > 0) {
                params.append('rows', cellIndices.join(','));
            }
            
            const expressionResponse = await fetch(`/api/v1/data/X?${params}`);
            
            if (!expressionResponse.ok) {
                throw new Error(`Failed to load expression data: ${expressionResponse.statusText}`);
            }
            
            const expressionResult = await expressionResponse.json();
            
            if (!expressionResult.data || !Array.isArray(expressionResult.data)) {
                throw new Error("Invalid expression data response format");
            }
            
            // Convert to 1D array of values
            const expressionValues = expressionResult.data.map(row => row[0]);
            
            console.log(`Loaded expression data: ${expressionValues.length} values`);
            
            // Basic statistics
            if (expressionValues.length > 0) {
                const min = Math.min(...expressionValues);
                const max = Math.max(...expressionValues);
                const sum = expressionValues.reduce((a, b) => a + b, 0);
                const mean = sum / expressionValues.length;
                
                console.log(`Expression range: ${min} to ${max}, mean: ${mean.toFixed(2)}`);
            }
            
            // Cache the result
            _cache[cacheKey] = expressionValues;
            
            return expressionValues;
        } catch (error) {
            console.error(`Error loading expression data for gene ${geneName}:`, error);
            console.error("Error details:", error.stack);
            throw error;
        }
    }
    
    /**
     * Example: Create a UMAP visualization with cell type coloring
     * @param {string} containerId - ID of the HTML container element
     * @param {string} datasetPath - Path to the dataset
     * @returns {Promise<void>}
     */
    async function createUMAPVisualization(containerId, datasetPath) {
        try {
            const container = document.getElementById(containerId);
            if (!container) {
                throw new Error(`Container element not found: ${containerId}`);
            }
            
            // Show loading indicator
            container.innerHTML = `
                <div class="text-center p-5">
                    <div class="spinner-border" role="status"></div>
                    <p class="mt-2">Loading visualization...</p>
                </div>
            `;
            
            // Step 1: Load UMAP coordinates
            const umapData = await loadUMAPEmbedding(datasetPath);
            
            // Step 2: Load cell type data for coloring
            // IMPORTANT: Using the correct 'max_cells' parameter, not 'fetch_all'
            const obsData = await loadObservationData(datasetPath, ['cell_type']);
            
            // Step 3: Create plot data
            const plotData = {
                x: umapData.map(point => point[0]),
                y: umapData.map(point => point[1]),
                mode: 'markers',
                type: 'scatter',
                marker: {
                    size: 5,
                    opacity: 0.7,
                    color: obsData.cell_type,
                    colorscale: 'Viridis'
                },
                hoverinfo: 'text',
                text: obsData.cell_type.map((type, i) => 
                    `Cell Type: ${type}<br>UMAP1: ${umapData[i][0].toFixed(2)}<br>UMAP2: ${umapData[i][1].toFixed(2)}`
                )
            };
            
            // Step 4: Create layout
            const layout = {
                title: 'UMAP Visualization',
                hovermode: 'closest',
                xaxis: {
                    title: 'UMAP 1',
                    zeroline: false
                },
                yaxis: {
                    title: 'UMAP 2',
                    zeroline: false
                },
                margin: { l: 60, r: 30, t: 40, b: 60 },
                showlegend: false
            };
            
            // Step 5: Render the plot
            container.innerHTML = ''; // Clear loading indicator
            await Plotly.newPlot(container, [plotData], layout, {
                responsive: true,
                displayModeBar: true
            });
            
            console.log("UMAP visualization created successfully");
            
        } catch (error) {
            console.error("Error creating UMAP visualization:", error);
            
            // Show error message in container
            const container = document.getElementById(containerId);
            if (container) {
                container.innerHTML = `
                    <div class="alert alert-danger">
                        <h5 class="alert-heading">Error Creating Visualization</h5>
                        <p>${error.message}</p>
                        <hr>
                        <p class="mb-0">Please check the console for more details.</p>
                    </div>
                `;
            }
        }
    }
    
    /**
     * Example: Create a gene expression visualization on UMAP
     * @param {string} containerId - ID of the HTML container element
     * @param {string} datasetPath - Path to the dataset
     * @param {string} geneName - Name of the gene to visualize
     * @returns {Promise<void>}
     */
    async function createGeneExpressionVisualization(containerId, datasetPath, geneName) {
        try {
            const container = document.getElementById(containerId);
            if (!container) {
                throw new Error(`Container element not found: ${containerId}`);
            }
            
            // Show loading indicator
            container.innerHTML = `
                <div class="text-center p-5">
                    <div class="spinner-border" role="status"></div>
                    <p class="mt-2">Loading gene expression data...</p>
                </div>
            `;
            
            // Step 1: Load UMAP coordinates
            const umapData = await loadUMAPEmbedding(datasetPath);
            
            // Step 2: Load gene expression data
            const expressionData = await loadGeneExpression(datasetPath, geneName);
            
            // Verify we have matching data lengths
            if (umapData.length !== expressionData.length) {
                throw new Error(
                    `Data length mismatch: UMAP has ${umapData.length} points, ` +
                    `expression data has ${expressionData.length} values`
                );
            }
            
            // Step 3: Create plot data
            const plotData = {
                x: umapData.map(point => point[0]),
                y: umapData.map(point => point[1]),
                mode: 'markers',
                type: 'scatter',
                marker: {
                    size: 5,
                    opacity: 0.8,
                    color: expressionData,
                    colorscale: 'Viridis',
                    colorbar: {
                        title: `${geneName} Expression`,
                        thickness: 20
                    }
                },
                hoverinfo: 'text',
                text: expressionData.map((expr, i) => 
                    `${geneName} Expression: ${expr.toFixed(2)}<br>` +
                    `UMAP1: ${umapData[i][0].toFixed(2)}<br>` +
                    `UMAP2: ${umapData[i][1].toFixed(2)}`
                )
            };
            
            // Step 4: Create layout
            const layout = {
                title: `${geneName} Expression on UMAP`,
                hovermode: 'closest',
                xaxis: {
                    title: 'UMAP 1',
                    zeroline: false
                },
                yaxis: {
                    title: 'UMAP 2',
                    zeroline: false
                },
                margin: { l: 60, r: 80, t: 40, b: 60 }
            };
            
            // Step 5: Render the plot
            container.innerHTML = ''; // Clear loading indicator
            await Plotly.newPlot(container, [plotData], layout, {
                responsive: true,
                displayModeBar: true
            });
            
            console.log(`Gene expression visualization for ${geneName} created successfully`);
            
        } catch (error) {
            console.error(`Error creating gene expression visualization for ${geneName}:`, error);
            
            // Show error message in container
            const container = document.getElementById(containerId);
            if (container) {
                container.innerHTML = `
                    <div class="alert alert-danger">
                        <h5 class="alert-heading">Error Creating Visualization</h5>
                        <p>${error.message}</p>
                        <hr>
                        <p class="mb-0">Please check the console for more details.</p>
                    </div>
                `;
            }
        }
    }
    
    /**
     * Example: Load obs column data and create a violin plot
     * @param {string} containerId - ID of the HTML container element
     * @param {string} datasetPath - Path to the dataset
     * @param {string} groupColumn - Column name for grouping (e.g., 'cell_type')
     * @param {string} valueColumn - Column name for values (e.g., 'n_genes')
     * @returns {Promise<void>}
     */
    async function createViolinPlot(containerId, datasetPath, groupColumn, valueColumn) {
        try {
            const container = document.getElementById(containerId);
            if (!container) {
                throw new Error(`Container element not found: ${containerId}`);
            }
            
            // Show loading indicator
            container.innerHTML = `
                <div class="text-center p-5">
                    <div class="spinner-border" role="status"></div>
                    <p class="mt-2">Loading data for violin plot...</p>
                </div>
            `;
            
            // Load observation data with both columns
            const obsData = await loadObservationData(datasetPath, [groupColumn, valueColumn]);
            
            // Group data by the grouping column
            const groups = {};
            for (let i = 0; i < obsData[groupColumn].length; i++) {
                const group = obsData[groupColumn][i];
                const value = obsData[valueColumn][i];
                
                if (!groups[group]) {
                    groups[group] = [];
                }
                
                groups[group].push(value);
            }
            
            // Create traces for each group
            const traces = [];
            for (const group in groups) {
                traces.push({
                    type: 'violin',
                    x: Array(groups[group].length).fill(group),
                    y: groups[group],
                    name: group,
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
                title: `${valueColumn} by ${groupColumn}`,
                xaxis: {
                    title: groupColumn
                },
                yaxis: {
                    title: valueColumn
                },
                violinmode: 'group',
                margin: { l: 60, r: 30, t: 40, b: 100 }
            };
            
            // Render the plot
            container.innerHTML = ''; // Clear loading indicator
            await Plotly.newPlot(container, traces, layout, {
                responsive: true,
                displayModeBar: true
            });
            
            console.log(`Violin plot for ${valueColumn} by ${groupColumn} created successfully`);
            
        } catch (error) {
            console.error("Error creating violin plot:", error);
            
            // Show error message in container
            const container = document.getElementById(containerId);
            if (container) {
                container.innerHTML = `
                    <div class="alert alert-danger">
                        <h5 class="alert-heading">Error Creating Violin Plot</h5>
                        <p>${error.message}</p>
                        <hr>
                        <p class="mb-0">Please check the console for more details.</p>
                    </div>
                `;
            }
        }
    }
    
    // Public API
    return {
        clearCache,
        loadDatasetInfo,
        loadUMAPEmbedding,
        loadObservationData,
        loadGeneExpression,
        createUMAPVisualization,
        createGeneExpressionVisualization,
        createViolinPlot
    };
})();

// Export as module and global
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AnnzarroAPIExamples;
} else {
    window.AnnzarroAPIExamples = AnnzarroAPIExamples;
}
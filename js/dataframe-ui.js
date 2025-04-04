/**
 * Dataframe UI Component Module
 * Handles UI components for visualizing and selecting dataframe-encoded matrices
 * - Provides UI components for selecting and visualizing dataframe columns
 * - Works with both obsm and varm dataframe-encoded matrices
 * - Integrates with existing visualization system
 */

(function() {
    /**
     * DataframeUI class
     * Manages UI components for dataframe selection and visualization
     */
    class DataframeUI {
        /**
         * Constructor
         */
        constructor() {
            this.initialized = false;
            this.eventListeners = {};
        }
        
        /**
         * Initialize the dataframe UI
         */
        initialize() {
            if (this.initialized) return;
            
            // Check dependencies
            if (!window.dataManager) {
                console.error('DataframeUI requires dataManager');
                return;
            }
            
            this.dataManager = window.dataManager;
            this.initialized = true;
            
            // Setup event listeners
            document.addEventListener('dataLoaded', this._onDataLoaded.bind(this));
            
            console.log('DataframeUI initialized');
        }
        
        /**
         * Create a component for selecting dataframe columns
         * @param {HTMLElement} container - Container element to add the component to
         * @param {Object} options - Configuration options
         * @param {string} options.type - Type of matrix ('obsm' or 'varm')
         * @param {string} options.initialMatrix - Initial matrix selection
         * @param {string} options.initialColumn - Initial column selection
         * @param {Function} options.onChange - Callback when selection changes
         * @returns {HTMLElement} The created component element
         */
        createDataframeSelector(container, options = {}) {
            if (!this.initialized) {
                console.error('DataframeUI not initialized');
                return null;
            }
            
            const type = options.type || 'obsm';
            const validTypes = ['obsm', 'varm'];
            if (!validTypes.includes(type)) {
                console.error(`Invalid matrix type: ${type}. Must be one of: ${validTypes.join(', ')}`);
                return null;
            }
            
            // Create the component container
            const componentEl = document.createElement('div');
            componentEl.className = 'dataframe-selector mb-3';
            
            // Create the matrix dropdown
            const matrixGroupEl = document.createElement('div');
            matrixGroupEl.className = 'form-group mb-2';
            
            const matrixLabelEl = document.createElement('label');
            matrixLabelEl.className = 'form-label';
            matrixLabelEl.textContent = type === 'obsm' ? 'Cell Matrix:' : 'Gene Matrix:';
            
            const matrixSelectEl = document.createElement('select');
            matrixSelectEl.className = 'form-select matrix-select';
            matrixSelectEl.id = `${type}-matrix-select-${Date.now()}`;
            
            matrixGroupEl.appendChild(matrixLabelEl);
            matrixGroupEl.appendChild(matrixSelectEl);
            
            // Create the column dropdown (initially hidden)
            const columnGroupEl = document.createElement('div');
            columnGroupEl.className = 'form-group mb-2 d-none';
            
            const columnLabelEl = document.createElement('label');
            columnLabelEl.className = 'form-label';
            columnLabelEl.textContent = 'Column:';
            
            const columnSelectEl = document.createElement('select');
            columnSelectEl.className = 'form-select column-select';
            columnSelectEl.id = `${type}-column-select-${Date.now()}`;
            
            columnGroupEl.appendChild(columnLabelEl);
            columnGroupEl.appendChild(columnSelectEl);
            
            // Add elements to component
            componentEl.appendChild(matrixGroupEl);
            componentEl.appendChild(columnGroupEl);
            
            // Add to container
            container.appendChild(componentEl);
            
            // Store elements and options for later reference
            componentEl.dataframeSelector = {
                type,
                matrixSelect: matrixSelectEl,
                columnSelect: columnSelectEl,
                columnGroup: columnGroupEl,
                options
            };
            
            // Populate the matrix dropdown
            this._populateMatrixDropdown(componentEl);
            
            // Add event listeners
            matrixSelectEl.addEventListener('change', () => {
                this._onMatrixSelectionChanged(componentEl);
            });
            
            columnSelectEl.addEventListener('change', () => {
                this._onColumnSelectionChanged(componentEl);
            });
            
            // Set initial selections if provided
            if (options.initialMatrix) {
                setTimeout(() => {
                    matrixSelectEl.value = options.initialMatrix;
                    matrixSelectEl.dispatchEvent(new Event('change'));
                    
                    if (options.initialColumn) {
                        setTimeout(() => {
                            columnSelectEl.value = options.initialColumn;
                            columnSelectEl.dispatchEvent(new Event('change'));
                        }, 100);
                    }
                }, 100);
            }
            
            return componentEl;
        }
        
        /**
         * Create a dataframe visualization panel
         * @param {string} panelId - The ID of the panel element
         * @param {Object} config - Configuration options
         * @returns {HTMLElement} The created panel element
         */
        createDataframePanel(panelId, config = {}) {
            if (!this.initialized) {
                console.error('DataframeUI not initialized');
                return null;
            }
            
            // Get the panel element
            const panelEl = document.getElementById(panelId);
            if (!panelEl) {
                console.error(`Panel element with ID "${panelId}" not found`);
                return null;
            }
            
            // Clear panel content
            panelEl.innerHTML = '';
            
            // Create header
            const headerEl = document.createElement('div');
            headerEl.className = 'panel-header';
            
            const titleEl = document.createElement('h5');
            titleEl.className = 'panel-title';
            titleEl.textContent = config.title || 'Dataframe Visualization';
            
            headerEl.appendChild(titleEl);
            
            // Create body
            const bodyEl = document.createElement('div');
            bodyEl.className = 'panel-body';
            
            // Create controls section
            const controlsEl = document.createElement('div');
            controlsEl.className = 'controls-section';
            
            // Create visualization section
            const visualizationEl = document.createElement('div');
            visualizationEl.className = 'visualization-section';
            
            // Add elements to panel
            panelEl.appendChild(headerEl);
            bodyEl.appendChild(controlsEl);
            bodyEl.appendChild(visualizationEl);
            panelEl.appendChild(bodyEl);
            
            // Create the dataframe selector
            this.createDataframeSelector(controlsEl, {
                type: config.type || 'obsm',
                initialMatrix: config.matrix,
                initialColumn: config.column,
                onChange: (selection) => {
                    this._updateDataframeVisualization(visualizationEl, selection);
                }
            });
            
            // Store configuration for later reference
            panelEl.dataframePanel = {
                config,
                visualizationEl
            };
            
            return panelEl;
        }
        
        /**
         * Add event listener
         * @param {string} event - Event name
         * @param {Function} callback - Callback function
         */
        addEventListener(event, callback) {
            if (!this.eventListeners[event]) {
                this.eventListeners[event] = [];
            }
            this.eventListeners[event].push(callback);
        }
        
        /**
         * Remove event listener
         * @param {string} event - Event name
         * @param {Function} callback - Callback to remove
         */
        removeEventListener(event, callback) {
            if (this.eventListeners[event]) {
                this.eventListeners[event] = this.eventListeners[event]
                    .filter(cb => cb !== callback);
            }
        }
        
        /**
         * Trigger an event
         * @param {string} event - Event name
         * @param {any} data - Event data
         */
        _triggerEvent(event, data) {
            if (this.eventListeners[event]) {
                this.eventListeners[event].forEach(callback => {
                    try {
                        callback(data);
                    } catch (error) {
                        console.error(`Error in ${event} event listener:`, error);
                    }
                });
            }
        }
        
        /**
         * Handle data loaded event
         * @param {Event} event - Event object
         */
        _onDataLoaded(event) {
            // Update any existing dataframe selectors
            document.querySelectorAll('.dataframe-selector').forEach(selectorEl => {
                if (selectorEl.dataframeSelector) {
                    this._populateMatrixDropdown(selectorEl);
                }
            });
            
            this._triggerEvent('dataLoaded', event.detail);
        }
        
        /**
         * Populate the matrix dropdown for a dataframe selector
         * @param {HTMLElement} selectorEl - Dataframe selector element
         */
        _populateMatrixDropdown(selectorEl) {
            const { type, matrixSelect } = selectorEl.dataframeSelector;
            
            // Get basic info from data manager
            const basicInfo = this.dataManager.getBasicInfo();
            
            // Clear existing options
            matrixSelect.innerHTML = '<option value="">Select a matrix</option>';
            
            // Get available matrices based on type
            const matrices = type === 'obsm' ? basicInfo.obsmMatrices : basicInfo.varmMatrices;
            const dataframeInfo = type === 'obsm' ? basicInfo.obsmDataframeInfo : basicInfo.varmDataframeInfo;
            
            if (!matrices || matrices.length === 0) {
                const option = document.createElement('option');
                option.disabled = true;
                option.textContent = 'No matrices available';
                matrixSelect.appendChild(option);
                return;
            }
            
            // Group matrices by type (dataframe vs regular)
            const dataframeMatrices = [];
            const regularMatrices = [];
            
            matrices.forEach(matrix => {
                const isDataframe = dataframeInfo && dataframeInfo[matrix];
                if (isDataframe) {
                    dataframeMatrices.push(matrix);
                } else {
                    regularMatrices.push(matrix);
                }
            });
            
            // Add dataframe matrices
            if (dataframeMatrices.length > 0) {
                const dataframeGroup = document.createElement('optgroup');
                dataframeGroup.label = 'Dataframe Matrices';
                
                dataframeMatrices.forEach(matrix => {
                    const option = document.createElement('option');
                    option.value = matrix;
                    option.textContent = matrix;
                    option.dataset.isDataframe = 'true';
                    dataframeGroup.appendChild(option);
                });
                
                matrixSelect.appendChild(dataframeGroup);
            }
            
            // Add regular matrices
            if (regularMatrices.length > 0) {
                const regularGroup = document.createElement('optgroup');
                regularGroup.label = 'Regular Matrices';
                
                regularMatrices.forEach(matrix => {
                    const option = document.createElement('option');
                    option.value = matrix;
                    option.textContent = matrix;
                    option.dataset.isDataframe = 'false';
                    regularGroup.appendChild(option);
                });
                
                matrixSelect.appendChild(regularGroup);
            }
        }
        
        /**
         * Handle matrix selection change
         * @param {HTMLElement} selectorEl - Dataframe selector element
         */
        async _onMatrixSelectionChanged(selectorEl) {
            const { type, matrixSelect, columnSelect, columnGroup, options } = selectorEl.dataframeSelector;
            
            // Get selected matrix
            const selectedMatrix = matrixSelect.value;
            
            // Clear column select and hide by default
            columnSelect.innerHTML = '';
            columnGroup.classList.add('d-none');
            
            if (!selectedMatrix) {
                this._notifySelectionChange(selectorEl, { matrix: null, column: null });
                return;
            }
            
            // Get selected option
            const selectedOption = matrixSelect.options[matrixSelect.selectedIndex];
            const isDataframe = selectedOption.dataset.isDataframe === 'true';
            
            // Check if this is a dataframe-encoded matrix
            let isDataframeMatrix = isDataframe;
            
            if (!isDataframeMatrix) {
                // Double-check with data manager
                isDataframeMatrix = type === 'obsm' 
                    ? this.dataManager.isObsmDataframe(selectedMatrix)
                    : this.dataManager.isVarmDataframe(selectedMatrix);
            }
            
            // If this is a dataframe, populate column dropdown
            if (isDataframeMatrix) {
                // Get columns for this dataframe
                const columns = type === 'obsm'
                    ? await this.dataManager.getObsmDataframeColumns(selectedMatrix)
                    : await this.dataManager.getVarmDataframeColumns(selectedMatrix);
                
                if (columns && columns.length > 0) {
                    // Add default option
                    const defaultOption = document.createElement('option');
                    defaultOption.value = '';
                    defaultOption.textContent = 'Select a column';
                    columnSelect.appendChild(defaultOption);
                    
                    // Add column options
                    columns.forEach(column => {
                        const option = document.createElement('option');
                        option.value = column;
                        option.textContent = column;
                        columnSelect.appendChild(option);
                    });
                    
                    // Show column dropdown
                    columnGroup.classList.remove('d-none');
                    
                    // Initial column has been set, so we notify with both
                    if (options.initialColumn && columns.includes(options.initialColumn)) {
                        columnSelect.value = options.initialColumn;
                        this._notifySelectionChange(selectorEl, { 
                            matrix: selectedMatrix, 
                            column: options.initialColumn,
                            isDataframe: true
                        });
                    } else {
                        // Just notify about matrix change
                        this._notifySelectionChange(selectorEl, { 
                            matrix: selectedMatrix, 
                            column: null,
                            isDataframe: true
                        });
                    }
                    
                    return;
                }
            }
            
            // For non-dataframe matrices or those without columns, notify with just matrix
            this._notifySelectionChange(selectorEl, { 
                matrix: selectedMatrix, 
                column: null,
                isDataframe: false
            });
        }
        
        /**
         * Handle column selection change
         * @param {HTMLElement} selectorEl - Dataframe selector element
         */
        _onColumnSelectionChanged(selectorEl) {
            const { matrixSelect, columnSelect } = selectorEl.dataframeSelector;
            
            const selectedMatrix = matrixSelect.value;
            const selectedColumn = columnSelect.value;
            
            if (!selectedMatrix) return;
            
            // Get selected option from matrix selector
            const selectedOption = matrixSelect.options[matrixSelect.selectedIndex];
            const isDataframe = selectedOption.dataset.isDataframe === 'true';
            
            this._notifySelectionChange(selectorEl, { 
                matrix: selectedMatrix, 
                column: selectedColumn,
                isDataframe
            });
        }
        
        /**
         * Notify about selection change
         * @param {HTMLElement} selectorEl - Dataframe selector element
         * @param {Object} selection - Selection details
         */
        _notifySelectionChange(selectorEl, selection) {
            const { options, type } = selectorEl.dataframeSelector;
            
            // Create full path notation
            let path = null;
            if (selection.matrix) {
                path = `${type}:${selection.matrix}`;
                if (selection.column && selection.isDataframe) {
                    path += `:${selection.column}`;
                }
            }
            
            // Add path to selection object
            selection.path = path;
            selection.type = type;
            
            // Call onChange callback if provided
            if (options.onChange && typeof options.onChange === 'function') {
                options.onChange(selection);
            }
            
            // Trigger event
            this._triggerEvent('selectionChanged', selection);
        }
        
        /**
         * Update dataframe visualization based on selection
         * @param {HTMLElement} visualizationEl - Visualization container element
         * @param {Object} selection - Selection details
         */
        async _updateDataframeVisualization(visualizationEl, selection) {
            if (!selection.matrix) {
                visualizationEl.innerHTML = '<div class="alert alert-info">Please select a matrix</div>';
                return;
            }
            
            if (selection.isDataframe && !selection.column) {
                visualizationEl.innerHTML = '<div class="alert alert-info">Please select a column</div>';
                return;
            }
            
            // Show loading indicator
            visualizationEl.innerHTML = `
                <div class="d-flex justify-content-center align-items-center" style="height: 200px;">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                </div>
            `;
            
            try {
                // Load data
                let data;
                if (selection.type === 'obsm') {
                    data = await this.dataManager.loadObsm(selection.matrix, null, selection.column);
                } else {
                    data = await this.dataManager.loadVarm(selection.matrix, null, selection.column);
                }
                
                if (!data) {
                    visualizationEl.innerHTML = '<div class="alert alert-warning">No data available</div>';
                    return;
                }
                
                // Calculate statistics for the data
                const stats = this.dataManager.calculateStats(data);
                
                // Create visualization based on data type and shape
                if (Array.isArray(data)) {
                    if (Array.isArray(data[0])) {
                        // 2D matrix data - create a heatmap
                        this._createHeatmap(visualizationEl, data, selection, stats);
                    } else {
                        // 1D array data - create a histogram
                        this._createHistogram(visualizationEl, data, selection, stats);
                    }
                } else {
                    visualizationEl.innerHTML = '<div class="alert alert-warning">Unsupported data format</div>';
                }
            } catch (error) {
                console.error('Error updating dataframe visualization:', error);
                visualizationEl.innerHTML = `
                    <div class="alert alert-danger">
                        Error loading data: ${error.message}
                    </div>
                `;
            }
        }
        
        /**
         * Create a histogram for 1D data
         * @param {HTMLElement} container - Container element
         * @param {Array} data - 1D array data
         * @param {Object} selection - Selection details
         * @param {Object} stats - Data statistics
         */
        _createHistogram(container, data, selection, stats) {
            // Make sure PlotManager is available
            if (!window.plotManager) {
                container.innerHTML = '<div class="alert alert-warning">PlotManager not available</div>';
                return;
            }
            
            const plotManager = window.plotManager;
            
            // Create container for the plot
            const plotContainer = document.createElement('div');
            plotContainer.style.width = '100%';
            plotContainer.style.height = '250px';
            
            // Create stats summary
            const statsContainer = document.createElement('div');
            statsContainer.className = 'stats-summary small text-muted mt-2';
            
            // Create raw data summary element
            const dataContainer = document.createElement('div');
            dataContainer.className = 'data-summary small mt-2';
            dataContainer.innerHTML = `
                <button class="btn btn-sm btn-outline-secondary" type="button" data-bs-toggle="collapse" 
                        data-bs-target="#dataDetails" aria-expanded="false" aria-controls="dataDetails">
                    Show Data Details
                </button>
                <div class="collapse mt-2" id="dataDetails">
                    <div class="card card-body">
                        <div class="data-values" style="max-height: 200px; overflow-y: auto;"></div>
                    </div>
                </div>
            `;
            
            // Add elements to container
            container.innerHTML = '';
            container.appendChild(plotContainer);
            container.appendChild(statsContainer);
            container.appendChild(dataContainer);
            
            // Create stats summary
            let statsHtml = '<table class="table table-sm">';
            statsHtml += '<tr><th>Statistic</th><th>Value</th></tr>';
            statsHtml += `<tr><td>Min</td><td>${stats.min.toFixed(4)}</td></tr>`;
            statsHtml += `<tr><td>Max</td><td>${stats.max.toFixed(4)}</td></tr>`;
            statsHtml += `<tr><td>Mean</td><td>${stats.mean.toFixed(4)}</td></tr>`;
            statsHtml += `<tr><td>Median</td><td>${stats.median.toFixed(4)}</td></tr>`;
            statsHtml += `<tr><td>Standard Deviation</td><td>${stats.std.toFixed(4)}</td></tr>`;
            statsHtml += `<tr><td>Zero Fraction</td><td>${(stats.zero_fraction * 100).toFixed(2)}%</td></tr>`;
            statsHtml += '</table>';
            statsContainer.innerHTML = statsHtml;
            
            // Create histogram data
            const numBins = Math.min(30, Math.ceil(Math.sqrt(data.length)));
            const binSize = (stats.max - stats.min) / numBins;
            
            const bins = Array(numBins).fill(0);
            const binEdges = Array(numBins + 1).fill(0).map((_, i) => stats.min + i * binSize);
            
            // Count values in each bin
            data.forEach(value => {
                if (value === stats.max) {
                    // Special case for maximum value, put in last bin
                    bins[numBins - 1]++;
                } else {
                    const binIndex = Math.floor((value - stats.min) / binSize);
                    if (binIndex >= 0 && binIndex < numBins) {
                        bins[binIndex]++;
                    }
                }
            });
            
            // Create plot data for histogram
            const plotData = [{
                type: 'bar',
                x: binEdges.slice(0, -1).map((edge, i) => (edge + binEdges[i + 1]) / 2),
                y: bins,
                width: binSize * 0.9,
                name: selection.column || selection.matrix
            }];
            
            // Create plot layout
            const layout = {
                title: `Distribution of ${selection.column || selection.matrix}`,
                xaxis: {
                    title: 'Value'
                },
                yaxis: {
                    title: 'Count'
                },
                bargap: 0.1,
                margin: { l: 50, r: 20, t: 30, b: 40 }
            };
            
            // Create the plot
            plotManager.createHistogram(plotContainer, plotData, layout);
            
            // Populate data details
            const dataValuesEl = dataContainer.querySelector('.data-values');
            dataValuesEl.innerHTML = `<p>First 100 values of ${data.length} total:</p>`;
            
            const valuesTable = document.createElement('table');
            valuesTable.className = 'table table-sm table-striped';
            
            const headerRow = document.createElement('tr');
            headerRow.innerHTML = '<th>#</th><th>Value</th>';
            
            const tbody = document.createElement('tbody');
            
            const maxValues = Math.min(100, data.length);
            for (let i = 0; i < maxValues; i++) {
                const row = document.createElement('tr');
                row.innerHTML = `<td>${i}</td><td>${data[i]}</td>`;
                tbody.appendChild(row);
            }
            
            valuesTable.appendChild(headerRow);
            valuesTable.appendChild(tbody);
            dataValuesEl.appendChild(valuesTable);
        }
        
        /**
         * Create a heatmap for 2D data
         * @param {HTMLElement} container - Container element
         * @param {Array<Array>} data - 2D array data
         * @param {Object} selection - Selection details
         * @param {Object} stats - Data statistics
         */
        _createHeatmap(container, data, selection, stats) {
            // Make sure PlotManager is available
            if (!window.plotManager) {
                container.innerHTML = '<div class="alert alert-warning">PlotManager not available</div>';
                return;
            }
            
            const plotManager = window.plotManager;
            
            // Create container for the plot
            const plotContainer = document.createElement('div');
            plotContainer.style.width = '100%';
            plotContainer.style.height = '300px';
            
            // Create stats summary
            const statsContainer = document.createElement('div');
            statsContainer.className = 'stats-summary small text-muted mt-2';
            
            // Add elements to container
            container.innerHTML = '';
            container.appendChild(plotContainer);
            container.appendChild(statsContainer);
            
            // Create stats summary
            let statsHtml = '<table class="table table-sm">';
            statsHtml += '<tr><th>Statistic</th><th>Value</th></tr>';
            statsHtml += `<tr><td>Shape</td><td>${data.length} x ${data[0] ? data[0].length : 0}</td></tr>`;
            statsHtml += `<tr><td>Min</td><td>${stats.min.toFixed(4)}</td></tr>`;
            statsHtml += `<tr><td>Max</td><td>${stats.max.toFixed(4)}</td></tr>`;
            statsHtml += `<tr><td>Mean</td><td>${stats.mean.toFixed(4)}</td></tr>`;
            statsHtml += `<tr><td>Median</td><td>${stats.median.toFixed(4)}</td></tr>`;
            statsHtml += `<tr><td>Zero Fraction</td><td>${(stats.zero_fraction * 100).toFixed(2)}%</td></tr>`;
            statsHtml += '</table>';
            statsContainer.innerHTML = statsHtml;
            
            // Create plot data for heatmap
            // For very large matrices, downsample to max 100x100 for performance
            let plotData = data;
            let rowLabels = Array.from({length: data.length}, (_, i) => i.toString());
            let colLabels = data[0] ? Array.from({length: data[0].length}, (_, i) => i.toString()) : [];
            
            const maxSize = 100;
            if (data.length > maxSize || (data[0] && data[0].length > maxSize)) {
                const rowStep = Math.max(1, Math.ceil(data.length / maxSize));
                const colStep = data[0] ? Math.max(1, Math.ceil(data[0].length / maxSize)) : 1;
                
                plotData = [];
                rowLabels = [];
                colLabels = [];
                
                for (let i = 0; i < data.length; i += rowStep) {
                    const row = [];
                    for (let j = 0; j < data[i].length; j += colStep) {
                        row.push(data[i][j]);
                    }
                    plotData.push(row);
                    rowLabels.push(i.toString());
                }
                
                if (data[0]) {
                    for (let j = 0; j < data[0].length; j += colStep) {
                        colLabels.push(j.toString());
                    }
                }
            }
            
            // Create the plot
            plotManager.createHeatmap(
                plotContainer, 
                plotData, 
                {
                    title: `${selection.matrix}${selection.column ? ` - ${selection.column}` : ''}`,
                    colorscale: 'Viridis',
                    showscale: true,
                    xaxis: {
                        title: selection.type === 'obsm' ? 'Features' : 'Cells'
                    },
                    yaxis: {
                        title: selection.type === 'obsm' ? 'Cells' : 'Genes'
                    },
                    margin: { l: 60, r: 60, t: 40, b: 60 }
                },
                rowLabels,
                colLabels
            );
        }
    }
    
    // Create and export a singleton instance
    const dataframeUI = new DataframeUI();
    
    // Export for both browser and Node.js environments
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = dataframeUI;
    } else if (typeof window !== 'undefined') {
        // Register with the module loader if available
        if (window.Annzarro) {
            window.Annzarro.registerModule('dataframeUI', dataframeUI);
            window.Annzarro.checkModulesReady();
        } else {
            window.dataframeUI = dataframeUI;
        }
    }
})();
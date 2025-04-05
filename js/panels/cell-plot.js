/**
 * Cell Plot Panel
 * Displays cells using data from obs, obsm, obsp, and layers
 */
const CellPlotPanel = (function() {
    /**
     * Cell Plot Panel constructor
     * @param {HTMLElement} container - Container element
     * @param {Object} options - Panel options
     */
    function CellPlotPanel(container, options = {}) {
        // Private variables
        const _id = options.id || `cell-plot-${Date.now()}`;
        let _title = options.title || 'Cell Plot';
        const _container = container;
        let _plotContainer = null;
        let _controlsContainer = null;
        let _plot = null;
        
        // Plot settings
        const _settings = {
            x: options.x || { type: 'obsm', key: 'X_umap', column: '0' },
            y: options.y || { type: 'obsm', key: 'X_umap', column: '1' },
            z: options.z || null, // Optional for 3D plots
            color: options.color || { type: 'obs', key: 'cell_type' },
            pointSize: options.pointSize || Config.DEFAULTS.POINT_SIZE,
            pointOpacity: options.pointOpacity || Config.DEFAULTS.POINT_OPACITY,
            colorScale: options.colorScale || Config.DEFAULTS.COLOR_SCALE,
            colorMin: options.colorMin || null,
            colorMax: options.colorMax || null,
            hoverInfo: options.hoverInfo || [{ type: 'obs', key: '_index' }],
            subsettedCells: options.subsettedCells || null,
            hideNonSubset: options.hideNonSubset || false
        };
        
        // Cached data
        let _data = {
            x: null,
            y: null,
            z: null,
            color: null
        };
        
        /**
         * Initialize the panel
         */
        function init() {
            // Create panel structure
            _createPanelStructure();
            
            // Set up event listeners
            _setupEventListeners();
            
            // Load data and create plot
            _loadDataAndCreatePlot();
        }
        
        /**
         * Create panel DOM structure
         * @private
         */
        function _createPanelStructure() {
            _container.innerHTML = `
                <div class="plot-panel">
                    <div class="plot-controls">
                        <div class="axis-selector-container">
                            <div class="axis-selector-label">X-Axis</div>
                            <div class="axis-selector">
                                <select class="form-select form-select-sm axis-type-select" data-axis="x">
                                    <option value="obs">obs</option>
                                    <option value="obsm" selected>obsm</option>
                                    <option value="obsp">obsp</option>
                                    <option value="layer">layer</option>
                                </select>
                                <select class="form-select form-select-sm axis-key-select" data-axis="x"></select>
                                <select class="form-select form-select-sm axis-column-select" data-axis="x"></select>
                            </div>
                        </div>
                        
                        <div class="axis-selector-container">
                            <div class="axis-selector-label">Y-Axis</div>
                            <div class="axis-selector">
                                <select class="form-select form-select-sm axis-type-select" data-axis="y">
                                    <option value="obs">obs</option>
                                    <option value="obsm" selected>obsm</option>
                                    <option value="obsp">obsp</option>
                                    <option value="layer">layer</option>
                                </select>
                                <select class="form-select form-select-sm axis-key-select" data-axis="y"></select>
                                <select class="form-select form-select-sm axis-column-select" data-axis="y"></select>
                            </div>
                        </div>
                        
                        <div class="axis-selector-container" id="z-axis-container-${_id}" style="display:none;">
                            <div class="axis-selector-label">Z-Axis (3D)</div>
                            <div class="axis-selector">
                                <select class="form-select form-select-sm axis-type-select" data-axis="z">
                                    <option value="obs">obs</option>
                                    <option value="obsm" selected>obsm</option>
                                    <option value="obsp">obsp</option>
                                    <option value="layer">layer</option>
                                </select>
                                <select class="form-select form-select-sm axis-key-select" data-axis="z"></select>
                                <select class="form-select form-select-sm axis-column-select" data-axis="z"></select>
                            </div>
                        </div>
                        
                        <div class="color-selector-container">
                            <div class="axis-selector-label">Color</div>
                            <div class="axis-selector">
                                <select class="form-select form-select-sm axis-type-select" data-axis="color">
                                    <option value="obs" selected>obs</option>
                                    <option value="obsm">obsm</option>
                                    <option value="obsp">obsp</option>
                                    <option value="layer">layer</option>
                                </select>
                                <select class="form-select form-select-sm axis-key-select" data-axis="color"></select>
                                <select class="form-select form-select-sm axis-column-select" data-axis="color"></select>
                            </div>
                            
                            <div class="color-options mt-2">
                                <div class="form-check form-check-inline">
                                    <input class="form-check-input" type="checkbox" id="z-axis-toggle-${_id}">
                                    <label class="form-check-label" for="z-axis-toggle-${_id}">3D Plot</label>
                                </div>
                                
                                <div class="point-controls">
                                    <div class="point-size-control">
                                        <label>Size:</label>
                                        <input type="range" class="form-range" min="1" max="20" value="${_settings.pointSize}" id="point-size-${_id}">
                                    </div>
                                    <div class="point-opacity-control">
                                        <label>Opacity:</label>
                                        <input type="range" class="form-range" min="0.1" max="1" step="0.1" value="${_settings.pointOpacity}" id="point-opacity-${_id}">
                                    </div>
                                </div>
                                
                                <div class="color-range-controls" id="color-range-container-${_id}" style="display:none;">
                                    <label>Color Range:</label>
                                    <select class="form-select form-select-sm color-palette-selector" id="color-scale-${_id}">
                                        ${Config.DEFAULTS.COLOR_SCALES.map(scale => 
                                            `<option value="${scale}" ${scale === _settings.colorScale ? 'selected' : ''}>${scale}</option>`
                                        ).join('')}
                                    </select>
                                    <input type="number" class="form-control form-control-sm" placeholder="Min" id="color-min-${_id}">
                                    <input type="number" class="form-control form-control-sm" placeholder="Max" id="color-max-${_id}">
                                    <div class="form-check form-check-inline">
                                        <input class="form-check-input" type="checkbox" id="hide-outliers-${_id}">
                                        <label class="form-check-label" for="hide-outliers-${_id}">Hide Outliers</label>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="plot-container" id="plot-container-${_id}"></div>
                </div>
            `;
            
            _plotContainer = document.getElementById(`plot-container-${_id}`);
            _controlsContainer = _container.querySelector('.plot-controls');
            
            // Setup initial UI state
            _initializeUIState();
        }
        
        /**
         * Initialize UI controls to match settings
         * @private
         */
        function _initializeUIState() {
            // Set initial axis selectors
            _setupAxisSelector('x', _settings.x);
            _setupAxisSelector('y', _settings.y);
            if (_settings.z) {
                document.getElementById(`z-axis-toggle-${_id}`).checked = true;
                document.getElementById(`z-axis-container-${_id}`).style.display = 'block';
                _setupAxisSelector('z', _settings.z);
            }
            
            // Set color selector
            _setupAxisSelector('color', _settings.color);
            
            // Setup point controls
            document.getElementById(`point-size-${_id}`).value = _settings.pointSize;
            document.getElementById(`point-opacity-${_id}`).value = _settings.pointOpacity;
            
            // Setup color range if numerical
            if (_settings.color.isNumerical) {
                document.getElementById(`color-range-container-${_id}`).style.display = 'flex';
                document.getElementById(`color-scale-${_id}`).value = _settings.colorScale;
                
                if (_settings.colorMin !== null) {
                    document.getElementById(`color-min-${_id}`).value = _settings.colorMin;
                }
                
                if (_settings.colorMax !== null) {
                    document.getElementById(`color-max-${_id}`).value = _settings.colorMax;
                }
            }
        }
        
        /**
         * Set up axis selector with correct values
         * @param {string} axis - Axis name (x, y, z, color)
         * @param {Object} settings - Axis settings
         * @private
         */
        function _setupAxisSelector(axis, settings) {
            const typeSelect = _container.querySelector(`.axis-type-select[data-axis="${axis}"]`);
            const keySelect = _container.querySelector(`.axis-key-select[data-axis="${axis}"]`);
            const columnSelect = _container.querySelector(`.axis-column-select[data-axis="${axis}"]`);
            
            if (!typeSelect || !keySelect || !columnSelect) return;
            
            // Set type
            typeSelect.value = settings.type;
            
            // Populate key select based on type
            _populateKeySelect(settings.type, keySelect).then(() => {
                keySelect.value = settings.key;
                
                // Populate column select based on key
                _populateColumnSelect(settings.type, settings.key, columnSelect).then(() => {
                    if (settings.column) {
                        columnSelect.value = settings.column;
                    }
                });
            });
        }
        
        /**
         * Populate key select options based on data type
         * @param {string} type - Data type (obs, obsm, obsp, layer)
         * @param {HTMLSelectElement} select - Select element to populate
         * @returns {Promise} - Resolves when done
         * @private
         */
        async function _populateKeySelect(type, select) {
            select.innerHTML = '<option value="">Loading...</option>';
            
            const datasetStructure = DataManager.getDatasetStructure();
            if (!datasetStructure) {
                select.innerHTML = '<option value="">No dataset loaded</option>';
                return Promise.resolve();
            }
            
            let options = [];
            
            switch (type) {
                case 'obs':
                    if (datasetStructure.obs && datasetStructure.obs.columns) {
                        options = datasetStructure.obs.columns.map(col => 
                            `<option value="${col}">${col}</option>`
                        );
                    }
                    break;
                case 'obsm':
                    if (datasetStructure.obsm && datasetStructure.obsm.keys) {
                        options = datasetStructure.obsm.keys.map(key => 
                            `<option value="${key}">${key}</option>`
                        );
                    }
                    break;
                case 'obsp':
                    if (datasetStructure.obsp && datasetStructure.obsp.keys) {
                        options = datasetStructure.obsp.keys.map(key => 
                            `<option value="${key}">${key}</option>`
                        );
                    }
                    break;
                case 'layer':
                    if (datasetStructure.layers && datasetStructure.layers.keys) {
                        options = datasetStructure.layers.keys.map(key => 
                            `<option value="${key}">${key}</option>`
                        );
                    }
                    break;
            }
            
            select.innerHTML = options.length 
                ? options.join('') 
                : '<option value="">No options available</option>';
            
            return Promise.resolve();
        }
        
        /**
         * Populate column select options based on key
         * @param {string} type - Data type (obs, obsm, obsp, layer)
         * @param {string} key - Selected key
         * @param {HTMLSelectElement} select - Select element to populate
         * @returns {Promise} - Resolves when done
         * @private
         */
        async function _populateColumnSelect(type, key, select) {
            if (!key) {
                select.innerHTML = '<option value="">Select key first</option>';
                select.disabled = true;
                return Promise.resolve();
            }
            
            select.disabled = false;
            select.innerHTML = '<option value="">Loading...</option>';
            
            const datasetStructure = DataManager.getDatasetStructure();
            if (!datasetStructure) {
                select.innerHTML = '<option value="">No dataset loaded</option>';
                return Promise.resolve();
            }
            
            let options = [];
            
            switch (type) {
                case 'obs':
                    // For obs, column selection is not needed
                    select.innerHTML = '<option value="">N/A</option>';
                    select.disabled = true;
                    break;
                    
                case 'obsm':
                    try {
                        // Check if this obsm matrix has known columns
                        const isArray = datasetStructure.obsm.info && 
                                       datasetStructure.obsm.info[key] && 
                                       (datasetStructure.obsm.info[key].type === 'array' ||
                                        !datasetStructure.obsm.info[key].column_info);
                        
                        if (isArray) {
                            // For array-based obsm, generate columns as indices
                            const shape = datasetStructure.obsm.info[key].shape;
                            if (shape && shape.length > 1) {
                                const columnCount = shape[1];
                                for (let i = 0; i < columnCount; i++) {
                                    options.push(`<option value="${i}">${i}</option>`);
                                }
                            }
                        } else {
                            // For dataframe-encoded obsm, get actual column names
                            // Use API to get columns for this obsm key
                            const response = await fetch(
                                `${Config.API.OBSM}_dataframe_columns?dataset_path=${encodeURIComponent(DataManager.getCurrentDataset())}&key=${encodeURIComponent(key)}`
                            );
                            const data = await response.json();
                            
                            if (data.columns && data.columns.length) {
                                options = data.columns.map(col => 
                                    `<option value="${col}">${col}</option>`
                                );
                            }
                        }
                    } catch (error) {
                        console.error('Error loading obsm columns:', error);
                    }
                    break;
                    
                case 'obsp':
                    // For obsp, column selection requires focusing on a cell
                    const focusedCell = DataManager.getFocusedCell();
                    if (focusedCell) {
                        options.push(`<option value="${focusedCell}">Connections to ${focusedCell}</option>`);
                    } else {
                        options.push('<option value="">Select a focused cell first</option>');
                    }
                    break;
                    
                case 'layer':
                    // For layers, column selection requires focusing on a gene
                    const focusedGene = DataManager.getFocusedGene();
                    if (focusedGene) {
                        options.push(`<option value="${focusedGene}">Expression of ${focusedGene}</option>`);
                    } else {
                        options.push('<option value="">Select a focused gene first</option>');
                    }
                    break;
            }
            
            select.innerHTML = options.length 
                ? options.join('') 
                : '<option value="">No options available</option>';
            
            return Promise.resolve();
        }
        
        /**
         * Set up event listeners
         * @private
         */
        function _setupEventListeners() {
            // Axis type selectors
            _container.querySelectorAll('.axis-type-select').forEach(select => {
                select.addEventListener('change', (e) => {
                    const axis = e.target.dataset.axis;
                    const type = e.target.value;
                    const keySelect = _container.querySelector(`.axis-key-select[data-axis="${axis}"]`);
                    const columnSelect = _container.querySelector(`.axis-column-select[data-axis="${axis}"]`);
                    
                    _settings[axis].type = type;
                    
                    // Update key options
                    _populateKeySelect(type, keySelect).then(() => {
                        if (keySelect.options.length > 0) {
                            keySelect.selectedIndex = 0;
                            _settings[axis].key = keySelect.value;
                            
                            // Update column options
                            _populateColumnSelect(type, keySelect.value, columnSelect).then(() => {
                                if (columnSelect.options.length > 0) {
                                    columnSelect.selectedIndex = 0;
                                    _settings[axis].column = columnSelect.value;
                                    
                                    // Update plot
                                    _loadDataAndCreatePlot();
                                }
                            });
                        }
                    });
                });
            });
            
            // Axis key selectors
            _container.querySelectorAll('.axis-key-select').forEach(select => {
                select.addEventListener('change', (e) => {
                    const axis = e.target.dataset.axis;
                    const key = e.target.value;
                    const type = _container.querySelector(`.axis-type-select[data-axis="${axis}"]`).value;
                    const columnSelect = _container.querySelector(`.axis-column-select[data-axis="${axis}"]`);
                    
                    _settings[axis].key = key;
                    
                    // Update column options
                    _populateColumnSelect(type, key, columnSelect).then(() => {
                        if (columnSelect.options.length > 0) {
                            columnSelect.selectedIndex = 0;
                            _settings[axis].column = columnSelect.value;
                            
                            // Update plot
                            _loadDataAndCreatePlot();
                        }
                    });
                });
            });
            
            // Axis column selectors
            _container.querySelectorAll('.axis-column-select').forEach(select => {
                select.addEventListener('change', (e) => {
                    const axis = e.target.dataset.axis;
                    _settings[axis].column = e.target.value;
                    
                    // Update plot
                    _loadDataAndCreatePlot();
                });
            });
            
            // 3D plot toggle
            const zAxisToggle = document.getElementById(`z-axis-toggle-${_id}`);
            zAxisToggle.addEventListener('change', (e) => {
                const zAxisContainer = document.getElementById(`z-axis-container-${_id}`);
                
                if (e.target.checked) {
                    zAxisContainer.style.display = 'block';
                    
                    // Initialize z-axis if not already set
                    if (!_settings.z) {
                        _settings.z = { 
                            type: 'obsm', 
                            key: _settings.x.key, // Default to same key as x-axis
                            column: '2' // Default to third component
                        };
                        
                        _setupAxisSelector('z', _settings.z);
                    }
                } else {
                    zAxisContainer.style.display = 'none';
                    _settings.z = null;
                    
                    // Update plot
                    _loadDataAndCreatePlot();
                }
            });
            
            // Point size slider
            const pointSizeSlider = document.getElementById(`point-size-${_id}`);
            pointSizeSlider.addEventListener('input', (e) => {
                _settings.pointSize = parseFloat(e.target.value);
                _updatePlot();
            });
            
            // Point opacity slider
            const pointOpacitySlider = document.getElementById(`point-opacity-${_id}`);
            pointOpacitySlider.addEventListener('input', (e) => {
                _settings.pointOpacity = parseFloat(e.target.value);
                _updatePlot();
            });
            
            // Color scale selector
            const colorScaleSelect = document.getElementById(`color-scale-${_id}`);
            colorScaleSelect.addEventListener('change', (e) => {
                _settings.colorScale = e.target.value;
                _updatePlot();
            });
            
            // Color range inputs
            const colorMinInput = document.getElementById(`color-min-${_id}`);
            colorMinInput.addEventListener('change', (e) => {
                _settings.colorMin = e.target.value !== '' ? parseFloat(e.target.value) : null;
                _updatePlot();
            });
            
            const colorMaxInput = document.getElementById(`color-max-${_id}`);
            colorMaxInput.addEventListener('change', (e) => {
                _settings.colorMax = e.target.value !== '' ? parseFloat(e.target.value) : null;
                _updatePlot();
            });
            
            // Hide outliers toggle
            const hideOutliersToggle = document.getElementById(`hide-outliers-${_id}`);
            hideOutliersToggle.addEventListener('change', (e) => {
                _settings.hideOutliers = e.target.checked;
                _updatePlot();
            });
            
            // Listen for focused cell changes
            document.addEventListener('focusedCellChanged', (e) => {
                // Update if using obsp data
                if (_settings.x.type === 'obsp' || 
                    _settings.y.type === 'obsp' || 
                    (_settings.z && _settings.z.type === 'obsp') ||
                    _settings.color.type === 'obsp') {
                    _loadDataAndCreatePlot();
                }
            });
            
            // Listen for focused gene changes
            document.addEventListener('focusedGeneChanged', (e) => {
                // Update if using layer data
                if (_settings.x.type === 'layer' || 
                    _settings.y.type === 'layer' || 
                    (_settings.z && _settings.z.type === 'layer') ||
                    _settings.color.type === 'layer') {
                    _loadDataAndCreatePlot();
                }
            });
        }
        
        /**
         * Load data based on current settings and create the plot
         * @private
         */
        async function _loadDataAndCreatePlot() {
            try {
                const cells = DataManager.getCells();
                if (!cells || !cells.length) {
                    _plotContainer.innerHTML = '<div class="alert alert-warning">No cells available</div>';
                    return;
                }
                
                // Show loading indicator
                _plotContainer.innerHTML = '<div class="spinner"></div> Loading plot data...';
                
                // Reset cached data
                _data = {
                    x: null,
                    y: null,
                    z: null,
                    color: null,
                    cells: cells
                };
                
                // Determine if we should load cell subsets
                let filteredCellIndices = null;
                if (_settings.subsettedCells && _settings.hideNonSubset) {
                    filteredCellIndices = _settings.subsettedCells.map(cell => DataManager.getCellIndex(cell));
                }
                
                // Load X-axis data
                _data.x = await _loadAxisData('x', filteredCellIndices);
                
                // Load Y-axis data
                _data.y = await _loadAxisData('y', filteredCellIndices);
                
                // Load Z-axis data if needed
                if (_settings.z) {
                    _data.z = await _loadAxisData('z', filteredCellIndices);
                }
                
                // Load color data
                const colorData = await _loadAxisData('color', filteredCellIndices);
                _data.color = colorData.values;
                _data.colorType = colorData.type;
                _data.colorCategories = colorData.categories;
                
                // Create plot
                _createPlot();
                
            } catch (error) {
                console.error('Error loading plot data:', error);
                _plotContainer.innerHTML = `<div class="alert alert-danger">Error loading data: ${error.message}</div>`;
            }
        }
        
        /**
         * Load data for a specific axis
         * @param {string} axis - Axis name (x, y, z, color)
         * @param {Array<number>} filteredIndices - Optional indices to filter data
         * @returns {Promise<Object>} - Axis data
         * @private
         */
        async function _loadAxisData(axis, filteredIndices = null) {
            const settings = _settings[axis];
            if (!settings) {
                throw new Error(`No settings found for ${axis} axis`);
            }
            
            const { type, key, column } = settings;
            const datasetPath = DataManager.getCurrentDataset();
            
            // Determine rows parameter based on filtered indices
            const rows = filteredIndices ? filteredIndices.join(',') : null;
            
            let data;
            let values;
            let dataType;
            let categories = null;
            
            try {
                switch (type) {
                    case 'obs':
                        // Load cell annotations
                        data = await DataManager.loadObs({
                            datasetPath,
                            columns: [key],
                            rows: rows ? rows.split(',') : null
                        });
                        
                        values = data.data[key];
                        
                        // Check if categorical
                        if (data.categories && data.categories[key]) {
                            dataType = 'categorical';
                            categories = data.categories[key];
                        } else {
                            dataType = Array.isArray(values) && typeof values[0] === 'number' ? 'numerical' : 'string';
                        }
                        break;
                        
                    case 'obsm':
                        // Load cell embeddings or arrays
                        data = await DataManager.loadObsm({
                            datasetPath,
                            obsmKey: key,
                            columnName: column,
                            rows: rows ? rows.split(',') : null
                        });
                        
                        values = data.data;
                        dataType = 'numerical';
                        break;
                        
                    case 'obsp':
                        // Load cell-cell relationships
                        const focusedCell = DataManager.getFocusedCell();
                        if (!focusedCell) {
                            throw new Error('No focused cell selected');
                        }
                        
                        const focusedCellIndex = DataManager.getCellIndex(focusedCell);
                        if (focusedCellIndex === -1) {
                            throw new Error('Focused cell not found in dataset');
                        }
                        
                        data = await DataManager.loadObsp({
                            datasetPath,
                            obspKey: key,
                            rows: [focusedCellIndex]
                        });
                        
                        values = data.data[0]; // Row for focused cell
                        dataType = 'numerical';
                        break;
                        
                    case 'layer':
                        // Load expression layer
                        const focusedGene = DataManager.getFocusedGene();
                        if (!focusedGene) {
                            throw new Error('No focused gene selected');
                        }
                        
                        const focusedGeneIndex = DataManager.getGeneIndex(focusedGene);
                        if (focusedGeneIndex === -1) {
                            throw new Error('Focused gene not found in dataset');
                        }
                        
                        data = await DataManager.loadLayer({
                            datasetPath,
                            layerName: key,
                            rows: rows ? rows.split(',') : null,
                            cols: [focusedGeneIndex]
                        });
                        
                        values = data.data.map(row => row[0]); // Single column for focused gene
                        dataType = 'numerical';
                        break;
                        
                    default:
                        throw new Error(`Unknown data type: ${type}`);
                }
                
                return {
                    values,
                    type: dataType,
                    categories
                };
                
            } catch (error) {
                console.error(`Error loading ${axis} axis data:`, error);
                throw error;
            }
        }
        
        /**
         * Create plot using loaded data
         * @private
         */
        function _createPlot() {
            if (!_data.x || !_data.y) {
                _plotContainer.innerHTML = '<div class="alert alert-warning">Insufficient data for plotting</div>';
                return;
            }
            
            // Prepare plot data
            const trace = {
                type: _settings.z ? 'scatter3d' : 'scattergl',
                mode: 'markers',
                x: _data.x.values,
                y: _data.y.values,
                text: _data.cells,
                hovertemplate: '%{text}<br>x: %{x}<br>y: %{y}' + (_settings.z ? '<br>z: %{z}' : '') + '<extra></extra>',
                marker: {
                    size: _settings.pointSize,
                    opacity: _settings.pointOpacity
                }
            };
            
            // Add z-axis if 3D plot
            if (_settings.z && _data.z) {
                trace.z = _data.z.values;
            }
            
            // Set colors based on color data type
            if (_data.colorType === 'categorical') {
                // Categorical coloring
                trace.marker.color = _data.color;
                
                // Use custom color palette if available from uns
                const datasetStructure = DataManager.getDatasetStructure();
                const colorKey = `${_settings.color.key}_colors`;
                let customColors = null;
                
                if (datasetStructure && 
                    datasetStructure.uns && 
                    datasetStructure.uns.structure && 
                    datasetStructure.uns.structure[colorKey]) {
                    
                    // Attempt to load custom colors from uns
                    try {
                        // This would require a separate API call in a real implementation
                        // For now, we'll just use Plotly's default colors
                    } catch (error) {
                        console.warn('Unable to load custom colors:', error);
                    }
                }
                
            } else if (_data.colorType === 'numerical') {
                // Numerical coloring
                trace.marker.color = _data.color;
                trace.marker.colorscale = _settings.colorScale;
                
                // Set color range if specified
                if (_settings.colorMin !== null || _settings.colorMax !== null) {
                    const cmin = _settings.colorMin !== null ? _settings.colorMin : Math.min(..._data.color);
                    const cmax = _settings.colorMax !== null ? _settings.colorMax : Math.max(..._data.color);
                    
                    trace.marker.cmin = cmin;
                    trace.marker.cmax = cmax;
                    
                    // Filter out points outside range if hideOutliers is true
                    if (_settings.hideOutliers) {
                        const indices = [];
                        for (let i = 0; i < _data.color.length; i++) {
                            if (_data.color[i] >= cmin && _data.color[i] <= cmax) {
                                indices.push(i);
                            }
                        }
                        
                        // Filter all data arrays by indices
                        trace.x = indices.map(i => trace.x[i]);
                        trace.y = indices.map(i => trace.y[i]);
                        trace.text = indices.map(i => trace.text[i]);
                        trace.marker.color = indices.map(i => trace.marker.color[i]);
                        
                        if (trace.z) {
                            trace.z = indices.map(i => trace.z[i]);
                        }
                    }
                }
                
                // Add colorbar
                trace.marker.colorbar = {
                    title: `${_settings.color.type}.${_settings.color.key}` +
                          (_settings.color.column ? `.${_settings.color.column}` : '')
                };
            }
            
            // Create layout
            const layout = {
                autosize: true,
                margin: { l: 40, r: 40, t: 40, b: 40 },
                hovermode: 'closest',
                xaxis: {
                    title: `${_settings.x.type}.${_settings.x.key}` +
                           (_settings.x.column ? `.${_settings.x.column}` : '')
                },
                yaxis: {
                    title: `${_settings.y.type}.${_settings.y.key}` +
                           (_settings.y.column ? `.${_settings.y.column}` : '')
                }
            };
            
            // Add z-axis title for 3D plots
            if (_settings.z) {
                layout.scene = {
                    xaxis: { title: layout.xaxis.title },
                    yaxis: { title: layout.yaxis.title },
                    zaxis: {
                        title: `${_settings.z.type}.${_settings.z.key}` +
                               (_settings.z.column ? `.${_settings.z.column}` : '')
                    }
                };
                
                // Remove 2D axis titles for 3D plots
                delete layout.xaxis;
                delete layout.yaxis;
            }
            
            // Apply subset coloring if needed but not hiding
            if (_settings.subsettedCells && !_settings.hideNonSubset) {
                // Create a new array with all cells
                const allCells = DataManager.getCells();
                const allX = [];
                const allY = [];
                const allZ = _settings.z ? [] : null;
                const allText = [];
                
                // Create subset index lookup for efficient checking
                const subsetLookup = new Set(_settings.subsettedCells);
                const colors = [];
                
                // Load full data for all cells
                // ... (would need to load all axis data here)
                
                // Create two traces - one for subset and one for rest
                // ... (would implement this in a real application)
            }
            
            // Create the plot
            Plotly.newPlot(_plotContainer, [trace], layout, {
                responsive: true,
                displayModeBar: true,
                displaylogo: false,
                modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d']
            });
            
            // Set up click handler to set focused cell
            _plotContainer.on('plotly_click', (data) => {
                const pointIndex = data.points[0].pointIndex;
                const cellName = _data.cells[pointIndex];
                
                if (cellName) {
                    DataManager.setFocusedCell(cellName);
                }
            });
            
            // Store plot reference
            _plot = _plotContainer;
            
            // Show color range controls if numerical
            const colorRangeContainer = document.getElementById(`color-range-container-${_id}`);
            if (_data.colorType === 'numerical') {
                colorRangeContainer.style.display = 'flex';
                
                // Set min/max input defaults if not already set
                const colorMinInput = document.getElementById(`color-min-${_id}`);
                const colorMaxInput = document.getElementById(`color-max-${_id}`);
                
                if (colorMinInput.value === '') {
                    colorMinInput.placeholder = Math.min(..._data.color).toFixed(2);
                }
                
                if (colorMaxInput.value === '') {
                    colorMaxInput.placeholder = Math.max(..._data.color).toFixed(2);
                }
            } else {
                colorRangeContainer.style.display = 'none';
            }
        }
        
        /**
         * Update plot with current settings
         * @private
         */
        function _updatePlot() {
            if (!_plot) return;
            
            // Update marker properties
            const update = {
                'marker.size': _settings.pointSize,
                'marker.opacity': _settings.pointOpacity
            };
            
            // Update color scale for numerical data
            if (_data.colorType === 'numerical') {
                update['marker.colorscale'] = _settings.colorScale;
                
                // Update color range if specified
                if (_settings.colorMin !== null || _settings.colorMax !== null) {
                    const cmin = _settings.colorMin !== null ? _settings.colorMin : Math.min(..._data.color);
                    const cmax = _settings.colorMax !== null ? _settings.colorMax : Math.max(..._data.color);
                    
                    update['marker.cmin'] = cmin;
                    update['marker.cmax'] = cmax;
                    
                    // If hideOutliers changed, we need to reload the plot
                    if (_plot.data[0].marker.cmin !== cmin || 
                        _plot.data[0].marker.cmax !== cmax || 
                        (_settings.hideOutliers && (_plot.data[0].x.length === _data.x.values.length))) {
                        _loadDataAndCreatePlot();
                        return;
                    }
                }
            }
            
            // Apply updates
            Plotly.update(_plotContainer, update, {}, [0]);
        }
        
        /**
         * Handle data updates from other components
         * @param {string} updateType - Type of update
         * @param {Object} data - Update data
         */
        function onDataUpdate(updateType, data) {
            switch (updateType) {
                case 'cellSubset':
                    // Update subset settings
                    _settings.subsettedCells = data.cells;
                    _settings.hideNonSubset = data.hideOthers || false;
                    _loadDataAndCreatePlot();
                    break;
                    
                case 'datasetChanged':
                    // Reset and reload
                    _loadDataAndCreatePlot();
                    break;
            }
        }
        
        /**
         * Clean up resources
         */
        function cleanup() {
            // Remove event listeners
            if (_plot) {
                Plotly.purge(_plotContainer);
            }
            
            // Clear container
            _container.innerHTML = '';
        }
        
        /**
         * Get panel ID
         * @returns {string} - Panel ID
         */
        function getId() {
            return _id;
        }
        
        /**
         * Get panel title
         * @returns {string} - Panel title
         */
        function getTitle() {
            return _title;
        }
        
        /**
         * Set panel title
         * @param {string} title - New title
         */
        function setTitle(title) {
            _title = title;
        }
        
        /**
         * Get panel type
         * @returns {string} - Panel type
         */
        function getType() {
            return 'cell-plot';
        }
        
        /**
         * Get panel configuration
         * @returns {Object} - Panel configuration
         */
        function getConfig() {
            return {
                title: _title,
                ..._settings
            };
        }
        
        // Public API
        return {
            init,
            cleanup,
            onDataUpdate,
            getId,
            getTitle,
            setTitle,
            getType,
            getConfig
        };
    }
    
    // Register this panel type with the PanelManager
    setTimeout(() => {
        if (window.PanelManager) {
            window.PanelManager.registerPanelType('cell-plot', CellPlotPanel);
        }
    }, 0);
    
    return CellPlotPanel;
})();

// Make available for both browser global and CommonJS environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CellPlotPanel;
} else {
    window.CellPlotPanel = CellPlotPanel;
}
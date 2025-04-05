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
        
        // Initialize settings with initial default options
        const _settings = {
            x: { type: 'obsm', key: 'X_umap', column: '0' },
            y: { type: 'obsm', key: 'X_umap', column: '1' },
            z: null, // Optional for 3D plots
            color: { type: 'none', key: '', column: '' }, // Start with no coloring
            pointSize: Config.DEFAULTS.POINT_SIZE,
            pointOpacity: Config.DEFAULTS.POINT_OPACITY,
            colorScale: Config.DEFAULTS.COLOR_SCALE,
            categoryPalette: 'uns', // Default to using colors from uns if available
            colorMin: null,
            colorMax: null,
            hoverInfo: [{ type: 'obs', key: '_index' }],
            subsettedCells: null,
            hideNonSubset: false
        };
        
        // Override with provided options, if any
        if (options.x) _settings.x = options.x;
        if (options.y) _settings.y = options.y;
        if (options.z) _settings.z = options.z;
        if (options.color) _settings.color = options.color;
        if (options.pointSize) _settings.pointSize = options.pointSize;
        if (options.pointOpacity) _settings.pointOpacity = options.pointOpacity;
        if (options.colorScale) _settings.colorScale = options.colorScale;
        if (options.categoryPalette) _settings.categoryPalette = options.categoryPalette;
        if (options.colorMin !== undefined) _settings.colorMin = options.colorMin;
        if (options.colorMax !== undefined) _settings.colorMax = options.colorMax;
        if (options.hoverInfo) _settings.hoverInfo = options.hoverInfo;
        if (options.subsettedCells) _settings.subsettedCells = options.subsettedCells;
        if (options.hideNonSubset !== undefined) _settings.hideNonSubset = options.hideNonSubset;
        
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
            
            // Initialize UI state and then load data
            console.log('Initializing UI state...');
            _initializeUIState().then(() => {
                console.log('UI state initialized, loading data...');
                // Load data and create plot
                _loadDataAndCreatePlot();
            }).catch(error => {
                console.error('Error initializing UI state:', error);
                _plotContainer.innerHTML = `<div class="alert alert-danger">
                    Error initializing panel: ${error.message}
                </div>`;
            });
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
                                    <option value="none">None (constant)</option>
                                    <option value="obs">obs</option>
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
                                    <label class="numerical-color-label">Color Range:</label>
                                    <label class="categorical-color-label" style="display:none;">Color Palette:</label>
                                    <select class="form-select form-select-sm color-palette-selector" id="color-scale-${_id}">
                                        ${Config.DEFAULTS.COLOR_SCALES.map(scale => 
                                            `<option value="${scale}" ${scale === _settings.colorScale ? 'selected' : ''}>${scale}</option>`
                                        ).join('')}
                                    </select>
                                    <select class="form-select form-select-sm category-palette-selector" id="category-palette-${_id}" style="display:none;">
                                        <option value="uns" ${_settings.categoryPalette === 'uns' ? 'selected' : ''}>From Dataset (if available)</option>
                                        <option value="default" ${_settings.categoryPalette === 'default' ? 'selected' : ''}>Default</option>
                                        <option value="G10" ${_settings.categoryPalette === 'G10' ? 'selected' : ''}>Category10</option>
                                        <option value="Alphabet" ${_settings.categoryPalette === 'Alphabet' ? 'selected' : ''}>Alphabet</option>
                                        <option value="Dark2" ${_settings.categoryPalette === 'Dark2' ? 'selected' : ''}>Dark2</option>
                                        <option value="Pastel1" ${_settings.categoryPalette === 'Pastel1' ? 'selected' : ''}>Pastel1</option>
                                        <option value="Set1" ${_settings.categoryPalette === 'Set1' ? 'selected' : ''}>Set1</option>
                                        <option value="Set2" ${_settings.categoryPalette === 'Set2' ? 'selected' : ''}>Set2</option>
                                        <option value="Paired" ${_settings.categoryPalette === 'Paired' ? 'selected' : ''}>Paired</option>
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
         * @returns {Promise} - Resolves when initialization is complete
         * @private
         */
        function _initializeUIState() {
            console.log('Initializing UI state with settings:', _settings);
            
            // Return a promise that resolves when all setup is complete
            return new Promise(async (resolve, reject) => {
                try {
                    // First, make sure we have the embeddings list by getting the dataset structure
                    const datasetStructure = await _ensureDatasetStructure();
                    if (!datasetStructure) {
                        throw new Error('Failed to load dataset structure');
                    }
                    
                    // Set defaults from the actual dataset (using embeddings directly)
                    if (datasetStructure.embeddings && datasetStructure.embeddings.length > 0) {
                        const defaultEmbedding = datasetStructure.embeddings[0]; // First embedding
                        
                        // Set defaults if not already specified
                        if (!_settings.x.key || _settings.x.key === '') {
                            _settings.x.key = defaultEmbedding;
                            _settings.x.column = '0';
                            console.log(`Setting default x-axis to ${defaultEmbedding} column 0`);
                        }
                        
                        if (!_settings.y.key || _settings.y.key === '') {
                            _settings.y.key = defaultEmbedding;
                            _settings.y.column = '1';
                            console.log(`Setting default y-axis to ${defaultEmbedding} column 1`);
                        }
                    } else {
                        console.warn('No embeddings found in dataset structure');
                    }
                    
                    // Set up axis selectors sequentially to avoid race conditions
                    await _setupAxisSelector('x', _settings.x);
                    console.log('X-axis selector setup complete');
                    
                    await _setupAxisSelector('y', _settings.y);
                    console.log('Y-axis selector setup complete');
                    
                    if (_settings.z) {
                        document.getElementById(`z-axis-toggle-${_id}`).checked = true;
                        document.getElementById(`z-axis-container-${_id}`).style.display = 'block';
                        await _setupAxisSelector('z', _settings.z);
                        console.log('Z-axis selector setup complete');
                    }
                    
                    // Set color selector
                    await _setupAxisSelector('color', _settings.color);
                    console.log('Color selector setup complete');
                    
                    // Setup point controls
                    document.getElementById(`point-size-${_id}`).value = _settings.pointSize;
                    document.getElementById(`point-opacity-${_id}`).value = _settings.pointOpacity;
                    
                    // Re-validate our settings after UI setup
                    console.log('Final settings after UI initialization:', _settings);
                    
                    // Check for critical errors
                    for (const axis of ['x', 'y']) {
                        if (!_settings[axis] || !_settings[axis].key || _settings[axis].key === '') {
                            throw new Error(`No key selected for ${axis}-axis after initialization`);
                        }
                    }
                    
                    resolve();
                } catch (error) {
                    console.error('Error in _initializeUIState:', error);
                    reject(error);
                }
            });
        }
        
        /**
         * Ensure we have the dataset structure, load if needed
         * @returns {Promise<Object>} - Dataset structure
         * @private
         */
        async function _ensureDatasetStructure() {
            const datasetPath = DataManager.getCurrentDataset();
            if (!datasetPath) {
                console.error('No dataset path available');
                _plotContainer.innerHTML = '<div class="alert alert-danger">No dataset selected</div>';
                return null;
            }
            
            try {
                // Load dataset structure directly to avoid race conditions with DataManager
                console.log(`Loading dataset structure for ${datasetPath}`);
                const response = await fetch(`${Config.API.DATASET_STRUCTURE}?dataset_path=${encodeURIComponent(datasetPath)}`);
                if (!response.ok) {
                    throw new Error(`Failed to load dataset structure: ${response.statusText}`);
                }
                
                const data = await response.json();
                console.log('Loaded dataset structure directly:', data);
                
                return data;
            } catch (error) {
                console.error('Error loading dataset structure:', error);
                _plotContainer.innerHTML = `<div class="alert alert-danger">
                    Error loading dataset structure: ${error.message}
                </div>`;
                return null;
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
            
            if (!typeSelect || !keySelect || !columnSelect) {
                console.error(`Missing select elements for ${axis} axis`);
                return;
            }
            
            console.log(`Setting up ${axis} axis selector with settings:`, settings);
            
            // Set type (default to obsm if not specified)
            if (!settings.type) {
                settings.type = 'obsm';
                console.log(`Defaulting ${axis} axis type to 'obsm'`);
            }
            typeSelect.value = settings.type;
            
            // Populate key select based on type, waiting for it to complete
            return _populateKeySelect(settings.type, keySelect).then(() => {
                console.log(`Key select populated for ${axis} axis with options:`, 
                    Array.from(keySelect.options).map(o => o.value));
                
                // If we have a key and it exists in the select options, use it
                if (settings.key && Array.from(keySelect.options).some(option => option.value === settings.key)) {
                    keySelect.value = settings.key;
                    console.log(`Using provided ${axis} key: ${settings.key}`);
                } else {
                    // Otherwise, select the first available option
                    if (keySelect.options.length > 0) {
                        keySelect.selectedIndex = 0;
                        settings.key = keySelect.value;
                        console.log(`Setting default ${axis} key to '${settings.key}'`);
                    } else {
                        console.warn(`No options available for ${axis} key`);
                        // Initialize with an empty string, but we'll validate later
                        settings.key = '';
                    }
                }
                
                // Populate column select based on key
                return _populateColumnSelect(settings.type, settings.key, columnSelect).then(() => {
                    console.log(`Column select populated for ${axis} axis with options:`, 
                        Array.from(columnSelect.options).map(o => o.value));
                    
                    if (settings.column && Array.from(columnSelect.options).some(option => option.value === settings.column)) {
                        columnSelect.value = settings.column;
                        console.log(`Using provided ${axis} column: ${settings.column}`);
                    } else {
                        // Select the first available column
                        if (columnSelect.options.length > 0) {
                            columnSelect.selectedIndex = 0;
                            settings.column = columnSelect.value;
                            console.log(`Setting default ${axis} column to '${settings.column}'`);
                        } else {
                            console.warn(`No options available for ${axis} column`);
                            // For obsm, default to column "0"
                            if (settings.type === 'obsm') {
                                settings.column = '0';
                                console.log(`Default: Setting ${axis} obsm column to "0"`);
                            } else {
                                settings.column = '';
                            }
                        }
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
            
            // Special case for 'none' type - used for no coloring
            if (type === 'none') {
                select.innerHTML = '<option value="">None (constant color)</option>';
                return Promise.resolve();
            }
            
            // Load dataset structure directly to avoid race conditions
            const datasetStructure = await _ensureDatasetStructure();
            
            if (!datasetStructure) {
                select.innerHTML = '<option value="">No dataset loaded</option>';
                return Promise.resolve();
            }
            
            let options = [];
            
            switch (type) {
                case 'obs':
                    // Get obs columns from the structure
                    if (datasetStructure.obs && datasetStructure.obs.columns) {
                        console.log(`Found ${datasetStructure.obs.columns.length} obs columns in standard format`);
                        options = datasetStructure.obs.columns.map(col => 
                            `<option value="${col}">${col}</option>`
                        );
                    }
                    else if (datasetStructure.obs && Array.isArray(datasetStructure.obs)) {
                        // Alternative format - array of columns
                        console.log(`Found ${datasetStructure.obs.length} obs columns in array format`);
                        options = datasetStructure.obs.map(col => 
                            `<option value="${col}">${col}</option>`
                        );
                    }
                    else if (datasetStructure.obs) {
                        // Alternative format - direct object with keys as columns
                        const columns = Object.keys(datasetStructure.obs);
                        console.log(`Found ${columns.length} obs columns in object format`);
                        options = columns.map(col => 
                            `<option value="${col}">${col}</option>`
                        );
                    }
                    break;
                    
                case 'obsm':
                    // Direct reference to embeddings in the dataset structure
                    if (datasetStructure.embeddings && Array.isArray(datasetStructure.embeddings)) {
                        console.log(`Found ${datasetStructure.embeddings.length} embeddings:`, datasetStructure.embeddings);
                        
                        if (datasetStructure.embeddings.length > 0) {
                            options = datasetStructure.embeddings.map(key => 
                                `<option value="${key}">${key}</option>`
                            );
                        }
                    }
                    // Try other ways it might be available
                    else if (datasetStructure.obsm && datasetStructure.obsm.keys) {
                        const keys = datasetStructure.obsm.keys;
                        console.log(`Found ${keys.length} obsm keys in standard format`);
                        
                        if (keys.length > 0) {
                            options = keys.map(key => 
                                `<option value="${key}">${key}</option>`
                            );
                        }
                    }
                    break;
                    
                case 'obsp':
                    // Check if obsp exists and has keys
                    if (datasetStructure.obsp && datasetStructure.obsp.keys) {
                        const keys = datasetStructure.obsp.keys;
                        console.log(`Found ${keys.length} obsp keys`);
                        
                        if (keys.length > 0) {
                            options = keys.map(key => 
                                `<option value="${key}">${key}</option>`
                            );
                        }
                    }
                    break;
                    
                case 'layer':
                    // Try different ways layers might be available
                    if (datasetStructure.layers && datasetStructure.layers.details && 
                        datasetStructure.layers.details.keys) {
                        // Format from the API we've observed
                        const keys = datasetStructure.layers.details.keys;
                        console.log(`Found ${keys.length} layer keys in details:`, keys);
                        
                        if (keys.length > 0) {
                            options = keys.map(key => 
                                `<option value="${key}">${key}</option>`
                            );
                        }
                    }
                    else if (datasetStructure.layers && datasetStructure.layers.keys) {
                        // Standard format
                        const keys = datasetStructure.layers.keys;
                        console.log(`Found ${keys.length} layer keys in standard format`);
                        
                        if (keys.length > 0) {
                            options = keys.map(key => 
                                `<option value="${key}">${key}</option>`
                            );
                        }
                    }
                    break;
            }
            
            if (options.length) {
                console.log(`Setting ${options.length} options for ${type} select`);
                select.innerHTML = options.join('');
            } else {
                console.warn(`No options available for ${type}`);
                select.innerHTML = '<option value="">No options available</option>';
            }
            
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
                        // For obsm, we will always use numeric column indices for now
                        // since we found these work reliably with our backend
                        
                        // Default to 3 dimensions
                        const numDimensions = 3;
                        console.log(`Creating ${numDimensions} column options for obsm key: ${key}`);
                        
                        for (let i = 0; i < numDimensions; i++) {
                            options.push(`<option value="${i}">${i}</option>`);
                        }
                    } catch (error) {
                        console.error('Error creating obsm columns:', error);
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
                                    
                                    // Check if this is a color axis change
                                    if (axis === 'color' && _plot) {
                                        console.log('Color setting changed, using optimized update');
                                        _loadColorDataAndUpdatePlot();
                                    } else {
                                        // For other axes, recreate the plot
                                        _loadDataAndCreatePlot();
                                    }
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
                            
                            // Check if this is a color axis change
                            if (axis === 'color' && _plot) {
                                console.log('Color key changed, using optimized update');
                                _loadColorDataAndUpdatePlot();
                            } else {
                                // For other axes, recreate the plot
                                _loadDataAndCreatePlot();
                            }
                        }
                    });
                });
            });
            
            // Axis column selectors
            _container.querySelectorAll('.axis-column-select').forEach(select => {
                select.addEventListener('change', (e) => {
                    const axis = e.target.dataset.axis;
                    _settings[axis].column = e.target.value;
                    
                    // Check if this is a color axis change
                    if (axis === 'color' && _plot) {
                        console.log('Color column changed, using optimized update');
                        _loadColorDataAndUpdatePlot();
                    } else {
                        // For other axes, recreate the plot
                        _loadDataAndCreatePlot();
                    }
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
            
            // Category palette selector
            const categoryPaletteSelect = document.getElementById(`category-palette-${_id}`);
            categoryPaletteSelect.addEventListener('change', (e) => {
                _settings.categoryPalette = e.target.value;
                
                // Check if we can update without recreating
                if (_plot && _data.colorType === 'categorical') {
                    // For categorical coloring with palette changes, we need to recreate
                    _loadDataAndCreatePlot();
                } else if (_plot) {
                    // For other cases, try to update just the colors
                    _loadColorDataAndUpdatePlot(); 
                } else {
                    // If no plot exists yet, create it
                    _loadDataAndCreatePlot();
                }
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
                console.log(`Focused cell changed to: ${e.detail.cell}`);
                // Check if we're using obsp data
                const usesObspData = _settings.x.type === 'obsp' || 
                                    _settings.y.type === 'obsp' || 
                                    (_settings.z && _settings.z.type === 'obsp') ||
                                    _settings.color.type === 'obsp';
                
                if (usesObspData) {
                    // If only color uses obsp data, optimize the update
                    if (_settings.color.type === 'obsp' && 
                        _settings.x.type !== 'obsp' && 
                        _settings.y.type !== 'obsp' && 
                        (!_settings.z || _settings.z.type !== 'obsp')) {
                        
                        console.log('Focused cell changed, optimizing update for color only');
                        _loadColorDataAndUpdatePlot();
                    } else {
                        // Position axes (x, y, z) use obsp data, need to recreate the plot
                        console.log('Focused cell changed, recreating plot');
                        _loadDataAndCreatePlot();
                    }
                }
            });
            
            // Listen for focused gene changes
            document.addEventListener('focusedGeneChanged', (e) => {
                // Check if we're using layer data
                const usesLayerData = _settings.x.type === 'layer' || 
                                     _settings.y.type === 'layer' || 
                                     (_settings.z && _settings.z.type === 'layer') ||
                                     _settings.color.type === 'layer';
                
                if (usesLayerData) {
                    // If only color uses layer data, optimize the update
                    if (_settings.color.type === 'layer' && 
                        _settings.x.type !== 'layer' && 
                        _settings.y.type !== 'layer' && 
                        (!_settings.z || _settings.z.type !== 'layer')) {
                        
                        console.log('Focused gene changed, optimizing update for color only');
                        _loadColorDataAndUpdatePlot();
                    } else {
                        // Position axes (x, y, z) use layer data, need to recreate the plot
                        console.log('Focused gene changed, recreating plot');
                        _loadDataAndCreatePlot();
                    }
                }
            });
        }
        
        /**
         * Load only color data and update the plot without recreating it
         * @private 
         */
        async function _loadColorDataAndUpdatePlot() {
            try {
                const filteredCellIndices = _settings.subsettedCells && _settings.hideNonSubset
                    ? _settings.subsettedCells.map(cell => DataManager.getCellIndex(cell))
                    : null;
                
                // Load only color data
                console.log('Loading color data for plot update:', _settings.color);
                const colorData = await _loadAxisData('color', filteredCellIndices);
                console.log('Color data for update:', colorData);
                
                // Make sure we have valid values
                if (colorData && colorData.values) {
                    _data.color = colorData.values;
                    _data.colorType = colorData.type;
                    _data.colorCategories = colorData.categories;
                    console.log(`Updated _data.color to array with ${_data.color.length} elements, type: ${_data.colorType}`);
                    
                    // Check if we have many NaN values - as they're treated specially in the plot
                    const nanCount = _data.color.filter(val => val === null || val === undefined || isNaN(val)).length;
                    console.log(`Color data contains ${nanCount} NaN values out of ${_data.color.length} total`);
                    
                    // If we have many NaN values or categorical data, we should recreate the plot
                    // as these require special treatment in the full plot creation flow
                    if (nanCount > 0 && nanCount > _data.color.length * 0.1) { // More than 10% NaNs
                        console.log('Many NaN values detected, recreating full plot for proper handling');
                        _loadDataAndCreatePlot();
                        return;
                    } 
                    
                    if (_data.colorType === 'categorical') {
                        console.log('Categorical color data requires recreating the plot with legends');
                        _loadDataAndCreatePlot();
                        return;
                    }
                    
                    // Update the existing plot without recreating it 
                    _updatePlot(true); // true = full data update
                } else {
                    console.warn('No valid color data returned, falling back to full plot reload');
                    _loadDataAndCreatePlot();
                }
            } catch (error) {
                console.error('Error updating color data:', error);
                // Fall back to recreating the plot
                _loadDataAndCreatePlot();
            }
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
                
                // Validate settings before loading data
                for (const axis of ['x', 'y', 'z', 'color']) {
                    if (axis === 'z' && !_settings.z) continue; // Skip z-axis if not used
                    
                    const settings = _settings[axis];
                    console.log(`Validating ${axis} axis settings:`, settings);
                    
                    if (!settings) {
                        throw new Error(`No settings found for ${axis} axis`);
                    }
                    
                    // Validate type
                    if (!settings.type) {
                        _plotContainer.innerHTML = `<div class="alert alert-warning">
                            Missing type for ${axis}-axis
                        </div>`;
                        return;
                    }
                    
                    // For obsm, ensure we have a key
                    if (settings.type === 'obsm') {
                        if (!settings.key || settings.key === '') {
                            _plotContainer.innerHTML = `<div class="alert alert-warning">
                                Please select an obsm key for the ${axis}-axis
                            </div>`;
                            return;
                        }
                        
                        // Ensure we have a column specified
                        if (settings.column === undefined || settings.column === null || settings.column === '') {
                            // Default to column 0 if not specified
                            console.log(`Setting default column '0' for ${axis}-axis obsm.${settings.key}`);
                            settings.column = '0';
                        }
                    }
                }
                
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
                console.log('Loading X-axis data:', _settings.x);
                _data.x = await _loadAxisData('x', filteredCellIndices);
                
                // Load Y-axis data
                console.log('Loading Y-axis data:', _settings.y);
                _data.y = await _loadAxisData('y', filteredCellIndices);
                
                // Load Z-axis data if needed
                if (_settings.z) {
                    console.log('Loading Z-axis data:', _settings.z);
                    _data.z = await _loadAxisData('z', filteredCellIndices);
                }
                
                // Load color data
                console.log('Loading color data:', _settings.color);
                const colorData = await _loadAxisData('color', filteredCellIndices);
                _data.color = colorData.values;
                _data.colorType = colorData.type;
                _data.colorCategories = colorData.categories;
                
                // Validate data before creating plot
                if (_data.x && _data.x.values && _data.x.values.length > 0 &&
                    _data.y && _data.y.values && _data.y.values.length > 0) {
                    console.log(`Creating plot with ${_data.x.values.length} data points`);
                    _createPlot();
                } else {
                    console.error('Insufficient data for plotting');
                    _plotContainer.innerHTML = `<div class="alert alert-warning">
                        Insufficient data for plotting. X axis has 
                        ${_data.x && _data.x.values ? _data.x.values.length : 0} points, 
                        Y axis has ${_data.y && _data.y.values ? _data.y.values.length : 0} points.
                    </div>`;
                }
                
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
                // Special case for 'none' type (constant color)
                if (type === 'none') {
                    // Return constant values for all cells
                    const cells = DataManager.getCells();
                    const cellCount = cells ? cells.length : 100;
                    
                    // Return an array of ones (for constant coloring)
                    values = Array(cellCount).fill(1);
                    dataType = 'constant';
                    
                    return {
                        values,
                        type: dataType,
                        categories
                    };
                }
                
                switch (type) {
                    case 'obs':
                        // Load cell annotations
                        data = await DataManager.loadObs({
                            datasetPath,
                            columns: [key],
                            rows: rows ? rows.split(',') : null
                        });
                        
                        console.log(`Received obs data for ${key}:`, data);
                        
                        if (!data.data || !data.data[key]) {
                            console.warn(`No data found for obs.${key}`);
                            throw new Error(`No data found for column '${key}' in obs table`);
                        }
                        
                        values = data.data[key];
                        
                        // Log data statistics to help debug
                        if (Array.isArray(values)) {
                            console.log(`Loaded ${values.length} data points for ${axis} axis (obs.${key})`);
                            
                            // Check if sample values look reasonable
                            if (values.length > 0) {
                                console.log(`Sample values: ${values.slice(0, 5)}`);
                            }
                        }
                        
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
                        
                        console.log(`Received obsm data for ${key} column ${column}:`, data);
                        
                        if (!data.data || data.data.length === 0) {
                            console.warn(`No data points received for obsm.${key}.${column}`);
                            throw new Error(`No data points found for ${key}.${column}`);
                        }
                        
                        values = data.data;
                        dataType = 'numerical';
                        
                        // Log data statistics to help debug
                        if (Array.isArray(values)) {
                            console.log(`Loaded ${values.length} data points for ${axis} axis (obsm.${key}.${column})`);
                            
                            // Check if sample values look reasonable
                            if (values.length > 0) {
                                console.log(`Sample values: ${values.slice(0, 5)}`);
                            }
                        }
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
                        
                        // Log the request details for debugging
                        console.log(`Loading obsp data for ${key} with focused cell ${focusedCell} (index ${focusedCellIndex})`);
                        
                        data = await DataManager.loadObsp({
                            datasetPath,
                            obspKey: key,
                            rows: [focusedCellIndex]
                        });
                        
                        // Debug the returned data structure
                        console.log(`Received obsp data:`, data.data ? 
                            `Array of ${data.data.length} elements` : 'No data array');
                        
                        // Extract and handle values with robust error checking
                        if (data.data && Array.isArray(data.data) && data.data.length > 0) {
                            // Check if the first row is an array as expected
                            const firstRow = data.data[0];
                            
                            if (Array.isArray(firstRow)) {
                                console.log(`Obsp data is an array with ${firstRow.length} connections`);
                                console.log(`Sample values: ${JSON.stringify(firstRow.slice(0, 5))}`);
                                values = firstRow;
                            } else {
                                console.warn(`Expected array for obsp row, got:`, typeof firstRow);
                                // Try to handle the case where it's not an array
                                if (firstRow !== undefined && firstRow !== null) {
                                    // Convert to array if possible
                                    values = [firstRow];
                                    console.log(`Converted non-array obsp data to array`);
                                } else {
                                    // Create empty array for safety
                                    values = [];
                                    console.warn(`No usable obsp data found`);
                                }
                            }
                        } else {
                            console.warn(`Invalid or empty obsp data received`);
                            values = [];
                        }
                        
                        // Check and handle NaN values
                        if (values) {
                            const nanCount = values.filter(val => val === null || val === undefined || isNaN(val)).length;
                            if (nanCount > 0) {
                                console.log(`Obsp data contains ${nanCount} NaN values out of ${values.length} total`);
                            }
                        }
                        
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
                        
                        // Log the request details for debugging
                        console.log(`Loading layer data for ${key} with focused gene ${focusedGene} (index ${focusedGeneIndex})`);
                        
                        data = await DataManager.loadLayer({
                            datasetPath,
                            layerName: key,
                            rows: rows ? rows.split(',') : null,
                            cols: [focusedGeneIndex]
                        });
                        
                        // Debug the returned data structure
                        console.log(`Received layer data:`, data.data ? 
                            `Array of ${data.data.length} elements` : 'No data array');
                        
                        // Extract and handle values with NaN checks
                        if (data.data && typeof data.data === 'object') {
                            if (Array.isArray(data.data)) {
                                if (data.data.length > 0) {
                                    if (Array.isArray(data.data[0])) {
                                        // 2D array format (rows with columns)
                                        console.log(`Layer data is 2D array with ${data.data.length} rows and ${data.data[0].length} columns`);
                                        // Log first few values for debugging
                                        console.log(`Sample values: ${JSON.stringify(data.data.slice(0, 5))}`);
                                        
                                        try {
                                            values = data.data.map(row => {
                                                // Directly access first element, with fallback for safety
                                                const val = row[0];
                                                return val === undefined ? NaN : val;
                                            });
                                            console.log(`Extracted ${values.length} values, first few: ${JSON.stringify(values.slice(0, 5))}`);
                                        } catch (e) {
                                            console.error(`Error extracting values from 2D array:`, e);
                                            values = Array(data.data.length).fill(NaN); // Fallback
                                        }
                                    } else {
                                        // Already 1D array
                                        console.log(`Layer data is 1D array with ${data.data.length} elements`);
                                        console.log(`Sample values: ${JSON.stringify(data.data.slice(0, 5))}`);
                                        values = data.data;
                                    }
                                } else {
                                    console.warn(`Empty layer data array received`);
                                    values = [];
                                }
                            } else {
                                console.warn(`Unexpected data format received:`, typeof data.data);
                                values = [];
                            }
                        } else {
                            console.warn(`No valid data array received from layer endpoint`);
                            values = [];
                        }
                        
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
                
                // We can't display the plot without data
                throw new Error(`Failed to load data for ${axis} axis (${type}.${key}.${column})`);
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
            
            // Check if we have cell names and they match the data
            if (!_data.cells || _data.cells.length === 0) {
                console.error('Cell names missing - cannot create plot');
                _plotContainer.innerHTML = '<div class="alert alert-danger">Error: Cell names missing or unavailable</div>';
                return;
            }
            
            // Ensure cell names match data point count
            if (_data.cells.length !== _data.x.values.length) {
                console.warn(`Cell names count (${_data.cells.length}) doesn't match data points count (${_data.x.values.length})`);
                
                // If we have more cells than data points, trim the list
                if (_data.cells.length > _data.x.values.length) {
                    _data.cells = _data.cells.slice(0, _data.x.values.length);
                }
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
                // Rather than using a colorscale, we'll use discrete colors with a legend
                // Remove the colorscale property that would force a colorbar
                delete trace.marker.colorscale;
                
                // Data preparation and color assignment depends on whether we have categories or unique values
                const catValues = _data.categories || [...new Set(_data.color)];
                console.log(`Found ${catValues.length} categories:`, catValues);
                
                // Set up an object to hold all distinct traces (one per category)
                const traces = [];
                const datasetPath = DataManager.getCurrentDataset();
                const colorKey = `${_settings.color.key}_colors`;
                
                // Define color palettes to select from
                const colorPalettes = {
                    default: [
                        '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
                        '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'
                    ],
                    G10: [
                        '#3366CC', '#DC3912', '#FF9900', '#109618', '#990099',
                        '#0099C6', '#DD4477', '#66AA00', '#B82E2E', '#316395'
                    ],
                    Alphabet: [
                        '#AA0DFE', '#3283FE', '#85660D', '#782AB6', '#565656',
                        '#1C8356', '#16FF32', '#F7E1A0', '#E2E2E2', '#1CBE4F',
                        '#C4451C', '#DEA0FD', '#FE00FA', '#325A9B', '#FEAF16',
                        '#F8A19F', '#90AD1C', '#F6222E', '#1CFFCE', '#2ED9FF',
                        '#B10DA1', '#C075A6', '#FC1CBF', '#B00068', '#FBE426', 
                        '#FA0087'
                    ],
                    Dark2: [
                        '#1B9E77', '#D95F02', '#7570B3', '#E7298A',
                        '#66A61E', '#E6AB02', '#A6761D', '#666666'
                    ],
                    Pastel1: [
                        '#FBB4AE', '#B3CDE3', '#CCEBC5', '#DECBE4',
                        '#FED9A6', '#FFFFCC', '#E5D8BD', '#FDDAEC'
                    ],
                    Set1: [
                        '#E41A1C', '#377EB8', '#4DAF4A', '#984EA3',
                        '#FF7F00', '#FFFF33', '#A65628', '#F781BF', '#999999'
                    ],
                    Set2: [
                        '#66C2A5', '#FC8D62', '#8DA0CB', '#E78AC3',
                        '#A6D854', '#FFD92F', '#E5C494', '#B3B3B3'
                    ],
                    Paired: [
                        '#A6CEE3', '#1F78B4', '#B2DF8A', '#33A02C',
                        '#FB9A99', '#E31A1C', '#FDBF6F', '#FF7F00',
                        '#CAB2D6', '#6A3D9A', '#FFFF99', '#B15928'
                    ]
                };
                
                // Check for colors in uns
                let unsColors = null;
                
                const processCategories = (customColors = null) => {
                    // Store the custom colors from uns if they exist
                    if (customColors) {
                        unsColors = customColors;
                    }
                    
                    // Choose the color palette based on settings
                    let selectedPalette = colorPalettes.default;
                    
                    if (_settings.categoryPalette === 'uns' && unsColors) {
                        selectedPalette = unsColors;
                        console.log('Using custom colors from uns:', selectedPalette);
                    } else if (_settings.categoryPalette !== 'uns' && _settings.categoryPalette !== 'default') {
                        selectedPalette = colorPalettes[_settings.categoryPalette] || colorPalettes.default;
                        console.log(`Using color palette ${_settings.categoryPalette}:`, selectedPalette);
                    }
                    
                    // Create one trace per category for the legend
                    catValues.forEach((category, i) => {
                        // Find all points belonging to this category
                        const indices = [];
                        _data.color.forEach((val, idx) => {
                            if (val === category) indices.push(idx);
                        });
                        
                        if (indices.length === 0) return; // Skip if no points in this category
                        
                        // Create a trace for this category
                        const catTrace = {
                            type: _settings.z ? 'scatter3d' : 'scattergl',
                            mode: 'markers',
                            name: category,
                            text: indices.map(idx => _data.cells[idx]),
                            hovertemplate: '%{text}<br>x: %{x}<br>y: %{y}' + (_settings.z ? '<br>z: %{z}' : '') + '<extra></extra>',
                            x: indices.map(idx => _data.x.values[idx]),
                            y: indices.map(idx => _data.y.values[idx]),
                            marker: {
                                size: _settings.pointSize,
                                opacity: _settings.pointOpacity,
                                color: selectedPalette[i % selectedPalette.length]
                            },
                            showlegend: true
                        };
                        
                        // Add z coordinates for 3D plots
                        if (_settings.z && _data.z) {
                            catTrace.z = indices.map(idx => _data.z.values[idx]);
                        }
                        
                        traces.push(catTrace);
                    });
                    
                    // Return an empty array if we're going to create multiple traces
                    return traces;
                };
                
                // Check for custom colors in uns if we're using them
                if (_settings.categoryPalette === 'uns') {
                    fetch(`${Config.API.UNS}/${encodeURIComponent(colorKey)}?dataset_path=${encodeURIComponent(datasetPath)}`)
                        .then(response => {
                            if (response.ok) {
                                return response.json();
                            }
                            return null;
                        })
                        .then(data => {
                            if (data && data.data) {
                                console.log(`Found custom colors in uns.${colorKey}:`, data.data);
                                const customColors = Array.isArray(data.data) ? data.data : [data.data];
                                
                                // Process with custom colors 
                                const traces = processCategories(customColors);
                                
                                // Update layout to show the legend
                                const layout = {
                                    showlegend: true,
                                    legend: {
                                        title: { text: _settings.color.key }
                                    }
                                };
                                
                                // Create the plot with multiple traces
                                Plotly.newPlot(_plotContainer, traces, layout, {
                                    responsive: true,
                                    displayModeBar: true,
                                    displaylogo: false,
                                    modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d']
                                });
                                
                                // Set up click handler to set focused cell
                                _plotContainer.on('plotly_click', (data) => {
                                    const pointIndex = data.points[0].pointIndex;
                                    const traceIndex = data.points[0].curveNumber;
                                    const cellName = traces[traceIndex].text[pointIndex];
                                    
                                    if (cellName) {
                                        DataManager.setFocusedCell(cellName);
                                    }
                                });
                                
                                // Store plot reference
                                _plot = _plotContainer;
                            }
                        })
                        .catch(error => {
                            console.warn(`Error fetching custom colors from uns.${colorKey}:`, error);
                            
                            // Process without custom colors as fallback
                            const traces = processCategories();
                            
                            // Create the plot with multiple traces
                            Plotly.newPlot(_plotContainer, traces, {
                                showlegend: true,
                                legend: {
                                    title: { text: _settings.color.key }
                                }
                            }, {
                                responsive: true,
                                displayModeBar: true,
                                displaylogo: false,
                                modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d']
                            });
                            
                            // Set up click handler
                            _plotContainer.on('plotly_click', (data) => {
                                const pointIndex = data.points[0].pointIndex;
                                const traceIndex = data.points[0].curveNumber;
                                const cellName = traces[traceIndex].text[pointIndex];
                                
                                if (cellName) {
                                    DataManager.setFocusedCell(cellName);
                                }
                            });
                            
                            // Store plot reference
                            _plot = _plotContainer;
                        });
                        
                    // Return empty trace here - we'll replace it with the processed traces
                    return [];
                } else {
                    // Not using uns colors or waiting for them, process immediately
                    return processCategories();
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
            } else if (_data.colorType === 'constant') {
                // Use a constant color (default to light grey)
                trace.marker.color = 'rgba(150, 150, 150, 0.7)';
                delete trace.marker.colorscale;
                
                console.log('Using constant color for all points');
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
            
            // The traces array will either contain a single trace (for numerical data)
            // or multiple traces (for categorical data with legend)
            const traces = Array.isArray(trace) ? trace : [trace];
            
            // For categorical data with multiple traces, ensure legend is enabled
            if (traces.length > 1) {
                layout.showlegend = true;
                layout.legend = { 
                    title: { text: _settings.color.key } 
                };
            }
            
            // Create the plot
            Plotly.newPlot(_plotContainer, traces, layout, {
                responsive: true,
                displayModeBar: true,
                displaylogo: false,
                modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d']
            });
            
            // Set up click handler to set focused cell
            _plotContainer.on('plotly_click', (data) => {
                const pointIndex = data.points[0].pointIndex;
                const traceIndex = data.points[0].curveNumber;
                let cellName;
                
                // Handle both single trace and multiple traces
                if (traces.length > 1 && traces[traceIndex].text) {
                    // For categorical data with multiple traces
                    cellName = traces[traceIndex].text[pointIndex];
                } else {
                    // For single trace (numerical data)
                    cellName = _data.cells[pointIndex];
                }
                
                if (cellName) {
                    DataManager.setFocusedCell(cellName);
                }
            });
            
            // Store plot reference
            _plot = _plotContainer;
            
            // Show appropriate color controls based on data type
            const colorRangeContainer = document.getElementById(`color-range-container-${_id}`);
            const colorScaleSelect = document.getElementById(`color-scale-${_id}`);
            const categoryPaletteSelect = document.getElementById(`category-palette-${_id}`);
            const colorMinInput = document.getElementById(`color-min-${_id}`);
            const colorMaxInput = document.getElementById(`color-max-${_id}`);
            const hideOutliersToggle = document.getElementById(`hide-outliers-${_id}`);
            const numericalLabel = _container.querySelector('.numerical-color-label');
            const categoricalLabel = _container.querySelector('.categorical-color-label');
            
            if (_data.colorType === 'numerical') {
                // Show numerical color controls
                colorRangeContainer.style.display = 'flex';
                colorScaleSelect.style.display = 'block';
                categoryPaletteSelect.style.display = 'none';
                colorMinInput.style.display = 'block';
                colorMaxInput.style.display = 'block';
                hideOutliersToggle.parentElement.style.display = 'block';
                
                // Show numerical label, hide categorical label
                numericalLabel.style.display = 'inline';
                categoricalLabel.style.display = 'none';
                
                // Set min/max input defaults if not already set
                if (colorMinInput.value === '') {
                    colorMinInput.placeholder = Math.min(..._data.color).toFixed(2);
                }
                
                if (colorMaxInput.value === '') {
                    colorMaxInput.placeholder = Math.max(..._data.color).toFixed(2);
                }
            } else if (_data.colorType === 'categorical') {
                // Show categorical color controls
                colorRangeContainer.style.display = 'flex';
                colorScaleSelect.style.display = 'none';
                categoryPaletteSelect.style.display = 'block';
                colorMinInput.style.display = 'none';
                colorMaxInput.style.display = 'none';
                hideOutliersToggle.parentElement.style.display = 'none';
                
                // Show categorical label, hide numerical label
                numericalLabel.style.display = 'none';
                categoricalLabel.style.display = 'inline';
                
                // Ensure the correct palette is selected
                categoryPaletteSelect.value = _settings.categoryPalette;
            } else {
                // Hide all color controls
                colorRangeContainer.style.display = 'none';
            }
        }
        
        /**
         * Update plot with current settings without recreating it
         * @param {boolean} fullDataUpdate - Whether to update all data or just visual properties 
         * @private
         */
        function _updatePlot(fullDataUpdate = false) {
            console.log(`Updating plot (fullDataUpdate=${fullDataUpdate})`);
            
            if (!_plot) {
                console.warn("Plot doesn't exist yet, creating it instead of updating");
                _loadDataAndCreatePlot();
                return;
            }
            
            try {
                // If it's a full data update (e.g. when changing the color data)
                if (fullDataUpdate) {
                    console.log("Performing full data update");
                    
                    // If we have multiple traces, we need to recreate the plot
                    if (_plot.data && _plot.data.length > 1) {
                        console.log("Plot has multiple traces, recreating instead of updating");
                        _loadDataAndCreatePlot();
                        return;
                    }
                    
                    if (_data.colorType === 'categorical') {
                        console.log("Categorical coloring requires recreating the plot");
                        _loadDataAndCreatePlot();
                        return;
                    }
                    
                    // For numerical data, update the color array and scales
                    if (_data.colorType === 'numerical' && _data.color && _data.color.length > 0) {
                        console.log(`Updating plot with ${_data.color.length} color values`);
                        
                        // Handle NaN values
                        const validIndices = [];
                        const nanIndices = [];
                        
                        for (let i = 0; i < _data.color.length; i++) {
                            const val = _data.color[i];
                            if (val === null || val === undefined || isNaN(val)) {
                                nanIndices.push(i);
                            } else {
                                validIndices.push(i);
                            }
                        }
                        
                        console.log(`Found ${nanIndices.length} NaN values and ${validIndices.length} valid values`);
                        
                        // If we have NaN values, we need to recreate the plot
                        if (nanIndices.length > 0) {
                            console.log("Data contains NaN values, recreating plot for proper handling");
                            _loadDataAndCreatePlot();
                            return;
                        }
                        
                        // Update color scale and data
                        const update = {
                            'marker.color': [_data.color],
                            'marker.colorscale': [_settings.colorScale]
                        };
                        
                        // Set color range if specified
                        if (_settings.colorMin !== null || _settings.colorMax !== null) {
                            const cmin = _settings.colorMin !== null ? _settings.colorMin : Math.min(..._data.color);
                            const cmax = _settings.colorMax !== null ? _settings.colorMax : Math.max(..._data.color);
                            
                            update['marker.cmin'] = [cmin];
                            update['marker.cmax'] = [cmax];
                            
                            // If hideOutliers is enabled, we need to recreate the plot
                            if (_settings.hideOutliers) {
                                console.log("Hide outliers enabled, recreating plot");
                                _loadDataAndCreatePlot();
                                return;
                            }
                        }
                        
                        // Update the colorbar title
                        const layout = {
                            'coloraxis.colorbar.title': {
                                text: `${_settings.color.type}.${_settings.color.key}` +
                                      (_settings.color.column ? `.${_settings.color.column}` : '')
                            }
                        };
                        
                        // Apply updates
                        console.log("Applying updates to existing plot:", update);
                        Plotly.update(_plotContainer, update, layout);
                        console.log("Plot updated successfully");
                    } else {
                        console.log("Recreating plot due to color data issues");
                        _loadDataAndCreatePlot();
                    }
                } else {
                    // Simple visual property updates
                    console.log("Updating visual properties only");
                    
                    // Update common marker properties
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
                                console.log("Color range or outlier settings changed, recreating plot");
                                _loadDataAndCreatePlot();
                                return;
                            }
                        }
                    }
                    
                    // Apply updates to all traces
                    const traceIndices = Array.from({length: _plot.data.length}, (_, i) => i);
                    console.log(`Applying updates to ${traceIndices.length} traces:`, update);
                    Plotly.update(_plotContainer, update, {}, traceIndices);
                    console.log("Visual properties updated successfully");
                }
            } catch (error) {
                console.error("Error updating plot:", error);
                console.log("Falling back to recreating the plot");
                _loadDataAndCreatePlot();
            }
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
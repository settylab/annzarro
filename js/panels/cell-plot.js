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
        let _fullPlotData = null;
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
            hideNonSubset: false,
            showGrid: true,    // Show grid lines by default
            lockColorRange: false  // Don't lock color range by default
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
        if (options.showGrid !== undefined) _settings.showGrid = options.showGrid;
        if (options.lockColorRange !== undefined) _settings.lockColorRange = options.lockColorRange;
        
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
                                <div class="btn-group" role="group" aria-label="Plot Option Buttons">
                                    <button class="btn btn-sm btn-outline-secondary me-2" id="z-axis-toggle-${_id}">3D Plot</button>
                                    <button class="btn btn-sm active btn-primary me-2" id="show-grid-${_id}">Show Grid</button>
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
                                    
                                    <div class="color-range-inputs">
                                        <div class="color-range-sliders">
                                            <div class="color-min-slider-container">
                                                <label>Min:</label>
                                                <input type="range" class="form-range" id="color-min-slider-${_id}">
                                                <input type="number" class="form-control form-control-sm" placeholder="Min" id="color-min-${_id}">
                                            </div>
                                            <div class="color-max-slider-container">
                                                <label>Max:</label>
                                                <input type="range" class="form-range" id="color-max-slider-${_id}">
                                                <input type="number" class="form-control form-control-sm" placeholder="Max" id="color-max-${_id}">
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div class="btn-toolbar d-flex flex-row" role="toolbar" aria-label="Color range controls" style="width:100%; display:flex !important; flex-direction:row !important; gap:4px;">
                                      <div class="btn-group d-flex flex-row flex-nowrap" role="group" style="width:auto; display:inline-flex !important; flex-wrap:nowrap !important; gap:4px;">
                                        <button type="button" class="btn btn-sm btn-outline-secondary" id="center-colormap-${_id}" style="display:inline-block !important; margin-right:4px !important;">Center at 0</button>
                                        <button type="button" class="btn btn-sm btn-outline-secondary" id="hide-outliers-${_id}" style="display:inline-block !important; margin-right:4px !important;">Hide Outliers</button>
                                        <button type="button" class="btn btn-sm btn-outline-secondary" id="lock-range-${_id}" style="display:inline-block !important;">Lock Range</button>
                                      </div>
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
                    if (datasetStructure.obsm &&
                        datasetStructure.obsm.dataframes &&
                        Object.keys(datasetStructure.obsm.dataframes).length > 0) {
                
                        let dataframeKeys = Object.keys(datasetStructure.obsm.dataframes);
                        let defaultDataFrameKey;
                    
                        // Preferred order: Exact "X_umap"
                        if (dataframeKeys.includes("X_umap")) {
                            defaultDataFrameKey = "X_umap";
                        } else {
                            // If none, look for a key that starts with "X_umap"
                            defaultDataFrameKey = dataframeKeys.find(key => key.startsWith("X_umap"));
                            if (!defaultDataFrameKey) {
                                // Next, check for "X_pca"
                                if (dataframeKeys.includes("X_pca")) {
                                    defaultDataFrameKey = "X_pca";
                                } else {
                                    // Fallback to the first key if none of the preferred keys are found
                                    defaultDataFrameKey = dataframeKeys[0];
                                }
                            }
                        }
                    
                        const defaultDataFrame = datasetStructure.obsm.dataframes[defaultDataFrameKey];
                    
                        if (defaultDataFrame.columns && defaultDataFrame.columns.length >= 2) {
                            if (!_settings.x.key || _settings.x.key === '') {
                                _settings.x.key = defaultDataFrameKey;
                                _settings.x.column = defaultDataFrame.columns[0]; // First available column
                                console.log(`Setting default x-axis to ${defaultDataFrameKey} column ${defaultDataFrame.columns[0]}`);
                            }
                            
                            if (!_settings.y.key || _settings.y.key === '') {
                                _settings.y.key = defaultDataFrameKey;
                                _settings.y.column = defaultDataFrame.columns[1]; // Second available column
                                console.log(`Setting default y-axis to ${defaultDataFrameKey} column ${defaultDataFrame.columns[1]}`);
                            }
                            
                            if (defaultDataFrame.columns.length >= 3) {
                                if (!_settings.z) {
                                    _settings.z = {
                                        type: 'obsm',
                                        key: defaultDataFrameKey,
                                        column: defaultDataFrame.columns[2]
                                    }
                                    console.log(`Setting default z-axis to ${defaultDataFrameKey} column ${defaultDataFrame.columns[2]}`);
                                } else if (!_settings.z.key || _settings.z.key === '') {
                                    _settings.z.key = defaultDataFrameKey;
                                    _settings.z.column = defaultDataFrame.columns[2]; 
                                    console.log(`Setting default z-axis to ${defaultDataFrameKey} column ${defaultDataFrame.columns[2]}`);
                                }
                            }
                        } else {
                            console.warn(`No available columns in obsm dataframe "${defaultDataFrameKey}"`);
                        }
                    } else {
                        console.warn('No obsm dataframes found in dataset structure');
                    }
                    
                    // Set up axis selectors sequentially to avoid race conditions
                    await _setupAxisSelector('x', _settings.x);
                    console.log('X-axis selector setup complete');
                    
                    await _setupAxisSelector('y', _settings.y);
                    console.log('Y-axis selector setup complete');
                    
                    if (_settings.z) {
                        const zAxisToggle = document.getElementById(`z-axis-toggle-${_id}`);
                        zAxisToggle.classList.add('active', 'btn-primary');
                        zAxisToggle.classList.remove('btn-outline-secondary');
                        zAxisToggle.setAttribute('title', '3rd dimension active - click to disable');
                        
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

        // Global (within the CellPlotPanel closure) variable to hold the dataset structure.
        let globalDatasetStructure = null;
        
        // Function to update (or force-refresh) the global dataset structure.
        async function updateGlobalDatasetStructure() {
            const datasetPath = DataManager.getCurrentDataset();
            if (!datasetPath) {
                console.error('No dataset path available');
                return null;
            }
            try {
                console.log(`Loading dataset structure for ${datasetPath}`);
                const response = await fetch(`${Config.API.DATASET_STRUCTURE}?dataset_path=${encodeURIComponent(datasetPath)}`);
                if (!response.ok) {
                    throw new Error(`Failed to load dataset structure: ${response.statusText}`);
                }
                globalDatasetStructure = await response.json();
                console.log('Updated global dataset structure:', globalDatasetStructure);
                return globalDatasetStructure;
            } catch (error) {
                console.error('Error updating global dataset structure:', error);
                return null;
            }
        }
        
        // Getter function that uses the global variable
        function getGlobalDatasetStructure() {
            return globalDatasetStructure;
        }

        
        async function _ensureDatasetStructure() {
            // If we haven't loaded the structure yet, update it
            if (!globalDatasetStructure) {
                const ds = await updateGlobalDatasetStructure();
                if (!ds) {
                    _plotContainer.innerHTML = '<div class="alert alert-danger">No dataset selected</div>';
                    return null;
                }
                return ds;
            }
            return globalDatasetStructure;
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
                            console.log(`Setting default ${axis} column to '${settings.column}'`); // Todo: fix default, use the right column
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
            await updateGlobalDatasetStructure();
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
                    if (datasetStructure.obsm &&
                        datasetStructure.obsm.dataframes &&
                        Object.keys(datasetStructure.obsm.dataframes).length > 0) {
                        
                        const obsmDataFrameKeys = Object.keys(datasetStructure.obsm.dataframes);
                        console.log(`Found ${obsmDataFrameKeys.length} obsm dataframe keys:`, obsmDataFrameKeys);
                        
                        options = obsmDataFrameKeys.map(key =>
                            `<option value="${key}">${key}</option>`
                        );
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
                        // Look for the selected obsm dataframe by key
                        const df = datasetStructure.obsm && datasetStructure.obsm.dataframes && datasetStructure.obsm.dataframes[key];
                        if (df && df.columns && df.columns.length > 0) {
                            console.log(`Found ${df.columns.length} columns for obsm key: ${key}`);
                            options = df.columns.map(col => `<option value="${col}">${col}</option>`);
                        } else {
                            // Fallback if column info isn't available
                            const numDimensions = 3;
                            console.log(`No columns found for obsm key: ${key}, defaulting to ${numDimensions} dimensions`);
                            for (let i = 0; i < numDimensions; i++) {
                                options.push(`<option value="${i}">${i}</option>`);
                            }
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
                                    
                                    // Handle different axis changes appropriately
                                    if (axis === 'color' && _plot) {
                                        // Color changes can use optimized update path
                                        console.log('Color setting changed, using optimized update');
                                        _loadColorDataAndUpdatePlot();
                                    } else if (axis === 'z') {
                                        // Z-axis changes mean switching between 2D and 3D
                                        console.log('Z-axis changed (2D/3D change), recreating plot');
                                        _loadDataAndCreatePlot();
                                    } else if (axis === 'x') {
                                        // Position axes changes for X can be optimized if we already have a plot
                                        if (_plot) {
                                            console.log('X-axis changed, loading data and updating plot');
                                            // Load new X data and update only X axis
                                            _loadAxisData('x').then(xData => {
                                                if (xData && xData.values) {
                                                    _data.x = xData;
                                                    _updatePlotElements({
                                                        xAxis: true,
                                                        layout: true
                                                    });
                                                } else {
                                                    _loadDataAndCreatePlot();
                                                }
                                            }).catch(() => _loadDataAndCreatePlot());
                                        } else {
                                            _loadDataAndCreatePlot();
                                        }
                                    } else if (axis === 'y') {
                                        // Position axes changes for Y can be optimized if we already have a plot
                                        if (_plot) {
                                            console.log('Y-axis changed, loading data and updating plot');
                                            // Load new Y data and update only Y axis
                                            _loadAxisData('y').then(yData => {
                                                if (yData && yData.values) {
                                                    _data.y = yData;
                                                    _updatePlotElements({
                                                        yAxis: true,
                                                        layout: true
                                                    });
                                                } else {
                                                    _loadDataAndCreatePlot();
                                                }
                                            }).catch(() => _loadDataAndCreatePlot());
                                        } else {
                                            _loadDataAndCreatePlot();
                                        }
                                    } else {
                                        // Fallback
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
                            
                            // Handle different axis changes appropriately
                            if (axis === 'color' && _plot) {
                                // Color key changes can use optimized update
                                console.log('Color key changed, using optimized update');
                                _loadColorDataAndUpdatePlot();
                            } else if (axis === 'z') {
                                // Z-axis changes mean switching between 2D and 3D
                                console.log('Z-axis key changed, recreating plot');
                                _loadDataAndCreatePlot();
                            } else if (axis === 'x' || axis === 'y') {
                                // Position axes changes require recreation
                                console.log('Position axis (x/y) key changed, recreating plot');
                                _loadDataAndCreatePlot();
                            } else {
                                // Fallback
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
                    
                    // Handle different axis changes appropriately
                    if (axis === 'color' && _plot) {
                        // Color column changes can use optimized update
                        console.log('Color column changed, using optimized update');
                        _loadColorDataAndUpdatePlot();
                    } else if (axis === 'z') {
                        // Z-axis changes mean possible dimension changes in 3D
                        console.log('Z-axis column changed, recreating plot');
                        _loadDataAndCreatePlot();
                    } else if (axis === 'x' || axis === 'y') {
                        // Position axes changes require recreation
                        console.log('Position axis (x/y) column changed, recreating plot');
                        _loadDataAndCreatePlot();
                    } else {
                        // Fallback
                        _loadDataAndCreatePlot();
                    }
                });
            });
            
            // 3D plot toggle - this always requires plot recreation since it changes the plot type
            const zAxisToggle = document.getElementById(`z-axis-toggle-${_id}`);
            zAxisToggle.addEventListener('click', (e) => {
                // Toggle active state (Bootstrap will also toggle classes if you use data-bs-toggle)
                const is3D = zAxisToggle.classList.contains('active');
                const zAxisContainer = document.getElementById(`z-axis-container-${_id}`);
                
                if (is3D) {
                    zAxisToggle.classList.remove('active', 'btn-primary');
                    zAxisToggle.classList.add('btn-outline-secondary');
                    zAxisToggle.setAttribute('title', 'Enable 3D plot');
                    
                    zAxisContainer.style.display = 'none';
                    _settings.z = null;
                    _loadDataAndCreatePlot();
                } else {
                    zAxisToggle.classList.add('active', 'btn-primary');
                    zAxisToggle.classList.remove('btn-outline-secondary');
                    zAxisToggle.setAttribute('title', '3rd dimension active - click to disable');
                    zAxisContainer.style.display = 'block';
                    
                    // Initialize z-axis if not already set
                    if (!_settings.z) {
                        // Use the same obsm key as the y-axis
                        const yKey = _settings.y.key;
                        let zColumn = '2'; // fallback default
                
                        // Get the current dataset structure
                        const ds = getGlobalDatasetStructure();
                        if (ds && ds.obsm && ds.obsm.dataframes && ds.obsm.dataframes[yKey]) {
                            const df = ds.obsm.dataframes[yKey];
                            if (df.columns && df.columns.length > 0) {
                                // Find index of the y-axis column in the dataframe columns
                                const yColIndex = df.columns.indexOf(_settings.y.column);
                                if (yColIndex !== -1 && yColIndex + 1 < df.columns.length) {
                                    // Use the next available column
                                    zColumn = df.columns[yColIndex + 1];
                                } else {
                                    // If y's column is the last one, fall back to the last available column
                                    zColumn = df.columns[df.columns.length - 1];
                                }
                            }
                        }
                
                        _settings.z = { type: 'obsm', key: yKey, column: zColumn };
                        _setupAxisSelector('z', _settings.z);
                    }
                    _loadDataAndCreatePlot();
                }
            });
            
            // Point size slider - use centralized update system
            const pointSizeSlider = document.getElementById(`point-size-${_id}`);
            pointSizeSlider.addEventListener('input', (e) => {
                const newSize = parseFloat(e.target.value);
                _settings.pointSize = newSize;
                
                // Update styling only
                _updatePlotElements({
                    styling: true
                });
            });
            
            // Point opacity slider - use centralized update system
            const pointOpacitySlider = document.getElementById(`point-opacity-${_id}`);
            pointOpacitySlider.addEventListener('input', (e) => {
                const newOpacity = parseFloat(e.target.value);
                _settings.pointOpacity = newOpacity;
                
                // Update styling only
                _updatePlotElements({
                    styling: true
                });
            });
            
            // Color scale selector - use centralized update system
            const colorScaleSelect = document.getElementById(`color-scale-${_id}`);
            colorScaleSelect.addEventListener('change', (e) => {
                const newColorScale = e.target.value;
                _settings.colorScale = newColorScale;
                
                // Only update for numerical data, categorical uses discrete colors
                if (_data.colorType === 'numerical' && _plot) {
                    // Use centralized update system for color updates
                    _updatePlotElements({ colors: true, colorScale: true });
                    console.log(`Updated colorscale to ${newColorScale} without redrawing`);
                } else {
                    // For categorical data, we need to recreate the plot with proper legend
                    _loadDataAndCreatePlot();
                }
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
            
            // Color range inputs and sliders
            const colorMinInput = document.getElementById(`color-min-${_id}`);
            const colorMaxInput = document.getElementById(`color-max-${_id}`);
            const colorMinSlider = document.getElementById(`color-min-slider-${_id}`);
            const colorMaxSlider = document.getElementById(`color-max-slider-${_id}`);
            
            // Track centering state
            _settings.centeringActive = _settings.centeringActive || false;
            
            // Helper function to update color range values without affecting sliders
            function _updateColorRange(min, max, updateSliders = true, triggerPlotUpdate = true) {
                _settings.colorMin = min !== '' ? parseFloat(min) : null;
                _settings.colorMax = max !== '' ? parseFloat(max) : null;
                
                // Update input fields
                colorMinInput.value = _settings.colorMin !== null ? _settings.colorMin : '';
                colorMaxInput.value = _settings.colorMax !== null ? _settings.colorMax : '';
                
                // Update sliders if requested and we have valid data range
                if (updateSliders && _data && _data.color && Array.isArray(_data.color)) {
                    // Get data range
                    const validValues = _data.color.filter(v => !isNaN(v));
                    const dataMin = Math.min(...validValues);
                    const dataMax = Math.max(...validValues);
                    
                    // Set slider values but don't update inputs again (to avoid recursive triggers)
                    colorMinSlider.value = _settings.colorMin !== null ? _settings.colorMin : dataMin;
                    colorMaxSlider.value = _settings.colorMax !== null ? _settings.colorMax : dataMax;
                }
                
                // Only trigger plot update if specified
                if (triggerPlotUpdate) {
                    _updatePlot(false); // false = only update visual properties, don't recreate plot
                }
            }
            
            // Min input
            colorMinInput.addEventListener('change', (e) => {
                const minValue = e.target.value !== '' ? parseFloat(e.target.value) : null;
                const maxValue = _settings.colorMax;
                _updateColorRange(minValue, maxValue, true);
                
                // Turn off centering when manually editing
                _settings.centeringActive = false;
                _updateCenteringUI();
            });
            
            // Max input
            colorMaxInput.addEventListener('change', (e) => {
                const minValue = _settings.colorMin;
                const maxValue = e.target.value !== '' ? parseFloat(e.target.value) : null;
                _updateColorRange(minValue, maxValue, true);
                
                // Turn off centering when manually editing
                _settings.centeringActive = false;
                _updateCenteringUI();
            });
            
            // Debounce function to prevent too many updates
            function debounce(func, wait) {
                let timeout;
                return function(...args) {
                    clearTimeout(timeout);
                    timeout = setTimeout(() => func.apply(this, args), wait);
                };
            }
            
            // Direct Plotly update for sliders without full update mechanism
            function updateColorRange(minOrMax, value) {
                if (!_plot || !_plot.data || !_plot.data[0] || !_plot.data[0].marker) return;
                
                // Just update the specific property directly using Plotly API
                const update = {};
                update[`marker.c${minOrMax}`] = value;
                
                Plotly.restyle(_plotContainer, update, [0]);
            }

            const hideOutliersButton = document.getElementById(`hide-outliers-${_id}`);
            
            // Initialize button appearance based on the current setting
            if (_settings.hideOutliers) {
              hideOutliersButton.classList.add('active', 'btn-primary');
              hideOutliersButton.classList.remove('btn-outline-secondary');
            } else {
              hideOutliersButton.classList.remove('active', 'btn-primary');
              hideOutliersButton.classList.add('btn-outline-secondary');
            }
            
            hideOutliersButton.addEventListener('click', () => {
              // Toggle the setting
              _settings.hideOutliers = !_settings.hideOutliers;
              
              if (_settings.hideOutliers) {
                hideOutliersButton.classList.add('active', 'btn-primary');
                hideOutliersButton.classList.remove('btn-outline-secondary');
              } else {
                hideOutliersButton.classList.remove('active', 'btn-primary');
                hideOutliersButton.classList.add('btn-outline-secondary');
              }
              
              // Instead of reloading full data, call a function that processes the current data
              updateOutlierFiltering();
            });

            function updateOutlierFiltering() {
              if (!_plot) return;
              
              // Only perform outlier filtering for continuous (numerical) data
              if (_data.colorType !== 'numerical') {
                return;
              }
              
              // If filtering is off, simply use the original data.
              if (!_settings.hideOutliers) {
                if (_fullPlotData) {
                  Plotly.react(_plotContainer, _fullPlotData, _plot.layout);
                }
                return;
              }
                
              // Skip processing if either colorMin or colorMax is not defined
              if (_settings.colorMin == null || _settings.colorMax == null) {
                if (_fullPlotData) {
                  Plotly.react(_plotContainer, _fullPlotData, _plot.layout);
                }
                return;
              }
              
              // Get slider values
              const minVal = parseFloat(_settings.colorMin);
              const maxVal = parseFloat(_settings.colorMax);
              
              // Process each trace based on the original unfiltered data
              const processedData = _fullPlotData.map(trace => {
                if (trace.marker && Array.isArray(trace.marker.color)) {
                  let newX = [];
                  let newY = [];
                  let newZ = [];
                  let newColors = [];
              
                  for (let i = 0; i < trace.marker.color.length; i++) {
                    const cVal = trace.marker.color[i];
                    if (cVal >= minVal && cVal <= maxVal) {
                      newX.push(trace.x[i]);
                      newY.push(trace.y[i]);
                      newColors.push(cVal);
                      if (trace.z) {
                        newZ.push(trace.z[i]);
                      }
                    }
                  }
              
                  return {
                    ...trace,
                    x: newX,
                    y: newY,
                    // Only include z if it exists in the original trace.
                    ...(trace.z ? { z: newZ } : {}),
                    marker: { ...trace.marker, color: newColors }
                  };
                }
                return trace;
              });
              
              Plotly.react(_plotContainer, processedData, _plot.layout);
            }
            
            // Min slider - use input for real-time updates
            colorMinSlider.addEventListener('input', (e) => {
                const minValue = parseFloat(e.target.value);
                colorMinInput.value = minValue.toFixed(2);
                
                // Update settings
                _settings.colorMin = minValue;
                
                // Direct efficient update for smooth slider experience
                updateColorRange('min', minValue);
                updateOutlierFiltering();
            });
            
            // Min slider - on change for final update
            colorMinSlider.addEventListener('change', (e) => {
                console.log('Min slider change completed');
                // Immediate update on mouseup
                _updatePlotColorRangeOnly();
            });
            
            // Max slider - use input for real-time updates
            colorMaxSlider.addEventListener('input', (e) => {
                const maxValue = parseFloat(e.target.value);
                colorMaxInput.value = maxValue.toFixed(2);
                
                // Update settings
                _settings.colorMax = maxValue;
                
                // Direct efficient update for smooth slider experience
                updateColorRange('max', maxValue);
                updateOutlierFiltering();
            });
            
            // Max slider - on change for final update
            colorMaxSlider.addEventListener('change', (e) => {
                console.log('Max slider change completed');
                // Immediate update on mouseup
                _updatePlotColorRangeOnly();
            });
            
            // Helper function to update only the color range
            function _updatePlotColorRangeOnly() {
                // Use the centralized update system with only the color ranges
                _updatePlotElements({
                    colors: true,
                    colorRange: true, // Only update the color range (min/max)
                    colorData: false, // Don't update the actual data array
                    colorScale: false, // Don't update the color scale
                    layout: false,
                    styling: false
                });
            }
            
            // Function to apply centering to colormap
            function _applyCentering() {
                if (!_data || !_data.color || !Array.isArray(_data.color)) return;
                
                // Only apply if centering is active
                if (!_settings.centeringActive) return;
                
                // Filter out NaN values
                const validValues = _data.color.filter(v => !isNaN(v));
                
                if (validValues.length > 0) {
                    // Find the absolute maximum (positive or negative)
                    const absMax = Math.max(
                        Math.abs(Math.min(...validValues)), 
                        Math.abs(Math.max(...validValues))
                    );
                    
                    // Update the settings
                    _settings.colorMin = -absMax;
                    _settings.colorMax = absMax;
                    
                    // Update input fields
                    const colorMinInput = document.getElementById(`color-min-${_id}`);
                    const colorMaxInput = document.getElementById(`color-max-${_id}`);
                    
                    if (colorMinInput) colorMinInput.value = (-absMax).toFixed(2);
                    if (colorMaxInput) colorMaxInput.value = absMax.toFixed(2);
                    
                    // Update the sliders with appropriate constraints
                    const colorMinSlider = document.getElementById(`color-min-slider-${_id}`);
                    const colorMaxSlider = document.getElementById(`color-max-slider-${_id}`);
                    
                    if (colorMinSlider && colorMaxSlider) {
                        // When centering is active:
                        // - Min slider can only have values up to 0
                        // - Max slider can only have values from 0 up
                        
                        // Find the full data range
                        const dataMin = Math.min(...validValues);
                        const dataMax = Math.max(...validValues);
                        
                        // Set different ranges for min and max sliders
                        colorMinSlider.min = Math.min(-absMax, dataMin);
                        colorMinSlider.max = 0; // Min slider can only go up to 0
                        
                        colorMaxSlider.min = 0; // Max slider can only go from 0
                        colorMaxSlider.max = Math.max(absMax, dataMax);
                        
                        // Set values to maintain symmetry
                        colorMinSlider.value = -absMax;
                        colorMaxSlider.value = absMax;
                        
                        // Add special listener for centering mode
                        _setupCenteringSliderListeners();
                    }
                    
                    // Update the plot color range directly without redrawing
                    if (_plot && _plot.data && _plot.data[0] && _plot.data[0].marker) {
                        Plotly.restyle(_plotContainer, {
                            'marker.cmin': -absMax,
                            'marker.cmax': absMax
                        }, [0]);
                    } else {
                        // Use the helper to update only color range
                        _updatePlotColorRangeOnly();
                    }
                }
            }
            
            // Special event listeners for when centering is active
            function _setupCenteringSliderListeners() {
                const colorMinSlider = document.getElementById(`color-min-slider-${_id}`);
                const colorMaxSlider = document.getElementById(`color-max-slider-${_id}`);
                const colorMinInput = document.getElementById(`color-min-${_id}`);
                const colorMaxInput = document.getElementById(`color-max-${_id}`);
                
                if (!colorMinSlider || !colorMaxSlider) return;
                
                // Remove existing centering-specific listeners if any
                colorMinSlider.removeEventListener('input', _centeringMinSliderHandler);
                colorMaxSlider.removeEventListener('input', _centeringMaxSliderHandler);
                
                // Only add these listeners if centering is active
                if (_settings.centeringActive) {
                    // Add the listeners back
                    colorMinSlider.addEventListener('input', _centeringMinSliderHandler);
                    colorMaxSlider.addEventListener('input', _centeringMaxSliderHandler);
                }
            }
            
            // Handler for min slider during centering
            function _centeringMinSliderHandler(e) {
                if (!_settings.centeringActive) return;
                
                const minValue = parseFloat(e.target.value);
                const colorMaxSlider = document.getElementById(`color-max-slider-${_id}`);
                const colorMaxInput = document.getElementById(`color-max-${_id}`);
                const colorMinInput = document.getElementById(`color-min-${_id}`);
                
                // Ensure symmetry by setting max to negative of min
                const maxValue = -minValue;
                
                // Update settings
                _settings.colorMin = minValue;
                _settings.colorMax = maxValue;
                
                // Update UI
                colorMinInput.value = minValue.toFixed(2);
                if (colorMaxInput) colorMaxInput.value = maxValue.toFixed(2);
                if (colorMaxSlider) colorMaxSlider.value = maxValue;
                
                // Update plot
                if (_plot && _plot.data && _plot.data[0] && _plot.data[0].marker) {
                    Plotly.restyle(_plotContainer, {
                        'marker.cmin': minValue,
                        'marker.cmax': maxValue
                    }, [0]);
                }
            }
            
            // Handler for max slider during centering
            function _centeringMaxSliderHandler(e) {
                if (!_settings.centeringActive) return;
                
                const maxValue = parseFloat(e.target.value);
                const colorMinSlider = document.getElementById(`color-min-slider-${_id}`);
                const colorMinInput = document.getElementById(`color-min-${_id}`);
                const colorMaxInput = document.getElementById(`color-max-${_id}`);
                
                // Ensure symmetry by setting min to negative of max
                const minValue = -maxValue;
                
                // Update settings
                _settings.colorMin = minValue;
                _settings.colorMax = maxValue;
                
                // Update UI
                colorMaxInput.value = maxValue.toFixed(2);
                if (colorMinInput) colorMinInput.value = minValue.toFixed(2);
                if (colorMinSlider) colorMinSlider.value = minValue;
                
                // Update plot
                if (_plot && _plot.data && _plot.data[0] && _plot.data[0].marker) {
                    Plotly.restyle(_plotContainer, {
                        'marker.cmin': minValue,
                        'marker.cmax': maxValue
                    }, [0]);
                }
            }
            
            // Update centering UI based on state
            function _updateCenteringUI() {
                const centerColormapButton = document.getElementById(`center-colormap-${_id}`);
                const colorMinSlider = document.getElementById(`color-min-slider-${_id}`);
                const colorMaxSlider = document.getElementById(`color-max-slider-${_id}`);
                
                if (_settings.centeringActive) {
                    // Update button appearance
                    centerColormapButton.classList.add('active', 'btn-primary');
                    centerColormapButton.classList.remove('btn-outline-secondary');
                    centerColormapButton.setAttribute('title', 'Centering active - click to disable');
                    
                    // Add centering-specific slider listeners that maintain symmetry
                    _setupCenteringSliderListeners();
                    
                    // Apply centering immediately 
                    _applyCentering();
                } else {
                    // Update button appearance
                    centerColormapButton.classList.remove('active', 'btn-primary');
                    centerColormapButton.classList.add('btn-outline-secondary');
                    centerColormapButton.setAttribute('title', 'Center color scale at 0');
                    
                    // Remove centering-specific event listeners
                    if (colorMinSlider && colorMaxSlider) {
                        colorMinSlider.removeEventListener('input', _centeringMinSliderHandler);
                        colorMaxSlider.removeEventListener('input', _centeringMaxSliderHandler);
                        
                        // Restore normal slider ranges
                        if (_data && _data.color && Array.isArray(_data.color)) {
                            const validValues = _data.color.filter(v => !isNaN(v));
                            if (validValues.length > 0) {
                                const dataMin = Math.min(...validValues);
                                const dataMax = Math.max(...validValues);
                                
                                // Reset to full range
                                colorMinSlider.min = dataMin;
                                colorMinSlider.max = dataMax;
                                colorMaxSlider.min = dataMin; 
                                colorMaxSlider.max = dataMax;
                            }
                        }
                    }
                }
            }
            
            // Center at 0 button - toggle behavior
            const centerColormapButton = document.getElementById(`center-colormap-${_id}`);
            centerColormapButton.addEventListener('click', () => {
                // Get current state before toggling
                const wasActive = _settings.centeringActive;
                
                // Toggle the centering active state
                _settings.centeringActive = !_settings.centeringActive;
                _updateCenteringUI();
                
                if (_settings.centeringActive) {
                    // Apply centering immediately
                    _applyCentering();
                } else if (wasActive) {
                    // If deactivating centering, reset sliders to reasonable defaults
                    if (_data && _data.color && Array.isArray(_data.color)) {
                        const validValues = _data.color.filter(v => !isNaN(v));
                        if (validValues.length > 0) {
                            const dataMin = Math.min(...validValues);
                            const dataMax = Math.max(...validValues);
                            
                            // Reset to dynamic data range, but keep current values if they're within range
                            _settings.colorMin = (_settings.colorMin !== null && _settings.colorMin >= dataMin) ? 
                                                 _settings.colorMin : dataMin;
                            _settings.colorMax = (_settings.colorMax !== null && _settings.colorMax <= dataMax) ? 
                                                 _settings.colorMax : dataMax;
                            
                            // Update the plot with non-symmetrical range
                            if (_plot && _plot.data && _plot.data[0] && _plot.data[0].marker) {
                                Plotly.restyle(_plotContainer, {
                                    'marker.cmin': _settings.colorMin,
                                    'marker.cmax': _settings.colorMax
                                }, [0]);
                            }
                            
                            // Update the UI
                            const colorMinInput = document.getElementById(`color-min-${_id}`);
                            const colorMaxInput = document.getElementById(`color-max-${_id}`);
                            const colorMinSlider = document.getElementById(`color-min-slider-${_id}`);
                            const colorMaxSlider = document.getElementById(`color-max-slider-${_id}`);
                            
                            if (colorMinInput) colorMinInput.value = _settings.colorMin.toFixed(2);
                            if (colorMaxInput) colorMaxInput.value = _settings.colorMax.toFixed(2);
                            if (colorMinSlider) colorMinSlider.value = _settings.colorMin;
                            if (colorMaxSlider) colorMaxSlider.value = _settings.colorMax;
                        }
                    }
                }
            });
            
            // Hide outliers toggle
            const hideOutliersToggle = document.getElementById(`hide-outliers-${_id}`);
            hideOutliersToggle.addEventListener('change', (e) => {
                _settings.hideOutliers = e.target.checked;
                
                // Directly update the visibility of points without redrawing the plot
                if (_plot && _data.color && _data.colorType === 'numerical') {
                    try {
                        const pointVisibility = [];
                        
                        // Create an array of true/false for each point based on range
                        for (let i = 0; i < _data.color.length; i++) {
                            const val = _data.color[i];
                            if (isNaN(val)) {
                                // NaN values are always visible
                                pointVisibility.push(true);
                            } else if (_settings.hideOutliers) {
                                // When hiding outliers, only show points within range
                                const inRange = (_settings.colorMin === null || val >= _settings.colorMin) && 
                                              (_settings.colorMax === null || val <= _settings.colorMax);
                                pointVisibility.push(inRange);
                            } else {
                                // When not hiding outliers, show all points
                                pointVisibility.push(true);
                            }
                        }
                        
                        // Direct Plotly update for efficiency
                        Plotly.restyle(_plotContainer, {
                            'visible': [pointVisibility]
                        }, [0]);
                        
                        console.log(`Updated point visibility based on outlier setting: hide=${_settings.hideOutliers}`);
                    } catch (error) {
                        console.error('Error updating point visibility:', error);
                        // Fall back to standard update
                        _updatePlot();
                    }
                } else {
                    // Fall back to standard update for non-numerical data
                    _updatePlot();
                }
            });
            
            // Show grid toggle
            const showGridToggle = document.getElementById(`show-grid-${_id}`);
            // Initialize checked state from settings
            if (_settings.showGrid) {
              showGridToggle.classList.add('active', 'btn-primary');
              showGridToggle.classList.remove('btn-outline-secondary');
            } else {
              showGridToggle.classList.remove('active', 'btn-primary');
              showGridToggle.classList.add('btn-outline-secondary');
            }
            showGridToggle.addEventListener('click', () => {
                  // Toggle the setting
                  _settings.showGrid = !_settings.showGrid;
                  
                  // Update button appearance based on the new state
                  if (_settings.showGrid) {
                    showGridToggle.classList.add('active', 'btn-primary');
                    showGridToggle.classList.remove('btn-outline-secondary');
                  } else {
                    showGridToggle.classList.remove('active', 'btn-primary');
                    showGridToggle.classList.add('btn-outline-secondary');
                  }
                
                // Update grid, axes, and other line visibility without redrawing the plot
                if (_plot) {
                    const update = {
                        // Grid lines
                        'xaxis.showgrid': _settings.showGrid,
                        'yaxis.showgrid': _settings.showGrid,
                        // Axis lines
                        'xaxis.showline': _settings.showGrid,
                        'yaxis.showline': _settings.showGrid,
                        // Zero lines
                        'xaxis.zeroline': _settings.showGrid,
                        'yaxis.zeroline': _settings.showGrid,
                        // Tick marks
                        'xaxis.ticks': _settings.showGrid ? '' : 'none',
                        'yaxis.ticks': _settings.showGrid ? '' : 'none',
                        // Tick labels
                        'xaxis.showticklabels': _settings.showGrid,
                        'yaxis.showticklabels': _settings.showGrid
                    };
                    
                    // For 3D plots, add the z-axis settings
                    if (_settings.z) {
                        update['scene.xaxis.showgrid'] = _settings.showGrid;
                        update['scene.yaxis.showgrid'] = _settings.showGrid;
                        update['scene.zaxis.showgrid'] = _settings.showGrid;
                        
                        update['scene.xaxis.showline'] = _settings.showGrid;
                        update['scene.yaxis.showline'] = _settings.showGrid;
                        update['scene.zaxis.showline'] = _settings.showGrid;
                        
                        update['scene.xaxis.zeroline'] = _settings.showGrid;
                        update['scene.yaxis.zeroline'] = _settings.showGrid;
                        update['scene.zaxis.zeroline'] = _settings.showGrid;
                        
                        update['scene.xaxis.ticks'] = _settings.showGrid ? '' : 'none';
                        update['scene.yaxis.ticks'] = _settings.showGrid ? '' : 'none';
                        update['scene.zaxis.ticks'] = _settings.showGrid ? '' : 'none';
                        
                        update['scene.xaxis.showticklabels'] = _settings.showGrid;
                        update['scene.yaxis.showticklabels'] = _settings.showGrid;
                        update['scene.zaxis.showticklabels'] = _settings.showGrid;
                    }
                    
                    Plotly.relayout(_plotContainer, update);
                }
            });
            
            const lockRangeButton = document.getElementById(`lock-range-${_id}`);

            // Initialize appearance based on the setting
            if (_settings.lockColorRange) {
              lockRangeButton.classList.add('active', 'btn-primary');
              lockRangeButton.classList.remove('btn-outline-secondary');
            } else {
              lockRangeButton.classList.remove('active', 'btn-primary');
              lockRangeButton.classList.add('btn-outline-secondary');
            }
            
            lockRangeButton.addEventListener('click', () => {
              // Toggle the setting
              _settings.lockColorRange = !_settings.lockColorRange;
              
              if (_settings.lockColorRange) {
                lockRangeButton.classList.add('active', 'btn-primary');
                lockRangeButton.classList.remove('btn-outline-secondary');
              } else {
                lockRangeButton.classList.remove('active', 'btn-primary');
                lockRangeButton.classList.add('btn-outline-secondary');
              }
              
              // (Optional) If you want to trigger an update that respects the locked range:
              // _updatePlot(false); or a similar function call here.
            });
            
            // Listen for focused cell changes
            document.addEventListener('focusedCellChanged', (e) => {
                console.log(`Focused cell changed to: ${e.detail.cell}`);
                
                // Check if we're using obsp data anywhere in the plot
                const usesObspData = _settings.x.type === 'obsp' || 
                                    _settings.y.type === 'obsp' || 
                                    (_settings.z && _settings.z.type === 'obsp') ||
                                    _settings.color.type === 'obsp';
                
                if (usesObspData) {
                    // Track which axes need updates
                    const updates = {
                        xAxis: _settings.x.type === 'obsp',
                        yAxis: _settings.y.type === 'obsp',
                        zAxis: _settings.z && _settings.z.type === 'obsp',
                        colors: _settings.color.type === 'obsp',
                        layout: false
                    };
                    
                    // If this affects multiple axes, it's more efficient to recreate
                    const multiAxisUpdate = (updates.xAxis ? 1 : 0) + 
                                            (updates.yAxis ? 1 : 0) + 
                                            (updates.zAxis ? 1 : 0) > 1;
                    
                    if (multiAxisUpdate) {
                        // Multiple position axes use obsp data, need to recreate the plot
                        console.log('Focused cell changed affects multiple position axes, recreating plot');
                        _loadDataAndCreatePlot();
                        return;
                    }
                    
                    // Handle specific update scenarios
                    if (updates.xAxis) {
                        console.log('Focused cell changed affects x-axis, loading new data');
                        _loadAxisData('x').then(xData => {
                            if (xData && xData.values) {
                                _data.x = xData;
                                _updatePlotElements({ 
                                    xAxis: true,
                                    layout: true 
                                });
                            } else {
                                _loadDataAndCreatePlot();
                            }
                        }).catch(() => _loadDataAndCreatePlot());
                    }
                    else if (updates.yAxis) {
                        console.log('Focused cell changed affects y-axis, loading new data');
                        _loadAxisData('y').then(yData => {
                            if (yData && yData.values) {
                                _data.y = yData;
                                _updatePlotElements({ 
                                    yAxis: true,
                                    layout: true 
                                });
                            } else {
                                _loadDataAndCreatePlot();
                            }
                        }).catch(() => _loadDataAndCreatePlot());
                    }
                    else if (updates.zAxis) {
                        console.log('Focused cell changed affects z-axis, loading new data');
                        _loadAxisData('z').then(zData => {
                            if (zData && zData.values) {
                                _data.z = zData;
                                _updatePlotElements({ 
                                    zAxis: true,
                                    layout: true 
                                });
                            } else {
                                _loadDataAndCreatePlot();
                            }
                        }).catch(() => _loadDataAndCreatePlot());
                    }
                    else if (updates.colors) {
                        // Only color uses obsp data - we can use optimized update
                        console.log('Focused cell changed, only affects color data - using optimized update');
                        _loadColorDataAndUpdatePlot();
                    }
                } else {
                    console.log('Focused cell changed does not affect this plot');
                }
            });
            
            /**
             * Update axis titles and menu labels to reflect the current focused gene
             * @private
             */
            function _updateAxisLabelsForGene(focusedGene) {
                if (!_plot) return;
                
                // Update UI controls in menus to show correct gene name
                const updateColumnSelectOptions = (axis) => {
                    if (_settings[axis] && _settings[axis].type === 'layer') {
                        const columnSelect = _container.querySelector(`.axis-column-select[data-axis="${axis}"]`);
                        if (columnSelect && columnSelect.options.length > 0) {
                            // Update the option text to show the new gene name
                            columnSelect.options[0].text = `Expression of ${focusedGene}`;
                        }
                    }
                };
                
                // Update all axis column selects
                updateColumnSelectOptions('x');
                updateColumnSelectOptions('y');
                updateColumnSelectOptions('z');
                updateColumnSelectOptions('color');
                
                // Create layout update for axis titles
                const layoutUpdate = {};
                
                // Update axis titles in the plot
                if (_settings.x.type === 'layer') {
                    const newTitle = `${_settings.x.type}.${_settings.x.key}.${focusedGene}`;
                    if (_settings.z) {
                        // 3D plot
                        layoutUpdate['scene.xaxis.title'] = newTitle;
                    } else {
                        // 2D plot
                        layoutUpdate['xaxis.title'] = newTitle;
                    }
                }
                
                if (_settings.y.type === 'layer') {
                    const newTitle = `${_settings.y.type}.${_settings.y.key}.${focusedGene}`;
                    if (_settings.z) {
                        // 3D plot
                        layoutUpdate['scene.yaxis.title'] = newTitle;
                    } else {
                        // 2D plot
                        layoutUpdate['yaxis.title'] = newTitle;
                    }
                }
                
                if (_settings.z && _settings.z.type === 'layer') {
                    const newTitle = `${_settings.z.type}.${_settings.z.key}.${focusedGene}`;
                    layoutUpdate['scene.zaxis.title'] = newTitle;
                }
                
                // Update colorbar title if needed
                if (_settings.color.type === 'layer') {
                    // Create a title object with proper vertical formatting
                    // Note: we only set the properties on the title object itself
                    // and don't set titleside separately to avoid Plotly errors
                    const newTitle = {
                        text: `${_settings.color.type}.${_settings.color.key}.${focusedGene}`,
                        side: 'right',
                        font: {
                            size: 12
                        }
                    };
                    
                    // Only update the title object itself
                    layoutUpdate['coloraxis.colorbar.title'] = newTitle;
                    // Do NOT set titleside separately - it's already in the title object
                }
                
                // Apply all layout updates at once if we have any
                if (Object.keys(layoutUpdate).length > 0) {
                    console.log("Updating axis titles for new focused gene:", layoutUpdate);
                    Plotly.relayout(_plotContainer, layoutUpdate);
                }
            }
            
            // Listen for focused gene changes
            document.addEventListener('focusedGeneChanged', (e) => {
                console.log(`Focused gene changed to: ${e.detail.gene}`);
                const focusedGene = e.detail.gene;
                
                // Check if we're using layer data anywhere in the plot
                const usesLayerData = _settings.x.type === 'layer' || 
                                     _settings.y.type === 'layer' || 
                                     (_settings.z && _settings.z.type === 'layer') ||
                                     _settings.color.type === 'layer';
                
                if (usesLayerData) {
                    // Update all the labels that reference genes even before loading any data
                    _updateAxisLabelsForGene(focusedGene);
                    
                    // Track which axes need data updates
                    const updates = {
                        xAxis: _settings.x.type === 'layer',
                        yAxis: _settings.y.type === 'layer',
                        zAxis: _settings.z && _settings.z.type === 'layer',
                        colors: _settings.color.type === 'layer'
                    };
                    
                    // For position data updates, we now handle them individually without redrawing
                    const dataUpdatePromises = [];
                    
                    // If x-axis uses layer data, load new data
                    if (updates.xAxis) {
                        console.log('Focused gene changed affects x-axis, loading new data');
                        const xPromise = _loadAxisData('x').then(xData => {
                            if (xData && xData.values) {
                                _data.x = xData;
                                // Update just the x-axis data without redrawing
                                return Plotly.restyle(_plotContainer, { 'x': [xData.values] }, [0]);
                            }
                        }).catch(err => {
                            console.error("Error loading x-axis data:", err);
                        });
                        dataUpdatePromises.push(xPromise);
                    }
                    
                    // If y-axis uses layer data, load new data
                    if (updates.yAxis) {
                        console.log('Focused gene changed affects y-axis, loading new data');
                        const yPromise = _loadAxisData('y').then(yData => {
                            if (yData && yData.values) {
                                _data.y = yData;
                                // Update just the y-axis data without redrawing
                                return Plotly.restyle(_plotContainer, { 'y': [yData.values] }, [0]);
                            }
                        }).catch(err => {
                            console.error("Error loading y-axis data:", err);
                        });
                        dataUpdatePromises.push(yPromise);
                    }
                    
                    // If z-axis uses layer data, load new data
                    if (updates.zAxis) {
                        console.log('Focused gene changed affects z-axis, loading new data');
                        const zPromise = _loadAxisData('z').then(zData => {
                            if (zData && zData.values) {
                                _data.z = zData;
                                // Update just the z-axis data without redrawing
                                return Plotly.restyle(_plotContainer, { 'z': [zData.values] }, [0]);
                            }
                        }).catch(err => {
                            console.error("Error loading z-axis data:", err);
                        });
                        dataUpdatePromises.push(zPromise);
                    }
                    
                    // If color uses layer data, load and update new data
                    if (updates.colors) {
                        console.log('Focused gene changed affects color data, loading new data');
                        // Load just the color data and update
                        _loadColorDataAndUpdatePlot();
                    }
                    
                    // After all position data updates complete (if any), handle edge cases
                    if (dataUpdatePromises.length > 0) {
                        Promise.all(dataUpdatePromises)
                            .then(() => {
                                console.log("All position data updates completed");
                            })
                            .catch(err => {
                                console.error("Error during position data updates:", err);
                                // Only redraw as a last resort if we hit errors
                                _loadDataAndCreatePlot();
                            });
                    }
                } else {
                    console.log('Focused gene changed does not affect this plot');
                }
            });
        }
        
        /**
         * Load only color data and update the plot without recreating it
         * @private 
         */
        async function _loadColorDataAndUpdatePlot() {
            try {
                // Track if centering was active before updating
                const wasCenteringActive = _settings.centeringActive;
                
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
                    
                    // Restore centering state
                    _settings.centeringActive = wasCenteringActive;
                    
                    // Update min and max slider ranges based on new data before updating plot
                    if (_data.colorType === 'numerical') {
                        const colorMinSlider = document.getElementById(`color-min-slider-${_id}`);
                        const colorMaxSlider = document.getElementById(`color-max-slider-${_id}`);
                        const colorMinInput = document.getElementById(`color-min-${_id}`);
                        const colorMaxInput = document.getElementById(`color-max-${_id}`);
                        
                        if (colorMinSlider && colorMaxSlider) {
                            // Filter out NaN values for min/max calculations
                            const validColorValues = _data.color.filter(val => !isNaN(val));
                            const dataMin = Math.min(...validColorValues);
                            const dataMax = Math.max(...validColorValues);
                            
                            // Set slider range - this doesn't trigger events
                            colorMinSlider.min = dataMin;
                            colorMinSlider.max = dataMax;
                            colorMaxSlider.min = dataMin;
                            colorMaxSlider.max = dataMax;
                            
                            // Set reasonable step size
                            const range = dataMax - dataMin;
                            const step = range > 100 ? 1 : range > 10 ? 0.1 : range > 1 ? 0.01 : 0.001;
                            colorMinSlider.step = step;
                            colorMaxSlider.step = step;
                            
                            // If color range is not locked, update to the new data range
                            // Otherwise, keep the existing values
                            if (!_settings.lockColorRange) {
                                // Update the actual values if not locked
                                colorMinSlider.value = dataMin;
                                colorMaxSlider.value = dataMax;
                                colorMinInput.value = dataMin.toFixed(2);
                                colorMaxInput.value = dataMax.toFixed(2);
                                _settings.colorMin = dataMin;
                                _settings.colorMax = dataMax;
                            } else {
                                console.log("Color range is locked, keeping previous min/max values");
                                // When locked, keep the existing min/max values even if outside data range
                                // We'll just expand the slider UI range to include both data and user values
                                
                                // Expand slider range if needed to include both data and user values
                                const minSliderRange = Math.min(_settings.colorMin, dataMin);
                                const maxSliderRange = Math.max(_settings.colorMax, dataMax);
                                
                                // Update slider ranges to accommodate all values
                                colorMinSlider.min = minSliderRange;
                                colorMaxSlider.min = minSliderRange;
                                colorMinSlider.max = maxSliderRange;
                                colorMaxSlider.max = maxSliderRange;
                                
                                // Keep the current values (not changing them)
                                colorMinSlider.value = _settings.colorMin;
                                colorMaxSlider.value = _settings.colorMax;
                            }
                        }
                    }
                    
                    // Use the centralized update system to handle the color update
                    _updatePlotElements({
                        colors: true,
                        colorData: true,  // New color data loaded
                        colorScale: true, // May need to update color scale
                        colorRange: true, // May need to update color range
                        layout: true
                    });
                    
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
                          // Get the global dataset structure for the current obsm key
                          const ds = getGlobalDatasetStructure();
                          if (ds && ds.obsm && ds.obsm.dataframes && ds.obsm.dataframes[settings.key]) {
                            const df = ds.obsm.dataframes[settings.key];
                            if (df.columns && df.columns.length > 0) {
                              if (axis === 'x') {
                                settings.column = df.columns[0]; // First column for x-axis
                              } else if (axis === 'y') {
                                settings.column = df.columns.length >= 2 ? df.columns[1] : df.columns[0];
                              } else if (axis === 'z') {
                                if (df.columns.length >= 3) {
                                  settings.column = df.columns[2];
                                } else if (df.columns.length >= 2) {
                                  settings.column = df.columns[1];
                                } else {
                                  settings.column = df.columns[0];
                                }
                              }
                              console.log(`Setting default column '${settings.column}' for ${axis}-axis obsm.${settings.key}`);
                            } else {
                              settings.column = '0';
                              console.log(`No columns found in global dataset for obsm.${settings.key}, defaulting ${axis}-axis column to '0'`);
                            }
                          } else {
                            settings.column = '0';
                            console.log(`Global dataset structure does not have obsm.${settings.key}, defaulting ${axis}-axis column to '0'`);
                          }
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
                        
                        // Ensure values is a 1D array of numbers (or NaN)
                        if (values && values.length > 0) {
                            // Replace null/undefined with NaN for consistency
                            values = values.map(v => (v === null || v === undefined) ? NaN : v);
                            
                            // Check if values need conversion
                            const firstVal = values[0];
                            if (typeof firstVal === 'object') {
                                console.warn('Obsp values are objects, attempting to convert to numbers');
                                values = values.map(v => {
                                    if (v === null || v === undefined) return NaN;
                                    if (typeof v === 'number') return v;
                                    // Try to extract a number from an object
                                    if (typeof v === 'object' && 'value' in v) return v.value;
                                    return NaN;
                                });
                            } else if (typeof firstVal === 'string') {
                                console.warn('Obsp values are strings, attempting to convert to numbers');
                                values = values.map(v => {
                                    if (v === null || v === undefined) return NaN;
                                    const parsed = parseFloat(v);
                                    return isNaN(parsed) ? NaN : parsed;
                                });
                            }
                            
                            // Log NaN count after processing
                            const nanCount = values.filter(val => isNaN(val)).length;
                            console.log(`Processed obsp data to ${values.length} values with ${nanCount} NaN values`);
                            console.log(`Sample values after processing: ${values.slice(0, 5)}`);
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
                        
                        // Ensure values is a 1D array of numbers (or NaN)
                        if (values.length > 0) {
                            // Check if we need to convert values
                            const firstVal = values[0];
                            if (typeof firstVal === 'object') {
                                console.warn('Layer values are objects, attempting to convert to numbers');
                                values = values.map(v => {
                                    if (v === null || v === undefined) return NaN;
                                    if (typeof v === 'number') return v;
                                    // Try to extract a number from an object
                                    if (typeof v === 'object' && 'value' in v) return v.value;
                                    return NaN;
                                });
                            } else if (typeof firstVal === 'string') {
                                console.warn('Layer values are strings, attempting to convert to numbers');
                                values = values.map(v => {
                                    if (v === null || v === undefined) return NaN;
                                    const parsed = parseFloat(v);
                                    return isNaN(parsed) ? NaN : parsed;
                                });
                            }
                            
                            // Validate the processed data
                            console.log(`Processed layer data to ${values.length} values of type ${typeof values[0]}`);
                            console.log(`Sample values after processing: ${values.slice(0, 5)}`);
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

            // Create layout
            const layout = {
                autosize: true,
                margin: { l: 40, r: 40, t: 40, b: 40 },
                hovermode: 'closest',
                xaxis: {
                    title: `${_settings.x.type}.${_settings.x.key}` +
                           (_settings.x.column ? `.${_settings.x.column}` : ''),
                    showgrid: _settings.showGrid,
                    gridcolor: 'rgba(200, 200, 200, 0.2)',
                    showline: _settings.showGrid,
                    zeroline: _settings.showGrid,
                    ticks: _settings.showGrid ? '' : 'none',
                    showticklabels: _settings.showGrid
                },
                yaxis: {
                    title: `${_settings.y.type}.${_settings.y.key}` +
                           (_settings.y.column ? `.${_settings.y.column}` : ''),
                    showgrid: _settings.showGrid,
                    gridcolor: 'rgba(200, 200, 200, 0.2)',
                    showline: _settings.showGrid,
                    zeroline: _settings.showGrid,
                    ticks: _settings.showGrid ? '' : 'none',
                    showticklabels: _settings.showGrid
                }
            };
            
            // Add z-axis title for 3D plots
            if (_settings.z) {
                layout.scene = {
                    xaxis: { 
                        title: layout.xaxis.title,
                        showgrid: _settings.showGrid,
                        gridcolor: 'rgba(200, 200, 200, 0.2)',
                        showline: _settings.showGrid,
                        zeroline: _settings.showGrid,
                        ticks: _settings.showGrid ? '' : 'none',
                        showticklabels: _settings.showGrid
                    },
                    yaxis: { 
                        title: layout.yaxis.title,
                        showgrid: _settings.showGrid,
                        gridcolor: 'rgba(200, 200, 200, 0.2)',
                        showline: _settings.showGrid,
                        zeroline: _settings.showGrid,
                        ticks: _settings.showGrid ? '' : 'none',
                        showticklabels: _settings.showGrid
                    },
                    zaxis: {
                        title: `${_settings.z.type}.${_settings.z.key}` +
                               (_settings.z.column ? `.${_settings.z.column}` : ''),
                        showgrid: _settings.showGrid,
                        gridcolor: 'rgba(200, 200, 200, 0.2)',
                        showline: _settings.showGrid,
                        zeroline: _settings.showGrid,
                        ticks: _settings.showGrid ? '' : 'none',
                        showticklabels: _settings.showGrid
                    }
                };
                
                // Remove 2D axis titles for 3D plots
                delete layout.xaxis;
                delete layout.yaxis;
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
                                layout.showlegend = true;
                                layout.legend = { 
                                  ...layout.legend,  // preserve any existing legend settings
                                  title: { text: _settings.color.key }
                                };
                                
                                // Create the plot with multiple traces
                                _plotContainer.innerHTML = ''
                                Plotly.newPlot(_plotContainer, traces, layout, window.plotlyDefaultConfig || {
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
                            _plotContainer.innerHTML = ''
                            Plotly.newPlot(_plotContainer, traces, {
                                showlegend: true,
                                legend: {
                                    title: { text: _settings.color.key }
                                }
                            }, window.plotlyDefaultConfig || {
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
                
                // Add colorbar with vertical title
                trace.marker.colorbar = {
                    title: {
                        text: `${_settings.color.type}.${_settings.color.key}` +
                              (_settings.color.column ? `.${_settings.color.column}` : ''),
                        side: 'right',  // Place title on right side
                        font: {
                            size: 12
                        }
                    },
                    titleside: 'right'  // Right side vertical text
                };
            } else if (_data.colorType === 'constant') {
                // Use a constant color (default to light grey)
                trace.marker.color = 'rgba(150, 150, 150, 0.7)';
                delete trace.marker.colorscale;
                
                console.log('Using constant color for all points');
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
                    ...layout.legend,  // preserve any existing legend settings
                    title: { text: _settings.color.key } 
                };
            }
            
            // Create the plot
            _plotContainer.innerHTML = ''
            Plotly.newPlot(_plotContainer, traces, layout, window.plotlyDefaultConfig || {
                responsive: true,
                displayModeBar: true,
                displaylogo: false,
                modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d']
            });

            if (_data.colorType === 'numerical') {
                // Make a deep clone of the traces to preserve the original data.
                _fullPlotData = JSON.parse(JSON.stringify(traces));
            } else {
                _fullPlotData = null;
            }
            
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
            const colorMinSlider = document.getElementById(`color-min-slider-${_id}`);
            const colorMaxSlider = document.getElementById(`color-max-slider-${_id}`);
            const centerColormapButton = document.getElementById(`center-colormap-${_id}`);
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
                colorMinSlider.style.display = 'block';
                colorMaxSlider.style.display = 'block';
                centerColormapButton.style.display = 'block';
                hideOutliersToggle.parentElement.style.display = 'block';
                
                // Show numerical label, hide categorical label
                numericalLabel.style.display = 'inline';
                categoricalLabel.style.display = 'none';
                
                // Filter out NaN values for min/max calculations
                const validColorValues = _data.color.filter(val => !isNaN(val));
                const dataMin = Math.min(...validColorValues);
                const dataMax = Math.max(...validColorValues);
                
                // Set up sliders
                colorMinSlider.min = dataMin;
                colorMinSlider.max = dataMax;
                colorMaxSlider.min = dataMin;
                colorMaxSlider.max = dataMax;
                
                // Set slider step to a reasonable value based on data range
                const range = dataMax - dataMin;
                const step = range > 100 ? 1 : range > 10 ? 0.1 : range > 1 ? 0.01 : 0.001;
                colorMinSlider.step = step;
                colorMaxSlider.step = step;
                
                // Set min/max input defaults if not already set
                if (colorMinInput.value === '') {
                    colorMinInput.placeholder = dataMin.toFixed(2);
                    colorMinSlider.value = dataMin;
                } else {
                    colorMinSlider.value = _settings.colorMin !== null ? _settings.colorMin : dataMin;
                }
                
                if (colorMaxInput.value === '') {
                    colorMaxInput.placeholder = dataMax.toFixed(2);
                    colorMaxSlider.value = dataMax;
                } else {
                    colorMaxSlider.value = _settings.colorMax !== null ? _settings.colorMax : dataMax;
                }
            } else if (_data.colorType === 'categorical') {
                // Show categorical color controls
                colorRangeContainer.style.display = 'flex';
                colorScaleSelect.style.display = 'none';
                categoryPaletteSelect.style.display = 'block';
                colorMinInput.style.display = 'none';
                colorMaxInput.style.display = 'none';
                colorMinSlider.style.display = 'none';
                colorMaxSlider.style.display = 'none';
                centerColormapButton.style.display = 'none';
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
        /**
         * Centralized function to efficiently update plot elements
         * @param {Object} options - Update options
         * @param {boolean} options.xAxis - Whether to update x-axis data
         * @param {boolean} options.yAxis - Whether to update y-axis data
         * @param {boolean} options.zAxis - Whether to update z-axis data
         * @param {boolean} options.colors - Whether to update any coloring properties
         * @param {boolean} options.colorData - Whether to update the color data array (set to true for new color data)
         * @param {boolean} options.colorScale - Whether to update the color scale only
         * @param {boolean} options.colorRange - Whether to update color range (min/max) only
         * @param {boolean} options.styling - Whether to update visual styling
         * @param {boolean} options.layout - Whether to update layout properties 
         * @private
         */
        function _updatePlotElements(options = {}) {
            const defaultOptions = {
                xAxis: false,
                yAxis: false,
                zAxis: false,
                colors: false,
                colorData: false,
                colorScale: false,
                colorRange: false,
                styling: false,
                layout: false
            };
            
            // Merge provided options with defaults
            const updateOptions = { ...defaultOptions, ...options };
            
            // Apply centering if active (before any updates)
            if (_settings.centeringActive && updateOptions.colors) {
                _applyCentering();
            }
            
            // If plot doesn't exist, create it
            if (!_plot) {
                console.warn("Plot doesn't exist yet, creating it instead of updating");
                _loadDataAndCreatePlot();
                return;
            }
            
            try {
                // POSITION DATA UPDATES (most significant changes)
                // If position axes data change is needed, check if we need a full redraw
                const positionChange = updateOptions.xAxis || updateOptions.yAxis || updateOptions.zAxis;
                
                if (positionChange) {
                    // Check if we're switching between 2D and 3D - always need complete redraw
                    const is3D = _plot.data[0].type === 'scatter3d';
                    const shouldBe3D = _settings.z !== null;
                    
                    if (is3D !== shouldBe3D) {
                        console.log("Switching between 2D and 3D plot types - recreating plot");
                        _loadDataAndCreatePlot();
                        return;
                    }
                    
                    // Update position data
                    const update = {};
                    if (updateOptions.xAxis && _data.x && _data.x.values) {
                        update.x = [_data.x.values];
                    }
                    
                    if (updateOptions.yAxis && _data.y && _data.y.values) {
                        update.y = [_data.y.values];
                    }
                    
                    if (updateOptions.zAxis && _data.z && _data.z.values && shouldBe3D) {
                        update.z = [_data.z.values];
                    }
                    
                    if (Object.keys(update).length > 0) {
                        console.log("Updating position data:", update);
                        Plotly.restyle(_plotContainer, update, [0]);
                    }
                }
                
                // COLOR DATA UPDATES
                if (updateOptions.colors && _data.color) {
                    // Check if we need to handle categorical vs numerical transition
                    const isCategorical = _data.colorType === 'categorical';
                    const hasMultipleTraces = _plot.data && _plot.data.length > 1;
                    
                    // Only check categorical vs. numerical transitions when we're actually 
                    // changing the color data, not just updating ranges
                    if (updateOptions.colorData) {
                        // If changing between categorical and numerical, we need a complete recreation
                        if ((isCategorical && !hasMultipleTraces) || (!isCategorical && hasMultipleTraces)) {
                            console.log("Switching between categorical and numerical coloring - recreating plot");
                            _loadDataAndCreatePlot();
                            return;
                        }
                    }
                    
                    // For categorical coloring, we need to recreate as we use multiple traces
                    // But only when we're actually changing color data
                    if (isCategorical && updateOptions.colorData) {
                        console.log("Categorical coloring requires recreating the plot");
                        _loadDataAndCreatePlot();
                        return;
                    }
                    
                    // For numerical data with many NaN values, recreation is safer
                    if (_data.colorType === 'numerical' && _data.color && _data.color.length > 0) {
                        
                        // Check what specific color properties need updating
                        // This allows for more targeted updates
                        const update = {};
                        
                        // Only include the full color array if the actual data changed
                        // This prevents unnecessary data transfer during slider interactions
                        if (updateOptions.colorData) {
                            update['marker.color'] = [_data.color];
                        }
                        
                        // Include colorscale if specified or if color data changed
                        if (updateOptions.colorScale || updateOptions.colorData) {
                            update['marker.colorscale'] = _settings.colorScale;
                        }
                        
                        // Add color range if specified
                        if (_settings.colorMin !== null && (updateOptions.colorRange || updateOptions.colorData)) {
                            update['marker.cmin'] = _settings.colorMin;
                        }
                        
                        if (_settings.colorMax !== null && (updateOptions.colorRange || updateOptions.colorData)) {
                            update['marker.cmax'] = _settings.colorMax;
                        }
                        
                        // Only apply updates if there's something to update
                        if (Object.keys(update).length > 0) {
                            // Apply color updates
                            console.log("Applying color updates:", update);
                            Plotly.restyle(_plotContainer, update, [0]);
                        }
                        
                        // Update colorbar title with separate layout update
                        if (updateOptions.layout || updateOptions.colorData) {
                            // Only update title if we have a real color type (not 'none')
                            if (_settings.color.type !== 'none') {
                                // Create a title object with proper vertical formatting
                                const newTitle = {
                                    text: `${_settings.color.type}.${_settings.color.key}` +
                                         (_settings.color.column ? `.${_settings.color.column}` : ''),
                                    side: 'right',
                                    font: {
                                        size: 12
                                    }
                                };
                                
                                Plotly.relayout(_plotContainer, {
                                    'coloraxis.colorbar.title': newTitle,
                                });
                            }
                        }
                    }
                }
                
                // STYLING UPDATES (size, opacity)
                if (updateOptions.styling) {
                    console.log("Updating visual styling");
                    
                    const update = {
                        'marker.size': _settings.pointSize,
                        'marker.opacity': _settings.pointOpacity
                    };
                    
                    // Apply to all traces
                    const traceIndices = Array.from({length: _plot.data.length}, (_, i) => i);
                    Plotly.restyle(_plotContainer, update, traceIndices);
                }
                
                // OTHER LAYOUT UPDATES
                if (updateOptions.layout) {
                    // Update any other layout elements like titles, axes, etc.
                    // This section can be expanded as needed
                    console.log("Updating layout properties");
                    // Currently handled with specific color updates above
                }
                
                // Only update the UI if we made color changes and it's numerical data
                if (updateOptions.colors && _data && _data.color && 
                    Array.isArray(_data.color) && _data.colorType === 'numerical') {
                    try {
                        // Only call if we have a valid function defined in this context
                        if (typeof _updateCenteringUI === 'function') {
                            _updateCenteringUI();
                        }
                    } catch (e) {
                        console.warn('Could not update centering UI:', e);
                    }
                }
                
            } catch (error) {
                console.error("Error updating plot:", error);
                console.log("Falling back to recreating the plot");
                _loadDataAndCreatePlot();
            }
        }

        /**
         * Update plot with current settings without recreating it
         * @param {boolean} fullDataUpdate - Whether to update all data or just visual properties 
         * @private
         */
        function _updatePlot(fullDataUpdate = false) {
            console.log(`Updating plot (fullDataUpdate=${fullDataUpdate})`);
            
            if (fullDataUpdate) {
                // For full data updates, update colors and data
                _updatePlotElements({
                    colors: true,
                    colorData: true,  // Include the full color data array
                    colorScale: true, // Update the color scale
                    colorRange: true, // Update the color range
                    styling: true,
                    layout: true
                });
            } else {
                // For visual-only updates
                _updatePlotElements({
                    styling: true,
                    colors: _settings.colorMin !== null || _settings.colorMax !== null,
                    colorRange: _settings.colorMin !== null || _settings.colorMax !== null,
                    colorData: false // Don't update the actual color data array
                });
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
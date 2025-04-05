/**
 * Data Manager module for AnnZarro
 * Handles loading and processing data from the backend API
 */
const DataManager = (function() {
    // Private variables
    let _currentDataset = null;
    let _datasetStructure = null;
    let _cells = null;
    let _genes = null;
    let _focusedCell = null;
    let _focusedGene = null;
    let _taxonomyId = Config.DEFAULTS.TAXONOMY_ID;
    
    // Cache for API responses
    const _cache = new Map();
    
    /**
     * Fetch data from API with caching
     * @param {string} url - API URL
     * @param {Object} params - URL parameters
     * @returns {Promise<Object>} - API response
     */
    async function _fetchWithCache(url, params = {}) {
        // Generate cache key from URL and params
        const queryString = new URLSearchParams(params).toString();
        const cacheKey = `${url}?${queryString}`;
        
        // Check cache first
        if (_cache.has(cacheKey)) {
            return _cache.get(cacheKey);
        }
        
        // Construct full URL with parameters
        const fullUrl = `${url}?${queryString}`;
        
        try {
            const response = await fetch(fullUrl);
            if (!response.ok) {
                throw new Error(`API error: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            // Cache the response
            _cache.set(cacheKey, data);
            
            return data;
        } catch (error) {
            console.error('Error fetching data:', error);
            throw error;
        }
    }
    
    /**
     * Clear cache for specific pattern or all items
     * @param {string} pattern - Optional URL pattern to match
     */
    function _clearCache(pattern = null) {
        if (pattern) {
            // Delete only matching entries
            for (const key of _cache.keys()) {
                if (key.includes(pattern)) {
                    _cache.delete(key);
                }
            }
        } else {
            // Clear entire cache
            _cache.clear();
        }
    }
    
    /**
     * Load list of available datasets
     * @returns {Promise<Array>} - List of datasets
     */
    async function loadDatasets() {
        try {
            const data = await _fetchWithCache(Config.API.DATASETS);
            return data;
        } catch (error) {
            console.error('Error loading datasets:', error);
            return [];
        }
    }
    
    /**
     * Set the current dataset and load basic information
     * @param {string} datasetPath - Path to the dataset
     * @returns {Promise<Object>} - Dataset info
     */
    async function setCurrentDataset(datasetPath) {
        try {
            _currentDataset = datasetPath;
            
            // Clear cached data for previous dataset
            _clearCache();
            
            // Load dataset structure
            _datasetStructure = await loadDatasetStructure(datasetPath);
            
            // Load cells and genes
            _cells = await loadCells(datasetPath);
            _genes = await loadGenes(datasetPath);
            
            // Reset focused items
            _focusedCell = null;
            _focusedGene = null;
            
            return _datasetStructure;
        } catch (error) {
            console.error('Error setting dataset:', error);
            throw error;
        }
    }
    
    /**
     * Load complete dataset structure
     * @param {string} datasetPath - Path to the dataset
     * @returns {Promise<Object>} - Dataset structure
     */
    async function loadDatasetStructure(datasetPath) {
        try {
            const data = await _fetchWithCache(Config.API.DATASET_STRUCTURE, { dataset_path: datasetPath });
            return data;
        } catch (error) {
            console.error('Error loading dataset structure:', error);
            throw error;
        }
    }
    
    /**
     * Load cell names from the dataset
     * @param {string} datasetPath - Path to the dataset
     * @returns {Promise<Array<string>>} - List of cell names
     */
    async function loadCells(datasetPath) {
        try {
            const data = await _fetchWithCache(Config.API.CELLS, { dataset_path: datasetPath });
            return data.cells;
        } catch (error) {
            console.error('Error loading cells:', error);
            return [];
        }
    }
    
    /**
     * Load gene names from the dataset
     * @param {string} datasetPath - Path to the dataset
     * @returns {Promise<Array<string>>} - List of gene names
     */
    async function loadGenes(datasetPath) {
        try {
            const data = await _fetchWithCache(Config.API.GENES, { dataset_path: datasetPath });
            return data.genes;
        } catch (error) {
            console.error('Error loading genes:', error);
            return [];
        }
    }
    
    /**
     * Load observation (cell) annotations
     * @param {Object} options - Options for loading obs data
     * @param {string} options.datasetPath - Path to the dataset
     * @param {Array<string>} options.columns - Columns to load (optional)
     * @param {Array<number>} options.rows - Row indices to load (optional)
     * @param {number} options.maxCells - Maximum cells to load (optional)
     * @returns {Promise<Object>} - Observation data
     */
    async function loadObs(options) {
        const { datasetPath, columns, rows, maxCells } = options;
        
        const params = {
            dataset_path: datasetPath || _currentDataset
        };
        
        if (columns && columns.length > 0) {
            params.columns = columns.join(',');
        }
        
        if (rows && rows.length > 0) {
            params.rows = rows.join(',');
        }
        
        if (maxCells) {
            params.max_cells = maxCells;
        }
        
        try {
            const data = await _fetchWithCache(Config.API.OBS, params);
            return data;
        } catch (error) {
            console.error('Error loading obs data:', error);
            throw error;
        }
    }
    
    /**
     * Load variable (gene) annotations
     * @param {Object} options - Options for loading var data
     * @param {string} options.datasetPath - Path to the dataset
     * @param {Array<string>} options.columns - Columns to load (optional)
     * @param {Array<number>} options.cols - Column indices to load (optional)
     * @param {number} options.maxGenes - Maximum genes to load (optional)
     * @returns {Promise<Object>} - Variable data
     */
    async function loadVar(options) {
        const { datasetPath, columns, cols, maxGenes } = options;
        
        const params = {
            dataset_path: datasetPath || _currentDataset
        };
        
        if (columns && columns.length > 0) {
            params.columns = columns.join(',');
        }
        
        if (cols && cols.length > 0) {
            params.cols = cols.join(',');
        }
        
        if (maxGenes) {
            params.max_genes = maxGenes;
        }
        
        try {
            const data = await _fetchWithCache(Config.API.VAR, params);
            return data;
        } catch (error) {
            console.error('Error loading var data:', error);
            throw error;
        }
    }
    
    /**
     * Load obsm data (multi-dimensional cell annotations)
     * @param {Object} options - Options for loading obsm data
     * @param {string} options.datasetPath - Path to the dataset
     * @param {string} options.obsmKey - Key in obsm to load
     * @param {string} options.columnName - Column within obsm key (optional)
     * @param {Array<number>} options.rows - Row indices to load (optional)
     * @param {Array<number>} options.cols - Column indices to load (optional)
     * @param {number} options.maxCells - Maximum cells to load (optional)
     * @returns {Promise<Object>} - obsm data
     */
    async function loadObsm(options) {
        const { datasetPath, obsmKey, columnName, rows, cols, maxCells } = options;
        
        const params = {
            dataset_path: datasetPath || _currentDataset
        };
        
        if (rows && rows.length > 0) {
            params.rows = rows.join(',');
        }
        
        if (cols && cols.length > 0) {
            params.cols = cols.join(',');
        }
        
        if (columnName) {
            params.column_name = columnName;
        }
        
        if (maxCells) {
            params.max_cells = maxCells;
        }
        
        try {
            const url = `${Config.API.OBSM}/${obsmKey}`;
            const data = await _fetchWithCache(url, params);
            return data;
        } catch (error) {
            console.error(`Error loading obsm.${obsmKey} data:`, error);
            throw error;
        }
    }
    
    /**
     * Load varm data (multi-dimensional gene annotations)
     * @param {Object} options - Options for loading varm data
     * @param {string} options.datasetPath - Path to the dataset
     * @param {string} options.varmKey - Key in varm to load
     * @param {string} options.columnName - Column within varm key (optional)
     * @param {Array<number>} options.rows - Row indices to load (optional)
     * @param {Array<number>} options.cols - Column indices to load (optional)
     * @param {number} options.maxGenes - Maximum genes to load (optional)
     * @returns {Promise<Object>} - varm data
     */
    async function loadVarm(options) {
        const { datasetPath, varmKey, columnName, rows, cols, maxGenes } = options;
        
        const params = {
            dataset_path: datasetPath || _currentDataset
        };
        
        if (rows && rows.length > 0) {
            params.rows = rows.join(',');
        }
        
        if (cols && cols.length > 0) {
            params.cols = cols.join(',');
        }
        
        if (columnName) {
            params.column_name = columnName;
        }
        
        if (maxGenes) {
            params.max_genes = maxGenes;
        }
        
        try {
            const url = `${Config.API.VARM}/${varmKey}`;
            const data = await _fetchWithCache(url, params);
            return data;
        } catch (error) {
            console.error(`Error loading varm.${varmKey} data:`, error);
            throw error;
        }
    }
    
    /**
     * Load obsp data (cell-cell relationships)
     * @param {Object} options - Options for loading obsp data
     * @param {string} options.datasetPath - Path to the dataset
     * @param {string} options.obspKey - Key in obsp to load
     * @param {Array<number>} options.rows - Row indices to load (optional)
     * @param {number} options.maxCells - Maximum cells to load (optional)
     * @returns {Promise<Object>} - obsp data
     */
    async function loadObsp(options) {
        const { datasetPath, obspKey, rows, maxCells } = options;
        
        const params = {
            dataset_path: datasetPath || _currentDataset
        };
        
        if (rows && rows.length > 0) {
            params.rows = rows.join(',');
        }
        
        if (maxCells) {
            params.max_cells = maxCells;
        }
        
        try {
            const url = `${Config.API.OBSP}/${obspKey}`;
            const data = await _fetchWithCache(url, params);
            return data;
        } catch (error) {
            console.error(`Error loading obsp.${obspKey} data:`, error);
            throw error;
        }
    }
    
    /**
     * Load varp data (gene-gene relationships)
     * @param {Object} options - Options for loading varp data
     * @param {string} options.datasetPath - Path to the dataset
     * @param {string} options.varpKey - Key in varp to load
     * @param {Array<number>} options.rows - Row indices to load (optional)
     * @param {number} options.maxGenes - Maximum genes to load (optional)
     * @returns {Promise<Object>} - varp data
     */
    async function loadVarp(options) {
        const { datasetPath, varpKey, rows, maxGenes } = options;
        
        const params = {
            dataset_path: datasetPath || _currentDataset
        };
        
        if (rows && rows.length > 0) {
            params.rows = rows.join(',');
        }
        
        if (maxGenes) {
            params.max_genes = maxGenes;
        }
        
        try {
            const url = `${Config.API.VARP}/${varpKey}`;
            const data = await _fetchWithCache(url, params);
            return data;
        } catch (error) {
            console.error(`Error loading varp.${varpKey} data:`, error);
            throw error;
        }
    }
    
    /**
     * Load data from specific layer
     * @param {Object} options - Options for loading layer data
     * @param {string} options.datasetPath - Path to the dataset
     * @param {string} options.layerName - Name of the layer
     * @param {Array<number>} options.rows - Row indices to load (optional)
     * @param {Array<number>} options.cols - Column indices to load (optional)
     * @param {number} options.maxCells - Maximum cells to load (optional)
     * @returns {Promise<Object>} - Layer data
     */
    async function loadLayer(options) {
        const { datasetPath, layerName, rows, cols, maxCells } = options;
        
        const params = {
            dataset_path: datasetPath || _currentDataset
        };
        
        if (rows && rows.length > 0) {
            params.rows = rows.join(',');
        }
        
        if (cols && cols.length > 0) {
            params.cols = cols.join(',');
        }
        
        if (maxCells) {
            params.max_cells = maxCells;
        }
        
        try {
            const url = `${Config.API.LAYER}/${layerName}`;
            const data = await _fetchWithCache(url, params);
            return data;
        } catch (error) {
            console.error(`Error loading layer.${layerName} data:`, error);
            throw error;
        }
    }
    
    /**
     * Load X matrix data (main expression matrix)
     * @param {Object} options - Options for loading X data
     * @param {string} options.datasetPath - Path to the dataset
     * @param {Array<number>} options.rows - Row indices to load (optional)
     * @param {Array<number>} options.cols - Column indices to load (optional)
     * @param {number} options.maxCells - Maximum cells to load (optional)
     * @returns {Promise<Object>} - X matrix data
     */
    async function loadX(options) {
        const { datasetPath, rows, cols, maxCells } = options;
        
        const params = {
            dataset_path: datasetPath || _currentDataset
        };
        
        if (rows && rows.length > 0) {
            params.rows = rows.join(',');
        }
        
        if (cols && cols.length > 0) {
            params.cols = cols.join(',');
        }
        
        if (maxCells) {
            params.max_cells = maxCells;
        }
        
        try {
            const data = await _fetchWithCache(Config.API.X, params);
            return data;
        } catch (error) {
            console.error('Error loading X matrix data:', error);
            throw error;
        }
    }
    
    /**
     * Load data by flexible path
     * @param {Object} options - Options for loading data by path
     * @param {string} options.datasetPath - Path to the dataset
     * @param {string} options.path - Data path (e.g., "obsm/X_umap", "varm/PCs")
     * @param {Array<number>} options.rows - Row indices to load (optional)
     * @param {Array<number>} options.cols - Column indices to load (optional)
     * @returns {Promise<Object>} - Data at specified path
     */
    async function loadByPath(options) {
        const { datasetPath, path, rows, cols } = options;
        
        const params = {
            dataset_path: datasetPath || _currentDataset,
            path: path
        };
        
        if (rows && rows.length > 0) {
            params.rows = rows.join(',');
        }
        
        if (cols && cols.length > 0) {
            params.cols = cols.join(',');
        }
        
        try {
            const data = await _fetchWithCache(Config.API.BY_PATH, params);
            return data;
        } catch (error) {
            console.error(`Error loading data at path ${path}:`, error);
            throw error;
        }
    }
    
    /**
     * Set the focused cell
     * @param {string} cellName - Cell name
     */
    function setFocusedCell(cellName) {
        _focusedCell = cellName;
        
        // Trigger event for components to update
        const event = new CustomEvent('focusedCellChanged', {
            detail: { cell: cellName }
        });
        document.dispatchEvent(event);
    }
    
    /**
     * Set the focused gene
     * @param {string} geneName - Gene name
     */
    function setFocusedGene(geneName) {
        _focusedGene = geneName;
        
        // Trigger event for components to update
        const event = new CustomEvent('focusedGeneChanged', {
            detail: { gene: geneName }
        });
        document.dispatchEvent(event);
    }
    
    /**
     * Set the taxonomy ID
     * @param {string} taxId - Taxonomy ID
     */
    function setTaxonomyId(taxId) {
        _taxonomyId = taxId;
        
        // Trigger event for components to update
        const event = new CustomEvent('taxonomyIdChanged', {
            detail: { 
                taxonomyId: taxId,
                species: Config.DEFAULTS.TAXONOMY_SPECIES[taxId] || 'Unknown'
            }
        });
        document.dispatchEvent(event);
    }
    
    /**
     * Get the current dataset path
     * @returns {string} - Current dataset path
     */
    function getCurrentDataset() {
        return _currentDataset;
    }
    
    /**
     * Get the current dataset structure
     * @returns {Object} - Dataset structure
     */
    function getDatasetStructure() {
        return _datasetStructure;
    }
    
    /**
     * Get the cell names
     * @returns {Array<string>} - Cell names
     */
    function getCells() {
        return _cells;
    }
    
    /**
     * Get the gene names
     * @returns {Array<string>} - Gene names
     */
    function getGenes() {
        return _genes;
    }
    
    /**
     * Get the focused cell
     * @returns {string} - Focused cell name
     */
    function getFocusedCell() {
        return _focusedCell;
    }
    
    /**
     * Get the focused gene
     * @returns {string} - Focused gene name
     */
    function getFocusedGene() {
        return _focusedGene;
    }
    
    /**
     * Get the taxonomy ID
     * @returns {string} - Taxonomy ID
     */
    function getTaxonomyId() {
        return _taxonomyId;
    }
    
    /**
     * Get the taxonomy species
     * @returns {string} - Species name
     */
    function getTaxonomySpecies() {
        return Config.DEFAULTS.TAXONOMY_SPECIES[_taxonomyId] || 'Unknown';
    }
    
    /**
     * Get the index of a cell by name
     * @param {string} cellName - Cell name to find
     * @returns {number} - Index of the cell, or -1 if not found
     */
    function getCellIndex(cellName) {
        return _cells ? _cells.indexOf(cellName) : -1;
    }
    
    /**
     * Get the index of a gene by name
     * @param {string} geneName - Gene name to find
     * @returns {number} - Index of the gene, or -1 if not found
     */
    function getGeneIndex(geneName) {
        return _genes ? _genes.indexOf(geneName) : -1;
    }
    
    // Public API
    return {
        loadDatasets,
        setCurrentDataset,
        loadDatasetStructure,
        loadCells,
        loadGenes,
        loadObs,
        loadVar,
        loadObsm,
        loadVarm,
        loadObsp,
        loadVarp,
        loadLayer,
        loadX,
        loadByPath,
        setFocusedCell,
        setFocusedGene,
        setTaxonomyId,
        getCurrentDataset,
        getDatasetStructure,
        getCells,
        getGenes,
        getFocusedCell,
        getFocusedGene,
        getTaxonomyId,
        getTaxonomySpecies,
        getCellIndex,
        getGeneIndex
    };
})();

// Make available for both browser global and CommonJS environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DataManager;
} else {
    window.DataManager = DataManager;
}
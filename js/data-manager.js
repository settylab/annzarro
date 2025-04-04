/**
 * Data Manager Module
 * 
 * Handles all data access and state management for the application.
 */

const DataManager = (function() {
    // Private variables
    let _activeDataset = null;
    let _datasetInfo = {};
    let _datasetRegistry = {};
    let _focusedGene = null;
    let _focusedCell = null;
    let _taxonomyId = "9606"; // Default to Homo sapiens
    let _species = "Homo sapiens";
    let _geneSets = {}; // Map of set name -> array of gene indices
    let _cellSets = {}; // Map of set name -> array of cell indices
    let _geneCache = {}; // Cache for gene data
    let _cellCache = {}; // Cache for cell data
    let _dataCache = {}; // Cache for matrix data
    
    /**
     * Clear all cached data
     */
    function clearCache() {
        _geneCache = {};
        _cellCache = {};
        _dataCache = {};
    }
    
    /**
     * Initialize the module
     */
    function init() {
        // Subscribe to events
        document.addEventListener('datasetChanged', handleDatasetChanged);
        console.log('DataManager initialized');
    }
    
    /**
     * Load a dataset from a path
     * @param {string} path - Path to the dataset
     * @returns {Promise} - Promise that resolves when dataset is loaded
     */
    async function loadDataset(path) {
        try {
            // Fetch dataset information using the dataset_structure endpoint for comprehensive info
            const response = await fetch(`/api/v1/data/dataset_structure?dataset_path=${encodeURIComponent(path)}`);
            if (!response.ok) {
                // Try the legacy endpoint as fallback
                const legacyResponse = await fetch(`/api/v1/data/info?dataset_path=${encodeURIComponent(path)}`);
                if (!legacyResponse.ok) {
                    throw new Error(`Failed to load dataset: ${response.statusText}`);
                }
                const info = await legacyResponse.json();
                
                _activeDataset = path;
                _datasetInfo = info;
                _datasetRegistry[path] = info;
            } else {
                const structureInfo = await response.json();
                
                _activeDataset = path;
                _datasetInfo = structureInfo;
                _datasetRegistry[path] = structureInfo;
            }
            
            // Clear caches when loading new dataset
            clearCache();
            
            // Initialize empty sets
            _geneSets = {};
            _cellSets = {};
            
            // Reset focused items
            _focusedGene = null;
            _focusedCell = null;
            
            // Dispatch event to notify components
            const event = new CustomEvent('dataLoaded', { 
                detail: { 
                    datasetPath: path,
                    info: _datasetInfo
                } 
            });
            document.dispatchEvent(event);
            
            return _datasetInfo;
        } catch (error) {
            console.error("Error loading dataset:", error);
            throw error;
        }
    }
    
    /**
     * Handle dataset changed event
     * @param {Event} event - Dataset changed event
     */
    function handleDatasetChanged(event) {
        const path = event.detail.datasetPath;
        if (path && path !== _activeDataset) {
            loadDataset(path);
        }
    }
    
    /**
     * Get active dataset information
     * @returns {Object} - Dataset information
     */
    function getDatasetInfo() {
        return _datasetInfo;
    }
    
    /**
     * Get active dataset path
     * @returns {string} - Dataset path
     */
    function getActiveDataset() {
        return _activeDataset;
    }
    
    /**
     * Set focused gene
     * @param {string|null} gene - Gene name or null to clear
     */
    function setFocusedGene(gene) {
        if (gene !== _focusedGene) {
            _focusedGene = gene;
            
            // Dispatch event
            const event = new CustomEvent('geneFocusChanged', { 
                detail: { gene } 
            });
            document.dispatchEvent(event);
        }
    }
    
    /**
     * Get focused gene
     * @returns {string|null} - Focused gene name or null
     */
    function getFocusedGene() {
        return _focusedGene;
    }
    
    /**
     * Set focused cell
     * @param {string|null} cell - Cell name or null to clear
     */
    function setFocusedCell(cell) {
        if (cell !== _focusedCell) {
            _focusedCell = cell;
            
            // Dispatch event
            const event = new CustomEvent('cellFocusChanged', { 
                detail: { cell } 
            });
            document.dispatchEvent(event);
        }
    }
    
    /**
     * Get focused cell
     * @returns {string|null} - Focused cell name or null
     */
    function getFocusedCell() {
        return _focusedCell;
    }
    
    /**
     * Set taxonomy ID and species
     * @param {string} taxonomyId - NCBI taxonomy ID
     * @param {string} species - Species name
     */
    function setTaxonomy(taxonomyId, species) {
        _taxonomyId = taxonomyId;
        _species = species;
        
        // Dispatch event
        const event = new CustomEvent('taxonomyChanged', { 
            detail: { taxonomyId, species } 
        });
        document.dispatchEvent(event);
    }
    
    /**
     * Get taxonomy information
     * @returns {Object} - Taxonomy information
     */
    function getTaxonomy() {
        return {
            taxonomyId: _taxonomyId,
            species: _species
        };
    }
    
    /**
     * List available datasets
     * @returns {Promise} - Promise that resolves with dataset list
     */
    async function listDatasets() {
        try {
            // Use the new endpoint that searches for datasets recursively
            const response = await fetch('/api/v1/datasets');
            if (!response.ok) {
                // Try the legacy endpoint as fallback
                const legacyResponse = await fetch('/api/v1/core/datasets');
                if (!legacyResponse.ok) {
                    throw new Error(`Failed to list datasets: ${response.statusText}`);
                }
                const legacyData = await legacyResponse.json();
                return legacyData.datasets || [];
            }
            
            const datasets = await response.json();
            return datasets;
        } catch (error) {
            console.error("Error listing datasets:", error);
            throw error;
        }
    }
    
    /**
     * Load X matrix data
     * @param {Array} rowIndices - Array of row indices
     * @param {Array} colIndices - Array of column indices
     * @returns {Promise} - Promise that resolves with matrix data
     */
    async function loadX(rowIndices, colIndices) {
        const dataset = _activeDataset;
        if (!dataset) {
            throw new Error("No dataset loaded");
        }
        
        // Create cache key
        const cacheKey = `X_${rowIndices.join(',')}_${colIndices.join(',')}`;
        
        // Check cache first
        if (_dataCache[cacheKey]) {
            return _dataCache[cacheKey];
        }
        
        try {
            const params = new URLSearchParams({
                dataset_path: dataset,
                rows: rowIndices.join(','),
                cols: colIndices.join(',')
            });
            
            const response = await fetch(`/api/v1/data/X?${params}`);
            if (!response.ok) {
                throw new Error(`Failed to load X data: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            // Cache the result
            _dataCache[cacheKey] = result.data;
            
            return result.data;
        } catch (error) {
            console.error("Error loading X data:", error);
            throw error;
        }
    }
    
    /**
     * Load a layer matrix
     * @param {string} layer - Layer name
     * @param {Array} rowIndices - Array of row indices
     * @param {Array} colIndices - Array of column indices
     * @returns {Promise} - Promise that resolves with layer data
     */
    async function loadLayer(layer, rowIndices, colIndices) {
        const dataset = _activeDataset;
        if (!dataset) {
            throw new Error("No dataset loaded");
        }
        
        // Create cache key
        const cacheKey = `layer_${layer}_${rowIndices.join(',')}_${colIndices.join(',')}`;
        
        // Check cache first
        if (_dataCache[cacheKey]) {
            return _dataCache[cacheKey];
        }
        
        try {
            const params = new URLSearchParams({
                dataset_path: dataset,
                rows: rowIndices.join(','),
                cols: colIndices.join(',')
            });
            
            const response = await fetch(`/api/v1/data/layer/${encodeURIComponent(layer)}?${params}`);
            if (!response.ok) {
                throw new Error(`Failed to load layer data: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            // Cache the result
            _dataCache[cacheKey] = result.data;
            
            return result.data;
        } catch (error) {
            console.error(`Error loading layer ${layer} data:`, error);
            throw error;
        }
    }
    
    /**
     * Load obsm data
     * @param {string} key - obsm key
     * @param {Array} rowIndices - Array of row indices
     * @param {Array} colIndices - Array of column indices
     * @param {string} columnName - Optional column name for dataframe-encoded matrices
     * @returns {Promise} - Promise that resolves with obsm data
     */
    async function loadObsm(key, rowIndices, colIndices, columnName = null) {
        const dataset = _activeDataset;
        if (!dataset) {
            throw new Error("No dataset loaded");
        }
        
        // Create cache key
        const cacheKey = `obsm_${key}_${rowIndices.join(',')}_${colIndices.join(',')}_${columnName || ''}`;
        
        // Check cache first
        if (_dataCache[cacheKey]) {
            return _dataCache[cacheKey];
        }
        
        try {
            const params = new URLSearchParams({
                dataset_path: dataset,
                rows: rowIndices.join(','),
                cols: colIndices ? colIndices.join(',') : ''
            });
            
            // Add column name for dataframe-encoded matrices
            if (columnName) {
                params.append('column_name', columnName);
            }
            
            const response = await fetch(`/api/v1/data/obsm/${encodeURIComponent(key)}?${params}`);
            if (!response.ok) {
                throw new Error(`Failed to load obsm data: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            // Cache the result
            _dataCache[cacheKey] = result.data;
            
            return result.data;
        } catch (error) {
            console.error(`Error loading obsm ${key} data:`, error);
            throw error;
        }
    }
    
    /**
     * Load varm data
     * @param {string} key - varm key
     * @param {Array} rowIndices - Array of row indices
     * @param {Array} colIndices - Array of column indices
     * @param {string} columnName - Optional column name for dataframe-encoded matrices
     * @returns {Promise} - Promise that resolves with varm data
     */
    async function loadVarm(key, rowIndices, colIndices, columnName = null) {
        const dataset = _activeDataset;
        if (!dataset) {
            throw new Error("No dataset loaded");
        }
        
        // Create cache key
        const cacheKey = `varm_${key}_${rowIndices.join(',')}_${colIndices.join(',')}_${columnName || ''}`;
        
        // Check cache first
        if (_dataCache[cacheKey]) {
            return _dataCache[cacheKey];
        }
        
        try {
            const params = new URLSearchParams({
                dataset_path: dataset,
                rows: rowIndices.join(','),
                cols: colIndices ? colIndices.join(',') : ''
            });
            
            // Add column name for dataframe-encoded matrices
            if (columnName) {
                params.append('column_name', columnName);
            }
            
            const response = await fetch(`/api/v1/data/varm/${encodeURIComponent(key)}?${params}`);
            if (!response.ok) {
                throw new Error(`Failed to load varm data: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            // Cache the result
            _dataCache[cacheKey] = result.data;
            
            return result.data;
        } catch (error) {
            console.error(`Error loading varm ${key} data:`, error);
            throw error;
        }
    }
    
    /**
     * Load obs metadata
     * @param {Array} rowIndices - Array of row indices
     * @param {Array} columns - Array of column names
     * @returns {Promise} - Promise that resolves with obs data
     */
    async function loadObs(rowIndices, columns = null) {
        const dataset = _activeDataset;
        if (!dataset) {
            throw new Error("No dataset loaded");
        }
        
        // Create cache key
        const columnsKey = columns ? columns.join(',') : 'all';
        const cacheKey = `obs_${rowIndices.join(',')}_${columnsKey}`;
        
        // Check cache first
        if (_dataCache[cacheKey]) {
            return _dataCache[cacheKey];
        }
        
        try {
            const params = new URLSearchParams({
                dataset_path: dataset,
                rows: rowIndices.join(',')
            });
            
            if (columns) {
                params.append('columns', columns.join(','));
            }
            
            const response = await fetch(`/api/v1/data/obs?${params}`);
            if (!response.ok) {
                throw new Error(`Failed to load obs data: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            // Cache the result
            _dataCache[cacheKey] = result.data;
            
            return result.data;
        } catch (error) {
            console.error("Error loading obs data:", error);
            throw error;
        }
    }
    
    /**
     * Load var metadata
     * @param {Array} colIndices - Array of column indices
     * @param {Array} columns - Array of column names
     * @returns {Promise} - Promise that resolves with var data
     */
    async function loadVar(colIndices, columns = null) {
        const dataset = _activeDataset;
        if (!dataset) {
            throw new Error("No dataset loaded");
        }
        
        // Create cache key
        const columnsKey = columns ? columns.join(',') : 'all';
        const cacheKey = `var_${colIndices.join(',')}_${columnsKey}`;
        
        // Check cache first
        if (_dataCache[cacheKey]) {
            return _dataCache[cacheKey];
        }
        
        try {
            const params = new URLSearchParams({
                dataset_path: dataset,
                cols: colIndices.join(',')
            });
            
            if (columns) {
                params.append('columns', columns.join(','));
            }
            
            const response = await fetch(`/api/v1/data/var?${params}`);
            if (!response.ok) {
                throw new Error(`Failed to load var data: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            // Cache the result
            _dataCache[cacheKey] = result.data;
            
            return result.data;
        } catch (error) {
            console.error("Error loading var data:", error);
            throw error;
        }
    }
    
    /**
     * Load obsp data
     * @param {string} key - obsp key
     * @param {Array} indices - Array of indices
     * @returns {Promise} - Promise that resolves with obsp data
     */
    async function loadObsp(key, indices) {
        const dataset = _activeDataset;
        if (!dataset) {
            throw new Error("No dataset loaded");
        }
        
        // Create cache key
        const cacheKey = `obsp_${key}_${indices.join(',')}`;
        
        // Check cache first
        if (_dataCache[cacheKey]) {
            return _dataCache[cacheKey];
        }
        
        try {
            const params = new URLSearchParams({
                dataset_path: dataset,
                rows: indices.join(',')
            });
            
            const response = await fetch(`/api/v1/data/obsp/${encodeURIComponent(key)}?${params}`);
            if (!response.ok) {
                throw new Error(`Failed to load obsp data: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            // Cache the result
            _dataCache[cacheKey] = result.data;
            
            return result.data;
        } catch (error) {
            console.error(`Error loading obsp ${key} data:`, error);
            throw error;
        }
    }
    
    /**
     * Load varp data
     * @param {string} key - varp key
     * @param {Array} indices - Array of indices
     * @returns {Promise} - Promise that resolves with varp data
     */
    async function loadVarp(key, indices) {
        const dataset = _activeDataset;
        if (!dataset) {
            throw new Error("No dataset loaded");
        }
        
        // Create cache key
        const cacheKey = `varp_${key}_${indices.join(',')}`;
        
        // Check cache first
        if (_dataCache[cacheKey]) {
            return _dataCache[cacheKey];
        }
        
        try {
            const params = new URLSearchParams({
                dataset_path: dataset,
                rows: indices.join(',')
            });
            
            const response = await fetch(`/api/v1/data/varp/${encodeURIComponent(key)}?${params}`);
            if (!response.ok) {
                throw new Error(`Failed to load varp data: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            // Cache the result
            _dataCache[cacheKey] = result.data;
            
            return result.data;
        } catch (error) {
            console.error(`Error loading varp ${key} data:`, error);
            throw error;
        }
    }
    
    /**
     * Load gene names
     * @returns {Promise} - Promise that resolves with gene names
     */
    async function loadGeneNames() {
        const dataset = _activeDataset;
        if (!dataset) {
            throw new Error("No dataset loaded");
        }
        
        // Check cache first
        if (_geneCache.names) {
            return _geneCache.names;
        }
        
        try {
            const params = new URLSearchParams({
                dataset_path: dataset
            });
            
            const response = await fetch(`/api/v1/data/genes?${params}`);
            if (!response.ok) {
                throw new Error(`Failed to load gene names: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            // Cache the result
            _geneCache.names = result.genes;
            
            return result.genes;
        } catch (error) {
            console.error("Error loading gene names:", error);
            throw error;
        }
    }
    
    /**
     * Load cell names
     * @returns {Promise} - Promise that resolves with cell names
     */
    async function loadCellNames() {
        const dataset = _activeDataset;
        if (!dataset) {
            throw new Error("No dataset loaded");
        }
        
        // Check cache first
        if (_cellCache.names) {
            return _cellCache.names;
        }
        
        try {
            const params = new URLSearchParams({
                dataset_path: dataset
            });
            
            const response = await fetch(`/api/v1/data/cells?${params}`);
            if (!response.ok) {
                throw new Error(`Failed to load cell names: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            // Cache the result
            _cellCache.names = result.cells;
            
            return result.cells;
        } catch (error) {
            console.error("Error loading cell names:", error);
            throw error;
        }
    }
    
    /**
     * Get dataframe columns for obsm
     * @param {string} key - obsm key
     * @returns {Promise} - Promise that resolves with column names
     */
    async function getObsmDataframeColumns(key) {
        const dataset = _activeDataset;
        if (!dataset) {
            throw new Error("No dataset loaded");
        }
        
        // Create cache key
        const cacheKey = `obsm_df_cols_${key}`;
        
        // Check cache first
        if (_dataCache[cacheKey]) {
            return _dataCache[cacheKey];
        }
        
        try {
            const params = new URLSearchParams({
                dataset_path: dataset,
                key: key
            });
            
            const response = await fetch(`/api/v1/data/obsm_dataframe_columns?${params}`);
            if (!response.ok) {
                throw new Error(`Failed to load obsm dataframe columns: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            // Cache the result
            _dataCache[cacheKey] = result.columns;
            
            return result.columns;
        } catch (error) {
            console.error(`Error loading obsm dataframe columns for ${key}:`, error);
            throw error;
        }
    }
    
    /**
     * Get dataframe columns for varm
     * @param {string} key - varm key
     * @returns {Promise} - Promise that resolves with column names
     */
    async function getVarmDataframeColumns(key) {
        const dataset = _activeDataset;
        if (!dataset) {
            throw new Error("No dataset loaded");
        }
        
        // Create cache key
        const cacheKey = `varm_df_cols_${key}`;
        
        // Check cache first
        if (_dataCache[cacheKey]) {
            return _dataCache[cacheKey];
        }
        
        try {
            const params = new URLSearchParams({
                dataset_path: dataset,
                key: key
            });
            
            const response = await fetch(`/api/v1/data/varm_dataframe_columns?${params}`);
            if (!response.ok) {
                throw new Error(`Failed to load varm dataframe columns: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            // Cache the result
            _dataCache[cacheKey] = result.columns;
            
            return result.columns;
        } catch (error) {
            console.error(`Error loading varm dataframe columns for ${key}:`, error);
            throw error;
        }
    }
    
    /**
     * Load data by path
     * @param {string} path - Data path (e.g., "varm/key/column_name")
     * @param {Array} rowIndices - Array of row indices
     * @param {Array} colIndices - Array of column indices
     * @returns {Promise} - Promise that resolves with data
     */
    async function loadDataByPath(path, rowIndices, colIndices) {
        const dataset = _activeDataset;
        if (!dataset) {
            throw new Error("No dataset loaded");
        }
        
        // Create cache key
        const cacheKey = `path_${path}_${rowIndices.join(',')}_${colIndices ? colIndices.join(',') : ''}`;
        
        // Check cache first
        if (_dataCache[cacheKey]) {
            return _dataCache[cacheKey];
        }
        
        try {
            const params = new URLSearchParams({
                dataset_path: dataset,
                path: path,
                rows: rowIndices.join(',')
            });
            
            if (colIndices) {
                params.append('cols', colIndices.join(','));
            }
            
            const response = await fetch(`/api/v1/data/by_path?${params}`);
            if (!response.ok) {
                throw new Error(`Failed to load data by path: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            // Cache the result
            _dataCache[cacheKey] = result.data;
            
            return result.data;
        } catch (error) {
            console.error(`Error loading data by path ${path}:`, error);
            throw error;
        }
    }
    
    /**
     * Create or update a gene set
     * @param {string} name - Set name
     * @param {Array} geneIndices - Array of gene indices
     */
    function setGeneSet(name, geneIndices) {
        _geneSets[name] = [...geneIndices]; // Clone the array
        
        // Dispatch event
        const event = new CustomEvent('geneSetChanged', { 
            detail: { name, indices: geneIndices } 
        });
        document.dispatchEvent(event);
    }
    
    /**
     * Get a gene set
     * @param {string} name - Set name
     * @returns {Array} - Array of gene indices
     */
    function getGeneSet(name) {
        return _geneSets[name] ? [..._geneSets[name]] : []; // Return a copy
    }
    
    /**
     * Get all gene sets
     * @returns {Object} - Map of set name -> array of gene indices
     */
    function getAllGeneSets() {
        const result = {};
        for (const name in _geneSets) {
            result[name] = [..._geneSets[name]]; // Return copies
        }
        return result;
    }
    
    /**
     * Create or update a cell set
     * @param {string} name - Set name
     * @param {Array} cellIndices - Array of cell indices
     */
    function setCellSet(name, cellIndices) {
        _cellSets[name] = [...cellIndices]; // Clone the array
        
        // Dispatch event
        const event = new CustomEvent('cellSetChanged', { 
            detail: { name, indices: cellIndices } 
        });
        document.dispatchEvent(event);
    }
    
    /**
     * Get a cell set
     * @param {string} name - Set name
     * @returns {Array} - Array of cell indices
     */
    function getCellSet(name) {
        return _cellSets[name] ? [..._cellSets[name]] : []; // Return a copy
    }
    
    /**
     * Get all cell sets
     * @returns {Object} - Map of set name -> array of cell indices
     */
    function getAllCellSets() {
        const result = {};
        for (const name in _cellSets) {
            result[name] = [..._cellSets[name]]; // Return copies
        }
        return result;
    }
    
    /**
     * Save current application state
     * @returns {Object} - Serialized state
     */
    function saveState() {
        const state = {
            activeDataset: _activeDataset,
            focusedGene: _focusedGene,
            focusedCell: _focusedCell,
            taxonomyId: _taxonomyId,
            species: _species,
            geneSets: _geneSets,
            cellSets: _cellSets
        };
        
        return state;
    }
    
    /**
     * Load application state
     * @param {Object} state - Serialized state
     */
    function loadState(state) {
        if (!state) return;
        
        // First load the dataset if needed
        if (state.activeDataset && state.activeDataset !== _activeDataset) {
            loadDataset(state.activeDataset)
                .then(() => {
                    // Now restore the rest of the state
                    restoreRemainingState(state);
                })
                .catch(error => {
                    console.error("Error loading dataset from state:", error);
                });
        } else {
            // Dataset already loaded or no dataset in state
            restoreRemainingState(state);
        }
    }
    
    /**
     * Restore remaining state after dataset loaded
     * @param {Object} state - Serialized state
     */
    function restoreRemainingState(state) {
        // Restore focused items
        if (state.focusedGene !== undefined) {
            setFocusedGene(state.focusedGene);
        }
        
        if (state.focusedCell !== undefined) {
            setFocusedCell(state.focusedCell);
        }
        
        // Restore taxonomy
        if (state.taxonomyId && state.species) {
            setTaxonomy(state.taxonomyId, state.species);
        }
        
        // Restore sets
        if (state.geneSets) {
            for (const name in state.geneSets) {
                setGeneSet(name, state.geneSets[name]);
            }
        }
        
        if (state.cellSets) {
            for (const name in state.cellSets) {
                setCellSet(name, state.cellSets[name]);
            }
        }
    }
    
    // Public API
    return {
        init,
        loadDataset,
        getDatasetInfo,
        getActiveDataset,
        listDatasets,
        setFocusedGene,
        getFocusedGene,
        setFocusedCell,
        getFocusedCell,
        setTaxonomy,
        getTaxonomy,
        loadX,
        loadLayer,
        loadObsm,
        loadVarm,
        loadObs,
        loadVar,
        loadObsp,
        loadVarp,
        loadGeneNames,
        loadCellNames,
        getObsmDataframeColumns,
        getVarmDataframeColumns,
        loadDataByPath,
        setGeneSet,
        getGeneSet,
        getAllGeneSets,
        setCellSet,
        getCellSet,
        getAllCellSets,
        saveState,
        loadState
    };
})();

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    DataManager.init();
});

// Export as module and global
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DataManager;
} else {
    window.DataManager = DataManager;
}
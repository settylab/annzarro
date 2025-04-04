/**
 * DataManager - Manages the AnnData object and provides access to its components
 * This class is responsible for:
 * 1. Loading and processing AnnData objects
 * 2. Providing access to AnnData components (.obs, .var, etc.)
 * 3. Managing selections and focused items
 * 4. Caching data for better performance
 */

/**
 * Helper function to access the zarrLoader dependency safely.
 * In the unified server approach, we only use the Python backend API
 * for zarr operations, not the zarr.js library.
 */
function getZarrLoader() {
    // Annzarro modules - preferred approach
    if (typeof Annzarro !== 'undefined' && Annzarro.modules && Annzarro.modules.zarrLoader) {
        return Annzarro.modules.zarrLoader;
    }
    
    // Global fallback
    if (typeof window !== 'undefined' && window.zarrLoader) {
        return window.zarrLoader;
    }
    
    // Node environment for testing
    if (typeof require !== 'undefined') {
        try {
            return require('./zarr-loader');
        } catch (e) {
            console.error('Error requiring zarr-loader:', e);
        }
    }
    
    console.error('ZarrLoader dependency not found');
    return null;
}

class DataManager {
    constructor() {
        // Main data structure
        this.anndata = null;
        
        // Current selections and focused items
        this.selectedCells = new Set();
        this.selectedGenes = new Set();
        this.focusedGene = null;
        this.focusedCell = null;
        
        // NCBI taxonomy ID and species
        this.taxonomyId = 9606; // Default: Homo sapiens
        this.species = "Homo sapiens";
        
        // Cache for loaded data
        this.cache = new Map();
        this.cacheMaxSize = 50; // Maximum number of items to cache
        
        // Event listeners
        this.eventListeners = {
            dataLoaded: [],
            selectionChanged: [],
            focusChanged: []
        };
    }

    /**
     * Load AnnData from zarr
     * @param {Object} zarrStore - The zarr store from ZarrLoader
     * @returns {Promise<boolean>} Success status
     */
    /**
     * Set the AnnData object directly
     * @param {Object} anndata - The AnnData object to set
     * @returns {Boolean} Success flag
     */
    setAnndata(anndata) {
        try {
            console.log('Setting AnnData object in data manager');
            
            // Clear cache
            this.clearCache();
            
            // Set the anndata object
            this.anndata = anndata;
            
            // Initialize selections
            this.selectedCells.clear();
            this.selectedGenes.clear();
            this.focusedCell = null;
            this.focusedGene = null;
            
            // Create a dataLoaded event
            this._triggerEvent('dataLoaded', anndata);
            
            console.log('AnnData set successfully');
            return true;
        } catch (error) {
            console.error("Error setting AnnData:", error);
            return false;
        }
    }
    
    async loadFromZarr(zarrStore) {
        try {
            console.log('Loading from zarr store in data-manager.js');
            const zarrLoader = getZarrLoader();
            if (!zarrLoader) {
                throw new Error('ZarrLoader not found');
            }
            
            // If provided with a zarrStore, set it on the zarrLoader
            if (zarrStore && typeof zarrStore === 'object') {
                zarrLoader.store = zarrStore;
            }
            
            // Set the AnnData structure from zarr
            this.anndata = await zarrLoader.convertToAnnData();
            
            // Initialize empty selections
            this.selectedCells = new Set();
            this.selectedGenes = new Set();
            this.focusedGene = null;
            this.focusedCell = null;
            
            // Clear the cache
            this.cache.clear();
            
            // Trigger dataLoaded event
            this._triggerEvent('dataLoaded', this.anndata);
            
            return true;
        } catch (error) {
            console.error('Error loading AnnData from zarr:', error);
            this.anndata = null;
            return false;
        }
    }

    /**
     * Get basic information about the loaded AnnData
     * @returns {Object|null} Basic info or null if no data loaded
     */
    getBasicInfo() {
        if (!this.anndata) return null;
        
        return {
            // Basic sizes
            nObs: this.anndata.shape ? this.anndata.shape[0] : 0,
            nVars: this.anndata.shape ? this.anndata.shape[1] : 0,
            
            // Available components
            hasX: !!this.anndata.X,
            hasObs: !!this.anndata.obs,
            hasVar: !!this.anndata.var,
            hasObsm: !!this.anndata.obsm,
            hasVarm: !!this.anndata.varm,
            hasLayers: !!this.anndata.layers,
            hasUns: !!this.anndata.uns,
            hasObsp: !!this.anndata.obsp,
            hasVarp: !!this.anndata.varp,
            
            // Layer names if available
            layerNames: this.anndata.layers ? Object.keys(this.anndata.layers) : [],
            
            // Embeddings if available
            embeddings: this.anndata.obsm ? 
                Object.keys(this.anndata.obsm).filter(key => key.startsWith('X_')) : [],
                
            // obsp and varp if available
            obspMatrices: this.anndata.obsp ? Object.keys(this.anndata.obsp) : [],
            varpMatrices: this.anndata.varp ? Object.keys(this.anndata.varp) : []
        };
    }

    /**
     * Check if AnnData is loaded
     * @returns {boolean} True if AnnData is loaded
     */
    isDataLoaded() {
        return !!this.anndata;
    }

    /**
     * Get list of available columns in obs
     * @returns {Array<string>|null} Array of column names or null if no data
     */
    getObsColumns() {
        if (!this.anndata || !this.anndata.obs) return null;
        return this.anndata.obs.columns;
    }

    /**
     * Get list of available columns in var
     * @returns {Array<string>|null} Array of column names or null if no data
     */
    getVarColumns() {
        if (!this.anndata || !this.anndata.var) return null;
        return this.anndata.var.columns;
    }

    /**
     * Get available embeddings (obsm entries starting with 'X_')
     * @returns {Array<string>|null} Array of embedding names or null if no data
     */
    getEmbeddings() {
        if (!this.anndata || !this.anndata.obsm) return null;
        return Object.keys(this.anndata.obsm).filter(key => key.startsWith('X_'));
    }

    /**
     * Get list of available layers
     * @returns {Array<string>|null} Array of layer names or null if no data
     */
    getLayers() {
        if (!this.anndata || !this.anndata.layers) return null;
        return Object.keys(this.anndata.layers);
    }
    
    /**
     * Get list of available obsp matrices
     * @returns {Array<string>|null} Array of obsp matrix names or null if no data
     */
    getObspMatrices() {
        if (!this.anndata || !this.anndata.obsp) return null;
        return Object.keys(this.anndata.obsp);
    }
    
    /**
     * Get list of available varp matrices
     * @returns {Array<string>|null} Array of varp matrix names or null if no data
     */
    getVarpMatrices() {
        if (!this.anndata || !this.anndata.varp) return null;
        return Object.keys(this.anndata.varp);
    }
    
    /**
     * Get the dimensions of an obsp matrix
     * @param {string} obspKey - The obsp matrix key
     * @returns {Array<number>|null} [rows, cols] or null if not found
     */
    getObspDimensions(obspKey) {
        if (!this.anndata || !this.anndata.obsp || !this.anndata.obsp[obspKey]) return null;
        
        // Try to get shape directly
        if (this.anndata.obsp[obspKey].shape) {
            return this.anndata.obsp[obspKey].shape;
        }
        
        // Fallback to using overall data shape
        if (this.anndata.shape) {
            const nObs = this.anndata.shape[0];
            return [nObs, nObs]; // obsp matrices are typically square
        }
        
        return null;
    }
    
    /**
     * Get the dimensions of a varp matrix
     * @param {string} varpKey - The varp matrix key
     * @returns {Array<number>|null} [rows, cols] or null if not found
     */
    getVarpDimensions(varpKey) {
        if (!this.anndata || !this.anndata.varp || !this.anndata.varp[varpKey]) return null;
        
        // Try to get shape directly
        if (this.anndata.varp[varpKey].shape) {
            return this.anndata.varp[varpKey].shape;
        }
        
        // Fallback to using overall data shape
        if (this.anndata.shape) {
            const nVars = this.anndata.shape[1];
            return [nVars, nVars]; // varp matrices are typically square
        }
        
        return null;
    }
    
    /**
     * Load obsp matrix data
     * @param {string} obspKey - The key of the obsp entry
     * @param {Array<number>} indices - Optional subset of indices to retrieve
     * @returns {Promise<Array<Array<number>>>} The obsp matrix data
     */
    async loadObsp(obspKey, indices = null) {
        if (!this.anndata || !this.anndata.obsp || !this.anndata.obsp[obspKey]) {
            return null;
        }
        
        try {
            // Generate cache key
            const cacheKey = `obsp_${obspKey}_${indices ? indices.join(',') : 'all'}`;
            
            // Check cache first
            if (this.cache.has(cacheKey)) {
                return this.cache.get(cacheKey);
            }
            
            // Try to use the API endpoint for obsp matrices
            if (window.ANNZARRO_API_URL) {
                try {
                    // Construct API URL
                    let url = `${window.ANNZARRO_API_URL}/data/obsp/${obspKey}`;
                    
                    // Add indices parameter if provided
                    if (indices && indices.length > 0) {
                        url += `?indices=${indices.join(',')}`;
                    }
                    
                    // Fetch data from server
                    const response = await fetch(url);
                    if (response.ok) {
                        const result = await response.json();
                        if (result && result.data) {
                            // Cache the result
                            this._addToCache(cacheKey, result.data);
                            return result.data;
                        }
                    }
                } catch (apiError) {
                    console.error('Error using obsp API endpoint:', apiError);
                    // Fall back to local loading
                }
            }
            
            // Fallback to using zarr-loader directly
            const zarrLoader = getZarrLoader();
            if (!zarrLoader) {
                throw new Error('ZarrLoader not found');
            }
            
            // Define selection based on indices
            let selection = null;
            if (indices) {
                const minIndex = Math.min(...indices);
                const maxIndex = Math.max(...indices);
                
                selection = [
                    [minIndex, maxIndex + 1],
                    [minIndex, maxIndex + 1]
                ];
            }
            
            // Load the data
            const result = await zarrLoader.loadData(`obsp/${obspKey}`, selection);
            
            // Cache the result
            this._addToCache(cacheKey, result);
            
            return result;
        } catch (error) {
            console.error(`Error loading obsp ${obspKey} data:`, error);
            return null;
        }
    }
    
    /**
     * Load varp matrix data
     * @param {string} varpKey - The key of the varp entry
     * @param {Array<number>} indices - Optional subset of indices to retrieve
     * @returns {Promise<Array<Array<number>>>} The varp matrix data
     */
    async loadVarp(varpKey, indices = null) {
        if (!this.anndata || !this.anndata.varp || !this.anndata.varp[varpKey]) {
            return null;
        }
        
        try {
            // Generate cache key
            const cacheKey = `varp_${varpKey}_${indices ? indices.join(',') : 'all'}`;
            
            // Check cache first
            if (this.cache.has(cacheKey)) {
                return this.cache.get(cacheKey);
            }
            
            // Try to use the API endpoint for varp matrices
            if (window.ANNZARRO_API_URL) {
                try {
                    // Construct API URL
                    let url = `${window.ANNZARRO_API_URL}/data/varp/${varpKey}`;
                    
                    // Add indices parameter if provided
                    if (indices && indices.length > 0) {
                        url += `?indices=${indices.join(',')}`;
                    }
                    
                    // Fetch data from server
                    const response = await fetch(url);
                    if (response.ok) {
                        const result = await response.json();
                        if (result && result.data) {
                            // Cache the result
                            this._addToCache(cacheKey, result.data);
                            return result.data;
                        }
                    }
                } catch (apiError) {
                    console.error('Error using varp API endpoint:', apiError);
                    // Fall back to local loading
                }
            }
            
            // Fallback to using zarr-loader directly
            const zarrLoader = getZarrLoader();
            if (!zarrLoader) {
                throw new Error('ZarrLoader not found');
            }
            
            // Define selection based on indices
            let selection = null;
            if (indices) {
                const minIndex = Math.min(...indices);
                const maxIndex = Math.max(...indices);
                
                selection = [
                    [minIndex, maxIndex + 1],
                    [minIndex, maxIndex + 1]
                ];
            }
            
            // Load the data
            const result = await zarrLoader.loadData(`varp/${varpKey}`, selection);
            
            // Cache the result
            this._addToCache(cacheKey, result);
            
            return result;
        } catch (error) {
            console.error(`Error loading varp ${varpKey} data:`, error);
            return null;
        }
    }

    /**
     * Load obs data into memory
     * @param {string} column - Column name to load, or null for all
     * @param {Array<number>} indices - Array of indices to load, or null for all
     * @returns {Promise<Array|Object|null>} The loaded data
     */
    async loadObs(column = null, indices = null) {
        if (!this.anndata || !this.anndata.obs) return null;
        
        try {
            // Generate cache key
            const cacheKey = `obs_${column || 'all'}_${indices ? indices.join(',') : 'all'}`;
            
            // Check cache first
            if (this.cache.has(cacheKey)) {
                return this.cache.get(cacheKey);
            }
            
            let result;
            const zarrLoader = getZarrLoader();
            if (!zarrLoader) {
                throw new Error('ZarrLoader not found');
            }
            
            // If column is null, load all columns
            if (column === null) {
                // If we have an index, use it
                const rowLabels = this.anndata.obs.index;
                
                // Start with empty result with index if available
                result = rowLabels ? { _index: rowLabels } : {};
                
                // Load all columns
                for (const col of this.anndata.obs.columns) {
                    const path = `obs/${col}`;
                    
                    // Define selection if indices are provided
                    const selection = indices ? [[indices[0], indices[indices.length - 1] + 1]] : null;
                    
                    // Load the data
                    result[col] = await zarrLoader.loadData(path, selection);
                }
            } else {
                // Load a specific column
                const path = `obs/${column}`;
                
                // Define selection if indices are provided
                const selection = indices ? [[indices[0], indices[indices.length - 1] + 1]] : null;
                
                // Load the data
                result = await zarrLoader.loadData(path, selection);
            }
            
            // Cache the result
            this._addToCache(cacheKey, result);
            
            return result;
        } catch (error) {
            console.error(`Error loading obs data for column ${column}:`, error);
            return null;
        }
    }

    /**
     * Load var data into memory
     * @param {string} column - Column name to load, or null for all
     * @param {Array<number>} indices - Array of indices to load, or null for all
     * @returns {Promise<Array|Object|null>} The loaded data
     */
    async loadVar(column = null, indices = null) {
        if (!this.anndata || !this.anndata.var) return null;
        
        try {
            // Generate cache key
            const cacheKey = `var_${column || 'all'}_${indices ? indices.join(',') : 'all'}`;
            
            // Check cache first
            if (this.cache.has(cacheKey)) {
                return this.cache.get(cacheKey);
            }
            
            let result;
            const zarrLoader = getZarrLoader();
            if (!zarrLoader) {
                throw new Error('ZarrLoader not found');
            }
            
            // If column is null, load all columns
            if (column === null) {
                // If we have an index, use it
                const rowLabels = this.anndata.var.index;
                
                // Start with empty result with index if available
                result = rowLabels ? { _index: rowLabels } : {};
                
                // Load all columns
                for (const col of this.anndata.var.columns) {
                    const path = `var/${col}`;
                    
                    // Define selection if indices are provided
                    const selection = indices ? [[indices[0], indices[indices.length - 1] + 1]] : null;
                    
                    // Load the data
                    result[col] = await zarrLoader.loadData(path, selection);
                }
            } else {
                // Load a specific column
                const path = `var/${column}`;
                
                // Define selection if indices are provided
                const selection = indices ? [[indices[0], indices[indices.length - 1] + 1]] : null;
                
                // Load the data
                result = await zarrLoader.loadData(path, selection);
            }
            
            // Cache the result
            this._addToCache(cacheKey, result);
            
            return result;
        } catch (error) {
            console.error(`Error loading var data for column ${column}:`, error);
            return null;
        }
    }

    /**
     * Load X matrix data
     * @param {Array<number>} rowIndices - Array of row indices or null for all
     * @param {Array<number>} colIndices - Array of column indices or null for all
     * @returns {Promise<Array|null>} The X matrix data
     */
    async loadX(rowIndices = null, colIndices = null) {
        if (!this.anndata || !this.anndata.X) return null;
        
        try {
            // Generate cache key
            const cacheKey = `X_${rowIndices ? rowIndices.join(',') : 'all'}_${colIndices ? colIndices.join(',') : 'all'}`;
            
            // Check cache first
            if (this.cache.has(cacheKey)) {
                return this.cache.get(cacheKey);
            }
            
            // Check if backend API is available
            if (window.ANNZARRO_API_URL) {
                try {
                    // Build API request URL
                    let url = `${window.ANNZARRO_API_URL}/data/X?`;
                    
                    // Add parameters
                    if (rowIndices) {
                        url += `rows=${rowIndices.join(',')}&`;
                    }
                    
                    if (colIndices) {
                        url += `cols=${colIndices.join(',')}&`;
                    }
                    
                    // Make API request
                    const response = await fetch(url);
                    if (response.ok) {
                        const data = await response.json();
                        if (data && data.data) {
                            // Cache the result
                            this._addToCache(cacheKey, data.data);
                            return data.data;
                        }
                    }
                    // If API request fails, fall back to local loading
                    console.log('Failed to load X from backend API, falling back to local loading');
                } catch (apiError) {
                    console.error('Error using backend API:', apiError);
                    // Fall back to local loading
                }
            }
            
            // Fall back to local loading (zarr.js)
            // Define selection based on indices
            let selection = null;
            
            if (rowIndices && colIndices) {
                // Both row and column indices provided
                // Use bounding box of indices for efficiency
                const minRowIndex = Math.min(...rowIndices);
                const maxRowIndex = Math.max(...rowIndices);
                const minColIndex = Math.min(...colIndices);
                const maxColIndex = Math.max(...colIndices);
                
                selection = [
                    [minRowIndex, maxRowIndex + 1],
                    [minColIndex, maxColIndex + 1]
                ];
            } else if (rowIndices) {
                // Only row indices provided
                const minRowIndex = Math.min(...rowIndices);
                const maxRowIndex = Math.max(...rowIndices);
                
                selection = [
                    [minRowIndex, maxRowIndex + 1],
                    null
                ];
            } else if (colIndices) {
                // Only column indices provided
                const minColIndex = Math.min(...colIndices);
                const maxColIndex = Math.max(...colIndices);
                
                selection = [
                    null,
                    [minColIndex, maxColIndex + 1]
                ];
            }
            
            // For large selections, try to use load progressively
            const largeSelection = (rowIndices?.length > 5000 || colIndices?.length > 5000);
            
            const zarrLoader = getZarrLoader();
            if (!zarrLoader) {
                throw new Error('ZarrLoader not found');
            }
            
            let result;
            if (largeSelection && zarrLoader.loadProgressively) {
                // Use progressive loading for large selections
                result = await zarrLoader._loadChunkedData('X', selection);
            } else {
                result = await zarrLoader.loadData('X', selection);
            }
            
            // Cache the result
            this._addToCache(cacheKey, result);
            
            return result;
        } catch (error) {
            console.error('Error loading X matrix data:', error);
            return null;
        }
    }

    /**
     * Load layer data
     * @param {string} layer - The layer name
     * @param {Array<number>} rowIndices - Array of row indices or null for all
     * @param {Array<number>} colIndices - Array of column indices or null for all
     * @returns {Promise<Array|null>} The layer data
     */
    async loadLayer(layer, rowIndices = null, colIndices = null) {
        if (!this.anndata || !this.anndata.layers || !this.anndata.layers[layer]) {
            return null;
        }
        
        try {
            // Generate cache key
            const cacheKey = `layer_${layer}_${rowIndices ? rowIndices.join(',') : 'all'}_${colIndices ? colIndices.join(',') : 'all'}`;
            
            // Check cache first
            if (this.cache.has(cacheKey)) {
                return this.cache.get(cacheKey);
            }
            
            // Define selection based on indices
            let selection = null;
            
            if (rowIndices && colIndices) {
                // Both row and column indices provided
                // Use bounding box of indices for efficiency
                const minRowIndex = Math.min(...rowIndices);
                const maxRowIndex = Math.max(...rowIndices);
                const minColIndex = Math.min(...colIndices);
                const maxColIndex = Math.max(...colIndices);
                
                selection = [
                    [minRowIndex, maxRowIndex + 1],
                    [minColIndex, maxColIndex + 1]
                ];
            } else if (rowIndices) {
                // Only row indices provided
                const minRowIndex = Math.min(...rowIndices);
                const maxRowIndex = Math.max(...rowIndices);
                
                selection = [
                    [minRowIndex, maxRowIndex + 1],
                    null
                ];
            } else if (colIndices) {
                // Only column indices provided
                const minColIndex = Math.min(...colIndices);
                const maxColIndex = Math.max(...colIndices);
                
                selection = [
                    null,
                    [minColIndex, maxColIndex + 1]
                ];
            }
            
            // Load the data
            const zarrLoader = getZarrLoader();
            if (!zarrLoader) {
                throw new Error('ZarrLoader not found');
            }
            
            const result = await zarrLoader.loadData(`layers/${layer}`, selection);
            
            // Cache the result
            this._addToCache(cacheKey, result);
            
            return result;
        } catch (error) {
            console.error(`Error loading layer ${layer} data:`, error);
            return null;
        }
    }

    /**
     * Load obsm data
     * @param {string} obsm - The obsm key
     * @param {Array<number>} rowIndices - Array of row indices or null for all
     * @returns {Promise<Array|null>} The obsm data
     */
    async loadObsm(obsm, rowIndices = null) {
        if (!this.anndata || !this.anndata.obsm || !this.anndata.obsm[obsm]) {
            return null;
        }
        
        try {
            // Generate cache key
            const cacheKey = `obsm_${obsm}_${rowIndices ? rowIndices.join(',') : 'all'}`;
            
            // Check cache first
            if (this.cache.has(cacheKey)) {
                return this.cache.get(cacheKey);
            }
            
            // Define selection based on indices
            let selection = null;
            
            if (rowIndices) {
                // Row indices provided
                const minRowIndex = Math.min(...rowIndices);
                const maxRowIndex = Math.max(...rowIndices);
                
                selection = [
                    [minRowIndex, maxRowIndex + 1],
                    null
                ];
            }
            
            // Load the data
            const zarrLoader = getZarrLoader();
            if (!zarrLoader) {
                throw new Error('ZarrLoader not found');
            }
            
            const result = await zarrLoader.loadData(`obsm/${obsm}`, selection);
            
            // Cache the result
            this._addToCache(cacheKey, result);
            
            return result;
        } catch (error) {
            console.error(`Error loading obsm ${obsm} data:`, error);
            return null;
        }
    }

    /**
     * Load varm data
     * @param {string} varm - The varm key
     * @param {Array<number>} rowIndices - Array of row indices or null for all
     * @returns {Promise<Array|null>} The varm data
     */
    async loadVarm(varm, rowIndices = null) {
        if (!this.anndata || !this.anndata.varm || !this.anndata.varm[varm]) {
            return null;
        }
        
        try {
            // Generate cache key
            const cacheKey = `varm_${varm}_${rowIndices ? rowIndices.join(',') : 'all'}`;
            
            // Check cache first
            if (this.cache.has(cacheKey)) {
                return this.cache.get(cacheKey);
            }
            
            // Define selection based on indices
            let selection = null;
            
            if (rowIndices) {
                // Row indices provided
                const minRowIndex = Math.min(...rowIndices);
                const maxRowIndex = Math.max(...rowIndices);
                
                selection = [
                    [minRowIndex, maxRowIndex + 1],
                    null
                ];
            }
            
            // Load the data
            const zarrLoader = getZarrLoader();
            if (!zarrLoader) {
                throw new Error('ZarrLoader not found');
            }
            
            const result = await zarrLoader.loadData(`varm/${varm}`, selection);
            
            // Cache the result
            this._addToCache(cacheKey, result);
            
            return result;
        } catch (error) {
            console.error(`Error loading varm ${varm} data:`, error);
            return null;
        }
    }

    /**
     * Load specific unstructured data
     * @param {string} key - The uns key
     * @returns {Promise<any|null>} The unstructured data
     */
    async loadUns(key) {
        if (!this.anndata || !this.anndata.uns || !this.anndata.uns[key]) {
            return null;
        }
        
        try {
            // Generate cache key
            const cacheKey = `uns_${key}`;
            
            // Check cache first
            if (this.cache.has(cacheKey)) {
                return this.cache.get(cacheKey);
            }
            
            let result;
            
            // Check if value is already loaded
            if (this.anndata.uns[key].value !== undefined) {
                result = this.anndata.uns[key].value;
            } else {
                // Load the data from zarr
                const zarrLoader = getZarrLoader();
                if (!zarrLoader) {
                    throw new Error('ZarrLoader not found');
                }
                
                result = await zarrLoader.loadData(`uns/${key}`);
            }
            
            // Cache the result
            this._addToCache(cacheKey, result);
            
            return result;
        } catch (error) {
            console.error(`Error loading uns ${key} data:`, error);
            return null;
        }
    }

    /**
     * Find index of a gene by name
     * @param {string} geneName - The gene name to find
     * @returns {number} The index of the gene or -1 if not found
     */
    findGeneIndex(geneName) {
        if (!this.anndata || !this.anndata.var || !this.anndata.var.index) return -1;
        return this.anndata.var.index.indexOf(geneName);
    }
    
    /**
     * Find index of a cell by name
     * @param {string} cellName - The cell name to find
     * @returns {number} The index of the cell or -1 if not found
     */
    findCellIndex(cellName) {
        if (!this.anndata || !this.anndata.obs || !this.anndata.obs.index) return -1;
        return this.anndata.obs.index.indexOf(cellName);
    }

    /**
     * Set the focused gene
     * @param {string|null} gene - The gene name or null to clear
     */
    setFocusedGene(gene) {
        this.focusedGene = gene;
        // Find index in var/_index
        const geneIndex = this.findGeneIndex(gene);
        this.focusedGeneIndex = geneIndex;
        this._triggerEvent('focusChanged', { 
            type: 'gene', 
            value: gene, // Keep value for backward compatibility
            name: gene, 
            index: geneIndex 
        });
    }

    /**
     * Get the currently focused gene
     * @returns {string|null} The focused gene name or null
     */
    getFocusedGene() {
        return this.focusedGene;
    }

    /**
     * Set the focused cell
     * @param {string|null} cell - The cell name or null to clear
     */
    setFocusedCell(cell) {
        this.focusedCell = cell;
        // Find index in obs/_index
        const cellIndex = this.findCellIndex(cell);
        this.focusedCellIndex = cellIndex;
        this._triggerEvent('focusChanged', { 
            type: 'cell', 
            value: cell, // Keep value for backward compatibility
            name: cell, 
            index: cellIndex 
        });
    }

    /**
     * Get the currently focused cell
     * @returns {string|null} The focused cell name or null
     */
    getFocusedCell() {
        return this.focusedCell;
    }

    /**
     * Set the taxonomy ID and species
     * @param {number} taxonomyId - The NCBI taxonomy ID
     * @param {string} species - The species name
     */
    setTaxonomyInfo(taxonomyId, species) {
        this.taxonomyId = taxonomyId;
        this.species = species;
    }

    /**
     * Get the taxonomy information
     * @returns {Object} Object with taxonomyId and species
     */
    getTaxonomyInfo() {
        return {
            taxonomyId: this.taxonomyId,
            species: this.species
        };
    }

    /**
     * Add selected cells
     * @param {Array<string>|Set<string>} cells - Cell names to add to selection
     */
    addSelectedCells(cells) {
        const newCells = Array.isArray(cells) ? cells : [...cells];
        let changed = false;
        
        for (const cell of newCells) {
            if (!this.selectedCells.has(cell)) {
                this.selectedCells.add(cell);
                changed = true;
            }
        }
        
        if (changed) {
            this._triggerEvent('selectionChanged', { 
                type: 'cells', 
                added: newCells,
                removed: [],
                selected: [...this.selectedCells]
            });
        }
    }

    /**
     * Remove selected cells
     * @param {Array<string>|Set<string>} cells - Cell names to remove from selection
     */
    removeSelectedCells(cells) {
        const cellsToRemove = Array.isArray(cells) ? cells : [...cells];
        let changed = false;
        
        for (const cell of cellsToRemove) {
            if (this.selectedCells.has(cell)) {
                this.selectedCells.delete(cell);
                changed = true;
            }
        }
        
        if (changed) {
            this._triggerEvent('selectionChanged', { 
                type: 'cells', 
                added: [],
                removed: cellsToRemove,
                selected: [...this.selectedCells]
            });
        }
    }

    /**
     * Set selected cells (replaces current selection)
     * @param {Array<string>|Set<string>} cells - Cell names to set as selection
     */
    setSelectedCells(cells) {
        const newSelection = new Set(cells);
        const oldSelection = new Set(this.selectedCells);
        
        // Find added and removed cells
        const added = [...newSelection].filter(cell => !oldSelection.has(cell));
        const removed = [...oldSelection].filter(cell => !newSelection.has(cell));
        
        // Update selection
        this.selectedCells = newSelection;
        
        // Trigger event if anything changed
        if (added.length > 0 || removed.length > 0) {
            this._triggerEvent('selectionChanged', {
                type: 'cells',
                added,
                removed,
                selected: [...this.selectedCells]
            });
        }
    }

    /**
     * Clear selected cells
     */
    clearSelectedCells() {
        if (this.selectedCells.size > 0) {
            const removed = [...this.selectedCells];
            this.selectedCells.clear();
            
            this._triggerEvent('selectionChanged', {
                type: 'cells',
                added: [],
                removed,
                selected: []
            });
        }
    }

    /**
     * Get selected cells
     * @returns {Set<string>} Set of selected cell names
     */
    getSelectedCells() {
        return new Set(this.selectedCells);
    }

    /**
     * Add selected genes
     * @param {Array<string>|Set<string>} genes - Gene names to add to selection
     */
    addSelectedGenes(genes) {
        const newGenes = Array.isArray(genes) ? genes : [...genes];
        let changed = false;
        
        for (const gene of newGenes) {
            if (!this.selectedGenes.has(gene)) {
                this.selectedGenes.add(gene);
                changed = true;
            }
        }
        
        if (changed) {
            this._triggerEvent('selectionChanged', { 
                type: 'genes', 
                added: newGenes,
                removed: [],
                selected: [...this.selectedGenes]
            });
        }
    }

    /**
     * Remove selected genes
     * @param {Array<string>|Set<string>} genes - Gene names to remove from selection
     */
    removeSelectedGenes(genes) {
        const genesToRemove = Array.isArray(genes) ? genes : [...genes];
        let changed = false;
        
        for (const gene of genesToRemove) {
            if (this.selectedGenes.has(gene)) {
                this.selectedGenes.delete(gene);
                changed = true;
            }
        }
        
        if (changed) {
            this._triggerEvent('selectionChanged', { 
                type: 'genes', 
                added: [],
                removed: genesToRemove,
                selected: [...this.selectedGenes]
            });
        }
    }

    /**
     * Set selected genes (replaces current selection)
     * @param {Array<string>|Set<string>} genes - Gene names to set as selection
     */
    setSelectedGenes(genes) {
        const newSelection = new Set(genes);
        const oldSelection = new Set(this.selectedGenes);
        
        // Find added and removed genes
        const added = [...newSelection].filter(gene => !oldSelection.has(gene));
        const removed = [...oldSelection].filter(gene => !newSelection.has(gene));
        
        // Update selection
        this.selectedGenes = newSelection;
        
        // Trigger event if anything changed
        if (added.length > 0 || removed.length > 0) {
            this._triggerEvent('selectionChanged', {
                type: 'genes',
                added,
                removed,
                selected: [...this.selectedGenes]
            });
        }
    }

    /**
     * Clear selected genes
     */
    clearSelectedGenes() {
        if (this.selectedGenes.size > 0) {
            const removed = [...this.selectedGenes];
            this.selectedGenes.clear();
            
            this._triggerEvent('selectionChanged', {
                type: 'genes',
                added: [],
                removed,
                selected: []
            });
        }
    }

    /**
     * Get selected genes
     * @returns {Set<string>} Set of selected gene names
     */
    getSelectedGenes() {
        return new Set(this.selectedGenes);
    }

    /**
     * Check if kompot data is available in the anndata object
     * @returns {boolean} True if kompot data is available
     */
    hasKompotData() {
        if (!this.anndata || !this.anndata.uns) return false;
        
        // Check for kompot_de or kompot_da keys
        return this.anndata.uns.hasOwnProperty('kompot_de') || 
               this.anndata.uns.hasOwnProperty('kompot_da');
    }

    /**
     * Load kompot run information
     * @param {string} analysisType - The analysis type ('de' or 'da')
     * @param {number} runId - The run ID to load
     * @returns {Promise<Object|null>} The run information or null
     */
    async loadKompotRun(analysisType, runId) {
        if (!this.hasKompotData()) return null;
        
        const key = `kompot_${analysisType}`;
        
        if (!this.anndata.uns[key]) return null;
        
        try {
            // Generate cache key
            const cacheKey = `kompot_${analysisType}_run_${runId}`;
            
            // Check cache first
            if (this.cache.has(cacheKey)) {
                return this.cache.get(cacheKey);
            }
            
            // Load uns data
            const unsData = await this.loadUns(key);
            
            if (!unsData || !unsData.run_history) return null;
            
            // Find the requested run
            let runInfo;
            
            if (runId < 0) {
                // Negative index means count from the end
                const actualIndex = unsData.run_history.length + runId;
                if (actualIndex >= 0 && actualIndex < unsData.run_history.length) {
                    runInfo = unsData.run_history[actualIndex];
                }
            } else {
                // Find run by ID
                runInfo = unsData.run_history.find(run => run.run_id === runId);
            }
            
            if (!runInfo) return null;
            
            // Cache the result
            this._addToCache(cacheKey, runInfo);
            
            return runInfo;
        } catch (error) {
            console.error(`Error loading kompot ${analysisType} run ${runId}:`, error);
            return null;
        }
    }

    /**
     * Add event listener
     * @param {string} event - Event name ('dataLoaded', 'selectionChanged', 'focusChanged')
     * @param {Function} callback - Callback function
     */
    addEventListener(event, callback) {
        if (this.eventListeners[event]) {
            this.eventListeners[event].push(callback);
        }
    }

    /**
     * Remove event listener
     * @param {string} event - Event name
     * @param {Function} callback - Callback function to remove
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
     * @private
     */
    _triggerEvent(event, data) {
        if (this.eventListeners[event]) {
            for (const callback of this.eventListeners[event]) {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in ${event} event listener:`, error);
                }
            }
        }
    }

    /**
     * Calculate statistics for numerical data
     * @param {Array|TypedArray} data - Numerical data to analyze
     * @returns {Object} Object with statistics (min, max, mean, percentiles, etc.)
     */
    calculateStats(data) {
        if (!data || data.length === 0) return null;
        
        // Check if backend API is available
        if (window.ANNZARRO_API_URL && Array.isArray(data) && data.length > 10000) {
            // For large datasets, we'll defer to the backend for performance reasons
            // Instead of calculating here, we'll return a promise to fetch from backend
            console.log('Large dataset detected, using backend for statistics calculation');
            return this._getStatsFromBackend(data);
        }
        
        // Local calculation for smaller datasets
        const stats = {};
        
        // Convert to Array if TypedArray
        const dataArray = Array.isArray(data) ? data : Array.from(data);
        const validData = dataArray.filter(x => x !== null && x !== undefined && !isNaN(x));
        
        if (validData.length === 0) return null;
        
        // Sort for percentiles calculation
        const sortedData = [...validData].sort((a, b) => a - b);
        
        // Basic statistics
        stats.min = sortedData[0];
        stats.max = sortedData[sortedData.length - 1];
        stats.count = validData.length;
        stats.sum = validData.reduce((acc, val) => acc + val, 0);
        stats.mean = stats.sum / stats.count;
        
        // Calculate variance and standard deviation
        const squaredDiffs = validData.map(x => Math.pow(x - stats.mean, 2));
        stats.variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / stats.count;
        stats.std = Math.sqrt(stats.variance);
        
        // Calculate percentiles
        const percentiles = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];
        stats.percentiles = {};
        
        percentiles.forEach(p => {
            const index = Math.floor(p * (sortedData.length - 1));
            stats.percentiles[`p${Math.round(p * 100)}`] = sortedData[index];
        });
        
        // Median (same as p50)
        stats.median = stats.percentiles.p50;
        
        // Count zeros and non-zeros
        stats.zero_count = validData.filter(x => x === 0).length;
        stats.non_zero_count = validData.filter(x => x !== 0).length;
        stats.zero_fraction = stats.zero_count / stats.count;
        
        return stats;
    }
    
    /**
     * Get statistics for a dataset from the backend
     * @param {Array} data - Data array or indices for backend to process
     * @param {Object} options - Options for the request
     * @param {Array<number>} options.geneIndices - Gene indices to analyze
     * @param {Array<number>} options.cellIndices - Cell indices to analyze
     * @param {string} options.layer - Layer name
     * @returns {Promise<Object>} Statistics object
     * @private
     */
    async _getStatsFromBackend(data, options = {}) {
        if (!window.ANNZARRO_API_URL) {
            // Fall back to local calculation if backend API is not available
            return this.calculateStats(data);
        }
        
        try {
            // Build API request URL
            let url = `${window.ANNZARRO_API_URL}/data/statistics?`;
            
            // Add parameters
            if (options.geneIndices) {
                url += `gene_indices=${options.geneIndices.join(',')}&`;
            }
            
            if (options.cellIndices) {
                url += `cell_indices=${options.cellIndices.join(',')}&`;
            }
            
            if (options.layer) {
                url += `layer=${options.layer}&`;
            }
            
            // Make API request
            const response = await fetch(url);
            if (response.ok) {
                const stats = await response.json();
                if (stats && stats.overall) {
                    return stats.overall;
                }
            }
            
            // Fall back to local calculation if API request fails
            console.log('Failed to get statistics from backend, calculating locally');
            return this.calculateStats(data);
        } catch (error) {
            console.error('Error getting stats from backend:', error);
            // Fall back to local calculation
            return this.calculateStats(data);
        }
    }
    
    /**
     * Analyze expression data to get statistics and insights
     * @param {Array<number>} geneIndices - Indices of genes to analyze
     * @param {Array<number>} cellIndices - Indices of cells to analyze
     * @param {string} layer - Layer to analyze (optional)
     * @returns {Promise<Object>} Analysis results
     */
    async analyzeExpressionData(geneIndices = null, cellIndices = null, layer = null) {
        if (!this.isDataLoaded()) return null;
        
        // Check if backend API is available
        if (window.ANNZARRO_API_URL) {
            try {
                // Build API request URL
                let url = `${window.ANNZARRO_API_URL}/data/statistics?`;
                
                // Add parameters
                if (geneIndices) {
                    url += `gene_indices=${geneIndices.join(',')}&`;
                }
                
                if (cellIndices) {
                    url += `cell_indices=${cellIndices.join(',')}&`;
                }
                
                if (layer) {
                    url += `layer=${layer}&`;
                }
                
                // Make API request
                const response = await fetch(url);
                if (response.ok) {
                    return await response.json();
                }
            } catch (error) {
                console.error('Error analyzing expression data from backend:', error);
                // Fall back to local calculation
            }
        }
        
        // If backend API is not available or request fails, calculate locally
        let data;
        if (layer) {
            data = await this.loadLayer(layer, cellIndices, geneIndices);
        } else {
            data = await this.loadX(cellIndices, geneIndices);
        }
        
        if (!data) return null;
        
        // Calculate overall statistics
        const stats = this.calculateStats(data.flat());
        
        // Return simplified analysis
        return {
            overall: stats,
            genes: {},
            cells: {},
            shape: [data.length, data[0]?.length || 0],
            sparsity: stats?.zero_fraction
        };
    }
    
    /**
     * Load data progressively with callback for status updates
     * @param {string} path - Path to the data
     * @param {Function} callback - Function to call with progress updates
     * @param {Object} options - Options for loading
     * @returns {Promise<Array>} The loaded data
     */
    async loadProgressively(path, callback, options = {}) {
        if (!this.isDataLoaded()) return null;
        
        // Check if backend API is available
        if (window.ANNZARRO_API_URL) {
            try {
                // Build API request URL
                let url = `${window.ANNZARRO_API_URL}/data/progressive/${path}?`;
                
                // Add parameters
                if (options.chunkSize) {
                    url += `chunk_size=${options.chunkSize}&`;
                }
                
                // Create a fetch request
                const response = await fetch(url);
                
                if (response.ok && response.body) {
                    // Create a reader to read the streamed response
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let data = null;
                    
                    // Read chunks as they arrive
                    while (true) {
                        const { done, value } = await reader.read();
                        
                        if (done) {
                            break;
                        }
                        
                        // Decode the chunk
                        const chunk = decoder.decode(value, { stream: true });
                        
                        // Process each line (each line is a JSON object)
                        const lines = chunk.split('\n').filter(Boolean);
                        
                        for (const line of lines) {
                            try {
                                const chunkData = JSON.parse(line);
                                
                                // If this is the first chunk, initialize the data array
                                if (!data && chunkData.data) {
                                    data = chunkData.data;
                                } else if (chunkData.data) {
                                    // Merge data (for 2D arrays)
                                    if (Array.isArray(data) && Array.isArray(chunkData.data)) {
                                        for (let i = 0; i < chunkData.data.length; i++) {
                                            if (i < data.length) {
                                                if (Array.isArray(data[i]) && Array.isArray(chunkData.data[i])) {
                                                    data[i] = [...chunkData.data[i]];
                                                }
                                            } else {
                                                data.push(chunkData.data[i]);
                                            }
                                        }
                                    } else {
                                        // For non-array data, just replace
                                        data = chunkData.data;
                                    }
                                }
                                
                                // Call the callback with progress
                                if (callback) {
                                    callback(data, chunkData.progress);
                                }
                                
                                // If this is the final chunk, we're done
                                if (chunkData.final) {
                                    break;
                                }
                            } catch (parseError) {
                                console.error('Error parsing chunk data:', parseError);
                            }
                        }
                    }
                    
                    return data;
                }
            } catch (error) {
                console.error('Error loading progressively from backend:', error);
                // Fall back to local loading
            }
        }
        
        // If backend API is not available or request fails, use local progressive loading
        const zarrLoader = getZarrLoader();
        if (!zarrLoader || !zarrLoader.loadProgressively) {
            // If no progressive loading is available, load normally
            return this.loadData(path);
        }
        
        // Use zarr loader's progressive loading
        return zarrLoader.loadProgressively(path, callback, options);
    }
    
    /**
     * Add an item to the cache with LRU eviction
     * @param {string} key - Cache key
     * @param {any} value - Value to cache
     * @private
     */
    _addToCache(key, value) {
        // Remove the key if it already exists to update its position
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }
        
        // Evict the oldest entry if the cache is full
        if (this.cache.size >= this.cacheMaxSize) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }
        
        // Add the new entry
        this.cache.set(key, value);
    }
    
    /**
     * Check if data is loaded
     * @returns {boolean} True if data is loaded
     */
    isDataLoaded() {
        return this.anndata !== null;
    }
    
    /**
     * Get observation (cell) names
     * @returns {Promise<Array<string>>} Array of observation names
     */
    async getObsNames() {
        if (!this.isDataLoaded() || !this.anndata.obs) {
            return [];
        }
        
        // If already loaded in memory
        if (this.anndata.obs.index) {
            return this.anndata.obs.index;
        }
        
        // Try to load from cache or zarr
        try {
            // Check cache
            const cacheKey = 'obs_index';
            if (this.cache.has(cacheKey)) {
                return this.cache.get(cacheKey);
            }
            
            // Load from zarr
            const zarrLoader = getZarrLoader();
            if (!zarrLoader) {
                throw new Error('ZarrLoader not found');
            }
            
            // Try to load obs/_index
            const obsIndex = await zarrLoader.loadData('obs/_index');
            if (obsIndex) {
                this._addToCache(cacheKey, obsIndex);
                return obsIndex;
            }
            
            // Fallback - generate numeric indices
            const count = this.anndata.shape ? this.anndata.shape[0] : 0;
            const indices = Array.from({length: count}, (_, i) => `Cell_${i}`);
            this._addToCache(cacheKey, indices);
            return indices;
        } catch (error) {
            console.error('Error loading observation names:', error);
            return [];
        }
    }
    
    /**
     * Get variable (gene) names
     * @returns {Promise<Array<string>>} Array of variable names
     */
    async getVarNames() {
        if (!this.isDataLoaded() || !this.anndata.var) {
            return [];
        }
        
        // If already loaded in memory
        if (this.anndata.var.index) {
            return this.anndata.var.index;
        }
        
        // Try to load from cache or zarr
        try {
            // Check cache
            const cacheKey = 'var_index';
            if (this.cache.has(cacheKey)) {
                return this.cache.get(cacheKey);
            }
            
            // Load from zarr
            const zarrLoader = getZarrLoader();
            if (!zarrLoader) {
                throw new Error('ZarrLoader not found');
            }
            
            // Try to load var/_index
            const varIndex = await zarrLoader.loadData('var/_index');
            if (varIndex) {
                this._addToCache(cacheKey, varIndex);
                return varIndex;
            }
            
            // Fallback - generate numeric indices
            const count = this.anndata.shape ? this.anndata.shape[1] : 0;
            const indices = Array.from({length: count}, (_, i) => `Gene_${i}`);
            this._addToCache(cacheKey, indices);
            return indices;
        } catch (error) {
            console.error('Error loading variable names:', error);
            return [];
        }
    }
    
    /**
     * Get basic information about the loaded data
     * @returns {Object} Basic information
     */
    getBasicInfo() {
        if (!this.isDataLoaded()) {
            return {};
        }
        
        // Get observations and variables count
        let nObs = 0;
        let nVars = 0;
        
        if (this.anndata.shape && Array.isArray(this.anndata.shape)) {
            nObs = this.anndata.shape[0] || 0;
            nVars = this.anndata.shape[1] || 0;
        } else if (this.anndata.observations !== undefined) {
            nObs = this.anndata.observations;
        } else if (this.anndata.X && this.anndata.X.shape) {
            nObs = this.anndata.X.shape[0] || 0;
            nVars = this.anndata.X.shape[1] || 0;
        }
        
        // Get available embeddings
        const embeddings = [];
        if (this.anndata.obsm && typeof this.anndata.obsm === 'object') {
            Object.keys(this.anndata.obsm).forEach(key => {
                if (key.startsWith('X_')) {
                    embeddings.push(key); // Keep full key for consistency
                }
            });
        }
        
        // Get available matrix types
        const obspMatrices = [];
        if (this.anndata.obsp && typeof this.anndata.obsp === 'object') {
            Object.keys(this.anndata.obsp).forEach(key => {
                obspMatrices.push(key);
            });
        }
        
        const varpMatrices = [];
        if (this.anndata.varp && typeof this.anndata.varp === 'object') {
            Object.keys(this.anndata.varp).forEach(key => {
                varpMatrices.push(key);
            });
        }
        
        // Get available layers
        const layerNames = [];
        if (this.anndata.layers && typeof this.anndata.layers === 'object') {
            Object.keys(this.anndata.layers).forEach(key => {
                layerNames.push(key);
            });
        }
        
        return {
            nObs,
            nVars,
            embeddings,
            obspMatrices,
            varpMatrices,
            layerNames,
            hasObsp: obspMatrices.length > 0,
            hasVarp: varpMatrices.length > 0
        };
    }
}

// Create and export a singleton instance
const dataManager = new DataManager();

// Export for both browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = dataManager;
} else if (typeof window !== 'undefined') {
    // Register with the module loader if available
    if (window.Annzarro) {
        window.Annzarro.registerModule('dataManager', dataManager);
        window.Annzarro.checkModulesReady();
    } else {
        window.dataManager = dataManager;
    }
}
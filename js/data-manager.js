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
        // Dataset registry - Map of dataset_id -> dataset info
        this.datasets = new Map();
        // Active dataset ID
        this.activeDatasetId = null;
        
        // Main data structure for currently active dataset
        this.anndata = null;
        
        // Current selections and focused items - will be moved to per-dataset storage
        this.selectedCells = new Set();
        this.selectedGenes = new Set();
        this.focusedGene = null;
        this.focusedCell = null;
        
        // NCBI taxonomy ID and species
        this.taxonomyId = 9606; // Default: Homo sapiens
        this.species = "Homo sapiens";
        
        // Cache for loaded data - will use dataset_id as prefix
        this.cache = new Map();
        this.cacheMaxSize = 50; // Maximum number of items to cache
        
        // Event listeners
        this.eventListeners = {
            dataLoaded: [],
            selectionChanged: [],
            focusChanged: [],
            datasetChanged: [], // New event for dataset switching
            datasetAdded: [],   // New event for dataset addition
            datasetRemoved: []  // New event for dataset removal
        };
    }

    /**
     * Load AnnData from zarr
     * @param {Object} zarrStore - The zarr store from ZarrLoader
     * @returns {Promise<boolean>} Success status
     */
    /**
     * Set the AnnData object directly with a dataset ID
     * @param {Object} anndata - The AnnData object to set
     * @param {string} datasetId - The dataset ID (if not provided, a random ID will be generated)
     * @param {Object} metadata - Optional metadata about the dataset
     * @returns {string} The dataset ID that was set
     */
    setAnndata(anndata, datasetId = null, metadata = {}) {
        try {
            console.log('Setting AnnData object in data manager');
            
            // Generate dataset ID if not provided
            if (!datasetId) {
                datasetId = 'dataset_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
            }
            
            // Store dataset info in registry
            this.datasets.set(datasetId, {
                anndata: anndata,
                selectedCells: new Set(),
                selectedGenes: new Set(),
                focusedCell: null,
                focusedGene: null,
                focusedCellIndex: -1,
                focusedGeneIndex: -1,
                taxonomyId: metadata.taxonomyId || this.taxonomyId,
                species: metadata.species || this.species,
                name: metadata.name || datasetId,
                description: metadata.description || '',
                path: metadata.path || '',
                loaded: true,
                timestamp: Date.now()
            });
            
            // Make this the active dataset
            this.setActiveDataset(datasetId);
            
            // Create a datasetAdded event
            this._triggerEvent('datasetAdded', {
                datasetId,
                metadata: this.getDatasetInfo(datasetId)
            });
            
            console.log(`AnnData set successfully with dataset ID: ${datasetId}`);
            return datasetId;
        } catch (error) {
            console.error("Error setting AnnData:", error);
            return null;
        }
    }
    
    /**
     * Set the active dataset
     * @param {string} datasetId - The dataset ID to set as active
     * @returns {boolean} Success flag
     */
    setActiveDataset(datasetId) {
        if (!this.datasets.has(datasetId)) {
            console.error(`Dataset ID ${datasetId} not found`);
            return false;
        }
        
        try {
            const previousDatasetId = this.activeDatasetId;
            
            // If there's a current active dataset, save its state
            if (previousDatasetId && this.datasets.has(previousDatasetId)) {
                const currentDataset = this.datasets.get(previousDatasetId);
                currentDataset.selectedCells = new Set(this.selectedCells);
                currentDataset.selectedGenes = new Set(this.selectedGenes);
                currentDataset.focusedCell = this.focusedCell;
                currentDataset.focusedGene = this.focusedGene;
                currentDataset.focusedCellIndex = this.focusedCellIndex;
                currentDataset.focusedGeneIndex = this.focusedGeneIndex;
                currentDataset.taxonomyId = this.taxonomyId;
                currentDataset.species = this.species;
            }
            
            // Set new active dataset
            this.activeDatasetId = datasetId;
            const dataset = this.datasets.get(datasetId);
            
            // Set anndata object
            this.anndata = dataset.anndata;
            
            // Restore selections and focus states
            this.selectedCells = new Set(dataset.selectedCells);
            this.selectedGenes = new Set(dataset.selectedGenes);
            this.focusedCell = dataset.focusedCell;
            this.focusedGene = dataset.focusedGene;
            this.focusedCellIndex = dataset.focusedCellIndex;
            this.focusedGeneIndex = dataset.focusedGeneIndex;
            
            // Restore taxonomy info
            this.taxonomyId = dataset.taxonomyId;
            this.species = dataset.species;
            
            // Trigger dataset changed event
            this._triggerEvent('datasetChanged', {
                previousDatasetId,
                newDatasetId: datasetId,
                dataset: this.getDatasetInfo(datasetId)
            });
            
            // Also trigger dataLoaded event for backward compatibility
            this._triggerEvent('dataLoaded', this.anndata);
            
            return true;
        } catch (error) {
            console.error(`Error setting active dataset ${datasetId}:`, error);
            return false;
        }
    }
    
    /**
     * Get information about a dataset
     * @param {string} datasetId - The dataset ID
     * @returns {Object|null} Dataset information or null if not found
     */
    getDatasetInfo(datasetId) {
        if (!datasetId || !this.datasets.has(datasetId)) {
            return null;
        }
        
        const dataset = this.datasets.get(datasetId);
        const info = {
            id: datasetId,
            name: dataset.name,
            description: dataset.description,
            path: dataset.path,
            loaded: dataset.loaded,
            timestamp: dataset.timestamp,
            taxonomyId: dataset.taxonomyId,
            species: dataset.species,
            selections: {
                cells: [...dataset.selectedCells].length,
                genes: [...dataset.selectedGenes].length
            },
            focus: {
                cell: dataset.focusedCell,
                gene: dataset.focusedGene
            }
        };
        
        // Add basic data info if available
        if (dataset.anndata) {
            const basicInfo = this._getBasicInfo(dataset.anndata);
            info.data = basicInfo;
        }
        
        return info;
    }
    
    /**
     * Load AnnData from zarr with dataset ID support
     * @param {Object} zarrStore - The zarr store from ZarrLoader
     * @param {string} datasetId - Optional dataset ID
     * @param {Object} metadata - Optional metadata about the dataset
     * @returns {Promise<string|boolean>} Dataset ID if successful, false otherwise
     */
    async loadFromZarr(zarrStore, datasetId = null, metadata = {}) {
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
            
            // Generate dataset ID if not provided
            if (!datasetId) {
                datasetId = 'dataset_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
            }
            
            // Get path information if available
            const path = metadata.path || (zarrStore && zarrStore.path) || '';
            
            // Convert to AnnData structure
            const anndataStructure = await zarrLoader.convertToAnnData();
            
            // Create dataset metadata
            const datasetMetadata = {
                ...metadata,
                path: path,
                name: metadata.name || path.split('/').pop() || datasetId,
                description: metadata.description || 'Loaded from zarr',
                timestamp: Date.now()
            };
            
            // Set the AnnData with dataset ID
            const resultId = this.setAnndata(anndataStructure, datasetId, datasetMetadata);
            
            return resultId;
        } catch (error) {
            console.error('Error loading AnnData from zarr:', error);
            return false;
        }
    }

    /**
     * Get basic information about a dataset's AnnData
     * Helper method to extract information from an anndata object
     * @param {Object} anndata - The AnnData object to extract info from
     * @returns {Object} Basic info object
     * @private
     */
    _getBasicInfo(anndata) {
        if (!anndata) return null;
        
        return {
            // Basic sizes
            nObs: anndata.shape ? anndata.shape[0] : 0,
            nVars: anndata.shape ? anndata.shape[1] : 0,
            
            // Available components
            hasX: !!anndata.X,
            hasObs: !!anndata.obs,
            hasVar: !!anndata.var,
            hasObsm: !!anndata.obsm,
            hasVarm: !!anndata.varm,
            hasLayers: !!anndata.layers,
            hasUns: !!anndata.uns,
            hasObsp: !!anndata.obsp,
            hasVarp: !!anndata.varp,
            
            // Layer names if available
            layerNames: anndata.layers ? Object.keys(anndata.layers) : [],
            
            // Embeddings if available
            embeddings: anndata.obsm ? 
                Object.keys(anndata.obsm).filter(key => key.startsWith('X_')) : [],
                
            // obsp and varp if available
            obspMatrices: anndata.obsp ? Object.keys(anndata.obsp) : [],
            varpMatrices: anndata.varp ? Object.keys(anndata.varp) : []
        };
    }
    
    /**
     * Get basic information about the loaded AnnData
     * @param {string} datasetId - Optional dataset ID (defaults to active dataset)
     * @returns {Object|null} Basic info or null if no data loaded
     */
    getBasicInfo(datasetId = null) {
        // Use active dataset if not specified
        const dsId = datasetId || this.activeDatasetId;
        
        // Get the dataset anndata
        const anndata = dsId && this.datasets.has(dsId) 
            ? this.datasets.get(dsId).anndata 
            : this.anndata;
            
        if (!anndata) return null;
        
        return this._getBasicInfo(anndata);
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
     * Check if an obsm matrix is a dataframe (has columns)
     * @param {string} obsmKey - The obsm matrix key
     * @param {string} datasetId - Optional dataset ID (defaults to active dataset)
     * @returns {boolean} True if the obsm matrix is a dataframe
     */
    isObsmDataframe(obsmKey, datasetId = null) {
        // Use active dataset if not specified
        const dsId = datasetId || this.activeDatasetId;
        
        // Get the dataset anndata
        const anndata = dsId && this.datasets.has(dsId) 
            ? this.datasets.get(dsId).anndata 
            : this.anndata;
            
        if (!anndata || !anndata.obsm || !anndata.obsm[obsmKey]) {
            return false;
        }
        
        // Check if it has dataframe metadata
        return !!(anndata.obsm_dataframes && anndata.obsm_dataframes[obsmKey]);
    }
    
    /**
     * Check if a varm matrix is a dataframe (has columns)
     * @param {string} varmKey - The varm matrix key
     * @param {string} datasetId - Optional dataset ID (defaults to active dataset)
     * @returns {boolean} True if the varm matrix is a dataframe
     */
    isVarmDataframe(varmKey, datasetId = null) {
        // Use active dataset if not specified
        const dsId = datasetId || this.activeDatasetId;
        
        // Get the dataset anndata
        const anndata = dsId && this.datasets.has(dsId) 
            ? this.datasets.get(dsId).anndata 
            : this.anndata;
            
        if (!anndata || !anndata.varm || !anndata.varm[varmKey]) {
            return false;
        }
        
        // Check if it has dataframe metadata
        return !!(anndata.varm_dataframes && anndata.varm_dataframes[varmKey]);
    }
    
    /**
     * Get the column names for an obsm dataframe matrix
     * @param {string} obsmKey - The obsm matrix key
     * @param {string} datasetId - Optional dataset ID (defaults to active dataset)
     * @returns {Array<string>|null} Array of column names or null if not a dataframe
     */
    async getObsmDataframeColumns(obsmKey, datasetId = null) {
        // Use active dataset if not specified
        const dsId = datasetId || this.activeDatasetId;
        
        // Get the dataset anndata
        const anndata = dsId && this.datasets.has(dsId) 
            ? this.datasets.get(dsId).anndata 
            : this.anndata;
            
        if (!anndata || !anndata.obsm || !anndata.obsm[obsmKey]) {
            return null;
        }
        
        // Check if dataframe info is already in metadata
        if (anndata.obsm_dataframes && 
            anndata.obsm_dataframes[obsmKey] && 
            anndata.obsm_dataframes[obsmKey].columns) {
            return anndata.obsm_dataframes[obsmKey].columns;
        }
        
        // If not available in metadata, try the API
        if (window.ANNZARRO_API_URL) {
            try {
                // Build API URL
                let url = `${window.ANNZARRO_API_URL}/data/obsm_dataframe_columns?matrix=${encodeURIComponent(obsmKey)}`;
                
                // Add dataset path parameter if available
                if (anndata.dataset_path) {
                    url += `&dataset_path=${encodeURIComponent(anndata.dataset_path)}`;
                }
                
                // Add dataset ID parameter
                if (dsId) {
                    url += `&dataset_id=${encodeURIComponent(dsId)}`;
                }
                
                // Fetch data
                const response = await fetch(url);
                if (response.ok) {
                    const result = await response.json();
                    if (result && result.columns) {
                        // Store in metadata for future reference
                        if (!anndata.obsm_dataframes) {
                            anndata.obsm_dataframes = {};
                        }
                        
                        if (!anndata.obsm_dataframes[obsmKey]) {
                            anndata.obsm_dataframes[obsmKey] = {
                                encoding_type: 'dataframe'
                            };
                        }
                        
                        anndata.obsm_dataframes[obsmKey].columns = result.columns;
                        
                        return result.columns;
                    }
                }
                
                // If API fails, return empty array
                return [];
            } catch (error) {
                console.error(`Error fetching obsm dataframe columns for ${obsmKey}:`, error);
                return [];
            }
        }
        
        // If no API, return empty array
        return [];
    }
    
    /**
     * Get the column names for a varm dataframe matrix
     * @param {string} varmKey - The varm matrix key
     * @param {string} datasetId - Optional dataset ID (defaults to active dataset)
     * @returns {Array<string>|null} Array of column names or null if not a dataframe
     */
    async getVarmDataframeColumns(varmKey, datasetId = null) {
        // Use active dataset if not specified
        const dsId = datasetId || this.activeDatasetId;
        
        // Get the dataset anndata
        const anndata = dsId && this.datasets.has(dsId) 
            ? this.datasets.get(dsId).anndata 
            : this.anndata;
            
        if (!anndata || !anndata.varm || !anndata.varm[varmKey]) {
            return null;
        }
        
        // Check if dataframe info is already in metadata
        if (anndata.varm_dataframes && 
            anndata.varm_dataframes[varmKey] && 
            anndata.varm_dataframes[varmKey].columns) {
            return anndata.varm_dataframes[varmKey].columns;
        }
        
        // If not available in metadata, try the API
        if (window.ANNZARRO_API_URL) {
            try {
                // Build API URL
                let url = `${window.ANNZARRO_API_URL}/data/varm_dataframe_columns?matrix=${encodeURIComponent(varmKey)}`;
                
                // Add dataset path parameter if available
                if (anndata.dataset_path) {
                    url += `&dataset_path=${encodeURIComponent(anndata.dataset_path)}`;
                }
                
                // Add dataset ID parameter
                if (dsId) {
                    url += `&dataset_id=${encodeURIComponent(dsId)}`;
                }
                
                // Fetch data
                const response = await fetch(url);
                if (response.ok) {
                    const result = await response.json();
                    if (result && result.columns) {
                        // Store in metadata for future reference
                        if (!anndata.varm_dataframes) {
                            anndata.varm_dataframes = {};
                        }
                        
                        if (!anndata.varm_dataframes[varmKey]) {
                            anndata.varm_dataframes[varmKey] = {
                                encoding_type: 'dataframe'
                            };
                        }
                        
                        anndata.varm_dataframes[varmKey].columns = result.columns;
                        
                        return result.columns;
                    }
                }
                
                // If API fails, return empty array
                return [];
            } catch (error) {
                console.error(`Error fetching varm dataframe columns for ${varmKey}:`, error);
                return [];
            }
        }
        
        // If no API, return empty array
        return [];
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
     * Load X matrix data with dataset ID support
     * @param {Array<number>} rowIndices - Array of row indices or null for all
     * @param {Array<number>} colIndices - Array of column indices or null for all
     * @param {string} datasetId - Optional dataset ID (defaults to active dataset)
     * @returns {Promise<Array|null>} The X matrix data
     */
    async loadX(rowIndices = null, colIndices = null, datasetId = null) {
        // Use active dataset if not specified
        const dsId = datasetId || this.activeDatasetId;
        
        // Get the dataset anndata
        const anndata = dsId && this.datasets.has(dsId) 
            ? this.datasets.get(dsId).anndata 
            : this.anndata;
            
        if (!anndata || !anndata.X) return null;
        
        try {
            // Generate cache key
            const cacheKey = `X_${rowIndices ? rowIndices.join(',') : 'all'}_${colIndices ? colIndices.join(',') : 'all'}`;
            
            // Check cache first
            if (this._hasInCache(cacheKey, dsId)) {
                return this._getFromCache(cacheKey, dsId);
            }
            
            // Check if backend API is available
            if (window.ANNZARRO_API_URL) {
                try {
                    // Build API request URL
                    let url = `${window.ANNZARRO_API_URL}/data/X?`;
                    
                    // Add dataset ID parameter
                    if (dsId) {
                        url += `dataset_id=${encodeURIComponent(dsId)}&`;
                    }
                    
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
                            this._addToCache(cacheKey, data.data, dsId);
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
            
            // If we have a dataset ID, make sure zarr loader knows about it
            if (dsId && zarrLoader.setDatasetContext) {
                zarrLoader.setDatasetContext(dsId);
            }
            
            let result;
            if (largeSelection && zarrLoader.loadProgressively) {
                // Use progressive loading for large selections
                result = await zarrLoader._loadChunkedData('X', selection);
            } else {
                result = await zarrLoader.loadData('X', selection);
            }
            
            // Cache the result
            this._addToCache(cacheKey, result, dsId);
            
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
     * Load obsm data with support for dataframe columns
     * @param {string} obsm - The obsm key
     * @param {Array<number>} rowIndices - Array of row indices or null for all
     * @param {string} columnName - Optional column name for dataframe-encoded matrices
     * @param {string} datasetId - Optional dataset ID (defaults to active dataset)
     * @returns {Promise<Array|null>} The obsm data
     */
    async loadObsm(obsm, rowIndices = null, columnName = null, datasetId = null) {
        // Use active dataset if not specified
        const dsId = datasetId || this.activeDatasetId;
        
        // Get the dataset anndata
        const anndata = dsId && this.datasets.has(dsId) 
            ? this.datasets.get(dsId).anndata 
            : this.anndata;
            
        if (!anndata || !anndata.obsm || !anndata.obsm[obsm]) {
            return null;
        }
        
        try {
            // Generate cache key that includes column name if provided
            const cacheKey = `obsm_${obsm}${columnName ? '_col_' + columnName : ''}_${rowIndices ? rowIndices.join(',') : 'all'}`;
            
            // Check cache first
            if (this._hasInCache(cacheKey, dsId)) {
                return this._getFromCache(cacheKey, dsId);
            }
            
            // Check if this is a dataframe-encoded matrix and column name is provided
            const isDataframe = anndata.obsm_dataframes && 
                                anndata.obsm_dataframes[obsm] && 
                                columnName !== null;
            
            // For dataframe with column, use API endpoint
            if (isDataframe && columnName !== null && window.ANNZARRO_API_URL) {
                try {
                    // Build API URL
                    let url = `${window.ANNZARRO_API_URL}/data/obsm/${obsm}?column_name=${encodeURIComponent(columnName)}`;
                    
                    // Add dataset path parameter if available
                    if (anndata.dataset_path) {
                        url += `&dataset_path=${encodeURIComponent(anndata.dataset_path)}`;
                    }
                    
                    // Add dataset ID parameter
                    if (dsId) {
                        url += `&dataset_id=${encodeURIComponent(dsId)}`;
                    }
                    
                    // Add row indices if provided
                    if (rowIndices && rowIndices.length > 0) {
                        url += `&indices=${rowIndices.join(',')}`;
                    }
                    
                    // Fetch data
                    const response = await fetch(url);
                    if (response.ok) {
                        const result = await response.json();
                        if (result && result.data) {
                            // Cache the result
                            this._addToCache(cacheKey, result.data, dsId);
                            return result.data;
                        }
                    }
                } catch (apiError) {
                    console.error('Error using API for dataframe column:', apiError);
                    // Fall back to path-based access
                }
                
                // Alternative: path-based access
                try {
                    // Build path-based API URL
                    let url = `${window.ANNZARRO_API_URL}/data/by_path?path=${encodeURIComponent(`obsm/${obsm}/${columnName}`)}`;
                    
                    // Add dataset path parameter if available
                    if (anndata.dataset_path) {
                        url += `&dataset_path=${encodeURIComponent(anndata.dataset_path)}`;
                    }
                    
                    // Add dataset ID parameter
                    if (dsId) {
                        url += `&dataset_id=${encodeURIComponent(dsId)}`;
                    }
                    
                    // Add row indices if provided
                    if (rowIndices && rowIndices.length > 0) {
                        url += `&indices=${rowIndices.join(',')}`;
                    }
                    
                    // Fetch data
                    const response = await fetch(url);
                    if (response.ok) {
                        const result = await response.json();
                        if (result && result.data) {
                            // Cache the result
                            this._addToCache(cacheKey, result.data, dsId);
                            return result.data;
                        }
                    }
                } catch (pathError) {
                    console.error('Error using path-based access for dataframe column:', pathError);
                    // Fall back to regular loadData
                }
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
            
            // Load the data using standard path or zarr loader
            const zarrLoader = getZarrLoader();
            if (!zarrLoader) {
                throw new Error('ZarrLoader not found');
            }
            
            // For dataframe column access with zarrLoader
            if (isDataframe && columnName !== null) {
                // Use path notation for dataframe column access
                const result = await zarrLoader.loadData(`obsm/${obsm}/${columnName}`, selection);
                
                // Cache the result
                this._addToCache(cacheKey, result, dsId);
                
                return result;
            } else {
                // Standard obsm matrix access
                const result = await zarrLoader.loadData(`obsm/${obsm}`, selection);
                
                // Cache the result
                this._addToCache(cacheKey, result, dsId);
                
                return result;
            }
        } catch (error) {
            console.error(`Error loading obsm ${obsm} data:`, error);
            return null;
        }
    }

    /**
     * Load varm data with support for dataframe columns
     * @param {string} varm - The varm key
     * @param {Array<number>} rowIndices - Array of row indices or null for all
     * @param {string} columnName - Optional column name for dataframe-encoded matrices
     * @param {string} datasetId - Optional dataset ID (defaults to active dataset)
     * @returns {Promise<Array|null>} The varm data
     */
    async loadVarm(varm, rowIndices = null, columnName = null, datasetId = null) {
        // Use active dataset if not specified
        const dsId = datasetId || this.activeDatasetId;
        
        // Get the dataset anndata
        const anndata = dsId && this.datasets.has(dsId) 
            ? this.datasets.get(dsId).anndata 
            : this.anndata;
        
        if (!anndata || !anndata.varm || !anndata.varm[varm]) {
            return null;
        }
        
        try {
            // Generate cache key that includes column name if provided
            const cacheKey = `varm_${varm}${columnName ? '_col_' + columnName : ''}_${rowIndices ? rowIndices.join(',') : 'all'}`;
            
            // Check cache first
            if (this._hasInCache(cacheKey, dsId)) {
                return this._getFromCache(cacheKey, dsId);
            }
            
            // Check if this is a dataframe-encoded matrix and column name is provided
            const isDataframe = anndata.varm_dataframes && 
                                anndata.varm_dataframes[varm] && 
                                columnName !== null;
            
            // For dataframe with column, use API endpoint
            if (isDataframe && columnName !== null && window.ANNZARRO_API_URL) {
                try {
                    // Build API URL
                    let url = `${window.ANNZARRO_API_URL}/data/varm/${varm}?column_name=${encodeURIComponent(columnName)}`;
                    
                    // Add dataset path parameter if available
                    if (anndata.dataset_path) {
                        url += `&dataset_path=${encodeURIComponent(anndata.dataset_path)}`;
                    }
                    
                    // Add dataset ID parameter
                    if (dsId) {
                        url += `&dataset_id=${encodeURIComponent(dsId)}`;
                    }
                    
                    // Add row indices if provided
                    if (rowIndices && rowIndices.length > 0) {
                        url += `&indices=${rowIndices.join(',')}`;
                    }
                    
                    // Fetch data
                    const response = await fetch(url);
                    if (response.ok) {
                        const result = await response.json();
                        if (result && result.data) {
                            // Cache the result
                            this._addToCache(cacheKey, result.data, dsId);
                            return result.data;
                        }
                    }
                } catch (apiError) {
                    console.error('Error using API for dataframe column:', apiError);
                    // Fall back to path-based access
                }
                
                // Alternative: path-based access
                try {
                    // Build path-based API URL
                    let url = `${window.ANNZARRO_API_URL}/data/by_path?path=${encodeURIComponent(`varm/${varm}/${columnName}`)}`;
                    
                    // Add dataset path parameter if available
                    if (anndata.dataset_path) {
                        url += `&dataset_path=${encodeURIComponent(anndata.dataset_path)}`;
                    }
                    
                    // Add dataset ID parameter
                    if (dsId) {
                        url += `&dataset_id=${encodeURIComponent(dsId)}`;
                    }
                    
                    // Add row indices if provided
                    if (rowIndices && rowIndices.length > 0) {
                        url += `&indices=${rowIndices.join(',')}`;
                    }
                    
                    // Fetch data
                    const response = await fetch(url);
                    if (response.ok) {
                        const result = await response.json();
                        if (result && result.data) {
                            // Cache the result
                            this._addToCache(cacheKey, result.data, dsId);
                            return result.data;
                        }
                    }
                } catch (pathError) {
                    console.error('Error using path-based access for dataframe column:', pathError);
                    // Fall back to regular loadData
                }
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
            
            // Load the data using standard path or zarr loader
            const zarrLoader = getZarrLoader();
            if (!zarrLoader) {
                throw new Error('ZarrLoader not found');
            }
            
            // For dataframe column access with zarrLoader
            if (isDataframe && columnName !== null) {
                // Use path notation for dataframe column access
                const result = await zarrLoader.loadData(`varm/${varm}/${columnName}`, selection);
                
                // Cache the result
                this._addToCache(cacheKey, result, dsId);
                
                return result;
            } else {
                // Standard varm matrix access
                const result = await zarrLoader.loadData(`varm/${varm}`, selection);
                
                // Cache the result
                this._addToCache(cacheKey, result, dsId);
                
                return result;
            }
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
     * Add an item to the cache with LRU eviction and dataset prefix
     * @param {string} key - Cache key
     * @param {any} value - Value to cache
     * @param {string} datasetId - Dataset ID to use as prefix (defaults to active dataset)
     * @private
     */
    _addToCache(key, value, datasetId = null) {
        // Use active dataset ID if not specified
        const dsId = datasetId || this.activeDatasetId;
        
        // Create a prefixed key with dataset ID
        const prefixedKey = dsId ? `${dsId}:${key}` : key;
        
        // Remove the key if it already exists to update its position
        if (this.cache.has(prefixedKey)) {
            this.cache.delete(prefixedKey);
        }
        
        // Evict the oldest entry if the cache is full
        if (this.cache.size >= this.cacheMaxSize) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }
        
        // Add the new entry
        this.cache.set(prefixedKey, value);
    }
    
    /**
     * Get an item from the cache with dataset prefix
     * @param {string} key - Cache key
     * @param {string} datasetId - Dataset ID to use as prefix (defaults to active dataset)
     * @private
     * @returns {any} Cached value or undefined if not found
     */
    _getFromCache(key, datasetId = null) {
        // Use active dataset ID if not specified
        const dsId = datasetId || this.activeDatasetId;
        
        // Create a prefixed key with dataset ID
        const prefixedKey = dsId ? `${dsId}:${key}` : key;
        
        return this.cache.get(prefixedKey);
    }
    
    /**
     * Check if an item exists in the cache with dataset prefix
     * @param {string} key - Cache key
     * @param {string} datasetId - Dataset ID to use as prefix (defaults to active dataset)
     * @private
     * @returns {boolean} True if the key exists in the cache
     */
    _hasInCache(key, datasetId = null) {
        // Use active dataset ID if not specified
        const dsId = datasetId || this.activeDatasetId;
        
        // Create a prefixed key with dataset ID
        const prefixedKey = dsId ? `${dsId}:${key}` : key;
        
        return this.cache.has(prefixedKey);
    }
    
    /**
     * Check if data is loaded
     * @param {string} datasetId - Optional dataset ID to check (defaults to active dataset)
     * @returns {boolean} True if data is loaded
     */
    isDataLoaded(datasetId = null) {
        if (datasetId) {
            return this.datasets.has(datasetId) && this.datasets.get(datasetId).anndata !== null;
        }
        return this.activeDatasetId !== null && this.anndata !== null;
    }
    
    /**
     * Reset the DataManager to its initial state (for testing)
     */
    reset() {
        // Clear datasets
        this.datasets.clear();
        this.activeDatasetId = null;
        
        // Reset state
        this.anndata = null;
        this.selectedCells = new Set();
        this.selectedGenes = new Set();
        this.focusedGene = null;
        this.focusedCell = null;
        this.focusedGeneIndex = -1;
        this.focusedCellIndex = -1;
        
        // Reset taxonomy
        this.taxonomyId = 9606; // Default: Homo sapiens
        this.species = "Homo sapiens";
        
        // Clear cache
        this.cache.clear();
    }
    
    /**
     * Get a list of all loaded datasets
     * @returns {Array<Object>} Array of dataset info objects
     */
    getLoadedDatasets() {
        const datasets = [];
        for (const [id, _] of this.datasets) {
            datasets.push(this.getDatasetInfo(id));
        }
        return datasets;
    }
    
    /**
     * Remove a dataset
     * @param {string} datasetId - The dataset ID to remove
     * @returns {boolean} Success flag
     */
    removeDataset(datasetId) {
        if (!this.datasets.has(datasetId)) {
            return false;
        }
        
        try {
            // If removing the active dataset, need to switch active dataset
            if (this.activeDatasetId === datasetId) {
                // Find another dataset to make active, or set to null
                const datasetIds = Array.from(this.datasets.keys());
                const newActiveId = datasetIds.find(id => id !== datasetId);
                
                // Set new active dataset if available, otherwise clear
                if (newActiveId) {
                    this.setActiveDataset(newActiveId);
                } else {
                    this.activeDatasetId = null;
                    this.anndata = null;
                    this.selectedCells.clear();
                    this.selectedGenes.clear();
                    this.focusedCell = null;
                    this.focusedGene = null;
                }
            }
            
            // Remove from dataset registry
            const removedDataset = this.datasets.get(datasetId);
            this.datasets.delete(datasetId);
            
            // Remove dataset-specific cache entries
            const dsPrefix = `${datasetId}:`;
            for (const key of this.cache.keys()) {
                if (key.startsWith(dsPrefix)) {
                    this.cache.delete(key);
                }
            }
            
            // Trigger datasetRemoved event
            this._triggerEvent('datasetRemoved', {
                datasetId,
                dataset: removedDataset
            });
            
            return true;
        } catch (error) {
            console.error(`Error removing dataset ${datasetId}:`, error);
            return false;
        }
    }
    
    /**
     * Get the active dataset ID
     * @returns {string|null} The active dataset ID or null if none
     */
    getActiveDatasetId() {
        return this.activeDatasetId;
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
     * Load data using path notation (e.g., "varm/matrix_name/column_name")
     * @param {string} path - The path notation (e.g., "varm/kompot_de_mean_lfc_Young_to_Old_groups/B cells")
     * @param {Array<number>} indices - Optional indices to filter the data
     * @param {string} datasetId - Optional dataset ID (defaults to active dataset)
     * @returns {Promise<Array|null>} The data
     */
    async loadDataByPath(path, indices = null, datasetId = null) {
        // Use active dataset if not specified
        const dsId = datasetId || this.activeDatasetId;
        
        // Get the dataset anndata
        const anndata = dsId && this.datasets.has(dsId) 
            ? this.datasets.get(dsId).anndata 
            : this.anndata;
            
        if (!anndata) {
            return null;
        }
        
        try {
            // Generate cache key
            const cacheKey = `path_${path}_${indices ? indices.join(',') : 'all'}`;
            
            // Check cache first
            if (this._hasInCache(cacheKey, dsId)) {
                return this._getFromCache(cacheKey, dsId);
            }
            
            // Parse the path
            const parts = path.split('/');
            
            // If path has at least 2 parts, interpret the first part as the data type
            if (parts.length >= 2) {
                const dataType = parts[0];
                const key = parts[1];
                const columnName = parts.length >= 3 ? parts.slice(2).join('/') : null;
                
                // Try API first if available
                if (window.ANNZARRO_API_URL) {
                    try {
                        // Build API URL
                        let url = `${window.ANNZARRO_API_URL}/data/by_path?path=${encodeURIComponent(path)}`;
                        
                        // Add dataset path parameter if available
                        if (anndata.dataset_path) {
                            url += `&dataset_path=${encodeURIComponent(anndata.dataset_path)}`;
                        }
                        
                        // Add dataset ID parameter
                        if (dsId) {
                            url += `&dataset_id=${encodeURIComponent(dsId)}`;
                        }
                        
                        // Add indices if provided
                        if (indices && indices.length > 0) {
                            url += `&indices=${indices.join(',')}`;
                        }
                        
                        // Fetch data
                        const response = await fetch(url);
                        if (response.ok) {
                            const result = await response.json();
                            if (result && result.data) {
                                // Cache the result
                                this._addToCache(cacheKey, result.data, dsId);
                                return result.data;
                            }
                        }
                    } catch (apiError) {
                        console.error('Error using API for path-based access:', apiError);
                        // Fall back to other methods
                    }
                }
                
                // If API fails or not available, try using existing methods
                switch (dataType) {
                    case 'obsm':
                        return await this.loadObsm(key, indices, columnName, dsId);
                    case 'varm':
                        return await this.loadVarm(key, indices, columnName, dsId);
                    case 'obsp':
                        return await this.loadObsp(key, indices, dsId);
                    case 'varp':
                        return await this.loadVarp(key, indices, dsId);
                    case 'X':
                        return await this.loadX(indices, null, dsId);
                    case 'layers':
                        return await this.loadLayer(key, indices, null);
                    case 'obs':
                        const obsData = await this.loadObs(key, indices);
                        return obsData;
                    case 'var':
                        const varData = await this.loadVar(key, indices);
                        return varData;
                    default:
                        console.error(`Unknown data type: ${dataType}`);
                        return null;
                }
            } else {
                console.error('Invalid path notation. Expected at least 2 parts (e.g., "varm/matrix_name")');
                return null;
            }
        } catch (error) {
            console.error(`Error loading data by path ${path}:`, error);
            return null;
        }
    }
    
    /**
     * Get basic information about the loaded data including dataframe info
     * @param {string} datasetId - Optional dataset ID (defaults to active dataset)
     * @returns {Object} Basic information
     */
    getBasicInfo(datasetId = null) {
        // Use active dataset if not specified
        const dsId = datasetId || this.activeDatasetId;
        
        // Get the dataset anndata
        const anndata = dsId && this.datasets.has(dsId) 
            ? this.datasets.get(dsId).anndata 
            : this.anndata;
            
        if (!anndata) {
            return {};
        }
        
        // Get observations and variables count
        let nObs = 0;
        let nVars = 0;
        
        if (anndata.shape && Array.isArray(anndata.shape)) {
            nObs = anndata.shape[0] || 0;
            nVars = anndata.shape[1] || 0;
        } else if (anndata.observations !== undefined) {
            nObs = anndata.observations;
        } else if (anndata.X && anndata.X.shape) {
            nObs = anndata.X.shape[0] || 0;
            nVars = anndata.X.shape[1] || 0;
        }
        
        // Get available embeddings
        const embeddings = [];
        if (anndata.obsm && typeof anndata.obsm === 'object') {
            Object.keys(anndata.obsm).forEach(key => {
                if (key.startsWith('X_')) {
                    embeddings.push(key); // Keep full key for consistency
                }
            });
        }
        
        // Get available obsm matrices (including non-embeddings)
        const obsmMatrices = [];
        if (anndata.obsm && typeof anndata.obsm === 'object') {
            Object.keys(anndata.obsm).forEach(key => {
                obsmMatrices.push(key);
            });
        }
        
        // Get available varm matrices
        const varmMatrices = [];
        if (anndata.varm && typeof anndata.varm === 'object') {
            Object.keys(anndata.varm).forEach(key => {
                varmMatrices.push(key);
            });
        }
        
        // Get available obsp matrices
        const obspMatrices = [];
        if (anndata.obsp && typeof anndata.obsp === 'object') {
            Object.keys(anndata.obsp).forEach(key => {
                obspMatrices.push(key);
            });
        }
        
        // Get available varp matrices
        const varpMatrices = [];
        if (anndata.varp && typeof anndata.varp === 'object') {
            Object.keys(anndata.varp).forEach(key => {
                varpMatrices.push(key);
            });
        }
        
        // Get available layers
        const layerNames = [];
        if (anndata.layers && typeof anndata.layers === 'object') {
            Object.keys(anndata.layers).forEach(key => {
                layerNames.push(key);
            });
        }
        
        // Get dataframe information for obsm and varm
        const obsmDataframes = [];
        const obsmDataframeInfo = {};
        if (anndata.obsm_dataframes && typeof anndata.obsm_dataframes === 'object') {
            Object.keys(anndata.obsm_dataframes).forEach(key => {
                obsmDataframes.push(key);
                obsmDataframeInfo[key] = {
                    columns: anndata.obsm_dataframes[key].columns || [],
                    encoding_type: anndata.obsm_dataframes[key].encoding_type || 'dataframe',
                    encoding_version: anndata.obsm_dataframes[key].encoding_version || ''
                };
            });
        }
        
        const varmDataframes = [];
        const varmDataframeInfo = {};
        if (anndata.varm_dataframes && typeof anndata.varm_dataframes === 'object') {
            Object.keys(anndata.varm_dataframes).forEach(key => {
                varmDataframes.push(key);
                varmDataframeInfo[key] = {
                    columns: anndata.varm_dataframes[key].columns || [],
                    encoding_type: anndata.varm_dataframes[key].encoding_type || 'dataframe',
                    encoding_version: anndata.varm_dataframes[key].encoding_version || ''
                };
            });
        }
        
        return {
            nObs,
            nVars,
            embeddings,
            obsmMatrices,
            varmMatrices,
            obspMatrices,
            varpMatrices,
            layerNames,
            obsmDataframes,
            varmDataframes,
            obsmDataframeInfo,
            varmDataframeInfo,
            hasObsp: obspMatrices.length > 0,
            hasVarp: varpMatrices.length > 0,
            hasObsmDataframes: obsmDataframes.length > 0,
            hasVarmDataframes: varmDataframes.length > 0
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
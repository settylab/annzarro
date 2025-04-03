/**
 * DataManager - Manages the AnnData object and provides access to its components
 * This class is responsible for:
 * 1. Loading and processing AnnData objects
 * 2. Providing access to AnnData components (.obs, .var, etc.)
 * 3. Managing selections and focused items
 * 4. Caching data for better performance
 */

/**
 * Helper function to access the zarrLoader dependency safely
 * This avoids variable declarations that might conflict
 */
function getZarrLoader() {
    // Node environment
    if (typeof require !== 'undefined') {
        return require('./zarr-loader');
    }
    // Annzarro modules
    if (typeof Annzarro !== 'undefined' && Annzarro.modules && Annzarro.modules.zarrLoader) {
        return Annzarro.modules.zarrLoader;
    }
    // Global fallback
    if (typeof window !== 'undefined' && window.zarrLoader) {
        return window.zarrLoader;
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
    async loadFromZarr(zarrStore) {
        try {
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
                Object.keys(this.anndata.obsm).filter(key => key.startsWith('X_')) : []
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
            
            const result = await zarrLoader.loadData('X', selection);
            
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
     * Set the focused gene
     * @param {string|null} gene - The gene name or null to clear
     */
    setFocusedGene(gene) {
        this.focusedGene = gene;
        this._triggerEvent('focusChanged', { type: 'gene', value: gene });
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
        this._triggerEvent('focusChanged', { type: 'cell', value: cell });
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
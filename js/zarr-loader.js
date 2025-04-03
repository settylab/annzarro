/**
 * ZarrLoader - Handles loading AnnData in zarr format
 * This module provides functionality to load zarr data from various sources:
 * - Local files (directory or archive)
 * - URL
 * - S3 bucket
 */

// Check if zarr is defined, if not, provide an error message function
const checkZarrAvailability = () => {
    if (typeof zarr === 'undefined') {
        throw new Error('zarr is not defined. Make sure zarr.js is loaded before using this module.');
    }
};

class ZarrLoader {
    constructor() {
        this.store = null;
        this.isLoading = false;
        this.loadingProgress = 0;
        this.cancellationToken = null;
    }

    /**
     * Initialize a zarr store from a local directory
     * @param {FileList} fileList - The list of files from the directory
     * @returns {Promise<Object>} A zarr store
     */
    async loadFromDirectory(fileList) {
        // Check if zarr is available
        checkZarrAvailability();
        
        this.isLoading = true;
        this.loadingProgress = 0;
        this.cancellationToken = { cancelled: false };
        
        try {
            const files = Array.from(fileList);
            
            // Convert file paths to zarr-compatible structure
            const fileMap = new Map();
            for (const file of files) {
                const relativePath = file.webkitRelativePath || file.name;
                fileMap.set(relativePath, file);
            }
            
            // Create a zarr store with HTTP range reader
            const store = new zarr.MemoryStore();
            
            // Process files in batches to improve performance
            const batchSize = 100;
            const batches = Math.ceil(files.length / batchSize);
            
            for (let i = 0; i < batches; i++) {
                if (this.cancellationToken?.cancelled) {
                    throw new Error('Loading cancelled');
                }
                
                const batchFiles = files.slice(i * batchSize, (i + 1) * batchSize);
                
                // Process files in parallel
                await Promise.all(batchFiles.map(async (file) => {
                    const relativePath = file.webkitRelativePath || file.name;
                    const buffer = await this._readFileAsArrayBuffer(file);
                    await store.setItem(relativePath, buffer);
                }));
                
                // Update progress
                this.loadingProgress = Math.min(100, Math.round(((i + 1) * batchSize) / files.length * 100));
                this._notifyProgressUpdate(this.loadingProgress);
            }
            
            this.store = store;
            this.isLoading = false;
            return store;
        } catch (error) {
            this.isLoading = false;
            throw error;
        }
    }

    /**
     * Initialize a zarr store from a URL
     * @param {string} url - The URL to the zarr store
     * @returns {Promise<Object>} A zarr store
     */
    async loadFromUrl(url) {
        // Check if zarr is available
        checkZarrAvailability();
        
        this.isLoading = true;
        this.loadingProgress = 0;
        this.cancellationToken = { cancelled: false };
        
        try {
            // Create HTTP store
            const store = zarr.HTTPStore.fromUrl(url);
            
            // Initial progress
            this.loadingProgress = 50;
            this._notifyProgressUpdate(this.loadingProgress);
            
            // Let's validate the zarr store with a simple metadata read
            try {
                const attrs = await zarr.openGroup(store, '');
                console.log('Zarr group opened successfully', attrs);
            } catch (error) {
                throw new Error(`Failed to open zarr group: ${error.message}`);
            }
            
            this.loadingProgress = 100;
            this._notifyProgressUpdate(this.loadingProgress);
            
            this.store = store;
            this.isLoading = false;
            return store;
        } catch (error) {
            this.isLoading = false;
            throw error;
        }
    }
    

    /**
     * Initialize a zarr store from an S3 bucket
     * @param {Object} s3Config - The S3 configuration
     * @returns {Promise<Object>} A zarr store
     */
    async loadFromS3(s3Config) {
        // Check if zarr is available
        checkZarrAvailability();
        
        this.isLoading = true;
        this.loadingProgress = 0;
        this.cancellationToken = { cancelled: false };
        
        try {
            // Validate config
            if (!s3Config.bucket) {
                throw new Error('S3 bucket name is required');
            }
            
            if (!s3Config.key) {
                throw new Error('S3 key (path) is required');
            }
            
            // Create S3 client or use anonymous client
            let s3Store;
            if (s3Config.anonymous) {
                // Anonymous access
                s3Store = new zarr.S3Store({
                    bucket: s3Config.bucket,
                    prefix: s3Config.key,
                    region: s3Config.region || 'us-east-1',
                    credentials: false
                });
            } else {
                // Access with credentials
                if (!s3Config.accessKey || !s3Config.secretKey) {
                    throw new Error('S3 access key and secret key are required for non-anonymous access');
                }
                
                s3Store = new zarr.S3Store({
                    bucket: s3Config.bucket,
                    prefix: s3Config.key,
                    region: s3Config.region || 'us-east-1',
                    credentials: {
                        accessKeyId: s3Config.accessKey,
                        secretAccessKey: s3Config.secretKey
                    }
                });
            }
            
            // Initial progress
            this.loadingProgress = 50;
            this._notifyProgressUpdate(this.loadingProgress);
            
            // Let's validate the zarr store with a simple metadata read
            try {
                const attrs = await zarr.openGroup(s3Store, '');
                console.log('Zarr group opened successfully from S3', attrs);
            } catch (error) {
                throw new Error(`Failed to open zarr group from S3: ${error.message}`);
            }
            
            this.loadingProgress = 100;
            this._notifyProgressUpdate(this.loadingProgress);
            
            this.store = s3Store;
            this.isLoading = false;
            return s3Store;
        } catch (error) {
            this.isLoading = false;
            throw error;
        }
    }

    /**
     * Converts the store into an AnnData-like structure
     * @returns {Promise<Object>} An object with AnnData-like structure
     */
    async convertToAnnData() {
        // Check if zarr is available
        checkZarrAvailability();
        
        if (!this.store) {
            throw new Error('No zarr store loaded');
        }
        
        this.isLoading = true;
        this.loadingProgress = 0;
        
        try {
            const anndata = {};
            
            // Open the root group
            const root = await zarr.openGroup(this.store, '');
            
            // Extract basic info
            anndata.shape = await this._getArrayShape(this.store, 'X/shape');
            
            // Common AnnData components
            const components = ['X', 'obs', 'var', 'obsm', 'varm', 'layers', 'uns', 'obsp', 'varp'];
            
            // Process each component
            for (let i = 0; i < components.length; i++) {
                const component = components[i];
                
                try {
                    // Check if component exists
                    if (await this._pathExists(component)) {
                        if (component === 'X') {
                            anndata.X = await this._processXMatrix();
                        } else if (component === 'layers') {
                            anndata.layers = await this._processLayers();
                        } else if (component === 'obs') {
                            anndata.obs = await this._processDataFrame('obs');
                        } else if (component === 'var') {
                            anndata.var = await this._processDataFrame('var');
                        } else if (component === 'obsm') {
                            anndata.obsm = await this._processMultiDimensional('obsm');
                        } else if (component === 'varm') {
                            anndata.varm = await this._processMultiDimensional('varm');
                        } else if (component === 'uns') {
                            anndata.uns = await this._processUnstructured();
                        } else if (component === 'obsp') {
                            anndata.obsp = await this._processPairwise('obsp');
                        } else if (component === 'varp') {
                            anndata.varp = await this._processPairwise('varp');
                        }
                    }
                } catch (error) {
                    console.error(`Error processing ${component}:`, error);
                    anndata[component] = { error: error.message };
                }
                
                // Update progress
                this.loadingProgress = Math.round(((i + 1) / components.length) * 100);
                this._notifyProgressUpdate(this.loadingProgress);
                
                if (this.cancellationToken?.cancelled) {
                    throw new Error('Loading cancelled');
                }
            }
            
            this.isLoading = false;
            this.loadingProgress = 100;
            return anndata;
        } catch (error) {
            this.isLoading = false;
            throw error;
        }
    }

    /**
     * Cancel the current loading operation
     */
    cancelLoading() {
        if (this.isLoading && this.cancellationToken) {
            this.cancellationToken.cancelled = true;
        }
    }

    /**
     * Read a file as an ArrayBuffer
     * @param {File} file - The file to read
     * @returns {Promise<ArrayBuffer>} The file contents as ArrayBuffer
     * @private
     */
    _readFileAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = function(event) {
                resolve(event.target.result);
            };
            
            reader.onerror = function(error) {
                reject(error);
            };
            
            reader.readAsArrayBuffer(file);
        });
    }

    /**
     * Notify progress update
     * @param {number} progress - The current progress (0-100)
     * @private
     */
    _notifyProgressUpdate(progress) {
        // Dispatch an event with the current progress
        const event = new CustomEvent('zarrLoadingProgress', {
            detail: { progress: progress }
        });
        document.dispatchEvent(event);
    }

    /**
     * Check if a path exists in the zarr store
     * @param {string} path - The path to check
     * @returns {Promise<boolean>} True if the path exists
     * @private
     */
    async _pathExists(path) {
        try {
            const keys = await this.store.getKeys();
            return keys.some(key => key.startsWith(`${path}/`) || key === path);
        } catch (error) {
            console.error(`Error checking if path exists: ${path}`, error);
            return false;
        }
    }

    /**
     * Get shape of an array from metadata
     * @param {Object} store - The zarr store
     * @param {string} path - Path to the shape metadata
     * @returns {Promise<Array>} The shape array
     * @private
     */
    async _getArrayShape(store, path) {
        try {
            const shapeBuffer = await store.getItem(path);
            if (!shapeBuffer) {
                throw new Error(`Shape not found at ${path}`);
            }
            
            // Convert buffer to string and parse
            const shapeText = new TextDecoder().decode(shapeBuffer);
            return JSON.parse(shapeText);
        } catch (error) {
            console.error(`Error getting array shape from ${path}:`, error);
            return [0, 0];
        }
    }

    /**
     * Process the X matrix (main data matrix)
     * @returns {Promise<Object>} Metadata about the X matrix
     * @private
     */
    async _processXMatrix() {
        try {
            // We don't load the actual data, just metadata about it
            const shape = await this._getArrayShape(this.store, 'X/shape');
            
            // Get information about chunking
            let chunkShape;
            try {
                chunkShape = await this._getArrayShape(this.store, 'X/chunks');
            } catch (error) {
                chunkShape = null;
            }
            
            // Try to get the data type
            let dtype;
            try {
                const dtypeBuffer = await this.store.getItem('X/dtype');
                dtype = new TextDecoder().decode(dtypeBuffer);
            } catch (error) {
                dtype = 'unknown';
            }
            
            return {
                shape,
                chunkShape,
                dtype,
                isView: false,
                path: 'X'
            };
        } catch (error) {
            console.error('Error processing X matrix:', error);
            throw error;
        }
    }

    /**
     * Process all layers
     * @returns {Promise<Object>} An object with layer information
     * @private
     */
    async _processLayers() {
        try {
            const layerNames = new Set();
            
            // Get all keys from the store
            const keys = await this.store.getKeys();
            
            // Find layer names by looking at keys that start with 'layers/'
            for (const key of keys) {
                if (key.startsWith('layers/')) {
                    const parts = key.split('/');
                    if (parts.length > 1) {
                        layerNames.add(parts[1]);
                    }
                }
            }
            
            // Process layer information
            const layers = {};
            for (const layerName of layerNames) {
                try {
                    // Get shape if available
                    const shapePath = `layers/${layerName}/shape`;
                    let shape;
                    try {
                        shape = await this._getArrayShape(this.store, shapePath);
                    } catch (error) {
                        shape = null;
                    }
                    
                    // Get dtype if available
                    let dtype;
                    try {
                        const dtypeBuffer = await this.store.getItem(`layers/${layerName}/dtype`);
                        dtype = new TextDecoder().decode(dtypeBuffer);
                    } catch (error) {
                        dtype = 'unknown';
                    }
                    
                    layers[layerName] = {
                        shape,
                        dtype,
                        path: `layers/${layerName}`
                    };
                } catch (error) {
                    console.error(`Error processing layer ${layerName}:`, error);
                    layers[layerName] = { error: error.message };
                }
            }
            
            return layers;
        } catch (error) {
            console.error('Error processing layers:', error);
            throw error;
        }
    }

    /**
     * Process DataFrame-like components (obs and var)
     * @param {string} component - The component name ('obs' or 'var')
     * @returns {Promise<Object>} The processed data frame metadata
     * @private
     */
    async _processDataFrame(component) {
        try {
            // Get the index
            const indexPath = `${component}/_index`;
            let index;
            try {
                const indexBuffer = await this.store.getItem(indexPath);
                if (indexBuffer) {
                    index = new TextDecoder().decode(indexBuffer).split('\n').filter(Boolean);
                } else {
                    index = null;
                }
            } catch (error) {
                console.error(`Error getting index for ${component}:`, error);
                index = null;
            }
            
            // Get column names
            const columns = new Set();
            const keys = await this.store.getKeys();
            
            // Find columns by filtering keys
            for (const key of keys) {
                if (key.startsWith(`${component}/`)) {
                    const parts = key.split('/');
                    if (parts.length > 1 && parts[1] !== '_index') {
                        columns.add(parts[1]);
                    }
                }
            }
            
            // Process column metadata
            const columnInfo = {};
            for (const column of columns) {
                try {
                    // Get the shape if available
                    let shape;
                    try {
                        shape = await this._getArrayShape(this.store, `${component}/${column}/shape`);
                    } catch (error) {
                        shape = null;
                    }
                    
                    // Get dtype if available
                    let dtype;
                    try {
                        const dtypeBuffer = await this.store.getItem(`${component}/${column}/dtype`);
                        dtype = dtypeBuffer ? new TextDecoder().decode(dtypeBuffer) : 'unknown';
                    } catch (error) {
                        dtype = 'unknown';
                    }
                    
                    columnInfo[column] = {
                        shape,
                        dtype,
                        path: `${component}/${column}`
                    };
                } catch (error) {
                    console.error(`Error processing column ${column} in ${component}:`, error);
                    columnInfo[column] = { error: error.message };
                }
            }
            
            return {
                index,
                columns: Array.from(columns),
                columnsInfo: columnInfo,
                shape: index ? [index.length, columns.size] : [0, columns.size],
                path: component
            };
        } catch (error) {
            console.error(`Error processing ${component}:`, error);
            throw error;
        }
    }

    /**
     * Process multi-dimensional components (obsm and varm)
     * @param {string} component - The component name ('obsm' or 'varm')
     * @returns {Promise<Object>} The processed multi-dimensional data
     * @private
     */
    async _processMultiDimensional(component) {
        try {
            // Find all matrices in the component
            const matrixNames = new Set();
            const keys = await this.store.getKeys();
            
            // Extract matrix names from keys
            for (const key of keys) {
                if (key.startsWith(`${component}/`)) {
                    const parts = key.split('/');
                    if (parts.length > 1) {
                        matrixNames.add(parts[1]);
                    }
                }
            }
            
            // Process each matrix
            const matrices = {};
            for (const matrixName of matrixNames) {
                try {
                    // Get shape information
                    let shape;
                    try {
                        shape = await this._getArrayShape(this.store, `${component}/${matrixName}/shape`);
                    } catch (error) {
                        shape = null;
                    }
                    
                    // Get dtype if available
                    let dtype;
                    try {
                        const dtypeBuffer = await this.store.getItem(`${component}/${matrixName}/dtype`);
                        dtype = dtypeBuffer ? new TextDecoder().decode(dtypeBuffer) : 'unknown';
                    } catch (error) {
                        dtype = 'unknown';
                    }
                    
                    matrices[matrixName] = {
                        shape,
                        dtype,
                        path: `${component}/${matrixName}`
                    };
                } catch (error) {
                    console.error(`Error processing ${matrixName} in ${component}:`, error);
                    matrices[matrixName] = { error: error.message };
                }
            }
            
            return matrices;
        } catch (error) {
            console.error(`Error processing ${component}:`, error);
            throw error;
        }
    }

    /**
     * Process unstructured components (uns)
     * @returns {Promise<Object>} The processed unstructured data
     * @private
     */
    async _processUnstructured() {
        try {
            // Find all keys in the unstructured component
            const keys = await this.store.getKeys();
            const unsKeys = keys.filter(key => key.startsWith('uns/'));
            
            // Map to extract key names
            const unsKeyMap = {};
            for (const key of unsKeys) {
                const parts = key.split('/');
                if (parts.length > 1) {
                    // Extract the key name after 'uns/'
                    const keyName = parts[1];
                    
                    // Skip if we already have this key
                    if (unsKeyMap[keyName]) continue;
                    
                    // Add to the map
                    unsKeyMap[keyName] = {
                        path: `uns/${keyName}`
                    };
                    
                    // Try to get shape and dtype for array-like data
                    try {
                        const shape = await this._getArrayShape(this.store, `uns/${keyName}/shape`);
                        if (shape) {
                            unsKeyMap[keyName].shape = shape;
                            
                            // Get dtype if available
                            try {
                                const dtypeBuffer = await this.store.getItem(`uns/${keyName}/dtype`);
                                const dtype = dtypeBuffer ? new TextDecoder().decode(dtypeBuffer) : 'unknown';
                                unsKeyMap[keyName].dtype = dtype;
                            } catch (error) {
                                // Ignore dtype errors
                            }
                        }
                    } catch (error) {
                        // Not an array, might be a scalar or a group
                        try {
                            // Check if it's a scalar
                            const valueBuffer = await this.store.getItem(`uns/${keyName}`);
                            if (valueBuffer) {
                                let value;
                                try {
                                    // Try to parse as JSON
                                    value = JSON.parse(new TextDecoder().decode(valueBuffer));
                                } catch (parseError) {
                                    // Not JSON, use as string
                                    value = new TextDecoder().decode(valueBuffer);
                                }
                                unsKeyMap[keyName].value = value;
                            }
                        } catch (valueError) {
                            // Probably a group, leave as is
                        }
                    }
                }
            }
            
            return unsKeyMap;
        } catch (error) {
            console.error('Error processing unstructured data:', error);
            throw error;
        }
    }

    /**
     * Process pairwise components (obsp and varp)
     * @param {string} component - The component name ('obsp' or 'varp')
     * @returns {Promise<Object>} The processed pairwise data
     * @private
     */
    async _processPairwise(component) {
        try {
            // Find all matrices in the component
            const matrixNames = new Set();
            const keys = await this.store.getKeys();
            
            // Extract matrix names from keys
            for (const key of keys) {
                if (key.startsWith(`${component}/`)) {
                    const parts = key.split('/');
                    if (parts.length > 1) {
                        matrixNames.add(parts[1]);
                    }
                }
            }
            
            // Process each matrix
            const matrices = {};
            for (const matrixName of matrixNames) {
                try {
                    // Get shape information
                    let shape;
                    try {
                        shape = await this._getArrayShape(this.store, `${component}/${matrixName}/shape`);
                    } catch (error) {
                        shape = null;
                    }
                    
                    // Get dtype if available
                    let dtype;
                    try {
                        const dtypeBuffer = await this.store.getItem(`${component}/${matrixName}/dtype`);
                        dtype = dtypeBuffer ? new TextDecoder().decode(dtypeBuffer) : 'unknown';
                    } catch (error) {
                        dtype = 'unknown';
                    }
                    
                    matrices[matrixName] = {
                        shape,
                        dtype,
                        path: `${component}/${matrixName}`
                    };
                } catch (error) {
                    console.error(`Error processing ${matrixName} in ${component}:`, error);
                    matrices[matrixName] = { error: error.message };
                }
            }
            
            return matrices;
        } catch (error) {
            console.error(`Error processing ${component}:`, error);
            throw error;
        }
    }

    /**
     * Load specific data from zarr array
     * @param {string} path - Path to the zarr array
     * @param {Array} selection - Selection indices [start, stop] or null for all
     * @returns {Promise<Object>} The loaded data
     */
    async loadData(path, selection = null) {
        // Check if zarr is available
        checkZarrAvailability();
        
        if (!this.store) {
            throw new Error('No zarr store loaded');
        }
        
        try {
            // Open the zarr array
            const array = await zarr.open(this.store, path);
            
            // If no selection is provided, load everything
            if (!selection) {
                return await array.get();
            }
            
            // Handle selections
            return await array.get(selection);
        } catch (error) {
            console.error(`Error loading data from ${path}:`, error);
            throw error;
        }
    }
}

// Create and export a singleton instance
const zarrLoader = new ZarrLoader();

// Export for both browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = zarrLoader;
} else if (typeof window !== 'undefined') {
    // Register with the module loader if available
    if (window.Annzarro) {
        window.Annzarro.registerModule('zarrLoader', zarrLoader);
        window.Annzarro.checkModulesReady();
    } else {
        window.zarrLoader = zarrLoader;
    }
}
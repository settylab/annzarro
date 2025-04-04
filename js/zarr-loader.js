/**
 * ZarrLoader - Python Backend API Client
 * This module provides communication with the Python backend for zarr data operations:
 * - Loading zarr data from various sources
 * - Fetching metadata and array data
 * - Handling data transformation and progressive loading
 */

class ZarrLoader {
    constructor() {
        this.isLoading = false;
        this.loadingProgress = 0;
        this.cancellationToken = null;
        
        // Get the API URL from the global config
        this.apiUrl = window.Annzarro?.config?.apiUrl || '/api/v1';
        
        // Default error handler for API requests
        this.defaultErrorHandler = (error) => {
            console.error('ZarrLoader API error:', error);
            throw error;
        };
    }

    /**
     * Initialize a zarr store from a local directory by uploading files to the Python backend
     * @param {FileList} fileList - The list of files from the directory
     * @returns {Promise<Object>} A success status
     */
    async loadFromDirectory(fileList) {
        this.isLoading = true;
        this.loadingProgress = 0;
        this.cancellationToken = { cancelled: false };
        
        try {
            // Create FormData to upload files
            const formData = new FormData();
            
            // Add each file to the form data
            let totalFiles = 0;
            for (const file of fileList) {
                formData.append('files[]', file, file.webkitRelativePath || file.name);
                totalFiles++;
                
                // Update progress periodically during preparation
                if (totalFiles % 100 === 0) {
                    this.loadingProgress = Math.min(40, Math.round((totalFiles / fileList.length) * 40));
                    this._notifyProgressUpdate(this.loadingProgress);
                }
                
                if (this.cancellationToken?.cancelled) {
                    throw new Error('Loading cancelled');
                }
            }
            
            // Update progress before starting upload
            this.loadingProgress = 40;
            this._notifyProgressUpdate(this.loadingProgress);
            
            // Send files to the backend
            const response = await fetch(`${this.apiUrl}/zarr/upload`, {
                method: 'POST',
                body: formData,
                // Add upload progress tracking
                onUploadProgress: (progressEvent) => {
                    if (progressEvent.lengthComputable) {
                        // Scale progress from 40 to 90
                        const uploadProgress = 40 + Math.round((progressEvent.loaded / progressEvent.total) * 50);
                        this.loadingProgress = uploadProgress;
                        this._notifyProgressUpdate(uploadProgress);
                    }
                }
            });
            
            if (!response.ok) {
                const error = await response.text();
                throw new Error(`API error: ${error}`);
            }
            
            const result = await response.json();
            
            // Final progress update
            this.loadingProgress = 100;
            this._notifyProgressUpdate(this.loadingProgress);
            
            this.isLoading = false;
            return result;
        } catch (error) {
            this.isLoading = false;
            this.loadingProgress = 0;
            this._notifyProgressUpdate(0);
            this.defaultErrorHandler(error);
        }
    }

    /**
     * Initialize a zarr dataset from a URL using stateless API
     * @param {string} url - The URL to the zarr dataset
     * @param {string} datasetId - The client-side dataset ID to associate with this dataset
     * @returns {Promise<Object>} Dataset metadata
     */
    async loadFromUrl(url, datasetId = null) {
        this.isLoading = true;
        this.loadingProgress = 0;
        this.cancellationToken = { cancelled: false };
        
        try {
            // Generate dataset ID if not provided
            if (!datasetId) {
                datasetId = 'dataset_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
            }
            
            // Update initial progress
            this.loadingProgress = 20;
            this._notifyProgressUpdate(this.loadingProgress);
            
            // Get dataset info using a stateless GET request
            console.log(`Fetching dataset info from: ${this.apiUrl}/datasets/${encodeURIComponent(url)}/info`);
            const response = await fetch(`${this.apiUrl}/datasets/${encodeURIComponent(url)}/info`, {
                method: 'GET'
            });
            
            if (!response.ok) {
                const error = await response.text();
                throw new Error(`API error: ${error}`);
            }
            
            // Update midway progress
            this.loadingProgress = 70;
            this._notifyProgressUpdate(this.loadingProgress);
            
            const result = await response.json();
            
            // Store dataset path and ID mapping client-side only
            // This is purely a client-side operation, not a server-side state change
            this.datasetInfo = this.datasetInfo || {};
            this.datasetInfo[datasetId] = {
                path: url,
                metadata: result
            };
            
            // Final progress update
            this.loadingProgress = 100;
            this._notifyProgressUpdate(this.loadingProgress);
            
            this.isLoading = false;
            
            // Return an object containing both the result and the dataset ID
            return {
                datasetId: datasetId,
                info: result
            };
        } catch (error) {
            this.isLoading = false;
            this.loadingProgress = 0;
            this._notifyProgressUpdate(0);
            this.defaultErrorHandler(error);
        }
    }
    
    /**
     * Initialize a zarr store from an S3 bucket
     * @param {Object} s3Config - The S3 configuration
     * @returns {Promise<Object>} A success status
     */
    async loadFromS3(s3Config) {
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
            
            // Update initial progress
            this.loadingProgress = 20;
            this._notifyProgressUpdate(this.loadingProgress);
            
            // Send request to backend
            const response = await fetch(`${this.apiUrl}/zarr/s3`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(s3Config)
            });
            
            if (!response.ok) {
                const error = await response.text();
                throw new Error(`API error: ${error}`);
            }
            
            // Update midway progress
            this.loadingProgress = 70;
            this._notifyProgressUpdate(this.loadingProgress);
            
            const result = await response.json();
            
            // Final progress update
            this.loadingProgress = 100;
            this._notifyProgressUpdate(this.loadingProgress);
            
            this.isLoading = false;
            return result;
        } catch (error) {
            this.isLoading = false;
            this.loadingProgress = 0;
            this._notifyProgressUpdate(0);
            this.defaultErrorHandler(error);
        }
    }

    /**
     * Gets AnnData-like structure for a dataset using stateless API
     * @param {string} datasetId - Client-side dataset ID
     * @returns {Promise<Object>} An object with AnnData-like structure
     */
    async convertToAnnData(datasetId = null) {
        this.isLoading = true;
        this.loadingProgress = 0;
        
        try {
            if (!datasetId) {
                throw new Error('Dataset ID is required for stateless operation');
            }
            
            // Get the dataset path from our client-side mapping
            if (!this.datasetInfo || !this.datasetInfo[datasetId] || !this.datasetInfo[datasetId].path) {
                throw new Error(`No dataset path found for ID: ${datasetId}`);
            }
            
            const datasetPath = this.datasetInfo[datasetId].path;
            console.log(`Getting AnnData structure for dataset: ${datasetPath} with ID: ${datasetId}`);
            
            // Initial progress update
            this.loadingProgress = 10;
            this._notifyProgressUpdate(this.loadingProgress);
            
            // Fetch detailed dataset information using stateless API
            const response = await fetch(`${this.apiUrl}/datasets/${encodeURIComponent(datasetPath)}/info`, {
                method: 'GET'
            });
            
            if (!response.ok) {
                const error = await response.text();
                console.error(`Error getting dataset info: ${error}`);
                throw new Error(`API error: ${error}`);
            }
            
            console.log('Response from datasets/info endpoint:', response.status);
            
            // Midway progress update
            this.loadingProgress = 50;
            this._notifyProgressUpdate(this.loadingProgress);
            
            const anndata = await response.json();
            
            // Add the dataset ID to the returned structure
            anndata.dataset_id = datasetId;
            anndata.dataset_path = datasetPath;
            
            // Final progress update
            this.loadingProgress = 100;
            this._notifyProgressUpdate(this.loadingProgress);
            
            this.isLoading = false;
            return anndata;
        } catch (error) {
            this.isLoading = false;
            this.defaultErrorHandler(error);
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
     * Load specific data from zarr array through the Python backend
     * @param {string} path - Path to the zarr array
     * @param {Array} selection - Selection indices [start, stop] or null for all
     * @returns {Promise<Object>} The loaded data
     */
    async loadData(path, selection = null) {
        if (!path) {
            throw new Error('Path is required');
        }
        
        try {
            const queryParams = new URLSearchParams();
            queryParams.append('path', path);
            
            if (selection) {
                queryParams.append('selection', JSON.stringify(selection));
            }
            
            const response = await fetch(`${this.apiUrl}/zarr/data?${queryParams.toString()}`);
            
            if (!response.ok) {
                const error = await response.text();
                throw new Error(`API error: ${error}`);
            }
            
            return await response.json();
        } catch (error) {
            this.defaultErrorHandler(error);
        }
    }
    
    /**
     * Load data using optimized chunking strategy through the Python backend
     * @param {string} path - Path to the zarr array
     * @param {Array} selection - Selection indices [[rowStart, rowStop], [colStart, colStop]]
     * @returns {Promise<Object>} The loaded data with chunking optimized
     */
    async loadChunkedData(path, selection = null) {
        if (!path) {
            throw new Error('Path is required');
        }
        
        try {
            const queryParams = new URLSearchParams();
            queryParams.append('path', path);
            
            if (selection) {
                queryParams.append('selection', JSON.stringify(selection));
            }
            
            // Request chunked data from Python backend
            const response = await fetch(`${this.apiUrl}/zarr/chunked_data?${queryParams.toString()}`);
            
            if (!response.ok) {
                const error = await response.text();
                throw new Error(`API error: ${error}`);
            }
            
            return await response.json();
        } catch (error) {
            this.defaultErrorHandler(error);
        }
    }
    
    /**
     * Load data progressively with callback for progress updates
     * @param {string} path - Path to the zarr array
     * @param {Function} callback - Callback function called with loaded data chunks and progress
     * @param {Object} options - Options for progressive loading
     * @param {number} options.chunkSize - Size of chunks to load at once (sent to backend)
     * @returns {Promise<Object>} The complete loaded data
     */
    async loadProgressively(path, callback, options = {}) {
        if (!path) {
            throw new Error('Path is required');
        }
        
        try {
            const queryParams = new URLSearchParams();
            queryParams.append('path', path);
            
            if (options.chunkSize) {
                queryParams.append('chunk_size', options.chunkSize);
            }
            
            // Set up Server-Sent Events connection for streaming data
            const eventSource = new EventSource(`${this.apiUrl}/zarr/progressive?${queryParams.toString()}`);
            
            return new Promise((resolve, reject) => {
                let accumulatedData = null;
                
                eventSource.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        
                        if (data.error) {
                            reject(new Error(data.error));
                            eventSource.close();
                            return;
                        }
                        
                        if (data.progress && data.chunk) {
                            // Accumulate data
                            if (!accumulatedData) {
                                accumulatedData = data.chunk;
                            } else {
                                // Append to accumulated data based on dimensionality
                                if (Array.isArray(data.chunk)) {
                                    if (Array.isArray(data.chunk[0])) {
                                        // 2D data
                                        accumulatedData = [...accumulatedData, ...data.chunk];
                                    } else {
                                        // 1D data
                                        accumulatedData = [...accumulatedData, ...data.chunk];
                                    }
                                }
                            }
                            
                            // Call the callback with accumulated data and progress
                            callback(accumulatedData, data.progress);
                            
                            // If complete, resolve the promise
                            if (data.progress >= 1.0) {
                                resolve(accumulatedData);
                                eventSource.close();
                            }
                        }
                    } catch (error) {
                        reject(error);
                        eventSource.close();
                    }
                };
                
                eventSource.onerror = (error) => {
                    reject(new Error('Error in SSE connection'));
                    eventSource.close();
                };
            });
        } catch (error) {
            this.defaultErrorHandler(error);
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
/**
 * Data Manager module for AnnZarro
 * Handles loading and processing data from the backend API
 */
import { Config } from './config.js';
import { CacheManager } from './cache-manager.js';

const DataManager = (function() {
    // Private variables
    let _currentDataset = null;
    let _cells = null;
    let _genes = null;
    let _focusedCell = null;
    let _focusedGene = null;
    let _taxonomyId = Config.DEFAULTS.TAXONOMY_ID;
    let _datasetLoaded = false; // Track if a dataset has been loaded
    
    // Selection history tracking
    let _cellHistory = []; // Array of previously selected cells
    let _cellHistoryIndex = -1; // Current position in cell history
    let _geneHistory = []; // Array of previously selected genes
    let _geneHistoryIndex = -1; // Current position in gene history
    
    /**
     * Fetch data from API with caching
     * @param {string} url - API URL
     * @param {Object} params - URL parameters
     * @returns {Promise<Object>} - API response
     */
    async function _fetchWithCache(url, params = {}) {
        const fullUrl = `${url}?${new URLSearchParams(params).toString()}`;
        const cached = CacheManager.get(fullUrl);
        if (cached !== undefined) return cached;

        const response = await fetch(fullUrl);
        const data = await response.json();
        CacheManager.set(fullUrl, data);
        return data;
    }

    function refreshCacheForDataset(datasetPath = _currentDataset) {
        if (!datasetPath) {
            console.warn("No dataset set for refresh.");
            return;
        }
        CacheManager.clear(`dataset_path=${datasetPath}`);
        // Optionally re-fetch structure/cells/genes
        return setCurrentDataset(datasetPath);
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
     * @param {boolean} [silent=false] - If true, don't trigger events or UI updates
     * @returns {Promise<Object>} - Dataset info
     */
    async function setCurrentDataset(datasetPath, silent = false) {
        try {
            _currentDataset = null;
            
            // Store current focused items to check if they exist in new dataset
            const previousFocusedCell = _focusedCell;
            const previousFocusedGene = _focusedGene;
            
            // Load dataset structure
            const _datasetStructure = await getDatasetStructure(datasetPath);
            
            // Load cells and genes
            _cells = await loadCells(datasetPath);
            _genes = await loadGenes(datasetPath);
            
            // Check if previously focused cell exists in new dataset
            if (_cells && _cells.length > 0) {
                if (previousFocusedCell && _cells.includes(previousFocusedCell)) {
                    // Keep the same focused cell
                    _focusedCell = previousFocusedCell;
                } else {
                    // Use first cell from new dataset
                    _focusedCell = _cells[0];
                }
                
                // Only trigger events if not in silent mode
                if (!silent) {
                    // Trigger event for components to update
                    const cellEvent = new CustomEvent('focusedCellChanged', {
                        detail: { cell: _focusedCell }
                    });
                    document.dispatchEvent(cellEvent);
                }
            } else {
                _focusedCell = null;
            }
            
            // Check if previously focused gene exists in new dataset
            if (_genes && _genes.length > 0) {
                if (previousFocusedGene && _genes.includes(previousFocusedGene)) {
                    // Keep the same focused gene
                    _focusedGene = previousFocusedGene;
                } else {
                    // Use first gene from new dataset
                    _focusedGene = _genes[0];
                }
                
                // Only trigger events if not in silent mode
                if (!silent) {
                    // Trigger event for components to update
                    const geneEvent = new CustomEvent('focusedGeneChanged', {
                        detail: { gene: _focusedGene }
                    });
                    document.dispatchEvent(geneEvent);
                }
            } else {
                _focusedGene = null;
            }

            _currentDataset = datasetPath;
            
            // Dispatch a datasetChanged event for components to react to dataset loading
            if (!silent) {
                const datasetEvent = new CustomEvent('datasetChanged', {
                    detail: { dataset: _currentDataset }
                });
                document.dispatchEvent(datasetEvent);
            }
            
            return _datasetStructure;
        } catch (error) {
            console.error('Error setting dataset:', error);
            throw error;
        }
    }
    
    /**
     * Load complete dataset structure
     * @param {string} [datasetPath] - Optional path to the dataset. Defaults to the current dataset.
     * @returns {Promise<Object>} - Dataset structure
     */
    async function getDatasetStructure(datasetPath) {
        const path = datasetPath || _currentDataset;
        if (!path) {
            throw new Error('No dataset path provided or set as current.');
        }

        try {
            const data = await _fetchWithCache(Config.API.DATASET_STRUCTURE, { dataset_path: path });

            if (!data) {
                throw new Error('Received empty dataset structure from API');
            }

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
            if (!obsmKey || obsmKey === '') {
                throw new Error('obsm key is required');
            }
            
            // Fix the URL format to match the API specification from BACKEND_API_REFERENCE.md
            // GET /api/v1/data/obsm/{obsm_key} is the correct format
            const url = `${Config.API.OBSM}/${obsmKey}`;
            console.log(`Requesting obsm data from: ${url} with params:`, params);
            const data = await _fetchWithCache(url, params);
            
            console.log(`Full response data from obsm endpoint:`, data);
            
            // Check if we actually have data
            if (!data || !data.data) {
                console.warn('API response does not contain the expected data format');
                return {
                    data: [],
                    obsm_key: obsmKey,
                    dataset_path: datasetPath
                };
            }
            
            // Check if we have the expected data format
            if (Array.isArray(data.data)) {
                console.log(`Received array data with ${data.data.length} rows`);
                
                // If the column name was specified and we got a 2D array, extract a column
                if (columnName !== undefined && columnName !== null && data.data.length > 0) {
                    console.log(`Extracting column ${columnName} from full obsm data with ${data.data.length} rows`);
                    
                    // First, check if any row exists
                    if (data.data.length === 0) {
                        console.warn('No data points returned from API');
                        return {
                            data: [],
                            obsm_key: obsmKey,
                            dataset_path: datasetPath
                        };
                    }
                    
                    // Check if the data is already a 1D array (backend already extracted the column)
                    if (!Array.isArray(data.data[0])) {
                        console.log(`Received 1D array with ${data.data.length} data points`);
                        return {
                            data: data.data, // Return the data as-is
                            obsm_key: obsmKey,
                            dataset_path: datasetPath
                        };
                    }
                    
                    // We have a 2D array, need to extract column
                    const firstRow = data.data[0];
                    const columnIndex = parseInt(columnName);
                    console.log(`First row has ${firstRow.length} columns, extracting index ${columnIndex}`);
                    
                    if (!isNaN(columnIndex) && columnIndex >= 0 && columnIndex < firstRow.length) {
                        // Extract a specific column from the 2D array
                        const extractedData = data.data.map(row => row[columnIndex]);
                        console.log(`Extracted ${extractedData.length} data points for column ${columnIndex}`);
                        
                        return {
                            data: extractedData,
                            obsm_key: obsmKey,
                            dataset_path: datasetPath
                        };
                    } else {
                        console.warn(`Column index ${columnIndex} is out of bounds (0-${firstRow.length-1})`);
                        // If requested column is out of bounds, return an empty array
                        return {
                            data: [],
                            obsm_key: obsmKey,
                            dataset_path: datasetPath
                        };
                    }
                } else {
                    // No column specified, return the full array
                    return data;
                }
            } else {
                // Data is not an array, just return it as-is
                console.warn('Expected array data but received something else');
            }
            
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
            // Log focused cell details if we're loading for a specific cell
            const focusedCellIndex = rows && rows.length === 1 ? rows[0] : -1;
            const focusedCell = focusedCellIndex >= 0 && _cells ? _cells[focusedCellIndex] : null;
            
            console.log(`Loading obsp data: ${obspKey}, cell: ${focusedCell}, index: ${focusedCellIndex}`);
            console.log(`Obsp request params: dataset_path=${datasetPath}, rows=${params.rows}`);
            
            const url = `${Config.API.OBSP}/${obspKey}`;
            const data = await _fetchWithCache(url, params);
            
            // Log and debug the data structure
            console.log(`Obsp data format for ${obspKey} (cell: ${focusedCell}, index: ${focusedCellIndex}):`,
                        data && data.data ? `Array of ${data.data.length} items` : 'No data');
            
            // Process the data to ensure consistent format
            if (data && data.data && rows && rows.length === 1) {
                // We're loading data for a single focused cell
                if (data.data.length === 1) {
                    // The data is already for a single cell, check its format
                    const cellData = data.data[0];
                    
                    if (!Array.isArray(cellData)) {
                        console.warn(`Expected array data for obsp row, got:`, typeof cellData);
                        // Try to convert to array if not already
                        data.data[0] = Array.isArray(cellData) ? cellData : [cellData];
                    } else {
                        console.log(`Obsp data for cell ${focusedCell} has ${cellData.length} connections`);
                        console.log(`Sample values:`, cellData.slice(0, 5));
                    }
                } else if (data.data.length > 1) {
                    console.warn(`Received multiple rows (${data.data.length}) when requesting single cell ${focusedCell}`);
                    // Extract only the first row to maintain consistency
                    data.data = [data.data[0]];
                } else {
                    console.warn(`No data rows received for focused cell ${focusedCell}`);
                }
            }
            
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
            const focusedGene = cols && cols.length === 1 ? _genes[cols[0]] : null;
            const focusedGeneIndex = focusedGene ? cols[0] : -1;
            
            console.log(`Loading layer data: ${layerName}, gene: ${focusedGene}, index: ${focusedGeneIndex}`);
            console.log(`Layer request params: dataset_path=${datasetPath}, rows=${params.rows}, cols=${params.cols}`);
            
            const url = `${Config.API.LAYER}/${layerName}`;
            const data = await _fetchWithCache(url, params);
            
            // Log and debug the data structure
            console.log(`Layer data format for ${layerName} (gene: ${focusedGene}, index: ${focusedGeneIndex}):`, 
                        data && data.data ? `Array of ${data.data.length} items` : 'No data');
            
            // Process the data to ensure consistent format
            if (data && data.data) {
                // Check if we need to extract a single column from a 2D array
                if (cols && cols.length === 1 && data.data.length > 0) {
                    // Check if the data is already a 1D array
                    if (!Array.isArray(data.data[0])) {
                        console.log(`Layer data already in 1D format with ${data.data.length} elements`);
                        // It's already a 1D array, nothing to do
                        return data;
                    } else {
                        // We have a 2D array, need to extract the first column
                        console.log(`Converting 2D array to 1D for focused gene: ${data.data.length} rows`);
                        
                        try {
                            // Create a new array by extracting the first column from each row
                            const processedData = data.data.map(row => {
                                // Handle edge cases and ensure we always get a number (or NaN)
                                if (Array.isArray(row)) {
                                    return row[0] === undefined ? NaN : row[0];
                                } else {
                                    return row === undefined ? NaN : row;
                                }
                            });
                            
                            console.log(`Processed layer data to 1D array with ${processedData.length} elements`);
                            console.log(`Sample values:`, processedData.slice(0, 5));
                            
                            // Return processed data
                            return {
                                ...data,
                                data: processedData
                            };
                        } catch (e) {
                            console.error(`Error processing layer data:`, e);
                            // Return original data if processing fails
                            return data;
                        }
                    }
                }
            }
            
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
     * Load uns data (unstructured annotations)
     * @param {Object} options - Options for loading uns data
     * @param {string} options.datasetPath - Path to the dataset
     * @param {string} options.unsKey - Key in uns to load
     * @returns {Promise<Object>} - uns data
     */
    async function loadUns(options) {
        const { datasetPath, unsKey } = options;
        
        const params = {
            dataset_path: datasetPath || _currentDataset
        };
        
        try {
            const url = `${Config.API.UNS}/${unsKey}`;
            const data = await _fetchWithCache(url, params);
            if (!data || !data.data) {
                console.warn('API response does not contain the expected data format');
                return {
                    data: [],
                    uns_key: unsKey,
                    dataset_path: datasetPath
                };
            } else if (data && data.data) {
                return {
                    data: data.data,
                    uns_key: unsKey,
                    dataset_path: datasetPath
                }
            }
        } catch (error) {
            console.error('Error loading uns data:', error);
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
     * @param {boolean} fromHistory - Whether this change is from navigating history
     */
    function setFocusedCell(cellName, fromHistory = false) {
        // Skip if same cell is already focused
        if (_focusedCell === cellName) return;
        
        _focusedCell = cellName;
        
        // Handle history
        if (!fromHistory && cellName && cellName !== '') {
            // When selecting a new cell (not from history navigation):
            
            // First, if we're in the middle of history (went back and now selecting a new item)
            // truncate the forward history
            if (_cellHistoryIndex < _cellHistory.length - 1) {
                _cellHistory = _cellHistory.slice(0, _cellHistoryIndex + 1);
            }
            
            _cellHistory.push(cellName);
            _cellHistoryIndex = _cellHistory.length - 1;
        }
        
        // Trigger event for components to update
        const event = new CustomEvent('focusedCellChanged', {
            detail: { 
                cell: cellName,
                fromHistory: fromHistory,
                canGoBack: _cellHistoryIndex > 0,
                canGoForward: _cellHistoryIndex < _cellHistory.length - 1
            }
        });
        document.dispatchEvent(event);
    }
    
    /**
     * Navigate cell history backwards
     * @returns {boolean} - Success
     */
    function navigateCellHistoryBack() {
        // When a user makes a selection, we add it to history
        // To go back, we need to see if we have any history to navigate
        
        if (_cellHistory.length > 1) {
            // If we have history items, find the right one to show
            
            // We might be at the start of our history already
            if (_cellHistoryIndex < 1) {
                 return false;
            }
            
            // Get the cell at the current history index
            const previousCell = _cellHistory[_cellHistoryIndex-1];
            
            // Move index down for next back button press
            _cellHistoryIndex--;
            
            // Apply the previous cell from history
            setFocusedCell(previousCell, true);
            return true;
        }
        return false;
    }
    
    /**
     * Navigate cell history forwards
     * @returns {boolean} - Success
     */
    function navigateCellHistoryForward() {
        // First increment the index
        _cellHistoryIndex++;
        
        // Then check if we have a valid cell at this index
        if (_cellHistoryIndex < _cellHistory.length) {
            const nextCell = _cellHistory[_cellHistoryIndex];
            setFocusedCell(nextCell, true);
            return true;
        } else {
            // We've gone past the end of history
            _cellHistoryIndex = _cellHistory.length - 1;
            return false;
        }
    }
    
    /**
     * Set the focused gene
     * @param {string} geneName - Gene name
     * @param {boolean} fromHistory - Whether this change is from navigating history
     */
    function setFocusedGene(geneName, fromHistory = false) {
        // Skip if same gene is already focused
        if (_focusedGene === geneName) return;
        
        const oldGene = _focusedGene;
        _focusedGene = geneName;
        
        // Handle history
        if (!fromHistory && geneName && geneName !== '') {
            // When selecting a new gene (not from history navigation):
            
            // First, if we're in the middle of history (went back and now selecting a new item)
            // truncate the forward history
            if (_geneHistoryIndex < _geneHistory.length - 1) {
                _geneHistory = _geneHistory.slice(0, _geneHistoryIndex + 1);
            }
            _geneHistory.push(geneName);
            _geneHistoryIndex = _geneHistory.length - 1;
            
        }
        
        // Trigger event for components to update
        const event = new CustomEvent('focusedGeneChanged', {
            detail: { 
                gene: geneName,
                fromHistory: fromHistory,
                canGoBack: _geneHistoryIndex > 0,
                canGoForward: _geneHistoryIndex < _geneHistory.length - 1
            }
        });
        document.dispatchEvent(event);
    }
    
    /**
     * Navigate gene history backwards
     * @returns {boolean} - Success
     */
    function navigateGeneHistoryBack() {
        // When a user makes a selection, we add it to history
        // To go back, we need to see if we have any history to navigate
        
        if (_geneHistory.length > 1) {
            // If we have history items, find the right one to show
            
            // We might be at the start of our history already
            if (_geneHistoryIndex < 1) {
                 return false;
            }
            
            // Get the gene at the current history index
            const previousGene = _geneHistory[_geneHistoryIndex-1];
            
            // Move index down for next back button press
            _geneHistoryIndex--;
            
            // Apply the previous gene from history
            setFocusedGene(previousGene, true);
            return true;
        }
        return false;
    }
    
    /**
     * Navigate gene history forwards
     * @returns {boolean} - Success
     */
    function navigateGeneHistoryForward() {
        // First increment the index
        _geneHistoryIndex++;
        
        // Then check if we have a valid gene at this index
        if (_geneHistoryIndex < _geneHistory.length) {
            const nextGene = _geneHistory[_geneHistoryIndex];
            setFocusedGene(nextGene, true);
            return true;
        } else {
            // We've gone past the end of history
            _geneHistoryIndex = _geneHistory.length - 1;
            return false;
        }
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
                species: Config.DEFAULTS.TAXONOMY_SPECIES[taxId] || 'Custom',
                isCustom: !Config.DEFAULTS.TAXONOMY_SPECIES[taxId]
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
     * Get the cell names
     * @returns {Array<string>} - Cell names in their original order
     */
    function getCells() {
        if (!_cells) return [];
        // Return a copy to avoid modifying the original array
        return [..._cells]; // No sorting to maintain original order
    }
    
    /**
     * Get the cell names, sorted alphabetically
     * @returns {Array<string>} - Cell names sorted alphabetically
     */
    function getSortedCells() {
        if (!_cells) return [];
        
        // Return a sorted copy
        return [..._cells].sort();
    }
    
    /**
     * Get the gene names
     * @returns {Array<string>} - Gene names in their original order
     */
    function getGenes() {
        if (!_genes) return [];
        // Return a copy to avoid modifying the original array
        return [..._genes]; // No sorting to maintain original order
    }
    
    /**
     * Get the gene names, sorted alphabetically
     * @returns {Array<string>} - Gene names sorted alphabetically
     */
    function getSortedGenes() {
        if (!_genes) return [];
        
        // Return a sorted copy
        return [..._genes].sort();
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
        return Config.DEFAULTS.TAXONOMY_SPECIES[_taxonomyId] || 'Custom';
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
    
    /**
     * Check if a dataset is currently loaded
     * @returns {boolean} - True if a dataset is loaded, false otherwise
     */
    function isDatasetLoaded() {
        return _currentDataset !== null;
    }

    // Public API
    return {
        loadDatasets,
        setCurrentDataset,
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
        loadUns,
        loadByPath,
        setFocusedCell,
        setFocusedGene,
        setTaxonomyId,
        getCurrentDataset,
        getDatasetStructure,
        getCells,
        getSortedCells,
        getGenes,
        getSortedGenes, 
        getFocusedCell,
        getFocusedGene,
        getTaxonomyId,
        getTaxonomySpecies,
        getCellIndex,
        getGeneIndex,
        isDatasetLoaded,
        // Caching
        clearCache: (pattern) => CacheManager.clear(pattern),
        refreshCacheForDataset,
        getCacheKeys: () => CacheManager.keys(),
        // History navigation functions
        navigateCellHistoryBack,
        navigateCellHistoryForward,
        navigateGeneHistoryBack,
        navigateGeneHistoryForward
    };
})();

// Export the module
export { DataManager };
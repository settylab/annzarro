/**
 * Data Manager module for AnnZarro
 * Handles loading and processing data from the backend API
 */
import { Config } from './config.js';
import { subsetParam } from './utils/subset.js';
import { notify } from './utils/notify.js';
import { CacheManager } from './cache-manager.js';
import { BINARY_FORMAT, categoricalValues, decodeVector, isBinaryResponse, toJSONShape } from './utils/wire.js';

// Marks a cached body that is a decoded binary slice, not parsed JSON.
const BINARY_RESULT = Symbol('binarySlice');

const DataManager = (function() {
    // Private variables
    let _currentDataset = null;
    let _cells = null;
    // Bumped whenever the loaded cells/genes change (switch, revert, clear).
    // Plot data built under an older generation belongs to another dataset.
    let _datasetGeneration = 0;
    let _genes = null;
    let _focusedCell = null;
    let _focusedGene = null;
    let _taxonomyId = Config.DEFAULTS.TAXONOMY_ID;
    let _datasetLoaded = false; // Track if a dataset has been loaded

    // The cell subset in effect (utils/subset.js, annzarro/core/subset.py):
    // the /data/subset reply plus the dataset it belongs to, or null when
    // every cell is shown. Every cell-axis request for that dataset carries
    // its key, so _cells, every index into it and every panel's arrays are
    // the subset's. _subsetRequest is what the next dataset load applies:
    // 'auto' (the server's default for the dataset's size; for a reload of
    // the same dataset, keep the current one), null (every cell) or a spec.
    let _subset = null;
    let _subsetRequest = 'auto';
    let _subsetReply = null;   // the last /data/subset reply, also when it was "every cell"

    // Routes whose answer depends on which cells are shown.
    const _CELL_AXIS_ROUTES = [Config.API.CELLS, Config.API.OBS, Config.API.X];
    const _CELL_AXIS_PREFIXES = [Config.API.OBSM, Config.API.OBSP, Config.API.LAYER].map(u => `${u}/`);

    /** `params` plus the subset key, for a cell-axis read of the subset's dataset. */
    function _withSubset(url, params) {
        if (!_subset || params.subset !== undefined || params.dataset_path !== _subset.datasetPath) {
            return params;
        }
        if (_CELL_AXIS_ROUTES.includes(url) || _CELL_AXIS_PREFIXES.some(p => url.startsWith(p))) {
            return { ...params, subset: _subset.key };
        }
        return params;
    }
    
    // Selection history tracking
    let _cellHistory = []; // Array of previously selected cells
    let _cellHistoryIndex = -1; // Current position in cell history
    let _geneHistory = []; // Array of previously selected genes
    let _geneHistoryIndex = -1; // Current position in gene history
    
    /**
     * Very fast “safe” JSON.parse that converts
     * unquoted NaN/Infinity/-Infinity into null.
     * @param {string} jsonText - JSON text to parse
     * @returns {Object} Parsed JSON object
     */
    function _safeJSONParse(text) {
        try {
        return JSON.parse(text);
        } catch (err) {
        // only replace tokens that aren’t inside quotes:
        // lookbehind (?<=[\[:,\s]) and lookahead (?=[,\]\}\s])
        const FIX_SPECIAL = /(?<=[[{,:]\s*)(-?Infinity|NaN)(?=\s*[,}\]\s])/g;
        const cleaned = text.replace(FIX_SPECIAL, 'null');
        // second chance
        return JSON.parse(cleaned);
        }
    }

    // One network request per URL at a time. On a deep-link boot every panel
    // asked for the same slices at once: 30 requests (19.5 MB) for 13 unique
    // ones (6.2 MB). A second caller for a URL that is already in flight now
    // joins that request instead of starting another; the short-lived
    // CacheManager entry then serves later callers.
    const _inflight = new Map();

    async function _readResponse(response) {
        if (!response.ok) {
            // Parse the error response to get the detailed error message
            const text = await response.text();
            let errorData;
            try {
                errorData = _safeJSONParse(text);
            } catch (e) {
                // If JSON parsing fails, use the raw text
                errorData = { error: "Unknown error", message: text };
            }

            // Create a custom error with the error details from the server
            const error = new Error(errorData.message || errorData.error || `Request failed with status ${response.status}`);
            error.status = response.status;
            error.data = errorData;
            throw error;
        }
        if (isBinaryResponse(response)) {
            // Kept decoded (typed, dense) in the cache; loaders turn it into
            // the JSON-shaped arrays the views expect, one copy per call.
            return { [BINARY_RESULT]: true, ...decodeVector(await response.arrayBuffer(), response.headers) };
        }
        // Use the safer JSON parsing approach
        return _safeJSONParse(await response.text());
    }

    function _startShared(fullUrl) {
        const controller = new AbortController();
        const entry = { controller, waiters: 0, settled: false, promise: null };
        entry.promise = (async () => {
            try {
                const data = await _readResponse(await fetch(fullUrl, { signal: controller.signal }));
                CacheManager.set(fullUrl, data);
                return data;
            } finally {
                entry.settled = true;
                if (_inflight.get(fullUrl) === entry) _inflight.delete(fullUrl);
            }
        })();
        // Every waiter attaches its own handlers; this one only keeps a
        // request that all of its waiters abandoned from being "unhandled".
        entry.promise.catch(() => {});
        _inflight.set(fullUrl, entry);
        return entry;
    }

    /** Wait for a shared request, honouring THIS caller's abort signal only. */
    function _join(fullUrl, entry, signal) {
        entry.waiters += 1;
        return new Promise((resolve, reject) => {
            let done = false;
            const leave = () => {
                done = true;
                entry.waiters -= 1;
                if (signal) signal.removeEventListener('abort', onAbort);
            };
            const onAbort = () => {
                if (done) return;
                leave();
                if (entry.waiters === 0 && !entry.settled) {
                    // Nobody wants it any more: cancel it, and let the next
                    // caller start afresh rather than join a dying request.
                    if (_inflight.get(fullUrl) === entry) _inflight.delete(fullUrl);
                    entry.controller.abort();
                }
                reject(new DOMException("Fetch request was aborted", "AbortError"));
            };
            if (signal) signal.addEventListener('abort', onAbort, { once: true });
            entry.promise.then(
                value => { if (!done) { leave(); resolve(value); } },
                error => { if (!done) { leave(); reject(error); } }
            );
        });
    }

    async function _fetchWithCache(url, params = {}, signal = null) {
        params = _withSubset(url, params);
        const fullUrl = `${url}?${new URLSearchParams(params).toString()}`;
        const cached = CacheManager.get(fullUrl);
        if (cached !== undefined && !signal?.aborted) return cached;

        try {
            // If we have a signal and it's already aborted, throw immediately
            if (signal && signal.aborted) {
                throw new DOMException("Fetch request was aborted", "AbortError");
            }
            const entry = _inflight.get(fullUrl) || _startShared(fullUrl);
            return await _join(fullUrl, entry, signal);
        } catch (error) {
            // Only log non-abort errors
            if (!error || error.name !== 'AbortError') {
                console.error('Error fetching from', fullUrl, error);
                // Note: We removed the dataFetchError event dispatch here
                // since it was causing duplicate error notifications
            } else {
                // Suppress this log in production
                if (Config.DEBUG_MODE) {
                    console.log('Fetch aborted for', fullUrl);
                }
            }
            throw error;
        }
    }

    /**
     * Fetch one numeric slice in the binary encoding (`format=f32`) and give
     * back the body the JSON route would have: `{data, ...meta}`.
     *
     * The server answers JSON instead whenever the slice is not numeric
     * (strings, booleans); that body is returned as is. An obs/var column
     * also asks for `categorical=codes`: a categorical column then comes as
     * one integer code per cell plus its categories (about 1 B per cell
     * instead of ~12 B of JSON) and is expanded here into the same
     * `{data: {[column]: values}, categories: {[column]: [...]}}` body.
     * @param {boolean} flatten  `data` as one flat array for a single row or
     *                           column, which is what every loader made of it
     * @param {string|null} column  obs/var: `data` is `{[column]: values}`
     */
    async function _fetchVector(url, params, meta, flatten, column = null) {
        const query = { ...params, format: BINARY_FORMAT };
        if (column !== null) query.categorical = 'codes';
        const body = await _fetchWithCache(url, query);
        if (!body || !body[BINARY_RESULT]) return body;
        if (body.encoding === 'categorical') {
            return { ...meta, data: { [column]: categoricalValues(body) },
                     categories: { [column]: [...body.categories] } };
        }
        const values = toJSONShape(body, flatten);
        return { ...meta, data: column === null ? values : { [column]: values } };
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
     * Reset backend zarr reader cache for a specific dataset or all datasets
     * @param {string} [datasetPath] - Optional dataset path to reset cache for
     * @returns {Promise<Object>} - Cache reset result information
     */
    async function resetBackendCache(datasetPath = null) {
        try {
            const params = {};
            if (datasetPath) {
                params.dataset_path = datasetPath;
            }
            
            const response = await fetch(`${Config.API.CACHE_RESET}?${new URLSearchParams(params).toString()}`, {
                method: 'POST'
            });
            
            if (response.status === 403) {
                // admin-only on a hosted server: an expected refusal, not an error
                return { status: 'forbidden', reason: 'admin_only' };
            }
            if (!response.ok) {
                throw new Error(`Server responded with status: ${response.status}`);
            }
            
            const data = await response.json();
            console.log('Backend cache reset result:', data);
            return data;
        } catch (error) {
            console.error('Error resetting backend cache:', error);
            throw error;
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
     * @param {boolean} [silent=false] - If true, don't trigger events or UI updates
     * @param {AbortSignal} [signal=null] - Optional AbortSignal to allow cancellation
     * @param {boolean} [keepCurrentOnError=true] - If true, don't clear the current dataset on error
     * @returns {Promise<Object>} - Dataset info
     */
    async function setCurrentDataset(datasetPath, silent = false, signal = null, keepCurrentOnError = true) {
        // Store the previous dataset in case we need to revert
        const previousDataset = _currentDataset;
        const previousCells = _cells;
        const previousGenes = _genes;
        const previousSubset = _subset;
        
        try {
            // Update the current dataset path (will be reverted on error if keepCurrentOnError is true)
            _currentDataset = datasetPath;
            
            // Check for abort signal before each async operation
            if (signal && signal.aborted) {
                throw new DOMException("Dataset loading aborted", "AbortError");
            }
            
            // Load dataset structure 
            const _datasetStructure = await getDatasetStructure(datasetPath, signal);
            
            if (signal && signal.aborted) {
                throw new DOMException("Dataset loading aborted", "AbortError");
            }
            
            // Reset cells and genes before loading new ones
            _datasetGeneration++;
            _cells = null;
            _genes = null;

            // Decide which cells this dataset shows, before naming them
            _subset = await _resolveSubset(datasetPath, previousSubset, signal);

            // Load cells and genes
            _cells = await loadCells(datasetPath, signal);
            
            if (signal && signal.aborted) {
                throw new DOMException("Dataset loading aborted", "AbortError");
            }
            
            _genes = await loadGenes(datasetPath, signal);
            
            if (signal && signal.aborted) {
                throw new DOMException("Dataset loading aborted", "AbortError");
            }
            
            // Dispatch a datasetChanged event for components to react to dataset loading
            if (!silent) {
                const datasetEvent = new CustomEvent('datasetChanged', {
                    detail: { 
                        dataset: _currentDataset,
                        focusedCell: _focusedCell,
                        focusedGene: _focusedGene,
                        structure: _datasetStructure
                    }
                });
                document.dispatchEvent(datasetEvent);
            }
            
            return _datasetStructure;
        } catch (error) {
            // Only log non-abort errors
            if (!error || error.name !== 'AbortError') {
                console.error('Error setting dataset:', error);
                
                // Revert to the previous dataset if keepCurrentOnError is true
                if (keepCurrentOnError && previousDataset) {
                    console.log('Reverting to previous dataset due to error');
                    _currentDataset = previousDataset;
                    _cells = previousCells;
                    _genes = previousGenes;
                    _subset = previousSubset;
                    _datasetGeneration++;
                    
                    // We're not dispatching datasetLoadError event here anymore
                    // since the error is already handled in _loadDataset function in main.js.
                    // This prevents duplicate error notifications.
                } else {
                    // If we're not keeping the current dataset, clear everything
                    _currentDataset = null;
                    _cells = null;
                    _genes = null;
                    _subset = null;
                    _datasetGeneration++;
                    
                    // Dispatch a datasetCleared event
                    if (!silent) {
                        const clearEvent = new CustomEvent('datasetCleared', {
                            detail: { 
                                error: error.message || "Unknown error",
                                attemptedPath: datasetPath
                            }
                        });
                        document.dispatchEvent(clearEvent);
                    }
                }
            } else if (Config.DEBUG_MODE) {
                console.debug('Dataset loading aborted');
            }
            throw error;
        }
    }
    
    /**
     * Ask the server which cells a dataset load shows (/data/subset).
     * Consumes _subsetRequest: a later load of another dataset starts from
     * its own default again.
     * @returns {Promise<Object|null>} the subset in effect, null for every cell
     * @private
     */
    async function _resolveSubset(datasetPath, previous, signal) {
        let request = _subsetRequest;
        _subsetRequest = 'auto';
        if (request === 'auto' && previous && previous.datasetPath === datasetPath) {
            request = previous.subset;   // a reload keeps the subset it had
        }
        let info;
        try {
            const param = request === 'auto' ? 'auto' : subsetParam(request);
            info = await _fetchWithCache(Config.API.SUBSET,
                { dataset_path: datasetPath, subset: param }, signal);
        } catch (error) {
            if (error && error.name === 'AbortError') throw error;
            if (request === 'auto') {
                // A server that cannot say (an older one without the route)
                // serves every cell, as before subsets existed.
                console.warn('No cell subset information; showing every cell:', error);
                _subsetReply = null;
                return null;
            }
            // A link or panel set whose subset this dataset cannot apply (a
            // column it lacks) still opens, on the default, and says so.
            notify('Cell subset not applied',
                `${error.message || error}\nShowing the default for this dataset instead.`, 'warning');
            info = await _fetchWithCache(Config.API.SUBSET,
                { dataset_path: datasetPath, subset: 'auto' }, signal);
        }
        _subsetReply = info ? { ...info, datasetPath } : null;
        return info && info.subset ? { ...info, datasetPath } : null;
    }

    /**
     * Choose the cells the next dataset load shows.
     * @param {'auto'|null|Object} request - 'auto' (the server's default for
     *   the dataset's size), null (every cell) or a subset spec
     */
    function setSubsetRequest(request) {
        _subsetRequest = request === undefined ? 'auto' : request;
    }

    /**
     * The subset in effect: the /data/subset reply ({subset, key, n,
     * n_total, n_eligible, groups?, defaults}), or null for every cell.
     */
    function getSubset() {
        return _subset ? { ..._subset } : null;
    }

    /**
     * The `subset` a share link or panel set records: the spec in effect;
     * null (every cell) when every cell is shown of a dataset that would
     * open on a subset; undefined (no opinion: the default) otherwise, so
     * views of small datasets are unchanged.
     */
    function getSubsetForView() {
        if (_subset) return _subset.subset;
        const reply = _subsetReply;
        if (reply && reply.datasetPath === _currentDataset && reply.defaults &&
                reply.n_total > reply.defaults.threshold) {
            return null;
        }
        return undefined;
    }

    /** The /data/subset reply for the open dataset (n_total, defaults), also without a subset. */
    function getSubsetReply() {
        return _subsetReply && _subsetReply.datasetPath === _currentDataset ? { ..._subsetReply } : null;
    }

    /** The `subset` request parameter in effect, or null for every cell. */
    function getSubsetParam() {
        return _subset ? _subset.key : null;
    }

    /** Cells of the dataset that are not loaded because of the subset. */
    function getCellsNotInSubset() {
        return _subset ? Math.max(0, _subset.n_total - _subset.n) : 0;
    }

    /**
     * Load complete dataset structure
     * @param {string} [datasetPath] - Optional path to the dataset. Defaults to the current dataset.
     * @param {AbortSignal} [signal=null] - Optional AbortSignal to allow cancellation
     * @returns {Promise<Object>} - Dataset structure
     */
    async function getDatasetStructure(datasetPath, signal = null) {
        const path = datasetPath || _currentDataset;
        if (!path) {
            throw new Error('No dataset path provided or set as current.');
        }

        try {
            // Check for abort before making request
            if (signal && signal.aborted) {
                throw new DOMException("Dataset structure loading aborted", "AbortError");
            }
            
            const data = await _fetchWithCache(Config.API.DATASET_STRUCTURE, { dataset_path: path }, signal);

            if (!data) {
                throw new Error('Received empty dataset structure from API');
            }

            return data;
        } catch (error) {
            // Only log non-abort errors
            if (!error || error.name !== 'AbortError') {
                console.error('Error loading dataset structure:', error);
            } else if (Config.DEBUG_MODE) {
                console.debug('Dataset structure loading aborted');
            }
            throw error;
        }
    }
    
    /**
     * Load cell names from the dataset
     * @param {string} datasetPath - Path to the dataset
     * @param {AbortSignal} [signal=null] - Optional AbortSignal to allow cancellation
     * @returns {Promise<Array<string>>} - List of cell names
     * @throws {Error} If there's an error loading the cells
     */
    async function loadCells(datasetPath, signal = null) {
        try {
            // Check for abort before making request
            if (signal && signal.aborted) {
                throw new DOMException("Cells loading aborted", "AbortError");
            }
            
            const data = await _fetchWithCache(Config.API.CELLS, { dataset_path: datasetPath }, signal);
            
            // Check if response contains error information
            if (data && data.status === 'error') {
                throw new Error(data.message || data.error || 'Failed to load cells');
            }
            
            return data.cells || [];
        } catch (error) {
            // Only log non-abort errors
            if (!error || error.name !== 'AbortError') {
                console.error('Error loading cells:', error);
            } else if (Config.DEBUG_MODE) {
                console.debug('Cells loading aborted');
            }
            
            // Rethrow the error to propagate it up
            throw error;
        }
    }
    
    /**
     * Load gene names from the dataset
     * @param {string} datasetPath - Path to the dataset
     * @param {AbortSignal} [signal=null] - Optional AbortSignal to allow cancellation
     * @returns {Promise<Array<string>>} - List of gene names
     * @throws {Error} If there's an error loading the genes
     */
    async function loadGenes(datasetPath, signal = null) {
        try {
            // Check for abort before making request
            if (signal && signal.aborted) {
                throw new DOMException("Genes loading aborted", "AbortError");
            }
            
            const data = await _fetchWithCache(Config.API.GENES, { dataset_path: datasetPath }, signal);
            
            // Check if response contains error information
            if (data && data.status === 'error') {
                throw new Error(data.message || data.error || 'Failed to load genes');
            }
            
            return data.genes || [];
        } catch (error) {
            // Only log non-abort errors
            if (!error || error.name !== 'AbortError') {
                console.error('Error loading genes:', error);
            } else if (Config.DEBUG_MODE) {
                console.debug('Genes loading aborted');
            }
            
            // Rethrow the error to propagate it up
            throw error;
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
            if (columns && columns.length === 1) {
                const column = columns[0];
                return await _fetchVector(Config.API.OBS, params,
                    { dataset_path: params.dataset_path }, true, column);
            }
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
            if (columns && columns.length === 1) {
                const column = columns[0];
                return await _fetchVector(Config.API.VAR, params,
                    { dataset_path: params.dataset_path }, true, column);
            }
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
        
        if (columnName !== undefined && columnName !== null && columnName !== '') {
            params.column_name = String(columnName);
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
            if (columnName === '') {
                // No column chosen: nothing to read. This used to fetch the
                // WHOLE matrix and then return [] from the column extraction.
                return { data: [], obsm_key: obsmKey, dataset_path: datasetPath };
            }
            const url = `${Config.API.OBSM}/${obsmKey}`;
            console.log(`Requesting obsm data from: ${url} with params:`, params);
            const data = await _fetchVector(url, params,
                { obsm_key: obsmKey, dataset_path: params.dataset_path },
                params.column_name !== undefined);
            
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
        
        if (columnName !== undefined && columnName !== null && columnName !== '') {
            params.column_name = String(columnName);
        }

        if (maxGenes) {
            params.max_genes = maxGenes;
        }
        
        try {
            if (columnName === '') {
                return { data: [], varm_key: varmKey, dataset_path: datasetPath };
            }
            const url = `${Config.API.VARM}/${varmKey}`;
            const data = await _fetchVector(url, params,
                { varm_key: varmKey, dataset_path: params.dataset_path },
                params.column_name !== undefined);
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
            console.log(`Obsp request params: dataset_path=${params.dataset_path}, rows=${params.rows}`);
            
            const url = `${Config.API.OBSP}/${obspKey}`;
            const data = await _fetchVector(url, params,
                { obsp_key: obspKey, dataset_path: params.dataset_path }, false);
            
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
            const data = await _fetchVector(url, params,
                { varp_key: varpKey, dataset_path: params.dataset_path }, false);
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
            // Branch on the request (one column = one gene), not on whether
            // the index resolves to a name: _genes/_cells are null after a
            // cleared or failed load, and indexing them threw a TypeError
            // (or, guarded alone, sent a gene request down the cell path).
            const focusedGeneIndex = cols && cols.length === 1 ? cols[0] : -1;
            const focusedGene = focusedGeneIndex >= 0 && _genes ? _genes[focusedGeneIndex] : null;
            const focusedCellIndex = rows && rows.length === 1 ? rows[0] : -1;
            const focusedCell = focusedCellIndex >= 0 && _cells ? _cells[focusedCellIndex] : null;

            if (focusedGeneIndex >= 0) {
                console.log(`Loading layer data: ${layerName}, gene: ${focusedGene}, index: ${focusedGeneIndex}`);
                console.log(`Layer request params: dataset_path=${params.dataset_path}, rows=${params.rows}, cols=${params.cols}`);
                
                const url = `${Config.API.LAYER}/${layerName}`;
                const data = await _fetchVector(url, params,
                    { layer_name: layerName, dataset_path: params.dataset_path }, true);
                
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
            }
            else {
                console.log(`Loading layer data: ${layerName}, cell: ${focusedCell}, index: ${focusedCellIndex}`);
                console.log(`Layer request params: dataset_path=${params.dataset_path}, rows=${params.rows}, cols=${params.cols}`);
                
                const url = `${Config.API.LAYER}/${layerName}`;
                const data = await _fetchVector(url, params,
                    { layer_name: layerName, dataset_path: params.dataset_path }, true);
                
                // Log and debug the data structure
                console.log(`Layer data format for ${layerName} (gene: ${focusedCell}, index: ${focusedCellIndex}):`, 
                            data && data.data ? `Array of ${data.data.length} items` : 'No data');
                
                // Process the data to ensure consistent format
                if (data && data.data) {
                    // Check if we need to extract a single column from a 2D array
                    if (rows && rows.length === 1 && data.data.length > 0) {
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
                                //data.data[0] is a single list containing the data - unlike the cell table where it is a list of lists,
                                const processedData = data.data[0];
                                
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
            }
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
            const data = await _fetchVector(Config.API.X, params,
                { dataset_path: params.dataset_path }, false);
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
        
        // A key the dataset does not have is not asked for: the plots look
        // up `<column>_colors` for every categorical colour, and most columns
        // have none, which logged a 404 for each. The structure lists the
        // top-level uns keys (a server that does not say is asked as before).
        let keys;
        try {
            const structure = await getDatasetStructure(params.dataset_path);
            keys = structure && structure.uns && Array.isArray(structure.uns.keys) ? structure.uns.keys : null;
        } catch {
            keys = null;
        }
        if (keys && !keys.includes(String(unsKey).split('/')[0])) {
            return { data: [], uns_key: unsKey, dataset_path: datasetPath, missing: true };
        }

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
                canGoForward: _cellHistoryIndex < _cellHistory.length - 1,
                duringDatasetTransition: false // Regular focus change, not during dataset transition
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
                canGoForward: _geneHistoryIndex < _geneHistory.length - 1,
                duringDatasetTransition: false // Regular focus change, not during dataset transition
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
        getDatasetGeneration: () => _datasetGeneration,
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
        // Cell subset
        setSubsetRequest,
        getSubset,
        getSubsetParam,
        getSubsetForView,
        getSubsetReply,
        getCellsNotInSubset,
        // Caching
        clearCache: (pattern) => CacheManager.clear(pattern),
        refreshCacheForDataset,
        resetBackendCache,
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
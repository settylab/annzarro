/**
 * Data Manager module for AnnZarro
 * Handles loading and processing data from the backend API
 */
import { Config } from './config.js';
import { subsetParam } from './utils/subset.js';
import { notify } from './utils/notify.js';
import { CacheManager } from './cache-manager.js';
import { BINARY_FORMAT, categoricalValues, decodeVector, isBinaryResponse, toJSONShape } from './utils/wire.js';
import { PackedNames, categoryCodesFromJSON } from './utils/packed-names.js';
import { RemoteNames } from './utils/remote-names.js';

// A /cells body above this size is read as a stream into PackedNames
// (ArrayBuffers) instead of one JSON string and an array of JS strings: about
// 12M cells with 19-character names. Above about 24M such cells the JSON text
// no longer fits in one V8 string at all. Below it the names stay a plain
// array, which every view accepts; only the large Cell Plot path
// (large-plot.js) works with packed names; it takes over above 1M cells by default.
const PACKED_NAMES_ABOVE_BYTES = 256 * 1024 * 1024;

// Marks a cached body that is a decoded binary slice, not parsed JSON.
const BINARY_RESULT = Symbol('binarySlice');

const DataManager = (function() {
    // Private variables
    let _currentDataset = null;
    let _cells = null;
    // Bumped whenever the loaded cells/genes change (switch, revert, clear).
    // Plot data built under an older generation belongs to another dataset.
    let _datasetGeneration = 0;
    // Settles when the dataset being opened has its cell and gene names (or
    // failed to open); null when no open is in flight. Until then an empty
    // name list means "not read yet", not "this dataset has none".
    let _namesLoading = null;
    let _genes = null;
    let _focusedCell = null;
    let _focusedGene = null;
    let _taxonomyId = Config.DEFAULTS.TAXONOMY_ID;
    // where the species came from: 'explicit' (a user's pick, a link, a
    // panel set), 'inferred' (from the dataset, e.g. its Ensembl ids) or
    // 'default' (the server's ui.defaults.taxonomy_id); a new dataset starts
    // from 'default'
    let _taxonomySource = 'default';
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

    // Dataset rows of cells by name, for the open dataset (see locateCell):
    // learned rows, and unconfirmed hints from a link or panel set
    let _cellRows = { datasetPath: null, rows: new Map(), hints: new Map() };
    // Where each name is in the cells shown, per dataset load and subset:
    // the lookup, and its answer once there is one
    let _located = { generation: -1, key: null, byName: new Map(), settled: new Map() };

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

    /**
     * Drop every cached reply for one dataset. The keys are request URLs,
     * whose dataset_path is URL-encoded (`%2Fdata%2Fa.zarr`); matching the
     * raw path (`dataset_path=/data/a.zarr`) found none of them, so a
     * refresh within the 60 s lifetime redrew from the old replies without
     * a single request. Compared as a parsed parameter, so /data/a.zarr
     * does not also clear /data/a.zarr2.
     * @returns {number} how many replies were dropped
     */
    function clearDatasetCache(datasetPath = _currentDataset) {
        if (!datasetPath) return 0;
        let dropped = 0;
        for (const key of CacheManager.keys()) {
            const query = key.indexOf('?');
            if (query < 0) continue;
            if (new URLSearchParams(key.slice(query + 1)).get('dataset_path') === datasetPath) {
                CacheManager.remove(key);
                dropped += 1;
            }
        }
        return dropped;
    }

    function refreshCacheForDataset(datasetPath = _currentDataset) {
        if (!datasetPath) {
            console.warn("No dataset set for refresh.");
            return;
        }
        clearDatasetCache(datasetPath);
        _cellRows = { datasetPath: null, rows: new Map(), hints: new Map() };
        // Optionally re-fetch structure/cells/genes
        return setCurrentDataset(datasetPath);
    }

    /**
     * Ask the server to check the dataset against the disk (POST data/refresh,
     * open to every user). When the store changed, every server process
     * serves the change from now on and the browser's revalidations get new
     * ETags; an unchanged store keeps everyone's caches. A failure is logged
     * and reported, not thrown: the refresh in this browser still goes ahead.
     * @returns {Promise<Object|null>} `{changed, checked}` or null
     */
    async function revalidateDataset(datasetPath = _currentDataset, { wait = ms => new Promise(r => setTimeout(r, ms)), maxPolls = 6 } = {}) {
        if (!datasetPath) return null;
        try {
            // Inside the server's refresh interval the server schedules one
            // walk for the interval's end and answers at once ("scheduled",
            // with `after`); the waiting happens here, not in a server worker
            // (issue #83). Asking again with `after` returns that walk's result.
            const params = { dataset_path: datasetPath };
            for (let poll = 0; ; poll++) {
                const response = await fetch(`${Config.API.DATA_REFRESH}?${new URLSearchParams(params)}`,
                    { method: 'POST' });
                if (!response.ok) throw new Error(`Server responded with status: ${response.status}`);
                const result = await response.json();
                if (result.status !== 'scheduled' || poll >= maxPolls) return result;
                params.after = String(result.after);
                await wait(Math.max(200, (Number(result.retry_after_s) || 1) * 1000));
            }
        } catch (error) {
            console.warn('The server did not re-check the dataset:', error && error.message);
            return null;
        }
    }

    /**
     * What a panel's Refresh needs before it redraws: the server re-checks
     * the dataset against the disk (revalidateDataset) and this browser's
     * copies of the dataset's replies are dropped, so the redraw reads past
     * them. Without this a Refresh within 60 s of a load sent no request.
     * @returns {Promise<Object|null>} the server's `{changed, checked}`, or null
     */
    async function reloadDatasetData(datasetPath = _currentDataset) {
        const result = await revalidateDataset(datasetPath);
        clearDatasetCache(datasetPath);
        return result;
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
     * Show other cells of the open dataset (a part step, a new seed or n):
     * the subset requested with setSubsetRequest and its cell names, read
     * again; the structure and the genes are the dataset's and stay. Bumps
     * the dataset generation, so a load for the previous cells is dropped.
     * On an error the previous cells stay and the error is thrown.
     * @param {AbortSignal} [signal]
     * @returns {Promise<Object|null>} the new subset
     */
    async function reloadSubset(signal = null) {
        const datasetPath = _currentDataset;
        if (!datasetPath) throw new Error('No dataset is open');
        const previous = { cells: _cells, subset: _subset, generation: _datasetGeneration };
        try {
            _datasetGeneration++;
            // the cell routes read the subset from _subset
            _subset = await _resolveSubset(datasetPath, previous.subset, signal);
            const structure = await getDatasetStructure(datasetPath, signal);
            const nShown = _subset ? _subset.n : (structure && structure.n_obs);
            const cells = await loadCells(datasetPath, signal, nShown);
            if (signal && signal.aborted) throw new DOMException('Subset change aborted', 'AbortError');
            _cells = cells;
            return _subset;
        } catch (error) {
            _datasetGeneration++;
            _cells = previous.cells;
            _subset = previous.subset;
            throw error;
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
        let namesSettled = () => {};
        const namesLoading = _namesLoading = new Promise(resolve => { namesSettled = resolve; });
        const settleNames = () => {
            namesSettled();
            if (_namesLoading === namesLoading) _namesLoading = null;
        };
        
        try {
            // Update the current dataset path (will be reverted on error if keepCurrentOnError is true)
            _currentDataset = datasetPath;
            if (datasetPath !== previousDataset) _taxonomySource = 'default';
            
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
            const nShown = _subset ? _subset.n : (_datasetStructure && _datasetStructure.n_obs);
            _cells = await loadCells(datasetPath, signal, nShown);
            
            if (signal && signal.aborted) {
                throw new DOMException("Dataset loading aborted", "AbortError");
            }
            
            _genes = await loadGenes(datasetPath, signal);
            
            if (signal && signal.aborted) {
                throw new DOMException("Dataset loading aborted", "AbortError");
            }
            // before datasetChanged: its listeners may draw at once
            settleNames();
            
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
        } finally {
            settleNames();
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
    /**
     * The names of the cells shown, kept on the server (utils/remote-names.js):
     * one name by index from obs/_index, one index by name from /data/names.
     */
    function _remoteNames(datasetPath, n) {
        const fetchNames = async (indices) => {
            const params = _withSubset(Config.API.OBS,
                { dataset_path: datasetPath, columns: '_index', rows: indices.join(',') });
            const body = await _readResponse(await fetch(`${Config.API.OBS}?${new URLSearchParams(params)}`));
            return (body && body.data && body.data._index) || [];
        };
        const lookup = async (name) => {
            const params = new URLSearchParams({ dataset_path: datasetPath, entity: 'cells', q: name,
                mode: 'exact', limit: '1' });
            if (_subset && _subset.datasetPath === datasetPath) params.set('subset', _subset.key);
            const body = await _readResponse(await fetch(`${Config.API.NAMES}?${params}`));
            const hit = body && body.matches && body.matches[0];
            if (hit && hit.name === name && typeof hit.row === 'number') _learnRow(datasetPath, name, hit.row);
            return hit && hit.name === name ? hit.index : -1;
        };
        return RemoteNames.wrap(new RemoteNames(n, fetchNames, lookup));
    }

    /**
     * Have the server build its cell-name index now, in the background, when
     * the names stay on the server: the first lookup by name otherwise waits
     * for that build (16 s at 50M cells). Fire and forget, once per loaded
     * dataset; nothing waits for it. Called after a large plot is drawn so the
     * build does not compete with the plot's own requests. Only on a
     * single-user server (Config.SERVER_CONFIG.single_user): the index costs
     * server memory (11 GB for 50M names before the lean index), which a
     * hosted server spends only for the users who search by name.
     */
    let _prewarmed = null;
    function prewarmCellNames() {
        if (!(_cells instanceof RemoteNames) || !_currentDataset) return;
        if (!(Config.SERVER_CONFIG && Config.SERVER_CONFIG.single_user)) return;
        const key = `${_currentDataset}#${_datasetGeneration}`;
        if (_prewarmed === key) return;
        _prewarmed = key;
        const params = new URLSearchParams({ dataset_path: _currentDataset, entity: 'cells', q: '',
            mode: 'exact', limit: '1' });
        if (_subset && _subset.datasetPath === _currentDataset) params.set('subset', _subset.key);
        fetch(`${Config.API.NAMES}?${params}`).catch(() => {});
    }

    /**
     * Index of a cell by name, asking the server when the names are not
     * downloaded (above the large-plot threshold); -1 when absent.
     */
    async function resolveCellIndex(cellName) {
        if (!_cells) return -1;
        if (_cells instanceof RemoteNames) return _cells.resolve(cellName);
        return _cells.indexOf(cellName);
    }

    /** Name of cell `i` (asks the server when the names are not downloaded). */
    async function cellNameAt(i) {
        if (!_cells) return undefined;
        if (_cells instanceof RemoteNames) return _cells.nameAt(i);
        return _cells[i];
    }

    // ---------------------------------------------------------------------
    // Locating a cell by name, also outside the subset
    //
    // Focus, locks, links and panel sets hold cell NAMES. A read names a
    // cell by its position among the cells shown (`rows=`), which a cell
    // outside the subset does not have: a focused cell from another part, or
    // one a filter leaves out. The server reads such a cell by its dataset
    // row instead (`dataset_rows=`), so each name is located as
    // {position, row}: position among the cells shown (-1 if not shown), row
    // in the dataset (null while unknown).
    //
    // Rows are learned from /data/names replies and from /data/subset/locate,
    // and kept for the dataset: they do not change with the subset, so a part
    // step carries a focused or locked cell over without the dataset-wide name
    // index (6 s to build at 50M cells). Rows from a link or panel set are
    // only hints until obs/_index at that row confirms the name.
    // ---------------------------------------------------------------------

    function _rowsFor(datasetPath) {
        if (_cellRows.datasetPath !== datasetPath) {
            _cellRows = { datasetPath, rows: new Map(), hints: new Map() };
        }
        return _cellRows;
    }

    function _learnRow(datasetPath, name, row) {
        if (typeof name === 'string' && name && Number.isInteger(row) && row >= 0) {
            _rowsFor(datasetPath).rows.set(name, row);
        }
    }

    /** What the server's cell-axis routes understand beyond rows= (/data/subset `features`). */
    function _features() {
        const reply = _subsetReply;
        return new Set(reply && reply.datasetPath === _currentDataset && Array.isArray(reply.features)
            ? reply.features : []);
    }

    /** The subset in effect for the open dataset, or null. */
    function _openSubset() {
        return _subset && _subset.datasetPath === _currentDataset ? _subset : null;
    }

    /** Does the server list `feature` in its /data/subset reply? */
    function hasSubsetFeature(feature) {
        return _features().has(feature);
    }

    /** Can this server read a cell outside the subset (dataset_rows=)? */
    function canReadOutsideSubset() {
        return _features().has('dataset_rows');
    }

    function _locatedCache() {
        const key = _openSubset() ? _openSubset().key : null;
        if (_located.generation !== _datasetGeneration || _located.key !== key) {
            _located = { generation: _datasetGeneration, key, byName: new Map(), settled: new Map() };
        }
        return _located;
    }

    /** Positions in the subset of dataset rows (-1: not shown), one /locate call. */
    async function _positionsOfRows(rows) {
        const subset = _openSubset();
        if (!subset) return rows.slice();
        const body = await _fetchWithCache(Config.API.SUBSET_LOCATE,
            { dataset_path: _currentDataset, subset: subset.key, dataset_rows: rows.join(',') });
        return body.rows;
    }

    /**
     * The 0-based part of the open subset that shows a located cell, or null
     * (no subset, a server without the feature, or a cell its filter leaves
     * out).
     * @param {string} name
     * @returns {Promise<number|null>}
     */
    async function partOfCell(name) {
        const subset = _openSubset();
        if (!subset || !hasSubsetFeature('locate_parts')) return null;
        const cell = await locateCell(name);
        if (!cell || cell.row === null || cell.row === undefined) return null;
        const body = await _fetchWithCache(Config.API.SUBSET_LOCATE,
            { dataset_path: _currentDataset, subset: subset.key, dataset_rows: String(cell.row), parts: '1' });
        const part = body && body.parts ? body.parts[0] : null;
        return typeof part === 'number' ? part : null;
    }

    /** Dataset rows of positions in the subset, one /locate call. */
    async function _rowsOfPositions(positions) {
        const subset = _openSubset();
        if (!subset) return positions.slice();
        const body = await _fetchWithCache(Config.API.SUBSET_LOCATE,
            { dataset_path: _currentDataset, subset: subset.key, rows: positions.join(',') });
        return body.dataset_rows;
    }

    /** The cell's dataset row from a link's hint, if obs/_index there names it. */
    async function _confirmedHint(name) {
        const known = _rowsFor(_currentDataset);
        const hint = known.hints.get(name);
        if (hint === undefined) return null;
        known.hints.delete(name);
        try {
            // without a subset, rows are dataset rows (and an older server reads them)
            const at = _openSubset() ? { dataset_rows: String(hint) } : { rows: String(hint) };
            const body = await _fetchWithCache(Config.API.OBS,
                { dataset_path: _currentDataset, columns: '_index', ...at });
            const names = body && body.data && body.data._index;
            if (Array.isArray(names) && names[0] === name) {
                known.rows.set(name, hint);
                return hint;
            }
        } catch (error) {
            console.warn(`Row hint ${hint} for ${name} could not be checked:`, error);
        }
        return null;
    }

    /** The cell's dataset row by an exact, dataset-wide name search; null if absent. */
    async function _searchRow(name) {
        const params = { dataset_path: _currentDataset, entity: 'cells', q: name, mode: 'exact',
                         limit: 1, scope: 'dataset' };
        if (_openSubset()) params.subset = _openSubset().key;
        const body = await _fetchWithCache(Config.API.NAMES, params);
        const hit = body && body.matches && body.matches[0];
        if (!hit || hit.name !== name || typeof hit.row !== 'number') return null;
        _learnRow(_currentDataset, name, hit.row);
        return hit.row;
    }

    async function _locate(name) {
        const subset = _openSubset();
        const outside = canReadOutsideSubset();
        const known = _rowsFor(_currentDataset);
        let row = known.rows.has(name) ? known.rows.get(name) : null;
        // When the names stay on the server, a known row is cheaper than a
        // name lookup, which first builds the server's name index
        const byRow = _cells instanceof RemoteNames && (!subset || outside);
        if (row === null && byRow) row = await _confirmedHint(name);
        let position;
        if (row !== null && byRow) {
            [position] = await _positionsOfRows([row]);
            if (position >= 0) _cells.remember(name, position);
        } else {
            position = await resolveCellIndex(name);
        }
        if (!subset) {
            if (position >= 0) _learnRow(_currentDataset, name, position);
            return { name, position, row: position >= 0 ? position : null, shown: position >= 0 };
        }
        if (position >= 0) return { name, position, row, shown: true };
        if (!outside) {
            // An older server cannot read a cell the subset does not show,
            // nor say whether the dataset has it
            return { name, position: -1, row: null, shown: false, unreadable: true };
        }
        if (row === null) row = await _confirmedHint(name);
        if (row === null) row = await _searchRow(name);
        return { name, position: -1, row, shown: false };
    }

    /**
     * Where a cell is: `{name, position, row, shown}`. `position` is its
     * index among the cells shown (-1 when not shown); `row` its dataset row
     * (null when unknown, or when the dataset does not have it). A cell that
     * is not shown but has a row can still be read, with cellRowParams().
     * `unreadable` is set when the server cannot read cells outside the
     * subset. Null for no name.
     * @param {string|null} name
     * @returns {Promise<Object|null>}
     */
    function locateCell(name) {
        if (typeof name !== 'string' || !name) return Promise.resolve(null);
        if (!_cells) return Promise.resolve({ name, position: -1, row: null, shown: false });
        const cache = _locatedCache();
        let found = cache.byName.get(name);
        if (!found) {
            found = _locate(name);
            cache.byName.set(name, found);
            found.then(cell => {
                if (cache.byName.get(name) !== found) return;
                cache.settled.set(name, cell);
                // labels and the header badge say "not shown" once this is known
                document.dispatchEvent(new CustomEvent('cellLocated', { detail: { ...cell } }));
            }, () => {
                // a failed lookup is asked again next time
                if (cache.byName.get(name) === found) cache.byName.delete(name);
            });
        }
        return found;
    }

    /**
     * Whether a cell is among the cells shown, as far as already known:
     * true, false (located outside the subset), or undefined (not located
     * yet, or the dataset does not have it). For labels drawn synchronously;
     * a `cellLocated` event follows each lookup.
     * @param {string} name
     */
    function cellShown(name) {
        const cache = _locatedCache();
        const cell = cache.settled.get(name);
        if (cell) return cell.shown || (cell.row !== null ? false : undefined);
        if (_cells && typeof name === 'string' && !(_cells instanceof RemoteNames) && _cells.indexOf(name) >= 0) {
            return true;
        }
        return undefined;
    }

    /**
     * The request parameter naming a located cell's row: `{rows}` for a cell
     * shown, `{dataset_rows}` for one outside the subset, or null when it
     * cannot be read (not in the dataset, or an older server).
     * @param {Object|null} cell - from locateCell()
     */
    function cellRowParams(cell) {
        if (!cell) return null;
        if (cell.shown && cell.position >= 0) return { rows: String(cell.position) };
        if (cell.row !== null && cell.row !== undefined && canReadOutsideSubset()) {
            return { dataset_rows: String(cell.row) };
        }
        return null;
    }

    /**
     * `params` naming one located cell's row, for loadObsp/loadLayer/loadX.
     * @private
     */
    function _cellRowQuery(params, cell) {
        const at = cellRowParams(cell);
        if (!at) {
            throw new Error(`The cell ${cell && cell.name} cannot be read: it is not among the cells shown`);
        }
        return Object.assign(params, at);
    }

    /** One row asked for by dataset row must come back as one row. @private */
    function _checkOneRow(params, data, rowsOf) {
        if (params.dataset_rows === undefined || !data || !Array.isArray(data.data)) return;
        const n = rowsOf(data.data);
        if (n !== 1) {
            throw new Error(`The server answered ${n} rows for one cell outside the subset; `
                + 'it does not read cells by dataset row');
        }
    }

    /**
     * One cell's value on a cell-plot axis (obs column, obsm column, or a
     * layer's gene column), also for a cell the subset does not show: where
     * a ring marks the focused cell of another part. Null when the cell
     * cannot be read or the axis is not a per-cell value (obsp).
     * @param {{type: string, key: string, column?: string}} axis
     * @param {Object} cell - from locateCell()
     * @returns {Promise<number|string|null>}
     */
    async function loadCellValue(axis, cell) {
        const at = cellRowParams(cell);
        if (!at || !axis || !axis.key) return null;
        const base = { dataset_path: _currentDataset, ...at };
        let body;
        if (axis.type === 'obs') {
            body = await _fetchWithCache(Config.API.OBS, { ...base, columns: axis.key });
            const column = body && body.data && body.data[axis.key];
            return Array.isArray(column) && column.length === 1 ? column[0] : null;
        }
        if (axis.type === 'obsm') {
            body = await _fetchWithCache(`${Config.API.OBSM}/${axis.key}`,
                { ...base, column_name: String(axis.column ?? 0) });
        } else if (axis.type === 'layer') {
            const gene = getGeneIndex(axis.column);
            if (gene < 0) return null;
            body = await _fetchWithCache(`${Config.API.LAYER}/${axis.key}`, { ...base, cols: String(gene) });
        } else {
            return null;
        }
        let value = body && body.data;
        while (Array.isArray(value)) {
            if (value.length !== 1) return null;
            value = value[0];
        }
        return value === undefined ? null : value;
    }

    /**
     * Learn the dataset rows of cells while the current subset still shows
     * them, so they are found again in another subset by row. Called before
     * the subset changes (a part step) for the focused and the locked cells.
     * One /locate call for every cell whose row is not known yet.
     * @param {string[]} names
     */
    async function recordCellRows(names) {
        if (!_currentDataset || !_cells) return;
        const known = _rowsFor(_currentDataset);
        const todo = [];
        for (const name of new Set(names)) {
            if (typeof name !== 'string' || !name || known.rows.has(name)) continue;
            const position = await resolveCellIndex(name);
            if (position >= 0) todo.push([name, position]);
        }
        if (!todo.length) return;
        if (_openSubset() && !_features().has('locate')) return;
        try {
            const rows = await _rowsOfPositions(todo.map(([, p]) => p));
            todo.forEach(([name], i) => _learnRow(_currentDataset, name, rows[i]));
        } catch (error) {
            console.warn('Could not record the dataset rows of the focused cells:', error);
        }
    }

    /**
     * Learn the dataset row of a newly focused cell in the background while
     * the subset shows it, so a link or panel set made later can carry it.
     * Only from names already at hand: no name lookup is started for it.
     * @private
     */
    function _learnRowSoon(name) {
        if (typeof name !== 'string' || !name || !_cells || !_currentDataset) return;
        const datasetPath = _currentDataset;
        if (_rowsFor(datasetPath).rows.has(name)) return;
        const position = _cells.indexOf(name);
        if (position < 0) return;
        if (!_openSubset()) {
            _learnRow(datasetPath, name, position);
            return;
        }
        if (!_features().has('locate')) return;
        _rowsOfPositions([position])
            .then(([row]) => { if (_currentDataset === datasetPath) _learnRow(datasetPath, name, row); })
            .catch(() => {});
    }

    /**
     * Record what a name search said about a cell: its dataset row, and its
     * position among the cells shown (null when not shown), so focusing it
     * needs no second lookup.
     * @param {string} name
     * @param {{row?: number, index?: number|null}} match
     */
    function rememberCell(name, { row, index } = {}) {
        if (!_currentDataset) return;
        if (Number.isInteger(row)) _learnRow(_currentDataset, name, row);
        if (_cells instanceof RemoteNames && Number.isInteger(index)) _cells.remember(name, index);
    }

    /**
     * Dataset rows a link or panel set may carry for its cells,
     * `{name: row}`, for the cells whose rows are known.
     * @param {string[]} names
     */
    function cellRowHints(names) {
        const known = _currentDataset ? _rowsFor(_currentDataset).rows : new Map();
        const out = {};
        for (const name of names) {
            if (typeof name === 'string' && known.has(name)) out[name] = known.get(name);
        }
        return out;
    }

    /**
     * Take the row hints of a link or panel set for `datasetPath`. They are
     * checked against obs/_index before use: names stay authoritative.
     * @param {string} datasetPath
     * @param {Object} hints - `{name: row}`
     */
    function setCellRowHints(datasetPath, hints) {
        if (!datasetPath || !hints || typeof hints !== 'object') return;
        const known = _rowsFor(datasetPath);
        for (const [name, row] of Object.entries(hints)) {
            if (Number.isInteger(row) && row >= 0 && !known.rows.has(name)) known.hints.set(name, row);
        }
    }

    async function loadCells(datasetPath, signal = null, expected = null) {
        try {
            // Check for abort before making request
            if (signal && signal.aborted) {
                throw new DOMException("Cells loading aborted", "AbortError");
            }
            
            // Every cell of a dataset above the large-plot threshold: the names
            // stay on the server (large-plot mode shows none)
            const threshold = Config.DEFAULTS.LARGE_PLOT_POINTS;
            if (typeof expected === 'number' && typeof threshold === 'number' && expected > threshold) {
                return _remoteNames(datasetPath, expected);
            }
            const params = _withSubset(Config.API.CELLS, { dataset_path: datasetPath });
            const fullUrl = `${Config.API.CELLS}?${new URLSearchParams(params).toString()}`;
            const response = await fetch(fullUrl, { signal });
            const size = Number(response.headers.get('Content-Length') || 0);
            if (response.ok && size > PACKED_NAMES_ABOVE_BYTES) {
                const t0 = performance.now();
                const names = await PackedNames.fromJSON(response, 'cells', size);
                console.info(`Cell names: ${names.length} read into packed form in ${(performance.now() - t0).toFixed(0)} ms`);
                return names;
            }
            const data = await _readResponse(response);
            
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
        const { datasetPath, columns, rows, maxCells, categories } = options;
        
        const params = {
            dataset_path: datasetPath || _currentDataset
        };
        // 'all' to colour by a categorical column (refused past the colour
        // limit), 'used' for its labels only (annzarro/core/categories.py)
        if (categories) params.categories = categories;
        
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
        const { datasetPath, columns, cols, maxGenes, categories } = options;
        
        const params = {
            dataset_path: datasetPath || _currentDataset
        };
        if (categories) params.categories = categories;   // as loadObs
        
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
            
            // Never log the reply itself: the browser keeps every logged
            // object (for DevTools, open or not), so each embedding column
            // loaded stayed in memory for good, 8 bytes per cell (a subset
            // swap of 4M cells kept 66 MB more each time; v0.2.0 twice that)
            console.log(`obsm reply: ${data && data.data ? `${data.data.length} values` : 'no data'}`);
            
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
        const { datasetPath, obspKey, cell, maxCells } = options;
        let { rows } = options;
        
        const params = {
            dataset_path: datasetPath || _currentDataset
        };
        
        if (cell) {
            // one located cell (locateCell): its position, or its dataset row
            // when the subset does not show it
            _cellRowQuery(params, cell);
            rows = [cell.position];
        } else if (rows && rows.length > 0) {
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
            _checkOneRow(params, data, d => d.length);
            
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
        const { datasetPath, layerName, cell, cols, maxCells } = options;
        let { rows } = options;
        
        const params = {
            dataset_path: datasetPath || _currentDataset
        };
        
        if (cell) {
            // one located cell's row (see loadObsp)
            _cellRowQuery(params, cell);
            rows = [cell.position];
        } else if (rows && rows.length > 0) {
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
                // a flat vector is one row; a list of rows must hold one
                _checkOneRow(params, data, d => (Array.isArray(d[0]) ? d.length : 1));
                
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
        
        _learnRowSoon(cellName);
        
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
     * @param {{source?: 'explicit'|'inferred'}} [opts] - 'inferred' when guessed
     *   from the dataset (the gene set panel), so a user's or a link's choice
     *   stays distinguishable from a guess
     */
    function setTaxonomyId(taxId, { source = 'explicit' } = {}) {
        _taxonomyId = taxId;
        _taxonomySource = source;
        
        // Trigger event for components to update
        const event = new CustomEvent('taxonomyIdChanged', {
            detail: { 
                taxonomyId: taxId,
                species: Config.DEFAULTS.TAXONOMY_SPECIES[taxId] || 'Custom',
                isCustom: !Config.DEFAULTS.TAXONOMY_SPECIES[taxId],
                source
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
    
    
    /** Whether a dataset is being opened and its names are not read yet. */
    function namesPending() {
        return _namesLoading !== null;
    }

    /** Resolves once the dataset being opened has its names (at once when none is). */
    function whenNamesLoaded() {
        return _namesLoading || Promise.resolve();
    }

    /**
     * Get the cell names
     * @returns {Array<string>} - Cell names in their original order
     */
    function getCells() {
        if (!_cells) return [];
        // Packed and remote names are read-only and too large to copy
        if (_cells instanceof PackedNames || _cells instanceof RemoteNames) return _cells;
        // Return a copy to avoid modifying the original array
        return [..._cells]; // No sorting to maintain original order
    }
    
    /**
     * One numeric cell- or gene-axis vector as the decoded typed array
     * (Float32Array, NaN where the value is missing): no plain-array copy.
     * Null when the server answers JSON instead (a non-numeric slice).
     * @param {string} url  e.g. `${Config.API.OBSM}/X_umap`
     * @param {Object} params  route parameters (dataset_path, column_name, cols, ...)
     */
    async function loadVector(url, params) {
        const body = await _fetchWithCache(url, { ...params, format: BINARY_FORMAT });
        return body && body[BINARY_RESULT] ? body.values : null;
    }

    /**
     * The codes route's reply in loadCategoryCodes' shape: Uint16 codes with
     * 0xFFFF for missing (the route sends int8/16/32 with -1).
     */
    function _categoryCodesFromBinary(decoded, headers = null) {
        const used = headers ? Number(headers.get('X-Annzarro-Categories-Used')) : NaN;
        const ranked = !!headers && headers.get('X-Annzarro-Categories-Order') === 'ranked';
        // ranked: the codes are frequency ranks of up to `used` categories,
        // and `categories` the labels of the first ranks only
        const span = ranked ? used : decoded.categories.length;
        const wide = span >= 0xFFFF;
        const MISSING = wide ? 0xFFFFFFFF : 0xFFFF;
        const src = decoded.values, n = src.length;
        const codes = wide ? new Uint32Array(n) : new Uint16Array(n);
        for (let i = 0; i < n; i++) { const c = src[i]; codes[i] = c < 0 ? MISSING : c; }
        return ranked ? { codes, categories: decoded.categories, MISSING, ranked: true, used }
            : { codes, categories: decoded.categories, MISSING };
    }

    /**
     * A categorical obs column as codes (Uint16Array, `MISSING` where blank)
     * plus its categories, read as a stream (utils/packed-names.js): the JSON
     * body of a large dataset does not fit in one string.
     */
    async function loadCategoryCodes(datasetPath, column, { ranked = false, slot = 'obs' } = {}) {
        // ranked: each cell's category's rank over the whole column
        // (utils/categories.js), no labels; otherwise every category
        const url = slot === 'var' ? Config.API.VAR : Config.API.OBS;
        const params = _withSubset(url, ranked
            ? { dataset_path: datasetPath, columns: column, categories: 'ranked' }
            : { dataset_path: datasetPath, columns: column });
        const fullUrl = `${url}?${new URLSearchParams(params).toString()}`;
        const key = `${fullUrl}#codes`;
        const cached = CacheManager.get(key);
        if (cached !== undefined) return cached;
        if (_inflight.has(key)) return _inflight.get(key);
        const pending = (async () => {
            // A server with the codes route (format=f32&categorical=codes)
            // answers binary integer codes; an older one ignores the request
            // and sends the JSON labels, which are read as a stream.
            const response = await fetch(`${fullUrl}&format=${BINARY_FORMAT}&categorical=codes`);
            if (!response.ok) await _readResponse(response);   // throws with the server's reason
            const result = isBinaryResponse(response)
                ? _categoryCodesFromBinary(decodeVector(await response.arrayBuffer(), response.headers), response.headers)
                : await categoryCodesFromJSON(response, column, (_cells || []).length);
            CacheManager.set(key, result);
            return result;
        })().finally(() => _inflight.delete(key));
        _inflight.set(key, pending);
        return pending;
    }

    /**
     * Labels of a few ranks of a categorical column's whole-column ranking
     * (`categories=ranked`): the names a colour group's legend entry shows.
     * @param {string} datasetPath
     * @param {string} column
     * @param {number[]} ranks
     * @param {'obs'|'var'} [slot]
     * @returns {Promise<Map<number, string>>} rank -> label
     */
    async function loadCategoryLabels(datasetPath, column, ranks, slot = 'obs') {
        const out = new Map();
        const wanted = [...new Set(ranks)].sort((a, b) => a - b);
        for (let i = 0; i < wanted.length; i += 1000) {
            const part = wanted.slice(i, i + 1000);
            const body = await _fetchWithCache(slot === 'var' ? Config.API.VAR : Config.API.OBS,
                { dataset_path: datasetPath, columns: column, category_ranks: part.join(',') });
            (body.ranks || part).forEach((r, k) => out.set(Number(r), body.labels[k]));
        }
        return out;
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

    /** Where the species came from: 'explicit', 'inferred' or 'default' (see _taxonomySource). */
    function getTaxonomySource() {
        return _taxonomySource;
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
        reloadSubset,
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
        loadVector,
        loadCategoryCodes,
        loadCategoryLabels,
        setFocusedCell,
        setFocusedGene,
        setTaxonomyId,
        getCurrentDataset,
        getDatasetGeneration: () => _datasetGeneration,
        getDatasetStructure,
        getCells,
        namesPending,
        whenNamesLoaded,
        getSortedCells,
        getGenes,
        getSortedGenes, 
        getFocusedCell,
        getFocusedGene,
        getTaxonomyId,
        getTaxonomySource,
        getTaxonomySpecies,
        getCellIndex,
        resolveCellIndex,
        locateCell,
        cellRowParams,
        canReadOutsideSubset,
        hasSubsetFeature,
        partOfCell,
        recordCellRows,
        loadCellValue,
        rememberCell,
        cellShown,
        cellRowHints,
        setCellRowHints,
        prewarmCellNames,
        cellNameAt,
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
        clearDatasetCache,
        revalidateDataset,
        reloadDatasetData,
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
/**
 * Panel Set Manager module for AnnZarro
 * Handles saving, loading, and managing panel sets
 * 
 * A panel set stores the same view a share link carries (dataset, focus and
 * the PanelManager.saveLayout() tree, see utils/deeplink.js panelSetToView),
 * plus the legacy panelConfigs older readers and the list previews use.
 * Loading one hands the view to the applier main.js registers, which runs it
 * through the deep-link path; sets saved before views existed still load.
 */
import { Config } from './config.js';
import { DataManager } from './data-manager.js';
import { PanelManager } from './panel-manager.js';
import { getFixedCells } from './panels/table-utilities/panel-tracker.js';
import { errorFromResponse } from './utils/session-permissions.js';
import { VIEW_SCHEMA_VERSION, panelSetToView, remapPanelReferences, serializableConfig } from './utils/deeplink.js';
import { storeRecord, storeName } from './utils/view-store.js';
import { modeOptions } from './utils/panelset-load.js';
import { knownStore, settleStore, appVersion } from './utils/store-identity.js';

const SessionManager = (function() {
    // Private variables
    let _currentSession = null; // Stores the current panel set
    let _autosaveTimer = null; // Timer for autosave
    let _autosaveHeld = false; // set while the browser's storage is being cleared: nothing may write it back
    // main.js registers how a view is applied (dataset switch, focus, layout);
    // see setViewApplier. Without one, loading falls back to closed panels.
    let _viewApplier = null;
    // main.js also says where a set's dataset is (its card's badge) and lets
    // the user pick a dataset for a set (setPanelSetHelpers)
    let _statusProvider = null;
    let _datasetChooser = null;
    // Stored sets as fetched for the Load dialog's cards, kept briefly so the
    // preview and the status check share one request
    const _setCache = new Map();
    const SET_CACHE_MS = 60000;
    // The store of a view open without data (its store was not found): a
    // view saved now keeps naming it. See setDetachedStore.
    let _detachedStore = null;
    let _detachedView = null;

    /**
     * While a view is open without data, the store it names (view.store)
     * and the view itself: its focus and cells are kept as saved, since no
     * dataset is open to hold them. Both null once a dataset is open.
     * @param {Object|null} store
     * @param {Object|null} [view]
     */
    function setDetachedStore(store, view = null) {
        _detachedStore = store && typeof store === 'object' ? store : null;
        _detachedView = _detachedStore && view && typeof view === 'object' ? view : null;
    }

    /**
     * The `store` record of the open dataset: its path relative to the data
     * directory when it is inside it (the absolute path kept as a hint), and
     * its fingerprint as far as it is known (utils/store-identity.js).
     * @returns {Object|null}
     */
    function storeOfView() {
        if (_detachedStore) return _detachedStore;
        const path = DataManager.getCurrentDataset();
        if (!path) return null;
        const known = knownStore(path);
        return storeRecord({ path, relPath: known ? known.relPath : null,
            fingerprint: known ? known.fingerprint : null });
    }

    /**
     * Wait up to `ms` for the open store's fingerprint before a view is
     * saved, so a link or panel set made right after opening a large store
     * still records it. Past that the view is saved with what is known
     * (counts and the metadata tier) and `complete` is false.
     * @returns {Promise<{complete: boolean}>}
     */
    async function settleStoreOfView(ms = 3000) {
        const path = DataManager.getCurrentDataset();
        if (!path) return { complete: true };
        try {
            const result = await settleStore(path, ms);
            return { complete: !!(result && result.ok && result.status === 'ready') };
        } catch (e) {
            return { complete: false };
        }
    }

    /**
     * Let the app apply a loaded panel set through its deep-link path.
     * @param {(plan: {datasetPath, view, closedPanels, legacy}, panelSet: Object) => Promise<Object>} fn
     */
    function setPanelSetHelpers({ status, chooseDataset } = {}) {
        _statusProvider = typeof status === 'function' ? status : null;
        _datasetChooser = typeof chooseDataset === 'function' ? chooseDataset : null;
    }

    /** Whether a dataset is open, and its name: what the Load buttons depend on. */
    function getCurrentDatasetInfo() {
        const path = DataManager.getCurrentDataset();
        return { hasCurrent: !!path, currentName: path ? storeName(path) : '' };
    }

    /** Forget fetched sets (a set was saved, imported or deleted). */
    function invalidatePanelSets() {
        _setCache.clear();
    }

    /**
     * A stored panel set by name, fetched once a minute at most.
     * @param {string} name
     * @returns {Promise<Object|null>} the stored set, or null when it cannot be read
     */
    function fetchPanelSet(name) {
        const hit = _setCache.get(name);
        if (hit && Date.now() - hit.at < SET_CACHE_MS) return hit.promise;
        const promise = fetch(`${Config.API.SESSIONS_LOAD}?name=${encodeURIComponent(name)}`)
            .then(r => (r.ok ? r.json() : null))
            .catch(() => null);
        _setCache.set(name, { at: Date.now(), promise });
        promise.then(v => { if (!v) _setCache.delete(name); });
        return promise;
    }

    /**
     * What a card shows about a set: its dataset (here or not), its panels,
     * and whether a dataset is open. `source` is a stored set's name, or the
     * set itself (an uploaded file).
     * @returns {Promise<Object|null>} null when it is not a panel set
     */
    async function getPanelSetStatus(source) {
        const data = typeof source === 'string' ? await fetchPanelSet(source) : source;
        if (!data || !_statusProvider) return null;
        try { return await _statusProvider(data); } catch (error) {
            console.error('Panel set status failed:', error);
            return null;
        }
    }

    function setViewApplier(fn) {
        _viewApplier = typeof fn === 'function' ? fn : null;
    }

    /**
     * The focus state a link or panel set stores. `cellRows` holds the
     * dataset row of the focused and locked cells where it is known: a hint
     * that finds a cell the subset does not show without a dataset-wide name
     * lookup. Names stay authoritative; the row is checked against them.
     * @private
     */
    function _constants() {
        const constants = {
            focusedGene: DataManager.getFocusedGene(),
            focusedCell: DataManager.getFocusedCell()
        };
        // The species when the dataset has one: chosen, or inferred from it
        // (kept as inferred, so it is inferred again when reopened). The
        // server's default is not saved: saved, it would read as a choice
        // and pin a mouse dataset to human.
        const taxonomySource = DataManager.getTaxonomySource();
        if (taxonomySource !== 'default') {
            constants.taxonomyId = DataManager.getTaxonomyId();
            if (taxonomySource === 'inferred') constants.taxonomySource = 'inferred';
        }
        const cellRows = DataManager.cellRowHints(getFixedCells().map(c => c.cell));
        if (Object.keys(cellRows).length) constants.cellRows = cellRows;
        return constants;
    }

    /**
     * The current view, in exactly the form a share link encodes.
     * @returns {{v: number, constants: Object, layout: Object}}
     */
    function captureView() {
        if (_detachedView) {
            // no data: the saved view, in the layout as it is now
            const view = { ..._detachedView, v: VIEW_SCHEMA_VERSION, layout: PanelManager.saveLayout() };
            view.store = _detachedStore;
            return view;
        }
        const view = {
            v: VIEW_SCHEMA_VERSION,
            constants: _constants(),
            layout: PanelManager.saveLayout()
        };
        // The cells shown, so the link reopens on the same cells
        const subset = DataManager.getSubsetForView();
        if (subset !== undefined) view.subset = subset;
        // The store it is on, and the version that saved it
        const store = storeOfView();
        if (store) view.store = store;
        const version = appVersion();
        if (version) view.annzarro = version;
        return view;
    }

    /**
     * Apply a stored panel set (any version).
     * @private
     */
    async function _applyPanelSet(sessionData, options) {
        const plan = panelSetToView(sessionData);
        if (!plan) throw new Error('Not a panel set');
        if (_viewApplier) {
            return await _viewApplier(plan, sessionData, options);
        }
        await _applySessionPanels(sessionData);
        return { status: 'success', message: 'Panels added (closed)' };
    }
    
    /**
     * Load list of available panel sets including the autosave if available
     * @param {boolean} includeAutosave - Whether to include the autosave session
     * @returns {Promise<Array>} - List of panel sets
     */
    async function listSessions(includeAutosave = Config.AUTOSAVE.SHOW_IN_LIST) {
        try {
            const response = await fetch(Config.API.SESSIONS_LIST);
            if (!response.ok) {
                throw new Error(`API error: ${response.statusText}`);
            }
            
            let sessions = await response.json();
            
            // Check if we should include the autosave and if it exists
            if (includeAutosave) {
                const autosave = loadFromLocalStorage();
                if (autosave) {
                    // Add special properties for visualization and sorting
                    autosave.isAutosave = true;
                    autosave.isLocalOnly = true;
                    
                    // Put autosave at the beginning of the list
                    sessions = [autosave, ...sessions];
                }
            }
            
            return sessions;
        } catch (error) {
            console.error('Error listing sessions:', error);
            
            // Even if the server request fails, try to return the autosave if available
            if (includeAutosave) {
                const autosave = loadFromLocalStorage();
                return autosave ? [autosave] : [];
            }
            
            return [];
        }
    }
    
    /**
     * Save current panel set
     * @param {string} name - Panel set name
     * @returns {Promise<Object>} - Save result
     */
    async function saveSession(name) {
        _setCache.clear();
        if (!name) {
            console.error('Panel set name is required');
            return { status: 'error', message: 'Panel set name is required' };
        }
        
        try {
            // Create the panel set data structure
            const sessionData = {};
            sessionData.name = name;
            sessionData.timestamp = new Date().toISOString();
            
            // 1. Save dataset information: relative to the data directory
            //    when the store is inside it, so the set opens on another
            //    server; the absolute path stays as a hint
            const settled = await settleStoreOfView();
            const store = storeOfView();
            sessionData.dataset = store ? store.path : DataManager.getCurrentDataset();
            if (store && store.abs) sessionData.datasetAbs = store.abs;
            // Get dataset name from URL parameter if available
            const urlParams = new URLSearchParams(window.location.search);
            const datasetName = urlParams.get('dataset_name');
            sessionData.datasetName = datasetName || '';
            
            // 2. Save focus state
            sessionData.constants = _constants();
            
            // 3. We don't need to access the container directly for panel configs
            console.log('Getting panels for panel set');
            
            // 4. Save panel configurations only (not layout)
            console.log('Saving panel configurations');
            const panelConfigs = {};
            
            // Get all panels including closed ones
            const allPanels = PanelManager.getAllPanels ? PanelManager.getAllPanels() : PanelManager.getActivePanels();
            
            console.log(`Found ${allPanels.length} panels to save`);
            
            // Collect all panels (we'll save their configurations but not their layout positions)
            allPanels.forEach(panel => {
                const id = panel.getId();
                if (!id) {
                    console.warn('Panel missing ID, skipping in panel set save');
                    return;
                }
                
                const type = panel.getType();
                if (!type) {
                    console.warn(`Panel ${id} missing type, skipping in panel set save`);
                    return;
                }
                
                try {
                    // Get panel configuration and associated data
                    const config = serializableConfig(panel.getConfig() || {});
                    const title = panel.getTitle() || `${type.charAt(0).toUpperCase() + type.slice(1)}`;
                    
                    // For each panel, store only its configuration
                    panelConfigs[id] = {
                        id: id,
                        type: type,
                        title: title,
                        config: config,
                        isSelectionTile: false
                    };
                    
                    console.log(`Saved config for panel: ${id} (${type})`);
                } catch (err) {
                    console.error(`Error saving panel config for ${id}:`, err);
                }
            });
            
            // Store only the panel configurations in the session data
            sessionData.panelConfigs = panelConfigs;

            // The full view (focus + split layout + every panel's config), the
            // same object a share link encodes; what loading restores.
            sessionData.view = captureView();
            
            // Save to server
            console.log('Saving panel set:', sessionData);
            const response = await fetch(Config.API.SESSIONS_SAVE, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(sessionData)
            });
            
            if (!response.ok) {
                // Keep the server's sentence (e.g. who owns the set) instead of "FORBIDDEN"
                return await errorFromResponse(response);
            }
            
            const result = await response.json();
            _currentSession = { name, ...sessionData };
            if (!settled.complete) result.fingerprintPending = true;
            
            return result;
        } catch (error) {
            console.error('Error saving panel set:', error);
            return { status: 'error', message: error.message };
        }
    }
    
    /**
     * Load a panel set by name
     * @param {string} name - Panel set name
     * @param {{mode?: string}} [options] - mode is the button used (see
     *   utils/panelset-load.js): `full` (the default, and the autosave's):
     *   switch to the set's dataset and open its panels in their layout, as a
     *   share link would; `current`: the same on the open dataset; `add`: keep dataset and open panels, add the set's panels
     *   to the closed list; `choose`: ask for a dataset, then `full` on it.
     *   Nothing asks for confirmation: the panels a load replaces stay in the
     *   closed list.
     * @returns {Promise<Object>} - Load result
     */
    async function loadSession(name, { mode = 'full' } = {}) {
        if (!name) {
            console.error('Panel set name is required');
            return { status: 'error', message: 'Panel set name is required' };
        }
        const options = modeOptions(mode);
        
        try {
            // Check if this is the autosave session
            if (name === Config.AUTOSAVE.SESSION_NAME) {
                const autosaveData = loadFromLocalStorage();
                
                if (!autosaveData) {
                    throw new Error('Autosave data not found');
                }

                if (autosaveData.view && _viewApplier) {
                    // The autosave restores what was open when the page was
                    // left. At start nothing is open, so it opens its own
                    // dataset; with a dataset open it never switches: its
                    // panels open on the one that is (a changed dataset is
                    // marked per panel, as for a view on another store)
                    const applied = await _applyPanelSet(autosaveData,
                        { keepDataset: !!DataManager.getCurrentDataset() });
                    return applied && applied.status
                        ? applied
                        : { status: 'success', message: 'Autosaved session loaded successfully' };
                }
                
                await _applySessionPanels(autosaveData);


                const datasetSelector = document.getElementById('dataset-selector');
                if (datasetSelector) {
                    // First check if the option exists
                    let optionExists = false;
                    for (let i = 0; i < datasetSelector.options.length; i++) {
                        if (datasetSelector.options[i].value === autosaveData.dataset) {
                            optionExists = true;
                            break;
                        }
                    }
                    
                    // If option doesn't exist, create it
                    if (!optionExists && window.$ && $.fn.select2) {
                        const newOption = new Option(
                            `${autosaveData.dataset} (Custom)`, 
                            autosaveData.dataset, 
                            true, 
                            true
                        );
                        $(datasetSelector).append(newOption);
                    } else if (!optionExists) {
                        // For regular select (non-Select2)
                        const option = document.createElement('option');
                        option.value = autosaveData.dataset;
                        option.textContent = autosaveData.dataset;
                        option.selected = true;
                        datasetSelector.appendChild(option);
                    }

                    datasetSelector.value = autosaveData.dataset;

                    // Also manually trigger the change event on the select element
                    // to ensure UI components are notified about the dataset change
                    datasetSelector.dispatchEvent(new Event('change'));
                    
                    // If using Select2, update its UI and load the dataset
                    if (window.$ && $.fn.select2) {
                        // Create proper event object with dataset value
                        $(datasetSelector).trigger({
                            type: 'select2:select',
                            params: {
                                data: {id: autosaveData.dataset}
                            }
                        });
                    }
                }

                return { status: 'success', message: 'Autosaved session loaded successfully' };
            }
            
            // Regular server-side session
            const response = await fetch(`${Config.API.SESSIONS_LOAD}?name=${encodeURIComponent(name)}`);
            
            if (!response.ok) {
                return await errorFromResponse(response);
            }
            
            const sessionData = await response.json();
            let onDataset = null;
            if (options.choose) {
                const plan = panelSetToView(sessionData);
                if (!plan) throw new Error('Not a panel set');
                onDataset = _datasetChooser ? await _datasetChooser(plan, sessionData) : null;
                if (!onDataset) return { status: 'cancelled', message: `No dataset chosen; "${name}" was not loaded.` };
            }
            const applied = await _applyPanelSet(sessionData, {
                add: options.add,
                onDataset: onDataset || (options.keepDataset ? DataManager.getCurrentDataset() || null : null),
                keepDataset: options.keepDataset
            });
            if (applied && applied.status && applied.status !== 'success') return applied;
            
            return { status: 'success', message: `Session ${name} loaded successfully` };
        } catch (error) {
            console.error('Error loading session:', error);
            return { status: 'error', message: error.message };
        }
    }
    
    /**
     * Delete a panel set by name
     * @param {string} name - Panel set name
     * @returns {Promise<Object>} - Delete result
     */
    async function deleteSession(name) {
        _setCache.clear();
        if (!name) {
            console.error('Panel set name is required');
            return { status: 'error', message: 'Panel set name is required' };
        }
        
        try {
            const response = await fetch(`${Config.API.SESSIONS_DELETE}?name=${encodeURIComponent(name)}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) {
                return await errorFromResponse(response);
            }
            
            const result = await response.json();
            
            if (_currentSession && _currentSession.name === name) {
                _currentSession = null;
            }
            
            return result;
        } catch (error) {
            console.error('Error deleting session:', error);
            return { status: 'error', message: error.message };
        }
    }
    
    /**
     * Export panel set as file download
     * @param {string} name - Panel set name
     */
    async function exportSession(name) {
        if (!name) {
            console.error('Panel set name is required');
            return;
        }
        
        try {
            // First, try to load the session data to ensure it exists
            const response = await fetch(`${Config.API.SESSIONS_LOAD}?name=${encodeURIComponent(name)}`);
            
            if (!response.ok) {
                throw new Error(`API error: ${response.statusText}`);
            }
            
            // Get the session data
            const sessionData = await response.json();
            
            // Create a Blob from the session data
            const blob = new Blob([JSON.stringify(sessionData, null, 2)], { type: 'application/json' });
            
            // Create a URL for the Blob
            const url = URL.createObjectURL(blob);
            
            // Create a link to download the Blob
            const link = document.createElement('a');
            link.href = url;
            link.download = `${name}.json`;
            
            // Click the link to download the file
            document.body.appendChild(link);
            link.click();
            
            // Clean up
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            
            return { status: 'success', message: `Session ${name} exported successfully` };
        } catch (error) {
            console.error('Error exporting session:', error);
            return { status: 'error', message: error.message };
        }
    }
    
    /**
     * Import panel set from file
     * @param {File} file - Panel set file
     * @returns {Promise<Object>} - Import result
     */
    async function importSession(file) {
        _setCache.clear();
        if (!file) {
            console.error('Panel set file is required');
            return { status: 'error', message: 'Panel set file is required' };
        }
        
        try {
            // Sanitize name based on file name
            let baseName = file.name;
            
            // Remove .json extension if present
            if (baseName.toLowerCase().endsWith('.json')) {
                baseName = baseName.slice(0, -5);
            }
            
            // Sanitize the base name
            baseName = baseName.trim()
                .replace(/\s+/g, '_')
                .replace(/[^\w\\-]/g, '');
            
            // Check for name collisions and append counter if needed
            let finalName = baseName;
            const sessions = await listSessions();
            const existingNames = new Set(sessions.map(s => s.name.toLowerCase()));
            
            if (existingNames.has(finalName.toLowerCase())) {
                let counter = 1;
                do {
                    finalName = `${baseName}_${counter}`;
                    counter++;
                } while (existingNames.has(finalName.toLowerCase()));
            }
            
            const formData = new FormData();
            formData.append('file', file);
            formData.append('name', finalName); // Pass the sanitized name with counter if needed
            
            const response = await fetch(Config.API.SESSIONS_IMPORT, {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                return await errorFromResponse(response);
            }
            
            const result = await response.json();
            return { ...result, name: finalName }; // Include the final name in the result
        } catch (error) {
            console.error('Error importing session:', error);
            return { status: 'error', message: error.message };
        }
    }
    
    /**
     * Apply loaded panel set data to the application state
     * @param {Object} sessionData - Panel set data
     * @returns {Promise<void>}
     * @private
     */
    async function _applySessionPanels(sessionData) {
        try {
            console.log('Applying panel set data...', sessionData);
            
            
            // Get panel configurations and register them as closed panels
            const panelConfigs = JSON.parse(JSON.stringify(sessionData.panelConfigs || {}));

            // registerClosedPanel gives a panel a new id when its id is taken;
            // a plot's tableFilter must then follow its table to the new id.
            const panels = Object.values(panelConfigs).filter(panel => !panel.isSelectionTile && panel.config);
            const idMap = new Map();
            panels.forEach(panel => {
                const before = panel.config.id;
                if (PanelManager.registerClosedPanel) {
                    PanelManager.registerClosedPanel(panel.type, panel.config);
                }
                if (before && panel.config.id !== before) idMap.set(before, panel.config.id);
            });
            if (idMap.size) {
                remapPanelReferences(panels.map(panel => panel.config), idMap);
                panels.forEach(panel => {
                    const live = PanelManager.getPanel(panel.config.id);
                    if (live && live.setConfig && panel.config.tableFilter !== undefined) {
                        live.setConfig({ tableFilter: panel.config.tableFilter });
                    }
                });
            }
            
            // Ensure the source panel selection is updated to show the newly added panels
            if (PanelManager.updateSourcePanelSelection) {
                PanelManager.updateSourcePanelSelection();
            }
            

        } catch (error) {
            console.error('Error applying panel set data:', error);
            throw error;
        }
    }
    
    
    /**
     * Get the current panel set
     * @returns {Object|null} - Current panel set data or null if no panel set is loaded
     */
    function getCurrentSession() {
        return _currentSession;
    }
    
    /**
     * Check if a panel set is currently loaded
     * @returns {boolean} - True if a panel set is loaded
     */
    function hasSession() {
        return _currentSession !== null;
    }
    
    /**
     * Save current panel configuration to browser localStorage
     * @returns {Promise<Object>} - Save result
     */
    async function saveToLocalStorage() {
        if (_autosaveHeld) return { status: 'skipped', message: 'Autosave is held' };
        try {
            // Only autosave if we have panels to save
            const allPanels = PanelManager.getAllPanels ? PanelManager.getAllPanels() : PanelManager.getActivePanels();
            if (!allPanels || allPanels.length === 0) {
                // No panels to save, remove any existing autosave
                clearAutosave();
                return { status: 'skipped', message: 'No panels to autosave' };
            }
            
            // Create the autosave data structure
            const autosaveData = {};
            autosaveData.name = Config.AUTOSAVE.SESSION_NAME;
            autosaveData.timestamp = new Date().toISOString();
            autosaveData.isAutosave = true;
            
            // Save dataset information
            const store = storeOfView();
            autosaveData.dataset = store ? store.path : DataManager.getCurrentDataset();
            // Get dataset name from URL parameter if available
            const urlParams = new URLSearchParams(window.location.search);
            const datasetName = urlParams.get('dataset_name');
            autosaveData.datasetName = datasetName || '';
            
            // Save focus state
            autosaveData.constants = _constants();
            
            // Save panel configurations
            const panelConfigs = {};
            
            allPanels.forEach(panel => {
                const id = panel.getId();
                if (!id) {
                    console.warn('Panel missing ID, skipping in autosave');
                    return;
                }
                
                const type = panel.getType();
                if (!type) {
                    console.warn(`Panel ${id} missing type, skipping in autosave`);
                    return;
                }
                
                try {
                    // Get panel configuration and associated data
                    const config = serializableConfig(panel.getConfig() || {});
                    const title = panel.getTitle() || `${type.charAt(0).toUpperCase() + type.slice(1)}`;
                    
                    // For each panel, store only its configuration
                    panelConfigs[id] = {
                        id: id,
                        type: type,
                        title: title,
                        config: config,
                        isSelectionTile: false
                    };
                } catch (err) {
                    console.error(`Error in autosave for panel ${id}:`, err);
                }
            });
            
            // Store only the panel configurations in the autosave data
            autosaveData.panelConfigs = panelConfigs;
            autosaveData.view = captureView();
            
            // Save to localStorage
            try {
                localStorage.setItem(Config.AUTOSAVE.STORAGE_KEY, JSON.stringify(autosaveData));
                return { status: 'success', message: 'Autosaved to browser storage' };
            } catch (e) {
                // Handle localStorage errors (quota exceeded, etc.)
                console.error('Error saving to localStorage:', e);
                return { status: 'error', message: 'Browser storage error: ' + e.message };
            }
        } catch (error) {
            console.error('Error in autosave:', error);
            return { status: 'error', message: error.message };
        }
    }
    
    /**
     * Load autosaved panel configuration from localStorage
     * @returns {Object|null} - Loaded session data or null if not found
     */
    function loadFromLocalStorage() {
        try {
            const data = localStorage.getItem(Config.AUTOSAVE.STORAGE_KEY);
            if (!data) return null;
            
            return JSON.parse(data);
        } catch (error) {
            console.error('Error loading from localStorage:', error);
            return null;
        }
    }
    
    /**
     * Start autosave timer
     */
    function startAutosave() {
        // Clear any existing timer first
        if (_autosaveTimer) {
            clearInterval(_autosaveTimer);
        }
        
        // Set up new timer
        _autosaveTimer = setInterval(async () => {
            await saveToLocalStorage();
        }, Config.AUTOSAVE.INTERVAL);
        
        console.log('Autosave enabled, saving every', Config.AUTOSAVE.INTERVAL / 1000, 'seconds');
    }
    
    /**
     * Stop autosave timer
     */
    /** Stop autosaving for good (until reload), e.g. while the site's storage is cleared. */
    function holdAutosave() {
        _autosaveHeld = true;
        stopAutosave();
    }

    function stopAutosave() {
        if (_autosaveTimer) {
            clearInterval(_autosaveTimer);
            _autosaveTimer = null;
        }
    }
    
    /**
     * Get the autosaved session if it exists
     * @returns {Promise<Object|null>} - Autosaved session or null
     */
    function getAutosaveSession() {
        return loadFromLocalStorage();
    }
    
    /**
     * Clear autosaved session
     */
    function clearAutosave() {
        localStorage.removeItem(Config.AUTOSAVE.STORAGE_KEY);
    }
    
    /**
     * Notify the session manager about panel changes that might trigger autosave
     */
    function notifyPanelUpdate() {
        if (Config.AUTOSAVE.ENABLED) {
            saveToLocalStorage();
        }
    }
    
    // Public API
    return {
        listSessions,
        saveSession,
        loadSession,
        deleteSession,
        exportSession,
        importSession,
        getCurrentSession,
        hasSession,
        saveToLocalStorage,
        loadFromLocalStorage,
        startAutosave,
        stopAutosave,
        holdAutosave,
        getAutosaveSession,
        clearAutosave,
        notifyPanelUpdate,
        setViewApplier,
        setPanelSetHelpers,
        fetchPanelSet,
        getPanelSetStatus,
        getCurrentDatasetInfo,
        invalidatePanelSets,
        captureView,
        setDetachedStore,
        settleStoreOfView,
        storeOfView
    };
})();

// Export the module
export { SessionManager };
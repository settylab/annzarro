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
import { csrfFetch } from './utils/csrf.js';
import { DatasetState } from './utils/dataset-state.js';
import { VIEW_SCHEMA_VERSION, panelSetToView, remapPanelReferences, serializableConfig } from './utils/deeplink.js';
import { storeRecord, storeName } from './utils/view-store.js';
import { modeOptions } from './utils/panelset-load.js';
import { knownStore, settleStore, appVersion } from './utils/store-identity.js';
import { convenienceStorage, dropPersistentConvenience } from './utils/convenience-storage.js';
import {
    HISTORY_KEY, RESTORING_KEY, pushHistory, lastSessionList, deadMarker, linkDidNotFinish,
    hashString, sessionKey, withDefaultSubset, unfinishedReason, openPanelIds
} from './utils/last-sessions.js';
import { PAGE_ID } from './utils/page-id.js';
import { ledger, drawsInFlight, outOfMemoryPanels, crashedLastTime } from './utils/memory-guard-ui.js';

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
     * The saved panel sets, after the last sessions (lastSessions) when
     * `includeLast`: each of those has `isLastSession` and `entry`.
     * @param {boolean} [includeLast] - ui.autosave.show_in_list by default
     * @returns {Promise<Array>}
     */
    async function listSessions(includeLast = Config.AUTOSAVE.SHOW_IN_LIST && Config.AUTOSAVE.ENABLED) {
        const last = includeLast ? lastSessions().map((entry, lastIndex) => ({
            name: `${LAST_PREFIX}${entry.key}`, isLastSession: true, isLocalOnly: true, entry, lastIndex,
            timestamp: entry.session.timestamp, dataset: entry.session.dataset, datasetName: entry.dataset,
            panelConfigs: _openConfigs(entry.session)
        })) : [];
        try {
            const response = await fetch(Config.API.SESSIONS_LIST);
            if (!response.ok) {
                throw new Error(`API error: ${response.statusText}`);
            }
            return [...last, ...(await response.json())];
        } catch (error) {
            console.error('Error listing sessions:', error);
            // the last sessions are in this browser: listed even when the server is not reached
            return last;
        }
    }

    /** The prefix of a last session's name in the panel set lists. */
    const LAST_PREFIX = 'last-session:';

    /** A session's open panels, as the list previews read them. @private */
    function _openConfigs(session) {
        const open = new Set(openPanelIds(session));
        return Object.fromEntries(Object.entries(session.panelConfigs || {}).filter(([id]) => open.has(id)));
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
            const response = await csrfFetch(Config.API.SESSIONS_SAVE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
        if (String(name).startsWith(LAST_PREFIX)) return restoreLastSession(String(name).slice(LAST_PREFIX.length));
        
        try {
            // Check if this is the autosave session
            if (name === Config.AUTOSAVE.SESSION_NAME) {
                const autosaveData = loadFromLocalStorage();
                
                if (!autosaveData) {
                    throw new Error('Autosave data not found');
                }
                // a page that ends before every panel is drawn leaves this session unfinished
                beginRestore('autosave', { session: sessionKey(autosaveData) });
                try {
                    return await _restoreAutosave(autosaveData);
                } finally {
                    endRestore();
                }
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
            
            return { status: 'success', message: `Loaded "${name}"` };
        } catch (error) {
            console.error('Error loading session:', error);
            return { status: 'error', message: error.message };
        }
    }
    
    /**
     * Restore the autosave as it was left. At start nothing is open, so it
     * opens its own dataset; with a dataset open it never switches: its
     * panels open on the one that is (a changed dataset is marked per panel,
     * as for a view on another store).
     * @private
     */
    async function _restoreAutosave(autosaveData) {
        if (autosaveData.view && _viewApplier) {
            const applied = await _applyPanelSet(autosaveData,
                { keepDataset: !!DataManager.getCurrentDataset() });
            return applied && applied.status
                ? applied
                : { status: 'success', message: 'Autosave loaded' };
        }

        await _applySessionPanels(autosaveData);

        // open its dataset as the user would, through the one entry point (no control is asked)
        if (autosaveData.dataset) {
            await DatasetState.open(autosaveData.dataset, { source: 'autosave' });
        }

        return { status: 'success', message: 'Autosave loaded' };
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
            const response = await csrfFetch(`${Config.API.SESSIONS_DELETE}?name=${encodeURIComponent(name)}`, {
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
            
            return { status: 'success', message: `Exported "${name}"` };
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
            
            const response = await csrfFetch(Config.API.SESSIONS_IMPORT, {
                method: 'POST',
                // no Content-Type: the browser sets the multipart boundary
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
                // No panels to save: this page's autosave becomes a last
                // session; another page's (an earlier visit's) stays as it is
                clearAutosave();
                return { status: 'skipped', message: 'No panels to autosave' };
            }
            
            // Create the autosave data structure
            const autosaveData = {};
            autosaveData.name = Config.AUTOSAVE.SESSION_NAME;
            autosaveData.timestamp = new Date().toISOString();
            autosaveData.isAutosave = true;
            // the page that wrote it: the next page lists it as a last session
            autosaveData.page = PAGE_ID;
            
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
            
            // Save to localStorage; an earlier page's autosave it replaces is kept as a last session
            try {
                const existing = loadFromLocalStorage();
                if (existing && existing.page !== PAGE_ID) _retire(existing);
                _writeAutosave(JSON.stringify(autosaveData));
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
            dropPersistentConvenience(Config.SERVER_CONFIG, Config.AUTOSAVE.STORAGE_KEY);
            const data = convenienceStorage(Config.SERVER_CONFIG).getItem(Config.AUTOSAVE.STORAGE_KEY);
            if (!data) return null;
            
            return JSON.parse(data);
        } catch (error) {
            console.error('Error loading from localStorage:', error);
            return null;
        }
    }
    
    // the autosave waiting for idle time, if one is
    let _autosaveIdle = null;
    const AUTOSAVE_IDLE_MS = 2000;
    /** Run `fn` when the page is idle, within AUTOSAVE_IDLE_MS (a timer where requestIdleCallback is missing). */
    function whenIdle(fn) {
        if (typeof window.requestIdleCallback === 'function') {
            return window.requestIdleCallback(fn, { timeout: AUTOSAVE_IDLE_MS });
        }
        return setTimeout(fn, 0);
    }

    /**
     * Start autosave timer
     */
    function startAutosave() {
        // Clear any existing timer first
        if (_autosaveTimer) {
            clearInterval(_autosaveTimer);
        }
        
        // Set up new timer. Each save waits for idle time (at most AUTOSAVE_IDLE_MS), so
        // it does not land between a click and what the click shows; the save on unload
        // (main.js) is made at once.
        _autosaveTimer = setInterval(() => {
            if (_autosaveIdle) return;
            _autosaveIdle = whenIdle(async () => {
                _autosaveIdle = null;
                if (!_autosaveTimer) return;
                await saveToLocalStorage();
                _announceChange();
            });
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
     * This page has no panels any more: its autosave becomes a last session
     * (restorable from the lists). An autosave another page wrote is left
     * alone: a page that opens on the welcome screen must not lose the last
     * session it offers. `{all: true}` removes the autosave and every last
     * session, whoever wrote them.
     */
    function clearAutosave({ all = false } = {}) {
        const store = convenienceStorage(Config.SERVER_CONFIG);
        if (!store) return;
        try {
            if (all) {
                store.removeItem(Config.AUTOSAVE.STORAGE_KEY);
                store.removeItem(HISTORY_KEY);
                store.removeItem(RESTORING_KEY);
                return;
            }
            const existing = loadFromLocalStorage();
            if (!existing || existing.page !== PAGE_ID) return;
            _retire(existing);
            store.removeItem(Config.AUTOSAVE.STORAGE_KEY);
        } catch { /* storage blocked */ }
    }

    // -- the last sessions (utils/last-sessions.js) --------------------------

    function _readJson(key) {
        try {
            const raw = convenienceStorage(Config.SERVER_CONFIG).getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    function _readHistory() {
        dropPersistentConvenience(Config.SERVER_CONFIG, Config.AUTOSAVE.STORAGE_KEY);
        const h = _readJson(HISTORY_KEY);
        return Array.isArray(h) ? h : [];
    }

    /** Write the history; when the browser's storage is full, with fewer sessions. @private */
    function _writeHistory(history) {
        const store = convenienceStorage(Config.SERVER_CONFIG);
        if (!store) return;
        let list = history;
        for (;;) {
            try {
                if (list.length) store.setItem(HISTORY_KEY, JSON.stringify(list));
                else store.removeItem(HISTORY_KEY);
                return;
            } catch {
                if (!list.length) return;
                list = list.slice(0, -1);
            }
        }
    }

    /** The autosave; when the storage is full, the last sessions make room. @private */
    function _writeAutosave(json) {
        const store = convenienceStorage(Config.SERVER_CONFIG);
        for (;;) {
            try {
                store.setItem(Config.AUTOSAVE.STORAGE_KEY, json);
                return;
            } catch (e) {
                const h = _readHistory();
                if (!h.length) throw e;
                _writeHistory(h.slice(0, -1));
            }
        }
    }

    /** Keep `session` (an autosave being replaced) as a last session. @private */
    function _retire(session) {
        _writeHistory(pushHistory(_readHistory(), session));
    }

    /** The marker a page that is gone left (read at start, see initLastSessions), and this tab's previous page. */
    let _deadMarker = null;
    let _previousPage = null;
    let _initialised = false;

    /**
     * At start, before anything is restored: which page of this tab came
     * before (a reload keeps it in the tab's history entry), and whether a
     * page that is gone left a restore marker. Its session (and the one the
     * memory guard's crash marker names) is marked "did not finish loading"
     * for good, and the marker is removed.
     */
    function initLastSessions() {
        if (_initialised) return;
        _initialised = true;
        try {
            _previousPage = (window.history.state && window.history.state.azPage) || null;
            window.history.replaceState({ ...(window.history.state || {}), azPage: PAGE_ID }, '');
        } catch { /* a sandboxed frame */ }
        const raw = _readJson(RESTORING_KEY);
        _deadMarker = deadMarker(raw, { page: PAGE_ID, previousPage: _previousPage });
        const crashed = crashedLastTime();
        const keys = new Set();
        if (_deadMarker) {
            keys.add(_deadMarker.page);
            if (_deadMarker.session) keys.add(_deadMarker.session);
        }
        if (crashed && crashed.page) keys.add(crashed.page);
        if (keys.size) {
            const reason = { reason: _deadMarker && _deadMarker.failed && _deadMarker.failed.length ? 'memory' : 'ended',
                at: Date.now() };
            _markUnfinished(keys, reason);
        }
        if (_deadMarker) {
            try { convenienceStorage(Config.SERVER_CONFIG).removeItem(RESTORING_KEY); } catch { /* storage blocked */ }
        }
    }

    /** Mark the sessions with these keys as not finished, where they are kept. @private */
    function _markUnfinished(keys, reason) {
        const autosave = loadFromLocalStorage();
        if (autosave && keys.has(sessionKey(autosave)) && !autosave.unfinished) {
            autosave.unfinished = reason;
            try { _writeAutosave(JSON.stringify(autosave)); } catch { /* storage full */ }
        }
        const history = _readHistory();
        let changed = false;
        history.forEach(e => {
            if (keys.has(sessionKey(e)) && !e.unfinished) { e.unfinished = reason; changed = true; }
        });
        if (changed) _writeHistory(history);
    }

    /** Whether `session` did not finish loading last time (it is then never restored by itself). */
    function didNotFinish(session) {
        return !!unfinishedReason(session, _deadMarker, crashedLastTime());
    }

    /**
     * Whether the link this page was opened with (its #view) must not be
     * drawn by itself: this tab's previous page, or a page restoring the
     * same link, did not finish drawing it.
     */
    function linkDidNotFinishHere(locationHash = window.location.hash) {
        return linkDidNotFinish(_deadMarker, { previousPage: _previousPage, linkHash: hashString(locationHash) });
    }

    /** The last sessions to offer, newest first (utils/last-sessions.js lastSessionList). */
    function lastSessions() {
        if (!Config.AUTOSAVE.ENABLED) return [];
        return lastSessionList({ autosave: loadFromLocalStorage(), history: _readHistory(), page: PAGE_ID,
            marker: _deadMarker, crashed: crashedLastTime() });
    }

    /**
     * Restore the last session `key` as it was saved, or with the dataset's
     * default subset (`defaultSubset`: a session that did not finish
     * loading, opened on fewer cells). Its own dataset opens.
     * @returns {Promise<{status: string, message: string}>}
     */
    async function restoreLastSession(key, { defaultSubset = false } = {}) {
        const entry = lastSessions().find(e => e.key === key);
        if (!entry) return { status: 'error', message: 'That session is no longer kept in this browser.' };
        const session = defaultSubset ? withDefaultSubset(entry.session) : entry.session;
        beginRestore('last-session', { session: key });
        try {
            const applied = await _applyPanelSet(session, {});
            return applied && applied.status ? applied : { status: 'success', message: 'Session restored' };
        } catch (error) {
            console.error('Restoring the last session failed:', error);
            return { status: 'error', message: error.message };
        } finally {
            endRestore();
        }
    }

    /** Forget the last session `key` (the autosave, if it is that one). */
    function deleteLastSession(key) {
        const store = convenienceStorage(Config.SERVER_CONFIG);
        try {
            const autosave = loadFromLocalStorage();
            if (autosave && sessionKey(autosave) === key && store) store.removeItem(Config.AUTOSAVE.STORAGE_KEY);
        } catch { /* storage blocked */ }
        _writeHistory(_readHistory().filter(e => sessionKey(e) !== key));
    }

    // -- the restore marker ------------------------------------------------------

    let _hold = 0;           // restores running now (beginRestore .. endRestore)
    let _marker = null;      // this page's marker, as written
    let _beatTimer = null;
    let _settleTimer = null;
    const SETTLE_MS = 1000;
    const BEAT_MS = 5000;

    function _writeMarker() {
        try {
            const store = convenienceStorage(Config.SERVER_CONFIG);
            if (_marker) store.setItem(RESTORING_KEY, JSON.stringify(_marker));
            else store.removeItem(RESTORING_KEY);
        } catch { /* private window, quota: no marker */ }
        if (_marker && !_beatTimer) {
            // refreshed while it stands, so other tabs see a page that is still at it
            _beatTimer = setInterval(() => { if (_marker) { _marker.beat = Date.now(); _writeMarker(); } }, BEAT_MS);
        } else if (!_marker && _beatTimer) {
            clearInterval(_beatTimer);
            _beatTimer = null;
        }
    }

    /**
     * A restore starts (a panel set or last session, a link, a dataset
     * switch or subset change that redraws the open panels): the marker says
     * so until every panel is drawn. `session`: the key of the last session
     * being restored, which a page that ends now leaves unfinished.
     */
    function beginRestore(source, { session = null } = {}) {
        _hold++;
        if (!_marker) _marker = { page: PAGE_ID, at: Date.now(), source, link: hashString(window.location.hash) };
        if (session) _marker.session = session;
        _marker.beat = Date.now();
        delete _marker.failed;
        _writeMarker();
    }

    /** The restore begun last ended (its panels may still be drawing). */
    function endRestore() {
        _hold = Math.max(0, _hold - 1);
        _scheduleSettle();
    }

    function _scheduleSettle() {
        clearTimeout(_settleTimer);
        _settleTimer = setTimeout(_settle, SETTLE_MS);
    }

    /**
     * Nothing restoring and nothing drawing: the marker goes, unless a draw
     * ran out of memory (that panel shows it): then it stays, so a reload
     * does not draw the same again by itself.
     */
    function _settle() {
        if (_hold > 0 || drawsInFlight() > 0) return;
        const failed = outOfMemoryPanels();
        if (failed.length) {
            _marker = { ...(_marker || { page: PAGE_ID, at: Date.now(), source: 'draw', link: hashString(window.location.hash) }),
                failed, beat: Date.now() };
            _writeMarker();
        } else if (_marker) {
            // a last session restored whole lives on in this page (its autosave): no longer listed apart
            const restored = _marker.session;
            _marker = null;
            _writeMarker();
            // (this page's autosave is written first: the session is never in neither place)
            if (restored && restored !== PAGE_ID && Config.AUTOSAVE.ENABLED) {
                saveToLocalStorage().then(r => { if (r && r.status === 'success') deleteLastSession(restored); });
            }
        }
    }
    ledger.onChange(_scheduleSettle);

    /** Whether a restore is running or this page's marker stands (for tests). */
    function restoreMarker() {
        return _marker ? { ..._marker, hold: _hold } : null;
    }
    
    /**
     * Notify the session manager about panel changes that might trigger autosave
     */
    function notifyPanelUpdate() {
        if (Config.AUTOSAVE.ENABLED) {
            saveToLocalStorage();
        }
        _announceChange();
    }

    // Who wants to know the view may have changed (the address bar follows it)
    let _changeListener = null;
    function _announceChange() {
        if (!_changeListener) return;
        try {
            _changeListener();
        } catch (error) {
            console.error('View change listener failed:', error);
        }
    }
    /** Call `fn` (cheap, no arguments) whenever panels or the autosave tick say the view may have changed. */
    function onViewMayHaveChanged(fn) {
        _changeListener = fn;
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
        initLastSessions,
        lastSessions,
        restoreLastSession,
        deleteLastSession,
        didNotFinish,
        linkDidNotFinishHere,
        beginRestore,
        endRestore,
        restoreMarker,
        notifyPanelUpdate,
        onViewMayHaveChanged,
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
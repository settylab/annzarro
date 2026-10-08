/**
 * Main Application Module for AnnZarro
 */
import { PanelManager } from './panel-manager.js';
import { Config } from './config.js';
import { DataManager } from './data-manager.js';
import { SessionManager } from './session-manager.js';
import {
    VIEW_SCHEMA_VERSION, encodeViewPayload, decodeViewPayload, normalizeView,
    parseDeepLinkLocation, buildDeepLinkUrl, collectTileIds, remapPanelReferences, panelSetToView, closePlanPanels, panelsToAdd,
    sameDatasetPath
} from './utils/deeplink.js';
import { escapeHtml, canModify, lockReason, describeFailure, authIndicator, refreshPlan } from './utils/session-permissions.js';
import { mountNamePicker, fetchNameMatches, fetchNameIndexState, mergeScopedMatches } from './utils/name-picker.js';
import { NOTIFY_EVENT } from './utils/notify.js';
import { installSessionExpiryHandler } from './utils/session-expiry.js';
import { appRoot } from './utils/app-url.js';
import { clearSiteStorage, clearSiteStorageNow, bareUrl } from './utils/site-storage.js';
import { sameSubset } from './utils/subset.js';
import { countNoun } from './utils/coverage.js';
import { SubsetControl } from './subset-dialog.js';
import { registerStatusActions } from './utils/panel-surface.js';
import { canSnapshot, exportImage, exportImageData, setRecipeProvider } from './utils/plot-export.js';
import { exportOptions } from './panels/plot-utilities/plot-aesthetics-menu.js';
import { overrideOnce } from './utils/memory-guard-ui.js';
import { getFixedCells } from './panels/table-utilities/panel-tracker.js';
import { NOT_SHOWN } from './panels/plot-utilities/panel-ui-update.js';
import {
    compareStores, describeComparison, versionNotice, orderCandidates, automaticCandidate,
    savedStoreOf, storeName, hasDataTier
} from './utils/view-store.js';
import { probeStore, prewarmStore, appVersion } from './utils/store-identity.js';
import { defaultHierarchy } from './utils/deeplink.js';
import { installWheelHandover } from './utils/wheel-handover.js';
import { createLoadActions, createDatasetBadge, helpContent, clearTips } from './panelset-load-ui.js';

const App = (function() {
    // Private variables
    let _isInitialized = false;
    let _closeAllAsking = false; // the Close all question is open
    let _sessionModal = null;
    
    /**
     * Initialize the application
     */
    async function init() {
        if (_isInitialized) return;
        
        // Expose panel preview functions globally for reuse by other modules
        window._loadAllSessionPreviews = _loadAllSessionPreviews;
        window._updatePanelPreview = _updatePanelPreview;
        window._updateErrorPreview = _updateErrorPreview;
        
        try {

            // When the login expires mid-session, go to the login page and
            // come back to this dataset and view (utils/session-expiry.js)
            installSessionExpiryHandler({
                root: appRoot(),
                currentViewUrl: () => ((_lastLoadedDatasetPath || DataManager.getCurrentDataset())
                    ? _buildShareView() : window.location.href)
            });

            // Make SessionManager and PanelManager accessible globally
            window.sessionManager = SessionManager;
            window.PanelManager = PanelManager;
            
            // Initialize Plotly with optimized canvas settings
            _initPlotly();
            
            // Initialize UI components
            _initUI();
            
            // Setup custom event listeners for error handling
            _setupErrorHandlers();
            
            // Say who is signed in, or that nobody needs to be (not awaited:
            // the header must not hold up the first render)
            _loadAuthIndicator();
            
            // Check for autosave session before initializing panel manager.
            //
            // Parse the deep-link up front: a deep-link (?dataset_path=...#view=...)
            // takes precedence over the autosave session, so when one is present we
            // must NOT show the "restoring previous panel set" spinner. That spinner
            // is only ever cleared as a side effect of a panel being created, so a
            // bare ?dataset_path (no view) — or a view that fails to materialize —
            // would otherwise pin it forever. With the spinner suppressed, a
            // deep-link boots into the normal Welcome tile, which is the correct
            // fallback whenever nothing opens.
            const autosave = SessionManager.getAutosaveSession();
            const deepLink = await _parseDeepLink();
            const hasAutosave = autosave && Config.AUTOSAVE.AUTO_RESTORE && !deepLink;

            // Initialize panel manager with autosave information
            PanelManager.init('tile-container', { hasAutosave });

            // Loading a panel set restores its whole view through _applyView
            SessionManager.setViewApplier(_applyPanelSet);
            SessionManager.setPanelSetHelpers({ status: _panelSetStatus, chooseDataset: _chooseDatasetForSet });

            // Every exported figure carries its recipe; `annzarro export`
            // drives the same export through window.annzarroExport
            setRecipeProvider(_figureRecipe);
            _installExportHooks();

            // Notices raised by modules that cannot import main.js (utils/notify.js)
            document.addEventListener(NOTIFY_EVENT, (e) => {
                const { title, message, type } = e.detail || {};
                _showNotification(title || 'Notice', message || '', type || 'warning');
            });

            // Load available datasets
            await _loadDatasets();

            // Load available sessions
            await _loadSessions();

            // Set default dataset if available.
            const datasets = await DataManager.loadDatasets();
            if (deepLink) {
                // Materialize the shared view. Guard against a throwing or empty
                // apply: on ANY failure, or a deep-link that opens no panels, fall
                // back to the Welcome screen rather than leaving a spinner up.
                try {
                    await _applyDeepLink(deepLink);
                } catch (error) {
                    console.error('Deep-link application failed:', error);
                    _showNotification('Deep-link failed', error.message || 'Could not open the shared view.', 'error');
                }
                PanelManager.ensureWelcomeFallback();
            } else if (datasets && datasets.length > 0 && !hasAutosave) {
                await _loadDataset(datasets[0].path);
            } else if (hasAutosave) {
                // Genuine autosave restore. If it throws or restores zero panels,
                // don't hang on the spinner — drop back to the Welcome screen.
                try {
                    await SessionManager.loadSession(Config.AUTOSAVE.SESSION_NAME);
                } catch (error) {
                    console.error('Autosave restore failed:', error);
                }
                PanelManager.ensureWelcomeFallback();
            }

            
            // Start autosave functionality if enabled in config
            if (Config.AUTOSAVE.ENABLED) {
                SessionManager.startAutosave();
            }
            
            // Add event listener to save state before the page unloads
            window.addEventListener('beforeunload', async () => {
                await SessionManager.saveToLocalStorage();
            });

            // Opening another share link for the same dataset in this tab changes
            // only the fragment, which the browser treats as in-page navigation:
            // no reload, so the new view would silently not apply. Reload instead.
            window.addEventListener('hashchange', () => {
                const parts = parseDeepLinkLocation(window.location);
                if (parts && parts.payload) window.location.reload();
            });

            _isInitialized = true;
        } catch (error) {
            console.error('Error initializing application:', error);
            _showNotification('Initialization failed', error.message, 'error');
        }
    }

    /**
     * Parse the deep-link grammar from the current URL:
     *   ?dataset_path=<path>#view=<payload>           (what share links emit)
     *   ?dataset_path=<path>&view=<base64url(JSON)>   (legacy, e.g. DoLiMap)
     * `view` is optional — a bare ?dataset_path just opens the dataset with no
     * preset panels. Returns null when no dataset_path is present (normal boot).
     * Async because a compressed payload is inflated with DecompressionStream.
     *
     * Decoding + normalization live in ./utils/deeplink.js, the single source of
     * truth shared with the Node guard and the share-link encoder, so a link this
     * parses and a link _buildShareView produces are governed by one schema.
     * @returns {Promise<{datasetPath: string, view: Object|null}|null>}
     * @private
     */
    async function _parseDeepLink() {
        const parts = parseDeepLinkLocation(window.location);
        if (!parts) return null;
        let view = null;
        if (parts.payload) {
            try {
                view = normalizeView(await decodeViewPayload(parts.payload));
            } catch (error) {
                // A mangled view (truncated by a mail client, say) should still
                // open the dataset the link names rather than nothing at all.
                console.error('Failed to decode deep-link view:', error);
                _showNotification('Invalid deep-link',
                    'The shared view could not be decoded; opening the dataset only.', 'error');
            }
        }
        return { datasetPath: parts.datasetPath, view };
    }

    /**
     * Build a shareable deep-link URL for the CURRENT app state — the encode
     * mirror of _parseDeepLink. Captures the live focus constants plus the live
     * layout tree (via the same PanelManager.saveLayout serialization that
     * restoreLayout consumes), so the produced link reconstructs exactly this
     * view when opened. This is the "save current layout → shareable link" half
     * of the unified serialization.
     * @param {string} datasetPath - dataset to encode (defaults to the loaded one)
     * @returns {Promise<string>} absolute URL, ?dataset_path= plus #view=
     */
    async function _buildShareView(datasetPath) {
        // The same capture a saved panel set stores (SessionManager.captureView)
        const view = SessionManager.captureView();
        // The store as the view records it: relative to the data directory
        // when it is inside it, so the link opens on any server holding it
        const path = (view.store && view.store.path) || datasetPath || _lastLoadedDatasetPath || '';
        return buildDeepLinkUrl(window.location.origin + window.location.pathname,
            path, await encodeViewPayload(view));
    }

    /**
     * Header "Share Link" handler: build the link for the current view and copy
     * it. The clipboard API needs a secure context, which a plain-http cluster
     * node is not, so on failure the link is shown in a pre-selected field
     * instead; the user can always copy it by hand. No modal dialogs either way.
     * @private
     */
    async function _shareCurrentView() {
        const button = document.getElementById('btn-share-link');
        const fallback = document.getElementById('share-link-fallback');
        const field = document.getElementById('share-link-field');
        const datasetPath = (_noDataView && _noDataView.missing) || _lastLoadedDatasetPath || DataManager.getCurrentDataset();
        if (!datasetPath) {
            _showNotification('Nothing to share', 'Open a dataset first.', 'warning', 3000);
            return;
        }

        let link;
        try {
            // A large store's names may still be being fingerprinted: wait
            // briefly, then share with what is known and say so
            const settled = _noDataView ? { complete: true } : await SessionManager.settleStoreOfView(3000);
            if (!settled.complete) _noticeFingerprintPending();
            link = await _buildShareView(datasetPath);
        } catch (error) {
            console.error('Building share link failed:', error);
            _showNotification('Share link failed', error.message || 'Could not encode this view.', 'error');
            return;
        }

        try {
            await navigator.clipboard.writeText(link);
            fallback.hidden = true;
            const label = button.querySelector('.btn-share-label');
            label.textContent = 'Copied!';
            clearTimeout(_shareLabelTimer);
            button.classList.add('show-label');   // visible even when the header shows icons only
            _shareLabelTimer = setTimeout(() => { label.textContent = 'Share Link'; button.classList.remove('show-label'); }, 2000);
        } catch (error) {
            console.debug('Clipboard unavailable, showing share link inline:', error);
            field.value = link;
            fallback.hidden = false;
            field.focus();   // selects it all, start in view (see _selectShowingStart)
        }
    }
    let _shareLabelTimer = null;

    /**
     * Said when a view is saved before the open store's cell and gene names
     * are fingerprinted (a large store, just opened). The view records the
     * counts and the fields; only the names are not checked when it opens.
     * @private
     */
    function _noticeFingerprintPending() {
        _showNotification('Saved without the cell and gene check',
            'This store is still being fingerprinted (a large store takes a few seconds once). ' +
            'The view records its size and fields, but not yet its cell and gene names, so a store ' +
            'with other names of the same size is not detected when it opens. Save again in a moment to include them.',
            'info', 10000);
    }

    /**
     * Select all of an input's text with the caret at the start, so the
     * beginning stays visible (a plain select() scrolls to the end).
     * @param {HTMLInputElement} input
     * @private
     */
    function _selectShowingStart(input) {
        try {
            input.setSelectionRange(0, input.value.length, 'backward');
        } catch (e) {
            input.select();
        }
        input.scrollLeft = 0;
    }

    /**
     * Apply a parsed deep-link: load the dataset, restore the focused gene, and
     * materialize each preset panel. Reuses the standard _loadDataset path and
     * PanelManager.createPanel (the same machinery a session restore uses), so a
     * deep-linked view behaves identically to a hand-built one.
     * @param {{datasetPath: string, view: Object|null}} deepLink
     * @private
     */
    async function _applyDeepLink(deepLink) {
        await _applyView(deepLink);

        // Rewrite the URL to a clean form so the opened view is itself
        // re-shareable and a refresh re-applies it (state currently lives only
        // in localStorage otherwise).
        try {
            history.replaceState(null, '', window.location.href);
        } catch (e) {
            // replaceState can throw in sandboxed iframes — non-fatal.
            console.debug('history.replaceState skipped:', e);
        }
    }

    /**
     * Load a dataset, then restore a view on it: focus constants, then the
     * layout tree (or the legacy flat panel list). Shared by deep links and
     * loaded panel sets, so both restore exactly the same way.
     * @param {{datasetPath: string, view: Object|null}} target
     * @param {{exact?: boolean, located?: Object, trust?: boolean}} [opts] - trust:
     *   the user chose this store (a Load button): cells or genes that differ
     *   are said in a notice, not asked about first
     * @private
     */
    async function _applyView({ datasetPath, view }, { exact = false, located = null, trust = false } = {}) {
        // Where the view's store is here: its path, the path relative to the
        // data directory, or a store in the data directory with the same
        // cells and genes (or, for a view without a fingerprint, the same
        // name). Not found: the layout opens without data.
        located = located || await _locateStore(datasetPath, view, { exact });
        if (!located.path) {
            await _applyViewWithoutData(view, located);
            return { status: 'no-data', message: `${located.missing || datasetPath} was not found` };
        }
        const savedFp = located.saved ? located.saved.fp : null;
        const cmp = compareStores(savedFp, located.probe.fingerprint);
        const said = describeComparison(cmp, located.path);
        if (said && said.strong && !trust) {
            // Open the layout without data while the user decides
            await _applyViewWithoutData(view, { ...located, differs: true, missing: located.path });
            if (_sessionModal) _sessionModal.hide();
            const choice = await _askNotification(said.title, said.message, [
                { key: 'open', label: 'Open anyway', primary: true },
                { key: 'change', label: 'Change dataset' },
                { key: 'none', label: 'Keep without data' }
            ]);
            if (choice === 'change') {
                _showChangeDataset();
                return { status: 'no-data', message: 'The store differs; choose a dataset' };
            }
            if (choice !== 'open') return { status: 'no-data', message: 'The store differs; opened without data' };
        }
        datasetPath = located.path;
        // A store of the data directory is named as the listing (and so the
        // dropdown) names it, whichever spelling reached here: the server's
        // path for it, or the path relative to the data directory
        // (rel_path, as a share link or saved set records it).
        datasetPath = await _listedPathFor(datasetPath, located.probe && located.probe.relPath);
        _leaveNoDataMode();

        // 0. The cells the view shows. A view without `subset` keeps the
        //    subset of an already open dataset (or the default for a new
        //    one); a different subset of the open dataset reloads it.
        const subset = view && 'subset' in view ? view.subset : undefined;
        if (subset !== undefined) {
            const open = datasetPath === _lastLoadedDatasetPath && !_isLoadingDataset;
            const current = DataManager.getSubset();
            if (!open || !sameSubset(current ? current.subset : null, subset)) {
                DataManager.setSubsetRequest(subset);
                _lastLoadedDatasetPath = null;
            }
        }

        // 1. Load the dataset through the normal (non-silent) path so selectors
        //    and dataset info populate exactly as a manual selection would.
        await _loadDataset(datasetPath);

        // Reflect the selection in the dataset dropdown. A dataset that is not
        // in the listing (a remote URL, a path outside the data directory) gets
        // its own option; otherwise the picker showed its placeholder.
        const datasetSelector = document.getElementById('dataset-selector');
        if (datasetSelector) {
            if (DataManager.getCurrentDataset() === datasetPath &&
                ![...datasetSelector.options].some(o => o.value === datasetPath)) {
                datasetSelector.appendChild(new Option(datasetPath, datasetPath));
            }
            datasetSelector.value = datasetPath;
            if (window.$ && $.fn.select2) {
                $(datasetSelector).trigger('change.select2');
            }
        }

        if (view) {
            // 2. Restore the focused gene (drives highlighting + the gene selector).
            const constants = view.constants || {};
            if (constants.focusedGene) {
                DataManager.setFocusedGene(constants.focusedGene);
            }
            // Dataset rows the link recorded for its cells: checked against
            // the names, they spare a dataset-wide name lookup for a cell
            // the subset does not show
            DataManager.setCellRowHints(datasetPath, constants.cellRows);
            if (constants.focusedCell) {
                // Kept also when the subset does not show it (its rows are
                // read by dataset row); a cell the dataset lacks is focused as
                // before, and its panels say it is not in this dataset
                const cell = await DataManager.locateCell(constants.focusedCell);
                if (cell && cell.unreadable) {
                    // Said once: loading the dataset may already have said it
                    if (_focusOutsideSubsetNoticed !== constants.focusedCell) {
                        _showNotification('Focused cell not in the subset',
                            `${constants.focusedCell} is not among the cells shown, so it is not focused. ` +
                            'This server cannot read a cell outside the subset.', 'warning', 8000);
                    }
                } else {
                    DataManager.setFocusedCell(constants.focusedCell);
                    if (cell && !cell.shown && cell.row !== null) _noticeFocusOutside(constants.focusedCell);
                }
            }
            if (constants.taxonomyId) {
                DataManager.setTaxonomyId(constants.taxonomyId,
                    { source: constants.taxonomySource === 'inferred' ? 'inferred' : 'explicit' });
            }

            // 3. Materialize the panels. Two shapes, one preferred:
            //
            //    (a) view.layout — a full split/size/panel hierarchy tree (the
            //        same object PanelManager.saveLayout() emits). Reconstruct it
            //        through PanelManager.restoreLayout, the EXACT path a session
            //        restore uses, so a deep-linked layout and a hand-built one
            //        are byte-for-byte the same machinery. This is the
            //        future-proof path: any arrangement of horizontal/vertical
            //        splits with explicit size percentages auto-opens on load.
            //
            //    (b) view.panels — the legacy flat list (no split/size control).
            //        Kept as a simple shorthand. Panel `type` is normalized so the
            //        documented 'cell_plot' form and the internal 'cell-plot' id
            //        both resolve. createPanelInLayout (NOT createPanel) routes
            //        each panel through the wrapper + resize-handle wiring an
            //        interactively-created panel gets; a bare createPanel() appends
            //        a height-less tile that renders distorted with no handle.
            //
            //    normalizeView (utils/deeplink.js) guarantees at most one of these
            //    is set, with layout winning when both were supplied.
            if (view.layout) {
                await PanelManager.restoreLayout(view.layout);
            } else {
                const panels = Array.isArray(view.panels) ? view.panels : [];
                panels.forEach(panel => {
                    const type = (panel.type || '').replace(/_/g, '-');
                    const config = { ...(panel.config || {}) };
                    if (panel.title && !config.title) config.title = panel.title;
                    PanelManager.createPanelInLayout(type, config);
                });
            }
        }
        _afterViewOpened(view, located, cmp, trust && said ? { ...said, strong: false } : said);
        return { status: 'success' };
    }

    // ── Where a view's store is, and a view without one ───────────────────

    /** A view open without data: {view, saved, missing}; null otherwise. */
    let _noDataView = null;
    /** When the last notice about an opened view was shown (a later toast would hide it). */
    let _viewNoticeAt = 0;
    // what that notice said, so a notice that replaces it can carry it on
    let _viewNotice = null;

    /** The last view notice, if it is from this load, to begin a notice that replaces it. @private */
    function _carriedViewNotice() {
        return _viewNotice && Date.now() - _viewNoticeAt < 3000 ? `${_viewNotice}\n\n` : '';
    }

    /**
     * Find the store a view names on this server.
     *
     * In order: the path as given (a relative name resolves in the data
     * directory, server side), the path the view recorded, the absolute path
     * it had where it was saved. If none is here, a store in the data
     * directory with the same cells and genes (by fingerprint), or for a view
     * without a fingerprint the one store with the same file name, is opened
     * instead, and the user is told. A path the server refuses (outside the
     * data directory, server.arbitrary_paths) is never opened.
     * @param {string|null} datasetPath
     * @param {Object|null} view
     * @param {{exact?: boolean}} [opts] - exact: only this path (the user chose it)
     * @returns {Promise<{path: string|null, probe?: Object, saved: Object|null,
     *           repointed?: Object, missing?: string, refused?: Object, candidates?: Array}>}
     * @private
     */
    const savedHasData = (saved) => !!(saved && hasDataTier(saved.fp));

    /**
     * The path the dataset listing uses for a store: the entry whose path is
     * `path`, or whose rel_path is the store's `relPath`. `path` itself when
     * the store is not listed (a remote URL, outside the data directory).
     * @private
     */
    async function _listedPathFor(path, relPath) {
        const listing = (await DataManager.loadDatasets().catch(() => [])) || [];
        const hit = listing.find(d => d && d.path === path)
            || (relPath && listing.find(d => d && d.rel_path === relPath));
        return hit ? hit.path : path;
    }

    async function _locateStore(datasetPath, view, { exact = false } = {}) {
        const saved = savedStoreOf(view, datasetPath);
        const tries = [...new Set([datasetPath, ...(exact ? [] : [saved && saved.path])].filter(Boolean))];
        let refused = null, failed = null;
        // A view with the cells-and-genes tier waits up to 1 s for the
        // store's (a small store's takes milliseconds; a large one's is
        // compared later, in the background: _verifyCellsLater)
        // A large store (over 2M cells) is not hashed at open: that would
        // compete with the first data requests; it is compared later too.
        const wait = savedHasData(saved) && !(saved.fp.n_obs > 2e6) ? 1 : 0;
        for (const path of tries) {
            const probe = await probeStore(path, { wait });
            if (probe.ok) return { path: probe.path || path, probe, saved };
            if (probe.httpStatus === 403) refused = refused || { path, ...probe };
            else if (probe.reason !== 'not_found') failed = failed || { path, ...probe };
        }
        const missing = datasetPath || (saved && saved.path) || null;
        if (exact || failed) return { path: null, saved, missing, refused, failed };
        const candidates = await _storeCandidates(saved);
        const pick = automaticCandidate(candidates, saved);
        if (pick) {
            const probe = await probeStore(pick.path);
            if (probe.ok) {
                return { path: probe.path || pick.path, probe, saved,
                    repointed: { from: missing, to: pick.path, match: pick.match } };
            }
        }
        // Last, the absolute path the view had where it was saved: a hint,
        // for a server whose data directory moved (confined as any path)
        if (saved && saved.abs && !tries.includes(saved.abs)) {
            const probe = await probeStore(saved.abs, { wait });
            if (probe.ok) {
                return { path: probe.path || saved.abs, probe, saved,
                    repointed: { from: missing, to: saved.abs, match: 'abs' } };
            }
        }
        return { path: null, saved, missing, refused, candidates };
    }

    /**
     * The data directory's stores, ordered for a saved store: the ones with
     * the same counts are fingerprinted (the server waits up to 2 s each;
     * a large store still being hashed counts as "same size").
     * @param {Object|null} saved - view.store
     * @returns {Promise<Array>} orderCandidates output
     * @private
     */
    async function _storeCandidates(saved) {
        DataManager.clearCache(Config.API.DATASETS);
        const listing = (await DataManager.loadDatasets().catch(() => [])) || [];
        const entries = listing.filter(d => d && d.path && !d.error).map(d => ({ ...d }));
        const fp = saved && saved.fp;
        if (fp && Number.isFinite(fp.n_obs)) {
            const same = entries.filter(e => e.cells === fp.n_obs && e.genes === fp.n_var).slice(0, 12);
            await Promise.all(same.map(async entry => {
                const probe = await probeStore(entry.path, { wait: 2 }).catch(() => null);
                if (probe && probe.ok) entry.cmp = compareStores(fp, probe.fingerprint);
            }));
            entries.forEach(e => {
                if (!e.cmp && Number.isFinite(e.cells)
                    && (e.cells !== fp.n_obs || e.genes !== fp.n_var)) {
                    e.cmp = { level: 'different', dataKnown: true, changes: [] };
                }
            });
        }
        return orderCandidates(entries, saved);
    }

    /**
     * Open a view's layout without data: every panel a placeholder that keeps
     * its settings, a notice naming the store that is not here, and "Change
     * dataset" to open the view on a store of this server.
     * @private
     */
    async function _applyViewWithoutData(view, located) {
        const saved = located.saved || null;
        const missing = located.missing || (saved && saved.path) || 'its dataset';
        _noDataView = { view, saved, missing, differs: !!located.differs };
        SessionManager.setDetachedStore(saved, view);
        const button = document.getElementById('btn-change-dataset');
        if (button) button.hidden = false;
        const pathLabel = document.getElementById('dataset-path');
        if (pathLabel) pathLabel.textContent = `No data: ${missing}`;

        let layout = view && view.layout;
        if (!layout && view && Array.isArray(view.panels) && view.panels.length) {
            const panelConfigs = {};
            const ids = view.panels.map((panel, i) => {
                const type = (panel.type || '').replace(/_/g, '-');
                const id = (panel.config && panel.config.id && String(panel.config.id).startsWith(type + '-'))
                    ? panel.config.id : `${type}-${i + 1}`;
                panelConfigs[id] = { ...(panel.config || {}), id, ...(panel.title ? { title: panel.title } : {}) };
                return id;
            });
            layout = { v: VIEW_SCHEMA_VERSION, hierarchy: defaultHierarchy(ids), controlState: {}, panelConfigs };
        }
        const message = located.differs
            ? `The store at ${missing} differs from the one this view was saved on. Its settings are kept.`
            : `This view's dataset, ${missing}, is not on this server. Its settings are kept.`;
        if (layout) {
            PanelManager.getActivePanels().map(p => p.getId()).forEach(id => PanelManager.closePanel(id));
            await PanelManager.restoreLayout(layout, {
                placeholder: { message, onChangeDataset: () => _showChangeDataset() }
            });
        }
        if (located.differs) return;
        const why = located.refused
            ? `${located.refused.path} is outside the data directory this server shares, so it cannot be opened here.`
            : located.failed
                ? `${located.failed.path} could not be read: ${located.failed.error}`
                : `${missing} is not on this server, and no store in its data directory matches it.`;
        // not awaited: the view is open, the answer can come any time
        _askNotification('Dataset not found',
            `${why}\n\nThe layout is open without data, every panel keeping its settings. ` +
            'Choose a dataset to open the view on.',
            [{ key: 'change', label: 'Change dataset', primary: true }, { key: 'later', label: 'Later' }])
            .then(choice => { if (choice === 'change') _showChangeDataset(); });
    }

    // Where a set's dataset is, for the cards of the Load dialog and the welcome
    // list. Sets saved on one store share one search (it can fingerprint every
    // store of the same size), kept for half a minute.
    const _locateCache = new Map();

    function _locateForCard(plan) {
        const saved = savedStoreOf(plan.view, plan.datasetPath);
        const key = JSON.stringify([plan.datasetPath, saved && saved.path, saved && saved.fp && saved.fp.data]);
        const hit = _locateCache.get(key);
        if (hit && Date.now() - hit.at < 30000) return hit.promise;
        const promise = _locateStore(plan.datasetPath, plan.view).catch(error => ({
            path: null, saved, missing: plan.datasetPath, failed: { path: plan.datasetPath, error: error.message }
        }));
        _locateCache.set(key, { at: Date.now(), promise });
        return promise;
    }

    /**
     * What a panel set's card shows: its dataset and whether it is on this
     * server (_locateStore: its path, or the store with the same cells and
     * genes), its panels (open at save / all), and whether a dataset is open.
     * @param {Object} data - the stored panel set
     * @returns {Promise<Object|null>} null when it is not a panel set
     * @private
     */
    async function _panelSetStatus(data) {
        const plan = panelSetToView(data);
        if (!plan) return null;
        const closed = closePlanPanels(plan);
        const status = {
            named: plan.datasetPath || null, found: null,
            open: closed.savedCount, total: closed.closedPanels.length
        };
        if (plan.datasetPath) {
            const located = await _locateForCard(plan);
            status.found = !!located.path;
            status.foundPath = located.path || null;
            status.repointed = located.repointed || null;
            status.refused = located.refused || null;
            status.failed = located.failed || null;
        }
        return status;
    }

    /**
     * "Choose dataset...": the Change dataset picker, for a set. Resolves to
     * the path the user picked, or null when the picker is closed without one.
     * @private
     */
    function _chooseDatasetForSet(plan) {
        return new Promise(resolve => {
            let picked = false;
            if (_sessionModal) _sessionModal.hide();
            const modalEl = document.getElementById('change-dataset-modal');
            if (modalEl) {
                modalEl.addEventListener('hidden.bs.modal', () => { if (!picked) resolve(null); }, { once: true });
            }
            _showChangeDataset({
                pending: { view: plan.view, saved: savedStoreOf(plan.view, plan.datasetPath),
                    missing: plan.datasetPath || null },
                onChoose: async (path) => { picked = true; resolve(path); }
            });
        });
    }

    /** A dataset is open again: the view is no longer without data. @private */
    function _leaveNoDataMode() {
        _noDataView = null;
        SessionManager.setDetachedStore(null);
        const button = document.getElementById('btn-change-dataset');
        if (button) button.hidden = true;
    }

    /**
     * After a view opened on a store: say what is worth saying (opened on
     * another path, other fields, another AnnZarro version), then check the
     * cells and genes once a large store's names are hashed.
     * @private
     */
    function _afterViewOpened(view, located, cmp, said) {
        if (!located) return;
        // One notice (a toast replaces the one before it), every point in it
        const parts = [];
        let title = null;
        if (located.repointed) {
            const how = located.repointed.match === 'same' || located.repointed.match === 'fields'
                ? 'has the same cells and genes'
                : located.repointed.match === 'abs'
                    ? 'is where the view was saved'
                    : 'has the same name (this view records no fingerprint to check it by)';
            title = 'Opened on another path';
            parts.push(`${located.repointed.from} is not on this server. Opened ${located.repointed.to}, which ${how}.`);
        }
        if (said && !said.strong) {
            title = title || said.title;
            parts.push(said.message);
        }
        const version = versionNotice(view && view.annzarro, appVersion());
        if (version) {
            title = title || 'Saved with another AnnZarro version';
            parts.push(version);
        }
        if (parts.length) {
            _viewNoticeAt = Date.now();
            _viewNotice = `${title}: ${parts.join('\n\n')}`;
            _showNotification(title, parts.join('\n\n'), 'info', 12000);
        }
        const savedFp = located.saved && located.saved.fp;
        if (cmp && hasDataTier(savedFp) && !cmp.dataKnown && cmp.level !== 'different') {
            _verifyCellsLater(savedFp, located.path);
        }
    }

    /**
     * A large store's cell and gene names are hashed in the background on the
     * server; compare them when they are, without holding up the view.
     * @private
     */
    async function _verifyCellsLater(savedFp, path) {
        // Not while the first data requests of the open are in flight: the
        // hash of a large store competes with them
        await new Promise(resolve => setTimeout(resolve, 8000));
        for (let i = 0; i < 12; i++) {
            const probe = await probeStore(path, { wait: 10 }).catch(() => null);
            if (!probe || !probe.ok) return;
            if (DataManager.getCurrentDataset() !== path) return;
            if (probe.status !== 'ready') continue;
            const said = describeComparison(compareStores(savedFp, probe.fingerprint), path);
            if (said && said.strong) {
                const choice = await _askNotification(said.title, said.message,
                    [{ key: 'change', label: 'Change dataset', primary: true }, { key: 'keep', label: 'Keep' }]);
                if (choice === 'change') {
                    _noDataView = { view: SessionManager.captureView(), saved: { path, name: storeName(path) },
                        missing: path, differs: true };
                    _showChangeDataset();
                }
            }
            return;
        }
    }

    /**
     * "Change dataset": open the view on a store of this server. Lists the
     * data directory's stores with the same cells and genes first, then any
     * other store, and takes a path (which the server confines as always).
     * The view is then opened on the chosen store, behind the fingerprint
     * warning if it differs.
     * @private
     */
    async function _showChangeDataset({ pending: given = null, onChoose = null } = {}) {
        const modalEl = document.getElementById('change-dataset-modal');
        if (!modalEl) return;
        const pending = given || _noDataView || {
            view: SessionManager.captureView(),
            saved: SessionManager.storeOfView(),
            missing: DataManager.getCurrentDataset()
        };
        // the notice that offered this has been answered
        document.querySelectorAll('.notification-ask').forEach(el => {
            if ((el.dataset.key || '').includes('Dataset not found')) {
                const close = el.querySelector('.notification-close');
                if (close) close.click();
            }
        });
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        const list = document.getElementById('change-dataset-list');
        const savedLine = document.getElementById('change-dataset-saved');
        const error = document.getElementById('change-dataset-error');
        const saved = pending.saved;
        const fp = saved && saved.fp;
        savedLine.textContent = `This view was saved on ${saved ? saved.path : 'an unknown store'}` +
            (fp && Number.isFinite(fp.n_obs) ? ` (${fp.n_obs.toLocaleString('en-US')} cells x ${fp.n_var.toLocaleString('en-US')} genes)` : '') +
            (fp ? '.' : '; it records no fingerprint, so stores are matched by name only.');
        error.hidden = true;
        list.textContent = 'Looking for matching stores...';
        modal.show();

        const choose = async (path) => {
            modal.hide();
            // a caller that asked for a store (the Load dialog) takes it from here
            if (onChoose) { await onChoose(path); return; }
            const view = pending.view || { v: VIEW_SCHEMA_VERSION };
            await _applyView({ datasetPath: path, view }, { exact: true });
            PanelManager.ensureWelcomeFallback();
        };
        const openPath = document.getElementById('change-dataset-open-path');
        const input = document.getElementById('change-dataset-path');
        openPath.onclick = async () => {
            const path = input.value.trim();
            if (!path) return;
            const probe = await probeStore(path);
            if (!probe.ok) {
                error.textContent = probe.error || `${path} could not be opened`;
                error.hidden = false;
                return;
            }
            await choose(probe.path || path);
        };

        const ordered = await _storeCandidates(saved);
        list.textContent = '';
        const groups = [
            ['Same cells and genes', e => e.match === 'same' || e.match === 'fields'],
            ['Same size (cell and gene names not compared yet)', e => e.match === 'counts'],
            ['Same name, other cells or genes', e => e.match === 'name-different'],
            ['Same name', e => e.match === 'name'],
            ['Other datasets in the data directory', e => e.match === 'other' || e.match === 'different']
        ];
        for (const [title, test] of groups) {
            const members = ordered.filter(test);
            if (!members.length) continue;
            const group = document.createElement('div');
            group.className = 'change-dataset-group';
            const h = document.createElement('h6');
            h.textContent = title;
            group.appendChild(h);
            for (const entry of members) {
                const row = document.createElement('div');
                row.className = 'change-dataset-item';
                row.dataset.path = entry.path;
                row.dataset.match = entry.match;
                const label = document.createElement('div');
                const name = document.createElement('div');
                name.textContent = entry.rel_path || entry.name || entry.path;
                const meta = document.createElement('div');
                meta.className = 'change-dataset-meta';
                const counts = Number.isFinite(entry.cells)
                    ? `${entry.cells.toLocaleString('en-US')} cells x ${entry.genes.toLocaleString('en-US')} genes` : '';
                const fields = entry.cmp && entry.cmp.level === 'fields' && entry.cmp.changes.length
                    ? `; fields differ: ${entry.cmp.changes.slice(0, 3).join('; ')}` : '';
                meta.textContent = counts + fields;
                label.append(name, meta);
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'btn btn-sm btn-outline-primary';
                button.textContent = 'Open';
                button.addEventListener('click', () => choose(entry.path));
                row.append(label, button);
                group.appendChild(row);
            }
            list.appendChild(group);
        }
        if (!list.children.length) list.textContent = 'No dataset in the data directory.';
    }

    /**
     * Apply a loaded panel set (SessionManager hands every load to this; see
     * setViewApplier). A panel set restores what a share link restores: its
     * dataset, the focused cell and gene, and the split layout with each
     * panel's settings. Panel ids are kept, so a plot's tableFilter still
     * names its table.
     *
     * Nothing asks first: each Load button says what it does, and the open
     * panels a load replaces stay in the closed list, one click from
     * reopening. The options are the ablations of a plain Load (which
     * switches to the set's dataset and opens its panels, as a share link
     * does):
     *
     * - `keepDataset` / `onDataset`: load onto the open dataset, or onto the
     *   store the user picked, instead of the set's own (a store the user
     *   chose is not asked about again if its cells differ: a notice says so)
     * - `add: true`: keep the open view as it is and only add the set's
     *   panels to the closed list (_addPanelSet).
     *
     * The autosave restore and the subset change keep their panels open.
     * @param {{datasetPath: string|null, view: Object, closedPanels: Array, legacy: boolean}} plan
     * @param {Object} panelSet - the stored panel set
     * @param {{add?: boolean, keepDataset?: boolean, onDataset?: string|null}} [options]
     * @returns {Promise<{status: string, message: string}>}
     * @private
     */
    async function _applyPanelSet(plan, panelSet, { add = false, keepDataset = false, onDataset = null } = {}) {
        const name = (panelSet && panelSet.name) || 'panel set';
        const current = DataManager.getCurrentDataset();
        if (add) return _addPanelSet(plan, name);
        // A store the user chose (the open one, or one picked) is opened
        // as asked; otherwise the set's own, found by its name in the data
        // directory or by the store with the same cells and genes
        const chosen = keepDataset ? current : onDataset;
        if (keepDataset && !current) {
            return { status: 'error', message: `No dataset is open to load "${name}" onto.` };
        }
        const target = chosen || plan.datasetPath || current;
        const located = target
            ? await _locateStore(target, plan.view, { exact: !!chosen })
            : { path: null };
        const listing = await DataManager.loadDatasets().catch(() => []);
        if (!target) {
            return { status: 'error', message: `"${name}" names no dataset, and none is open.` };
        }
        const total = closePlanPanels(plan).closedPanels.length;

        // The set replaces the open view. Open panels are closed (they stay
        // available to reopen); a panel with an id the set brings is removed,
        // so the set's panel gets that id back unchanged.
        const incoming = new Set([
            ...(plan.view && plan.view.layout ? collectTileIds(plan.view.layout.hierarchy) : []),
            ...plan.closedPanels.map(p => p.id).filter(Boolean)
        ]);
        PanelManager.getActivePanels().map(p => p.getId()).forEach(id => PanelManager.closePanel(id));
        incoming.forEach(id => PanelManager.removePanel(id));

        // keep the open store's own path when the set names it differently
        if (current && located.path && sameDatasetPath(located.path, current, listing)) located.path = current;
        const applied = await _applyView({ datasetPath: target, view: plan.view }, { located, trust: !!chosen });
        const datasetPath = located.path || target;

        // Panels that were closed when the set was saved come back closed.
        const idMap = new Map();
        const closedConfigs = plan.closedPanels.map(p => {
            const config = JSON.parse(JSON.stringify(p.config));
            PanelManager.registerClosedPanel(p.type, config);
            if (p.id && config.id !== p.id) idMap.set(p.id, config.id);
            return config;
        });
        if (idMap.size) remapPanelReferences(closedConfigs, idMap);

        PanelManager.updateSourcePanelSelection();
        PanelManager.ensureWelcomeFallback();
        const listed = `${total} panel${total === 1 ? '' : 's'} listed closed`;
        // A toast replaces the one before it: these keep what the view's
        // notice said (opened on another path, another version)
        if (!(plan.view && plan.view.layout && collectTileIds(plan.view.layout.hierarchy).length)) {
            // a set saved with no panel open
            _showNotification(`Loaded "${name}"`, _carriedViewNotice() + `No panel was open when the set was saved, so none ` +
                `opened; its ${listed} under Duplicate or Reopen Panel.`, 'success', 8000);
        }
        if (applied && applied.status === 'no-data') {
            return { status: 'no-data', message: `Loaded "${name}" without data: ${applied.message}` };
        }
        return { status: 'success', message: `Loaded "${name}"` };
    }

    // Fresh ids for panels added from a panel set: `<type>-<n>`, n never repeating
    let _addedIdCounter = Date.now();

    /**
     * "Add to closed panels": the set's panels join the closed list, each
     * with its full config and title; the open panels, dataset, subset and
     * focus stay as they are. Ids the app already uses get fresh ones, and
     * the set's references between its own panels follow (panelsToAdd). A
     * set saved on another dataset is added too, its panels marked so, and
     * the dataset is not switched. Nothing was replaced, so no saved layout
     * is offered.
     * @private
     */
    async function _addPanelSet(plan, name) {
        const current = DataManager.getCurrentDataset();
        let other = null;
        if (plan.datasetPath) {
            const listing = await DataManager.loadDatasets().catch(() => []);
            if (!current || !sameDatasetPath(plan.datasetPath, current, listing)) other = plan.datasetPath;
        }
        const added = panelsToAdd(plan, id => !!PanelManager.getPanel(id),
            type => `${type}-${++_addedIdCounter}`);
        // A title the app shows already (table-filter menus, notices) gets the
        // set's name after it: "Cell Plot 1 (walk_three_panels)"
        const titles = new Set(PanelManager.getAllPanels().map(p => p.getTitle()));
        added.forEach(p => {
            if (p.config.title && titles.has(p.config.title)) p.config.title = `${p.config.title} (${name})`;
            titles.add(p.config.title);
        });
        let n = 0;
        added.forEach(p => {
            const panel = PanelManager.registerClosedPanel(p.type, p.config, { keepTitle: true });
            if (!panel) return;
            panel._addedFrom = { set: name, otherDataset: other };
            n++;
        });
        PanelManager.updateSourcePanelSelection();
        const panels = `${n} panel${n === 1 ? '' : 's'}`;
        _showNotification(`Added "${name}"`,
            `${panels} added to the closed panels under Duplicate or Reopen Panel; the open view is unchanged.` +
            (other ? ` The set was saved on ${other}: its panels are marked "other dataset".` : ''),
            'success', 8000);
        return { status: 'success', message: `Added ${panels} of "${name}" to the closed panels` };
    }

    /**
     * Show other cells (the subset dialog's Apply, a part step): the open
     * view, its panels, focus and layout, on the new subset. Only the data
     * changes: the panels are told `subsetChanged` and swap their points and
     * rows in place, so no tile, control or table is rebuilt and each plot
     * keeps the view the user chose. While a dataset is still loading, the
     * view is reopened through the panel-set path as before.
     * @param {Object|null} spec - subset spec, or null for every cell
     * @private
     */
    async function _changeSubset(spec, { step = false } = {}) {
        const datasetPath = DataManager.getCurrentDataset();
        if (!datasetPath) return;
        // The focused and locked cells are found in the new subset by their
        // dataset rows, learned now while this subset still shows them
        await DataManager.recordCellRows(getFixedCells().map(c => c.cell));
        try {
            if (_isLoadingDataset) {
                const view = SessionManager.captureView();
                view.subset = spec;
                const plan = panelSetToView({ dataset: datasetPath, view });
                await _applyPanelSet(plan, { name: step ? 'cell subset part' : 'cell subset' });
            } else if (!(await _swapSubset(spec))) {
                return;     // a later request took over
            }
            // No toast: the header and every plot's status strip say what is shown
        } catch (error) {
            if (error && error.name === 'AbortError') return;
            console.error('Changing the cell subset failed:', error);
            _showNotification('Cell subset not changed', error.message || String(error), 'error');
            SubsetControl.update();
        }
    }

    // One subset swap at a time; requests made meanwhile collapse into the
    // last one, which runs next
    let _subsetSwap = null;
    let _subsetQueued = null;

    /**
     * Read the cells of `spec` and let the open panels redraw on them.
     * @returns {Promise<boolean>} true for the request that was shown, false
     *   for one a later request replaced before it ran
     * @private
     */
    function _swapSubset(spec) {
        const request = { spec };
        _subsetQueued = request;
        const run = async () => {
            if (_subsetQueued !== request) return false;
            _subsetQueued = null;
            DataManager.setSubsetRequest(spec);
            await DataManager.reloadSubset();
            SubsetControl.update();
            await _resolveFocusForDataset('cells');
            _updateFocusBadge();
            await PanelManager.notifyPanels('subsetChanged', { dataset: DataManager.getCurrentDataset() });
            return true;
        };
        const next = (_subsetSwap || Promise.resolve()).catch(() => {}).then(run);
        _subsetSwap = next;
        next.catch(() => {}).finally(() => { if (_subsetSwap === next) _subsetSwap = null; });
        return next;
    }

    /**
     * Say at a form field what is wrong with it (the browser's own bubble,
     * anchored to the field), instead of a blocking alert.
     * @private
     */
    function _invalid(input, message) {
        input.setCustomValidity(message);
        input.reportValidity();
        for (const ev of ['input', 'change']) input.addEventListener(ev, () => input.setCustomValidity(''), { once: true });
    }

    /**
     * Whether a panel's status strip offers `action` (see registerStatusActions
     * in utils/panel-surface.js).
     * @param {string} action
     * @param {HTMLElement} host - the panel's plot container
     * @private
     */
    function _statusActionAvailable(action, host) {
        const id = (host && host.id || '').replace(/^plot-container-/, '');
        const subset = DataManager.getSubset();
        switch (action) {
            case 'next-part': return !!(subset && subset.parts > 1 && subset.part < subset.parts - 1);
            case 'subset': case 'subset-regular': return !!DataManager.getCurrentDataset();
            case 'focus-part': return DataManager.hasSubsetFeature('locate_parts');
            case 'stop-table': return !!document.getElementById(`remove-non-table-entries-${id}`);
            case 'show-nan': return !!document.getElementById(`hide-nan-${id}`);
            case 'show-outliers': return !!document.getElementById(`hide-outliers-${id}`);
            case 'draw-anyway': case 'redraw': {
                const panel = PanelManager.getPanel(id);
                return !!(panel && typeof panel.refreshPlot === 'function');
            }
            case 'export-shown': return canSnapshot(host);
            case 'reopen-table': return !!document.querySelector(`.panel-closed-btn[data-id="${_tableFilterOf(id)}"]`);
            case 'table-filter-off': return !!_tableFilterSelect(id);
            default: return false;
        }
    }

    /** The table a plot panel is filtered by (its tableFilter setting), or null. */
    function _tableFilterOf(id) {
        const panel = PanelManager.getPanel(id);
        const cfg = panel && panel.getConfig ? panel.getConfig() : null;
        return cfg && cfg.tableFilter && cfg.tableFilter !== 'none' ? cfg.tableFilter : null;
    }

    /** A plot panel's table-filter select. */
    function _tableFilterSelect(id) {
        return document.querySelector(`.tile[data-tile-id="${id}"] select.table-filter-select`);
    }

    /**
     * Run a status-strip action: what undoes one reason a panel shows fewer
     * cells. The panel's own toggles do the undoing, so the strip and the
     * controls cannot disagree.
     * @private
     */
    async function _runStatusAction(action, host) {
        const id = (host && host.id || '').replace(/^plot-container-/, '');
        const click = (elId) => { const el = document.getElementById(elId); if (el) el.click(); };
        switch (action) {
            case 'next-part': SubsetControl.step(1); break;
            case 'subset': SubsetControl.open(); break;
            case 'subset-regular':
                document.dispatchEvent(new CustomEvent('annzarro:open-subset', { detail: { preset: 'largest-regular' } }));
                break;
            case 'focus-part': {
                const part = await DataManager.partOfCell(DataManager.getFocusedCell());
                if (part !== null) SubsetControl.goTo(part);
                else _showNotification('Part not found', 'The subset\'s filter leaves the focused cell out.', 'warning');
                break;
            }
            case 'stop-table': click(`remove-non-table-entries-${id}`); break;
            case 'show-nan': click(`hide-nan-${id}`); break;
            case 'show-outliers': click(`hide-outliers-${id}`); break;
            case 'draw-anyway': case 'redraw': {
                // draw-anyway: past the memory guard (or the crash marker), once
                if (action === 'draw-anyway') overrideOnce(id);
                const panel = PanelManager.getPanel(id);
                if (panel && typeof panel.refreshPlot === 'function') panel.refreshPlot().catch(() => {});
                break;
            }
            case 'reopen-table': {
                const btn = document.querySelector(`.panel-closed-btn[data-id="${_tableFilterOf(id)}"]`);
                if (btn) btn.click();
                break;
            }
            case 'table-filter-off': {
                const select = _tableFilterSelect(id);
                if (select) {
                    select.value = 'none';
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                }
                break;
            }
            case 'export-shown':
                exportImage(host, 'shown', { format: 'png', filename: 'plot_' + new Date().toISOString().replace(/[:.]/g, '-') })
                    .catch(error => console.error('Export as shown failed:', error));
                break;
        }
    }

    /**
     * The recipe an exported figure carries (utils/plot-export.js): the view
     * as a panel set, the panel, the export's size, and the AnnZarro
     * version. `annzarro export --from fig.png` makes the figure again from
     * it; with the same store and version, the same figure.
     * @param {HTMLElement} gd
     * @param {{how: string, format: string, width: number, height: number, scale: number}} info
     * @private
     */
    function _figureRecipe(gd, info) {
        const tile = gd && gd.closest ? gd.closest('.tile') : null;
        const view = SessionManager.captureView();
        // A figure is published: it names its store by name in the data
        // directory and by fingerprint, never by this server's absolute path
        // (unless the store is outside the data directory, where that path
        // is all there is)
        if (view.store && view.store.abs) {
            view.store = { ...view.store };
            delete view.store.abs;
        }
        const store = view.store || null;
        const panelSet = { name: 'figure', dataset: store ? store.path : DataManager.getCurrentDataset(), view };
        return {
            annzarro_recipe: 1,
            annzarro_version: appVersion(),
            panel: tile ? tile.dataset.tileId : null,
            export: { how: info.how, format: info.format, width: info.width, height: info.height, scale: info.scale },
            panel_set: panelSet
        };
    }

    /**
     * Hooks `annzarro export` (annzarro/export.py) calls in a headless browser:
     *   annzarroPlots()             the open plot panels' tile ids
     *   annzarroPlotState()         a signature of what is drawn (stable = done)
     *   annzarroExport(id, format)  the panel's image, exactly as its Export
     *                               button makes it (size and scale from its
     *                               settings, coverage notice, recipe)
     * @private
     */
    function _installExportHooks() {
        const plotOf = (id) => {
            const tile = document.querySelector(`.tile[data-tile-id="${CSS.escape(id)}"]`);
            return tile ? tile.querySelector('.js-plotly-plot') : null;
        };
        window.annzarroPlots = () => [...document.querySelectorAll('.tile-container .tile[data-tile-id]')]
            .filter(t => t.querySelector('.js-plotly-plot')).map(t => t.dataset.tileId);
        window.annzarroPlotState = () => JSON.stringify({
            loading: _isLoadingDataset,
            noData: !!_noDataView,
            plots: window.annzarroPlots().map(id => {
                const gd = plotOf(id);
                const fl = gd && gd._fullLayout;
                return [id, !!fl, ((gd && gd.data) || []).map(t => [t.type, (t.x || []).length,
                    t.marker && t.marker.color && t.marker.color.length]),
                fl ? [fl.width, fl.height, JSON.stringify(fl.annotations || []).length] : null];
            })
        });
        window.annzarroExport = async (id, format = 'svg') => {
            const gd = plotOf(id);
            if (!gd) throw new Error(`Panel ${id} has no plot`);
            const panel = PanelManager.getPanel(id);
            const settings = (panel && panel.getConfig && panel.getConfig()) || {};
            return exportImageData(gd, 'full', { format, ...exportOptions(settings) });
        };
    }

    /**
     * A notice that asks: like _showNotification, but it stays until one of
     * its buttons (or the close cross) is clicked. Never a modal dialog.
     * @param {string} title
     * @param {string} message
     * @param {Array<{key: string, label: string, primary?: boolean}>} actions
     * @returns {Promise<string|null>} the chosen key, null if dismissed
     * @private
     */
    function _askNotification(title, message, actions, { type = 'warning', handle = null, checkbox = null } = {}) {
        return new Promise(resolve => {
            const id = _showNotification(title, message, type, 24 * 3600 * 1000);
            const el = document.getElementById(id);
            if (!el) { resolve(null); return; }
            el.classList.add('notification-ask');
            el.setAttribute('role', 'alertdialog');
            let done = false;
            const finish = (key) => {
                if (done) return;
                done = true;
                // answered: not clickable while it fades out
                el.classList.remove('notification-ask');
                el.querySelectorAll('.notification-actions button').forEach(btn => { btn.disabled = true; });
                _removeNotification(id);
                resolve(key);
            };
            const bar = document.createElement('div');
            bar.className = 'notification-actions';
            actions.forEach(action => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `btn btn-sm ${action.primary ? 'btn-primary' : 'btn-outline-secondary'}`;
                btn.textContent = action.label;
                btn.dataset.action = action.key;
                btn.addEventListener('click', () => finish(action.key));
                bar.appendChild(btn);
            });
            el.appendChild(bar);
            const close = el.querySelector('.notification-close');
            if (close) close.addEventListener('click', () => finish(null));
            // lets the caller withdraw the question (resolves with null)
            if (handle) handle.cancel = () => finish(null);
            // an optional tick box above the buttons; its state is read from `handle.checked`
            if (checkbox) {
                const label = document.createElement('label');
                label.className = 'notification-check';
                const box = document.createElement('input');
                box.type = 'checkbox';
                box.id = checkbox.id || '';
                box.addEventListener('change', () => { if (handle) handle.checked = box.checked; });
                label.appendChild(box);
                label.appendChild(document.createTextNode(' ' + checkbox.label));
                el.insertBefore(label, bar);
                if (checkbox.note) {
                    // calm reassurance under the tick box
                    const note = document.createElement('div');
                    note.className = 'notification-check-note';
                    note.textContent = checkbox.note;
                    el.insertBefore(note, bar);
                }
            }
            const primary = bar.querySelector('.btn-primary');
            if (primary) primary.focus();
        });
    }

    /**
     * "Close all panels": ask, then close every open panel (each goes to the
     * closed list, as with its X). With the tick box, also clear what this
     * site stored in this browser and reload to the bare URL, a first visit.
     * Cookies, so the login, and panel sets saved on the server are untouched.
     * @private
     */
    async function _closeAllPanels() {
        if (_closeAllAsking) return;
        _closeAllAsking = true;
        try {
            const handle = { checked: false };
            const choice = await _askNotification('Close all panels?',
                'Every open panel closes and is listed under Duplicate or Reopen Panel.\n\n' +
                'Not affected: panel sets saved on the server, and your login.',
                [{ key: 'close', label: 'Close all', primary: true }, { key: 'cancel', label: 'Cancel' }],
                { type: 'info', handle, checkbox: { id: 'close-all-clear-storage',
                    label: 'Also clear everything this site stored in this browser and reload as a first visit',
                    note: 'A fresh start for this browser only: it forgets the remembered layout and settings, ' +
                        'then reloads. Nothing is deleted. Saved panel sets (yours and other users\'), ' +
                        'datasets and files on the server are not touched. Safe to use for a full refresh.' } });
            if (choice !== 'close') return;

            if (handle.checked) {
                // nothing may save the layout back into the storage being cleared
                SessionManager.holdAutosave();
            }
            PanelManager.getActivePanels().map(p => p.getId()).forEach(id => PanelManager.closePanel(id));
            PanelManager.updateSourcePanelSelection();
            PanelManager.ensureWelcomeFallback();
            if (!handle.checked) return;

            const result = await clearSiteStorage(window);
            if (result.failed.length) console.warn('Could not clear:', result.failed.join(', '));
            // A link that differs only by its #view changes the fragment in
            // place without loading anything: reload that case by hand.
            const onlyFragment = !window.location.search;
            // Handlers that run as the page goes (memory-guard's pagehide, a
            // draw that began a crash marker) may write keys again: clear the
            // synchronous stores once more last, after them.
            window.addEventListener('pagehide', () => clearSiteStorageNow(window));
            clearSiteStorageNow(window);
            window.location.replace(bareUrl(window.location));
            if (onlyFragment) window.location.reload();
        } finally {
            _closeAllAsking = false;
        }
    }

    /**
     * Initialize Plotly.js with optimized canvas settings
     * @private
     */
    function _initPlotly() {
        if (typeof Plotly !== 'undefined') {
            
            // Set global Plotly configuration
            const plotlyConfig = {
                responsive: true,
                displayModeBar: true,
                displaylogo: false,
                modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d'],
                toImageButtonOptions: {
                    format: 'png',
                    filename: 'annzarro_plot',
                    height: 800,
                    width: 1200,
                    scale: 2
                }
            };
            Plotly.setPlotConfig(plotlyConfig);
            
            // Store configuration on the window for access by other modules
            window.plotlyDefaultConfig = plotlyConfig;
        }
    }
    
    /**
     * Initialize UI components
     * @private
     */
    function _initUI() {
        // Setup bootstrap modals
        _sessionModal = new bootstrap.Modal(document.getElementById('session-modal'));

        // Cell count and subset badge in the stats bar; its dialog reloads
        // the open view on the chosen cells
        SubsetControl.init({ onApply: _changeSubset });
        registerStatusActions({ available: _statusActionAvailable, run: _runStatusAction });
        
        // Setup keyboard shortcuts
        _initKeyboardShortcuts();
        
        // Check environment mode flags
        const isElectron = window.api !== undefined && typeof window.api.selectDirectory === 'function';
        const isLocalMode = Config.SERVER_CONFIG.local_mode === true;
        
        // Log environment detection for debugging
        console.debug('Environment detection:', { 
            isElectron, 
            isLocalMode,
            electronModeConfig: Config.SERVER_CONFIG.electron_mode
        });
        
        const selectDirectoryBtn = document.getElementById('select-directory');
        // Only show the button if we're in Electron mode or if we're in local mode AND the browser supports the directory picker API
        if (selectDirectoryBtn && (isElectron || isLocalMode)) {
            selectDirectoryBtn.style.display = 'block';
            
            selectDirectoryBtn.addEventListener('click', async () => {
                try {
                    let selectedDir;
                    
                    if (isElectron) {
                        // Use Electron API for directory selection
                        selectedDir = await window.api.selectDirectory();
                    } else {
                        // Use modern File System Access API in local mode
                        try {
                            console.log('Using File System Access API for directory selection in local mode');
                            
                            // Check if the modern Directory Picker API is available
                            if (window.showDirectoryPicker) {
                                try {
                                    // Show a prompt explaining the user needs to use a local path instead
                                    const userPath = prompt(
                                        "The File System Access API doesn't provide actual file paths that the server can use. " +
                                        "Please enter the actual file system path to the directory you want to open:",
                                        ""
                                    );
                                    
                                    if (userPath) {
                                        selectedDir = userPath;
                                        console.log('User provided directory path:', selectedDir);
                                    } else {
                                        throw new Error('No directory path provided');
                                    }
                                } catch (e) {
                                    console.debug('User cancelled directory path input:', e);
                                    selectedDir = null;
                                }
                            } else {
                                throw new Error('Directory picker API not available');
                            }
                        } catch (error) {
                            console.error('Directory selection failed:', error);
                            selectedDir = null;
                        }
                    }
                    
                    if (selectedDir) {
                        // Set the dataset selector to the selected directory path
                        const datasetSelector = document.getElementById('dataset-selector');
                        if (datasetSelector) {
                            // Update the Select2 component if it exists
                            if (window.$ && $.fn.select2 && $(datasetSelector).hasClass('select2-hidden-accessible')) {
                                // Create or select option
                                const newOption = new Option(selectedDir, selectedDir, true, true);
                                $(datasetSelector).append(newOption).trigger({
                                    type: 'select2:select',
                                    params: {
                                        data: {id: selectedDir}
                                    }
                                });
                            } else {
                                // Regular select
                                datasetSelector.value = selectedDir;
                                datasetSelector.dispatchEvent(new Event('change'));
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error selecting directory:', error);
                    _showNotification('Failed to select directory', error.message, 'error');
                }
            });
        }
        
        
        // Setup dataset refresh button
        const refreshDatasetBtn = document.getElementById('refresh-dataset');
        if (refreshDatasetBtn) {
            refreshDatasetBtn.addEventListener('click', async () => {

                // Get current dataset path if one is selected
                const datasetSelector = document.getElementById('dataset-selector');
                const datasetPath = datasetSelector.value;
                
                // Reset backend cache for the current dataset (if one is selected)
                if (!datasetPath) {
                    console.warn('No dataset selected for refresh');
                    return;
                }
                _lastLoadedDatasetPath = null; // Reset last loaded dataset path to avoid duplicate loading

                document.getElementById('cell-count').textContent = 'Loading.';
                document.getElementById('gene-count').textContent = 'Loading.';

                // Clear frontend cache for datasets listing
                DataManager.clearCache(Config.API.DATASETS);
                
                document.getElementById('cell-count').textContent = 'Loading..';
                document.getElementById('gene-count').textContent = 'Loading..';

                // Every user: the server checks the store against the disk
                // and, if it changed, serves the change from every worker.
                await DataManager.revalidateDataset(datasetPath);
                // Clearing the server's whole cache for the dataset as well is
                // for an admin of a hosted server (and the desktop); a refusal
                // (403 admin_only) is expected, not an error.
                if (_refreshPlan.resetServerCache) {
                    try {
                        await DataManager.resetBackendCache(datasetPath);
                    } catch (e) {
                        console.warn('Server cache not cleared:', e && e.message);
                    }
                }
                
                // Reload available datasets
                await _loadDatasets();
                
                // Then refresh current dataset if one is selected
                if (datasetPath) {
                    // Clear the DataManager's frontend cache for this dataset
                    DataManager.refreshCacheForDataset(datasetPath);
                    await _loadDataset(datasetPath);
                }
            });
        }
        
        // Setup session management buttons
        const saveSessionBtn = document.getElementById('btn-save-session');
        if (saveSessionBtn) {
            saveSessionBtn.addEventListener('click', _showSaveSessionModal);
        }
        
        const loadSessionBtn = document.getElementById('btn-load-session');
        if (loadSessionBtn) {
            loadSessionBtn.addEventListener('click', _showLoadSessionModal);
        }

        const closeAllBtn = document.getElementById('btn-close-all');
        if (closeAllBtn) closeAllBtn.addEventListener('click', _closeAllPanels);

        const changeDatasetBtn = document.getElementById('btn-change-dataset');
        if (changeDatasetBtn) changeDatasetBtn.addEventListener('click', () => _showChangeDataset());

        const shareLinkBtn = document.getElementById('btn-share-link');
        if (shareLinkBtn) {
            shareLinkBtn.addEventListener('click', _shareCurrentView);
        }
        // The share field selects its whole link on focus, ready to copy, but
        // keeps the START in view (host and dataset_path), not the tail of a
        // 1,300-character #view= payload.
        const shareLinkField = document.getElementById('share-link-field');
        if (shareLinkField) {
            shareLinkField.addEventListener('focus', () => _selectShowingStart(shareLinkField));
            shareLinkField.addEventListener('mouseup', (e) => e.preventDefault());
        }
        const shareLinkClose = document.getElementById('share-link-close');
        if (shareLinkClose) {
            shareLinkClose.addEventListener('click', () => {
                document.getElementById('share-link-fallback').hidden = true;
            });
        }

        // Gene and cell pickers: typeaheads that ask the server for matches
        // (see utils/name-picker.js), plus history navigation
        const focusedGeneInput = document.getElementById('focused-gene');
        if (focusedGeneInput) {
            _pickers.genes = mountNamePicker({
                input: focusedGeneInput, noun: 'gene', search: _nameSearch('genes'), indexState: _nameIndexState('genes'),
                onPick: name => DataManager.setFocusedGene(name)
            });
        }
        
        // Gene history buttons
        const geneHistoryBack = document.getElementById('gene-history-back');
        const geneHistoryForward = document.getElementById('gene-history-forward');
        
        if (geneHistoryBack) {
            geneHistoryBack.addEventListener('click', () => {
                DataManager.navigateGeneHistoryBack();
            });
        }
        
        if (geneHistoryForward) {
            geneHistoryForward.addEventListener('click', () => {
                DataManager.navigateGeneHistoryForward();
            });
        }
        
        // Listen for focused gene change events to update history UI
        document.addEventListener('focusedGeneChanged', (e) => {
            if (geneHistoryBack) {
                geneHistoryBack.disabled = !e.detail.canGoBack;
            }
            if (geneHistoryForward) {
                geneHistoryForward.disabled = !e.detail.canGoForward;
            }
            
            // Show the focused gene, whatever changed it (plot click, history, link)
            if (_pickers.genes) _pickers.genes.setValue(e.detail.gene);
        });
        
        const focusedCellInput = document.getElementById('focused-cell');
        if (focusedCellInput) {
            _pickers.cells = mountNamePicker({
                input: focusedCellInput, noun: 'cell', search: _nameSearch('cells'), indexState: _nameIndexState('cells'),
                onPick: (name, match) => {
                    // the search said where the cell is: no second lookup
                    if (match) DataManager.rememberCell(name, match);
                    DataManager.setFocusedCell(name);
                }
            });
        }
        
        // Cell history buttons
        const cellHistoryBack = document.getElementById('cell-history-back');
        const cellHistoryForward = document.getElementById('cell-history-forward');
        
        if (cellHistoryBack) {
            cellHistoryBack.addEventListener('click', () => {
                DataManager.navigateCellHistoryBack();
            });
        }
        
        if (cellHistoryForward) {
            cellHistoryForward.addEventListener('click', () => {
                DataManager.navigateCellHistoryForward();
            });
        }
        
        // Listen for focused cell change events to update history UI
        document.addEventListener('focusedCellChanged', (e) => {
            if (cellHistoryBack) {
                cellHistoryBack.disabled = !e.detail.canGoBack;
            }
            if (cellHistoryForward) {
                cellHistoryForward.disabled = !e.detail.canGoForward;
            }
            
            // Show the focused cell, whatever changed it (plot click, history, link)
            if (_pickers.cells) _pickers.cells.setValue(e.detail.cell);
            _updateFocusBadge();
        });
        document.addEventListener('datasetChanged', () => _updateFocusBadge());
        // Once a cell is located, its labels say whether the subset shows it
        document.addEventListener('cellLocated', (e) => {
            _relabelCell(e.detail);
            if (e.detail.name === DataManager.getFocusedCell()) _updateFocusBadge();
        });
        
        // No asynchronous sorting events
        
        
        // Setup session modal buttons
        const confirmSessionBtn = document.getElementById('btn-confirm-session');
        if (confirmSessionBtn) {
            confirmSessionBtn.addEventListener('click', _handleSessionModalConfirm);
        }
    }
    
    /**
     * Load available datasets
     * @private
     */
    async function _loadDatasets() {
        const sel = document.getElementById('dataset-selector');
        if (!sel) return;
      
        // 0) remember current selection
        const currentValue = sel.value;
      
        // 1) destroy any existing Select2 so the native <select> is visible
        if (window.$ && $.fn.select2 && $(sel).hasClass('select2-hidden-accessible')) {
          $(sel).select2('destroy');
        }
      
        // 2) show loading placeholder
        sel.disabled     = true;
        sel.innerHTML    = '';
        sel.appendChild(new Option('Loading...', '', true, true));
      
        // 3) yield to browser so “Loading…” actually paints
        await new Promise(resolve => setTimeout(resolve, 0));
      
        // 4) fetch the list
        let datasets;
        try {
          datasets = await DataManager.loadDatasets();
        } catch (err) {
          console.error('Error loading datasets:', err);
          sel.innerHTML = '';
          sel.appendChild(new Option('Error loading datasets', '', true, true));
          sel.disabled = false;
          return;
        }
      
        // 5) clear & populate real options
        sel.disabled  = false;
        sel.innerHTML = '';
        if (datasets && datasets.length) {
          datasets.forEach(ds => {
            sel.appendChild(new Option(ds.name || ds.path, ds.path));
          });
        } else {
          sel.appendChild(new Option('No datasets available', '', true, true));
        }
      
        // 6) restore previousValue on native <select>
        if (currentValue) {
          const exists = Array.from(sel.options).some(o => o.value === currentValue);
          if (exists) {
            sel.value = currentValue;
          } else {
            const custom = new Option(`${currentValue} (Custom)`, currentValue, true, true);
            sel.add(custom);
            sel.value = currentValue;
          }
        }
      
        // 7) if Select2 is present, re‑init it exactly as before
        if (window.$ && $.fn.select2) {
          $(sel).select2({
            tags:        true,
            placeholder: 'Select or enter a dataset path',
            width:       '100%',
            createTag: params => {
              const term = params.term.trim();
              return term
                ? { id: term, text: `${term} (Custom)`, newTag: true }
                : null;
            }
          });
      
          // 8) restore selection in the Select2 widget
          if (currentValue) {
            $(sel).val(currentValue).trigger('change');
          }
      
          // 9) bind the select2:select → _loadDataset handler
          $(sel)
            .off('select2:select')
            .on('select2:select', e => {
              const datasetPath = e.params.data.id;
              if (!datasetPath) return;
              // a view open without data opens on the chosen dataset
              if (_noDataView) {
                  _applyView({ datasetPath, view: _noDataView.view }, { exact: true })
                      .then(() => PanelManager.ensureWelcomeFallback());
              } else {
                  _loadDataset(datasetPath);
              }
            });
        }
      }
    
    /**
     * Load a specific dataset
     * @param {string} datasetPath - Path to the dataset
     * @param {boolean} [silent=false] - If true, don't notify panels (prevents UI reset)
     * @private
     */
    // Track last dataset path to avoid duplicate loading
    let _lastLoadedDatasetPath = null;
    let _isLoadingDataset = false;
    let _currentLoadingAbortController = null;
    
    async function _loadDataset(datasetPath, silent = false) {
        try {
            // Skip loading if it's the same as the last loaded (not just loading)
            if (datasetPath === _lastLoadedDatasetPath && !_isLoadingDataset) {
                console.log(`Skipping duplicate dataset load: ${datasetPath}`);
                return;
            }
            
            // If we're already loading something, abort it
            if (_isLoadingDataset && _currentLoadingAbortController) {
                console.log(`Aborting current dataset load to start new one: ${datasetPath}`);
                _currentLoadingAbortController.abort();
                _currentLoadingAbortController = null;
            }
            
            // Create a new abort controller for this loading operation
            _currentLoadingAbortController = new AbortController();
            const signal = _currentLoadingAbortController.signal;
            
            // Set loading flag
            _isLoadingDataset = true;
            _lastLoadedDatasetPath = datasetPath;
            console.log(`Loading dataset: ${datasetPath}${silent ? ' (silent mode)' : ''}`);
            
            // Show loading indicators
            document.getElementById('cell-count').textContent = 'Loading...';
            document.getElementById('gene-count').textContent = 'Loading...';
            
            // Check for abort before proceeding with each major step
            if (signal.aborted) {
                console.log(`Dataset load aborted before loading: ${datasetPath}`);
                _isLoadingDataset = false;
                return;
            }
            
            // Load dataset
            const datasetStructure = await DataManager.setCurrentDataset(datasetPath, silent, signal);
            
            if (signal.aborted) {
                console.log(`Dataset load aborted after loading structure: ${datasetPath}`);
                _isLoadingDataset = false;
                return;
            }
            
            // Update dataset info: cells shown of the dataset's cells, and the subset
            SubsetControl.update();
            document.getElementById('gene-count').textContent = datasetStructure.n_vars || 0;
            document.getElementById('dataset-path').textContent = datasetStructure.name || datasetPath;
            // A refresh found the store's consolidated metadata out of date:
            // it is read without it now, and the fix is the user's to run
            if (datasetStructure.consolidated_metadata && datasetStructure.consolidated_metadata.stale) {
                _showNotification('Consolidated metadata out of date', datasetStructure.consolidated_metadata.message, 'warning');
            }
            
            if (signal.aborted) {
                console.log(`Dataset load aborted before populating selectors: ${datasetPath}`);
                _isLoadingDataset = false;
                return;
            }
            
            // Keep or reset the focused gene and cell for this dataset (two
            // small server lookups; the pickers never hold the name lists)
            await Promise.all([_resolveFocusForDataset('genes'), _resolveFocusForDataset('cells')]);
            
            if (signal.aborted) {
                console.log(`Dataset load aborted after resolving focus: ${datasetPath}`);
                _isLoadingDataset = false;
                return;
            }
            
            // Only notify panels if not in silent mode
            if (!silent) {
                // Notify panels of dataset change - this can cause UI resets
                // Use await to ensure panels are updated (or update is aborted) before completing
                await PanelManager.notifyPanels('datasetChanged', { dataset: datasetPath });
            }
            
            // Update last loaded dataset path and reset loading flag
            _isLoadingDataset = false;
            _currentLoadingAbortController = null;

            // Ask the store's metadata tier for saved views, after the first
            // draw has had its turn (this does not start the name hash: the
            // server hashes the names when a view is saved or compared)
            setTimeout(() => {
                if (DataManager.getCurrentDataset() === datasetPath) prewarmStore(datasetPath);
            }, 5000);
        } catch (error) {
            // Check if this is an abort error 
            if (error && error.name === 'AbortError') {
                // Only log in debug mode to avoid console spam
                if (Config.DEBUG_MODE) {
                    console.debug(`Dataset load was aborted: ${datasetPath}`);
                }
            } else {
                console.error('Error loading dataset:', error);

                // Revert _lastLoadedDatasetPath so the same dataset can be retried
                _lastLoadedDatasetPath = DataManager.getCurrentDataset() || null;

                // Strip a leading exception class name ("ValueError: ...") so the
                // notification reads as a message rather than a traceback fragment.
                const rawMsg = error.message || 'Unknown error';
                const userMsg = rawMsg.replace(/^[A-Za-z]+Error:\s*/i, '') || rawMsg;

                // Get the current dataset information to determine how to handle the error
                const currentDataset = DataManager.getCurrentDataset();

                if (currentDataset) {
                    // We have a current dataset loaded, so show a non-blocking notification
                    _showNotification(
                        'Dataset Loading Error',
                        `Could not load dataset:\n${datasetPath}\n\n${userMsg}\n\nThe previous dataset is still loaded.`,
                        'error'
                    );

                    // Update UI elements to reflect we're still on the previous dataset
                    const cells = DataManager.getCells() || [];
                    const genes = DataManager.getGenes() || [];

                    document.getElementById('cell-count').textContent =
                        countNoun(cells.length, 'cells');
                    SubsetControl.update();
                    document.getElementById('gene-count').textContent =
                        countNoun(genes.length, 'genes');
                    document.getElementById('dataset-path').textContent = currentDataset;
                } else {
                    // No current dataset, so show an error notification
                    _showNotification('Failed to load dataset', userMsg, 'error');

                    // Reset UI elements
                    document.getElementById('cell-count').textContent = 'No dataset loaded';
                    document.getElementById('gene-count').textContent = 'No dataset loaded';
                    document.getElementById('dataset-path').textContent = 'No dataset loaded';
                }
            }
            
            // Reset loading flag on error
            _isLoadingDataset = false;
            _currentLoadingAbortController = null;
        }
    }
    
    /**
     * Header focus pickers (typeaheads over /data/names), created in _initUI.
     * @private
     */
    const _pickers = { cells: null, genes: null };

    /** The search function a picker calls: server-side, at most 100 names. */
    function _nameSearch(entity) {
        return (query, { regex, signal }) => {
            const datasetPath = DataManager.getCurrentDataset();
            if (!datasetPath) return Promise.resolve({ matches: [], truncated: false });
            const opts = {
                datasetPath, entity, query, signal, limit: 100,
                mode: regex ? 'regex' : 'substring',
                subset: DataManager.getSubsetParam()
            };
            const shown = fetchNameMatches(Config.API.NAMES, opts);
            if (entity !== 'cells' || !opts.subset || !DataManager.hasSubsetFeature('names_scope')) return shown;
            // Under a subset every cell of the dataset can be focused: the
            // shown cells' matches come first, and the others, tagged "not
            // shown", follow from a dataset-wide search (slower the first
            // time, while the server builds that name index)
            const all = fetchNameMatches(Config.API.NAMES, { ...opts, scope: 'dataset' });
            all.catch(() => {});
            return shown.then(first => ({
                ...first, more: all.then(rest => mergeScopedMatches(first, rest, opts.limit))
            }));
        };
    }

    /**
     * Whether the search a picker waits for is waiting for its name index:
     * the dataset-wide one for the cells a subset does not show ('more'),
     * else the one asked.
     * @private
     */
    function _nameIndexState(entity) {
        return (pending) => {
            const datasetPath = DataManager.getCurrentDataset();
            if (!datasetPath) return Promise.resolve(null);
            const subset = DataManager.getSubsetParam();
            return fetchNameIndexState(Config.API.NAMES, { datasetPath, entity, subset,
                scope: pending === 'more' ? 'dataset' : 'subset' });
        };
    }

    // The last focused cell a notice said was outside the subset, so a view
    // restore does not say it a second time.
    let _focusOutsideSubsetNoticed = null;

    let _badgeSeq = 0;

    /**
     * The header badge beside the focused cell: "not shown", or "not in
     * part 3 of 7" when the subset has parts, while the subset does not show
     * the focused cell; hidden otherwise.
     * @private
     */
    async function _updateFocusBadge() {
        const badge = document.getElementById('focused-cell-outside');
        if (!badge) return;
        const seq = ++_badgeSeq;
        const name = DataManager.getFocusedCell();
        const cell = name ? await DataManager.locateCell(name).catch(() => null) : null;
        if (seq !== _badgeSeq) return;
        const outside = !!(cell && !cell.shown && cell.row !== null);
        badge.hidden = !outside;
        if (!outside) return;
        const subset = DataManager.getSubset();
        badge.textContent = subset && subset.parts > 1
            ? `not in part ${(subset.part + 1).toLocaleString('en-US')} of ${subset.parts.toLocaleString('en-US')}`
            : 'not shown';
        badge.title = `${name} is focused but not among the shown cells`;
    }

    /**
     * Add or drop "(not shown)" on the axis menu options that name a cell,
     * once it is located (they are drawn before that is known).
     * @private
     */
    function _relabelCell(cell) {
        if (!cell || !cell.name) return;
        const outside = !cell.shown && cell.row !== null;
        const labels = [`Focused cell ${cell.name}`, `Locked cell ${cell.name}`];
        for (const option of document.querySelectorAll('select.axis-column-select option')) {
            const base = option.text.endsWith(NOT_SHOWN) ? option.text.slice(0, -NOT_SHOWN.length) : option.text;
            if (labels.includes(base)) option.text = outside ? `${base}${NOT_SHOWN}` : base;
        }
    }

    /**
     * The focused cell is kept although the subset does not show it. No
     * toast: the badge beside the focus control says so (_updateFocusBadge),
     * and the plots mark where it lies.
     */
    function _noticeFocusOutside(name) {
        _focusOutsideSubsetNoticed = name;
    }

    /**
     * After a dataset loads, keep the focused cell/gene if the new dataset has
     * it, otherwise focus its first name. Asks the server for one exact match
     * (and, if needed, the first name) instead of scanning a downloaded list.
     * @param {'cells'|'genes'} entity
     * @private
     */
    async function _resolveFocusForDataset(entity) {
        const picker = _pickers[entity];
        if (picker) picker.reset();
        const getFocused = entity === 'cells' ? DataManager.getFocusedCell : DataManager.getFocusedGene;
        const setFocused = entity === 'cells' ? DataManager.setFocusedCell : DataManager.setFocusedGene;
        const datasetPath = DataManager.getCurrentDataset();
        if (!datasetPath) return;
        const subset = DataManager.getSubsetParam();
        try {
            const current = getFocused();
            if (current && entity === 'cells') {
                // A cell the subset does not show stays focused while the
                // dataset has it (a part step, a filter): its rows are read
                // by dataset row
                const cell = await DataManager.locateCell(current);
                if (cell && (cell.shown || cell.row !== null)) {
                    if (picker) picker.setValue(current);
                    if (!cell.shown) _noticeFocusOutside(current);
                    return;
                }
                if (cell && cell.unreadable) {
                    // An older server: say why the focus moves
                    _focusOutsideSubsetNoticed = current;
                    _showNotification('Focused cell not in the subset',
                        `${current} is not among the cells shown, so another cell is focused. ` +
                        'This server cannot read a cell outside the subset.', 'warning', 8000);
                }
            } else if (current) {
                const hit = await fetchNameMatches(Config.API.NAMES, {
                    datasetPath, entity, query: current, mode: 'exact', limit: 1, subset });
                if (hit.matches.length && hit.matches[0].name === current) {
                    if (picker) picker.setValue(current);
                    return;
                }
            }
            // The first name is in the list the dataset load already
            // downloaded. Asking the server for it (query '') makes it build
            // its name index first: 56 s for 95.6M cells.
            const names = entity === 'cells' ? DataManager.getCells() : DataManager.getGenes();
            let name;
            if (names && names.length) {
                // names[0], or asked for when the names stay on the server
                name = entity === 'cells' ? await DataManager.cellNameAt(0) : names[0];
            } else {
                const first = await fetchNameMatches(Config.API.NAMES, {
                    datasetPath, entity, query: '', limit: 1, subset });
                name = first.matches.length ? first.matches[0].name : null;
            }
            if (name && name !== current) setFocused(name);
            if (picker) picker.setValue(name);
        } catch (error) {
            console.error(`Error resolving the focused ${entity === 'cells' ? 'cell' : 'gene'}:`, error);
        }
    }
    /**
     * Show save session modal
     * @private
     */
    async function _showSaveSessionModal() {
        // Set up modal for save mode
        document.getElementById('session-modal-title').textContent = 'Save Panel Set';
        document.getElementById('save-session-container').style.display = 'block';
        document.getElementById('session-list-container').style.display = 'none';
        document.getElementById('file-upload-section').style.display = 'none';
        document.getElementById('toggle-upload-btn').style.display = 'none';
        document.getElementById('btn-confirm-session').textContent = 'Save';
        document.getElementById('btn-confirm-session').style.display = '';
        document.getElementById('session-cancel-btn').textContent = 'Cancel';
        _setLoadHelp(false);
        
        // Set modal data attribute for type
        document.getElementById('session-modal').dataset.modalType = 'save';
        
        // Get existing sessions for suggestions
        const sessions = await SessionManager.listSessions();
        // Suggest only sets this user may overwrite; offering someone else's
        // name would lead straight to a refusal.
        const sessionNames = sessions.filter(canModify).map(s => s.name);
        
        // Get DOM elements
        const sessionNameInput = document.getElementById('session-name');
        const sessionSuggestions = document.getElementById('session-suggestions');
        
        // Clear previous input value and suggestions
        sessionNameInput.value = '';
        sessionSuggestions.innerHTML = '';
        
        // Function to update the suggestions based on input
        function updateSuggestions(query = '') {
            sessionSuggestions.innerHTML = '';
            const lowerQuery = query.toLowerCase();
            
            // Filter session names based on input
            const filteredNames = sessionNames.filter(name => 
                lowerQuery === '' || name.toLowerCase().includes(lowerQuery)
            );
            
            // Display filtered suggestions
            filteredNames.forEach(name => {
                const suggestionElement = document.createElement('span');
                suggestionElement.className = 'session-suggestion';
                suggestionElement.textContent = name;
                suggestionElement.addEventListener('click', () => {
                    sessionNameInput.value = name;
                    // Highlight this suggestion
                    document.querySelectorAll('.session-suggestion').forEach(el => {
                        el.classList.remove('highlighted');
                    });
                    suggestionElement.classList.add('highlighted');
                });
                sessionSuggestions.appendChild(suggestionElement);
            });
            
            // Hide existing sessions section if no suggestions
            document.getElementById('existing-sessions').style.display = 
                filteredNames.length > 0 ? 'block' : 'none';
        }
        
        // Initialize suggestions
        updateSuggestions();
        
        // Remove any existing input event listeners
        sessionNameInput.removeEventListener('input', updateSuggestionsHandler);
        
        // Add new input event listener for filtering
        function updateSuggestionsHandler(e) {
            updateSuggestions(e.target.value);
        }
        
        sessionNameInput.addEventListener('input', updateSuggestionsHandler);
        
        // Show modal and focus input field when it's fully visible
        _sessionModal.show();
        
        // Focus input field after modal is shown
        $('#session-modal').on('shown.bs.modal', function() {
            sessionNameInput.focus();
        });
    }
    
    /**
     * Show load session modal
     * @private
     */
    async function _showLoadSessionModal() {
        // Set up modal for load mode
        document.getElementById('session-modal-title').textContent = 'Load Panel Set';
        document.getElementById('save-session-container').style.display = 'none';
        document.getElementById('session-list-container').style.display = 'block';
        document.getElementById('file-upload-section').style.display = 'none';
        document.getElementById('toggle-upload-btn').style.display = 'block';
        // every card has its own buttons: the footer's Load is not needed
        document.getElementById('btn-confirm-session').style.display = 'none';
        document.getElementById('session-cancel-btn').textContent = 'Close';
        _setLoadHelp(true);
        _resetUploadCard();
        _locateCache.clear();
        
        // Set modal data attribute for type
        document.getElementById('session-modal').dataset.modalType = 'load';
        document.getElementById('session-modal').dataset.uploadMode = 'false';
        
        // Clear previous selection
        document.querySelector('.session-card.selected')?.classList.remove('selected');
        
        // Setup session search
        const searchInput = document.getElementById('session-search');
        const searchClearBtn = document.getElementById('session-search-clear');
        
        // Clear previous search
        searchInput.value = '';
        searchClearBtn.style.display = 'none';
        
        // Remove existing event listeners to prevent duplicates
        searchInput.removeEventListener('input', handleSessionSearch);
        searchClearBtn.removeEventListener('click', clearSessionSearch);
        
        // Search functionality
        function handleSessionSearch() {
            const searchTerm = this.value.toLowerCase().trim();
            
            // Show/hide clear button
            searchClearBtn.style.display = searchTerm ? 'block' : 'none';
            
            // Filter session cards
            const cards = document.querySelectorAll('.session-card');
            let visibleCount = 0;
            
            cards.forEach(card => {
                const sessionName = card.dataset.sessionName.toLowerCase();
                const datasetName = card.querySelector('.session-card-subtitle').textContent.toLowerCase();
                const isMatch = sessionName.includes(searchTerm) || datasetName.includes(searchTerm);
                
                card.style.display = isMatch ? 'block' : 'none';
                if (isMatch) visibleCount++;
            });
            
            // Show no results message if needed
            const noResultsMsg = document.querySelector('.no-search-results');
            if (visibleCount === 0 && searchTerm) {
                if (!noResultsMsg) {
                    const msg = document.createElement('div');
                    msg.className = 'no-search-results no-sessions-message';
                    msg.innerHTML = `No sessions found matching "<strong>${escapeHtml(searchTerm)}</strong>"`;
                    document.getElementById('session-grid').appendChild(msg);
                }
            } else {
                document.querySelector('.no-search-results')?.remove();
            }
        }
        
        // Clear search functionality
        function clearSessionSearch() {
            searchInput.value = '';
            searchClearBtn.style.display = 'none';
            
            // Show all cards
            document.querySelectorAll('.session-card').forEach(card => {
                card.style.display = 'block';
            });
            
            // Remove no results message
            document.querySelector('.no-search-results')?.remove();
            
            // Focus the search input
            searchInput.focus();
        }
        
        // Add event listeners
        searchInput.addEventListener('input', handleSessionSearch);
        searchClearBtn.addEventListener('click', clearSessionSearch);
        
        // Add keyboard support for searching
        searchInput.addEventListener('keydown', function(e) {
            // Escape key clears the search
            if (e.key === 'Escape') {
                clearSessionSearch();
            }
            
            // Enter key selects the first visible card
            if (e.key === 'Enter') {
                const visibleCards = Array.from(document.querySelectorAll('.session-card'))
                    .filter(card => card.style.display !== 'none');
                
                if (visibleCards.length > 0) {
                    // Clear any previous selection
                    document.querySelectorAll('.session-card.selected')
                        .forEach(el => el.classList.remove('selected'));
                    
                    // Select the first visible card
                    visibleCards[0].classList.add('selected');
                    
                    // Scroll to it
                    visibleCards[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }
        });
        
        // Reset file input and display
        const fileInput = document.getElementById('session-file-upload');
        const fileNameDisplay = document.getElementById('file-name-display');
        fileInput.value = '';
        fileNameDisplay.textContent = '';
        fileNameDisplay.classList.remove('has-file');
        
        // Setup drag and drop functionality
        const dropArea = document.querySelector('.file-drop-area');
        
        // Prevent defaults for drag events
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropArea.addEventListener(eventName, preventDefaults, false);
        });
        
        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }
        
        // Highlight drop area when file is dragged over
        ['dragenter', 'dragover'].forEach(eventName => {
            dropArea.addEventListener(eventName, highlight, false);
        });
        
        ['dragleave', 'drop'].forEach(eventName => {
            dropArea.addEventListener(eventName, unhighlight, false);
        });
        
        function highlight() {
            dropArea.classList.add('highlight');
        }
        
        function unhighlight() {
            dropArea.classList.remove('highlight');
        }
        
        // Handle file drop
        dropArea.addEventListener('drop', handleDrop, false);
        
        function handleDrop(e) {
            const dt = e.dataTransfer;
            const files = dt.files;
            handleFiles(files);
        }
        
        // Set up file upload handler
        fileInput.onchange = function() {
            handleFiles(this.files);
        };
        
        function handleFiles(files) {
            if (files.length > 0) {
                const file = files[0];
                // Update file name display
                fileNameDisplay.textContent = file.name;
                fileNameDisplay.classList.add('has-file');
                
                // Mark as file upload mode
                document.getElementById('session-modal').dataset.uploadMode = 'true';
                
                // Clear any selected session
                document.querySelector('.session-card.selected')?.classList.remove('selected');
                // its card, with the same Load buttons a saved set has
                _showUploadCard(file);
            }
        }
        
        // Set up toggle button to switch between list and upload views
        const toggleUploadBtn = document.getElementById('toggle-upload-btn');
        toggleUploadBtn.onclick = function() {
            if (document.getElementById('file-upload-section').style.display === 'none') {
                // Switch to upload view
                document.getElementById('file-upload-section').style.display = 'block';
                document.getElementById('session-list-container').style.display = 'none';
                toggleUploadBtn.innerHTML = '<i class="fas fa-list me-1"></i> Show saved sessions';
            } else {
                // Switch to list view
                document.getElementById('file-upload-section').style.display = 'none';
                document.getElementById('session-list-container').style.display = 'block';
                toggleUploadBtn.innerHTML = '<i class="fas fa-file-upload me-1"></i> Upload file';
                // Reset upload mode
                document.getElementById('session-modal').dataset.uploadMode = 'false';
                _resetUploadCard();
            }
        };
        
        // Load sessions
        await _loadSessionList();
        
        // Show modal and focus search field
        _sessionModal.show();
        
        // Set focus to search field when modal is fully shown
        $('#session-modal').on('shown.bs.modal', function() {
            document.getElementById('session-search').focus();
        });
    }
    
    /**
     * Load the list of saved sessions with improved UI
     * @private
     */
    async function _loadSessionList() {
        const sessionGrid = document.getElementById('session-grid');
        sessionGrid.innerHTML = `
            <div class="no-sessions-message">
                <div class="spinner-border spinner-border-sm text-primary me-2" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                Loading panel sets...
            </div>
        `;
        
        try {
            const sessions = await SessionManager.listSessions();
            
            if (sessions && sessions.length > 0) {
                // Save the current search term if any
                const searchInput = document.getElementById('session-search');
                const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
                
                sessionGrid.innerHTML = '';
                
                // Create cards for each session
                sessions.forEach(session => {
                    const card = document.createElement('div');
                    // We no longer include autosave in the session list, but keep logic for backward compatibility
                    const isAutosave = session.isAutosave === true;
                    
                    // Apply standard class (since no autosave entries are included anymore)
                    card.className = 'session-card';
                    card.dataset.sessionName = session.name;
                    card.dataset.isAutosave = isAutosave;
                    // Names, dataset labels and owners come from files any user
                    // can upload; escape before they reach innerHTML.
                    const safeName = escapeHtml(session.name);
                    const locked = !isAutosave && !canModify(session);
                    const lockText = locked ? lockReason(session) : '';
                    
                    // Format date nicely
                    let dateObj = new Date(session.timestamp);
                    const dateStr = dateObj.toLocaleDateString();
                    const timeStr = dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                    
                    // Determine dataset display
                    const datasetDisplay = escapeHtml(session.datasetName || 
                                           (session.dataset ? session.dataset.split('/').pop() : 'Unknown dataset'));
                    
                    // Prepare title with autosave badge if needed
                    const titleHTML = isAutosave ? 
                        `${safeName} <span class="autosave-indicator"><i class="fas fa-sync-alt me-1"></i> Auto</span>` : 
                        safeName;
                    
                    // Format last saved time for autosave
                    const autosaveTimeInfo = isAutosave ?
                        `<div class="autosave-time">Last saved: ${timeStr} on ${dateStr}</div>` : '';
                    
                    // Determine storage location for display
                    const storageInfo = isAutosave ? 
                        '<div class="browser-storage-indicator"><i class="fas fa-laptop"></i> Stored in browser</div>' : 
                        '';
                    
                    // The autosave has one Restore button; a saved set has the Load
                    // buttons (panelset-load-ui.js), drawn below
                    const footerButtons = isAutosave ?
                        `<button class="btn btn-sm btn-info session-restore" title="Restore this autosaved session">
                            <i class="fas fa-history me-1"></i> Restore
                        </button>` : '';
                    
                    // Create panel preview icons based on session data
                    // Panel configurations might not be included in the session list API
                    // We'll add a placeholder that will be populated asynchronously
                    
                    let panelPreview = `<div class="session-card-preview" data-session-name="${safeName}">
                        <div class="panel-preview-loading">
                            <i class="fas fa-spinner fa-pulse"></i>
                        </div>
                    </div>`;

                    card.innerHTML = `
                        <div class="session-card-header">
                            <h5 class="session-card-title">${titleHTML}</h5>
                            <div class="session-card-dataset"><span class="session-card-subtitle">${datasetDisplay}</span></div>
                            <div class="session-card-actions">
                                ${isAutosave ? '' : `<button class="btn btn-sm btn-outline-secondary session-export session-action-button" title="Export this panel set as a file" aria-label="Export">
                                    <i class="fas fa-download"></i>
                                </button>`}
                                ${locked ? `
                                <span class="session-lock session-action-button" title="${escapeHtml(lockText)}" aria-label="${escapeHtml(lockText)}">
                                    <i class="fas fa-lock"></i>
                                </span>` : `
                                <button class="btn btn-sm btn-outline-danger session-delete session-action-button" title="Delete">
                                    <i class="fas fa-trash-alt"></i>
                                </button>`}
                            </div>
                        </div>
                        ${panelPreview}
                        ${storageInfo}
                        ${autosaveTimeInfo}
                        ${!isAutosave ? `
                        <div class="session-card-date">
                            <i class="far fa-calendar-alt"></i> ${dateStr} ${timeStr}
                            ${session.owner ? `<span class="session-card-owner"><i class="far fa-user"></i> ${escapeHtml(session.owner)}</span>` : ''}
                        </div>
                        ` : ''}
                        <div class="session-card-footer">
                            ${footerButtons}
                        </div>
                    `;
                    
                    sessionGrid.appendChild(card);
                    if (!isAutosave) _addLoadButtons(card, session.name);
                });
                
                // Asynchronously load panel previews for all sessions
                _loadAllSessionPreviews(sessions);
                
                // Add delete button handlers
                document.querySelectorAll('.session-delete').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const card = e.target.closest('.session-card');
                        const sessionName = card.dataset.sessionName;
                        const isAutosave = card.dataset.isAutosave === 'true';
                        
                        const confirmMsg = isAutosave ? 
                            `Delete autosaved session? This will remove it from browser storage.` : 
                            `Delete panel set "${sessionName}"?`;
                        
                        if (confirm(confirmMsg)) {
                            if (isAutosave) {
                                // Delete from localStorage
                                SessionManager.clearAutosave();
                                card.remove();
                                if (sessionGrid.children.length === 0) {
                                    sessionGrid.innerHTML = `
                                        <div class="no-sessions-message">
                                            No saved panel sets found
                                        </div>
                                    `;
                                }
                            } else {
                                // Delete from server
                                const result = await SessionManager.deleteSession(sessionName);
                                if (result.status === 'success') {
                                    card.remove();
                                    if (sessionGrid.children.length === 0) {
                                        sessionGrid.innerHTML = `
                                            <div class="no-sessions-message">
                                                No saved panel sets found
                                            </div>
                                        `;
                                    }
                                } else {
                                    const { title, type } = describeFailure(result, 'Failed to delete panel set');
                                    _showNotification(title, result.message, type);
                                }
                            }
                        }
                    });
                });
                
                // Add export button handlers
                document.querySelectorAll('.session-export').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const card = e.target.closest('.session-card');
                        const sessionName = card.dataset.sessionName;
                        SessionManager.exportSession(sessionName);
                    });
                });
                
                // Add restore button handlers for autosave sessions
                document.querySelectorAll('.session-restore').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const card = e.target.closest('.session-card');
                        const sessionName = card.dataset.sessionName;
                        
                        // Load the autosave session
                        const result = await SessionManager.loadSession(sessionName);
                        
                        if (result.status === 'success') {
                            _sessionModal.hide();
                            _showSuccess('Autosave Restored', 'Your autosaved panel configuration has been restored');
                        } else {
                            _showNotification('Failed to restore autosave', result.message, 'error');
                        }
                    });
                });
                
                // Apply search filter if there's an active search
                if (searchTerm) {
                    // Let's simulate the search input event to apply filters
                    searchInput.dispatchEvent(new Event('input'));
                }
                
                // We don't auto-select the autosave card anymore
                // But we'll make sure it's visible
                const autosaveCard = document.querySelector('.session-card.autosave');
                if (autosaveCard) {
                    // Just make sure it's in view without selecting
                    autosaveCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            } else {
                sessionGrid.innerHTML = `
                    <div class="no-sessions-message">
                        No saved panel sets found
                    </div>
                `;
            }
        } catch (error) {
            console.error('Error loading panel sets:', error);
            sessionGrid.innerHTML = `
                <div class="no-sessions-message text-danger">
                    <i class="fas fa-exclamation-triangle me-2"></i>
                    Error loading panel sets: ${error.message}
                </div>
            `;
        }
    }
    
    /**
     * Draw a saved set's Load buttons and dataset badge on its card, then
     * fill them in once the set is fetched and its dataset located.
     * @private
     */
    function _addLoadButtons(card, name) {
        const badge = createDatasetBadge();
        card.querySelector('.session-card-dataset').appendChild(badge.el);
        const actions = createLoadActions({
            getCurrent: SessionManager.getCurrentDatasetInfo,
            onLoad: async (mode) => {
                actions.setBusy(true);
                try {
                    await _runLoad(() => SessionManager.loadSession(name, { mode }));
                } finally {
                    actions.setBusy(false);
                }
            }
        });
        card.querySelector('.session-card-footer').appendChild(actions.el);
        const status = SessionManager.getPanelSetStatus(name).then(st => {
            if (!card.isConnected) return;
            actions.update(st);
            badge.update(st);
        });
        actions.setReady(status);
    }

    /**
     * Run a load started from the Load dialog and say how it went: the dialog
     * closes on success (or when the set opened without data, which has its
     * own notice); a refusal is a notice.
     * @private
     */
    async function _runLoad(load) {
        const result = await load();
        if (result.status === 'success' || result.status === 'no-data') {
            _sessionModal.hide();
        } else if (result.status === 'cancelled') {
            // the user closed the dataset picker: nothing to report
            if (!/No dataset chosen/.test(result.message || '')) {
                _showNotification('Panel set not loaded', result.message, 'info', 5000);
            }
        } else {
            _showNotification('Failed to load panel set', result.message, 'error');
        }
        return result;
    }

    /**
     * Show or hide the "?" in the dialog's header (the Load dialog only). Its
     * popover is drawn here, not by Bootstrap's: hovering the "?" shows it, a
     * click pins it (another click, the Esc key or closing the dialog hides it).
     * @private
     */
    function _setLoadHelp(show) {
        const button = document.getElementById('session-help-btn');
        if (!button) return;
        button.hidden = !show;
        let pop = document.getElementById('session-help-pop');
        if (!show) { if (pop) pop.hidden = true; return; }
        if (pop) return;
        const host = document.querySelector('#session-modal .modal-content');
        pop = document.createElement('div');
        pop.id = 'session-help-pop';
        pop.className = 'popover bs-popover-auto load-help-popover';
        pop.setAttribute('role', 'tooltip');
        pop.hidden = true;
        const head = document.createElement('h3');
        head.className = 'popover-header';
        head.textContent = 'What the Load buttons do';
        const body = document.createElement('div');
        body.className = 'popover-body';
        body.appendChild(helpContent());
        pop.append(head, body);
        host.appendChild(pop);
        let pinned = false;
        const place = () => {
            const box = host.getBoundingClientRect();
            const at = button.getBoundingClientRect();
            pop.style.left = `${Math.max(8, at.left - box.left - 16)}px`;
            pop.style.top = `${at.bottom - box.top + 8}px`;
        };
        const open = () => { place(); pop.hidden = false; };
        const close = () => { if (!pinned) pop.hidden = true; };
        button.addEventListener('mouseenter', open);
        button.addEventListener('focus', open);
        button.addEventListener('mouseleave', close);
        button.addEventListener('blur', close);
        button.addEventListener('click', () => {
            pinned = !pinned;
            button.setAttribute('aria-pressed', String(pinned));
            if (pinned) open(); else pop.hidden = true;
        });
        const reset = () => {
            pinned = false;
            button.setAttribute('aria-pressed', 'false');
            pop.hidden = true;
        };
        document.getElementById('session-modal').addEventListener('hidden.bs.modal', reset);
        document.getElementById('session-modal').addEventListener('hide.bs.modal', clearTips);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) reset(); });
    }

    /**
     * The card of a chosen file in the Load dialog's upload view: the same
     * buttons as a saved set's. The file is read here for its dataset and
     * panels; it is imported (and then loaded) when a button is used.
     * @private
     */
    async function _showUploadCard(file) {
        const host = document.getElementById('upload-card');
        host.hidden = false;
        host.innerHTML = '';
        const data = await file.text().then(text => JSON.parse(text)).catch(() => null);
        const st = data ? await SessionManager.getPanelSetStatus(data) : null;
        host.innerHTML = '';
        const title = document.createElement('h5');
        title.className = 'session-card-title';
        title.textContent = file.name;
        host.appendChild(title);
        if (!st) {
            const bad = document.createElement('div');
            bad.className = 'small text-danger mt-1';
            bad.textContent = 'This file is not a panel set that AnnZarro can read.';
            host.appendChild(bad);
            return;
        }
        const dataset = document.createElement('div');
        dataset.className = 'session-card-dataset';
        const label = document.createElement('span');
        label.className = 'session-card-subtitle';
        label.textContent = (data.datasetName || (data.dataset ? String(data.dataset).split('/').pop() : '')) || 'no dataset named';
        const badge = createDatasetBadge();
        dataset.append(label, badge.el);
        host.appendChild(dataset);
        const actions = createLoadActions({
            getCurrent: SessionManager.getCurrentDatasetInfo,
            onLoad: async (mode) => {
                actions.setBusy(true);
                try {
                    const imported = await SessionManager.importSession(file);
                    if (imported.status !== 'success') {
                        const { title: t, type } = describeFailure(imported, 'Failed to import panel set');
                        _showNotification(t, imported.message, type);
                        return;
                    }
                    const result = await _runLoad(() => SessionManager.loadSession(imported.name, { mode }));
                    if (result.status === 'success' && Date.now() - _viewNoticeAt > 5000 && mode !== 'add') {
                        _showSuccess('Session Loaded', 'Panel set was imported and loaded successfully.');
                    }
                } catch (error) {
                    _showNotification('Error', error.message, 'error');
                } finally {
                    actions.setBusy(false);
                }
            }
        });
        host.appendChild(actions.el);
        actions.update(st);
        badge.update(st);
    }

    function _resetUploadCard() {
        const host = document.getElementById('upload-card');
        if (host) { host.hidden = true; host.innerHTML = ''; }
    }

    /**
     * Load panel previews for all sessions asynchronously
     * @param {Array} sessions - List of session objects
     * @private
     */
    async function _loadAllSessionPreviews(sessions) {
        
        // Process sessions in batches to avoid overwhelming the server
        const BATCH_SIZE = 10;
        const sessionsCopy = [...sessions];
        
        // Function to update preview for a single session
        async function updatePreview(session) {
            try {
                // If the session already has panel configs, just use them
                if (session.panelConfigs) {
                    _updatePanelPreview(session);
                    return;
                }
                
                // For autosave, use loadFromLocalStorage
                if (session.isAutosave) {
                    const autosaveData = SessionManager.loadFromLocalStorage();
                    if (autosaveData && autosaveData.panelConfigs) {
                        session.panelConfigs = autosaveData.panelConfigs;
                        _updatePanelPreview(session);
                    }
                } else {
                    // Fetch session data from the server (shared with the card's status)
                    const sessionData = await SessionManager.fetchPanelSet(session.name);
                    if (sessionData && sessionData.panelConfigs) {
                        session.panelConfigs = sessionData.panelConfigs;
                        _updatePanelPreview(session);
                    }
                }
            } catch (error) {
                console.error(`Error loading preview for session ${session.name}:`, error);
                // Update the UI to show error
                _updateErrorPreview(session);
            }
        }
        
        // Process sessions in batches
        while (sessionsCopy.length > 0) {
            const batch = sessionsCopy.splice(0, BATCH_SIZE);
            await Promise.all(batch.map(session => updatePreview(session)));
            
            // Small delay between batches to avoid overloading
            if (sessionsCopy.length > 0) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
    }
    
    /**
     * Update the panel preview UI based on session data
     * @param {Object} session - Session object with panelConfigs
     * @private
     */
    function _updatePanelPreview(session) {
        // Find all preview containers for this session
        const previewContainers = document.querySelectorAll(`.session-card-preview[data-session-name="${session.name}"]`);
        
        if (!previewContainers.length) return;
        
        // Get icons for panel types
        const typeIcons = {};
        Config.PANEL_TYPES.forEach(pt => {
            typeIcons[pt.type] = pt.icon;
        });
        
        if (session.panelConfigs) {
            const panelConfigs = Object.values(session.panelConfigs)
                .filter(panel => !panel.isSelectionTile);
            
            if (panelConfigs.length > 0) {
                // Calculate how many icons to show
                const maxIcons = 7; // Reasonable number that should fit in the card 
                const visibleIcons = Math.min(panelConfigs.length, maxIcons);
                const hasMore = panelConfigs.length > maxIcons;
                
                // Create the panel preview HTML
                let previewHTML = '';
                
                // Add the visible icons
                for (let i = 0; i < visibleIcons; i++) {
                    const panel = panelConfigs[i];
                    const icon = typeIcons[panel.type] || 'fas fa-window-maximize';
                    previewHTML += `<i class="${icon}" title="${panel.title || panel.type}"></i>`;
                }
                
                // Add the +N indicator if there are more panels
                if (hasMore) {
                    const moreCount = panelConfigs.length - maxIcons;
                    previewHTML += `<span class="panel-preview-more">+${moreCount}</span>`;
                }
                
                // Update all preview containers
                previewContainers.forEach(container => {
                    container.innerHTML = previewHTML;
                });
            } else {
                // No panels in config
                previewContainers.forEach(container => {
                    container.innerHTML = `<div class="panel-preview-empty">No panels</div>`;
                });
            }
        } else {
            // No panel config available
            previewContainers.forEach(container => {
                container.innerHTML = `<div class="panel-preview-empty">No panel info</div>`;
            });
        }
    }
    
    /**
     * Update the panel preview UI to show an error
     * @param {Object} session - Session object
     * @private
     */
    function _updateErrorPreview(session) {
        const previewContainers = document.querySelectorAll(`.session-card-preview[data-session-name="${session.name}"]`);
        
        if (!previewContainers.length) return;
        
        previewContainers.forEach(container => {
            container.innerHTML = `<div class="panel-preview-error">Error loading preview</div>`;
        });
    }
    
    /**
     * Sanitize session name by removing special characters and replacing spaces with underscores
     * @param {string} name - The raw session name
     * @returns {string} - Sanitized session name
     * @private
     */
    function _sanitizeSessionName(name) {
        // Replace spaces with underscores and remove special characters
        return name.trim()
            .replace(/\s+/g, '_')
            .replace(/[^\w\\-]/g, '');
    }
    
    /**
     * Handle session modal confirm button click
     * @private
     */
    async function _handleSessionModalConfirm() {
        const modalType = document.getElementById('session-modal').dataset.modalType;
        
        if (modalType === 'save') {
            // Handle save session
            const sessionNameInput = document.getElementById('session-name');
            let sessionName = sessionNameInput.value.trim();
            
            if (!sessionName) {
                _invalid(sessionNameInput, 'Enter a panel set name');
                return;
            }
            
            // Sanitize the session name
            const sanitizedName = _sanitizeSessionName(sessionName);
            
            // Check for name collision
            const sessions = await SessionManager.listSessions();
            const existingNames = new Set(sessions.map(s => s.name.toLowerCase()));
            const existing = sessions.find(s => !s.isAutosave && s.name.toLowerCase() === sanitizedName.toLowerCase());
            
            if (existing && !canModify(existing)) {
                // The server would refuse the overwrite; say so before asking
                // anything, and leave the dialog open so a new name can be typed.
                _showNotification('Choose another name', `"${sanitizedName}": ${lockReason(existing)}`, 'warning');
                return;
            }
            
            if (existingNames.has(sanitizedName.toLowerCase())) {
                // If name collision, ask for confirmation
                if (!confirm(`A panel set with the name "${sanitizedName}" already exists. Do you want to overwrite it?`)) {
                    return;
                }
            }
            
            const result = await SessionManager.saveSession(sanitizedName);
            
            if (result.status === 'success') {
                _sessionModal.hide();
                if (result.fingerprintPending) _noticeFingerprintPending();
                //_showSuccess('Panel Set saved', `Panel Set "${sanitizedName}" saved successfully`);
            } else {
                const { title, type } = describeFailure(result, 'Failed to save panel set');
                _showNotification(title, result.message, type);
            }
        }
        // (the Load dialog has no confirm button: each card's own buttons load)
    }
    
    /**
     * Fill the header badge from `auth/me`: the signed-in user (a logout
     * link), or a warning when the server is on the network without login.
     * Silent on failure -- an older server simply has no such endpoint.
     * @private
     */
    // What Refresh may do for this user (utils/session-permissions.js refreshPlan);
    // until auth/me answers, try the server reset and tolerate a refusal
    let _refreshPlan = refreshPlan(null);

    async function _loadAuthIndicator() {
        const el = document.getElementById('auth-indicator');
        if (!el) return;
        try {
            const response = await fetch(Config.API.AUTH_ME);
            if (!response.ok) return;
            const me = await response.json();
            _refreshPlan = refreshPlan(me);
            const refreshBtn = document.getElementById('refresh-dataset');
            if (refreshBtn) refreshBtn.title = _refreshPlan.title;
            const badge = authIndicator(me);
            if (!badge) return;
            el.textContent = badge.text;
            el.title = badge.title;
            el.classList.add(`auth-indicator--${badge.variant}`);
            if (badge.href) el.href = badge.href;
            el.hidden = false;
        } catch (error) {
            console.warn('Could not load sign-in status:', error);
        }
    }
    
    /**
     * Show success message
     * @param {string} title - Success message title
     * @param {string} message - Success message
     * @private
     */
    function _showSuccess(title, message) {
        // Use the notification system instead of alert
        console.log(`Success: ${title} - ${message}`);
        _showNotification(title, message, 'success');
    }
    
    /**
     * Show error message
     * @param {string} title - Error message title
     * @param {string} message - Error message
     * @private
     */
    function _showError(title, message) {
        // Use the notification system instead of alert
        console.error(`Error: ${title} - ${message}`);
        _showNotification(title, message, 'error');
    }
    
    // Map to track active notification timers by ID
    const _notificationTimers = new Map();
    
    // Counter for generating unique notification IDs
    let _notificationCounter = 0;
    
    /**
     * Show a toast: the outcome of something the user did (a link copied, a
     * panel set saved, an export that failed). Persistent state -- what a
     * panel does not show, a mode it is in -- belongs in the panel's status
     * strip (utils/panel-surface.js), never here.
     *
     * One at a time: a new toast replaces the one shown, and the same toast
     * again only restarts its timer. Errors stay until closed.
     * @param {string} title - Notification title
     * @param {string} message - Notification message
     * @param {string} type - Notification type ('error', 'warning', 'info', 'success')
     * @param {number} [duration] - How long to show it (ms); default 4 s for
     *   success, 8 s for info and warning, until closed for an error
     * @private
     */
    function _showNotification(title, message, type = 'info', duration = undefined) {
        console.log(`Notification (${type}): ${title} - ${message}`);
        if (duration === undefined) duration = type === 'error' ? 0 : type === 'success' ? 4000 : 8000;

        // Create container if it doesn't exist (thread-safe)
        let container = document.getElementById('notification-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'notification-container';
            container.setAttribute('role', 'status');
            container.setAttribute('aria-live', 'polite');
            document.body.appendChild(container);
        }

        // The toast shown now (a question asked by _askNotification waits for
        // its answer and is not replaced)
        const current = [...container.children].find(el =>
            el.classList.contains('notification') && !el.classList.contains('notification-ask'));
        if (current && current.dataset.key === JSON.stringify([title, message, type])) {
            _armNotification(current.id, duration);
            return current.id;
        }
        if (current) _dropNotification(current.id);

        // Generate a unique ID for this notification
        const notificationId = `notification-${Date.now()}-${_notificationCounter++}`;

        // Create the notification element
        const notification = document.createElement('div');
        notification.id = notificationId;
        notification.className = `notification notification-${type}`;
        notification.dataset.key = JSON.stringify([title, message, type]);
        if (type === 'error') notification.setAttribute('role', 'alert');
        
        // Add close button
        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '&times;';
        closeBtn.className = 'notification-close';
        closeBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            _removeNotification(notificationId);
        };
        
        // Add title and message
        const titleEl = document.createElement('div');
        titleEl.textContent = title;
        titleEl.className = 'notification-title';
        
        const messageEl = document.createElement('div');
        messageEl.textContent = message;
        messageEl.className = 'notification-message';
        
        // Assemble the notification
        notification.appendChild(closeBtn);
        notification.appendChild(titleEl);
        notification.appendChild(messageEl);
        
        // Add to container
        container.appendChild(notification);
        
        // Fade in - use requestAnimationFrame for better performance
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                notification.style.opacity = '1';
            });
        });
        
        _armNotification(notificationId, duration);
        return notificationId;
    }

    /** (Re)start the timer that removes a toast; 0 keeps it until closed. */
    function _armNotification(notificationId, duration) {
        if (_notificationTimers.has(notificationId)) {
            clearTimeout(_notificationTimers.get(notificationId));
            _notificationTimers.delete(notificationId);
        }
        if (duration > 0) {
            _notificationTimers.set(notificationId, setTimeout(() => _removeNotification(notificationId), duration));
        }
    }

    /** Take a toast away at once, without its fade: the next one replaces it. */
    function _dropNotification(notificationId) {
        if (_notificationTimers.has(notificationId)) {
            clearTimeout(_notificationTimers.get(notificationId));
            _notificationTimers.delete(notificationId);
        }
        const el = document.getElementById(notificationId);
        if (el) el.remove();
    }
    
    /**
     * Removes a notification with proper animation and cleanup
     * @param {string} notificationId - The ID of the notification to remove 
     * @private
     */
    function _removeNotification(notificationId) {
        const notification = document.getElementById(notificationId);
        if (!notification) return;
        
        // Clear any existing timer
        if (_notificationTimers.has(notificationId)) {
            clearTimeout(_notificationTimers.get(notificationId));
            _notificationTimers.delete(notificationId);
        }
        
        // Start the fade out
        notification.style.opacity = '0';
        
        // Remove after animation completes
        const removeTimer = setTimeout(() => {
            try {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            } catch (e) {
                // Already removed, ignore
            }
        }, 300);
        
        // Store the remove timer
        _notificationTimers.set(`${notificationId}-remove`, removeTimer);
    }
    
    // Track if error handlers have been set up
    let _errorHandlersInitialized = false;
    
    /**
     * Setup custom event handlers for error management
     * Ensures handlers are only registered once to prevent duplicates
     * @private
     */
    function _setupErrorHandlers() {
        // Prevent adding duplicate event listeners
        if (_errorHandlersInitialized) return;
        
        // We've removed the datasetLoadError event listener since errors are now
        // handled directly in the _loadDataset function
        
        // Note: We removed the dataFetchError listener to avoid duplicate error messages
        // since errors are already handled in the _loadDataset function
        
        // Mark as initialized to prevent duplicate registrations
        _errorHandlersInitialized = true;
    }
    
    /**
     * Show a modal with keyboard shortcuts help
     * @private
     */
    function _showKeyboardShortcutsHelp() {
        // Create the modal if it doesn't exist, or show it if it does
        let modal = document.getElementById('keyboard-shortcuts-modal');
        
        // Format shortcut configuration to display format
        function formatShortcut(shortcutConfig) {
            const parts = [];
            
            if (shortcutConfig.modifiers.ctrl) parts.push('Ctrl');
            if (shortcutConfig.modifiers.alt) parts.push('Alt');
            if (shortcutConfig.modifiers.shift) parts.push('Shift');
            if (shortcutConfig.modifiers.meta) parts.push('⌘');
            
            // Add the key at the end (capitalized for special keys)
            parts.push(shortcutConfig.key.length === 1 ? 
                shortcutConfig.key.toUpperCase() : 
                shortcutConfig.key);
            
            return parts.join('+');
        }
        
        // Generate table rows for all keyboard shortcuts
        function generateShortcutTableRows() {
            const shortcuts = Config.KEYBOARD_SHORTCUTS;
            const rows = [];
            
            // Mapping of shortcut names to descriptions
            const descriptions = {
                'SAVE_SESSION': 'Save panel set',
                'LOAD_SESSION': 'Open/load panel set',
                'REFRESH_DATASETS': 'Refresh datasets',
                'NEW_PANEL': 'New panel (focus panel selector)',
                'CLOSE_PANEL': 'Close current panel',
                'SPLIT_HORIZONTAL': 'Split current panel horizontally',
                'SPLIT_VERTICAL': 'Split current panel vertically',
                'TOGGLE_CONTROLS': 'Toggle current panel controls',
                'SHOW_HELP': 'Show this help',
                'CLOSE_MODAL': 'Close modal dialogs'
            };
            
            // Determine if we should format macOS style
            const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
            
            // Skip BROWSER_COMPATIBLE which is a setting, not a shortcut
            Object.entries(shortcuts).forEach(([name, config]) => {
                if (name === 'BROWSER_COMPATIBLE') return;
                
                const description = descriptions[name] || name.replace(/_/g, ' ').toLowerCase();
                let formattedShortcut = formatShortcut(config);
                
                // In desktop mode, we can add Ctrl keys for single-key shortcuts
                if (!shortcuts.BROWSER_COMPATIBLE && Object.keys(config.modifiers).length === 0) {
                    // Add Ctrl+ version for desktop mode only if this is a single key shortcut
                    const desktopShortcuts = ['NEW_PANEL', 'CLOSE_PANEL', 'SPLIT_HORIZONTAL', 'SPLIT_VERTICAL', 'TOGGLE_CONTROLS'];
                    if (desktopShortcuts.includes(name)) {
                        // Create a desktop version with Ctrl
                        let desktopConfig = JSON.parse(JSON.stringify(config));
                        desktopConfig.modifiers.ctrl = true;
                        
                        // Add the desktop shortcut as an alternative
                        rows.push(`
                            <tr>
                                <td><kbd>${formatShortcut(config)}</kbd> or <kbd>${formatShortcut(desktopConfig)}</kbd></td>
                                <td>${description}</td>
                            </tr>
                        `);
                        
                        // Skip adding the regular entry later
                        return;
                    }
                }
                
                // Format according to platform when displaying Ctrl or ⌘
                if (isMac && formattedShortcut.includes('Ctrl')) {
                    formattedShortcut = formattedShortcut.replace('Ctrl', '⌘');
                }
                
                rows.push(`
                    <tr>
                        <td><kbd>${formattedShortcut}</kbd></td>
                        <td>${description}</td>
                    </tr>
                `);
            });
            
            return rows.join('');
        }
        
        if (!modal) {
            // Create the modal element
            modal = document.createElement('div');
            modal.id = 'keyboard-shortcuts-modal';
            modal.className = 'modal fade';
            modal.tabIndex = -1;
            modal.setAttribute('aria-labelledby', 'keyboard-shortcuts-modal-title');
            modal.setAttribute('aria-hidden', 'true');
            
            // Modal HTML content
            modal.innerHTML = `
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="keyboard-shortcuts-modal-title">Keyboard Shortcuts</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <p>AnnZarro supports the following keyboard shortcuts to improve your workflow:</p>
                            <table class="table table-striped">
                                <thead>
                                    <tr>
                                        <th>Shortcut</th>
                                        <th>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${generateShortcutTableRows()}
                                </tbody>
                            </table>
                            <div class="platform-note">
                                <p>On Mac, use <kbd>⌘</kbd> (Command) instead of <kbd>Ctrl</kbd> for the key combinations shown with Ctrl.</p>
                                <p>Single-key shortcuts (n, w, h, v, c) only work when no text input field is in focus.</p>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-primary" data-bs-dismiss="modal">Close</button>
                        </div>
                    </div>
                </div>
            `;
            
            // Add CSS for the keyboard shortcuts modal
            const style = document.createElement('style');
            style.textContent = `
                .cmd-key {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    font-weight: normal;
                }
                
                #keyboard-shortcuts-modal .table {
                    margin-top: 1rem;
                }
                
                #keyboard-shortcuts-modal kbd {
                    background-color: #f7f7f7;
                    border: 1px solid #ccc;
                    border-radius: 3px;
                    box-shadow: 0 1px 0 rgba(0,0,0,0.2);
                    color: #333;
                    display: inline-block;
                    font-size: 0.85em;
                    font-weight: 700;
                    line-height: 1;
                    padding: 0.2em 0.4em;
                    white-space: nowrap;
                }
                
                #keyboard-shortcuts-modal .platform-note {
                    background-color: #f8f9fa;
                    border-left: 4px solid #6c757d;
                    padding: 0.75rem;
                    margin-top: 1rem;
                    font-size: 0.9em;
                }
            `;
            document.head.appendChild(style);
            
            // Add to document
            document.body.appendChild(modal);
            
            // Initialize Bootstrap modal
            new bootstrap.Modal(modal);
        }
        
        // Show the modal
        const modalInstance = bootstrap.Modal.getInstance(modal) || new bootstrap.Modal(modal);
        modalInstance.show();
    }
    
    /**
     * Load available sessions
     * @private
     */
    async function _loadSessions() {
        try {
            return await SessionManager.listSessions();
        } catch (error) {
            console.error('Error loading panel sets:', error);
            return [];
        }
    }
    
    
    /**
     * Initialize keyboard shortcut handlers
     * @private
     */
    function _initKeyboardShortcuts() {
        // Helper function to trigger an action on the most centered panel
        function _triggerActionOnFocusedPanel(buttonClass) {
            // Find panels that are currently visible in the viewport
            const tiles = Array.from(document.querySelectorAll('.tile:not(.tile-selector)'));
            if (tiles.length === 0) return;
            
            // Get the tile that's most centered in the viewport
            const viewportHeight = window.innerHeight;
            const viewportCenter = viewportHeight / 2;
            
            let closestTile = null;
            let closestDistance = Infinity;
            
            tiles.forEach(tile => {
                const rect = tile.getBoundingClientRect();
                const tileCenter = rect.top + rect.height / 2;
                const distance = Math.abs(tileCenter - viewportCenter);
                
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestTile = tile;
                }
            });
            
            if (closestTile) {
                // Find and click the specific button
                const button = closestTile.querySelector(`.${buttonClass}`);
                if (button) {
                    button.click();
                }
            }
        }

        // Helper function to check if a keyboard event matches a shortcut configuration
        function matchesShortcut(event, shortcutConfig) {
            // Check key match first (case-insensitive)
            if (event.key.toLowerCase() !== shortcutConfig.key.toLowerCase()) {
                return false;
            }
            
            // Get all modifiers from the event
            const hasModifiers = event.ctrlKey || event.altKey || event.shiftKey || event.metaKey;
            
            // Special case: if no modifiers in config, ensure no modifiers in event
            // This handles single-key shortcuts like 'n', 'w', etc.
            if (Object.keys(shortcutConfig.modifiers).length === 0) {
                return !hasModifiers;
            }
            
            // MacOS uses Command key (metaKey) for most shortcuts
            const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
            
            // Check for Ctrl/Command key (treat them interchangeably on Mac)
            if (shortcutConfig.modifiers.ctrl) {
                // On Mac, treat either Ctrl or Command as matching Ctrl
                if (isMac) {
                    if (!event.ctrlKey && !event.metaKey) return false;
                } else {
                    if (!event.ctrlKey) return false;
                }
            } else if (!shortcutConfig.modifiers.meta) {
                // If Ctrl is not required (and Meta is not explicitly required),
                // ensure Ctrl/Cmd are not pressed (for single key or Alt+key shortcuts)
                if (isMac) {
                    if (event.ctrlKey || event.metaKey) return false;
                } else {
                    if (event.ctrlKey) return false;
                }
            }
            
            // Check other modifiers
            if (shortcutConfig.modifiers.alt && !event.altKey) return false;
            if (!shortcutConfig.modifiers.alt && event.altKey) return false;
            
            if (shortcutConfig.modifiers.shift && !event.shiftKey) return false;
            if (!shortcutConfig.modifiers.shift && event.shiftKey) return false;
            
            // Special case for Meta key (Command on Mac)
            if (shortcutConfig.modifiers.meta && !event.metaKey) return false;
            if (!shortcutConfig.modifiers.meta && !shortcutConfig.modifiers.ctrl && event.metaKey) return false;
            
            return true;
        }

        document.addEventListener('keydown', (e) => {
            // Skip if user is typing in an input field
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
                return;
            }
            
            const shortcuts = Config.KEYBOARD_SHORTCUTS;
            
            // Save Session
            if (matchesShortcut(e, shortcuts.SAVE_SESSION)) {
                e.preventDefault();
                _showSaveSessionModal();
                return;
            }
            
            // Load Session
            if (matchesShortcut(e, shortcuts.LOAD_SESSION)) {
                e.preventDefault();
                _showLoadSessionModal();
                return;
            }
            
            // Refresh Datasets
            if (matchesShortcut(e, shortcuts.REFRESH_DATASETS)) {
                e.preventDefault();
                const refreshDatasetBtn = document.getElementById('refresh-dataset');
                if (refreshDatasetBtn) {
                    refreshDatasetBtn.click();
                }
                return;
            }
            
            // Show Help
            if (matchesShortcut(e, shortcuts.SHOW_HELP)) {
                e.preventDefault();
                _showKeyboardShortcutsHelp();
                return;
            }
            
            // New Panel
            if (matchesShortcut(e, shortcuts.NEW_PANEL)) {
                e.preventDefault();
                // Create a new selection tile or focus the existing one
                const selectionTiles = document.querySelectorAll('.tile-selector');
                if (selectionTiles.length > 0) {
                    // Focus the first selection tile
                    selectionTiles[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                } else {
                    // Create a new selection tile
                    PanelManager.updateSourcePanelSelection();
                }
                return;
            }
            
            // Close Panel
            if (matchesShortcut(e, shortcuts.CLOSE_PANEL)) {
                e.preventDefault();
                _triggerActionOnFocusedPanel('tile-close');
                return;
            }
            
            // Split Horizontal
            if (matchesShortcut(e, shortcuts.SPLIT_HORIZONTAL)) {
                e.preventDefault();
                _triggerActionOnFocusedPanel('tile-split-h');
                return;
            }
            
            // Split Vertical
            if (matchesShortcut(e, shortcuts.SPLIT_VERTICAL)) {
                e.preventDefault();
                _triggerActionOnFocusedPanel('tile-split-v');
                return;
            }
            
            // Toggle Controls
            if (matchesShortcut(e, shortcuts.TOGGLE_CONTROLS)) {
                e.preventDefault();
                _triggerActionOnFocusedPanel('tile-toggle-controls');
                return;
            }
            
            // Close Modal (Escape)
            if (matchesShortcut(e, shortcuts.CLOSE_MODAL)) {
                // Only handle if there's no modal-specific handler
                if (!document.querySelector('.modal.show .modal-close-btn:focus')) {
                    const openModal = document.querySelector('.modal.show');
                    if (openModal) {
                        // Use Bootstrap's hide method on the modal
                        const modalInstance = bootstrap.Modal.getInstance(openModal);
                        if (modalInstance) {
                            modalInstance.hide();
                        }
                    }
                }
            }
        });
        
        // If in desktop mode, register additional Ctrl+key combinations for common actions
        if (!Config.KEYBOARD_SHORTCUTS.BROWSER_COMPATIBLE) {
            // Add Ctrl+key combinations for desktop/application mode
            const desktopKeys = ['n', 'w', 'h', 'v', 'c'];
            const desktopActions = ['NEW_PANEL', 'CLOSE_PANEL', 'SPLIT_HORIZONTAL', 'SPLIT_VERTICAL', 'TOGGLE_CONTROLS'];
            
            desktopKeys.forEach((key, index) => {
                if (index < desktopActions.length) {
                    // Create desktop versions with Ctrl key
                    Config.KEYBOARD_SHORTCUTS[`${desktopActions[index]}_DESKTOP`] = { 
                        key: key, 
                        modifiers: { ctrl: true } 
                    };
                }
            });
        }
        
        console.log('Keyboard shortcuts initialized');
    }
    
    // Public API
    return {
        init,
        // Encode the current focus + layout into a shareable deep-link URL — the
        // round-trip partner of the deep-link boot path. Exposed for a "copy
        // shareable link" affordance and for end-to-end serialization tests.
        buildShareView: _buildShareView
    };
})();

// Initialize the application when DOM is ready and all scripts are loaded
document.addEventListener('DOMContentLoaded', () => {
    // Start initialization immediately since we're using modules
    App.init();
    // A panel's scroller hands the wheel to the page at its end (utils/wheel-handover.js)
    installWheelHandover(document.getElementById('tile-container'));
    
    // Register for app close events if in Electron environment
    if (window.api && typeof window.api.onWillQuit === 'function') {
        window.api.onWillQuit(async () => {
            console.log('Application closing - triggering final autosave');
            try {
                // Force immediate autosave
                await SessionManager.saveToLocalStorage();
                console.log('Final autosave completed successfully');
            } catch (e) {
                console.error('Error during final autosave:', e);
            }
        });
    }
});

// Export the module
export { App };
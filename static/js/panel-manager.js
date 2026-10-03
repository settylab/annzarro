/**
 * Panel Manager module for AnnZarro
 * Manages the tile-based panel system
 * 
 * This module has been refactored to:
 * 1. Use responsive layouts with flex for better resizing
 * 2. Improve session saving/restoration with proper hierarchy tracking
 * 3. Fix split functionality to correctly handle horizontal/vertical arrangements
 * 4. Reduce code duplication and improve structure
 */
import { LayoutManager } from './layout-manager.js';
import { SelectionTile } from './selection-tile.js';
import { Config } from './config.js';
import { VIEW_SCHEMA_VERSION, panelTypeFromTileId, collectTileIds, serializableConfig } from './utils/deeplink.js';
import { setControlsVisible } from './utils/controls-visibility.js';
import { notifyEach } from './utils/notify-panels.js';

const PanelManager = (function() {
    // Private variables
    const _panels = new Map(); // All panels by ID
    const _panelsByType = new Map(); // Panels by type
    const _activePanels = new Set(); // Currently open panels
    const _panelTypes = new Map(); // Panel types (constructors)
    
    // References to DOM elements
    let _container = null;
    let _welcomeSelectionTile = null;

    // How long the autosave "restoring previous panel set" spinner may stay up
    // before we give up and fall back to the Welcome screen (ms). Generous enough
    // for a legitimate large-session restore, short enough that a stalled restore
    // doesn't strand the user on an infinite spinner.
    const _RESTORE_FALLBACK_MS = 20000;
    
    /**
     * Initialize the panel manager
     * @param {string} containerId - ID of the container element
     * @param {Object} options - Optional configuration options
     * @param {boolean} options.hasAutosave - Whether there's an autosave session
     */
    function init(containerId, options = {}) {
        _container = document.getElementById(containerId);
        
        if (!_container) {
            console.error(`Container element with ID "${containerId}" not found.`);
            return;
        }
        
        // No longer need to initialize counters
        
        // Set up event listener for tableFiltered events to update relevant plots
        document.addEventListener('tableFiltered', (event) => {
            if (event.detail && event.detail.id) {
                const tableId = event.detail.id;
                
                // Find all panels that use this table as a filter
                _activePanels.forEach(panel => {
                    const config = panel.getConfig && panel.getConfig();
                    if (config && config.tableFilter === tableId) {
                        // Call onDataUpdate with tableChanged event type
                        if (panel.onDataUpdate) {
                            panel.onDataUpdate('tableChanged');
                        }
                    }
                });
            }
        });
        
        // Initialize the LayoutManager with a callback to create selection tiles
        LayoutManager.init((parentElement) => {
            new SelectionTile({
                container: parentElement,
                variant: "pane",
                panels: _panels,
                activePanels: _activePanels,
                layoutManager: LayoutManager,
                createPanel: createPanel,
                panelsByType: _panelsByType,
                generateUniqueName: _generateUniqueName
            });
        });
        
        // If there's an autosave session, show a welcome tile with loading indication
        if (options.hasAutosave) {
            _welcomeSelectionTile = new SelectionTile({
                container: _container,
                variant: "welcome",
                showSessions: false,  // Don't show sessions section
                panels: _panels,
                activePanels: _activePanels,
                layoutManager: LayoutManager,
                createPanel: createPanel,
                panelsByType: _panelsByType,
                generateUniqueName: _generateUniqueName,
                sessionManager: window.sessionManager
            });
            
            // Customize the welcome tile to indicate autosave is loading
            const header = _welcomeSelectionTile.tileSelector.querySelector('.tile-selection-header');
            if (header) {
                header.innerHTML = `
                    <h2>Loading Dataset and Autosaved Panels</h2>
                    <p><div class="spinner-border spinner-border-sm text-primary me-2" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div> Your previous panel set is being restored...</p>
                `;
            }

            // Safety net: a restore that never resolves (stalled fetch, a swallowed
            // error, or a corrupt autosave that opens nothing) must not pin this
            // spinner forever. After a generous window, fall back to the Welcome
            // screen if still nothing has opened. ensureWelcomeFallback is a no-op
            // once any panel exists, so a normal restore is unaffected.
            setTimeout(() => ensureWelcomeFallback(), _RESTORE_FALLBACK_MS);
        }
        // Otherwise show the standard welcome tile
        else {
            _welcomeSelectionTile = new SelectionTile({
                container: _container,
                variant: "welcome",
                showSessions: true,
                panels: _panels,
                activePanels: _activePanels,
                layoutManager: LayoutManager,
                createPanel: createPanel,
                panelsByType: _panelsByType,
                generateUniqueName: _generateUniqueName,
                sessionManager: window.sessionManager
            });
        }
    }
    
    /**
     * Register a panel type
     * @param {string} type - Panel type identifier
     * @param {Function} constructor - Panel constructor function
     */
    function registerPanelType(type, constructor) {
        _panelTypes.set(type, constructor);
        _panelsByType.set(type, new Set());
        
        // No longer need to initialize counters
    }
    
    
    
    /**
     * Generate a unique name to avoid collisions
     * @param {string} baseName - Original name
     * @param {string} [type] - Optional type for more specific naming
     * @returns {string} - Unique name
     * @private
     */
    function _generateUniqueName(baseName, type = null) {
        if (!baseName) {
            baseName = (type ? `${_formatPanelType(type)} 1` : 'Panel 1');
        }
        const existingNames = new Set();
        _panels.forEach(panel => {
            existingNames.add(panel.getTitle());
        });
        
        // If the base name doesn't exist, use it
        if (!existingNames.has(baseName)) {
            return baseName;
        }
        
        // Check if the base name ends with a number
        const match = baseName.match(/^(.*?)\s*(\d+)$/);
        let counter = 1;
        let cleanBaseName = baseName;

        if (match) {
            cleanBaseName = match[1].trim(); // Extract the base name without the number and trim
            counter = parseInt(match[2], 10); // Use the extracted number as the starting counter
        }
        let newName = `${cleanBaseName} ${counter}`;
        
        while (existingNames.has(newName)) {
            counter++;
            newName = `${cleanBaseName} ${counter}`;
        }
        
        return newName;
    }
    
    
    /**
     * Create a new panel
     * @param {string} type - Panel type
     * @param {Object} config - Optional configuration
     * @param {HTMLElement} [targetContainer] - Optional container to place the panel in
     * @returns {Object} - The created panel instance
     */
    function createPanel(type, config = {}, targetContainer = null) {
        if (!_panelTypes.has(type)) {
            console.error(`Unknown panel type: ${type}`);
            return null;
        }
        
        // Generate a unique ID for the panel
        // If config.id is provided:
        //   - If it's from a reopened panel, use it exactly as is to maintain references
        //   - Otherwise, generate a new ID based on current time
        let id;
        if (config.id) {
            // Check if this is a reopened panel (has the expected type prefix)
            if (config.id.startsWith(type)) {
                id = config.id; // Keep the exact same ID for reopened panels
            } else {
                id = `${type}-${Date.now()}`;
            }
        } else {
            id = `${type}-${Date.now()}`;
        }
        
        // Create tile element
        const tileElement = _createTileElement(id);
        
        // Determine where to add the tile
        const container = targetContainer || _container;
        
        // Check if we're replacing a tile selector
        const tileSelector = container.querySelector('.tile-selector');
        if (tileSelector) {
            // Only replace non-bottom selectors
            if (!tileSelector.dataset.isBottomSelector) {
                // Replace the tile selector with the new tile
                container.insertBefore(tileElement, tileSelector);
                tileSelector.remove();
            } else {
                // If this is a bottom selector, insert before it but don't remove it
                container.insertBefore(tileElement, tileSelector);
            }
        } else {
            // Just add the tile to the container
            container.appendChild(tileElement);
        }
        
        // Get the content container
        const contentContainer = tileElement.querySelector('.tile-content');
        
        // Create panel instance
        const Constructor = _panelTypes.get(type);
        const panel = new Constructor(contentContainer, {
            id,
            title: config.title || _generateUniqueName(`${_formatPanelType(type)} 1`),
            ...config
        });
        
        // Store reference to the panel
        _panels.set(id, panel);
        _panelsByType.get(type).add(panel);
        _activePanels.add(panel);
        
        const titleInput = tileElement.querySelector('.tile-title');
        if (titleInput && panel.getTitle) {
            titleInput.value = panel.getTitle();
        }

        // Set up all event handlers
        _setupTileEventHandlers(tileElement, id);
        
        // Initialize the panel
        panel.init();
        
        // Apply control panel visibility if specified
        if (Object.prototype.hasOwnProperty.call(config, 'controlsVisible')) {
            _applyControlsVisible(tileElement, config.controlsVisible);
        }
        
        // Scroll the new panel into view
        setTimeout(() => {
            tileElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
        
        updateSourcePanelSelection();
        return panel;
    }

    /**
     * Materialize a panel directly into the layout, identical to an
     * interactively-created one.
     *
     * The interactive "add panel" flow (the welcome selection tile) routes
     * through LayoutManager.createPanelWithSelectionTile, which wraps the tile in
     * a sized `.panel-wrapper` (fixed height) plus a horizontal `.split-handle`
     * wired for vertical resizing. Callers that create panels programmatically
     * (e.g. deep-link `view=` materialization) MUST use this so the panel gets
     * the same wrapper, resize handle, and a sized parent — the plot's
     * ResizeObserver relies on that parent to autosize Plotly correctly.
     *
     * Calling createPanel() directly (no targetContainer) instead appends a
     * bare, height-less `.tile` straight into the flex-column container, which
     * yields an inner scrollbar, no resize handle, and a distorted plot.
     *
     * Falls back to createPanel() if no welcome selection tile is present.
     *
     * @param {string} type - Panel type identifier
     * @param {Object} [config] - Panel configuration
     * @returns {Object|null} - The created panel instance, or null on unknown type
     */
    function createPanelInLayout(type, config = {}) {
        if (!_panelTypes.has(type)) {
            console.error(`Unknown panel type: ${type}`);
            return null;
        }

        const selectionTile = _welcomeSelectionTile && _welcomeSelectionTile.tileSelector;
        // The welcome tile lives in _container; mirror createPanelFromType and use
        // the tile's actual parent so the wrapper is inserted in the right place.
        const container = (selectionTile && selectionTile.parentElement) || _container;

        if (selectionTile && container) {
            return LayoutManager.createPanelWithSelectionTile(
                container,
                selectionTile,
                createPanel,
                type,
                config
            );
        }

        // No welcome selection tile available — fall back to a direct create so
        // the panel still appears (will lack the wrapper/resize wiring).
        return createPanel(type, config);
    }

    /**
     * Guarantee the UI never stays stuck on a "restoring previous panel set"
     * spinner. If no panels materialized — a deep-link with no view, an empty or
     * corrupt autosave, or a restore that threw — reset the welcome tile to its
     * default "Welcome to AnnZarro / Get started by choosing a panel type" state
     * so the user always has a usable fallback instead of an infinite spinner.
     *
     * No-op once any panel exists: in that case the welcome tile has already been
     * consumed/hidden by the panel-creation path, so a normal restore or a
     * successful deep-link is unaffected.
     */
    function ensureWelcomeFallback() {
        if (_panels.size > 0) return;
        if (_welcomeSelectionTile && typeof _welcomeSelectionTile.showWelcomeHeader === 'function') {
            _welcomeSelectionTile.showWelcomeHeader();
            if (typeof _welcomeSelectionTile.toggleSessions === 'function') {
                _welcomeSelectionTile.toggleSessions(true);
            }
        }
    }

    /**
     * Update all selection tiles when panels are added, removed, or modified
     */
    function updateSourcePanelSelection() {
        // First, find all selection tiles in the DOM
        const selectionTiles = document.querySelectorAll('.tile-selector');
        selectionTiles.forEach(tile => {
            // Get the SelectionTile instance from the element
            const instance = tile._selectionTileInstance;
            if (instance && typeof instance.updateSourcePanelGrid === 'function') {
                instance.updateSourcePanelGrid();
            }
        });
        
        // Also update the welcome selection tile if it exists
        if (_welcomeSelectionTile && typeof _welcomeSelectionTile.updateSourcePanelGrid === 'function') {
            _welcomeSelectionTile.updateSourcePanelGrid();
            
            // If we have panels and this is the welcome tile, show clone section
            if (_panels.size > 0) {
                _welcomeSelectionTile.hideHeader();
                _welcomeSelectionTile.toggleSessions(false);
            }
        }
        
        // Update all table filter dropdowns in plot panels
        try {
            // Find all plot panels
            const plotPanels = document.querySelectorAll('.plot-panel');
            
            // Import the utility to update table filter dropdowns
            import('./panels/plot-utilities/panel-ui-update.js')
                .then(({ updateTableFilterSelect }) => {
                    plotPanels.forEach(plotPanel => {
                        // Extract the id and get the appropriate entity type
                        const plotId = plotPanel.closest('.tile')?.dataset.tileId;
                        if (plotId) {
                            // Find the controls container inside the plot panel
                            const controlsContainer = plotPanel.querySelector('.plot-controls');
                            if (controlsContainer) {
                                const plotType = plotId.startsWith('cell-plot') ? 'cells' : 'genes';
                                // Pass the full panel ID, not just the numeric part
                                updateTableFilterSelect(controlsContainer, plotId, plotType);
                            }
                        }
                    });
                })
                .catch(err => console.error('Error updating table filter dropdowns:', err));
        } catch (error) {
            console.error('Error updating table filter dropdowns:', error);
        }
        
        // Notify SessionManager about panel update to trigger autosave if enabled
        if (window.sessionManager && typeof window.sessionManager.notifyPanelUpdate === 'function') {
            window.sessionManager.notifyPanelUpdate();
        }
    }
    
    /**
     * Format panel type for display
     * @param {string} type - Panel type identifier
     * @returns {string} - Formatted panel type name
     * @private
     */
    function _formatPanelType(type) {
        // Use the label from centralized panel type definitions
        const panelType = Config.PANEL_TYPES.find(pt => pt.type === type);
        if (panelType && panelType.label) {
            return panelType.label;
        }
        
        // Fallback to original formatting
        return type.split('-').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
    }
    
    /**
     * Create a new tile DOM element
     * @param {string} id - Tile ID
     * @returns {HTMLElement} - The created tile element
     * @private
     */
    function _createTileElement(id) {
        const template = document.getElementById('tile-template');
        const tile = template.content.cloneNode(true).querySelector('.tile');
        tile.dataset.tileId = id;
        
        return tile;
    }
    
    /**
     * Toggle panel controls visibility
     * @param {string} id - ID of the panel
     * @param {HTMLElement} button - The toggle button element
     * @private
     */
    function _togglePanelControls(id, button) {
        const panel = _panels.get(id);
        if (!panel) return;
        
        const tileElement = document.querySelector(`.tile[data-tile-id="${id}"]`);
        const contentContainer = tileElement.querySelector('.tile-content');
        
        // Find either plot-controls or table-controls element within the panel
        const plotControls = contentContainer.querySelector('.plot-controls');
        const tableControls = contentContainer.querySelector('.table-controls');
        
        // Determine which controls element to toggle
        const controlsElement = plotControls || tableControls;
        if (!controlsElement) return;
        
        // Toggle controls visibility (recorded, so dataset loading keeps it)
        const isVisible = controlsElement.style.display !== 'none';
        setControlsVisible(controlsElement, !isVisible);
        
        // Store state in the panel's config for session saving (only this
        // key: handing a whole getConfig() back hit the tables' read-only
        // searchBuilderConfig)
        panel.updateConfig && panel.updateConfig({ controlsVisible: !isVisible });
        
        // Store state in the DOM for immediate reference
        const parentPane = tileElement.closest('.split-pane');
        if (parentPane) {
            parentPane.dataset.controlsVisible = !isVisible;
        }
        
        // Update button icon and title
        const icon = button.querySelector('i');
        if (isVisible) {
            icon.classList.remove('fa-chevron-up');
            icon.classList.add('fa-chevron-down');
            button.title = 'Show Controls';
        } else {
            icon.classList.remove('fa-chevron-down');
            icon.classList.add('fa-chevron-up');
            button.title = 'Hide Controls';
        }
    }
    
    /**
     * Split a tile into two panes
     * @param {string} id - ID of the tile to split
     * @param {string} direction - Split direction ('horizontal' or 'vertical')
     * @private
     */
    function _splitTile(id, direction) {
        const panel = _panels.get(id);
        if (!panel) return;
        
        // Get the original tile
        const tile = document.querySelector(`.tile[data-tile-id="${id}"]`);
        if (!tile) return;
        
        // Get the parent container
        const parentContainer = tile.parentElement;
        if (!parentContainer) return;
        
        // Use the LayoutManager to create the split
        LayoutManager.createSplit(parentContainer, tile, direction);
    }
    
    
    // _setupResizableHandle has been removed and moved to LayoutManager.setupResizableHandle
    
    /**
     * Close a panel
     * @param {string} id - Panel ID
     */
    function closePanel(id) {
        const panel = _panels.get(id);
        if (!panel) return;
        
        // Remove from DOM
        const tile = document.querySelector(`.tile[data-tile-id="${id}"]`);
        if (tile) {
            // Use the LayoutManager to properly close the panel and handle container cleanup
            LayoutManager.closePanel(tile);
        }
        
        // Remove from active panels
        _activePanels.delete(panel);
        
        // Store the panel configuration before cleanup
        const config = panel.getConfig();
        config.active = false; // Mark as closed
        
        // Call cleanup on the panel
        panel.cleanup();

        // Remove from source panels of bottom selection
        updateSourcePanelSelection();

        // Its locked cells/genes are no longer offered as table columns
        document.dispatchEvent(new CustomEvent('fixedEntitiesChanged', { detail: { closed: id } }));
    }
    
    /**
     * Get a panel by ID
     * @param {string} id - Panel ID
     * @returns {Object} - Panel instance
     */
    function getPanel(id) {
        return _panels.get(id);
    }
    
    /**
     * Get all panels of a specific type
     * @param {string} type - Panel type
     * @returns {Array} - Array of panel instances
     */
    function getPanelsByType(type) {
        return Array.from(_panelsByType.get(type) || []);
    }
    
    // Track active data update signal for cancellation
    let _currentUpdateAbortController = null;
    
    /**
     * Notify panels of a data update
     * @param {string} updateType - Type of update
     * @param {Object} data - Update data
     * @returns {Promise<void>} - Promise that resolves when all panels are updated
     */
    async function notifyPanels(updateType, data) {
        // If there's an ongoing update, abort it
        if (_currentUpdateAbortController) {
            console.debug(`Aborting current panel updates for ${updateType}`);
            _currentUpdateAbortController.abort();
            _currentUpdateAbortController = null;
        }
        
        // Create a new abort controller for this update batch
        _currentUpdateAbortController = new AbortController();
        const signal = _currentUpdateAbortController.signal;
        
        // Add the signal to the data object so panels can check for abort
        const updateData = {
            ...data,
            _abortSignal: signal
        };
        
        // Wait for all panel updates to complete or be aborted. Every panel
        // updates on its own: one failing cannot hold up the rest.
        try {
            await notifyEach(_activePanels, updateType, updateData);
            
            // Clear the controller reference after successful completion
            if (_currentUpdateAbortController && _currentUpdateAbortController.signal === signal) {
                _currentUpdateAbortController = null;
            }
        } catch (error) {
            // Only log non-abort errors
            if (!error || error.name !== 'AbortError') {
                console.error('Error during panel updates:', error);
            } else if (Config.DEBUG_MODE) {
                console.debug('Panel updates were aborted');
            }
            
            // Clear the controller reference if it's still the current one
            if (_currentUpdateAbortController && _currentUpdateAbortController.signal === signal) {
                _currentUpdateAbortController = null;
            }
        }
    }
    
    /**
     * Reset all panels
     */
    function resetPanels() {
        // Close all panels
        Array.from(_panels.keys()).forEach(id => {
            closePanel(id);
        });
        
        // Clear the container
        if (_container) {
            _container.innerHTML = '';
        }
    }
    
    /**
     * Get all active panels
     * @returns {Array} - Array of active panel instances
     */
    function getActivePanels() {
        return Array.from(_activePanels);
    }
    
    /**
     * Save the current layout dimensions and structure
     * This function only saves the layout structure and visual state, not panel data configurations
     * @returns {Object} - Layout configuration with hierarchy only
     */
    function saveLayout() {
        // Use the LayoutManager to build a hierarchical representation of the layout
        const mainContainer = document.getElementById('main-container') || _container;
        const layoutHierarchy = [];
        
        // Process each root element in the container
        Array.from(mainContainer.children).forEach(element => {
            const node = LayoutManager.buildLayoutHierarchy(element);
            if (node) {
                layoutHierarchy.push(node);
            }
        });
        
        // Control panel visibility is part of the layout visual state (not panel config)
        const controlState = {};
        // Per-panel config keyed by tile id. restoreLayout already reads
        // `layout.panelConfigs[id]` when re-instantiating a panel; emitting it
        // here completes the saveLayout↔restoreLayout round-trip so a serialized
        // layout (e.g. a shareable deep link) reopens with each panel's actual
        // settings, not defaults. The value is the constructor-ready config
        // (getConfig() output + its id), matching what restoreLayout passes to
        // `new Constructor(container, panelConfig)`.
        const panelConfigs = {};
        _panels.forEach((panel, id) => {
            const tileElement = document.querySelector(`.tile[data-tile-id="${id}"]`);
            if (tileElement) {
                const contentContainer = tileElement.querySelector('.tile-content');
                const plotControls = contentContainer?.querySelector('.plot-controls');
                const tableControls = contentContainer?.querySelector('.table-controls');
                const controlsElement = plotControls || tableControls;

                if (controlsElement) {
                    controlState[id] = controlsElement.style.display !== 'none';
                }
            }
            try {
                // without derived state (a table's row list): see serializableConfig
                const cfg = serializableConfig((panel.getConfig && panel.getConfig()) || {});
                panelConfigs[id] = { id, ...cfg };
            } catch (err) {
                console.warn(`saveLayout: could not serialize config for ${id}:`, err);
                panelConfigs[id] = { id };
            }
        });

        const layout = {
            v: VIEW_SCHEMA_VERSION,
            hierarchy: layoutHierarchy,
            controlState: controlState,
            panelConfigs: panelConfigs
        };

        console.log('Layout saved:', layout);
        return layout;
    }
    
    /**
     * Restore layout dimensions and structure
     * @param {Object} layout - Layout configuration
     * @returns {Promise<void>} - Promise that resolves when all panels are initialized
     */
    async function restoreLayout(layout) {
        if (!layout) return;
        
        console.log('Restoring layout:', layout);
        
        // Track currently active panels before restore
        const previouslyActivePanels = new Set(_activePanels);
        
        // Clear the active panels set - we'll repopulate it
        _activePanels.clear();
        
        // Collect panel IDs from the layout
        const panelIdsInLayout = new Set();
        
        // Clear the container
        if (_container) {
            _container.innerHTML = '';
        }
        
        // Handle new hierarchical format
        if (layout.hierarchy) {
            // Collect all panel IDs in the layout. collectTileIds (utils/deeplink.js)
            // is the shared walk, so the deep-link encoder and this restore agree
            // on exactly which tiles a hierarchy opens.
            collectTileIds(layout.hierarchy).forEach(id => panelIdsInLayout.add(id));
            
            // First pass: Build the DOM layout structure without initializing panels
            const rebuiltNodes = layout.hierarchy.map(node => 
                LayoutManager.rebuildLayoutFromHierarchy(
                    node, 
                    _container,
                    // Callback to create a tile element
                    (id) => _createTileElement(id),
                    // Empty callback - we'll initialize panels in second pass
                    () => {}
                )
            );
            
            // The bottom "Create New Panel" chooser is restored only when the
            // hierarchy lists it. Layouts saved by the app always do, but a
            // hand-written link or an older panel set may not, and the chooser
            // then never came back. Add it when the hierarchy has none.
            const hasSelector = (nodes) => nodes.some(n => n && (n.type === 'selector' ||
                (Array.isArray(n.children) && hasSelector(n.children))));
            if (_container && !hasSelector(layout.hierarchy)) {
                LayoutManager.rebuildLayoutFromHierarchy(
                    { type: 'selector' },
                    _container,
                    (id) => _createTileElement(id),
                    () => {}
                );
            }

            // Set up all the handle resizing
            document.querySelectorAll('.split-handle').forEach(handle => {
                const container = handle.parentElement;
                // its own two panes; a nested split's would make it four
                const panes = LayoutManager.childPanes(container);
                
                if (panes.length === 2) {
                    const direction = container.dataset.splitDirection;
                    LayoutManager.setupResizableHandle(handle, panes[0], panes[1], direction);
                }
            });
            
            // Second pass: Initialize all panels in the layout
            const initializationPromises = [];
            
            for (const id of panelIdsInLayout) {
                const tileElement = document.querySelector(`.tile[data-tile-id="${id}"]`);
                if (!tileElement) continue;
                
                const contentContainer = tileElement.querySelector('.tile-content');
                if (!contentContainer) continue;
                
                // Extract panel type from ID (everything before the last dash).
                // Shared with the deep-link encoder via panelTypeFromTileId.
                const type = panelTypeFromTileId(id);
                
                // Set up event handlers first
                _setupTileEventHandlers(tileElement, id);
                
                // Check if panel type is registered
                if (!_panelTypes.has(type)) {
                    console.error(`Unknown panel type: ${type} for panel id: ${id}`);
                    continue;
                }
                
                // Get the panel config from the layout
                const savedConfig = layout.panelConfigs && layout.panelConfigs[id];
                const panelConfig = savedConfig ? savedConfig : { id };

                // A saved config describes this panel exactly; an existing
                // instance with the same id (the same set loaded twice, or a
                // panel still around from before) would otherwise be reused
                // with ITS settings. Replace it so the saved view comes back.
                if (savedConfig && _panels.has(id)) {
                    removePanel(id);
                }

                // Get existing panel or create a new one
                let panel = _panels.get(id);
                let promise;

                if (!panel) {
                    const Constructor = _panelTypes.get(type);
                    panel = new Constructor(contentContainer, panelConfig);
                    _panels.set(id, panel);
                    _panelsByType.get(type).add(panel);
                }
                _activePanels.add(panel);

                const titleInput = tileElement.querySelector('.tile-title');
                if (titleInput && panel.getTitle) {
                    titleInput.value = panel.getTitle();
                }

                // Controls shown or hidden as saved. controlState is what
                // saveLayout records (plot AND table controls); a config's own
                // controlsVisible is the fallback. Applied right after init
                // builds the controls (synchronously, before its first await),
                // so the first draw already has the saved plot area: a plot
                // drawn under controls that should be hidden can be squeezed
                // to nothing, which Plotly reports by throwing.
                const savedVisible = layout.controlState && layout.controlState[id] !== undefined
                    ? layout.controlState[id]
                    : panelConfig.controlsVisible;
                promise = new Promise(resolve => {
                    Promise.resolve().then(() => {
                        try {
                            const pending = panel.init();
                            if (savedVisible !== undefined) _applyControlsVisible(tileElement, savedVisible);
                            return pending;
                        } catch (error) {
                            console.error(`Error initializing restored panel ${id}:`, error);
                        }
                    }).then(resolve, error => {
                        console.error(`Error initializing restored panel ${id}:`, error);
                        resolve();
                    });
                });
                
                initializationPromises.push(promise);
            }
            
            // Wait for all initializations to complete
            await Promise.all(initializationPromises);
            
            // Make panels that weren't in the layout inactive
            previouslyActivePanels.forEach(panel => {
                if (!panelIdsInLayout.has(panel.getId())) {
                    _activePanels.delete(panel);
                    // Don't delete from _panels so they're still available for cloning
                }
            });
        } 
        // Handle legacy formats
        else if (layout.tiles || layout.structure) {
            console.warn('Restoring from legacy layout format. Consider saving a new session.');
        } 
        else {
            console.warn('Unknown layout format.');
        }
        
        console.log('Layout restoration completed');
    }
    
    /**
     * Set up event handlers for a tile
     * @param {HTMLElement} tileElement - The tile element
     * @param {string} id - The panel ID
     * @private
     */
    function _setupTileEventHandlers(tileElement, id) {
        // Update the title in the DOM
        const titleInput = tileElement.querySelector('.tile-title');
        if (titleInput) {
            titleInput.addEventListener('change', () => {
                const panel = _panels.get(id);
                if (panel) {
                    const newTitle = titleInput.value;
                    // Update the panel's title using the setTitle method
                    // This will update the internal title state of the panel
                    panel.setTitle(newTitle);
                    
                    // Update any selection tiles to show the new title
                    updateSourcePanelSelection();
                }
            });
        }
        
        // Set up split handlers
        const splitHBtn = tileElement.querySelector('.tile-split-h');
        if (splitHBtn) {
            splitHBtn.addEventListener('click', () => _splitTile(id, 'horizontal'));
        }
        
        const splitVBtn = tileElement.querySelector('.tile-split-v');
        if (splitVBtn) {
            splitVBtn.addEventListener('click', () => _splitTile(id, 'vertical'));
        }
        
        // Set up close handler - don't add close functionality to selection tiles
        const closeBtn = tileElement.querySelector('.tile-close');
        if (closeBtn) {
            if (tileElement.classList.contains('tile-selector') || 
                tileElement.dataset.isBottomSelector === 'true' ||
                tileElement.querySelector('.tile-selector[data-is-bottom-selector="true"]')) {
                // Hide close button for selection tiles
                closeBtn.style.display = 'none';
            } else {
                closeBtn.addEventListener('click', () => closePanel(id));
            }
        }
        
        // Set up toggle controls handler
        const toggleControlsBtn = tileElement.querySelector('.tile-toggle-controls');
        if (toggleControlsBtn) {
            toggleControlsBtn.addEventListener('click', () => _togglePanelControls(id, toggleControlsBtn));
        }
    }

    /**
     * Show or hide a panel's control bar and keep its toggle button in step.
     * @param {HTMLElement} tileElement
     * @param {boolean} visible
     * @private
     */
    function _applyControlsVisible(tileElement, visible) {
        const contentContainer = tileElement && tileElement.querySelector('.tile-content');
        if (!contentContainer) return;
        const controlsElement = contentContainer.querySelector('.plot-controls')
            || contentContainer.querySelector('.table-controls');
        if (!controlsElement) return;
        setControlsVisible(controlsElement, visible);
        const pane = tileElement.closest && tileElement.closest('.split-pane');
        if (pane) pane.dataset.controlsVisible = String(!!visible);
        const toggleBtn = tileElement.querySelector('.tile-toggle-controls');
        const icon = toggleBtn && toggleBtn.querySelector('i');
        if (icon) {
            icon.classList.toggle('fa-chevron-up', !!visible);
            icon.classList.toggle('fa-chevron-down', !visible);
            toggleBtn.title = visible ? 'Hide Controls' : 'Show Controls';
        }
    }

    /**
     * Forget a panel entirely (not just close it): its tile, its listeners
     * and its entry in every registry. Used when a loaded panel set brings a
     * panel with the same id, so the id, and every reference to it (a plot's
     * tableFilter), keeps meaning the panel from the set.
     * @param {string} id
     */
    function removePanel(id) {
        const panel = _panels.get(id);
        if (!panel) return;
        const tile = document.querySelector(`.tile[data-tile-id="${id}"]`);
        if (tile && _activePanels.has(panel)) {
            LayoutManager.closePanel(tile);
        }
        _activePanels.delete(panel);
        try {
            if (typeof panel.destroy === 'function') panel.destroy();
            else if (typeof panel.cleanup === 'function') panel.cleanup();
        } catch (error) {
            console.warn(`removePanel: cleanup of ${id} failed:`, error);
        }
        _panels.delete(id);
        const byType = _panelsByType.get(panelTypeFromTileId(id));
        if (byType) byType.delete(panel);
        _panelsByType.forEach(set => set.delete(panel));
    }

    /**
     * Register a closed panel for potential future cloning
     * @param {string} type - Panel type
     * @param {Object} config - Panel configuration
     * @param {string} [id] - Optional panel ID (will be generated if not provided)
     * @returns {Object} - The created panel instance
     */
    function registerClosedPanel(type, config) {
        if (!_panelTypes.has(type)) {
            console.error(`Unknown panel type: ${type}`);
            return null;
        }
        
        // Make sure ID is unique but only update if really needed:
        if (config.id) {
            // Check if this ID already exists in panels
            if (_panels.has(config.id)) {
                // Only generate a new ID if there's a collision
                config.id = `${type}-${Date.now()}`;
            }
        } else {
            // No ID provided, generate one
            config.id = `${type}-${Date.now()}`;
        }
        config.title = _generateUniqueName(config.title, type);

        // Create a "zombie" panel (stored but not active)
        const Constructor = _panelTypes.get(type);
        const dummyContainer = document.createElement('div'); // Will not be used
        
        const panel = new Constructor(dummyContainer, {
            id: config.id,
            title: config.title,
            ...config,
            _closed: true // Mark as closed
        });
        
        // Store reference but don't add to active panels
        _panels.set(config.id, panel);
        _panelsByType.get(type).add(panel);
        
        // Return the panel for additional operations
        return panel;
    }
    
    /**
     * Get all panels (both active and closed)
     * @returns {Array} - Array of all panel instances
     */
    function getAllPanels() {
        return Array.from(_panels.values());
    }
    
    /**
     * Get all active panels
     * @returns {Array} - Array of active panel instances
     */
    function getAllActivePanels() {
        // Return active panels or all panels if no active panels set exists
        return getActivePanels ? getActivePanels() : Array.from(_panels.values());
    }

    // Removed getCounters function as counters are no longer used
    
    // Public API
    return {
        init,
        registerPanelType,
        createPanel,
        createPanelInLayout,
        ensureWelcomeFallback,
        closePanel,
        getPanel,
        getPanelsByType,
        getActivePanels,
        getAllPanels,
        getAllActivePanels,
        notifyPanels,
        resetPanels,
        saveLayout,
        restoreLayout,
        registerClosedPanel,
        removePanel,
        updateSourcePanelSelection
    };
})();

// Export the module
export { PanelManager };
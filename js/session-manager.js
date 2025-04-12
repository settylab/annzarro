/**
 * Session Manager module for AnnZarro
 * Handles saving, loading, and managing sessions
 * 
 * Completely revamped to:
 * 1. Save only the essential structure, not the panel contents
 * 2. Restore the UI properly by initializing the base selection tile first 
 * 3. Restore the layout structure, then populate panels asynchronously
 * 4. Ensure proper DOM structure with correct IDs and event listeners
 */
import { Config } from './config.js';
import { DataManager } from './data-manager.js';
import { PanelManager } from './panel-manager.js';
import { LayoutManager } from './layout-manager.js';

const SessionManager = (function() {
    // Private variables
    let _currentSession = null;
    
    /**
     * Load list of available sessions
     * @returns {Promise<Array>} - List of sessions
     */
    async function listSessions() {
        try {
            const response = await fetch(Config.API.SESSIONS_LIST);
            if (!response.ok) {
                throw new Error(`API error: ${response.statusText}`);
            }
            
            const sessions = await response.json();
            return sessions;
        } catch (error) {
            console.error('Error listing sessions:', error);
            return [];
        }
    }
    
    /**
     * Save current session
     * @param {string} name - Session name
     * @returns {Promise<Object>} - Save result
     */
    async function saveSession(name) {
        if (!name) {
            console.error('Session name is required');
            return { status: 'error', message: 'Session name is required' };
        }
        
        try {
            // Create the session data structure
            const sessionData = {};
            sessionData.name = name;
            sessionData.timestamp = new Date().toISOString();
            
            // 1. Save dataset information
            sessionData.dataset = DataManager.getCurrentDataset();
            const datasetStructure = DataManager.getDatasetStructure();
            sessionData.datasetName = datasetStructure ? datasetStructure.name : '';
            
            // 2. Save focus state
            sessionData.constants = {
                focusedCell: DataManager.getFocusedCell(),
                focusedGene: DataManager.getFocusedGene(),
                taxonomyId: DataManager.getTaxonomyId()
            };
            
            // 3. Get layout hierarchy - this will include all tiles with their IDs
            // but not the actual panels
            const container = PanelManager.getContainer();
            console.log('Saving layout from container:', container ? 'found' : 'not found');
            
            // First try to use PanelManager's built-in layout saving if available
            let layoutHierarchy = [];
            
            if (PanelManager.saveLayout && typeof PanelManager.saveLayout === 'function') {
                console.log('Using PanelManager.saveLayout for consistent saving/loading');
                const savedLayout = PanelManager.saveLayout();
                
                if (savedLayout && savedLayout.hierarchy) {
                    console.log('Retrieved layout hierarchy from PanelManager');
                    layoutHierarchy = savedLayout.hierarchy;
                } else {
                    console.log('PanelManager.saveLayout did not return hierarchy, using manual method');
                }
            }
            
            // If we didn't get a hierarchy from PanelManager, build it manually
            if (layoutHierarchy.length === 0 && container) {
                console.log('Building layout hierarchy manually');
                
                Array.from(container.children).forEach(element => {
                    // Skip the bottom selector
                    if (element.classList.contains('tile-selector') && element.dataset.isBottomSelector === 'true') {
                        console.log('Skipping bottom selector in layout hierarchy');
                        return;
                    }
                    
                    try {
                        const node = LayoutManager.buildLayoutHierarchy(element);
                        if (node) {
                            console.log('Added node to hierarchy:', node.type);
                            layoutHierarchy.push(node);
                        }
                    } catch (err) {
                        console.error('Error building hierarchy for element:', err);
                    }
                });
            }
            
            console.log('Built layout hierarchy with', layoutHierarchy.length, 'nodes');
            
            // 4. Save panel configurations separately for recreation
            console.log('Saving panel configurations');
            const panelConfigs = {};
            
            // Get all panels including closed ones
            const allPanels = PanelManager.getAllPanels ? PanelManager.getAllPanels() : PanelManager.getActivePanels();
            const activePanelIds = new Set(PanelManager.getActivePanels().map(p => p.getId()));
            
            console.log(`Found ${allPanels.length} panels (${activePanelIds.size} active)`);
            
            // First collect all actual panels
            allPanels.forEach(panel => {
                const id = panel.getId();
                if (!id) {
                    console.warn('Panel missing ID, skipping in session save');
                    return;
                }
                
                const type = panel.getType();
                if (!type) {
                    console.warn(`Panel ${id} missing type, skipping in session save`);
                    return;
                }
                
                const isActive = activePanelIds.has(id);
                
                try {
                    // Get panel configuration and associated data
                    const config = panel.getConfig() || {};
                    const title = panel.getTitle() || `${type.charAt(0).toUpperCase() + type.slice(1)}`;
                    
                    // For each panel, store only its configuration, not its DOM elements
                    panelConfigs[id] = {
                        id: id,
                        type: type,
                        title: title,
                        config: config,
                        active: isActive,
                        isSelectionTile: false
                    };
                    
                    console.log(`Saved config for panel: ${id} (${type}, active: ${isActive})`);
                } catch (err) {
                    console.error(`Error saving panel config for ${id}:`, err);
                }
            });
            
            // 5. Find all selection tiles in the layout (except base welcome selector)
            const selectionTiles = Array.from(container.querySelectorAll('.tile-selector')).filter(
                tile => !tile.dataset.isBottomSelector && tile.dataset.tileId
            );
            
            console.log(`Found ${selectionTiles.length} selection tiles to save`);
            
            selectionTiles.forEach(tile => {
                const id = tile.dataset.tileId;
                if (id) {
                    panelConfigs[id] = {
                        id: id,
                        type: 'selection-tile',
                        isSelectionTile: true,
                        active: true
                    };
                    console.log(`Saved selection tile: ${id}`);
                }
            });
            
            // Combine layout and configs in the session data
            sessionData.layout = {
                hierarchy: layoutHierarchy
            };
            sessionData.panelConfigs = panelConfigs;
            
            // Save to server
            console.log('Saving session:', sessionData);
            const response = await fetch(Config.API.SESSIONS_SAVE, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(sessionData)
            });
            
            if (!response.ok) {
                throw new Error(`API error: ${response.statusText}`);
            }
            
            const result = await response.json();
            _currentSession = { name, ...sessionData };
            
            return result;
        } catch (error) {
            console.error('Error saving session:', error);
            return { status: 'error', message: error.message };
        }
    }
    
    /**
     * Load a session by name
     * @param {string} name - Session name
     * @returns {Promise<Object>} - Load result
     */
    async function loadSession(name) {
        if (!name) {
            console.error('Session name is required');
            return { status: 'error', message: 'Session name is required' };
        }
        
        try {
            const response = await fetch(`${Config.API.SESSIONS_LOAD}?name=${encodeURIComponent(name)}`);
            
            if (!response.ok) {
                throw new Error(`API error: ${response.statusText}`);
            }
            
            const sessionData = await response.json();
            await _applySessionData(sessionData);
            
            _currentSession = sessionData;
            
            return { status: 'success', message: `Session ${name} loaded successfully` };
        } catch (error) {
            console.error('Error loading session:', error);
            return { status: 'error', message: error.message };
        }
    }
    
    /**
     * Delete a session by name
     * @param {string} name - Session name
     * @returns {Promise<Object>} - Delete result
     */
    async function deleteSession(name) {
        if (!name) {
            console.error('Session name is required');
            return { status: 'error', message: 'Session name is required' };
        }
        
        try {
            const response = await fetch(`${Config.API.SESSIONS_DELETE}?name=${encodeURIComponent(name)}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) {
                throw new Error(`API error: ${response.statusText}`);
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
     * Export session as file download
     * @param {string} name - Session name
     */
    function exportSession(name) {
        if (!name) {
            console.error('Session name is required');
            return;
        }
        
        const link = document.createElement('a');
        link.href = `${Config.API.SESSIONS_EXPORT}?name=${encodeURIComponent(name)}`;
        link.download = `${name}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    
    /**
     * Import session from file
     * @param {File} file - Session file
     * @returns {Promise<Object>} - Import result
     */
    async function importSession(file) {
        if (!file) {
            console.error('Session file is required');
            return { status: 'error', message: 'Session file is required' };
        }
        
        try {
            const formData = new FormData();
            formData.append('file', file);
            
            const response = await fetch(Config.API.SESSIONS_IMPORT, {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                throw new Error(`API error: ${response.statusText}`);
            }
            
            const result = await response.json();
            return result;
        } catch (error) {
            console.error('Error importing session:', error);
            return { status: 'error', message: error.message };
        }
    }
    
    /**
     * Apply loaded session data to restore the application state
     * @param {Object} sessionData - Session data
     * @returns {Promise<void>}
     * @private
     */
    async function _applySessionData(sessionData) {
        try {
            console.log('Applying session data...', sessionData);
            
            // 1. Reset the current state - this clears the UI
            PanelManager.resetPanels();
            
            // 2. Load the dataset first
            if (sessionData.dataset) {
                console.log('Loading dataset:', sessionData.dataset);
                await DataManager.setCurrentDataset(sessionData.dataset);
                
                // 3. Update UI dataset info
                const datasetNameEl = document.getElementById('dataset-path');
                if (datasetNameEl) {
                    datasetNameEl.textContent = sessionData.datasetName || sessionData.dataset;
                }
                
                const cellCountEl = document.getElementById('cell-count');
                const geneCountEl = document.getElementById('gene-count');
                const datasetStructure = await DataManager.getDatasetStructure();
                
                if (datasetStructure) {
                    if (cellCountEl) cellCountEl.textContent = datasetStructure.n_obs || 0;
                    if (geneCountEl) geneCountEl.textContent = datasetStructure.n_vars || 0;
                }
                
                // 4. Restore constants
                if (sessionData.constants) {
                    const { focusedCell, focusedGene, taxonomyId } = sessionData.constants;
                    
                    if (focusedCell) DataManager.setFocusedCell(focusedCell);
                    if (focusedGene) DataManager.setFocusedGene(focusedGene);
                    if (taxonomyId) DataManager.setTaxonomyId(taxonomyId);
                    
                    // Update UI elements
                    const focusedCellSelect = document.getElementById('focused-cell');
                    const focusedGeneSelect = document.getElementById('focused-gene');
                    const taxonomyIdSelect = document.getElementById('taxonomy-id');
                    
                    if (focusedCellSelect && focusedCell) focusedCellSelect.value = focusedCell;
                    if (focusedGeneSelect && focusedGene) focusedGeneSelect.value = focusedGene;
                    if (taxonomyIdSelect && taxonomyId) taxonomyIdSelect.value = taxonomyId;
                }
                
                // 5. First initialize the UI with base selection tile
                const container = PanelManager.getContainer();
                if (!container) {
                    throw new Error('Container not found');
                }
                
                // Ensure the container is empty
                container.innerHTML = '';
                
                // Create the base selection tile with sessions section hidden (false)
                console.log('Creating base selection tile for session restoration');
                
                let baseSelector;
                if (PanelManager.createBaseSelectionTile) {
                    const result = PanelManager.createBaseSelectionTile(false);
                    baseSelector = result.selector;
                    
                    if (baseSelector) {
                        console.log('Base selector created successfully');
                    } else {
                        console.warn('Failed to create base selector');
                    }
                } else {
                    console.warn('createBaseSelectionTile method not available, falling back');
                    // Fallback to original method
                    PanelManager.updateSourcePanelSelection();
                    
                    // Try to find the selector that was created
                    baseSelector = container.querySelector('.tile-selector[data-is-bottom-selector="true"]');
                    
                    // If found, try to transform it
                    if (baseSelector && PanelManager.transformBaseSelectionTile) {
                        PanelManager.transformBaseSelectionTile(baseSelector);
                    }
                }
                
                // 6. Register closed panels before building the layout
                const panelConfigs = sessionData.panelConfigs || {};
                
                // Register any closed panels from the configuration
                Object.values(panelConfigs)
                    .filter(panel => !panel.active && !panel.isSelectionTile)
                    .forEach(panel => {
                        if (PanelManager.registerClosedPanel) {
                            console.log(`Registering closed panel: ${panel.id}`);
                            PanelManager.registerClosedPanel(panel.type, panel.config, panel.id);
                        }
                    });
                
                // 7. Build the layout structure
                if (sessionData.layout && sessionData.layout.hierarchy) {
                    try {
                        console.log('Restoring layout structure...');
                        console.log('Layout hierarchy:', JSON.stringify(sessionData.layout.hierarchy));
                        console.log('Panel configs:', Object.keys(panelConfigs).length, 'panels');

                        // We'll try a more direct approach first - use the PanelManager's built-in layout restoration
                        // if available, which might have special handling we're missing
                        if (PanelManager.restoreLayout && typeof PanelManager.restoreLayout === 'function') {
                            console.log('Using PanelManager.restoreLayout for more reliable restoration');
                            
                            try {
                                // Add panel configs to layout for proper restoration
                                const layoutWithPanelConfigs = {
                                    hierarchy: sessionData.layout.hierarchy,
                                    panelConfigs
                                };
                                
                                // Use the PanelManager's built-in layout restoration
                                await PanelManager.restoreLayout(layoutWithPanelConfigs);
                                
                                console.log('Layout restored through PanelManager');
                                
                                // Ensure the source panel selection is updated
                                if (typeof updateSourcePanelSelection === 'function') {
                                    console.log('Updating source panel selection with callback');
                                    updateSourcePanelSelection();
                                } else if (PanelManager.updateSourcePanelSelection) {
                                    console.log('Updating source panel selection with public method');
                                    PanelManager.updateSourcePanelSelection();
                                }
                                
                                return; // Skip the rest of the restoration if this worked
                            } catch (error) {
                                console.error('Error using PanelManager.restoreLayout:', error);
                                console.log('Falling back to manual restoration process');
                            }
                        }
                        
                        // If we reach here, either PanelManager.restoreLayout doesn't exist or it failed
                        // So we'll use our custom implementation
                        
                        // First pass: Only build the DOM structure without the panels
                        // This creates the correct divs, resize handles, etc.
                        const layoutHierarchy = sessionData.layout.hierarchy;
                        
                        // Build the layout structure first with empty dummy elements
                        for (const node of layoutHierarchy) {
                            console.log('Processing layout node:', node.type);
                            
                            try {
                                const domElement = LayoutManager.rebuildLayoutFromHierarchy(
                                    node,
                                    container,
                                    // Dummy tile creator that just creates an empty div with the proper ID
                                    (id) => {
                                        console.log('Creating tile element for ID:', id);
                                        
                                        const tileConfig = panelConfigs[id];
                                        if (tileConfig && tileConfig.isSelectionTile) {
                                            // Create a selection tile placeholder
                                            const selectionTile = document.createElement('div');
                                            selectionTile.className = 'tile-selector';
                                            selectionTile.dataset.tileId = id;
                                            selectionTile.dataset.isSelectionTile = 'true';
                                            return selectionTile;
                                        } else {
                                            // Create a tile placeholder
                                            const tile = document.createElement('div');
                                            tile.className = 'tile';
                                            tile.dataset.tileId = id;
                                            return tile;
                                        }
                                    },
                                    // Empty callback - we'll create panels in second pass
                                    () => {}
                                );
                                
                                if (domElement) {
                                    console.log('Created DOM element for node');
                                } else {
                                    console.warn('Failed to create DOM element for node');
                                }
                            } catch (err) {
                                console.error('Error rebuilding layout node:', err);
                            }
                        }
                        
                        // 8. Set up all resize handles
                        document.querySelectorAll('.split-handle').forEach(handle => {
                            const handleContainer = handle.parentElement;
                            if (handleContainer && handleContainer.classList.contains('split-container')) {
                                const panes = handleContainer.querySelectorAll('.split-pane');
                                
                                if (panes.length === 2) {
                                    const direction = handleContainer.dataset.splitDirection;
                                    console.log(`Setting up resize handle with direction: ${direction}`);
                                    LayoutManager.setupResizableHandle(handle, panes[0], panes[1], direction);
                                }
                            }
                        });
                        
                        console.log('Now creating actual panels...');
                        
                        // 9. Second pass: Replace dummy elements with actual panels
                        // First, find all the selection tiles that need to be created
                        const selectionTilePlaceholders = Array.from(container.querySelectorAll('.tile-selector:not([data-is-bottom-selector="true"])'));
                        console.log(`Found ${selectionTilePlaceholders.length} selection tile placeholders`);
                        
                        for (const placeholder of selectionTilePlaceholders) {
                            const tileId = placeholder.dataset.tileId;
                            console.log(`Processing selection tile: ${tileId}`);
                            
                            // We need to create a real selection tile
                            // This requires access to PanelManager's createSelectionTileInPane method
                            if (tileId) {
                                const parentPane = placeholder.parentElement;
                                if (parentPane) {
                                    // First try to use _createSelectionTileInPane if available
                                    if (typeof PanelManager._createSelectionTileInPane === 'function') {
                                        console.log('Creating selection tile with private method');
                                        placeholder.remove();
                                        const newTile = PanelManager._createSelectionTileInPane(parentPane);
                                        if (newTile) {
                                            newTile.dataset.tileId = tileId;
                                        }
                                    } else {
                                        // If _createSelectionTileInPane is not available, we'll have to keep the placeholder
                                        console.warn('Cannot replace selection tile placeholder - private method not accessible');
                                    }
                                }
                            }
                        }
                        
                        // Then create the actual panels
                        const tilePlaceholders = Array.from(container.querySelectorAll('.tile'));
                        console.log(`Found ${tilePlaceholders.length} tile placeholders`);
                        
                        for (const placeholder of tilePlaceholders) {
                            const tileId = placeholder.dataset.tileId;
                            const tileConfig = panelConfigs[tileId];
                            
                            if (tileId && tileConfig && !tileConfig.isSelectionTile) {
                                console.log(`Creating panel for tile: ${tileId} of type: ${tileConfig.type}`);
                                
                                // Get the panel type and config
                                const { type, config } = tileConfig;
                                
                                try {
                                    const parentPane = placeholder.parentElement;
                                    if (parentPane && PanelManager.createPanel) {
                                        // We need to preserve the placeholder position
                                        const nextSibling = placeholder.nextSibling;
                                        placeholder.remove();
                                        
                                        // Create the actual panel with the saved configuration
                                        console.log(`Creating panel of type ${type} with ID ${tileId}`);
                                        const panel = PanelManager.createPanel(
                                            type, 
                                            { 
                                                ...config, 
                                                id: tileId,
                                                // Ensure we have a valid title
                                                title: tileConfig.title || `${type.charAt(0).toUpperCase() + type.slice(1)}`
                                            }, 
                                            parentPane
                                        );
                                        
                                        if (panel) {
                                            console.log(`Successfully created panel: ${tileId}`);
                                        } else {
                                            console.warn(`Failed to create panel: ${tileId}`);
                                        }
                                    }
                                } catch (error) {
                                    console.error(`Error creating panel ${tileId}:`, error);
                                }
                            }
                        }
                        
                        // 10. Ensure the source panel selection is updated
                        console.log('Final update of source panel selection');
                        if (typeof updateSourcePanelSelection === 'function') {
                            console.log('Updating source panel selection with callback');
                            updateSourcePanelSelection();
                        } else if (PanelManager.updateSourcePanelSelection) {
                            console.log('Updating source panel selection with public method');
                            PanelManager.updateSourcePanelSelection();
                        }
                        
                    } catch (error) {
                        console.error('Error restoring layout, falling back to simple panel creation:', error);
                        _createFallbackLayout(container, panelConfigs);
                    }
                } else {
                    console.warn('No layout hierarchy found, using fallback method');
                    _createFallbackLayout(container, panelConfigs);
                }
                
                // 11. Trigger a window resize to ensure all plots are properly sized
                setTimeout(() => {
                    window.dispatchEvent(new Event('resize'));
                    console.log('Session restore complete');
                }, 500);
            }
        } catch (error) {
            console.error('Error applying session data:', error);
            throw error;
        }
    }
    
    /**
     * Create a fallback layout when the hierarchical layout restoration fails
     * @param {HTMLElement} container - The container element
     * @param {Object} panelConfigs - The panel configurations
     * @private
     */
    function _createFallbackLayout(container, panelConfigs) {
        console.log('Creating fallback layout as last resort');
        
        // Simple fallback: just create all active panels sequentially
        const activePanels = Object.values(panelConfigs).filter(
            panel => panel.active && !panel.isSelectionTile
        );
        
        console.log(`Found ${activePanels.length} active panels to create`);
        
        // First make sure the container is ready
        if (!container) {
            console.error('Container not found for fallback layout');
            return;
        }
        
        // Create each panel directly in the container
        for (const panel of activePanels) {
            try {
                console.log(`Creating panel via fallback: ${panel.id} of type ${panel.type}`);
                
                // Try to get a template tile first if needed
                const template = document.getElementById('tile-template');
                if (template) {
                    console.log('Found tile template, using it to create proper tile structure');
                    
                    // Clone the template for this panel
                    const tile = template.content.cloneNode(true).querySelector('.tile');
                    tile.dataset.tileId = panel.id;
                    
                    // Add the tile to the container
                    container.appendChild(tile);
                    
                    // Get the content container from the tile
                    const contentContainer = tile.querySelector('.tile-content');
                    if (contentContainer) {
                        // Use the PanelManager to create the panel in the content container
                        try {
                            const constructor = PanelManager._panelTypes ? 
                                PanelManager._panelTypes.get(panel.type) : null;
                                
                            if (constructor) {
                                console.log(`Using constructor directly for ${panel.type}`);
                                const panelInstance = new constructor(contentContainer, {
                                    id: panel.id,
                                    title: panel.title,
                                    ...panel.config
                                });
                                
                                // Initialize the panel
                                if (panelInstance && panelInstance.init) {
                                    panelInstance.init();
                                }
                            } else {
                                console.log('No constructor found, using PanelManager.createPanel');
                                // Otherwise fall back to using PanelManager.createPanel
                                PanelManager.createPanel(panel.type, {
                                    ...panel.config,
                                    id: panel.id,
                                    title: panel.title
                                }, container);
                            }
                        } catch (err) {
                            console.error(`Error creating panel in content container for ${panel.id}:`, err);
                            
                            // Last resort - try PanelManager.createPanel
                            PanelManager.createPanel(panel.type, {
                                ...panel.config,
                                id: panel.id,
                                title: panel.title
                            }, container);
                        }
                    } else {
                        console.warn('No content container found in tile template, using direct method');
                        PanelManager.createPanel(panel.type, {
                            ...panel.config,
                            id: panel.id,
                            title: panel.title
                        }, container);
                    }
                } else {
                    console.log('No tile template found, using PanelManager.createPanel directly');
                    // Just use the normal createPanel method
                    PanelManager.createPanel(panel.type, {
                        ...panel.config,
                        id: panel.id,
                        title: panel.title
                    }, container);
                }
            } catch (error) {
                console.error(`Failed to create panel ${panel.id}:`, error);
            }
        }
        
        // Ensure source panel selection is updated
        console.log('Updating source panel selection in fallback layout');
        if (PanelManager.updateSourcePanelSelection) {
            PanelManager.updateSourcePanelSelection();
        }
    }
    
    /**
     * Get the current session
     * @returns {Object|null} - Current session data or null if no session is loaded
     */
    function getCurrentSession() {
        return _currentSession;
    }
    
    /**
     * Check if a session is currently loaded
     * @returns {boolean} - True if a session is loaded
     */
    function hasSession() {
        return _currentSession !== null;
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
        hasSession
    };
})();

// Export the module
export { SessionManager };
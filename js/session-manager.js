/**
 * Session Manager module for AnnZarro
 * Handles saving, loading, and managing sessions
 */
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
            // Gather session data
            const sessionData = _gatherSessionData(name);
            
            // Send to API
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
            
            // Store as current session
            _currentSession = {
                name: name,
                ...sessionData
            };
            
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
            
            // Apply the session data
            await _applySessionData(sessionData);
            
            // Store as current session
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
            
            // If deleting current session, reset current session
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
        
        // Create download link
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
     * Gather current application state for session storage
     * @param {string} name - Session name
     * @returns {Object} - Session data
     * @private
     */
    function _gatherSessionData(name) {
        // Get current dataset
        const dataset = DataManager.getCurrentDataset();
        const datasetStructure = DataManager.getDatasetStructure();
        
        // Get focused items
        const focusedCell = DataManager.getFocusedCell();
        const focusedGene = DataManager.getFocusedGene();
        const taxonomyId = DataManager.getTaxonomyId();
        
        // Get panel configurations - all panels including closed ones
        const panels = [];
        
        // First add active panels
        PanelManager.getActivePanels().forEach(panel => {
            panels.push({
                type: panel.getType(),
                id: panel.getId(),
                title: panel.getTitle(),
                config: panel.getConfig(),
                active: true
            });
        });
        
        // Then add closed panels if there's a function to get all panels
        if (PanelManager.getAllPanels) {
            // Get all panels including closed ones
            const allPanels = PanelManager.getAllPanels();
            const activePanelIds = new Set(PanelManager.getActivePanels().map(p => p.getId()));
            
            // Filter to just get closed panels
            allPanels.forEach(panel => {
                if (!activePanelIds.has(panel.getId())) {
                    panels.push({
                        type: panel.getType(),
                        id: panel.getId(),
                        title: panel.getTitle(),
                        config: panel.getConfig(),
                        active: false
                    });
                }
            });
        }
        
        // Save layout dimensions
        const layout = PanelManager.saveLayout();
        
        // Create session data
        return {
            name: name,
            timestamp: new Date().toISOString(),
            dataset: dataset,
            datasetName: datasetStructure ? datasetStructure.name : '',
            constants: {
                focusedCell,
                focusedGene,
                taxonomyId
            },
            panels: panels,
            layout: layout
        };
    }
    
    /**
     * Apply loaded session data to restore the application state
     * @param {Object} sessionData - Session data
     * @returns {Promise<void>}
     * @private
     */
    async function _applySessionData(sessionData) {
        // Reset current state
        PanelManager.resetPanels();
        
        // Load the dataset
        if (sessionData.dataset) {
            try {
                await DataManager.setCurrentDataset(sessionData.dataset);
                
                // Update UI to show dataset details
                const datasetNameEl = document.getElementById('dataset-path');
                if (datasetNameEl) {
                    datasetNameEl.textContent = sessionData.datasetName || sessionData.dataset;
                }
                
                const cellCountEl = document.getElementById('cell-count');
                const geneCountEl = document.getElementById('gene-count');
                const datasetStructure = DataManager.getDatasetStructure();
                
                if (datasetStructure) {
                    if (cellCountEl) cellCountEl.textContent = datasetStructure.n_obs || 0;
                    if (geneCountEl) geneCountEl.textContent = datasetStructure.n_vars || 0;
                }
                
                // Restore constants
                if (sessionData.constants) {
                    const { focusedCell, focusedGene, taxonomyId } = sessionData.constants;
                    
                    if (focusedCell) DataManager.setFocusedCell(focusedCell);
                    if (focusedGene) DataManager.setFocusedGene(focusedGene);
                    if (taxonomyId) DataManager.setTaxonomyId(taxonomyId);
                    
                    // Update UI for constants
                    const focusedCellSelect = document.getElementById('focused-cell');
                    const focusedGeneSelect = document.getElementById('focused-gene');
                    const taxonomyIdSelect = document.getElementById('taxonomy-id');
                    
                    if (focusedCellSelect && focusedCell) {
                        focusedCellSelect.value = focusedCell;
                    }
                    
                    if (focusedGeneSelect && focusedGene) {
                        focusedGeneSelect.value = focusedGene;
                    }
                    
                    if (taxonomyIdSelect && taxonomyId) {
                        taxonomyIdSelect.value = taxonomyId;
                    }
                }
                
                // Recreate panels with layout information if available
                if (sessionData.panels && Array.isArray(sessionData.panels)) {
                    // First, clear all panels
                    PanelManager.resetPanels();
                    
                    // Only recreate active panels from the session
                    const activePanels = sessionData.panels.filter(panel => panel.active !== false);
                    
                    activePanels.forEach(panelData => {
                        const { type, config, id } = panelData;
                        
                        // Check if we have layout info for this panel
                        let panelConfig = { ...config };
                        
                        if (sessionData.layout && sessionData.layout.panels && sessionData.layout.panels[id]) {
                            // Merge the layout dimensions into the panel config
                            panelConfig = {
                                ...panelConfig,
                                ...sessionData.layout.panels[id]
                            };
                        } else if (sessionData.layout && sessionData.layout.tiles && sessionData.layout.tiles[id]) {
                            // Use the tile dimensions if panel dimensions aren't available
                            const tileDimensions = sessionData.layout.tiles[id];
                            panelConfig.height = tileDimensions.height;
                            panelConfig.width = tileDimensions.width;
                        }
                        
                        // Create the panel with the enhanced config
                        PanelManager.createPanel(type, panelConfig);
                    });
                    
                    // Store closed panels for potential cloning (but don't display them)
                    const closedPanels = sessionData.panels.filter(panel => panel.active === false);
                    closedPanels.forEach(panelData => {
                        const { type, config, id } = panelData;
                        
                        // Add to panel registry but don't display
                        // This is handled internally by the PanelManager to store closed panels
                        if (PanelManager.registerClosedPanel) {
                            PanelManager.registerClosedPanel(type, config, id);
                        }
                    });
                }
                
                // Restore layout dimensions with multiple attempts
                if (sessionData.layout) {
                    // First attempt
                    setTimeout(() => {
                        console.log('First attempt to restore layout');
                        PanelManager.restoreLayout(sessionData.layout);
                        
                        // Second attempt after panels have fully rendered
                        setTimeout(() => {
                            console.log('Second attempt to restore layout');
                            PanelManager.restoreLayout(sessionData.layout);
                            
                            // Third attempt as a final check
                            setTimeout(() => {
                                console.log('Third attempt to restore layout');
                                PanelManager.restoreLayout(sessionData.layout);
                            }, 1000);
                        }, 500);
                    }, 200);
                }
            } catch (error) {
                console.error('Error loading dataset from session:', error);
                throw new Error(`Failed to load dataset: ${error.message}`);
            }
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

// Make available for both browser global and CommonJS environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SessionManager;
} else {
    window.SessionManager = SessionManager;
}
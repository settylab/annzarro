/**
 * Panel Set Manager module for AnnZarro
 * Handles saving, loading, and managing panel sets
 * 
 * Functionality:
 * 1. Saves panel configurations but not layout information
 * 2. When loading, adds panels to available panels as closed panels
 * 3. Maintains unique panel names to avoid conflicts
 */
import { Config } from './config.js';
import { DataManager } from './data-manager.js';
import { PanelManager } from './panel-manager.js';
import { LayoutManager } from './layout-manager.js';

const SessionManager = (function() {
    // Private variables
    let _currentSession = null; // Stores the current panel set
    let _autosaveTimer = null; // Timer for autosave
    
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
        if (!name) {
            console.error('Panel set name is required');
            return { status: 'error', message: 'Panel set name is required' };
        }
        
        try {
            // Create the panel set data structure
            const sessionData = {};
            sessionData.name = name;
            sessionData.timestamp = new Date().toISOString();
            
            // 1. Save dataset information
            sessionData.dataset = DataManager.getCurrentDataset();
            // Get dataset name from URL parameter if available
            const urlParams = new URLSearchParams(window.location.search);
            const datasetName = urlParams.get('dataset_name');
            sessionData.datasetName = datasetName || '';
            
            // 2. Save focus state
            sessionData.constants = {
                focusedCell: DataManager.getFocusedCell(),
                focusedGene: DataManager.getFocusedGene(),
                taxonomyId: DataManager.getTaxonomyId()
            };
            
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
                    const config = panel.getConfig() || {};
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
                throw new Error(`API error: ${response.statusText}`);
            }
            
            const result = await response.json();
            _currentSession = { name, ...sessionData };
            
            return result;
        } catch (error) {
            console.error('Error saving panel set:', error);
            return { status: 'error', message: error.message };
        }
    }
    
    /**
     * Load a panel set by name
     * @param {string} name - Panel set name
     * @returns {Promise<Object>} - Load result
     */
    async function loadSession(name) {
        if (!name) {
            console.error('Panel set name is required');
            return { status: 'error', message: 'Panel set name is required' };
        }
        
        try {
            // Check if this is the autosave session
            if (name === Config.AUTOSAVE.SESSION_NAME) {
                const autosaveData = loadFromLocalStorage();
                
                if (!autosaveData) {
                    throw new Error('Autosave data not found');
                }
                
                _applySessionPanels(autosaveData);
                return { status: 'success', message: 'Autosaved session loaded successfully' };
            }
            
            // Regular server-side session
            const response = await fetch(`${Config.API.SESSIONS_LOAD}?name=${encodeURIComponent(name)}`);
            
            if (!response.ok) {
                throw new Error(`API error: ${response.statusText}`);
            }
            
            const sessionData = await response.json();
            _applySessionPanels(sessionData);
            
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
        if (!name) {
            console.error('Panel set name is required');
            return { status: 'error', message: 'Panel set name is required' };
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
                throw new Error(`API error: ${response.statusText}`);
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
    async function _applySessionData(sessionData) {
        try {
            console.log('Applying panel set data...', sessionData);
            
            // 1. Load the dataset first, if not already loaded or if different
            const currentDataset = DataManager.getCurrentDataset();
            if (sessionData.dataset && (!currentDataset || currentDataset !== sessionData.dataset)) {
                console.log('Loading dataset without destroying UI:', sessionData.dataset);
                
                // We'll manually update dataset info without calling methods that might reset the UI
                // Get dataset structure first
                const datasetStructure = await DataManager.getDatasetStructure(sessionData.dataset);
                
                // Only if dataset structure is successfully loaded, we'll update the current dataset
                if (datasetStructure) {
                    // Use DataManager to update the dataset reference but avoid triggering panel notifications
                    // Pass true for silent mode to prevent UI resets
                    await DataManager.setCurrentDataset(sessionData.dataset, true);
                    
                    // 2. Update UI dataset info manually
                    const datasetNameEl = document.getElementById('dataset-path');
                    if (datasetNameEl) {
                        datasetNameEl.textContent = sessionData.datasetName || sessionData.dataset;
                    }
                    
                    const cellCountEl = document.getElementById('cell-count');
                    const geneCountEl = document.getElementById('gene-count');
                    
                    if (cellCountEl) cellCountEl.textContent = datasetStructure.n_obs || 0;
                    if (geneCountEl) geneCountEl.textContent = datasetStructure.n_vars || 0;
                }
                
                // 3. Restore constants
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
            }
            
            // 4. Get panel configurations and register them as closed panels
            const panelConfigs = sessionData.panelConfigs || {};
            
            // Register all panels from the configuration as closed panels with unique names
            const existingPanels = PanelManager.getAllPanels();
            const existingTitles = new Set(existingPanels.map(panel => panel.getTitle()));
            
            Object.values(panelConfigs)
                .filter(panel => !panel.isSelectionTile)
                .forEach(panel => {
                    if (PanelManager.registerClosedPanel) {
                        // Make sure the title is unique
                        if (panel.title && existingTitles.has(panel.title)) {
                            // Find a unique name by adding a suffix
                            let counter = 1;
                            let newTitle;
                            do {
                                newTitle = `${panel.title} (${counter})`;
                                counter++;
                            } while (existingTitles.has(newTitle));
                            
                            panel.title = newTitle;
                            if (panel.config) {
                                panel.config.title = newTitle;
                            }
                        }
                        
                        existingTitles.add(panel.title);
                        
                        console.log(`Registering panel from panel set: ${panel.id} - ${panel.title}`);
                        PanelManager.registerClosedPanel(panel.type, panel.config, panel.id);
                    }
                });
            
            // 5. Ensure the source panel selection is updated to show the newly added panels
            if (PanelManager.updateSourcePanelSelection) {
                console.log('Updating source panel selection to show new panels');
                PanelManager.updateSourcePanelSelection();
            }
            
            // 6. Trigger a window resize to ensure all plots are properly sized if needed
            setTimeout(() => {
                window.dispatchEvent(new Event('resize'));
                console.log('Panel set loaded - panels added to available panels');
            }, 200);
        } catch (error) {
            console.error('Error applying panel set data:', error);
            throw error;
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

            // Get all existing panels to compare for uniqueness. 
            // Note: if panels have getID/getTitle, use these methods; otherwise, use direct id/title properties.
            const existingPanels = PanelManager.getAllPanels();
            const existingTitles = new Set(existingPanels.map(panel => panel.getTitle()));
            const existingIds = new Set(existingPanels.map(panel => panel.getId ? panel.getId() : panel.id));

            // Process each closed panel configuration
            Object.values(panelConfigs)
            .filter(panel => !panel.isSelectionTile)
            .forEach(panel => {
                if (PanelManager.registerClosedPanel) {
                    // Ensure the title is unique
                    if (panel.title && existingTitles.has(panel.title)) {
                        let counter = 1;
                        let newTitle;
                        do {
                            newTitle = `${panel.title} (${counter})`;
                            counter++;
                        } while (existingTitles.has(newTitle));
                        panel.title = newTitle;
                        if (panel.config) {
                            panel.config.title = newTitle;
                        }
                    }
                    existingTitles.add(panel.title);

                    // Ensure the id is unique
                    if (panel.id && existingIds.has(panel.id)) {
                        let counter = 1;
                        let newId;
                        do {
                            newId = `${panel.id}-${counter}`;
                            counter++;
                        } while (existingIds.has(newId));
                        panel.id = newId;
                        if (panel.config) {
                            panel.config.id = newId;
                        }
                    }
                    existingIds.add(panel.id);

                    // Register the panel as closed with the unique id
                    PanelManager.registerClosedPanel(panel.type, panel.config, panel.id);
                }
            });
            
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
        try {
            // Only autosave if we have panels to save
            const allPanels = PanelManager.getAllPanels ? PanelManager.getAllPanels() : PanelManager.getActivePanels();
            if (!allPanels || allPanels.length === 0) {
                return { status: 'skipped', message: 'No panels to autosave' };
            }
            
            // Create the autosave data structure
            const autosaveData = {};
            autosaveData.name = Config.AUTOSAVE.SESSION_NAME;
            autosaveData.timestamp = new Date().toISOString();
            autosaveData.isAutosave = true;
            
            // Save dataset information
            autosaveData.dataset = DataManager.getCurrentDataset();
            // Get dataset name from URL parameter if available
            const urlParams = new URLSearchParams(window.location.search);
            const datasetName = urlParams.get('dataset_name');
            autosaveData.datasetName = datasetName || '';
            
            // Save focus state
            autosaveData.constants = {
                focusedCell: DataManager.getFocusedCell(),
                focusedGene: DataManager.getFocusedGene(),
                taxonomyId: DataManager.getTaxonomyId()
            };
            
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
                    const config = panel.getConfig() || {};
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
        getAutosaveSession,
        clearAutosave
    };
})();

// Export the module
export { SessionManager };
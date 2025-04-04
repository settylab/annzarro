/**
 * Session Manager Module
 * 
 * Handles saving and loading application state
 */

const SessionManager = (function() {
    // Private variables
    let _sessionName = '';
    let _lastSavedTime = null;
    let _autoSaveInterval = null;
    const AUTO_SAVE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    
    /**
     * Initialize the session manager
     */
    function init() {
        // Set up event listeners
        document.getElementById('saveSessionBtn')?.addEventListener('click', showSaveDialog);
        document.getElementById('loadSessionBtn')?.addEventListener('click', showLoadDialog);
        document.getElementById('exportSessionBtn')?.addEventListener('click', exportSession);
        document.getElementById('importSessionBtn')?.addEventListener('click', importSession);
        
        // Handle upload field change
        const uploadField = document.getElementById('sessionFileInput');
        if (uploadField) {
            uploadField.addEventListener('change', handleFileUpload);
        }
        
        // Check for auto-recovery
        checkForAutoRecovery();
        
        // Set up auto-save
        setupAutoSave();
        
        console.log('SessionManager initialized');
    }
    
    /**
     * Set up auto-save functionality
     */
    function setupAutoSave() {
        // Clear any existing interval
        if (_autoSaveInterval) {
            clearInterval(_autoSaveInterval);
        }
        
        // Set up new interval
        _autoSaveInterval = setInterval(() => {
            // Only auto-save if a dataset is loaded
            if (DataManager.getActiveDataset()) {
                saveAutoRecovery();
            }
        }, AUTO_SAVE_INTERVAL_MS);
    }
    
    /**
     * Save current state to auto-recovery
     */
    function saveAutoRecovery() {
        try {
            const state = captureState();
            
            // Don't save if no dataset
            if (!state.dataset) return;
            
            localStorage.setItem('annzarro_auto_recovery', JSON.stringify(state));
            localStorage.setItem('annzarro_auto_recovery_time', new Date().toISOString());
            
            console.log('Auto-recovery state saved');
        } catch (error) {
            console.error('Error saving auto-recovery state:', error);
        }
    }
    
    /**
     * Check for auto-recovery state
     */
    function checkForAutoRecovery() {
        try {
            const recoveryTime = localStorage.getItem('annzarro_auto_recovery_time');
            if (!recoveryTime) return;
            
            const recoveryState = localStorage.getItem('annzarro_auto_recovery');
            if (!recoveryState) return;
            
            // Parse recovery time
            const time = new Date(recoveryTime);
            const timeString = time.toLocaleString();
            
            // Show recovery notification
            const container = document.createElement('div');
            container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
            container.style.zIndex = 1050;
            
            container.innerHTML = `
                <div id="recoveryToast" class="toast show" role="alert" aria-live="assertive" aria-atomic="true">
                    <div class="toast-header bg-info text-white">
                        <strong class="me-auto">Session Recovery</strong>
                        <small>${timeString}</small>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close"></button>
                    </div>
                    <div class="toast-body">
                        <p>An unsaved session from ${timeString} was found. Would you like to restore it?</p>
                        <div class="d-flex justify-content-end gap-2">
                            <button class="btn btn-sm btn-secondary" id="discardRecoveryBtn">Discard</button>
                            <button class="btn btn-sm btn-primary" id="restoreRecoveryBtn">Restore</button>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.appendChild(container);
            
            // Attach event handlers
            document.getElementById('discardRecoveryBtn').addEventListener('click', () => {
                // Clear recovery state
                localStorage.removeItem('annzarro_auto_recovery');
                localStorage.removeItem('annzarro_auto_recovery_time');
                
                // Hide toast
                const toast = bootstrap.Toast.getInstance(document.getElementById('recoveryToast'));
                if (toast) {
                    toast.hide();
                } else {
                    container.remove();
                }
            });
            
            document.getElementById('restoreRecoveryBtn').addEventListener('click', () => {
                // Restore state
                try {
                    const state = JSON.parse(recoveryState);
                    restoreState(state);
                    
                    // Set session name with recovery indicator
                    _sessionName = state.name + ' (Recovered)';
                    
                    // Show success notification
                    showNotification('Session recovered successfully', 'success');
                } catch (error) {
                    console.error('Error restoring recovery state:', error);
                    showNotification('Failed to restore session', 'error');
                }
                
                // Clear recovery state
                localStorage.removeItem('annzarro_auto_recovery');
                localStorage.removeItem('annzarro_auto_recovery_time');
                
                // Hide toast
                const toast = bootstrap.Toast.getInstance(document.getElementById('recoveryToast'));
                if (toast) {
                    toast.hide();
                } else {
                    container.remove();
                }
            });
        } catch (error) {
            console.error('Error checking for auto-recovery:', error);
        }
    }
    
    /**
     * Show the save session dialog
     */
    function showSaveDialog() {
        // Check if a dataset is loaded
        if (!DataManager.getActiveDataset()) {
            showNotification('No dataset loaded', 'error');
            return;
        }
        
        // Populate the session name field
        const sessionNameField = document.getElementById('sessionNameInput');
        if (sessionNameField) {
            sessionNameField.value = _sessionName || 'Session ' + new Date().toLocaleDateString();
        }
        
        // Show the modal
        const modal = new bootstrap.Modal(document.getElementById('saveSessionModal'));
        modal.show();
    }
    
    /**
     * Save the current session
     */
    async function saveSession() {
        try {
            // Get session name
            const sessionNameField = document.getElementById('sessionNameInput');
            const sessionName = sessionNameField ? sessionNameField.value.trim() : '';
            
            if (!sessionName) {
                showNotification('Please enter a session name', 'error');
                return;
            }
            
            // Update session name
            _sessionName = sessionName;
            
            // Capture state
            const state = captureState();
            state.name = sessionName;
            
            // Save to server
            const serverSave = document.getElementById('saveToServerCheck')?.checked;
            if (serverSave) {
                await saveToServer(state);
            }
            
            // Save to local storage
            saveToLocalStorage(state);
            
            // Update last saved time
            _lastSavedTime = new Date();
            
            // Close the modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('saveSessionModal'));
            if (modal) {
                modal.hide();
            }
            
            // Show success notification
            showNotification('Session saved successfully', 'success');
        } catch (error) {
            console.error('Error saving session:', error);
            showNotification('Failed to save session: ' + error.message, 'error');
        }
    }
    
    /**
     * Save session to server
     * @param {Object} state - Session state
     * @returns {Promise} - Promise that resolves when session is saved
     */
    async function saveToServer(state) {
        const response = await fetch('/api/v1/sessions/save', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(state)
        });
        
        if (!response.ok) {
            throw new Error(`Server error: ${response.status} ${response.statusText}`);
        }
        
        const result = await response.json();
        return result;
    }
    
    /**
     * Save session to local storage
     * @param {Object} state - Session state
     */
    function saveToLocalStorage(state) {
        try {
            // Get existing sessions
            let sessions = JSON.parse(localStorage.getItem('annzarro_sessions') || '[]');
            
            // Find if session with same name exists
            const existingIndex = sessions.findIndex(s => s.name === state.name);
            
            if (existingIndex !== -1) {
                // Update existing session
                sessions[existingIndex] = state;
            } else {
                // Add new session
                sessions.push(state);
            }
            
            // Save back to local storage
            localStorage.setItem('annzarro_sessions', JSON.stringify(sessions));
        } catch (error) {
            console.error('Error saving to local storage:', error);
            throw error;
        }
    }
    
    /**
     * Show the load session dialog
     */
    async function showLoadDialog() {
        try {
            // Get sessions from local storage
            const localSessions = JSON.parse(localStorage.getItem('annzarro_sessions') || '[]');
            
            // Get sessions from server
            let serverSessions = [];
            try {
                const response = await fetch('/api/v1/sessions/list');
                if (response.ok) {
                    serverSessions = await response.json();
                }
            } catch (error) {
                console.error('Error fetching server sessions:', error);
            }
            
            // Combine sessions
            const allSessions = [...localSessions];
            
            // Add server sessions that aren't already in local storage
            for (const serverSession of serverSessions) {
                if (!allSessions.some(s => s.name === serverSession.name)) {
                    allSessions.push({
                        ...serverSession,
                        source: 'server'
                    });
                }
            }
            
            // Sort by timestamp (newest first)
            allSessions.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
            
            // Populate the list
            const sessionsList = document.getElementById('sessionsListContainer');
            if (sessionsList) {
                if (allSessions.length === 0) {
                    sessionsList.innerHTML = '<div class="alert alert-info">No saved sessions found</div>';
                } else {
                    let html = '<div class="list-group">';
                    
                    for (const session of allSessions) {
                        const timestamp = session.timestamp ? new Date(session.timestamp).toLocaleString() : 'Unknown date';
                        const datasetName = session.dataset || 'Unknown dataset';
                        const source = session.source === 'server' ? '<span class="badge bg-primary">Server</span>' : '<span class="badge bg-secondary">Local</span>';
                        
                        html += `
                            <a href="#" class="list-group-item list-group-item-action session-item" data-session-name="${session.name}">
                                <div class="d-flex justify-content-between align-items-center">
                                    <h6 class="mb-1">${session.name}</h6>
                                    ${source}
                                </div>
                                <div class="d-flex justify-content-between align-items-center">
                                    <small class="text-muted">Dataset: ${datasetName}</small>
                                    <small class="text-muted">${timestamp}</small>
                                </div>
                            </a>
                        `;
                    }
                    
                    html += '</div>';
                    sessionsList.innerHTML = html;
                    
                    // Add click handlers
                    const sessionItems = sessionsList.querySelectorAll('.session-item');
                    sessionItems.forEach(item => {
                        item.addEventListener('click', (e) => {
                            e.preventDefault();
                            const sessionName = item.dataset.sessionName;
                            
                            // Find session
                            const session = allSessions.find(s => s.name === sessionName);
                            if (session) {
                                // Load session
                                loadSession(session);
                                
                                // Close the modal
                                const modal = bootstrap.Modal.getInstance(document.getElementById('loadSessionModal'));
                                if (modal) {
                                    modal.hide();
                                }
                            }
                        });
                    });
                }
            }
            
            // Show the modal
            const modal = new bootstrap.Modal(document.getElementById('loadSessionModal'));
            modal.show();
        } catch (error) {
            console.error('Error showing load dialog:', error);
            showNotification('Failed to load sessions list', 'error');
        }
    }
    
    /**
     * Load a session
     * @param {Object} session - Session object
     */
    async function loadSession(session) {
        try {
            let state = session;
            
            // If session is from server, fetch it
            if (session.source === 'server') {
                const response = await fetch(`/api/v1/sessions/load?name=${encodeURIComponent(session.name)}`);
                if (!response.ok) {
                    throw new Error(`Server error: ${response.status} ${response.statusText}`);
                }
                
                state = await response.json();
            }
            
            // Restore state
            await restoreState(state);
            
            // Update session name
            _sessionName = session.name;
            
            // Show success notification
            showNotification('Session loaded successfully', 'success');
        } catch (error) {
            console.error('Error loading session:', error);
            showNotification('Failed to load session: ' + error.message, 'error');
        }
    }
    
    /**
     * Export the current session to a file
     */
    function exportSession() {
        try {
            // Check if a dataset is loaded
            if (!DataManager.getActiveDataset()) {
                showNotification('No dataset loaded', 'error');
                return;
            }
            
            // Capture state
            const state = captureState();
            state.name = _sessionName || 'Exported Session';
            state.timestamp = new Date().toISOString();
            
            // Convert to JSON string
            const json = JSON.stringify(state, null, 2);
            
            // Create blob
            const blob = new Blob([json], { type: 'application/json' });
            
            // Create download link
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${state.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
            
            // Trigger download
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            // Show success notification
            showNotification('Session exported successfully', 'success');
        } catch (error) {
            console.error('Error exporting session:', error);
            showNotification('Failed to export session: ' + error.message, 'error');
        }
    }
    
    /**
     * Import a session from a file
     */
    function importSession() {
        // Trigger file input
        const fileInput = document.getElementById('sessionFileInput');
        if (fileInput) {
            fileInput.click();
        }
    }
    
    /**
     * Handle file upload
     * @param {Event} event - File input change event
     */
    function handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        
        reader.onload = function(e) {
            try {
                const state = JSON.parse(e.target.result);
                
                // Restore state
                restoreState(state);
                
                // Update session name
                _sessionName = state.name || 'Imported Session';
                
                // Show success notification
                showNotification('Session imported successfully', 'success');
            } catch (error) {
                console.error('Error importing session:', error);
                showNotification('Failed to import session: ' + error.message, 'error');
            }
        };
        
        reader.onerror = function() {
            showNotification('Failed to read file', 'error');
        };
        
        reader.readAsText(file);
        
        // Reset file input
        event.target.value = '';
    }
    
    /**
     * Capture the current application state
     * @returns {Object} - Application state
     */
    function captureState() {
        // Get dataset info
        const dataset = DataManager.getActiveDataset();
        const datasetInfo = DataManager.getDatasetInfo();
        
        // Return if no dataset
        if (!dataset) {
            return {};
        }
        
        // Basic state
        const state = {
            version: 1,
            timestamp: new Date().toISOString(),
            dataset: dataset,
            datasetName: datasetInfo.name || '',
            focusedGene: DataManager.getFocusedGene(),
            focusedCell: DataManager.getFocusedCell(),
            taxonomy: DataManager.getTaxonomy(),
            geneSets: DataManager.getAllGeneSets(),
            cellSets: DataManager.getAllCellSets()
        };
        
        // Get panel layout state
        if (window.PanelManager) {
            state.layout = PanelManager.getLayoutState();
        }
        
        return state;
    }
    
    /**
     * Restore application state
     * @param {Object} state - Application state
     */
    async function restoreState(state) {
        try {
            // Check if we need to load a different dataset
            const currentDataset = DataManager.getActiveDataset();
            
            if (state.dataset && state.dataset !== currentDataset) {
                // Load the dataset
                await DataManager.loadDataset(state.dataset);
            }
            
            // Restore focused items
            if (state.focusedGene !== undefined) {
                DataManager.setFocusedGene(state.focusedGene);
            }
            
            if (state.focusedCell !== undefined) {
                DataManager.setFocusedCell(state.focusedCell);
            }
            
            // Restore taxonomy
            if (state.taxonomy) {
                DataManager.setTaxonomy(state.taxonomy.taxonomyId, state.taxonomy.species);
            }
            
            // Restore sets
            if (state.geneSets) {
                for (const name in state.geneSets) {
                    DataManager.setGeneSet(name, state.geneSets[name]);
                }
            }
            
            if (state.cellSets) {
                for (const name in state.cellSets) {
                    DataManager.setCellSet(name, state.cellSets[name]);
                }
            }
            
            // Restore layout
            if (state.layout && window.PanelManager) {
                PanelManager.restoreLayoutState(state.layout);
            }
        } catch (error) {
            console.error('Error restoring state:', error);
            throw error;
        }
    }
    
    /**
     * Show a notification
     * @param {string} message - Notification message
     * @param {string} type - Notification type (success, error, info, warning)
     */
    function showNotification(message, type = 'info') {
        // Define color for each type
        const colors = {
            success: 'bg-success',
            error: 'bg-danger',
            info: 'bg-info',
            warning: 'bg-warning'
        };
        
        // Create toast container if it doesn't exist
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
            container.style.zIndex = 1050;
            document.body.appendChild(container);
        }
        
        // Create toast element
        const toastId = 'toast-' + Date.now();
        const toast = document.createElement('div');
        toast.id = toastId;
        toast.className = 'toast show';
        toast.setAttribute('role', 'alert');
        toast.setAttribute('aria-live', 'assertive');
        toast.setAttribute('aria-atomic', 'true');
        
        // Set toast content
        toast.innerHTML = `
            <div class="toast-header ${colors[type] || 'bg-info'} text-white">
                <strong class="me-auto">${type.charAt(0).toUpperCase() + type.slice(1)}</strong>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
            <div class="toast-body">
                ${message}
            </div>
        `;
        
        // Add to container
        container.appendChild(toast);
        
        // Initialize Bootstrap toast
        const bsToast = new bootstrap.Toast(toast, {
            autohide: true,
            delay: 5000
        });
        
        // Auto-remove when hidden
        toast.addEventListener('hidden.bs.toast', () => {
            toast.remove();
        });
        
        // Show toast
        bsToast.show();
    }
    
    // Public API
    return {
        init,
        saveSession,
        exportSession,
        importSession,
        captureState,
        restoreState,
        showNotification
    };
})();

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    SessionManager.init();
});

// Export as module and global
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SessionManager;
} else {
    window.SessionManager = SessionManager;
}
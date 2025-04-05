/**
 * Main Application Module for AnnZarro
 */
const App = (function() {
    // Private variables
    let _isInitialized = false;
    let _sessionModal = null;
    let _addTileModal = null;
    
    /**
     * Initialize the application
     */
    async function init() {
        if (_isInitialized) return;
        
        try {
            console.log('Initializing AnnZarro application...');
            
            // Initialize UI components
            _initUI();
            
            // Initialize panel manager
            PanelManager.init('tile-container');
            
            // Load available datasets
            await _loadDatasets();
            
            // Set default dataset if available
            const datasets = await DataManager.loadDatasets();
            if (datasets && datasets.length > 0) {
                await _loadDataset(datasets[0].path);
            }
            
            _isInitialized = true;
            console.log('AnnZarro application initialized successfully');
        } catch (error) {
            console.error('Error initializing application:', error);
            _showError('Initialization failed', error.message);
        }
    }
    
    /**
     * Initialize UI components
     * @private
     */
    function _initUI() {
        // Setup bootstrap modals
        _sessionModal = new bootstrap.Modal(document.getElementById('session-modal'));
        _addTileModal = new bootstrap.Modal(document.getElementById('add-tile-modal'));
        
        // Setup dataset selector
        const datasetSelector = document.getElementById('dataset-selector');
        if (datasetSelector) {
            datasetSelector.addEventListener('change', async (e) => {
                const datasetPath = e.target.value;
                if (datasetPath) {
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
        
        // Setup gene and cell selectors
        const focusedGeneSelect = document.getElementById('focused-gene');
        if (focusedGeneSelect) {
            focusedGeneSelect.addEventListener('change', (e) => {
                const geneName = e.target.value;
                if (geneName) {
                    DataManager.setFocusedGene(geneName);
                }
            });
        }
        
        const focusedCellSelect = document.getElementById('focused-cell');
        if (focusedCellSelect) {
            focusedCellSelect.addEventListener('change', (e) => {
                const cellName = e.target.value;
                if (cellName) {
                    DataManager.setFocusedCell(cellName);
                }
            });
        }
        
        const taxonomyIdSelect = document.getElementById('taxonomy-id');
        if (taxonomyIdSelect) {
            taxonomyIdSelect.addEventListener('change', (e) => {
                const taxonomyId = e.target.value;
                if (taxonomyId) {
                    DataManager.setTaxonomyId(taxonomyId);
                }
            });
        }
        
        // Setup session modal buttons
        const confirmSessionBtn = document.getElementById('btn-confirm-session');
        if (confirmSessionBtn) {
            confirmSessionBtn.addEventListener('click', _handleSessionModalConfirm);
        }
        
        console.log('UI components initialized');
    }
    
    /**
     * Load available datasets
     * @private
     */
    async function _loadDatasets() {
        try {
            const datasets = await DataManager.loadDatasets();
            
            // Populate dataset selector
            const datasetSelector = document.getElementById('dataset-selector');
            if (datasetSelector) {
                datasetSelector.innerHTML = '';
                
                if (datasets && datasets.length > 0) {
                    datasets.forEach(dataset => {
                        const option = document.createElement('option');
                        option.value = dataset.path;
                        option.textContent = dataset.name || dataset.path;
                        datasetSelector.appendChild(option);
                    });
                } else {
                    const option = document.createElement('option');
                    option.value = '';
                    option.textContent = 'No datasets available';
                    datasetSelector.appendChild(option);
                }
            }
            
            console.log(`${datasets.length} datasets loaded`);
            
            return datasets;
        } catch (error) {
            console.error('Error loading datasets:', error);
            _showError('Failed to load datasets', error.message);
            return [];
        }
    }
    
    /**
     * Load a specific dataset
     * @param {string} datasetPath - Path to the dataset
     * @private
     */
    async function _loadDataset(datasetPath) {
        try {
            console.log(`Loading dataset: ${datasetPath}`);
            
            // Reset UI
            PanelManager.resetPanels();
            
            // Show loading indicators
            document.getElementById('cell-count').textContent = 'Loading...';
            document.getElementById('gene-count').textContent = 'Loading...';
            document.getElementById('dataset-path').textContent = datasetPath;
            
            // Load dataset
            const datasetStructure = await DataManager.setCurrentDataset(datasetPath);
            
            // Update dataset info
            document.getElementById('cell-count').textContent = datasetStructure.n_obs || 0;
            document.getElementById('gene-count').textContent = datasetStructure.n_vars || 0;
            document.getElementById('dataset-path').textContent = datasetStructure.name || datasetPath;
            
            // Populate gene and cell selectors
            await _populateGeneSelector();
            await _populateCellSelector();
            
            // Notify panels of dataset change
            PanelManager.notifyPanels('datasetChanged', { dataset: datasetPath });
            
            console.log('Dataset loaded successfully');
        } catch (error) {
            console.error('Error loading dataset:', error);
            _showError('Failed to load dataset', error.message);
        }
    }
    
    /**
     * Populate the gene selector
     * @private
     */
    async function _populateGeneSelector() {
        const focusedGeneSelect = document.getElementById('focused-gene');
        if (!focusedGeneSelect) return;
        
        // Clear existing options
        focusedGeneSelect.innerHTML = '<option value="">Select Gene</option>';
        
        try {
            const genes = DataManager.getGenes();
            
            if (genes && genes.length > 0) {
                // Add first set of genes (limit to avoid performance issues)
                const maxGenes = Math.min(genes.length, 1000);
                
                for (let i = 0; i < maxGenes; i++) {
                    const option = document.createElement('option');
                    option.value = genes[i];
                    option.textContent = genes[i];
                    focusedGeneSelect.appendChild(option);
                }
                
                // Setup select2 for searching (if available)
                if (window.$ && $.fn.select2) {
                    $(focusedGeneSelect).select2({
                        placeholder: 'Select or search for a gene',
                        allowClear: true,
                        data: genes.map(gene => ({ id: gene, text: gene }))
                    });
                }
            }
        } catch (error) {
            console.error('Error populating gene selector:', error);
        }
    }
    
    /**
     * Populate the cell selector
     * @private
     */
    async function _populateCellSelector() {
        const focusedCellSelect = document.getElementById('focused-cell');
        if (!focusedCellSelect) return;
        
        // Clear existing options
        focusedCellSelect.innerHTML = '<option value="">Select Cell</option>';
        
        try {
            const cells = DataManager.getCells();
            
            if (cells && cells.length > 0) {
                // Add first set of cells (limit to avoid performance issues)
                const maxCells = Math.min(cells.length, 1000);
                
                for (let i = 0; i < maxCells; i++) {
                    const option = document.createElement('option');
                    option.value = cells[i];
                    option.textContent = cells[i];
                    focusedCellSelect.appendChild(option);
                }
                
                // Setup select2 for searching (if available)
                if (window.$ && $.fn.select2) {
                    $(focusedCellSelect).select2({
                        placeholder: 'Select or search for a cell',
                        allowClear: true,
                        data: cells.map(cell => ({ id: cell, text: cell }))
                    });
                }
            }
        } catch (error) {
            console.error('Error populating cell selector:', error);
        }
    }
    
    /**
     * Show save session modal
     * @private
     */
    function _showSaveSessionModal() {
        // Set up modal for save mode
        document.getElementById('session-modal-title').textContent = 'Save Session';
        document.getElementById('save-session-container').style.display = 'block';
        document.getElementById('session-list-container').style.display = 'none';
        document.getElementById('btn-confirm-session').textContent = 'Save';
        
        // Clear previous input
        document.getElementById('session-name').value = '';
        
        // Set modal data attribute for type
        document.getElementById('session-modal').dataset.modalType = 'save';
        
        // Show modal
        _sessionModal.show();
    }
    
    /**
     * Show load session modal
     * @private
     */
    async function _showLoadSessionModal() {
        // Set up modal for load mode
        document.getElementById('session-modal-title').textContent = 'Load Session';
        document.getElementById('save-session-container').style.display = 'none';
        document.getElementById('session-list-container').style.display = 'block';
        document.getElementById('btn-confirm-session').textContent = 'Load';
        
        // Set modal data attribute for type
        document.getElementById('session-modal').dataset.modalType = 'load';
        
        // Clear previous selection
        document.querySelector('#session-list tr.selected')?.classList.remove('selected');
        
        // Load sessions
        await _loadSessionList();
        
        // Show modal
        _sessionModal.show();
    }
    
    /**
     * Load the list of saved sessions
     * @private
     */
    async function _loadSessionList() {
        const sessionList = document.getElementById('session-list');
        sessionList.innerHTML = '<tr><td colspan="4">Loading sessions...</td></tr>';
        
        try {
            const sessions = await SessionManager.listSessions();
            
            if (sessions && sessions.length > 0) {
                sessionList.innerHTML = '';
                
                sessions.forEach(session => {
                    const row = document.createElement('tr');
                    row.className = 'session-list-item';
                    row.dataset.sessionName = session.name;
                    
                    const dateStr = new Date(session.timestamp).toLocaleString();
                    
                    row.innerHTML = `
                        <td>${session.name}</td>
                        <td>${session.datasetName || session.dataset}</td>
                        <td>${dateStr}</td>
                        <td>
                            <button class="btn btn-sm btn-danger session-delete" title="Delete">
                                <i class="fas fa-trash"></i>
                            </button>
                            <button class="btn btn-sm btn-secondary session-export" title="Export">
                                <i class="fas fa-download"></i>
                            </button>
                        </td>
                    `;
                    
                    sessionList.appendChild(row);
                    
                    // Add click handler for selection
                    row.addEventListener('click', (e) => {
                        if (!e.target.closest('button')) {
                            document.querySelectorAll('#session-list tr.selected')
                                .forEach(el => el.classList.remove('selected'));
                            row.classList.add('selected');
                        }
                    });
                });
                
                // Add delete button handlers
                document.querySelectorAll('.session-delete').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const row = e.target.closest('tr');
                        const sessionName = row.dataset.sessionName;
                        
                        if (confirm(`Delete session "${sessionName}"?`)) {
                            const result = await SessionManager.deleteSession(sessionName);
                            if (result.status === 'success') {
                                row.remove();
                                if (sessionList.children.length === 0) {
                                    sessionList.innerHTML = '<tr><td colspan="4">No saved sessions</td></tr>';
                                }
                            } else {
                                _showError('Failed to delete session', result.message);
                            }
                        }
                    });
                });
                
                // Add export button handlers
                document.querySelectorAll('.session-export').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const sessionName = e.target.closest('tr').dataset.sessionName;
                        SessionManager.exportSession(sessionName);
                    });
                });
            } else {
                sessionList.innerHTML = '<tr><td colspan="4">No saved sessions</td></tr>';
            }
        } catch (error) {
            console.error('Error loading sessions:', error);
            sessionList.innerHTML = `<tr><td colspan="4">Error loading sessions: ${error.message}</td></tr>`;
        }
    }
    
    /**
     * Handle session modal confirm button click
     * @private
     */
    async function _handleSessionModalConfirm() {
        const modalType = document.getElementById('session-modal').dataset.modalType;
        
        if (modalType === 'save') {
            // Handle save session
            const sessionName = document.getElementById('session-name').value.trim();
            
            if (!sessionName) {
                alert('Please enter a session name');
                return;
            }
            
            const result = await SessionManager.saveSession(sessionName);
            
            if (result.status === 'success') {
                _sessionModal.hide();
                _showSuccess('Session saved', `Session "${sessionName}" saved successfully`);
            } else {
                _showError('Failed to save session', result.message);
            }
        } else if (modalType === 'load') {
            // Handle load session
            const selectedRow = document.querySelector('#session-list tr.selected');
            
            if (!selectedRow) {
                alert('Please select a session to load');
                return;
            }
            
            const sessionName = selectedRow.dataset.sessionName;
            
            const result = await SessionManager.loadSession(sessionName);
            
            if (result.status === 'success') {
                _sessionModal.hide();
                _showSuccess('Session loaded', `Session "${sessionName}" loaded successfully`);
            } else {
                _showError('Failed to load session', result.message);
            }
        }
    }
    
    /**
     * Show success message
     * @param {string} title - Success message title
     * @param {string} message - Success message
     * @private
     */
    function _showSuccess(title, message) {
        // In a real application, this would show a toast or notification
        console.log(`Success: ${title} - ${message}`);
        alert(`${title}: ${message}`);
    }
    
    /**
     * Show error message
     * @param {string} title - Error message title
     * @param {string} message - Error message
     * @private
     */
    function _showError(title, message) {
        // In a real application, this would show a toast or notification
        console.error(`Error: ${title} - ${message}`);
        alert(`${title}: ${message}`);
    }
    
    // Public API
    return {
        init
    };
})();

// Initialize the application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

// Make available for both browser global and CommonJS environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = App;
} else {
    window.App = App;
}
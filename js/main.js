/**
 * Main Application Module for AnnZarro
 */
import { PanelManager } from './panel-manager.js';
import { Config } from './config.js';
import { DataManager } from './data-manager.js';
import { SessionManager } from './session-manager.js';

const App = (function() {
    // Private variables
    let _isInitialized = false;
    let _sessionModal = null;
    
    /**
     * Initialize the application
     */
    async function init() {
        if (_isInitialized) return;
        
        try {
            console.log('Initializing AnnZarro application...');
            
            // Initialize Plotly with optimized canvas settings
            _initPlotly();
            
            // Initialize UI components
            _initUI();
            
            // Initialize panel manager
            // Make sure PanelManager is defined first
            if (typeof PanelManager === 'undefined') {
                console.error('PanelManager is not defined. Check script loading order.');
                throw new Error('PanelManager is not defined');
            }
            PanelManager.init('tile-container');
            
            // Load available datasets
            await _loadDatasets();
            
            // Load available sessions
            await _loadSessions();
            
            // Force show the welcome view - PanelManager will handle this with automatic welcome tile
            
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
     * Initialize Plotly.js with optimized canvas settings
     * @private
     */
    function _initPlotly() {
        if (typeof Plotly !== 'undefined') {
            console.log('Configuring Plotly.js for optimized canvas performance');
            
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
            
            // Use MutationObserver to set willReadFrequently attribute on canvas elements
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.addedNodes && mutation.addedNodes.length > 0) {
                        mutation.addedNodes.forEach((node) => {
                            if (node.querySelectorAll) {
                                const canvases = node.querySelectorAll('canvas');
                                canvases.forEach((canvas) => {
                                    const ctx = canvas.getContext('2d');
                                    if (ctx) {
                                        // Get the existing context and create a new one with willReadFrequently=true
                                        canvas.getContext('2d', { willReadFrequently: true });
                                    }
                                });
                            }
                        });
                    }
                });
            });
            
            // Start observing the document with the configured parameters
            observer.observe(document.body, { childList: true, subtree: true });
            
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
        
        // Setup gene and cell selectors with history navigation
        const focusedGeneSelect = document.getElementById('focused-gene');
        if (focusedGeneSelect) {
            focusedGeneSelect.addEventListener('change', (e) => {
                const geneName = e.target.value;
                if (geneName) {
                    DataManager.setFocusedGene(geneName);
                }
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
            
            // Always update select field with current gene, regardless of source
            if (focusedGeneSelect) {
                focusedGeneSelect.value = e.detail.gene;
                if (window.$ && $.fn.select2) {
                    $(focusedGeneSelect).trigger('change.select2');
                }
            }
        });
        
        const focusedCellSelect = document.getElementById('focused-cell');
        if (focusedCellSelect) {
            focusedCellSelect.addEventListener('change', (e) => {
                const cellName = e.target.value;
                if (cellName) {
                    DataManager.setFocusedCell(cellName);
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
            
            // Always update select field with current cell, regardless of source
            if (focusedCellSelect) {
                focusedCellSelect.value = e.detail.cell;
                if (window.$ && $.fn.select2) {
                    $(focusedCellSelect).trigger('change.select2');
                }
            }
        });
        
        // No asynchronous sorting events
        
        const taxonomyIdSelect = document.getElementById('taxonomy-id');
        if (taxonomyIdSelect) {
            // Populate options from Config.DEFAULTS.TAXONOMY_SPECIES
            taxonomyIdSelect.innerHTML = '';
            Object.entries(Config.DEFAULTS.TAXONOMY_SPECIES).forEach(([id, species]) => {
                const option = document.createElement('option');
                option.value = id;
                option.textContent = `${id} (${species})`;
                // Set selected if it matches the default taxonomy ID
                if (id === Config.DEFAULTS.TAXONOMY_ID) {
                    option.selected = true;
                }
                taxonomyIdSelect.appendChild(option);
            });
            
            // Add the ability to enter custom value using Select2
            if (window.$ && $.fn.select2) {
                $(taxonomyIdSelect).select2({
                    tags: true, // Allow custom values
                    placeholder: 'Select or enter a taxonomy ID',
                    width: '100%',
                    createTag: function(params) {
                        // Only create new options for numeric values that look like taxonomy IDs
                        const term = params.term.trim();
                        if (!term || !/^\d+$/.test(term)) {
                            return null;
                        }
                        
                        return {
                            id: term,
                            text: `${term} (Custom)`,
                            newTag: true
                        };
                    }
                });
                
                // Make sure select2 change events also trigger our taxonomy ID update
                $(taxonomyIdSelect).on('select2:select', function(e) {
                    const taxonomyId = e.params.data.id;
                    if (taxonomyId) {
                        DataManager.setTaxonomyId(taxonomyId);
                    }
                });
            }
            
            // Handle regular change event for non-select2 fallback
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
        
        // Clear existing options - no empty option to force a selection
        focusedGeneSelect.innerHTML = '';
        
        try {
            const genes = DataManager.getSortedGenes();
            
            if (genes && genes.length > 0) {
                // Use sorted genes for the dropdown
                
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
                        placeholder: 'Start typing to search for a gene...',
                        allowClear: false, // Don't allow clearing the selection
                        data: genes.map(gene => ({ id: gene, text: gene })),
                        width: '100%',
                        dropdownCssClass: 'gene-select-dropdown',
                        dropdownAutoWidth: true,
                        selectOnClose: false, // Don't select on close to preserve current selection
                        openOnEnter: false,
                        minimumResultsForSearch: 0, // Always show search box
                        searchInputPlaceholder: 'Type to filter...',
                        closeOnSelect: false // Keep dropdown open after selecting
                    });
                    
                    // Enable immediate search when dropdown is opened
                    $(focusedGeneSelect).on('select2:open', function() {
                        setTimeout(function() {
                            // Explicitly focus the search input field inside the dropdown
                            const searchField = document.querySelector('.select2-container--open .select2-search__field');
                            if (searchField) {
                                searchField.focus();
                                
                                // Add keyboard event listener for dropdown control
                                searchField.addEventListener('keydown', function(e) {
                                    // Escape key: close dropdown
                                    if (e.key === 'Escape') {
                                        $(focusedGeneSelect).select2('close');
                                        return;
                                    }
                                    
                                    // CTRL+Enter: select current highlighted item and close
                                    if (e.key === 'Enter' && e.ctrlKey) {
                                        const highlightedOption = document.querySelector('.select2-results__option--highlighted');
                                        if (highlightedOption) {
                                            // Get the text of the highlighted option
                                            const optionText = highlightedOption.textContent.trim();
                                            
                                            // Find corresponding option in select and select it
                                            const selectOptions = focusedGeneSelect.options;
                                            for (let i = 0; i < selectOptions.length; i++) {
                                                if (selectOptions[i].textContent.trim() === optionText) {
                                                    focusedGeneSelect.value = selectOptions[i].value;
                                                    $(focusedGeneSelect).trigger('change');
                                                    $(focusedGeneSelect).select2('close');
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                });
                            }
                        }, 10); // Small delay to ensure dropdown is fully rendered
                    });
                    
                    // Ensure Select2 change event also triggers focused gene update
                    $(focusedGeneSelect).on('select2:select', function(e) {
                        const geneName = e.params.data.id;
                        if (geneName) {
                            DataManager.setFocusedGene(geneName);
                        }
                    });
                    
                    // Prevent losing selection when dropdown is closed without selecting
                    $(focusedGeneSelect).on('select2:closing', function(e) {
                        // Store the current value to ensure it's preserved
                        const currentVal = $(focusedGeneSelect).val();
                        
                        // After dropdown closes, make sure the value is still set
                        setTimeout(() => {
                            if (currentVal && $(focusedGeneSelect).val() !== currentVal) {
                                $(focusedGeneSelect).val(currentVal).trigger('change');
                            }
                        }, 10);
                    });
                    
                    // Increase dropdown width on open
                    $(focusedGeneSelect).on('select2:open', function() {
                        setTimeout(function() {
                            $('.gene-select-dropdown').css({
                                'width': '400px'
                            });
                            $('.gene-select-dropdown .select2-results__options').css({
                                'max-height': '600px'
                            });
                        }, 0);
                    });
                }
                
                // Always set the first gene as selected (preselected by default)
                if (genes.length > 0) {
                    // Only update if different from current focused gene
                    const currentFocused = DataManager.getFocusedGene();
                    if (currentFocused !== genes[0]) {
                        DataManager.setFocusedGene(genes[0]);
                    }
                    
                    focusedGeneSelect.value = genes[0];
                    
                    // Update select2 if it's active
                    if (window.$ && $.fn.select2) {
                        $(focusedGeneSelect).trigger('change');
                    }
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
        
        // Clear existing options - no empty option to force a selection
        focusedCellSelect.innerHTML = '';
        
        try {
            const cells = DataManager.getSortedCells();
            
            if (cells && cells.length > 0) {
                // Use sorted cells for the dropdown
                
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
                        placeholder: 'Start typing to search for a cell...',
                        allowClear: false, // Don't allow clearing the selection
                        data: cells.map(cell => ({ id: cell, text: cell })),
                        width: '100%',
                        dropdownCssClass: 'cell-select-dropdown',
                        dropdownAutoWidth: true,
                        selectOnClose: false, // Don't select on close to preserve current selection
                        openOnEnter: false,
                        minimumResultsForSearch: 0, // Always show search box
                        searchInputPlaceholder: 'Type to filter...',
                        closeOnSelect: false // Keep dropdown open after selecting
                    });
                    
                    // Enable immediate search when dropdown is opened
                    $(focusedCellSelect).on('select2:open', function() {
                        setTimeout(function() {
                            // Explicitly focus the search input field inside the dropdown
                            const searchField = document.querySelector('.select2-container--open .select2-search__field');
                            if (searchField) {
                                searchField.focus();
                                
                                // Add keyboard event listener for dropdown control
                                searchField.addEventListener('keydown', function(e) {
                                    // Escape key: close dropdown
                                    if (e.key === 'Escape') {
                                        $(focusedCellSelect).select2('close');
                                        return;
                                    }
                                    
                                    // CTRL+Enter: select current highlighted item and close
                                    if (e.key === 'Enter' && e.ctrlKey) {
                                        const highlightedOption = document.querySelector('.select2-results__option--highlighted');
                                        if (highlightedOption) {
                                            // Get the text of the highlighted option
                                            const optionText = highlightedOption.textContent.trim();
                                            
                                            // Find corresponding option in select and select it
                                            const selectOptions = focusedCellSelect.options;
                                            for (let i = 0; i < selectOptions.length; i++) {
                                                if (selectOptions[i].textContent.trim() === optionText) {
                                                    focusedCellSelect.value = selectOptions[i].value;
                                                    $(focusedCellSelect).trigger('change');
                                                    $(focusedCellSelect).select2('close');
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                });
                            }
                        }, 10); // Small delay to ensure dropdown is fully rendered
                    });
                    
                    // Ensure Select2 change event also triggers focused cell update
                    $(focusedCellSelect).on('select2:select', function(e) {
                        const cellName = e.params.data.id;
                        if (cellName) {
                            DataManager.setFocusedCell(cellName);
                        }
                    });
                    
                    // Prevent losing selection when dropdown is closed without selecting
                    $(focusedCellSelect).on('select2:closing', function(e) {
                        // Store the current value to ensure it's preserved
                        const currentVal = $(focusedCellSelect).val();
                        
                        // After dropdown closes, make sure the value is still set
                        setTimeout(() => {
                            if (currentVal && $(focusedCellSelect).val() !== currentVal) {
                                $(focusedCellSelect).val(currentVal).trigger('change');
                            }
                        }, 10);
                    });
                    
                    // Increase dropdown width on open
                    $(focusedCellSelect).on('select2:open', function() {
                        setTimeout(function() {
                            $('.cell-select-dropdown').css({
                                'width': '400px'
                            });
                            $('.cell-select-dropdown .select2-results__options').css({
                                'max-height': '600px'
                            });
                        }, 0);
                    });
                }
                
                // Always set the first cell as selected (preselected by default)
                if (cells.length > 0) {
                    // Only update if different from current focused cell
                    const currentFocused = DataManager.getFocusedCell();
                    if (currentFocused !== cells[0]) {
                        DataManager.setFocusedCell(cells[0]);
                    }
                    
                    focusedCellSelect.value = cells[0];
                    
                    // Update select2 if it's active
                    if (window.$ && $.fn.select2) {
                        $(focusedCellSelect).trigger('change');
                    }
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
        //alert(`${title}: ${message}`);
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
    
    /**
     * Load available sessions
     * @private
     */
    async function _loadSessions() {
        try {
            return await SessionManager.listSessions();
        } catch (error) {
            console.error('Error loading sessions:', error);
            return [];
        }
    }
    
    /**
     * Show welcome view with quick-start options
     * @private
     */
    function _showWelcomeView() {
        // Create the welcome container
        const welcomeContainer = document.createElement('div');
        welcomeContainer.className = 'welcome-container';
        welcomeContainer.innerHTML = `
            <div class="welcome-header">
                <h2>Welcome to AnnZarro</h2>
                <p>Get started by creating a new panel or loading a saved session</p>
            </div>
            
            <div class="welcome-panels">
                <h3>Create a new panel</h3>
                <div class="tile-type-grid welcome-grid"></div>
            </div>
            
            <div class="welcome-sessions">
                <h3>Load a saved session</h3>
                <div class="sessions-list"></div>
            </div>
        `;
        
        // Add to the container
        const container = document.getElementById('tile-container');
        container.appendChild(welcomeContainer);
        
        // Add panel type options
        const panelGrid = welcomeContainer.querySelector('.welcome-grid');
        const panelTypes = [
            { type: 'cell-plot', label: 'Cell Plot', icon: 'fas fa-chart-scatter' },
            { type: 'gene-plot', label: 'Gene Plot', icon: 'fas fa-dna' },
            { type: 'cell-table', label: 'Cell Table', icon: 'fas fa-table' },
            { type: 'gene-table', label: 'Gene Table', icon: 'fas fa-th-list' },
            { type: 'gene-set', label: 'Gene Set Analysis', icon: 'fas fa-project-diagram' }
        ];
        
        panelTypes.forEach(panel => {
            const panelOption = document.createElement('div');
            panelOption.className = 'tile-type-option welcome-panel-option';
            panelOption.innerHTML = `
                <div class="tile-type-icon">
                    <i class="${panel.icon} fa-3x"></i>
                </div>
                <div class="tile-type-label">${panel.label}</div>
            `;
            
            // Add click handler
            panelOption.addEventListener('click', () => {
                // Remove welcome container
                welcomeContainer.remove();
                
                // Create the panel
                PanelManager.createPanel(panel.type);
            });
            
            panelGrid.appendChild(panelOption);
        });
        
        // Load and display sessions
        SessionManager.listSessions().then(sessions => {
            const sessionsList = welcomeContainer.querySelector('.sessions-list');
            
            if (sessions && sessions.length > 0) {
                sessions.forEach(session => {
                    const sessionItem = document.createElement('div');
                    sessionItem.className = 'session-item';
                    sessionItem.innerHTML = `
                        <div class="session-info">
                            <div class="session-name">${session.name}</div>
                            <div class="session-date">${new Date(session.timestamp).toLocaleDateString()}</div>
                            <div class="session-dataset">${session.datasetName || session.dataset}</div>
                        </div>
                        <button class="btn btn-sm btn-primary">Load</button>
                    `;
                    
                    // Add click handler
                    sessionItem.querySelector('button').addEventListener('click', async () => {
                        // Remove welcome container
                        welcomeContainer.remove();
                        
                        // Load the session
                        await SessionManager.loadSession(session.name);
                    });
                    
                    sessionsList.appendChild(sessionItem);
                });
            } else {
                sessionsList.innerHTML = '<div class="no-sessions">No saved sessions available</div>';
            }
        }).catch(error => {
            console.error('Error loading sessions:', error);
            const sessionsList = welcomeContainer.querySelector('.sessions-list');
            sessionsList.innerHTML = '<div class="error-message">Error loading sessions</div>';
        });
    }
    
    // Public API
    return {
        init
    };
})();

// Initialize the application when DOM is ready and all scripts are loaded
document.addEventListener('DOMContentLoaded', () => {
    // Start initialization immediately since we're using modules
    console.log('Starting application initialization...');
    App.init();
});

// Export the module
export { App };
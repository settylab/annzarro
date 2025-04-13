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
            
            // Initialize Plotly with optimized canvas settings
            _initPlotly();
            
            // Initialize UI components
            _initUI();
            
            // Make SessionManager accessible globally
            window.sessionManager = SessionManager;
            
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
        
        // Setup dataset refresh button
        const refreshDatasetBtn = document.getElementById('refresh-dataset');
        if (refreshDatasetBtn) {
            refreshDatasetBtn.addEventListener('click', async () => {
                // Clear cache for datasets listing
                DataManager.clearCache(Config.API.DATASETS);
                
                // Reload available datasets
                await _loadDatasets();
                
                // Then refresh current dataset if one is selected
                const datasetPath = datasetSelector.value;
                if (datasetPath) {
                    // Clear the DataManager cache for this dataset
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
                // Save current value before clearing
                const currentValue = datasetSelector.value;
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
                
                // Set up Select2 for custom dataset paths if available
                if (window.$ && $.fn.select2) {
                    // Destroy previous Select2 instance if it exists
                    if ($(datasetSelector).hasClass('select2-hidden-accessible')) {
                        $(datasetSelector).select2('destroy');
                    }
                    
                    $(datasetSelector).select2({
                        tags: true, // Allow custom values
                        placeholder: 'Select or enter a dataset path',
                        width: '100%',
                        createTag: function(params) {
                            // Allow custom path entries
                            const term = params.term.trim();
                            if (!term) {
                                return null;
                            }
                            
                            return {
                                id: term,
                                text: `${term} (Custom)`,
                                newTag: true
                            };
                        }
                    });
                    
                    // Make sure select2 change events also trigger dataset loading
                    $(datasetSelector).on('select2:select', function(e) {
                        const datasetPath = e.params.data.id;
                        if (datasetPath) {
                            _loadDataset(datasetPath);
                        }
                    });
                    
                    // Try to restore previous value if possible
                    if (currentValue) {
                        // Look for matching option
                        let found = false;
                        for (let i = 0; i < datasetSelector.options.length; i++) {
                            if (datasetSelector.options[i].value === currentValue) {
                                datasetSelector.value = currentValue;
                                found = true;
                                break;
                            }
                        }
                        
                        // If not found but we have a value, create a custom option
                        if (!found && currentValue) {
                            const newOption = new Option(currentValue + ' (Custom)', currentValue, true, true);
                            $(datasetSelector).append(newOption);
                        }
                        
                        $(datasetSelector).trigger('change');
                    }
                }
            }
            
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
     * @param {boolean} [silent=false] - If true, don't notify panels (prevents UI reset)
     * @private
     */
    async function _loadDataset(datasetPath, silent = false) {
        try {
            console.log(`Loading dataset: ${datasetPath}${silent ? ' (silent mode)' : ''}`);
            
            // Show loading indicators
            document.getElementById('cell-count').textContent = 'Loading...';
            document.getElementById('gene-count').textContent = 'Loading...';
            document.getElementById('dataset-path').textContent = datasetPath;
            
            // Load dataset
            const datasetStructure = await DataManager.setCurrentDataset(datasetPath, silent);
            
            // Update dataset info
            document.getElementById('cell-count').textContent = datasetStructure.n_obs || 0;
            document.getElementById('gene-count').textContent = datasetStructure.n_vars || 0;
            document.getElementById('dataset-path').textContent = datasetStructure.name || datasetPath;
            
            // Populate gene and cell selectors
            await _populateGeneSelector();
            await _populateCellSelector();
            
            // Only notify panels if not in silent mode
            if (!silent) {
                // Notify panels of dataset change - this can cause UI resets
                console.log('Notifying panels of dataset change');
                PanelManager.notifyPanels('datasetChanged', { dataset: datasetPath });
            }
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
    async function _showSaveSessionModal() {
        // Set up modal for save mode
        document.getElementById('session-modal-title').textContent = 'Save Panel Set';
        document.getElementById('save-session-container').style.display = 'block';
        document.getElementById('session-list-container').style.display = 'none';
        document.getElementById('file-upload-section').style.display = 'none';
        document.getElementById('toggle-upload-btn').style.display = 'none';
        document.getElementById('btn-confirm-session').textContent = 'Save';
        
        // Set modal data attribute for type
        document.getElementById('session-modal').dataset.modalType = 'save';
        
        // Get existing sessions for suggestions
        const sessions = await SessionManager.listSessions();
        const sessionNames = sessions.map(s => s.name);
        
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
        document.getElementById('btn-confirm-session').textContent = 'Load';
        
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
                    msg.innerHTML = `No sessions found matching "<strong>${searchTerm}</strong>"`;
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
                
                sessions.forEach(session => {
                    const card = document.createElement('div');
                    card.className = 'session-card';
                    card.dataset.sessionName = session.name;
                    
                    // Format date nicely
                    let dateObj = new Date(session.timestamp);
                    const dateStr = dateObj.toLocaleDateString();
                    const timeStr = dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                    
                    // Determine dataset display
                    const datasetDisplay = session.datasetName || 
                                           (session.dataset ? session.dataset.split('/').pop() : 'Unknown dataset');
                    
                    card.innerHTML = `
                        <div class="session-card-header">
                            <h5 class="session-card-title">${session.name}</h5>
                            <div class="session-card-subtitle">${datasetDisplay}</div>
                            <div class="session-card-actions">
                                <button class="btn btn-sm btn-outline-danger session-delete session-action-button" title="Delete">
                                    <i class="fas fa-trash-alt"></i>
                                </button>
                            </div>
                        </div>
                        <div class="session-card-date">
                            <i class="far fa-calendar-alt"></i> ${dateStr} ${timeStr}
                        </div>
                        <div class="session-card-footer">
                            <button class="btn btn-sm btn-outline-secondary session-export" title="Export">
                                <i class="fas fa-download"></i> Export
                            </button>
                        </div>
                    `;
                    
                    sessionGrid.appendChild(card);
                    
                    // Add click handler for selection
                    card.addEventListener('click', (e) => {
                        if (!e.target.closest('button')) {
                            document.querySelectorAll('.session-card.selected')
                                .forEach(el => el.classList.remove('selected'));
                            card.classList.add('selected');
                        }
                    });
                });
                
                // Add delete button handlers
                document.querySelectorAll('.session-delete').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const card = e.target.closest('.session-card');
                        const sessionName = card.dataset.sessionName;
                        
                        if (confirm(`Delete panel set "${sessionName}"?`)) {
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
                                _showError('Failed to delete panel set', result.message);
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
                
                // Apply search filter if there's an active search
                if (searchTerm) {
                    // Let's simulate the search input event to apply filters
                    searchInput.dispatchEvent(new Event('input'));
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
     * Sanitize session name by removing special characters and replacing spaces with underscores
     * @param {string} name - The raw session name
     * @returns {string} - Sanitized session name
     * @private
     */
    function _sanitizeSessionName(name) {
        // Replace spaces with underscores and remove special characters
        return name.trim()
            .replace(/\s+/g, '_')
            .replace(/[^\w\-]/g, '');
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
                alert('Please enter a panel set name');
                return;
            }
            
            // Sanitize the session name
            const sanitizedName = _sanitizeSessionName(sessionName);
            
            // Check for name collision
            const sessions = await SessionManager.listSessions();
            const existingNames = new Set(sessions.map(s => s.name.toLowerCase()));
            
            if (existingNames.has(sanitizedName.toLowerCase())) {
                // If name collision, ask for confirmation
                if (!confirm(`A panel set with the name "${sanitizedName}" already exists. Do you want to overwrite it?`)) {
                    return;
                }
            }
            
            const result = await SessionManager.saveSession(sanitizedName);
            
            if (result.status === 'success') {
                _sessionModal.hide();
                _showSuccess('Panel Set saved', `Panel Set "${sanitizedName}" saved successfully`);
            } else {
                _showError('Failed to save panel set', result.message);
            }
        } else if (modalType === 'load') {
            // Check if we're in file upload mode
            if (document.getElementById('session-modal').dataset.uploadMode === 'true') {
                // Handle file upload
                const fileInput = document.getElementById('session-file-upload');
                if (fileInput.files.length === 0) {
                    alert('Please select a file to upload');
                    return;
                }
                
                // Show loading indicator
                const confirmBtn = document.getElementById('btn-confirm-session');
                const originalText = confirmBtn.innerHTML;
                confirmBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span> Loading...`;
                confirmBtn.disabled = true;
                
                try {
                    const file = fileInput.files[0];
                    const result = await SessionManager.importSession(file);
                    
                    if (result.status === 'success') {
                        // If import successful, load the session
                        const loadResult = await SessionManager.loadSession(result.name);
                        
                        if (loadResult.status === 'success') {
                            _sessionModal.hide();
                            _showSuccess('Session Loaded', `Panel set was imported and loaded successfully.`);
                        } else {
                            _showError('Failed to load imported panel set', loadResult.message);
                        }
                    } else {
                        _showError('Failed to import panel set', result.message);
                    }
                } catch (error) {
                    _showError('Error', error.message);
                } finally {
                    // Restore button
                    confirmBtn.innerHTML = originalText;
                    confirmBtn.disabled = false;
                }
            } else {
                // Handle load from list
                const selectedCard = document.querySelector('.session-card.selected');
                
                if (!selectedCard) {
                    alert('Please select a panel set to load or switch to upload mode');
                    return;
                }
                
                const sessionName = selectedCard.dataset.sessionName;
                
                const result = await SessionManager.loadSession(sessionName);
                
                if (result.status === 'success') {
                    _sessionModal.hide();
                } else {
                    _showError('Failed to load panel set', result.message);
                }
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
    
    
    // Public API
    return {
        init
    };
})();

// Initialize the application when DOM is ready and all scripts are loaded
document.addEventListener('DOMContentLoaded', () => {
    // Start initialization immediately since we're using modules
    App.init();
});

// Export the module
export { App };
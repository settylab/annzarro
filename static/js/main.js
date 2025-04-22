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
        
        // Expose panel preview functions globally for reuse by other modules
        window._loadAllSessionPreviews = _loadAllSessionPreviews;
        window._updatePanelPreview = _updatePanelPreview;
        window._updateErrorPreview = _updateErrorPreview;
        
        try {

            // Make SessionManager accessible globally
            window.sessionManager = SessionManager;
            
            // Initialize Plotly with optimized canvas settings
            _initPlotly();
            
            // Initialize UI components
            _initUI();
            
            // Check for autosave session before initializing panel manager
            const autosave = SessionManager.getAutosaveSession();
            const hasAutosave = autosave && Config.AUTOSAVE.AUTO_RESTORE;
            
            // Initialize panel manager with autosave information
            PanelManager.init('tile-container', { hasAutosave });
            
            // Load available datasets
            await _loadDatasets();
            
            // Load available sessions
            await _loadSessions();
            
            // Set default dataset if available
            const datasets = await DataManager.loadDatasets();
            if (datasets && datasets.length > 0 && !hasAutosave) {
                await _loadDataset(datasets[0].path);
            } else if (hasAutosave) {
                await SessionManager.loadSession(Config.AUTOSAVE.SESSION_NAME);
            }

            
            // Start autosave functionality if enabled in config
            if (Config.AUTOSAVE.ENABLED) {
                SessionManager.startAutosave();
            }
            
            // Add event listener to save state before the page unloads
            window.addEventListener('beforeunload', async () => {
                await SessionManager.saveToLocalStorage();
            });
            
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
                    _showError('Failed to select directory', error.message);
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

                // Reset backend cache for the current dataset (if one is selected)
                try {
                    // Reset backend cache for this specific dataset
                    await DataManager.resetBackendCache(datasetPath);
                } catch (e) {
                    console.warn('Error resetting backend cache:', e);
                    // Continue even if backend cache reset fails
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
                    // Force width update when gene changes programmatically
                    const $container = $(focusedGeneSelect).next('.select2-container');
                    const containerWidth = 160; // Fixed width in pixels
                    $container.width(containerWidth);
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
                    // Force width update when cell changes programmatically
                    const $container = $(focusedCellSelect).next('.select2-container');
                    const containerWidth = 180; // Fixed width in pixels
                    $container.width(containerWidth);
                }
            }
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
              if (datasetPath) _loadDataset(datasetPath);
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
            document.getElementById('dataset-path').textContent = datasetPath;
            
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
            
            // Update dataset info
            document.getElementById('cell-count').textContent = datasetStructure.n_obs || 0;
            document.getElementById('gene-count').textContent = datasetStructure.n_vars || 0;
            document.getElementById('dataset-path').textContent = datasetStructure.name || datasetPath;
            
            if (signal.aborted) {
                console.log(`Dataset load aborted before populating selectors: ${datasetPath}`);
                _isLoadingDataset = false;
                return;
            }
            
            // Populate gene and cell selectors
            await _populateGeneSelector();
            
            if (signal.aborted) {
                console.log(`Dataset load aborted after populating gene selector: ${datasetPath}`);
                _isLoadingDataset = false;
                return;
            }
            
            await _populateCellSelector();
            
            if (signal.aborted) {
                console.log(`Dataset load aborted after populating cell selector: ${datasetPath}`);
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
        } catch (error) {
            // Check if this is an abort error 
            if (error && error.name === 'AbortError') {
                // Only log in debug mode to avoid console spam
                if (Config.DEBUG_MODE) {
                    console.debug(`Dataset load was aborted: ${datasetPath}`);
                }
            } else {
                console.error('Error loading dataset:', error);
                _showError('Failed to load dataset', error.message);
            }
            
            // Reset loading flag on error
            _isLoadingDataset = false;
            _currentLoadingAbortController = null;
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
                        width: '100%', // Set fixed width to parent container
                        minimumResultsForSearch: 0, // Always show search box
                        dropdownCssClass: 'gene-select-dropdown',
                        dropdownAutoWidth: false, // Don't auto-adjust dropdown width
                        selectOnClose: false, // Don't select on close to preserve current selection
                        openOnEnter: false,
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
                    
                    // Set a fixed width for gene selector on initialization and maintain it
                    $(focusedGeneSelect).on('select2:opening select2:closing change', function(e) {
                        const $container = $(this).next('.select2-container');
                        // Use fixed width instead of percentage of parent
                        const containerWidth = 180; // Fixed width in pixels
                        if (containerWidth > 0) {
                            $container.width(containerWidth);
                            // Also fix the selection text to avoid overflowing
                            $container.find('.select2-selection__rendered').css({
                                'width': (containerWidth - 30) + 'px',
                                'text-overflow': 'ellipsis',
                                'white-space': 'nowrap',
                                'overflow': 'hidden'
                            });
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
                    
                    // Set dropdown width on open (narrower than default)
                    $(focusedGeneSelect).on('select2:open', function() {
                        setTimeout(function() {
                            $('.gene-select-dropdown').css({
                                'width': '300px' // Narrower dropdown
                            });
                            $('.gene-select-dropdown .select2-results__options').css({
                                'max-height': '600px'
                            });
                        }, 0);
                    });
                }
                
                // Use current focused gene if it exists in the new dataset
                if (genes.length > 0) {
                    // Get the current focused gene from DataManager
                    const currentFocused = DataManager.getFocusedGene();
                    
                    // Check if the current focused gene exists in the new dataset
                    const geneExists = currentFocused && genes.includes(currentFocused);
                    
                    // Use the current focused gene if it exists, otherwise use the first gene
                    focusedGeneSelect.value = geneExists ? currentFocused : genes[0];
                    
                    // If we're changing to a new gene, update DataManager
                    if (!geneExists && currentFocused !== genes[0]) {
                        DataManager.setFocusedGene(genes[0]);
                    }
                    
                    // Update select2 if it's active
                    if (window.$ && $.fn.select2) {
                        $(focusedGeneSelect).trigger('change');
                        // Force width update after selection change
                        const $container = $(focusedGeneSelect).next('.select2-container');
                        const containerWidth = $(focusedGeneSelect).parent().width() * 0.9;
                        if (containerWidth > 0) {
                            $container.width(containerWidth);
                        }
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
                        width: '100%', // Set fixed width to parent container
                        minimumResultsForSearch: 0, // Always show search box
                        dropdownCssClass: 'cell-select-dropdown',
                        dropdownAutoWidth: false, // Don't auto-adjust dropdown width
                        selectOnClose: false, // Don't select on close to preserve current selection
                        openOnEnter: false,
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
                    
                    // Prevent resizing by forcing a fixed width regardless of content
                    $(focusedCellSelect).on('select2:opening select2:closing change', function(e) {
                        const $container = $(this).next('.select2-container');
                        // Force fixed width in pixels
                        const containerWidth = 220;
                        $container.width(containerWidth);
                        // Also fix the selection text to avoid overflowing
                        $container.find('.select2-selection__rendered').css({
                            'width': (containerWidth - 30) + 'px',
                            'text-overflow': 'ellipsis',
                            'white-space': 'nowrap',
                            'overflow': 'hidden'
                        });
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
                    
                    // Set dropdown width on open (narrower than default)
                    $(focusedCellSelect).on('select2:open', function() {
                        setTimeout(function() {
                            $('.cell-select-dropdown').css({
                                'width': '320px' // Wider dropdown for cell selector
                            });
                            $('.cell-select-dropdown .select2-results__options').css({
                                'max-height': '600px'
                            });
                        }, 0);
                    });
                }
                
                // Use current focused cell if it exists in the new dataset
                if (cells.length > 0) {
                    // Get the current focused cell from DataManager
                    const currentFocused = DataManager.getFocusedCell();
                    
                    // Check if the current focused cell exists in the new dataset
                    const cellExists = currentFocused && cells.includes(currentFocused);
                    
                    // Use the current focused cell if it exists, otherwise use the first cell
                    focusedCellSelect.value = cellExists ? currentFocused : cells[0];
                    
                    // If we're changing to a new cell, update DataManager
                    if (!cellExists && currentFocused !== cells[0]) {
                        DataManager.setFocusedCell(cells[0]);
                    }
                    
                    // Update select2 if it's active
                    if (window.$ && $.fn.select2) {
                        $(focusedCellSelect).trigger('change');
                        // Force width update after selection change
                        const $container = $(focusedCellSelect).next('.select2-container');
                        $container.width(220); // Fixed width
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
                
                // Create cards for each session
                sessions.forEach(session => {
                    const card = document.createElement('div');
                    // We no longer include autosave in the session list, but keep logic for backward compatibility
                    const isAutosave = session.isAutosave === true;
                    
                    // Apply standard class (since no autosave entries are included anymore)
                    card.className = 'session-card';
                    card.dataset.sessionName = session.name;
                    card.dataset.isAutosave = isAutosave;
                    
                    // Format date nicely
                    let dateObj = new Date(session.timestamp);
                    const dateStr = dateObj.toLocaleDateString();
                    const timeStr = dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                    
                    // Determine dataset display
                    const datasetDisplay = session.datasetName || 
                                           (session.dataset ? session.dataset.split('/').pop() : 'Unknown dataset');
                    
                    // Prepare title with autosave badge if needed
                    const titleHTML = isAutosave ? 
                        `${session.name} <span class="autosave-indicator"><i class="fas fa-sync-alt me-1"></i> Auto</span>` : 
                        session.name;
                    
                    // Format last saved time for autosave
                    const autosaveTimeInfo = isAutosave ?
                        `<div class="autosave-time">Last saved: ${timeStr} on ${dateStr}</div>` : '';
                    
                    // Determine storage location for display
                    const storageInfo = isAutosave ? 
                        '<div class="browser-storage-indicator"><i class="fas fa-laptop"></i> Stored in browser</div>' : 
                        '';
                    
                    // For autosave, show a restore button instead of export
                    const footerButtons = isAutosave ? 
                        `<button class="btn btn-sm btn-info session-restore" title="Restore this autosaved session">
                            <i class="fas fa-history me-1"></i> Restore
                        </button>` : 
                        `<button class="btn btn-sm btn-outline-secondary session-export" title="Export">
                            <i class="fas fa-download"></i> Export
                        </button>`;
                    
                    // Create panel preview icons based on session data
                    // Panel configurations might not be included in the session list API
                    // We'll add a placeholder that will be populated asynchronously
                    
                    let panelPreview = `<div class="session-card-preview" data-session-name="${session.name}">
                        <div class="panel-preview-loading">
                            <i class="fas fa-spinner fa-pulse"></i>
                        </div>
                    </div>`;

                    card.innerHTML = `
                        <div class="session-card-header">
                            <h5 class="session-card-title">${titleHTML}</h5>
                            <div class="session-card-subtitle">${datasetDisplay}</div>
                            <div class="session-card-actions">
                                <button class="btn btn-sm btn-outline-danger session-delete session-action-button" title="Delete">
                                    <i class="fas fa-trash-alt"></i>
                                </button>
                            </div>
                        </div>
                        ${panelPreview}
                        ${storageInfo}
                        ${autosaveTimeInfo}
                        ${!isAutosave ? `
                        <div class="session-card-date">
                            <i class="far fa-calendar-alt"></i> ${dateStr} ${timeStr}
                        </div>
                        ` : ''}
                        <div class="session-card-footer">
                            ${footerButtons}
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
                                    _showError('Failed to delete panel set', result.message);
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
                            _showError('Failed to restore autosave', result.message);
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
                    // Fetch session data from the server
                    const response = await fetch(`${Config.API.SESSIONS_LOAD}?name=${encodeURIComponent(session.name)}`);
                    if (response.ok) {
                        const sessionData = await response.json();
                        if (sessionData && sessionData.panelConfigs) {
                            session.panelConfigs = sessionData.panelConfigs;
                            _updatePanelPreview(session);
                        }
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
                //_showSuccess('Panel Set saved', `Panel Set "${sanitizedName}" saved successfully`);
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
        init
    };
})();

// Initialize the application when DOM is ready and all scripts are loaded
document.addEventListener('DOMContentLoaded', () => {
    // Start initialization immediately since we're using modules
    App.init();
    
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
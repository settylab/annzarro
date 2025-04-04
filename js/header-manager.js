/**
 * Header Manager Module
 * 
 * Handles the persistent header with gene and cell selection, taxonomy, and dataset info
 */

const HeaderManager = (function() {
    // Private variables
    let _geneSearchElement = null;
    let _cellSearchElement = null;
    let _taxonomyElement = null;
    let _datasetInfoElement = null;
    
    /**
     * Initialize the header manager
     */
    function init() {
        // Get header elements
        _geneSearchElement = document.getElementById('geneSearch');
        _cellSearchElement = document.getElementById('cellSearch');
        _taxonomyElement = document.getElementById('taxonomySelect');
        _datasetInfoElement = document.getElementById('datasetInfo');
        
        if (!_geneSearchElement || !_cellSearchElement || !_taxonomyElement || !_datasetInfoElement) {
            console.error('Required header elements not found');
            return;
        }
        
        // Listen for events
        document.addEventListener('dataLoaded', handleDataLoaded);
        document.addEventListener('geneFocusChanged', handleGeneFocusChanged);
        document.addEventListener('cellFocusChanged', handleCellFocusChanged);
        document.addEventListener('taxonomyChanged', handleTaxonomyChanged);
        
        // Set up gene search
        setupGeneSearch();
        
        // Set up cell search
        setupCellSearch();
        
        // Set up taxonomy selector
        setupTaxonomySelector();
        
        console.log('HeaderManager initialized');
    }
    
    /**
     * Set up gene search
     */
    function setupGeneSearch() {
        // Initialize Select2
        $(_geneSearchElement).select2({
            placeholder: 'Select or search for a gene',
            allowClear: true,
            width: '100%',
            minimumInputLength: 2,
            ajax: {
                delay: 250,
                transport: function(params, success, failure) {
                    // Check if dataset is loaded
                    if (!DataManager.getActiveDataset()) {
                        return failure('No dataset loaded');
                    }
                    
                    const searchTerm = params.data.term.toLowerCase();
                    
                    // Load all gene names
                    DataManager.loadGeneNames().then(geneNames => {
                        // Filter by search term
                        const filtered = geneNames
                            .filter(name => name.toLowerCase().includes(searchTerm))
                            .slice(0, 50); // Limit to 50 results
                        
                        // Format for Select2
                        const results = filtered.map(name => ({
                            id: name,
                            text: name
                        }));
                        
                        success({ results });
                    }).catch(error => {
                        failure('Error loading genes: ' + error.message);
                    });
                    
                    // No jQuery XHR needed
                    return undefined;
                }
            }
        });
        
        // Handle selection
        $(_geneSearchElement).on('select2:select', function(e) {
            const gene = e.params.data.id;
            DataManager.setFocusedGene(gene);
        });
        
        // Handle clearing
        $(_geneSearchElement).on('select2:clear', function() {
            DataManager.setFocusedGene(null);
        });
    }
    
    /**
     * Set up cell search
     */
    function setupCellSearch() {
        // Initialize Select2
        $(_cellSearchElement).select2({
            placeholder: 'Select or search for a cell',
            allowClear: true,
            width: '100%',
            minimumInputLength: 2,
            ajax: {
                delay: 250,
                transport: function(params, success, failure) {
                    // Check if dataset is loaded
                    if (!DataManager.getActiveDataset()) {
                        return failure('No dataset loaded');
                    }
                    
                    const searchTerm = params.data.term.toLowerCase();
                    
                    // Load all cell names
                    DataManager.loadCellNames().then(cellNames => {
                        // Filter by search term
                        const filtered = cellNames
                            .filter(name => name.toLowerCase().includes(searchTerm))
                            .slice(0, 50); // Limit to 50 results
                        
                        // Format for Select2
                        const results = filtered.map(name => ({
                            id: name,
                            text: name
                        }));
                        
                        success({ results });
                    }).catch(error => {
                        failure('Error loading cells: ' + error.message);
                    });
                    
                    // No jQuery XHR needed
                    return undefined;
                }
            }
        });
        
        // Handle selection
        $(_cellSearchElement).on('select2:select', function(e) {
            const cell = e.params.data.id;
            DataManager.setFocusedCell(cell);
        });
        
        // Handle clearing
        $(_cellSearchElement).on('select2:clear', function() {
            DataManager.setFocusedCell(null);
        });
    }
    
    /**
     * Set up taxonomy selector
     */
    function setupTaxonomySelector() {
        // Populate common species
        const commonSpecies = [
            { id: '9606', name: 'Homo sapiens (Human)' },
            { id: '10090', name: 'Mus musculus (Mouse)' },
            { id: '10116', name: 'Rattus norvegicus (Rat)' },
            { id: '7227', name: 'Drosophila melanogaster (Fruit fly)' },
            { id: '6239', name: 'Caenorhabditis elegans (Nematode)' },
            { id: '7955', name: 'Danio rerio (Zebrafish)' },
            { id: '4932', name: 'Saccharomyces cerevisiae (Baker\'s yeast)' }
        ];
        
        // Populate options
        commonSpecies.forEach(species => {
            const option = document.createElement('option');
            option.value = species.id;
            option.textContent = species.name;
            _taxonomyElement.appendChild(option);
        });
        
        // Set default (human)
        _taxonomyElement.value = '9606';
        
        // Handle change
        _taxonomyElement.addEventListener('change', function() {
            const taxonomyId = this.value;
            const selectedOption = this.options[this.selectedIndex];
            const speciesName = selectedOption.textContent.split(' (')[0];
            
            DataManager.setTaxonomy(taxonomyId, speciesName);
        });
    }
    
    /**
     * Handle dataset loaded event
     * @param {Event} event - Dataset loaded event
     */
    function handleDataLoaded(event) {
        const { datasetPath, info } = event.detail;
        
        // Update dataset info display
        updateDatasetInfo(datasetPath, info);
        
        // Reset gene and cell selectors
        $(_geneSearchElement).val(null).trigger('change');
        $(_cellSearchElement).val(null).trigger('change');
        
        // Make header visible
        document.querySelector('.persistent-header')?.classList.remove('d-none');
    }
    
    /**
     * Update dataset info display
     * @param {string} path - Dataset path
     * @param {Object} info - Dataset info
     */
    function updateDatasetInfo(path, info) {
        // Format path for display
        const displayPath = path.split('/').pop().replace('.zarr', '');
        
        // Create info HTML
        const html = `
            <div class="dataset-name">${info.name || displayPath}</div>
            <div class="dataset-stats">
                <span title="Number of cells">${info.n_obs.toLocaleString()} cells</span> ×
                <span title="Number of genes">${info.n_vars.toLocaleString()} genes</span>
            </div>
        `;
        
        _datasetInfoElement.innerHTML = html;
    }
    
    /**
     * Handle gene focus changed event
     * @param {Event} event - Gene focus changed event
     */
    function handleGeneFocusChanged(event) {
        const gene = event.detail.gene;
        
        // Update select2 without triggering events
        $(_geneSearchElement).off('select2:select');
        
        if (gene) {
            // Check if option exists
            let option = $(_geneSearchElement).find(`option[value="${gene}"]`);
            
            if (option.length === 0) {
                // Create new option
                option = new Option(gene, gene, true, true);
                $(_geneSearchElement).append(option).trigger('change');
            } else {
                // Select existing option
                $(_geneSearchElement).val(gene).trigger('change');
            }
        } else {
            // Clear selection
            $(_geneSearchElement).val(null).trigger('change');
        }
        
        // Reattach event handler
        $(_geneSearchElement).on('select2:select', function(e) {
            DataManager.setFocusedGene(e.params.data.id);
        });
    }
    
    /**
     * Handle cell focus changed event
     * @param {Event} event - Cell focus changed event
     */
    function handleCellFocusChanged(event) {
        const cell = event.detail.cell;
        
        // Update select2 without triggering events
        $(_cellSearchElement).off('select2:select');
        
        if (cell) {
            // Check if option exists
            let option = $(_cellSearchElement).find(`option[value="${cell}"]`);
            
            if (option.length === 0) {
                // Create new option
                option = new Option(cell, cell, true, true);
                $(_cellSearchElement).append(option).trigger('change');
            } else {
                // Select existing option
                $(_cellSearchElement).val(cell).trigger('change');
            }
        } else {
            // Clear selection
            $(_cellSearchElement).val(null).trigger('change');
        }
        
        // Reattach event handler
        $(_cellSearchElement).on('select2:select', function(e) {
            DataManager.setFocusedCell(e.params.data.id);
        });
    }
    
    /**
     * Handle taxonomy changed event
     * @param {Event} event - Taxonomy changed event
     */
    function handleTaxonomyChanged(event) {
        const { taxonomyId, species } = event.detail;
        
        // Update select if it exists
        if (taxonomyId && _taxonomyElement) {
            // Check if option exists
            let option = Array.from(_taxonomyElement.options).find(opt => opt.value === taxonomyId);
            
            if (!option) {
                // Create new option
                option = document.createElement('option');
                option.value = taxonomyId;
                option.textContent = `${species} (${taxonomyId})`;
                _taxonomyElement.appendChild(option);
            }
            
            // Select the option
            _taxonomyElement.value = taxonomyId;
        }
    }
    
    // Public API
    return {
        init
    };
})();

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    HeaderManager.init();
});

// Export as module and global
if (typeof module !== 'undefined' && module.exports) {
    module.exports = HeaderManager;
} else {
    window.HeaderManager = HeaderManager;
}
/**
 * Plot Panel Module
 * 
 * Handles the creation and management of plot panels
 */

// Define the plot panel module
(function() {
    // Import dependencies from ModuleSystem
    let constants, dataCategories;
    
    try {
        constants = window.ModuleSystem.require('PanelManager.Constants');
        dataCategories = window.ModuleSystem.require('PanelManager.DataCategories');
    } catch (error) {
        console.error('Error loading dependencies:', error);
        // Provide fallback empty objects if modules aren't available
        constants = { DATA_CATEGORIES: {}, PANEL_TYPES: {} };
        dataCategories = {};
    }
    
    const { DATA_CATEGORIES, PANEL_TYPES } = constants;
    
    /**
     * Apply axis selection to plot
     * @param {string} panelId - Panel ID
     * @param {string} axisType - Axis type (x, y, z, color)
     * @param {Object} panel - Panel object
     */
    function applyAxisSelection(panelId, axisType, panel) {
        if (!panel) return;
        
        const fieldSelect = document.getElementById(`${panelId}-${axisType}-field-select`);
        const columnsContainer = document.querySelector(`#${panelId}-${axisType}-columns-container`);
        
        if (!fieldSelect || !columnsContainer) {
            console.error(`Missing elements for ${axisType} axis selection`);
            return;
        }
        
        try {
            // Get selected column(s)
            const selectedInputs = columnsContainer.querySelectorAll('input[type="checkbox"]:checked, input[type="radio"]:checked');
            if (selectedInputs.length === 0) {
                console.log(`No columns selected for ${axisType} axis`);
                return;
            }
            
            // Get the selected field info
            const selectedField = JSON.parse(columnsContainer.dataset.selectedField || '{}');
            if (!selectedField || !selectedField.key) {
                console.error(`No field info for ${axisType} axis`);
                return;
            }
            
            // Get selected column(s) info
            const selectedColumn = selectedInputs[0].dataset.columnInfo ? JSON.parse(selectedInputs[0].dataset.columnInfo) : null;
            
            // Create path based on data type
            let path, index, label;
            
            if (selectedField.type === 'matrix' || selectedField.type === 'matrix_dimension') {
                // Matrix field (e.g. obsm/X_umap)
                const category = selectedField.category || 'obsm'; // Default to obsm
                path = `${category}/${selectedField.key}`;
                
                if (selectedColumn && selectedColumn.index !== undefined) {
                    index = selectedColumn.index;
                    label = `${selectedField.key} (dim ${index + 1})`;
                } else if (selectedField.index !== undefined) {
                    index = selectedField.index;
                    label = `${selectedField.key} (dim ${index + 1})`;
                } else {
                    // Default to first dimension
                    index = 0;
                    label = `${selectedField.key} (dim 1)`;
                }
            } else if (selectedField.type === 'dataframe' || selectedField.type === 'dataframe_column') {
                // Dataframe field (e.g. obsm/PCA_df/PC1)
                const category = selectedField.category || 'obsm'; // Default to obsm
                
                if (selectedColumn && selectedColumn.column) {
                    path = `${category}/${selectedField.key}/${selectedColumn.column}`;
                    label = `${selectedField.key}.${selectedColumn.column}`;
                } else if (selectedField.column) {
                    path = `${category}/${selectedField.key}/${selectedField.column}`;
                    label = `${selectedField.key}.${selectedField.column}`;
                } else {
                    console.error(`No column selected for dataframe ${selectedField.key}`);
                    return;
                }
            } else if (selectedField.type === 'column') {
                // Metadata column (e.g. obs/leiden)
                const category = selectedField.category || 'obs'; // Default to obs
                path = `${category}/${selectedField.key}`;
                label = selectedField.key;
            } else if (selectedField.type === 'expression' || selectedField.type === 'layer') {
                // Expression data
                if (selectedField.type === 'expression') {
                    path = 'X';
                } else {
                    path = `layers/${selectedField.key}`;
                }
                
                // Expression uses the focused gene, no index needed
                label = selectedField.label || path;
            } else {
                console.error(`Unsupported field type: ${selectedField.type}`);
                return;
            }
            
            // Update the configuration based on axis type
            const axisConfig = axisType === 'color' ? 'color' : `${axisType}Axis`;
            const config = {
                [axisConfig]: {
                    path: path,
                    label: label
                }
            };
            
            // Add index for axes
            if (index !== undefined && axisType !== 'color') {
                config[axisConfig].index = index;
            }
            
            // Special handling for color axis
            if (axisType === 'color') {
                // Get color scale
                const colorScale = document.getElementById(`${panelId}-color-scale-select`);
                if (colorScale && colorScale.value) {
                    config.color.scale = colorScale.value;
                }
                
                // Get range inputs
                const minRange = document.getElementById(`${panelId}-color-min-range`);
                const maxRange = document.getElementById(`${panelId}-color-max-range`);
                
                if (minRange && maxRange && minRange.value && maxRange.value) {
                    config.color.range = [
                        parseFloat(minRange.value),
                        parseFloat(maxRange.value)
                    ];
                }
                
                // Get clip values checkbox
                const clipValues = document.getElementById(`${panelId}-color-clip-values`);
                if (clipValues !== null) {
                    config.color.clipValues = clipValues.checked;
                }
            }
            
            console.log(`Applying ${axisType} axis config:`, config);
            
            // Update the plot
            if (window.PlotManager) {
                PlotManager.updatePlot(panelId, config);
            }
            
            // Update the axis button
            const axisButton = document.getElementById(`${panelId}-${axisType}-axis-btn`);
            if (axisButton) {
                let buttonText = label;
                
                // For color button, prepend "Color: " if not already present
                if (axisType === 'color' && !buttonText.startsWith('Color:')) {
                    buttonText = `Color: ${buttonText}`;
                }
                
                axisButton.textContent = buttonText;
                axisButton.classList.remove('btn-outline-secondary');
                axisButton.classList.add('btn-outline-primary');
                
                // Close dropdown
                const dropdown = bootstrap.Dropdown.getInstance(axisButton);
                if (dropdown) {
                    dropdown.hide();
                }
            }
            
            // Make sure all axis buttons are updated to reflect current state
            updateAllAxisButtons(panel);
            
        } catch (error) {
            console.error(`Error applying ${axisType} axis selection:`, error);
        }
    }
    
    /**
     * Update all axis buttons for a panel to reflect current configuration
     * @param {Object} panel - Panel object
     */
    function updateAllAxisButtons(panel) {
        if (!panel || !panel.id) return;
        
        const panelId = panel.id;
        const axisTypes = ['x', 'y', 'z', 'color'];
        
        console.log(`Updating all axis buttons for panel ${panelId}`);
        
        axisTypes.forEach(axis => {
            // Get the axis config property name
            const axisConfigProp = axis === 'color' ? 'color' : `${axis}Axis`;
            
            // Get the config for this axis
            const axisConfig = panel.config[axisConfigProp];
            if (!axisConfig) {
                console.log(`No config found for ${axis} axis`);
                return;
            }
            
            // Ensure axis labels are properly set in config
            if (!axisConfig.label && axisConfig.path) {
                // Generate a label based on path
                const path = axisConfig.path;
                const pathParts = path.split('/');
                if (pathParts.length >= 2) {
                    const component = pathParts[0];
                    const field = pathParts[1];
                    let label = field;
                    
                    // Add dimension index if applicable
                    if (axisConfig.index !== undefined && axisConfig.index !== null) {
                        label += ` (dim ${axisConfig.index + 1})`;
                    }
                    
                    // Add column name if available
                    if (pathParts.length >= 3) {
                        label += `.${pathParts[2]}`;
                    }
                    
                    axisConfig.label = label;
                    console.log(`Generated label for ${axis} axis: ${label}`);
                } else {
                    axisConfig.label = `${axis.toUpperCase()} Axis`;
                }
            }
            
            // Get the button for this axis
            const btn = document.getElementById(`${panelId}-${axis}-axis-btn`);
            if (!btn) {
                console.log(`Button not found for ${axis} axis`);
                return;
            }
            
            // Update button text and style
            let buttonText = axisConfig.label || `${axis.toUpperCase()} Axis`;
            
            // For color button, prepend "Color: " if not already present
            if (axis === 'color' && !buttonText.startsWith('Color:')) {
                buttonText = `Color: ${buttonText}`;
            }
            
            // Update button text
            btn.textContent = buttonText;
            console.log(`Updated ${axis} button text to: ${buttonText}`);
            
            // Ensure button styling is correct
            if (axisConfig.path) {
                // Has selection
                btn.classList.remove('btn-outline-secondary');
                btn.classList.add('btn-outline-primary');
            } else {
                // No selection
                btn.classList.remove('btn-outline-primary');
                btn.classList.add('btn-outline-secondary');
            }
        });
    }
    
    /**
     * Update a plot setting
     * @param {string} panelId - Panel ID
     * @param {string} path - Setting path (e.g., 'marker.size')
     * @param {any} value - Setting value
     */
    function updatePlotSetting(panelId, path, value) {
        console.log(`Updating plot setting for panel ${panelId}: ${path} = ${value}`);
        
        // Normalize panel ID
        const fullPanelId = panelId.startsWith('panel-') ? panelId : `panel-${panelId}`;
        const panelIdNum = panelId.replace('panel-', '');
        
        // Get panel - try different formats
        let panelEl = document.getElementById(panelId) || document.getElementById(fullPanelId);
        if (!panelEl) {
            console.error(`Panel element not found for ID: ${panelId}`);
            return;
        }
        
        // Get panel config - either from the element's dataset or from DOM property 
        const panel = {
            id: panelId,
            element: panelEl,
            config: panelEl.config || {}
        };
        
        // Split path into parts
        const parts = path.split('.');
        let current = panel.config;
        
        // Navigate to the right level
        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!current[part]) {
                current[part] = {};
            }
            current = current[part];
        }
        
        // Set the value
        current[parts[parts.length - 1]] = value;
        
        // Make sure all axis buttons are updated to reflect current state
        updateAllAxisButtons(panel);
        
        // Update the plot - use the specific element ID to ensure the correct plot is updated
        if (window.PlotManager) {
            // Generate all possible plot element IDs
            const elementIds = [
                `${panel.id}-plot`,
                `${fullPanelId}-plot`,
                `plot-${panelIdNum}`,
                `${panelIdNum}-plot`
            ];
            
            // Try to find the actual DOM element first
            let plotElement = null;
            for (const id of elementIds) {
                const el = document.getElementById(id);
                if (el) {
                    plotElement = el;
                    break;
                }
            }
            
            if (plotElement) {
                // Use the DOM element ID
                console.log(`Updating plot using element ID: ${plotElement.id}`);
                PlotManager.updatePlot(plotElement.id, panel.config);
            } else {
                // If no element found, try with the panel ID directly
                console.warn(`No plot element found, using panel ID: ${panel.id}`);
                PlotManager.updatePlot(panel.id, panel.config);
            }
        }
    }
    
    /**
     * Initialize plot controls
     * @param {string} panelId - Panel ID
     * @param {Object} config - Panel configuration
     */
    function initializePlotControls(panelId, config) {
        const axisTypes = ['x', 'y', 'z', 'color'];
        
        // Set up axis buttons
        for (const axisType of axisTypes) {
            const axisBtn = document.getElementById(`${panelId}-${axisType}-axis-btn`);
            if (!axisBtn) continue;
            
            // Load fields for dropdown
            const fieldSelect = document.getElementById(`${panelId}-${axisType}-field-select`);
            if (fieldSelect) {
                fieldSelect.addEventListener('change', async (e) => {
                    try {
                        // Get the selected option directly - using selectedOptions is more reliable
                        const selectedOption = fieldSelect.selectedOptions[0];
                        if (!selectedOption) {
                            columnsContainer.innerHTML = ''; // Just clear if nothing selected
                            return;
                        }
                        
                        // Clear completely first before adding loading indicator
                        const columnsContainer = document.querySelector(`#${panelId}-${axisType}-columns-container`);
                        columnsContainer.innerHTML = '';
                        
                        // Show loading indicator next
                        columnsContainer.innerHTML = `
                            <div class="text-center py-2">
                                <div class="spinner-border spinner-border-sm" role="status"></div>
                                <small class="text-muted ms-2">Loading columns...</small>
                            </div>
                        `;
                        
                        // Get the field info from the selected option directly
                        if (!selectedOption.dataset.fieldInfo) {
                            throw new Error(`Selected option doesn't have field info: ${selectedOption.textContent}`);
                        }
                        
                        const fieldInfo = JSON.parse(selectedOption.dataset.fieldInfo);
                        const fieldLabel = selectedOption.textContent;
                        
                        console.log(`Selected dropdown option: "${fieldLabel}"`);
                        console.log(`Field info for ${axisType}:`, fieldInfo);
                        
                        // Store a reference to the selected field in the columnsContainer
                        columnsContainer.dataset.selectedField = JSON.stringify(fieldInfo);
                        columnsContainer.dataset.selectedFieldLabel = fieldLabel;
                        
                        // Load columns for the selected field
                        await populateColumnsForField(fieldInfo, columnsContainer, 
                            document.getElementById(`${panelId}-${axisType}-column-search`), 
                            panelId, axisType);
                    } catch (error) {
                        console.error(`Error loading columns:`, error);
                        const columnsContainer = document.querySelector(`#${panelId}-${axisType}-columns-container`);
                        columnsContainer.innerHTML = `
                            <div class="alert alert-danger">
                                <p>Error loading columns: ${error.message}</p>
                            </div>
                        `;
                    }
                });
            }
            
            // Set up apply button
            const applyBtn = document.getElementById(`${panelId}-${axisType}-apply-btn`);
            if (applyBtn) {
                applyBtn.addEventListener('click', () => {
                    applyAxisSelection(panelId, axisType, { id: panelId, config });
                });
            }
        }
        
        // Setup plot settings
        const markerSizeInput = document.getElementById(`${panelId}-marker-size`);
        const markerOpacityInput = document.getElementById(`${panelId}-marker-opacity`);
        const showLegendCheckbox = document.getElementById(`${panelId}-show-legend`);
        const gridLinesCheckbox = document.getElementById(`${panelId}-grid-lines`);
        
        if (markerSizeInput && config.marker && config.marker.size) {
            markerSizeInput.value = config.marker.size;
            markerSizeInput.addEventListener('change', () => {
                const size = parseInt(markerSizeInput.value, 10);
                updatePlotSetting(panelId, 'marker.size', size);
            });
        }
        
        if (markerOpacityInput && config.marker && config.marker.opacity) {
            markerOpacityInput.value = config.marker.opacity;
            markerOpacityInput.addEventListener('change', () => {
                const opacity = parseFloat(markerOpacityInput.value);
                updatePlotSetting(panelId, 'marker.opacity', opacity);
            });
        }
        
        if (showLegendCheckbox && config.layout) {
            showLegendCheckbox.checked = config.layout.showLegend !== false;
            showLegendCheckbox.addEventListener('change', () => {
                updatePlotSetting(panelId, 'layout.showLegend', showLegendCheckbox.checked);
            });
        }
        
        if (gridLinesCheckbox) {
            gridLinesCheckbox.checked = true; // Default to true
            gridLinesCheckbox.addEventListener('change', () => {
                // Update grid lines (placeholder)
                console.log(`Grid lines ${gridLinesCheckbox.checked ? 'enabled' : 'disabled'}`);
            });
        }
    }
    
    /**
     * Populate columns for a selected field
     * @param {Object} fieldInfo - Field information
     * @param {HTMLElement} container - Container element
     * @param {HTMLElement} searchInput - Search input element
     * @param {string} panelId - Panel ID
     * @param {string} axisType - Axis type
     */
    async function populateColumnsForField(fieldInfo, container, searchInput, panelId, axisType) {
        if (!fieldInfo || !container) return;
        
        try {
            console.log(`Populating columns for field:`, fieldInfo);
            
            // Reset container
            container.innerHTML = '';
            
            // Get the data category
            const category = fieldInfo.category || guessCategory(fieldInfo);
            if (!category) {
                throw new Error('Unable to determine data category');
            }
            
            // Add category to field info for future reference
            fieldInfo.category = category;
            
            // Get category handler
            const categoryInfo = dataCategories && dataCategories[category];
            if (!categoryInfo) {
                throw new Error(`Unknown data category: ${category}`);
            }
            
            // Determine if we need to load columns
            let needColumns = false;
            switch (fieldInfo.type) {
                case 'matrix':
                case 'dataframe':
                    needColumns = true;
                    break;
                case 'matrix_dimension':
                case 'dataframe_column':
                case 'column':
                case 'expression':
                case 'layer':
                    // These don't need additional columns, they can be used directly
                    needColumns = false;
                    break;
                default:
                    throw new Error(`Unsupported field type: ${fieldInfo.type}`);
            }
            
            // For fields that need columns, load and display them
            if (needColumns) {
                // Show loading indicator
                container.innerHTML = `
                    <div class="text-center py-2">
                        <div class="spinner-border spinner-border-sm" role="status"></div>
                        <small class="text-muted ms-2">Loading columns...</small>
                    </div>
                `;
                
                // Load columns
                const columns = await categoryInfo.loadColumns(fieldInfo);
                
                if (!columns || columns.length === 0) {
                    container.innerHTML = `
                        <div class="alert alert-info">
                            <p>No columns available for this field.</p>
                        </div>
                    `;
                    return;
                }
                
                // Create column list
                const columnList = document.createElement('div');
                columnList.className = 'column-list';
                
                // Determine if we should use radio buttons or checkboxes
                // For axes, use radio buttons to select one dimension
                // For color, could potentially use multiple columns in the future
                const useRadio = (axisType !== 'color');
                
                for (const column of columns) {
                    const inputType = useRadio ? 'radio' : 'checkbox';
                    const inputName = `${panelId}-${axisType}-column`;
                    const labelText = column.label || (column.index !== undefined ? `Dimension ${column.index + 1}` : column.column || 'Unknown');
                    
                    const columnInfo = {
                        ...column,
                        fieldKey: fieldInfo.key
                    };
                    
                    const item = document.createElement('div');
                    item.className = 'form-check';
                    item.innerHTML = `
                        <input class="form-check-input" type="${inputType}" name="${inputName}" id="${inputName}-${labelText.replace(/\s+/g, '-')}" 
                               data-column-info='${JSON.stringify(columnInfo)}'>
                        <label class="form-check-label" for="${inputName}-${labelText.replace(/\s+/g, '-')}">
                            ${labelText}
                        </label>
                    `;
                    
                    columnList.appendChild(item);
                }
                
                // Clear container and add column list
                container.innerHTML = '';
                container.appendChild(columnList);
                
                // Setup search if available
                if (searchInput) {
                    searchInput.addEventListener('input', (e) => {
                        const searchText = e.target.value.toLowerCase();
                        const items = columnList.querySelectorAll('.form-check');
                        
                        items.forEach(item => {
                            const label = item.querySelector('label');
                            if (label.textContent.toLowerCase().includes(searchText)) {
                                item.style.display = '';
                            } else {
                                item.style.display = 'none';
                            }
                        });
                    });
                }
            } else {
                // For fields that don't need additional column selection
                container.innerHTML = `
                    <div class="alert alert-info">
                        <p>This field can be used directly. Click Apply to use it for the ${axisType} axis.</p>
                    </div>
                `;
                
                // Pre-fill a hidden field with the direct selection
                const inputName = `${panelId}-${axisType}-column`;
                const hiddenInput = document.createElement('input');
                hiddenInput.type = 'hidden';
                hiddenInput.name = inputName;
                hiddenInput.dataset.columnInfo = JSON.stringify({
                    fieldKey: fieldInfo.key,
                    index: fieldInfo.index,
                    column: fieldInfo.column
                });
                
                container.appendChild(hiddenInput);
            }
        } catch (error) {
            console.error('Error populating columns:', error);
            container.innerHTML = `
                <div class="alert alert-danger">
                    <p>Error loading columns: ${error.message}</p>
                </div>
            `;
        }
    }
    
    /**
     * Guess the data category from field info
     * @param {Object} fieldInfo - Field information
     * @returns {string} - Data category
     */
    function guessCategory(fieldInfo) {
        // Try to guess from field key or label
        const key = fieldInfo.key || '';
        const label = fieldInfo.label || '';
        
        if (key.startsWith('X_') || label.includes('embedding')) return 'obsm';
        if (key.includes('gene') || key === 'highly_variable') return 'var';
        if (key.includes('cell') || key === 'leiden' || key === 'louvain') return 'obs';
        if (key === 'X' || label.includes('expression')) return 'X';
        
        // Default to obsm as it's most common
        return 'obsm';
    }
    
    /**
     * Create a plot panel
     * @param {string} panelId - Panel ID
     * @param {Object} config - Panel configuration
     * @returns {Object} - Panel object
     */
    function createPlotPanel(panelId, config = {}) {
        const panel = document.getElementById(panelId);
        if (!panel) {
            console.error(`Panel element not found: ${panelId}`);
            return null;
        }
        
        // Default plot config
        const defaultConfig = {
            type: 'scatter',
            xAxis: {
                path: 'obsm/X_umap',
                index: 0,
                label: 'UMAP 1'
            },
            yAxis: {
                path: 'obsm/X_umap',
                index: 1,
                label: 'UMAP 2'
            },
            zAxis: {
                path: null,
                index: null,
                label: null
            },
            color: {
                path: null,
                label: null,
                scale: 'Viridis',
                range: [null, null],
                clipValues: true
            },
            marker: {
                size: 5,
                opacity: 0.7
            },
            selection: {
                cells: null,
                genes: null
            },
            layout: {
                title: '',
                showLegend: true
            }
        };
        
        // Merge configs
        const mergedConfig = {...defaultConfig, ...config};
        
        // Update panel element
        panel.config = mergedConfig;
        panel.classList.add('plot-panel');
        
        // Create panel content
        panel.innerHTML = `
            <div class="panel-header">
                <h5>Plot Panel</h5>
                <div class="btn-toolbar">
                    <div class="btn-group me-2">
                        <button type="button" class="btn btn-sm btn-outline-secondary" id="${panelId}-x-axis-btn" data-bs-toggle="dropdown">
                            X Axis
                        </button>
                        <div class="dropdown-menu p-3" style="width: 320px;">
                            <h6 class="dropdown-header">Select X Axis</h6>
                            <div class="mb-3">
                                <label class="form-label small">Field</label>
                                <select class="form-select form-select-sm" id="${panelId}-x-field-select">
                                    <option value="">-- Select Field --</option>
                                </select>
                            </div>
                            <div class="mb-3">
                                <label class="form-label small">Column/Dimension</label>
                                <input type="text" class="form-control form-control-sm mb-2" id="${panelId}-x-column-search" placeholder="Search columns...">
                                <div id="${panelId}-x-columns-container" class="columns-container">
                                    <div class="text-muted small">Select a field first</div>
                                </div>
                            </div>
                            <div class="text-end">
                                <button type="button" class="btn btn-sm btn-primary" id="${panelId}-x-apply-btn">Apply</button>
                            </div>
                        </div>
                        
                        <button type="button" class="btn btn-sm btn-outline-secondary" id="${panelId}-y-axis-btn" data-bs-toggle="dropdown">
                            Y Axis
                        </button>
                        <div class="dropdown-menu p-3" style="width: 320px;">
                            <h6 class="dropdown-header">Select Y Axis</h6>
                            <div class="mb-3">
                                <label class="form-label small">Field</label>
                                <select class="form-select form-select-sm" id="${panelId}-y-field-select">
                                    <option value="">-- Select Field --</option>
                                </select>
                            </div>
                            <div class="mb-3">
                                <label class="form-label small">Column/Dimension</label>
                                <input type="text" class="form-control form-control-sm mb-2" id="${panelId}-y-column-search" placeholder="Search columns...">
                                <div id="${panelId}-y-columns-container" class="columns-container">
                                    <div class="text-muted small">Select a field first</div>
                                </div>
                            </div>
                            <div class="text-end">
                                <button type="button" class="btn btn-sm btn-primary" id="${panelId}-y-apply-btn">Apply</button>
                            </div>
                        </div>
                        
                        <button type="button" class="btn btn-sm btn-outline-secondary" id="${panelId}-z-axis-btn" data-bs-toggle="dropdown">
                            Z Axis
                        </button>
                        <div class="dropdown-menu p-3" style="width: 320px;">
                            <h6 class="dropdown-header">Select Z Axis</h6>
                            <div class="mb-3">
                                <label class="form-label small">Field</label>
                                <select class="form-select form-select-sm" id="${panelId}-z-field-select">
                                    <option value="">-- Select Field --</option>
                                </select>
                            </div>
                            <div class="mb-3">
                                <label class="form-label small">Column/Dimension</label>
                                <input type="text" class="form-control form-control-sm mb-2" id="${panelId}-z-column-search" placeholder="Search columns...">
                                <div id="${panelId}-z-columns-container" class="columns-container">
                                    <div class="text-muted small">Select a field first</div>
                                </div>
                            </div>
                            <div class="text-end">
                                <button type="button" class="btn btn-sm btn-primary" id="${panelId}-z-apply-btn">Apply</button>
                            </div>
                        </div>
                    </div>
                    
                    <div class="btn-group me-2">
                        <button type="button" class="btn btn-sm btn-outline-secondary" id="${panelId}-color-axis-btn" data-bs-toggle="dropdown">
                            Color
                        </button>
                        <div class="dropdown-menu p-3" style="width: 320px;">
                            <h6 class="dropdown-header">Select Color</h6>
                            <div class="mb-3">
                                <label class="form-label small">Field</label>
                                <select class="form-select form-select-sm" id="${panelId}-color-field-select">
                                    <option value="">-- Select Field --</option>
                                </select>
                            </div>
                            <div class="mb-3">
                                <label class="form-label small">Column/Dimension</label>
                                <input type="text" class="form-control form-control-sm mb-2" id="${panelId}-color-column-search" placeholder="Search columns...">
                                <div id="${panelId}-color-columns-container" class="columns-container">
                                    <div class="text-muted small">Select a field first</div>
                                </div>
                            </div>
                            <div class="mb-3">
                                <label class="form-label small">Color Scale</label>
                                <select class="form-select form-select-sm" id="${panelId}-color-scale-select">
                                    <option value="Viridis">Viridis</option>
                                    <option value="Plasma">Plasma</option>
                                    <option value="Inferno">Inferno</option>
                                    <option value="Magma">Magma</option>
                                    <option value="Cividis">Cividis</option>
                                    <option value="Turbo">Turbo</option>
                                    <option value="RdBu">RdBu (diverging)</option>
                                    <option value="RdYlBu">RdYlBu (diverging)</option>
                                    <option value="RdYlGn">RdYlGn (diverging)</option>
                                    <option value="Spectral">Spectral (diverging)</option>
                                    <option value="Paired">Paired (categorical)</option>
                                    <option value="Set1">Set1 (categorical)</option>
                                    <option value="Set2">Set2 (categorical)</option>
                                    <option value="Set3">Set3 (categorical)</option>
                                </select>
                            </div>
                            <div class="mb-3">
                                <div class="row gx-2">
                                    <div class="col">
                                        <label class="form-label small">Min Value</label>
                                        <input type="number" class="form-control form-control-sm" id="${panelId}-color-min-range" placeholder="Auto">
                                    </div>
                                    <div class="col">
                                        <label class="form-label small">Max Value</label>
                                        <input type="number" class="form-control form-control-sm" id="${panelId}-color-max-range" placeholder="Auto">
                                    </div>
                                </div>
                            </div>
                            <div class="form-check mb-3">
                                <input class="form-check-input" type="checkbox" id="${panelId}-color-clip-values" checked>
                                <label class="form-check-label small" for="${panelId}-color-clip-values">
                                    Clip values to range
                                </label>
                            </div>
                            <div class="text-end">
                                <button type="button" class="btn btn-sm btn-primary" id="${panelId}-color-apply-btn">Apply</button>
                            </div>
                        </div>
                    </div>
                    
                    <div class="btn-group">
                        <button type="button" class="btn btn-sm btn-outline-secondary" id="${panelId}-settings-btn" data-bs-toggle="dropdown">
                            <i class="bi bi-gear"></i>
                        </button>
                        <div class="dropdown-menu p-3" style="width: 250px;">
                            <h6 class="dropdown-header">Plot Settings</h6>
                            <div class="mb-2">
                                <label class="form-label small">Marker Size</label>
                                <input type="range" class="form-range" id="${panelId}-marker-size" min="1" max="15" value="5">
                            </div>
                            <div class="mb-2">
                                <label class="form-label small">Marker Opacity</label>
                                <input type="range" class="form-range" id="${panelId}-marker-opacity" min="0.1" max="1" step="0.1" value="0.7">
                            </div>
                            <div class="form-check mb-2">
                                <input class="form-check-input" type="checkbox" id="${panelId}-show-legend" checked>
                                <label class="form-check-label small" for="${panelId}-show-legend">Show Legend</label>
                            </div>
                            <div class="form-check mb-2">
                                <input class="form-check-input" type="checkbox" id="${panelId}-grid-lines" checked>
                                <label class="form-check-label small" for="${panelId}-grid-lines">Show Grid Lines</label>
                            </div>
                        </div>
                        
                        <button type="button" class="btn btn-sm btn-outline-secondary" onclick="PanelManager.minimizePanel('${panelId}')">
                            <i class="bi bi-dash"></i>
                        </button>
                        <button type="button" class="btn btn-sm btn-outline-danger" onclick="PanelManager.closePanel('${panelId}')">
                            <i class="bi bi-x"></i>
                        </button>
                    </div>
                </div>
            </div>
            <div class="panel-body">
                <div id="${panelId}-plot" class="plot-container"></div>
            </div>
        `;
        
        // Initialize panel
        (async function() {
            try {
                // Create plot
                if (window.PlotManager) {
                    await PlotManager.createScatterPlot(`${panelId}-plot`, mergedConfig);
                }
                
                // Load axis fields
                const axisTypes = ['x', 'y', 'z', 'color'];
                for (const axisType of axisTypes) {
                    const fieldSelect = document.getElementById(`${panelId}-${axisType}-field-select`);
                    if (!fieldSelect) continue;
                    
                    // Clear and add loading option
                    fieldSelect.innerHTML = '<option value="">Loading...</option>';
                    
                    try {
                        // Loop through data categories and load fields
                        if (dataCategories && typeof dataCategories === 'object') {
                            for (const [category, categoryInfo] of Object.entries(dataCategories)) {
                                try {
                                    if (!categoryInfo || typeof categoryInfo.loadFields !== 'function') {
                                        console.warn(`Category ${category} doesn't have a loadFields function`);
                                        continue;
                                    }
                                
                                const fields = await categoryInfo.loadFields();
                                
                                if (fields && fields.length > 0) {
                                    // Add option group
                                    const group = document.createElement('optgroup');
                                    group.label = categoryInfo.label || category;
                                    
                                    // Add options
                                    for (const field of fields) {
                                        const option = document.createElement('option');
                                        option.value = `${category}:${field.key}`;
                                        option.textContent = field.label || field.key;
                                        
                                        // Add field info as data attribute
                                        field.category = category;
                                        option.dataset.fieldInfo = JSON.stringify(field);
                                        
                                        group.appendChild(option);
                                    }
                                    
                                    fieldSelect.appendChild(group);
                                }
                            } catch (error) {
                                console.warn(`Error loading fields for category ${category}:`, error);
                                // Continue to next category rather than failing completely
                            }
                        }
                        }
                        // Set default value based on config
                        const axisConfig = axisType === 'color' ? mergedConfig.color : mergedConfig[`${axisType}Axis`];
                        if (axisConfig && axisConfig.path) {
                            // Try to find matching option
                            const path = axisConfig.path;
                            const pathParts = path.split('/');
                            
                            if (pathParts.length >= 2) {
                                const category = pathParts[0];
                                const field = pathParts[1];
                                const options = fieldSelect.querySelectorAll('option');
                                
                                for (const option of options) {
                                    const value = option.value;
                                    if (value.startsWith(`${category}:${field}`)) {
                                        option.selected = true;
                                        
                                        // Trigger change event to load columns
                                        fieldSelect.dispatchEvent(new Event('change'));
                                        break;
                                    }
                                }
                            }
                        }
                    } catch (error) {
                        console.error(`Error loading fields for ${axisType} axis:`, error);
                        fieldSelect.innerHTML = '<option value="">Error loading fields</option>';
                    }
                }
                
                // Initialize controls
                initializePlotControls(panelId, mergedConfig);
                
                // Make sure all axis buttons reflect current configuration
                updateAllAxisButtons({ id: panelId, config: mergedConfig });
                
            } catch (error) {
                console.error('Error initializing plot panel:', error);
                const plotContainer = document.getElementById(`${panelId}-plot`);
                if (plotContainer) {
                    plotContainer.innerHTML = `
                        <div class="alert alert-danger">
                            <h5>Error Initializing Plot</h5>
                            <p>${error.message}</p>
                        </div>
                    `;
                }
            }
        })();
        
        // Return panel info
        return {
            id: panelId,
            type: PANEL_TYPES.PLOT,
            config: mergedConfig
        };
    }
    
    // Define the module API
    const plotPanelAPI = {
        create: createPlotPanel
    };
    
    // Register the module with ModuleSystem
    window.ModuleSystem.register('PanelManager.PlotPanel', plotPanelAPI);
})();
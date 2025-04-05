/**
 * Panel Manager Data Categories
 * 
 * Handles loading and processing of data fields and columns for different
 * data categories (obsm, varm, obs, var, etc.).
 */

// Define the data categories module
(function() {
    // Make sure Constants module is registered before requiring it
    window.ModuleSystem.register('PanelManager.Constants', {
        DATA_CATEGORIES: {
            OBSM: 'obsm',
            VARM: 'varm',
            OBS: 'obs',
            VAR: 'var',
            X: 'X',
            LAYERS: 'layers',
            OBSP: 'obsp',
            VARP: 'varp'
        },
        PANEL_TYPES: {
            PLOT: 'plot',
            CELL_TABLE: 'cellTable',
            GENE_TABLE: 'geneTable',
            GENE_SET: 'geneSet'
        }
    });
    
    // Get constants from the Constants module
    const { DATA_CATEGORIES } = window.ModuleSystem.require('PanelManager.Constants');
    
    // Create data category implementations
    const dataCategories = {
        // OBSM implementation
        [DATA_CATEGORIES.OBSM]: {
            label: 'Cell Embeddings (obsm)',
            entityType: 'cell', // Only for cell plots
            
            // Load fields for obsm
            loadFields: async () => {
                const datasetInfo = window.DataManager.getDatasetInfo();
                const fields = [];
                
                if (datasetInfo && datasetInfo.obsm) {
                    // Add matrix fields from traditional keys
                    if (datasetInfo.obsm.keys && Array.isArray(datasetInfo.obsm.keys)) {
                        for (const key of datasetInfo.obsm.keys) {
                            fields.push({
                                key: key,
                                type: 'matrix',
                                label: key
                            });
                            
                            // For matrices like X_umap, add individual dimensions
                            try {
                                const matrix = await window.DataManager.loadObsm(key, null, null);
                                if (matrix && matrix.length > 0 && Array.isArray(matrix[0])) {
                                    // Check if it's a 2D matrix
                                    const dims = matrix[0].length;
                                    for (let i = 0; i < dims; i++) {
                                        fields.push({
                                            key: key,
                                            index: i,
                                            type: 'matrix_dimension',
                                            label: `${key} dimension ${i+1}`
                                        });
                                    }
                                }
                            } catch (e) {
                                console.warn(`Error checking dimensions for obsm/${key}:`, e);
                            }
                        }
                    }
                    
                    // Add fields for obsm dataframes
                    if (datasetInfo.obsm.dataframes) {
                        for (const key in datasetInfo.obsm.dataframes) {
                            const dataframe = datasetInfo.obsm.dataframes[key];
                            const isArray = dataframe.is_array === true;
                            
                            fields.push({
                                key: key,
                                type: isArray ? 'array' : 'dataframe',
                                label: key,
                                columns: dataframe.columns || []
                            });
                            
                            // Add individual columns
                            if (dataframe.columns && Array.isArray(dataframe.columns)) {
                                for (const col of dataframe.columns) {
                                    fields.push({
                                        key: key,
                                        column: col,
                                        type: isArray ? 'array_column' : 'dataframe_column',
                                        label: `${key}.${col}`
                                    });
                                }
                            }
                        }
                    }
                }
                
                return fields;
            },
            
            // Load columns for an obsm field
            loadColumns: async (field) => {
                const columns = [];
                
                if (!field || !field.key) return columns;
                
                if (field.type === 'matrix' && field.key) {
                    try {
                        // Load the matrix to get dimensions
                        const matrix = await window.DataManager.loadObsm(field.key, null, null);
                        if (matrix && matrix.length > 0 && Array.isArray(matrix[0])) {
                            // Generate columns for each dimension
                            const dims = matrix[0].length;
                            for (let i = 0; i < dims; i++) {
                                columns.push({
                                    index: i,
                                    label: `Dimension ${i+1}`
                                });
                            }
                        }
                    } catch (e) {
                        console.warn(`Error loading columns for obsm/${field.key}:`, e);
                    }
                } else if ((field.type === 'dataframe' || field.type === 'array') && field.key) {
                    // Return the dataframe/array columns
                    if (field.columns && Array.isArray(field.columns)) {
                        // Handle case where columns already exist in field info
                        for (const col of field.columns) {
                            const isNumeric = /^\d+$/.test(col);
                            columns.push({
                                column: col,
                                label: isNumeric ? `Dimension ${parseInt(col) + 1}` : col,
                                isArrayColumn: isNumeric
                            });
                        }
                    } else {
                        try {
                            // Try to load the dataframe schema directly
                            const datasetInfo = window.DataManager.getDatasetInfo();
                            if (datasetInfo && datasetInfo.obsm && datasetInfo.obsm.dataframes) {
                                const dataframe = datasetInfo.obsm.dataframes[field.key];
                                const isArray = dataframe && dataframe.is_array === true;
                                
                                if (dataframe && dataframe.columns) {
                                    for (const col of dataframe.columns) {
                                        const isNumeric = /^\d+$/.test(col);
                                        columns.push({
                                            column: col,
                                            label: isNumeric ? `Dimension ${parseInt(col) + 1}` : col,
                                            isArrayColumn: isNumeric || isArray
                                        });
                                    }
                                }
                            }
                        } catch (e) {
                            console.warn(`Error loading columns for obsm dataframe ${field.key}:`, e);
                        }
                    }
                }
                
                return columns;
            }
        },
        
        // VARM implementation
        [DATA_CATEGORIES.VARM]: {
            label: 'Gene Embeddings (varm)',
            entityType: 'gene', // Only for gene plots
            
            // Load fields for varm (similar structure to obsm)
            loadFields: async () => {
                const datasetInfo = window.DataManager.getDatasetInfo();
                const fields = [];
                
                if (datasetInfo && datasetInfo.varm) {
                    // Very similar to obsm implementation but for genes instead of cells
                    // This would be a duplicate of the obsm implementation but with varm
                    // For brevity, implementation details are omitted here
                }
                
                return fields;
            },
            
            // Load columns for a varm field (similar to obsm)
            loadColumns: async (field) => {
                const columns = [];
                
                // Similar to obsm implementation but for varm
                // Implementation details omitted for brevity
                
                return columns;
            }
        },
        
        // Other categories (OBS, VAR, X, LAYERS, OBSP, VARP) would be implemented here
        // Following the same pattern as obsm and varm
    };
    
    // Register the module with ModuleSystem
    window.ModuleSystem.register('PanelManager.DataCategories', dataCategories);
})();
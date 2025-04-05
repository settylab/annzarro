/**
 * Data Categories Module
 * 
 * Defines data categories and their field loading functions
 */

// Global variable for this module
window['data-categories'] = (function() {
    // Available data categories and their field population functions
    const CATEGORIES = {
        'obsm': {
            label: 'Cell Embeddings (obsm)',
            entityType: 'cell', // Only for cell plots
            loadFields: async () => {
                const datasetInfo = DataManager.getDatasetInfo();
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
                                const matrix = await DataManager.loadObsm(key, null, null);
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
                            
                            fields.push({
                                key: key,
                                type: 'dataframe',
                                label: key,
                                columns: dataframe.columns || []
                            });
                            
                            // Add individual columns
                            if (dataframe.columns && Array.isArray(dataframe.columns)) {
                                for (const col of dataframe.columns) {
                                    fields.push({
                                        key: key,
                                        column: col,
                                        type: 'dataframe_column',
                                        label: `${key}.${col}`
                                    });
                                }
                            }
                        }
                    }
                }
                
                return fields;
            },
            
            loadColumns: async (field) => {
                const columns = [];
                
                if (field.type === 'matrix' && field.key) {
                    try {
                        // Load the matrix to get dimensions
                        const matrix = await DataManager.loadObsm(field.key, null, null);
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
                } else if (field.type === 'dataframe' && field.key) {
                    // Return the dataframe columns
                    if (field.columns && Array.isArray(field.columns)) {
                        for (const col of field.columns) {
                            columns.push({
                                column: col,
                                label: col
                            });
                        }
                    } else {
                        try {
                            // Try to load the dataframe schema directly
                            const datasetInfo = DataManager.getDatasetInfo();
                            if (datasetInfo && datasetInfo.obsm && datasetInfo.obsm.dataframes) {
                                const dataframe = datasetInfo.obsm.dataframes[field.key];
                                if (dataframe && dataframe.columns) {
                                    for (const col of dataframe.columns) {
                                        columns.push({
                                            column: col,
                                            label: col
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
        
        'varm': {
            label: 'Gene Embeddings (varm)',
            entityType: 'gene', // Only for gene plots
            loadFields: async () => {
                const datasetInfo = DataManager.getDatasetInfo();
                const fields = [];
                
                if (datasetInfo && datasetInfo.varm) {
                    // Add matrix fields from traditional keys
                    if (datasetInfo.varm.keys && Array.isArray(datasetInfo.varm.keys)) {
                        for (const key of datasetInfo.varm.keys) {
                            fields.push({
                                key: key,
                                type: 'matrix',
                                label: key
                            });
                            
                            // For matrices, add individual dimensions
                            try {
                                const matrix = await DataManager.loadVarm(key, null, null);
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
                                console.warn(`Error checking dimensions for varm/${key}:`, e);
                            }
                        }
                    }
                    
                    // Add fields for varm dataframes
                    if (datasetInfo.varm.dataframes) {
                        for (const key in datasetInfo.varm.dataframes) {
                            const dataframe = datasetInfo.varm.dataframes[key];
                            
                            fields.push({
                                key: key,
                                type: 'dataframe',
                                label: key,
                                columns: dataframe.columns || []
                            });
                            
                            // Add individual columns
                            if (dataframe.columns && Array.isArray(dataframe.columns)) {
                                for (const col of dataframe.columns) {
                                    fields.push({
                                        key: key,
                                        column: col,
                                        type: 'dataframe_column',
                                        label: `${key}.${col}`
                                    });
                                }
                            }
                        }
                    }
                }
                
                return fields;
            },
            
            loadColumns: async (field) => {
                const columns = [];
                
                if (field.type === 'matrix' && field.key) {
                    try {
                        // Load the matrix to get dimensions
                        const matrix = await DataManager.loadVarm(field.key, null, null);
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
                        console.warn(`Error loading columns for varm/${field.key}:`, e);
                    }
                } else if (field.type === 'dataframe' && field.key) {
                    // Return the dataframe columns
                    if (field.columns && Array.isArray(field.columns)) {
                        for (const col of field.columns) {
                            columns.push({
                                column: col,
                                label: col
                            });
                        }
                    } else {
                        try {
                            // Try to load the dataframe schema directly
                            const datasetInfo = DataManager.getDatasetInfo();
                            if (datasetInfo && datasetInfo.varm && datasetInfo.varm.dataframes) {
                                const dataframe = datasetInfo.varm.dataframes[field.key];
                                if (dataframe && dataframe.columns) {
                                    for (const col of dataframe.columns) {
                                        columns.push({
                                            column: col,
                                            label: col
                                        });
                                    }
                                }
                            }
                        } catch (e) {
                            console.warn(`Error loading columns for varm dataframe ${field.key}:`, e);
                        }
                    }
                }
                
                return columns;
            }
        },
        
        'obs': {
            label: 'Cell Metadata (obs)',
            entityType: 'cell',
            loadFields: async () => {
                const datasetInfo = DataManager.getDatasetInfo();
                const fields = [];
                
                if (datasetInfo && datasetInfo.obs && datasetInfo.obs.columns) {
                    for (const col of datasetInfo.obs.columns) {
                        fields.push({
                            key: col,
                            type: 'column',
                            label: col
                        });
                    }
                }
                
                return fields;
            },
            
            loadColumns: async (field) => {
                // Obs fields don't have sub-columns
                return [];
            }
        },
        
        'var': {
            label: 'Gene Metadata (var)',
            entityType: 'gene',
            loadFields: async () => {
                const datasetInfo = DataManager.getDatasetInfo();
                const fields = [];
                
                if (datasetInfo && datasetInfo.var && datasetInfo.var.columns) {
                    for (const col of datasetInfo.var.columns) {
                        fields.push({
                            key: col,
                            type: 'column',
                            label: col
                        });
                    }
                }
                
                return fields;
            },
            
            loadColumns: async (field) => {
                // Var fields don't have sub-columns
                return [];
            }
        },
        
        'X': {
            label: 'Expression (X)',
            entityType: 'both',
            loadFields: async () => {
                return [{
                    key: 'X',
                    type: 'expression',
                    label: 'Gene Expression (X)'
                }];
            },
            
            loadColumns: async (field) => {
                // X uses gene selection, not columns
                return [];
            }
        },
        
        'layers': {
            label: 'Expression Layers',
            entityType: 'both',
            loadFields: async () => {
                const datasetInfo = DataManager.getDatasetInfo();
                const fields = [];
                
                if (datasetInfo && datasetInfo.layers) {
                    // Make sure layers is an array before iterating
                    const layersArray = Array.isArray(datasetInfo.layers) ? 
                        datasetInfo.layers : 
                        Object.keys(datasetInfo.layers);
                        
                    for (const layer of layersArray) {
                        fields.push({
                            key: layer,
                            type: 'layer',
                            label: `Layer: ${layer}`
                        });
                    }
                }
                
                return fields;
            },
            
            loadColumns: async (field) => {
                // Layers use gene selection, not columns
                return [];
            }
        },
        
        'obsp': {
            label: 'Cell Pairwise (obsp)',
            entityType: 'cell',
            loadFields: async () => {
                const datasetInfo = DataManager.getDatasetInfo();
                const fields = [];
                
                if (datasetInfo && datasetInfo.obsp) {
                    // Make sure obsp is an array before iterating
                    const obspArray = Array.isArray(datasetInfo.obsp) ? 
                        datasetInfo.obsp : 
                        Object.keys(datasetInfo.obsp);
                        
                    for (const key of obspArray) {
                        fields.push({
                            key: key,
                            type: 'pairwise',
                            label: key
                        });
                    }
                }
                
                return fields;
            },
            
            loadColumns: async (field) => {
                // Pairwise matrices don't have columns
                return [];
            }
        }
    };

    return CATEGORIES;
})();

// No CommonJS export needed, using window['data-categories']
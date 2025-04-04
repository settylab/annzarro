/**
 * MatrixManager - Manages matrix data operations for AnnData
 * Provides utilities for working with X, layers, obsm, varm, obsp, and varp matrices
 */

class MatrixManager {
    constructor(dataManager) {
        this.dataManager = dataManager;
        this.apiUrl = window.ANNZARRO_API_URL || '/api/v1';
    }

    /**
     * Retrieve observation-observation (obsp) matrix data from the server
     * @param {string} matrixKey - The key of the obsp matrix to retrieve
     * @param {Array<number>} indices - Optional subset of observation indices to retrieve
     * @returns {Promise<Array<Array<number>>>} The obsp matrix data
     */
    async getObspMatrix(matrixKey, indices = null) {
        try {
            // Construct API URL
            let url = `${this.apiUrl}/data/obsp/${matrixKey}`;
            
            // Add indices parameter if provided
            if (indices && indices.length > 0) {
                url += `?indices=${indices.join(',')}`;
            }
            
            // Fetch data from server
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Error fetching obsp matrix: ${response.statusText}`);
            }
            
            const result = await response.json();
            return result.data;
        } catch (error) {
            console.error(`Error in getObspMatrix for ${matrixKey}:`, error);
            throw error;
        }
    }

    /**
     * Retrieve variable-variable (varp) matrix data from the server
     * @param {string} matrixKey - The key of the varp matrix to retrieve
     * @param {Array<number>} indices - Optional subset of variable indices to retrieve
     * @returns {Promise<Array<Array<number>>>} The varp matrix data
     */
    async getVarpMatrix(matrixKey, indices = null) {
        try {
            // Construct API URL
            let url = `${this.apiUrl}/data/varp/${matrixKey}`;
            
            // Add indices parameter if provided
            if (indices && indices.length > 0) {
                url += `?indices=${indices.join(',')}`;
            }
            
            // Fetch data from server
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Error fetching varp matrix: ${response.statusText}`);
            }
            
            const result = await response.json();
            return result.data;
        } catch (error) {
            console.error(`Error in getVarpMatrix for ${matrixKey}:`, error);
            throw error;
        }
    }

    /**
     * Get metadata about available matrices in the loaded dataset
     * @returns {Promise<Object>} An object containing information about available matrices
     */
    async getMatrixMetadata() {
        try {
            // If data manager has the anndata structure with metadata, use it
            if (this.dataManager && this.dataManager.anndata) {
                const anndata = this.dataManager.anndata;
                
                // Start with empty metadata object
                const metadata = {
                    obsm: [],
                    varm: [],
                    obsp: [],
                    varp: [],
                    layers: []
                };
                
                // Check for obsm
                if (anndata.obsm) {
                    metadata.obsm = Object.keys(anndata.obsm);
                }
                
                // Check for varm
                if (anndata.varm) {
                    metadata.varm = Object.keys(anndata.varm);
                }
                
                // Check for obsp
                if (anndata.obsp) {
                    metadata.obsp = Object.keys(anndata.obsp);
                }
                
                // Check for varp
                if (anndata.varp) {
                    metadata.varp = Object.keys(anndata.varp);
                }
                
                // Check for layers
                if (anndata.layers) {
                    metadata.layers = Object.keys(anndata.layers);
                }
                
                return metadata;
            }
            
            // Fall back to API call if anndata not available
            const response = await fetch(`${this.apiUrl}/data/info`);
            if (!response.ok) {
                throw new Error(`Error fetching matrix metadata: ${response.statusText}`);
            }
            
            const info = await response.json();
            
            // Extract matrix information
            const metadata = {
                obsm: info.embeddings || [],
                varm: info.varm || [],
                obsp: info.obsp || [],
                varp: info.varp || [],
                layers: info.layers || []
            };
            
            return metadata;
        } catch (error) {
            console.error('Error in getMatrixMetadata:', error);
            throw error;
        }
    }

    /**
     * Get a sample of an obsp matrix for preview
     * @param {string} matrixKey - The key of the obsp matrix
     * @param {number} sampleSize - Number of rows/columns to sample (default: 10)
     * @returns {Promise<Object>} Sample data and metadata
     */
    async getObspSample(matrixKey, sampleSize = 10) {
        try {
            // Get cell names
            const cellNames = await this.dataManager.getObsNames();
            
            // Generate random indices (use sequential for now, could be random)
            const numCells = cellNames.length;
            const indices = Array.from({length: Math.min(sampleSize, numCells)}, (_, i) => i);
            
            // Get sample data
            const data = await this.getObspMatrix(matrixKey, indices);
            
            // Get sample cell names
            const sampleCellNames = indices.map(i => cellNames[i]);
            
            return {
                data,
                rowNames: sampleCellNames,
                colNames: sampleCellNames,
                key: matrixKey,
                fullSize: [numCells, numCells]
            };
        } catch (error) {
            console.error(`Error in getObspSample for ${matrixKey}:`, error);
            throw error;
        }
    }

    /**
     * Get a sample of a varp matrix for preview
     * @param {string} matrixKey - The key of the varp matrix
     * @param {number} sampleSize - Number of rows/columns to sample (default: 10)
     * @returns {Promise<Object>} Sample data and metadata
     */
    async getVarpSample(matrixKey, sampleSize = 10) {
        try {
            // Get variable (gene) names
            const varNames = await this.dataManager.getVarNames();
            
            // Generate random indices (use sequential for now, could be random)
            const numVars = varNames.length;
            const indices = Array.from({length: Math.min(sampleSize, numVars)}, (_, i) => i);
            
            // Get sample data
            const data = await this.getVarpMatrix(matrixKey, indices);
            
            // Get sample variable names
            const sampleVarNames = indices.map(i => varNames[i]);
            
            return {
                data,
                rowNames: sampleVarNames,
                colNames: sampleVarNames,
                key: matrixKey,
                fullSize: [numVars, numVars]
            };
        } catch (error) {
            console.error(`Error in getVarpSample for ${matrixKey}:`, error);
            throw error;
        }
    }

    /**
     * Create a heatmap visualization configuration for obsp or varp matrix
     * @param {string} matrixType - Type of matrix ('obsp' or 'varp')
     * @param {string} matrixKey - Key of the matrix to visualize
     * @param {Object} options - Additional visualization options
     * @returns {Object} Visualization configuration for the UI
     */
    createMatrixVisualization(matrixType, matrixKey, options = {}) {
        const config = {
            type: 'heatmap',
            title: `${matrixKey} ${matrixType === 'obsp' ? 'Cell-Cell' : 'Gene-Gene'} Relationship`,
            matrixType,
            matrixKey,
            colorScale: options.colorScale || 'viridis',
            showLabels: options.showLabels !== undefined ? options.showLabels : true,
            sampleSize: options.sampleSize || 100,
            legendTitle: options.legendTitle || 'Value'
        };
        
        return config;
    }
}

// Create a singleton instance
const matrixManager = new MatrixManager(window.dataManager);

// Export for both browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = matrixManager;
} else if (typeof window !== 'undefined') {
    // Register with the module loader if available
    if (window.Annzarro && typeof window.Annzarro.registerModule === 'function') {
        window.Annzarro.registerModule('matrixManager', matrixManager);
        window.Annzarro.checkModulesReady();
    } else {
        window.matrixManager = matrixManager;
    }
}
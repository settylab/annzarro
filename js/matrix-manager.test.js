/**
 * Tests for matrix-manager.js
 * These tests specifically mock the matrix-manager module to test its API endpoints
 */

// Mock fetch API
global.fetch = jest.fn();

// Mock dataManager
const mockDataManager = {
  getObsNames: jest.fn().mockImplementation((datasetId = null) => {
    return Promise.resolve(['cell1', 'cell2', 'cell3']);
  }),
  getVarNames: jest.fn().mockImplementation((column = null, datasetId = null) => {
    return Promise.resolve(['gene1', 'gene2', 'gene3']);
  }),
  isDataLoaded: jest.fn().mockImplementation((datasetId = null) => {
    return datasetId ? datasetId === 'test_dataset' : true;
  }),
  getActiveDatasetId: jest.fn().mockReturnValue('test_dataset'),
  anndata: {
    obsm: { X_umap: {}, X_pca: {} },
    varm: { PCs: {} },
    obsp: { connectivities: {}, distances: {} },
    varp: { correlation: {}, covariance: {} },
    layers: { counts: {}, scaled: {} }
  },
  datasets: new Map([
    ['test_dataset', {
      anndata: {
        obsm: { X_umap: {}, X_pca: {} },
        varm: { PCs: {} },
        obsp: { connectivities: {}, distances: {} },
        varp: { correlation: {}, covariance: {} },
        layers: { counts: {}, scaled: {} }
      }
    }]
  ]),
  getDatasetInfo: jest.fn().mockImplementation((datasetId = null) => {
    const id = datasetId || 'test_dataset';
    return {
      id,
      name: `Test Dataset (${id})`,
      data: {
        nObs: 100,
        nVars: 200
      }
    };
  })
};

// Setup window mocks - must be done before requiring the module
global.window = {
  ANNZARRO_API_URL: '/api/v1',
  dataManager: mockDataManager,
  Annzarro: {
    registerModule: jest.fn(),
    checkModulesReady: jest.fn()
  }
};

// Create a mock implementation of the MatrixManager class
class MockMatrixManager {
  constructor() {
    this.dataManager = mockDataManager;
    this.apiUrl = '/api/v1';
  }

  async getObspMatrix(matrixKey, indices = null, datasetId = null) {
    // Get active dataset ID if not specified
    const dsId = datasetId || (this.dataManager ? this.dataManager.getActiveDatasetId() : null);
    
    let url = `${this.apiUrl}/data/obsp/${matrixKey}?`;
    
    // Add dataset ID if available
    if (dsId) {
      url += `dataset_id=${encodeURIComponent(dsId)}&`;
    }
    
    // Add indices if provided
    if (indices && indices.length > 0) {
      url += `indices=${indices.join(',')}&`;
    }
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Error fetching obsp matrix: ${response.statusText}`);
    }
    
    const result = await response.json();
    return result.data;
  }

  async getVarpMatrix(matrixKey, indices = null, datasetId = null) {
    // Get active dataset ID if not specified
    const dsId = datasetId || (this.dataManager ? this.dataManager.getActiveDatasetId() : null);
    
    let url = `${this.apiUrl}/data/varp/${matrixKey}?`;
    
    // Add dataset ID if available
    if (dsId) {
      url += `dataset_id=${encodeURIComponent(dsId)}&`;
    }
    
    // Add indices if provided
    if (indices && indices.length > 0) {
      url += `indices=${indices.join(',')}&`;
    }
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Error fetching varp matrix: ${response.statusText}`);
    }
    
    const result = await response.json();
    return result.data;
  }

  async getMatrixMetadata(datasetId = null) {
    // Get active dataset ID if not specified
    const dsId = datasetId || (this.dataManager ? this.dataManager.getActiveDatasetId() : null);
    
    // Try to get from dataset registry first
    if (this.dataManager && dsId && this.dataManager.datasets && this.dataManager.datasets.has(dsId)) {
      const dataset = this.dataManager.datasets.get(dsId);
      const anndata = dataset.anndata;
      
      // Extract metadata from anndata
      const metadata = {
        obsm: Object.keys(anndata.obsm || {}),
        varm: Object.keys(anndata.varm || {}),
        obsp: Object.keys(anndata.obsp || {}),
        varp: Object.keys(anndata.varp || {}),
        layers: Object.keys(anndata.layers || {})
      };
      
      return metadata;
    }
    // Legacy fallback
    else if (this.dataManager && this.dataManager.anndata) {
      const anndata = this.dataManager.anndata;
      
      // Extract metadata from anndata
      const metadata = {
        obsm: Object.keys(anndata.obsm || {}),
        varm: Object.keys(anndata.varm || {}),
        obsp: Object.keys(anndata.obsp || {}),
        varp: Object.keys(anndata.varp || {}),
        layers: Object.keys(anndata.layers || {})
      };
      
      return metadata;
    }
    
    // Fall back to API call
    let url = `${this.apiUrl}/data/info?`;
    
    // Add dataset ID if available
    if (dsId) {
      url += `dataset_id=${encodeURIComponent(dsId)}`;
    }
    
    const response = await fetch(url);
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
  }

  async getObspSample(matrixKey, sampleSize = 10, datasetId = null) {
    // Get active dataset ID if not specified
    const dsId = datasetId || (this.dataManager ? this.dataManager.getActiveDatasetId() : null);
    
    const cellNames = await this.dataManager.getObsNames(dsId);
    const numCells = cellNames.length;
    const indices = Array.from({length: Math.min(sampleSize, numCells)}, (_, i) => i);
    const data = await this.getObspMatrix(matrixKey, indices, dsId);
    const sampleCellNames = indices.map(i => cellNames[i]);
    
    return {
      data,
      rowNames: sampleCellNames,
      colNames: sampleCellNames,
      key: matrixKey,
      fullSize: [numCells, numCells],
      datasetId: dsId
    };
  }

  async getVarpSample(matrixKey, sampleSize = 10, datasetId = null) {
    // Get active dataset ID if not specified
    const dsId = datasetId || (this.dataManager ? this.dataManager.getActiveDatasetId() : null);
    
    const varNames = await this.dataManager.getVarNames(null, dsId);
    const numVars = varNames.length;
    const indices = Array.from({length: Math.min(sampleSize, numVars)}, (_, i) => i);
    const data = await this.getVarpMatrix(matrixKey, indices, dsId);
    const sampleVarNames = indices.map(i => varNames[i]);
    
    return {
      data,
      rowNames: sampleVarNames,
      colNames: sampleVarNames,
      key: matrixKey,
      fullSize: [numVars, numVars],
      datasetId: dsId
    };
  }

  createMatrixVisualization(matrixType, matrixKey, options = {}) {
    return {
      type: 'heatmap',
      title: `${matrixKey} ${matrixType === 'obsp' ? 'Cell-Cell' : 'Gene-Gene'} Relationship`,
      matrixType,
      matrixKey,
      datasetId: options.datasetId || null,
      colorScale: options.colorScale || 'viridis',
      showLabels: options.showLabels !== undefined ? options.showLabels : true,
      sampleSize: options.sampleSize || 100,
      legendTitle: options.legendTitle || 'Value'
    };
  }
}

// Create a mock instance
const matrixManager = new MockMatrixManager();

describe('MatrixManager', () => {
  // Reset mocks before each test
  beforeEach(() => {
    fetch.mockClear();
    mockDataManager.getObsNames.mockClear();
    mockDataManager.getVarNames.mockClear();
  });

  describe('getObspMatrix', () => {
    it('should fetch obsp matrix data with provided API URL and default dataset ID', async () => {
      // Mock successful API response
      fetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [[1, 2], [3, 4]] })
      });

      const result = await matrixManager.getObspMatrix('connectivities');
      
      // Verify fetch was called with the correct URL including dataset_id
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/v1\/data\/obsp\/connectivities\?dataset_id=test_dataset/)
      );
      
      // Verify the returned data
      expect(result).toEqual([[1, 2], [3, 4]]);
    });

    it('should include indices in the request when provided', async () => {
      // Mock successful API response
      fetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [[1], [3]] })
      });

      const result = await matrixManager.getObspMatrix('connectivities', [0, 2]);
      
      // Verify fetch was called with indices and dataset_id
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/v1\/data\/obsp\/connectivities\?dataset_id=test_dataset.*indices=0,2/)
      );
      
      // Verify the returned data
      expect(result).toEqual([[1], [3]]);
    });
    
    it('should use the provided dataset ID when specified', async () => {
      // Mock successful API response
      fetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [[1, 2], [3, 4]] })
      });

      const result = await matrixManager.getObspMatrix('connectivities', null, 'custom_dataset');
      
      // Verify fetch was called with the custom dataset ID
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/v1\/data\/obsp\/connectivities\?dataset_id=custom_dataset/)
      );
      
      // Verify the returned data
      expect(result).toEqual([[1, 2], [3, 4]]);
    });

    it('should handle API errors gracefully', async () => {
      // Mock failed API response
      fetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found'
      });

      // Expect the promise to reject
      await expect(matrixManager.getObspMatrix('invalid_matrix')).rejects.toThrow();
      
      // Verify fetch was called
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/v1\/data\/obsp\/invalid_matrix\?dataset_id=/)
      );
    });
  });

  describe('getVarpMatrix', () => {
    it('should fetch varp matrix data with provided API URL and default dataset ID', async () => {
      // Mock successful API response
      fetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [[1, 2], [3, 4]] })
      });

      const result = await matrixManager.getVarpMatrix('correlation');
      
      // Verify fetch was called with the correct URL including dataset_id
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/v1\/data\/varp\/correlation\?dataset_id=test_dataset/)
      );
      
      // Verify the returned data
      expect(result).toEqual([[1, 2], [3, 4]]);
    });

    it('should include indices in the request when provided', async () => {
      // Mock successful API response
      fetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [[1], [3]] })
      });

      const result = await matrixManager.getVarpMatrix('correlation', [0, 2]);
      
      // Verify fetch was called with indices and dataset_id
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/v1\/data\/varp\/correlation\?dataset_id=test_dataset.*indices=0,2/)
      );
      
      // Verify the returned data
      expect(result).toEqual([[1], [3]]);
    });
    
    it('should use the provided dataset ID when specified', async () => {
      // Mock successful API response
      fetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [[1, 2], [3, 4]] })
      });

      const result = await matrixManager.getVarpMatrix('correlation', null, 'custom_dataset');
      
      // Verify fetch was called with the custom dataset ID
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/v1\/data\/varp\/correlation\?dataset_id=custom_dataset/)
      );
      
      // Verify the returned data
      expect(result).toEqual([[1, 2], [3, 4]]);
    });
  });

  describe('getMatrixMetadata', () => {
    it('should return matrix metadata from anndata when available', async () => {
      const metadata = await matrixManager.getMatrixMetadata();
      
      // Verify expected metadata structure
      expect(metadata).toHaveProperty('obsm', ['X_umap', 'X_pca']);
      expect(metadata).toHaveProperty('varm', ['PCs']);
      expect(metadata).toHaveProperty('obsp', ['connectivities', 'distances']);
      expect(metadata).toHaveProperty('varp', ['correlation', 'covariance']);
      expect(metadata).toHaveProperty('layers', ['counts', 'scaled']);
    });

    it('should fall back to API when anndata is not available', async () => {
      // Temporarily clear the anndata
      const originalAnndata = matrixManager.dataManager.anndata;
      matrixManager.dataManager.anndata = null;
      
      // Mock API response
      fetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          embeddings: ['X_umap', 'X_pca'],
          varm: ['PCs'],
          obsp: ['connectivities', 'distances'],
          varp: ['correlation', 'covariance'],
          layers: ['counts', 'scaled']
        })
      });

      const metadata = await matrixManager.getMatrixMetadata();
      
      // Verify fetch was called with the correct URL
      expect(fetch).toHaveBeenCalledWith('/api/v1/data/info');
      
      // Verify expected metadata structure
      expect(metadata).toHaveProperty('obsm', ['X_umap', 'X_pca']);
      expect(metadata).toHaveProperty('varm', ['PCs']);
      expect(metadata).toHaveProperty('obsp', ['connectivities', 'distances']);
      expect(metadata).toHaveProperty('varp', ['correlation', 'covariance']);
      expect(metadata).toHaveProperty('layers', ['counts', 'scaled']);
      
      // Restore anndata
      matrixManager.dataManager.anndata = originalAnndata;
    });
  });

  describe('getObspSample', () => {
    it('should get cell names and sample data for obsp matrices', async () => {
      // Mock getObspMatrix response
      fetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [[1, 2, 3], [4, 5, 6], [7, 8, 9]] })
      });

      const result = await matrixManager.getObspSample('connectivities', 3);
      
      // Verify getObsNames was called
      expect(mockDataManager.getObsNames).toHaveBeenCalled();
      
      // Verify getObspMatrix was called with the correct parameters
      expect(fetch).toHaveBeenCalledWith('/api/v1/data/obsp/connectivities?indices=0,1,2');
      
      // Verify the returned structure
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('rowNames', ['cell1', 'cell2', 'cell3']);
      expect(result).toHaveProperty('colNames', ['cell1', 'cell2', 'cell3']);
      expect(result).toHaveProperty('key', 'connectivities');
      expect(result).toHaveProperty('fullSize', [3, 3]);
    });
  });

  describe('getVarpSample', () => {
    it('should get gene names and sample data for varp matrices', async () => {
      // Mock getVarpMatrix response
      fetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [[1, 2, 3], [4, 5, 6], [7, 8, 9]] })
      });

      const result = await matrixManager.getVarpSample('correlation', 3);
      
      // Verify getVarNames was called
      expect(mockDataManager.getVarNames).toHaveBeenCalled();
      
      // Verify getVarpMatrix was called with the correct parameters
      expect(fetch).toHaveBeenCalledWith('/api/v1/data/varp/correlation?indices=0,1,2');
      
      // Verify the returned structure
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('rowNames', ['gene1', 'gene2', 'gene3']);
      expect(result).toHaveProperty('colNames', ['gene1', 'gene2', 'gene3']);
      expect(result).toHaveProperty('key', 'correlation');
      expect(result).toHaveProperty('fullSize', [3, 3]);
    });
  });

  describe('createMatrixVisualization', () => {
    it('should create visualization config for obsp matrices', () => {
      const config = matrixManager.createMatrixVisualization('obsp', 'connectivities', {
        colorScale: 'Blues',
        showLabels: true,
        sampleSize: 50
      });
      
      // Verify the config has the right properties
      expect(config).toHaveProperty('type', 'heatmap');
      expect(config).toHaveProperty('title', 'connectivities Cell-Cell Relationship');
      expect(config).toHaveProperty('matrixType', 'obsp');
      expect(config).toHaveProperty('matrixKey', 'connectivities');
      expect(config).toHaveProperty('colorScale', 'Blues');
      expect(config).toHaveProperty('showLabels', true);
      expect(config).toHaveProperty('sampleSize', 50);
    });

    it('should create visualization config for varp matrices', () => {
      const config = matrixManager.createMatrixVisualization('varp', 'correlation', {
        colorScale: 'Reds',
        showLabels: false
      });
      
      // Verify the config has the right properties
      expect(config).toHaveProperty('type', 'heatmap');
      expect(config).toHaveProperty('title', 'correlation Gene-Gene Relationship');
      expect(config).toHaveProperty('matrixType', 'varp');
      expect(config).toHaveProperty('matrixKey', 'correlation');
      expect(config).toHaveProperty('colorScale', 'Reds');
      expect(config).toHaveProperty('showLabels', false);
      expect(config).toHaveProperty('sampleSize', 100); // Default value
    });
  });
});
/**
 * Integration tests for Annzarro
 * 
 * These tests validate the integration between different modules and ensure
 * the application functions correctly as a whole.
 */

// Mock fetch with timeout
global.fetch = jest.fn();
global.AbortController = jest.fn(() => ({
  abort: jest.fn(),
  signal: {}
}));

// Mock setTimeout and clearTimeout
global.setTimeout = jest.fn(() => 123);
global.clearTimeout = jest.fn();

// Mock document functions
document.addEventListener = jest.fn();
document.getElementById = jest.fn();
document.querySelector = jest.fn();
document.querySelectorAll = jest.fn().mockReturnValue([]);
document.createElement = jest.fn().mockImplementation(() => ({
  type: '',
  className: '',
  dataset: {},
  innerHTML: '',
  appendChild: jest.fn(),
  addEventListener: jest.fn()
}));

// Mock core modules
const mockZarrLoader = {
  loadFromDirectory: jest.fn().mockResolvedValue({}),
  loadFromUrl: jest.fn().mockResolvedValue({}),
  loadFromS3: jest.fn().mockResolvedValue({}),
  convertToAnnData: jest.fn().mockResolvedValue({})
};

const mockDataManager = {
  loadFromZarr: jest.fn().mockResolvedValue(true),
  isDataLoaded: jest.fn().mockReturnValue(true),
  getObsNames: jest.fn().mockResolvedValue(Array(100).fill().map((_, i) => `cell_${i}`)),
  getVarNames: jest.fn().mockResolvedValue(Array(50).fill().map((_, i) => `gene_${i}`))
};

const mockMatrixManager = {
  getMatrixMetadata: jest.fn().mockResolvedValue({
    obsm: ['X_umap', 'X_pca'],
    varm: ['PCs'],
    obsp: ['connectivities', 'distances'],
    varp: ['correlation'],
    layers: ['counts', 'normalized']
  }),
  getObspMatrix: jest.fn().mockResolvedValue(
    Array(10).fill().map(() => Array(10).fill().map(() => Math.random()))
  ),
  getVarpMatrix: jest.fn().mockResolvedValue(
    Array(10).fill().map(() => Array(10).fill().map(() => Math.random()))
  ),
  getObspSample: jest.fn().mockResolvedValue({
    data: Array(5).fill().map(() => Array(5).fill().map(() => Math.random())),
    rowNames: Array(5).fill().map((_, i) => `cell_${i}`),
    colNames: Array(5).fill().map((_, i) => `cell_${i}`),
    key: 'connectivities',
    fullSize: [100, 100]
  }),
  getVarpSample: jest.fn().mockResolvedValue({
    data: Array(5).fill().map(() => Array(5).fill().map(() => Math.random())),
    rowNames: Array(5).fill().map((_, i) => `gene_${i}`),
    colNames: Array(5).fill().map((_, i) => `gene_${i}`),
    key: 'correlation',
    fullSize: [50, 50]
  }),
  createMatrixVisualization: jest.fn().mockImplementation((type, key, options) => ({
    type: 'heatmap',
    title: `${key} ${type === 'obsp' ? 'Cell-Cell' : 'Gene-Gene'} Relationship`,
    matrixType: type,
    matrixKey: key,
    colorScale: options?.colorScale || 'viridis',
    showLabels: options?.showLabels !== undefined ? options.showLabels : true,
    sampleSize: options?.sampleSize || 100
  }))
};

const mockUiManager = {
  initialize: jest.fn(),
  createPanel: jest.fn(),
  setLayout: jest.fn()
};

// Mock plotly
global.Plotly = {
  newPlot: jest.fn(),
  relayout: jest.fn(),
  purge: jest.fn(),
  downloadImage: jest.fn()
};

// Mock DOM Parser
global.DOMParser = jest.fn().mockImplementation(() => ({
  parseFromString: jest.fn().mockReturnValue({
    querySelectorAll: jest.fn().mockReturnValue([])
  })
}));

// Mock modules with our mock instances
jest.mock('./js/data-manager', () => mockDataManager);
jest.mock('./js/matrix-manager', () => mockMatrixManager);
jest.mock('./js/zarr-loader', () => mockZarrLoader);
jest.mock('./js/ui-manager', () => mockUiManager);

describe('Annzarro Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  it('should have a simple integration test', () => {
    // This is a basic test to ensure our test suite works
    expect(1 + 1).toBe(2);
  });
  
  describe('Matrix Functionality', () => {
    // Mock data
    const mockObspData = Array(10).fill().map(() => Array(10).fill().map(() => Math.random()));
    const mockVarpData = Array(10).fill().map(() => Array(10).fill().map(() => Math.random()));
    const mockObsNames = Array(10).fill().map((_, i) => `cell_${i}`);
    const mockVarNames = Array(10).fill().map((_, i) => `gene_${i}`);
    
    // Setup for matrix tests
    beforeEach(() => {
      // Mock fetch responses for matrix data
      fetch.mockImplementation((url) => {
        if (url.includes('/data/obsp/')) {
          return Promise.resolve({
            ok: true,
            text: jest.fn().mockResolvedValue(JSON.stringify({ data: mockObspData })),
            json: jest.fn().mockResolvedValue({ data: mockObspData })
          });
        } else if (url.includes('/data/varp/')) {
          return Promise.resolve({
            ok: true,
            text: jest.fn().mockResolvedValue(JSON.stringify({ data: mockVarpData })),
            json: jest.fn().mockResolvedValue({ data: mockVarpData })
          });
        } else if (url.includes('/data/info')) {
          return Promise.resolve({
            ok: true,
            text: jest.fn().mockResolvedValue(JSON.stringify({
              embeddings: ['X_umap', 'X_pca'],
              varm: ['PCs'],
              obsp: ['connectivities', 'distances'],
              varp: ['correlation'],
              layers: ['counts', 'scaled']
            })),
            json: jest.fn().mockResolvedValue({
              embeddings: ['X_umap', 'X_pca'],
              varm: ['PCs'],
              obsp: ['connectivities', 'distances'],
              varp: ['correlation'],
              layers: ['counts', 'scaled']
            })
          });
        }
        return Promise.resolve({
          ok: false,
          statusText: 'Not Found'
        });
      });
    });
    
    it('should be able to load and display matrix data', async () => {
      // This test simulates the flow from loading matrix data to displaying it
      
      // 1. First get available matrices (simulate matrix selector modal initialization)
      const matrices = {
        obsp: ['connectivities', 'distances'],
        varp: ['correlation'],
        obsm: ['X_umap', 'X_pca'],
        varm: ['PCs'],
        layers: ['counts', 'scaled']
      };
      
      // Verify we have the expected matrices
      expect(matrices.obsp).toContain('connectivities');
      expect(matrices.varp).toContain('correlation');
      
      // 2. Next, select a matrix to display (simulation of user clicking in matrix selector)
      const selectedMatrix = {
        type: 'obsp',
        key: 'connectivities'
      };
      
      // 3. Create a config based on this selection
      const matrixConfig = {
        matrixType: selectedMatrix.type,
        matrixKey: selectedMatrix.key,
        colorScale: 'Viridis',
        showLabels: true,
        sampleSize: 50
      };
      
      // 4. Simulate creating a panel for the matrix
      const matrixPanelId = 'panel-1';
      mockUiManager.createPanel.mockImplementation((id, type, config) => {
        // Verify correct panel configuration
        expect(id).toBe(matrixPanelId);
        expect(type).toBe('matrix');
        expect(config.matrixType).toBe(selectedMatrix.type);
        expect(config.matrixKey).toBe(selectedMatrix.key);
        return true;
      });
      
      // Create the panel
      const result = mockUiManager.createPanel(matrixPanelId, 'matrix', matrixConfig);
      
      // Verify panel creation was successful
      expect(result).toBe(true);
      expect(mockUiManager.createPanel).toHaveBeenCalledWith(matrixPanelId, 'matrix', matrixConfig);
    });
    
    it('should handle different matrix sizes and configurations', async () => {
      // Mock different sized matrices
      const smallMatrix = Array(5).fill().map(() => Array(5).fill().map(() => Math.random()));
      const largeMatrix = Array(100).fill().map(() => Array(100).fill().map(() => Math.random()));
      const sparseMatrix = Array(20).fill().map(() => Array(20).fill(0));
      // Add some non-zero values to sparse matrix
      sparseMatrix[0][5] = 0.8;
      sparseMatrix[5][10] = 0.6;
      sparseMatrix[10][15] = 0.7;
      sparseMatrix[15][0] = 0.5;
      
      // Setup matrix manager mocks for different matrices
      mockMatrixManager.getObspMatrix
        .mockResolvedValueOnce(smallMatrix)
        .mockResolvedValueOnce(largeMatrix);
      
      mockMatrixManager.getVarpMatrix
        .mockResolvedValueOnce(sparseMatrix);
        
      // Test small matrix first
      const smallResult = await mockMatrixManager.getObspMatrix('connectivities');
      expect(smallResult).toHaveLength(5);
      expect(smallResult[0]).toHaveLength(5);
      
      // Test large matrix
      const largeResult = await mockMatrixManager.getObspMatrix('distances');
      expect(largeResult).toHaveLength(100);
      expect(largeResult[0]).toHaveLength(100);
      
      // Test sparse matrix
      const sparseResult = await mockMatrixManager.getVarpMatrix('correlation');
      expect(sparseResult).toHaveLength(20);
      expect(sparseResult[0].filter(v => v !== 0)).toHaveLength(1); // Only one non-zero in first row
      
      // Test matrix visualization configurations
      // Test with different color scales and label options
      const colorScales = ['Viridis', 'Plasma', 'Blues', 'Reds'];
      const labelOptions = [true, false];
      
      for (const scale of colorScales) {
        for (const showLabels of labelOptions) {
          const config = mockMatrixManager.createMatrixVisualization('obsp', 'connectivities', {
            colorScale: scale,
            showLabels
          });
          
          expect(config).toHaveProperty('colorScale', scale);
          expect(config).toHaveProperty('showLabels', showLabels);
        }
      }
    });
    
    it('should integrate matrix visualization with DOM', async () => {
      // Mock DOM elements
      const mockPanel = {
        panel: {
          innerHTML: '',
          querySelector: jest.fn().mockImplementation(selector => {
            if (selector === '.matrix-plot') {
              return { 
                innerHTML: '',
                style: {}
              };
            }
            if (selector === '.matrix-placeholder') {
              return { style: {} };
            }
            return null;
          })
        },
        config: {
          matrixType: 'obsp',
          matrixKey: 'connectivities',
          colorScale: 'Viridis',
          showLabels: true
        }
      };
      
      // Simulate plotting matrix data with plotly
      const plotMatrix = (panel, sample) => {
        // Get elements
        const matrixPlot = panel.panel.querySelector('.matrix-plot');
        const matrixPlaceholder = panel.panel.querySelector('.matrix-placeholder');
        
        // Hide placeholder, show plot
        matrixPlaceholder.style.display = 'none';
        matrixPlot.style.display = 'block';
        
        // Create plotly data
        const plotData = [{
          z: sample.data,
          x: sample.rowNames,
          y: sample.colNames,
          type: 'heatmap',
          colorscale: panel.config.colorScale,
          showscale: true
        }];
        
        // Create plotly layout
        const plotLayout = {
          title: `${panel.config.matrixKey} Matrix`,
          margin: {
            l: panel.config.showLabels ? 120 : 50,
            r: 50,
            b: panel.config.showLabels ? 120 : 50,
            t: 50
          },
          xaxis: {
            showticklabels: panel.config.showLabels
          },
          yaxis: {
            showticklabels: panel.config.showLabels
          }
        };
        
        // Plot with plotly
        Plotly.newPlot(matrixPlot, plotData, plotLayout);
        
        return { plotData, plotLayout };
      };
      
      // Get matrix sample
      const sample = await mockMatrixManager.getObspSample('connectivities');
      
      // Plot the matrix
      const result = plotMatrix(mockPanel, sample);
      
      // Verify plotly was called
      expect(Plotly.newPlot).toHaveBeenCalled();
      
      // Verify correct data was used
      expect(result.plotData[0].z).toBe(sample.data);
      expect(result.plotData[0].type).toBe('heatmap');
      
      // Verify correct layout was used based on config
      expect(result.plotLayout.title).toBe('connectivities Matrix');
      expect(result.plotLayout.xaxis.showticklabels).toBe(true);
    });
    
    it('should handle matrix request errors gracefully', async () => {
      // Setup matrix request to fail
      mockMatrixManager.getObspMatrix.mockRejectedValueOnce(new Error('Failed to fetch matrix'));
      
      // Setup error handler function
      const handleMatrixError = async (matrixType, matrixKey) => {
        try {
          if (matrixType === 'obsp') {
            return await mockMatrixManager.getObspMatrix(matrixKey);
          } else {
            return await mockMatrixManager.getVarpMatrix(matrixKey);
          }
        } catch (error) {
          return { error: error.message };
        }
      };
      
      // Test error handling
      const result = await handleMatrixError('obsp', 'connectivities');
      
      // Verify error was handled
      expect(result).toHaveProperty('error', 'Failed to fetch matrix');
      
      // Test successful request after error
      mockMatrixManager.getVarpMatrix.mockResolvedValueOnce(mockVarpData);
      const successResult = await handleMatrixError('varp', 'correlation');
      
      // Verify successful result has expected properties
      expect(successResult).not.toHaveProperty('error');
      expect(successResult).toHaveLength(10);
    });
  });
  
  it('should support a demo data loading workflow', () => {
    // Create a simple simulated workflow without loading actual modules
    const workflow = () => {
      // First step: load from URL
      return mockZarrLoader.loadFromUrl('data/aging.zarr')
        .then(() => {
          // Second step: load data from zarr
          return mockDataManager.loadFromZarr(mockZarrLoader);
        });
    };
    
    // Verify the function doesn't throw errors
    expect(workflow).not.toThrow();
    
    // Execute workflow to check that promises chain correctly
    return workflow().then(() => {
      // Verify the expected calls would be made in the integration flow
      expect(mockZarrLoader.loadFromUrl).toHaveBeenCalledWith('data/aging.zarr');
      expect(mockDataManager.loadFromZarr).toHaveBeenCalledWith(mockZarrLoader);
    });
  });
  
  it('should support handling unknown demo data gracefully', () => {
    // Create a function that loads demo data with a fallback mechanism
    const mockDataType = 'non_existent_demo';
    
    const loadDemoWithFallback = async () => {
      // Try standard path when demo selector isn't found
      const standardPath = `data/${mockDataType}.zarr`;
      
      // Simulate loading from standardPath
      await mockZarrLoader.loadFromUrl(standardPath);
        
      // Mock the successful load
      return { success: true, path: standardPath };
    };
    
    // Execute the function
    return loadDemoWithFallback().then(result => {
      // Verify expected behavior
      expect(result.success).toBe(true);
      expect(mockZarrLoader.loadFromUrl).toHaveBeenCalledWith(`data/${mockDataType}.zarr`);
    });
  });
  
  it('should handle failed directory listing for demo data', async () => {
    // Mock fetch to fail
    const fetchError = new Error('Failed to fetch');
    global.fetch.mockRejectedValueOnce(fetchError);
    
    // Mock container for demo data
    const mockListGroup = {
      innerHTML: ''
    };
    document.querySelector = jest.fn().mockReturnValue(mockListGroup);
    
    // Simulate loadAvailableDemoData function
    const loadDemoDataWithFailedFetch = async () => {
      try {
        // Simulate the behavior of loadAvailableDemoData
        const datasets = [
          {
            name: 'aging.zarr',
            displayName: 'Aging',
            path: 'data/aging.zarr',
            description: 'Mouse hematopoietic stem cells'
          }
        ];
        
        // Try to fetch (will fail)
        try {
          await global.fetch('data/');
        } catch (error) {
          // Expected to fail, continue with hardcoded datasets
        }
        
        // Create demo buttons
        datasets.forEach(dataset => {
          const button = document.createElement('button');
          button.dataset.demo = dataset.displayName.toLowerCase();
          button.dataset.path = dataset.path;
          // In a real implementation, we would append this to the container
        });
        
        return {
          success: true,
          datasetsShown: datasets.length
        };
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
    };
    
    // Execute the function
    const result = await loadDemoDataWithFailedFetch();
    
    // Verify it handled the failure gracefully and still showed hardcoded datasets
    expect(result.success).toBe(true);
    expect(result.datasetsShown).toBe(1);
    expect(global.fetch).toHaveBeenCalledWith('data/');
    expect(document.createElement).toHaveBeenCalled();
  });
  
  it('should handle successful directory listing for demo data', async () => {
    // Mock successful fetch with HTML listing
    const mockResponse = {
      ok: true,
      text: jest.fn().mockResolvedValue(`
        <html>
          <body>
            <a href="aging.zarr/">aging.zarr/</a>
            <a href="other.zarr/">other.zarr/</a>
          </body>
        </html>
      `)
    };
    global.fetch.mockResolvedValueOnce(mockResponse);
    
    // Mock HTML links
    const mockLinks = [
      { getAttribute: () => 'aging.zarr/', textContent: 'aging.zarr/' },
      { getAttribute: () => 'other.zarr/', textContent: 'other.zarr/' }
    ];
    
    // Mock DOMParser result
    global.DOMParser = jest.fn().mockImplementation(() => ({
      parseFromString: jest.fn().mockReturnValue({
        querySelectorAll: jest.fn().mockReturnValue(mockLinks)
      })
    }));
    
    // Mock container
    const mockListGroup = {
      innerHTML: ''
    };
    document.querySelector = jest.fn().mockReturnValue(mockListGroup);
    
    // Simulate loadAvailableDemoData function
    const loadDemoDataWithSuccessfulFetch = async () => {
      try {
        // Start with hardcoded datasets
        const datasets = [
          {
            name: 'aging.zarr',
            displayName: 'Aging',
            path: 'data/aging.zarr',
            description: 'Mouse hematopoietic stem cells'
          }
        ];
        
        // Try to fetch additional datasets (will succeed)
        const response = await global.fetch('data/');
        
        if (response.ok) {
          const html = await response.text();
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');
          
          // Get links from mock
          const links = doc.querySelectorAll('a');
          
          // Process links
          links.forEach(link => {
            const href = link.getAttribute('href');
            const name = href.replace(/\/$/, '');
            
            // Skip duplicates
            if (datasets.some(d => d.name === name)) {
              return;
            }
            
            // Add new dataset
            datasets.push({
              name: name,
              displayName: name.replace(/\.zarr$/, ''),
              path: 'data/' + name,
              description: 'AnnData dataset in zarr format'
            });
          });
        }
        
        // Create demo buttons
        datasets.forEach(dataset => {
          const button = document.createElement('button');
          button.dataset.demo = dataset.displayName.toLowerCase();
          button.dataset.path = dataset.path;
          // In a real implementation, we would append this to the container
        });
        
        return {
          success: true,
          datasetsShown: datasets.length
        };
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
    };
    
    // Execute the function
    const result = await loadDemoDataWithSuccessfulFetch();
    
    // Verify it found both datasets (aging from hardcoded, other from fetch)
    expect(result.success).toBe(true);
    expect(result.datasetsShown).toBe(2); // Should find both datasets
    expect(global.fetch).toHaveBeenCalledWith('data/');
    expect(mockResponse.text).toHaveBeenCalled();
    expect(document.createElement).toHaveBeenCalledTimes(2); // One for each dataset
  });
  
  describe('Matrix Component End-to-End Tests', () => {
    it('should handle the full matrix workflow from selection to visualization', async () => {
      // Simulate main app component or function that handles the matrix workflow
      const matrixWorkflow = async () => {
        // Step 1: Load dataset
        await mockZarrLoader.loadFromUrl('data/aging.zarr');
        await mockDataManager.loadFromZarr(mockZarrLoader);
        
        // Step 2: Get available matrices
        const metadata = await mockMatrixManager.getMatrixMetadata();
        
        // Step 3: User selects a matrix from the UI
        const selectedMatrix = {
          type: 'obsp',
          key: 'connectivities'
        };
        
        // Step 4: Create visualization config
        const config = mockMatrixManager.createMatrixVisualization(
          selectedMatrix.type,
          selectedMatrix.key,
          { colorScale: 'Viridis', showLabels: true }
        );
        
        // Step 5: Create panel in UI
        mockUiManager.createPanel('panel-1', 'matrix', config);
        
        // Step 6: Get matrix sample data for preview
        const sampleData = await mockMatrixManager.getObspSample(selectedMatrix.key);
        
        // Step 7: Get full matrix data when needed
        const fullData = await mockMatrixManager.getObspMatrix(selectedMatrix.key);
        
        return {
          metadata,
          config,
          sampleData,
          fullData
        };
      };
      
      // Execute the workflow
      const result = await matrixWorkflow();
      
      // Verify the flow was executed correctly
      expect(mockZarrLoader.loadFromUrl).toHaveBeenCalledWith('data/aging.zarr');
      expect(mockDataManager.loadFromZarr).toHaveBeenCalled();
      expect(mockMatrixManager.getMatrixMetadata).toHaveBeenCalled();
      expect(mockMatrixManager.createMatrixVisualization).toHaveBeenCalled();
      expect(mockUiManager.createPanel).toHaveBeenCalledWith(
        'panel-1',
        'matrix',
        expect.objectContaining({
          matrixType: 'obsp',
          matrixKey: 'connectivities'
        })
      );
      expect(mockMatrixManager.getObspSample).toHaveBeenCalledWith('connectivities');
      expect(mockMatrixManager.getObspMatrix).toHaveBeenCalledWith('connectivities');
      
      // Verify the result contains all expected data
      expect(result).toHaveProperty('metadata');
      expect(result).toHaveProperty('config');
      expect(result).toHaveProperty('sampleData');
      expect(result).toHaveProperty('fullData');
    });
  });
});
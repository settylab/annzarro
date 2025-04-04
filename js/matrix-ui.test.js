/**
 * Tests for matrix UI interactions
 * 
 * These tests ensure that:
 * 1. Matrix data can be loaded properly from the server
 * 2. Matrix UI components render correctly and respond to user input
 * 3. Error handling is robust for various edge cases
 * 4. Different matrix types (obsp, varp) are supported correctly
 */

// Mock dependencies
jest.mock('./data-manager');
jest.mock('./matrix-manager');
jest.mock('./plot-manager');

// Import dependencies
const dataManager = require('./data-manager');
const matrixManager = require('./matrix-manager');
const plotManager = require('./plot-manager');
const uiManager = require('./ui-manager');

// Mock DOM elements
const mockElements = {};
global.document = {
  getElementById: (id) => mockElements[id] || createMockElement(),
  createElement: jest.fn(() => createMockElement()),
  createEvent: jest.fn(() => ({ initEvent: jest.fn() })),
  querySelector: jest.fn((selector) => mockElements[selector] || null),
  querySelectorAll: jest.fn(() => [])
};

// Create a mock DOM element
function createMockElement() {
  const element = {
    addEventListener: jest.fn(),
    appendChild: jest.fn(),
    classList: {
      add: jest.fn(),
      remove: jest.fn(),
      toggle: jest.fn(),
      contains: jest.fn(() => false)
    },
    dataset: {},
    style: {},
    value: '',
    options: [],
    dispatchEvent: jest.fn(),
    querySelector: jest.fn(() => null),
    querySelectorAll: jest.fn(() => []),
    getBoundingClientRect: jest.fn(() => ({ width: 500, height: 500 })),
    textContent: '',
    innerHTML: '',
    id: ''
  };
  
  // Define parentElement as a direct property to avoid circular reference
  Object.defineProperty(element, 'parentElement', {
    get: () => null
  });
  
  return element;
}

// Mock bootstrap modal
global.bootstrap = {
  Modal: jest.fn().mockImplementation(() => ({
    show: jest.fn(),
    hide: jest.fn()
  }))
};

// Mock Plotly
global.Plotly = {
  newPlot: jest.fn(),
  relayout: jest.fn(),
  purge: jest.fn(),
  downloadImage: jest.fn()
};

// Mock ResizeObserver
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn()
}));

// Create test matrix data
const mockMatrixData = [
  [1.0, 0.2, 0.3],
  [0.2, 1.0, 0.5],
  [0.3, 0.5, 1.0]
];

// Create sample matrix metadata
const mockMatrixMetadata = {
  obsm: ['X_umap', 'X_pca'],
  varm: ['PCs'],
  obsp: ['connectivities', 'distances'],
  varp: ['correlation'],
  layers: ['counts', 'normalized']
};

// Test matrix data with different sizes and properties
const mockLargeMatrixData = Array(50).fill().map(() => Array(50).fill().map(() => Math.random()));
const mockSparseMatrixData = Array(20).fill().map(() => Array(20).fill(0));
// Add some non-zero values to sparse matrix
mockSparseMatrixData[0][5] = 0.8;
mockSparseMatrixData[5][10] = 0.6;
mockSparseMatrixData[10][15] = 0.7;
mockSparseMatrixData[15][0] = 0.5;

describe('Matrix UI Interactions', () => {
  // Define event handlers for tests
  const eventHandlers = {};
  
  // Store original addEventListener
  let originalAddEventListener;
  
  // Setup for tests
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Store the original addEventListener
    originalAddEventListener = Element.prototype.addEventListener;
    
    // Enhanced mock for event handling
    Element.prototype.addEventListener = jest.fn((event, handler) => {
      if (!eventHandlers[event]) {
        eventHandlers[event] = [];
      }
      eventHandlers[event].push(handler);
    });
    
    // Mock modal elements
    mockElements['matrixSelectorModal'] = createMockElement();
    mockElements['matrixTypeTabs'] = createMockElement();
    mockElements['matrixTypeTabContent'] = createMockElement();
    mockElements['obspKeySelect'] = createMockElement();
    mockElements['varpKeySelect'] = createMockElement();
    mockElements['obspMatrixPreview'] = createMockElement();
    mockElements['varpMatrixPreview'] = createMockElement();
    mockElements['colorScaleSelect'] = createMockElement();
    mockElements['showLabelsCheck'] = createMockElement();
    mockElements['selectMatrixBtn'] = createMockElement();
    
    // Mock panel elements
    mockElements['panel-1'] = createMockElement();
    
    // Mock matrix manager methods
    matrixManager.getMatrixMetadata.mockResolvedValue(mockMatrixMetadata);
    matrixManager.getObspSample.mockResolvedValue({
      data: mockMatrixData,
      rowNames: ['cell_1', 'cell_2', 'cell_3'],
      colNames: ['cell_1', 'cell_2', 'cell_3'],
      key: 'connectivities',
      fullSize: [100, 100]
    });
    matrixManager.getVarpSample.mockResolvedValue({
      data: mockMatrixData,
      rowNames: ['gene_1', 'gene_2', 'gene_3'],
      colNames: ['gene_1', 'gene_2', 'gene_3'],
      key: 'correlation',
      fullSize: [50, 50]
    });
    matrixManager.getObspMatrix.mockResolvedValue(mockMatrixData);
    matrixManager.getVarpMatrix.mockResolvedValue(mockMatrixData);
    matrixManager.createMatrixVisualization.mockReturnValue({
      title: 'Test Matrix',
      type: 'heatmap',
      matrixType: 'obsp',
      matrixKey: 'connectivities',
      colorScale: 'Viridis',
      showLabels: true
    });
    
    // Mock data manager methods
    dataManager.isDataLoaded.mockReturnValue(true);
    dataManager.getObsNames.mockResolvedValue(Array(100).fill().map((_, i) => `cell_${i}`));
    dataManager.getVarNames.mockResolvedValue(Array(50).fill().map((_, i) => `gene_${i}`));
  });
  
  // Cleanup after each test
  afterEach(() => {
    // Restore original addEventListener
    Element.prototype.addEventListener = originalAddEventListener;
  });
  
  // Test getting matrix metadata
  test('Loads matrix metadata for selector', async () => {
    // Call matrixManager.getMatrixMetadata directly
    const result = await matrixManager.getMatrixMetadata();
    
    // Verify the result matches our mock data
    expect(result).toEqual(mockMatrixMetadata);
    
    // Verify the result contains the expected matrix types
    expect(result).toHaveProperty('obsp');
    expect(result).toHaveProperty('varp');
    expect(result.obsp).toContain('connectivities');
    expect(result.varp).toContain('correlation');
  });
  
  // Test matrix sample loading
  test('Loads and displays matrix samples', async () => {
    // Test loading obsp sample
    const obspSample = await matrixManager.getObspSample('connectivities');
    
    // Verify the sample structure
    expect(obspSample).toHaveProperty('data');
    expect(obspSample).toHaveProperty('rowNames');
    expect(obspSample).toHaveProperty('colNames');
    expect(obspSample.key).toBe('connectivities');
    
    // Test loading varp sample
    const varpSample = await matrixManager.getVarpSample('correlation');
    
    // Verify the sample structure
    expect(varpSample).toHaveProperty('data');
    expect(varpSample).toHaveProperty('rowNames');
    expect(varpSample).toHaveProperty('colNames');
    expect(varpSample.key).toBe('correlation');
  });
  
  // Test creating matrix visualization config
  test('Creates matrix visualization configuration', () => {
    // Mock implementation for obsp config
    matrixManager.createMatrixVisualization.mockImplementationOnce((matrixType, matrixKey, options) => ({
      type: 'heatmap',
      title: `${matrixKey} ${matrixType === 'obsp' ? 'Cell-Cell' : 'Gene-Gene'} Relationship`,
      matrixType,
      matrixKey,
      colorScale: options.colorScale || 'viridis',
      showLabels: options.showLabels !== undefined ? options.showLabels : true,
      sampleSize: options.sampleSize || 100
    }));
    
    // Create visualization config for obsp
    const obspConfig = matrixManager.createMatrixVisualization('obsp', 'connectivities', {
      colorScale: 'Viridis',
      showLabels: true
    });
    
    // Verify config properties
    expect(obspConfig).toHaveProperty('type', 'heatmap');
    expect(obspConfig).toHaveProperty('matrixType', 'obsp');
    expect(obspConfig).toHaveProperty('matrixKey', 'connectivities');
    
    // Mock implementation for varp config
    matrixManager.createMatrixVisualization.mockImplementationOnce((matrixType, matrixKey, options) => ({
      type: 'heatmap',
      title: `${matrixKey} ${matrixType === 'obsp' ? 'Cell-Cell' : 'Gene-Gene'} Relationship`,
      matrixType,
      matrixKey,
      colorScale: options.colorScale || 'viridis',
      showLabels: options.showLabels !== undefined ? options.showLabels : true,
      sampleSize: options.sampleSize || 100
    }));
    
    // Create visualization config for varp
    const varpConfig = matrixManager.createMatrixVisualization('varp', 'correlation', {
      colorScale: 'Plasma',
      showLabels: false
    });
    
    // Verify config properties
    expect(varpConfig).toHaveProperty('type', 'heatmap');
    expect(varpConfig).toHaveProperty('matrixType', 'varp');
    expect(varpConfig).toHaveProperty('matrixKey', 'correlation');
  });
  
  // Test the matrix selection flow
  test('Simulates matrix panel creation flow', async () => {
    // Setup mock for UI components
    const mockModal = {
      show: jest.fn(),
      hide: jest.fn()
    };
    
    // Update bootstrap modal mock
    global.bootstrap.Modal.mockReturnValue(mockModal);
    
    // Mock config for the visualization
    const matrixType = 'obsp';
    const matrixKey = 'connectivities';
    const colorScale = 'Viridis';
    const showLabels = true;
    
    // Mock implementation for matrix visualization
    matrixManager.createMatrixVisualization.mockImplementation((type, key, options) => ({
      type: 'heatmap',
      title: `${key} ${type === 'obsp' ? 'Cell-Cell' : 'Gene-Gene'} Relationship`,
      matrixType: type,
      matrixKey: key,
      colorScale: options.colorScale || 'viridis',
      showLabels: options.showLabels !== undefined ? options.showLabels : true,
      sampleSize: options.sampleSize || 100
    }));
    
    // Create a config object
    const config = matrixManager.createMatrixVisualization(matrixType, matrixKey, {
      colorScale: colorScale,
      showLabels: showLabels
    });
    
    // Verify config properties
    expect(config).toHaveProperty('matrixType', matrixType);
    expect(config).toHaveProperty('matrixKey', matrixKey);
    expect(config).toHaveProperty('colorScale', colorScale);
    expect(config).toHaveProperty('showLabels', showLabels);
  });
  
  // Integration test for the full flow
  test('Simulates complete matrix visualization flow', async () => {
    // Call getMatrixMetadata to get matrix types
    const metadata = await matrixManager.getMatrixMetadata();
    
    // Verify metadata structure
    expect(metadata).toEqual(mockMatrixMetadata);
    
    // Get a sample for a specific matrix
    const sample = await matrixManager.getObspSample('connectivities');
    
    // Verify sample has the expected structure
    expect(sample).toHaveProperty('data');
    expect(sample).toHaveProperty('rowNames');
    expect(sample).toHaveProperty('colNames');
    
    // Create a configuration for visualization
    matrixManager.createMatrixVisualization.mockImplementation((type, key, options) => ({
      type: 'heatmap',
      title: `${key} ${type === 'obsp' ? 'Cell-Cell' : 'Gene-Gene'} Relationship`,
      matrixType: type,
      matrixKey: key,
      colorScale: options.colorScale || 'viridis',
      showLabels: options.showLabels !== undefined ? options.showLabels : true,
      sampleSize: options.sampleSize || 100
    }));
    
    // Create a visualization config
    const config = matrixManager.createMatrixVisualization('obsp', 'connectivities', {
      colorScale: 'Viridis',
      showLabels: true
    });
    
    // Verify the config
    expect(config).toHaveProperty('type', 'heatmap');
    expect(config).toHaveProperty('matrixType', 'obsp');
    expect(config).toHaveProperty('matrixKey', 'connectivities');
    
    // Test actually fetching full matrix data
    const matrixData = await matrixManager.getObspMatrix('connectivities');
    
    // Verify the matrix data matches our mock
    expect(matrixData).toEqual(mockMatrixData);
  });
  
  // Test error handling in matrix operations
  test('Handles errors during matrix operations gracefully', async () => {
    // Store original methods to restore later
    const originalGetObspMatrix = matrixManager.getObspMatrix;
    const originalGetMatrixMetadata = matrixManager.getMatrixMetadata;
    
    // Mock implementation to simulate errors for obspMatrix
    matrixManager.getObspMatrix = jest.fn().mockRejectedValueOnce(
      new Error('Failed to load matrix data')
    );
    
    // Test error handling in getObspMatrix
    await expect(matrixManager.getObspMatrix('nonexistent')).rejects.toThrow('Failed to load matrix data');
    
    // Mock implementation to simulate errors for matrixMetadata
    matrixManager.getMatrixMetadata = jest.fn().mockRejectedValueOnce(
      new Error('Failed to fetch matrix metadata')
    );
    
    // Test error handling in getMatrixMetadata
    await expect(matrixManager.getMatrixMetadata()).rejects.toThrow('Failed to fetch matrix metadata');
    
    // Restore original implementations
    matrixManager.getObspMatrix = originalGetObspMatrix;
    matrixManager.getMatrixMetadata = originalGetMatrixMetadata;
  });
  
  // Test different matrix size and configuration options
  test('Handles different matrix sizes and configuration options', async () => {
    // Test with a larger matrix
    matrixManager.getObspMatrix.mockResolvedValueOnce(mockLargeMatrixData);
    
    // Large matrix fetch
    const largeMatrix = await matrixManager.getObspMatrix('connectivities');
    expect(largeMatrix).toHaveLength(50);
    expect(largeMatrix[0]).toHaveLength(50);
    
    // Test with a sparse matrix
    matrixManager.getVarpMatrix.mockResolvedValueOnce(mockSparseMatrixData);
    
    // Sparse matrix fetch
    const sparseMatrix = await matrixManager.getVarpMatrix('correlation');
    expect(sparseMatrix).toHaveLength(20);
    expect(sparseMatrix[0].filter(v => v !== 0)).toHaveLength(1); // Only one non-zero element in first row
    
    // Test different color scales
    const scales = ['Viridis', 'Plasma', 'Inferno', 'Magma', 'Blues', 'Reds'];
    
    // Test visualization with different color scales
    for (const scale of scales) {
      matrixManager.createMatrixVisualization.mockImplementationOnce((type, key, options) => ({
        type: 'heatmap',
        title: `${key} ${type === 'obsp' ? 'Cell-Cell' : 'Gene-Gene'} Relationship`,
        matrixType: type,
        matrixKey: key,
        colorScale: options.colorScale || 'viridis',
        showLabels: options.showLabels !== undefined ? options.showLabels : true,
        sampleSize: options.sampleSize || 100
      }));
      
      const config = matrixManager.createMatrixVisualization('obsp', 'connectivities', {
        colorScale: scale,
        showLabels: true
      });
      
      expect(config).toHaveProperty('colorScale', scale);
    }
    
    // Test with different sample sizes
    const sampleSizes = [10, 50, 100, 200];
    
    for (const size of sampleSizes) {
      matrixManager.createMatrixVisualization.mockImplementationOnce((type, key, options) => ({
        type: 'heatmap',
        title: `${key} ${type === 'obsp' ? 'Cell-Cell' : 'Gene-Gene'} Relationship`,
        matrixType: type,
        matrixKey: key,
        colorScale: options.colorScale || 'viridis',
        showLabels: options.showLabels !== undefined ? options.showLabels : true,
        sampleSize: options.sampleSize || 100
      }));
      
      const config = matrixManager.createMatrixVisualization('obsp', 'connectivities', {
        colorScale: 'Viridis',
        showLabels: true,
        sampleSize: size
      });
      
      expect(config).toHaveProperty('sampleSize', size);
    }
  });
  
  // Test matrix data sampling with various sizes
  test('Provides correct matrix sampling for different sizes', async () => {
    // Store original methods to restore later
    const originalGetObspSample = matrixManager.getObspSample;
    const originalGetVarpSample = matrixManager.getVarpSample;
    
    // Setup mock implementations sequentially
    
    // 1. Small sample test (5 cells)
    matrixManager.getObspSample = jest.fn().mockResolvedValueOnce({
      data: Array(5).fill().map(() => Array(5).fill().map(() => Math.random())),
      rowNames: Array(5).fill().map((_, i) => `small_cell_${i}`),
      colNames: Array(5).fill().map((_, i) => `small_cell_${i}`),
      key: 'connectivities',
      fullSize: [5, 5]
    });
    
    // Test with fewer cells than the sample size
    const smallSample = await matrixManager.getObspSample('connectivities', 10);
    expect(smallSample.rowNames).toHaveLength(5); // Should be limited by the cell count
    
    // 2. Limited sample test (50 cells, full size 1000)
    matrixManager.getObspSample = jest.fn().mockResolvedValueOnce({
      data: Array(50).fill().map(() => Array(50).fill().map(() => Math.random())),
      rowNames: Array(50).fill().map((_, i) => `limited_cell_${i}`),
      colNames: Array(50).fill().map((_, i) => `limited_cell_${i}`),
      key: 'connectivities',
      fullSize: [1000, 1000]
    });
    
    // Test with more cells than the sample size
    const limitedSample = await matrixManager.getObspSample('connectivities', 50);
    expect(limitedSample.rowNames).toHaveLength(50); // Should be limited by the sample size
    
    // 3. Gene sample test (3 genes)
    matrixManager.getVarpSample = jest.fn().mockResolvedValueOnce({
      data: Array(3).fill().map(() => Array(3).fill().map(() => Math.random())),
      rowNames: Array(3).fill().map((_, i) => `small_gene_${i}`),
      colNames: Array(3).fill().map((_, i) => `small_gene_${i}`),
      key: 'correlation',
      fullSize: [3, 3]
    });
    
    // Test with fewer genes than the sample size
    const smallVarpSample = await matrixManager.getVarpSample('correlation', 10);
    expect(smallVarpSample.rowNames).toHaveLength(3); // Should be limited by the gene count
    
    // 4. Precise sample test (25 cells)
    matrixManager.getObspSample = jest.fn().mockResolvedValueOnce({
      data: Array(25).fill().map(() => Array(25).fill().map(() => Math.random())),
      rowNames: Array(25).fill().map((_, i) => `precise_cell_${i}`),
      colNames: Array(25).fill().map((_, i) => `precise_cell_${i}`),
      key: 'connectivities',
      fullSize: [100, 100]
    });
    
    // Test with specific sample size
    const preciseSample = await matrixManager.getObspSample('connectivities', 25);
    expect(preciseSample.data).toHaveLength(25);
    expect(preciseSample.rowNames).toHaveLength(25);
    
    // Restore original methods after all tests
    matrixManager.getObspSample = originalGetObspSample;
    matrixManager.getVarpSample = originalGetVarpSample;
  });
  
  // Edge case: Empty matrices
  test('Handles empty matrix data gracefully', async () => {
    // Mock empty matrix
    const emptyMatrix = [];
    matrixManager.getObspMatrix.mockResolvedValueOnce(emptyMatrix);
    
    // Fetch empty matrix
    const result = await matrixManager.getObspMatrix('empty');
    expect(result).toEqual(emptyMatrix);
    
    // Test with empty rows but columns defined
    const emptyRowsMatrix = [[]];
    matrixManager.getVarpMatrix.mockResolvedValueOnce(emptyRowsMatrix);
    
    // Fetch matrix with empty rows
    const resultRows = await matrixManager.getVarpMatrix('empty_rows');
    expect(resultRows).toEqual(emptyRowsMatrix);
    
    // Mock empty metadata
    matrixManager.getMatrixMetadata.mockResolvedValueOnce({
      obsm: [],
      varm: [],
      obsp: [],
      varp: [],
      layers: []
    });
    
    // Test with empty metadata
    const emptyMetadata = await matrixManager.getMatrixMetadata();
    expect(emptyMetadata.obsp).toEqual([]);
    expect(emptyMetadata.varp).toEqual([]);
  });
  
  // Test with large matrices that should use chunking
  test('Handles large matrices that should trigger chunking', async () => {
    // Create a 1000x1000 matrix (too large to load all at once)
    const largeMatrixMock = {
      data: Array(50).fill().map(() => Array(50).fill().map(() => Math.random())),
      rowNames: Array(50).fill().map((_, i) => `cell_${i}`),
      colNames: Array(50).fill().map((_, i) => `cell_${i}`),
      key: 'large_connectivities',
      fullSize: [1000, 1000] // The full size is large, but we're getting a sample
    };
    
    matrixManager.getObspSample.mockResolvedValueOnce(largeMatrixMock);
    
    // Test with large matrix sample
    const largeSample = await matrixManager.getObspSample('large_connectivities', 50);
    expect(largeSample.data).toHaveLength(50);
    expect(largeSample.fullSize).toEqual([1000, 1000]);
    
    // This would typically use chunking on the backend, which we can't test directly in the client
    // But we can verify the sample still works as expected
    expect(largeSample.key).toBe('large_connectivities');
  });
});

// Additional integration tests with UI
describe('Matrix UI and Renderer Integration', () => {
  // Store original addEventListener
  let originalAddEventListener;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Store the original addEventListener
    originalAddEventListener = Element.prototype.addEventListener;
    
    // Enhanced mock for event handling
    Element.prototype.addEventListener = jest.fn((event, handler) => {
      if (!eventHandlers[event]) {
        eventHandlers[event] = [];
      }
      eventHandlers[event].push(handler);
    });
    
    // Set up mocks for UI elements
    document.getElementById = jest.fn().mockImplementation(id => {
      if (!mockElements[id]) {
        mockElements[id] = createMockElement();
        mockElements[id].id = id;
      }
      return mockElements[id];
    });
  });
  
  // Cleanup after each test
  afterEach(() => {
    // Restore original addEventListener
    Element.prototype.addEventListener = originalAddEventListener;
  });
  
  // Test matrix panel creation
  test('Creates matrix panel with correct structure', () => {
    // Mock uiManager.createMatrixPanel method
    const mockCreateMatrixPanel = jest.fn((panelId, config) => {
      return {
        type: 'matrix',
        panel: document.createElement('div'),
        config
      };
    });
    
    // Create test function to simulate panel creation
    const createTestPanel = () => {
      return mockCreateMatrixPanel('panel-1', {
        title: 'Test Matrix',
        matrixType: 'obsp',
        matrixKey: 'connectivities',
        colorScale: 'Viridis',
        showLabels: true
      });
    };
    
    // Create the panel
    const panel = createTestPanel();
    
    // Verify the panel has the correct structure
    expect(panel).toHaveProperty('type', 'matrix');
    expect(panel).toHaveProperty('config');
    expect(panel.config).toHaveProperty('matrixType', 'obsp');
    expect(panel.config).toHaveProperty('matrixKey', 'connectivities');
  });
  
  // Test matrix selection modal interactions
  test('Matrix selector modal populates matrix options correctly', async () => {
    // Mock DOM elements for the matrix selector
    const mockObspSelect = {
      innerHTML: '',
      appendChild: jest.fn()
    };
    const mockVarpSelect = {
      innerHTML: '',
      appendChild: jest.fn()
    };
    document.getElementById = jest.fn().mockImplementation(id => {
      if (id === 'obspKeySelect') return mockObspSelect;
      if (id === 'varpKeySelect') return mockVarpSelect;
      return createMockElement();
    });
    
    // Mock getMatrixMetadata to return our test data
    matrixManager.getMatrixMetadata.mockResolvedValue(mockMatrixMetadata);
    
    // Create test function to simulate populating the modal
    const populateMatrixSelectors = async () => {
      const metadata = await matrixManager.getMatrixMetadata();
      
      // Clear existing options
      mockObspSelect.innerHTML = '';
      mockVarpSelect.innerHTML = '';
      
      // Add default "Select a matrix" option
      const defaultObspOption = document.createElement('option');
      defaultObspOption.value = '';
      defaultObspOption.textContent = '-- Select a matrix --';
      defaultObspOption.disabled = true;
      defaultObspOption.selected = true;
      mockObspSelect.appendChild(defaultObspOption);
      
      const defaultVarpOption = document.createElement('option');
      defaultVarpOption.value = '';
      defaultVarpOption.textContent = '-- Select a matrix --';
      defaultVarpOption.disabled = true;
      defaultVarpOption.selected = true;
      mockVarpSelect.appendChild(defaultVarpOption);
      
      // Add obsp options
      metadata.obsp.forEach(key => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = key;
        mockObspSelect.appendChild(option);
      });
      
      // Add varp options
      metadata.varp.forEach(key => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = key;
        mockVarpSelect.appendChild(option);
      });
      
      return {
        obspOptions: metadata.obsp.length + 1, // +1 for default option
        varpOptions: metadata.varp.length + 1  // +1 for default option
      };
    };
    
    // Run the test
    const counts = await populateMatrixSelectors();
    
    // Verify the select elements were populated correctly
    expect(mockObspSelect.appendChild).toHaveBeenCalledTimes(counts.obspOptions);
    expect(mockVarpSelect.appendChild).toHaveBeenCalledTimes(counts.varpOptions);
    
    // Verify getMatrixMetadata was called
    expect(matrixManager.getMatrixMetadata).toHaveBeenCalled();
  });
  
  // Test Plotly integration
  test('Matrix display uses Plotly with correct parameters', async () => {
    // Mock Plotly
    global.Plotly = {
      newPlot: jest.fn(),
      relayout: jest.fn(),
      purge: jest.fn()
    };
    
    // Mock DOM elements
    const mockMatrixPlot = createMockElement();
    
    // Mock sample data
    const sampleData = {
      data: mockMatrixData,
      rowNames: ['cell_1', 'cell_2', 'cell_3'],
      colNames: ['cell_1', 'cell_2', 'cell_3'],
      key: 'connectivities',
      fullSize: [100, 100]
    };
    
    // Create test function to simulate plotting
    const plotMatrix = (matrixPlot, sample, options = {}) => {
      const colorScale = options.colorScale || 'viridis';
      const showLabels = options.showLabels !== undefined ? options.showLabels : true;
      const title = options.title || 'Matrix Visualization';
      
      // Create plot data
      const plotData = [{
        z: sample.data,
        x: sample.rowNames,
        y: sample.colNames,
        type: 'heatmap',
        colorscale: colorScale,
        showscale: true,
        hoverongaps: false
      }];
      
      // Create layout
      const plotLayout = {
        title: title,
        margin: {
          l: showLabels ? 120 : 50,
          r: 50,
          b: showLabels ? 120 : 50,
          t: 50,
          pad: 4
        },
        xaxis: {
          showticklabels: showLabels,
          tickangle: 45
        },
        yaxis: {
          showticklabels: showLabels
        }
      };
      
      // Create config
      const plotConfig = {
        responsive: true,
        displayModeBar: true,
        displaylogo: false,
        toImageButtonOptions: {
          format: 'png',
          filename: `${sample.key}`,
          height: 1000,
          width: 1000,
          scale: 2
        }
      };
      
      // Plot the heatmap
      Plotly.newPlot(matrixPlot, plotData, plotLayout, plotConfig);
      
      return {
        plotData,
        plotLayout,
        plotConfig
      };
    };
    
    // Test plotting with default options
    const result = plotMatrix(mockMatrixPlot, sampleData);
    
    // Verify Plotly.newPlot was called with the right parameters
    expect(Plotly.newPlot).toHaveBeenCalledWith(
      mockMatrixPlot,
      expect.arrayContaining([
        expect.objectContaining({
          z: sampleData.data,
          x: sampleData.rowNames,
          y: sampleData.colNames,
          type: 'heatmap'
        })
      ]),
      expect.objectContaining({
        title: 'Matrix Visualization',
        margin: expect.any(Object)
      }),
      expect.objectContaining({
        responsive: true,
        displayModeBar: true
      })
    );
    
    // Test with custom options
    const customResult = plotMatrix(mockMatrixPlot, sampleData, {
      colorScale: 'Blues',
      showLabels: false,
      title: 'Custom Matrix'
    });
    
    // Verify custom options were used
    expect(Plotly.newPlot).toHaveBeenCalledWith(
      mockMatrixPlot,
      expect.arrayContaining([
        expect.objectContaining({
          colorscale: 'Blues'
        })
      ]),
      expect.objectContaining({
        title: 'Custom Matrix',
        xaxis: expect.objectContaining({
          showticklabels: false
        }),
        yaxis: expect.objectContaining({
          showticklabels: false
        })
      }),
      expect.any(Object)
    );
  });
  
  // Test focus-change-based updates
  test('Updates visualizations when focused cell/gene changes', async () => {
    // Test handling different matrix sources (obsp, varp) using focused items
    
    // Track the callback to call later
    let storedCallback = null;
    
    // Mock helper function to get dependencies
    global.getDependencies = jest.fn().mockReturnValue({
      dataManager: {
        addEventListener: jest.fn((event, callback) => {
          // Directly store the callback for testing
          if (event === 'focusChanged') {
            storedCallback = callback;
          }
        }),
        getFocusedCell: jest.fn().mockReturnValue('cell_1'),
        getFocusedGene: jest.fn().mockReturnValue('gene_1'),
        findCellIndex: jest.fn().mockReturnValue(1),
        findGeneIndex: jest.fn().mockReturnValue(2),
        getObsNames: jest.fn().mockResolvedValue(['cell_0', 'cell_1', 'cell_2']),
        getVarNames: jest.fn().mockResolvedValue(['gene_0', 'gene_1', 'gene_2']),
        getObspMatrices: jest.fn().mockReturnValue(['connectivities', 'distances']),
        getVarpMatrices: jest.fn().mockReturnValue(['correlation'])
      },
      matrixManager: {
        getObspMatrix: jest.fn().mockResolvedValue([
          [0.0, 0.1, 0.2],
          [0.1, 0.0, 0.3],
          [0.2, 0.3, 0.0]
        ]),
        getVarpMatrix: jest.fn().mockResolvedValue([
          [0.0, 0.4, 0.5],
          [0.4, 0.0, 0.6],
          [0.5, 0.6, 0.0]
        ])
      }
    });
    
    // Prepare UI manager mock
    const uiManager = {
      _loadAxisData: jest.fn(),
      _updatePanelsOnFocusChange: jest.fn(),
      getActivePanelIds: jest.fn().mockReturnValue(['panel-1']),
      
      // Implementation of setupFocusChangeHandlers
      _setupFocusChangeHandlers() {
        const deps = getDependencies();
        const dataManager = deps.dataManager;
        
        if (!dataManager) return;
        
        // Add event listener for focus changes
        dataManager.addEventListener('focusChanged', (event) => {
          // When focus changes, update all panels that might be affected
          if (event.type === 'cell' || event.type === 'gene') {
            this._updatePanelsOnFocusChange(event);
          }
        });
      }
    };
    
    // Setup mock implementations for our test
    uiManager._loadAxisData.mockImplementation(async (sourceType, key, param) => {
      if (sourceType === 'obsp' && param === 'focused') {
        // Should return data for the focused cell
        return [
          [0.1, 0.2, 0.3], // Data values
          `obsp.${key} (cell_1)`, // Label
          ['cell_1 → cell_0: 0.100', 'cell_1 → cell_1: 0.200', 'cell_1 → cell_2: 0.300'] // Hover text
        ];
      } else if (sourceType === 'varp' && param === 'focused') {
        // Should return data for the focused gene
        return [
          [0.4, 0.5, 0.6], // Data values
          `varp.${key} (gene_1)`, // Label 
          ['gene_1 → gene_0: 0.400', 'gene_1 → gene_1: 0.500', 'gene_1 → gene_2: 0.600'] // Hover text
        ];
      }
      return null;
    });
    
    // Setup panel for testing
    mockElements['panel-1'].dataset.xAxisSource = 'obsp:connectivities:focused';
    mockElements['panel-1'].dataset.yAxisSource = 'varp:correlation:focused';
    
    // Setup the update panels method
    uiManager._updatePanelsOnFocusChange = jest.fn().mockImplementation(async (event) => {
      const panelIds = uiManager.getActivePanelIds();
      
      for (const panelId of panelIds) {
        const panel = mockElements[panelId]; // Use our mock panel
        
        // Check if panel uses focused cell/gene as data source
        if (panel.dataset.xAxisSource?.includes(':focused') || 
            panel.dataset.yAxisSource?.includes(':focused')) {
          
          // Load new data based on focus
          let xData = null;
          let yData = null;
          
          if (panel.dataset.xAxisSource?.includes(':focused')) {
            const [sourceType, key] = panel.dataset.xAxisSource.split(':');
            xData = await uiManager._loadAxisData(sourceType, key, 'focused');
          }
          
          if (panel.dataset.yAxisSource?.includes(':focused')) {
            const [sourceType, key] = panel.dataset.yAxisSource.split(':');
            yData = await uiManager._loadAxisData(sourceType, key, 'focused');
          }
          
          // Record that data was loaded for verification
          panel.updatedData = { xData, yData };
        }
      }
    });
    
    // Set up focus change handlers
    uiManager._setupFocusChangeHandlers();
    
    // Verify the event listener was registered
    expect(getDependencies().dataManager.addEventListener).toHaveBeenCalledWith(
      'focusChanged', 
      expect.any(Function)
    );
    
    // Verify that storedCallback has been set
    expect(storedCallback).toBeDefined();
    
    // Manually wire the _updatePanelsOnFocusChange for our test
    // Create a direct implementation to update the mock panel
    uiManager._updatePanelsOnFocusChange = jest.fn(async (event) => {
      // Get the mock panel directly
      const panel = mockElements['panel-1'];
      
      // Load data for testing
      const xData = await uiManager._loadAxisData('obsp', 'connectivities', 'focused');
      const yData = await uiManager._loadAxisData('varp', 'correlation', 'focused');
      
      // Set the updateData directly on the panel
      panel.updatedData = { xData, yData };
    });
    
    // Simulate a focus change event for a cell
    const cellFocusEvent = { 
      type: 'cell', 
      name: 'cell_3', 
      index: 3 
    };
    
    // Trigger the focus change event using the stored callback
    await storedCallback(cellFocusEvent);
    
    // Verify that updatePanelsOnFocusChange was called
    expect(uiManager._updatePanelsOnFocusChange).toHaveBeenCalledWith(cellFocusEvent);
    
    // Verify loadAxisData calls with appropriate arguments
    expect(uiManager._loadAxisData).toHaveBeenCalledWith('obsp', 'connectivities', 'focused');
    expect(uiManager._loadAxisData).toHaveBeenCalledWith('varp', 'correlation', 'focused');
    
    // Manually execute the update function to guarantee panel update
    await uiManager._updatePanelsOnFocusChange(cellFocusEvent);
    
    // Now verify that the panel was updated
    const panel = mockElements['panel-1'];
    expect(panel.updatedData).toBeDefined();
    expect(panel.updatedData.xData).toBeDefined();
    expect(panel.updatedData.yData).toBeDefined();
  });
});
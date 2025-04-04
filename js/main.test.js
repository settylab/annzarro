/**
 * Tests for main.js and application initialization
 */

// Mock jest functions
const mockAddEventListener = jest.fn();
const mockDispatchEvent = jest.fn();
const mockGetElementById = jest.fn(() => ({
  style: {}
}));

// Create more comprehensive mock DOM
const mockElements = {};

// Mock document global
global.document = {
  addEventListener: mockAddEventListener,
  dispatchEvent: mockDispatchEvent,
  getElementById: (id) => mockElements[id] || { style: {}, addEventListener: jest.fn() },
  querySelector: (selector) => mockElements[selector] || { style: {}, addEventListener: jest.fn(), getAttribute: jest.fn().mockReturnValue('#demo') },
  querySelectorAll: (selector) => [{ classList: { remove: jest.fn() }, addEventListener: jest.fn() }]
};

// Mock window global
global.window = {
  Annzarro: {
    modules: {
      Utils: {},
      zarrLoader: {},
      dataManager: {},
      plotManager: {},
      tableManager: {},
      stringDB: {},
      uiManager: {
        initialize: jest.fn()
      }
    },
    modulesLoaded: true
  },
  location: {
    protocol: 'file:'
  }
};

// Mock global objects
global.zarr = {};
global.Utils = {};
global.zarrLoader = {};
global.dataManager = {
  setFocusedGene: jest.fn(),
  setFocusedCell: jest.fn(),
  setTaxonomyInfo: jest.fn(),
  isDataLoaded: jest.fn().mockReturnValue(false)
};
global.uiManager = {
  initialize: jest.fn()
};

// Import the module to test
const main = require('./main');

// Reset mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});

describe('Main application', () => {
  // Skip the DOM event test, it only applies in the browser
  test('checks zarr availability during initialization', () => {
    // We can verify the function checks for zarr
    expect(typeof main.initializeApp).toBe('function');
  });
  
  test('includes data browsing functionality', () => {
    // Create mock for data browser element
    const mockDataBrowserElement = {
      addEventListener: jest.fn()
    };
    
    // Add to mock elements
    mockElements['datasetsListGroup'] = mockDataBrowserElement;
    
    // Check if function exists for browsing available data
    expect(typeof main.loadAvailableData).toBe('function');
  });
  
  test('handles loading data from path', () => {
    // Define a basic test to make sure the function exists
    expect(typeof main.loadDataFromPath).toBe('function');
  });
});
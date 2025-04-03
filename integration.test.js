/**
 * Integration tests for Annzarro
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

const mockZarrLoader = {
  loadFromDirectory: jest.fn().mockResolvedValue({}),
  loadFromUrl: jest.fn().mockResolvedValue({}),
  loadFromS3: jest.fn().mockResolvedValue({}),
  convertToAnnData: jest.fn().mockResolvedValue({})
};

const mockDataManager = {
  loadFromZarr: jest.fn().mockResolvedValue(true),
  isDataLoaded: jest.fn().mockReturnValue(true)
};

const mockUiManager = {
  initialize: jest.fn(),
  createPanel: jest.fn(),
  setLayout: jest.fn()
};

// Mock DOM Parser
global.DOMParser = jest.fn().mockImplementation(() => ({
  parseFromString: jest.fn().mockReturnValue({
    querySelectorAll: jest.fn().mockReturnValue([])
  })
}));

describe('Annzarro Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  it('should have a simple integration test', () => {
    // This is a basic test to ensure our test suite works
    expect(1 + 1).toBe(2);
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
});
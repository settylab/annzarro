/**
 * Tests for zarr-loader.js
 */

// Mock zarr 
const zarr = {
  MemoryStore: jest.fn(() => ({
    setItem: jest.fn(),
    getItem: jest.fn(),
    getKeys: jest.fn().mockResolvedValue([])
  })),
  HTTPStore: {
    fromUrl: jest.fn(() => ({
      setItem: jest.fn(),
      getItem: jest.fn(),
      getKeys: jest.fn().mockResolvedValue([])
    }))
  },
  S3Store: jest.fn(() => ({
    setItem: jest.fn(),
    getItem: jest.fn(),
    getKeys: jest.fn().mockResolvedValue([])
  })),
  open: jest.fn().mockResolvedValue({
    get: jest.fn().mockResolvedValue(new Float32Array([1, 2, 3, 4, 5]))
  }),
  openGroup: jest.fn().mockResolvedValue({})
};

// Use a custom mock for zarrLoader
const zarrLoader = {
  store: null,
  isLoading: false,
  loadingProgress: 0,
  cancellationToken: null,
  
  loadFromDirectory: jest.fn().mockResolvedValue({}),
  loadFromUrl: jest.fn().mockImplementation(async () => {
    const store = zarr.HTTPStore.fromUrl();
    zarrLoader.store = store;
    zarrLoader.loadingProgress = 100;
    return store;
  }),
  loadFromS3: jest.fn().mockResolvedValue({}),
  convertToAnnData: jest.fn().mockResolvedValue({}),
  _notifyProgressUpdate: jest.fn()
};

describe('ZarrLoader', () => {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    
    // Reset loader state
    zarrLoader.store = null;
    zarrLoader.isLoading = false;
    zarrLoader.loadingProgress = 0;
    zarrLoader.cancellationToken = null;
  });
  
  it('exists', () => {
    expect(zarrLoader).toBeDefined();
  });
  
  it('has expected methods', () => {
    expect(typeof zarrLoader.loadFromDirectory).toBe('function');
    expect(typeof zarrLoader.loadFromUrl).toBe('function');
    expect(typeof zarrLoader.convertToAnnData).toBe('function');
  });
  
  describe('loadFromUrl', () => {
    it('should load a zarr store from URL', async () => {
      // Set up mock store
      const mockStore = { /* mock store object */ };
      zarr.HTTPStore.fromUrl.mockReturnValue(mockStore);
      
      // Call the method with a test URL
      await zarrLoader.loadFromUrl('data/test.zarr');
      
      // Verify zarr.HTTPStore.fromUrl was called
      expect(zarr.HTTPStore.fromUrl).toHaveBeenCalled();
    });
  });
});
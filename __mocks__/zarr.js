/**
 * Mock for zarr.js - USED FOR TESTING ONLY
 * 
 * IMPORTANT: This mock is only used for Jest tests. The actual application
 * no longer uses the zarr.js library directly. Instead, it uses the Python zarr
 * implementation via the unified server approach.
 * 
 * This mock is kept for backward compatibility with existing tests.
 */
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

module.exports = zarr;
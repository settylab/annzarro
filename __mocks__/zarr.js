// Mock for zarr.js
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
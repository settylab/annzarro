/**
 * Tests for zarr-loader.js
 */

// Import our mocks
jest.mock('../__mocks__/zarr');
const zarr = require('../__mocks__/zarr');

// Import ZarrLoader with manual mocking approach since we're not using module system
const zarrLoader = global.zarrLoader || require('./zarr-loader');

describe('ZarrLoader', () => {
  it('exists', () => {
    expect(zarrLoader).toBeDefined();
  });
  
  it('has expected methods', () => {
    expect(typeof zarrLoader.loadFromDirectory).toBe('function');
    expect(typeof zarrLoader.loadFromUrl).toBe('function');
    expect(typeof zarrLoader.convertToAnnData).toBe('function');
  });
});
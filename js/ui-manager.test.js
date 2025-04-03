/**
 * Tests for ui-manager.js
 */

// Import UIManager using manual mocking approach
const uiManager = global.uiManager || require('./ui-manager');

describe('UIManager', () => {
  it('exists', () => {
    expect(uiManager).toBeDefined();
  });
  
  it('has expected methods', () => {
    expect(typeof uiManager.initialize).toBe('function');
    expect(typeof uiManager.setLayout).toBe('function');
    expect(typeof uiManager.createPanel).toBe('function');
  });
});
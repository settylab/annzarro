module.exports = {
  testEnvironment: 'jsdom',
  moduleFileExtensions: ['js'],
  testMatch: ['**/*.test.js'],
  setupFilesAfterEnv: ['./jest.setup.js'],
  moduleNameMapper: {
    // Mock CSS imports
    '\\.css$': '<rootDir>/__mocks__/styleMock.js'
  },
  // Provide global variables like zarr that would normally be available in the browser
  globals: {
    zarr: {},
    plotly: {},
    $: {}
  }
};
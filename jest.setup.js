// Import Testing Library utilities
import '@testing-library/jest-dom';

// Mock dependencies that would normally be loaded via CDN
global.zarr = {
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
  open: jest.fn(),
  openGroup: jest.fn()
};

// Mock jQuery
global.$ = jest.fn(() => ({
  select2: jest.fn(),
  modal: jest.fn(),
  DataTable: jest.fn(() => ({
    on: jest.fn()
  }))
}));

// Mock Plotly
global.Plotly = {
  newPlot: jest.fn(),
  react: jest.fn(),
  purge: jest.fn()
};

// Mock bootstrap
global.bootstrap = {
  Modal: jest.fn(() => ({
    show: jest.fn(),
    hide: jest.fn()
  })),
  Toast: jest.fn(() => ({
    show: jest.fn(),
  }))
};

// Create a mock for custom events
class CustomEventMock extends Event {
  constructor(eventName, options = {}) {
    super(eventName);
    this.detail = options.detail || {};
  }
}
global.CustomEvent = CustomEventMock;

// Create a mock for the FileReader
class FileReaderMock {
  constructor() {
    this.result = null;
    this.onload = null;
    this.onerror = null;
  }

  readAsArrayBuffer(file) {
    this.result = new ArrayBuffer(0);
    setTimeout(() => {
      if (this.onload) {
        this.onload({ target: { result: this.result } });
      }
    }, 0);
  }
}

global.FileReader = FileReaderMock;

// Create mock for TextDecoder and TextEncoder
global.TextDecoder = class {
  decode() {
    return '{}';
  }
};

global.TextEncoder = class {
  encode(str) {
    return new Uint8Array([]);
  }
};
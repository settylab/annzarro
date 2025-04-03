/**
 * Unit tests for the index.html page
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

describe('Index.html', () => {
  let dom;
  let window;
  let document;
  
  beforeAll(() => {
    // Read the HTML file
    const html = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf8');
    
    // Create a DOM environment
    dom = new JSDOM(html, {
      url: 'http://localhost/',
      referrer: 'http://localhost/',
      contentType: 'text/html',
      includeNodeLocations: true
    });
    
    window = dom.window;
    document = window.document;
  });
  
  test('has the correct title', () => {
    expect(document.title).toBe('Annzarro - Single-Cell Visualization');
  });
  
  test('has the main visualization container', () => {
    const vizContainer = document.getElementById('vizContainer');
    expect(vizContainer).toBeTruthy();
  });
  
  test('has data loading modal', () => {
    const loadDataModal = document.getElementById('loadDataModal');
    expect(loadDataModal).toBeTruthy();
  });
  
  test('has gene and cell focus selectors', () => {
    const geneFocus = document.getElementById('geneFocus');
    const cellFocus = document.getElementById('cellFocus');
    
    expect(geneFocus).toBeTruthy();
    expect(cellFocus).toBeTruthy();
  });
  
  test('has species selector with default', () => {
    const speciesSelect = document.getElementById('speciesSelect');
    expect(speciesSelect).toBeTruthy();
    
    // Default should be human (9606)
    const selected = speciesSelect.querySelector('option[selected]');
    expect(selected).toBeTruthy();
    expect(selected.value).toBe('9606');
  });
  
  test('has load data button in navbar', () => {
    const loadDataBtn = document.getElementById('loadDataBtn');
    expect(loadDataBtn).toBeTruthy();
    expect(loadDataBtn.getAttribute('data-bs-toggle')).toBe('modal');
    expect(loadDataBtn.getAttribute('data-bs-target')).toBe('#loadDataModal');
  });
});
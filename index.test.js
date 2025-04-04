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
    expect(document.title).toBe('Annzarro - Single Cell Visualization');
  });
  
  test('has the main container', () => {
    const mainContainer = document.getElementById('mainContainer');
    expect(mainContainer).toBeTruthy();
  });
  
  test('has data loading modal', () => {
    const loadDataModal = document.getElementById('loadDataModal');
    expect(loadDataModal).toBeTruthy();
  });
  
  test('has load data button in empty state', () => {
    const loadDataBtn = document.getElementById('loadDataBtn');
    expect(loadDataBtn).toBeTruthy();
  });
  
  test('has browse data button in empty state', () => {
    const browseDataBtn = document.getElementById('browseDataBtn');
    expect(browseDataBtn).toBeTruthy();
  });
  
  test('has settings modal', () => {
    const settingsModal = document.getElementById('settingsModal');
    expect(settingsModal).toBeTruthy();
    
    // Verify Python backend switch exists
    const useServerSwitch = document.getElementById('useServerSwitch');
    expect(useServerSwitch).toBeTruthy();
  });
  
  test('has help modal with documentation', () => {
    const helpModal = document.getElementById('helpModal');
    expect(helpModal).toBeTruthy();
    
    // Verify that the help modal has some documentation text
    const modalBody = helpModal.querySelector('.modal-body');
    expect(modalBody.textContent).toContain('Annzarro');
    expect(modalBody.textContent).toContain('Unified Server');
  });
  
  test('has panel template for visualization', () => {
    const panelTemplate = document.getElementById('panelTemplate');
    expect(panelTemplate).toBeTruthy();
    
    // Verify panel contains expected structure
    const templateContent = panelTemplate.innerHTML;
    expect(templateContent).toContain('panel-header');
    expect(templateContent).toContain('panel-body');
    expect(templateContent).toContain('panel-content');
  });
});
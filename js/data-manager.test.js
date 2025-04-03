/**
 * Tests for data-manager.js
 */

// Import DataManager with manual mocking approach since we're not using module system
const dataManager = global.dataManager || require('./data-manager');

describe('DataManager', () => {
  beforeEach(() => {
    // Reset the document event dispatcher
    document.dispatchEvent = jest.fn();
    
    // Reset data manager state
    if (dataManager.reset) {
      dataManager.reset();
    } else {
      // Manually reset key properties if reset method doesn't exist
      dataManager.anndata = null;
      dataManager.focusedCell = null;
      dataManager.focusedGene = null;
      dataManager.taxonomyId = 9606;
      dataManager.species = 'Homo sapiens';
    }
  });

  describe('isDataLoaded', () => {
    it('returns false when no data is loaded', () => {
      dataManager.anndata = null;
      expect(dataManager.isDataLoaded()).toBe(false);
    });
    
    it('returns true when data is loaded', () => {
      dataManager.anndata = { X: {} };
      expect(dataManager.isDataLoaded()).toBe(true);
    });
  });

  describe('focused items', () => {
    it('sets and gets focused cell', () => {
      // Override the method to spy on the event trigger
      const origMethod = dataManager._triggerEvent;
      dataManager._triggerEvent = jest.fn();
      
      try {
        dataManager.setFocusedCell('cell1');
        expect(dataManager.getFocusedCell()).toBe('cell1');
        
        // Check that event was triggered
        expect(dataManager._triggerEvent).toHaveBeenCalledWith(
          'focusChanged', 
          { type: 'cell', value: 'cell1' }
        );
      } finally {
        // Restore the original method
        dataManager._triggerEvent = origMethod;
      }
    });
    
    it('sets and gets focused gene', () => {
      // Override the method to spy on the event trigger
      const origMethod = dataManager._triggerEvent;
      dataManager._triggerEvent = jest.fn();
      
      try {
        dataManager.setFocusedGene('BRCA1');
        expect(dataManager.getFocusedGene()).toBe('BRCA1');
        
        // Check that event was triggered
        expect(dataManager._triggerEvent).toHaveBeenCalledWith(
          'focusChanged', 
          { type: 'gene', value: 'BRCA1' }
        );
      } finally {
        // Restore the original method
        dataManager._triggerEvent = origMethod;
      }
    });
    
    it('sets and gets taxonomy info', () => {
      dataManager.setTaxonomyInfo(10090, 'Mus musculus');
      expect(dataManager.getTaxonomyInfo()).toEqual({
        taxonomyId: 10090,
        species: 'Mus musculus'
      });
    });
  });

  describe('loadFromZarr', () => {
    it('has a loadFromZarr method', () => {
      expect(typeof dataManager.loadFromZarr).toBe('function');
    });
  });
});
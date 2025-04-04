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
      dataManager.datasets = new Map();
      dataManager.activeDatasetId = null;
    }
  });

  describe('isDataLoaded', () => {
    it('returns false when no data is loaded', () => {
      dataManager.anndata = null;
      dataManager.activeDatasetId = null;
      expect(dataManager.isDataLoaded()).toBe(false);
    });
    
    it('returns true when data is loaded', () => {
      // Create a test dataset and set as active
      const testDatasetId = 'test_dataset_1';
      dataManager.datasets.set(testDatasetId, {
        anndata: { X: {} },
        selectedCells: new Set(),
        selectedGenes: new Set(),
        focusedCell: null,
        focusedGene: null
      });
      dataManager.activeDatasetId = testDatasetId;
      dataManager.anndata = { X: {} };
      
      expect(dataManager.isDataLoaded()).toBe(true);
    });
    
    it('returns false for unknown dataset ID', () => {
      expect(dataManager.isDataLoaded('unknown_dataset')).toBe(false);
    });
    
    it('returns true for a specific dataset ID', () => {
      const testDatasetId = 'test_dataset_2';
      dataManager.datasets.set(testDatasetId, {
        anndata: { X: {} },
        selectedCells: new Set(),
        selectedGenes: new Set(),
        focusedCell: null,
        focusedGene: null
      });
      
      expect(dataManager.isDataLoaded(testDatasetId)).toBe(true);
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
        // Updated test to work with extended event data
        const triggerCall = dataManager._triggerEvent.mock.calls[0];
        expect(triggerCall[0]).toBe('focusChanged');
        expect(triggerCall[1].type).toBe('cell');
        expect(triggerCall[1].value).toBe('cell1');
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
        // Updated test to work with extended event data
        const triggerCall = dataManager._triggerEvent.mock.calls[0];
        expect(triggerCall[0]).toBe('focusChanged');
        expect(triggerCall[1].type).toBe('gene');
        expect(triggerCall[1].value).toBe('BRCA1');
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
  
  describe('cache management', () => {
    it('adds items to cache with dataset prefix', () => {
      const datasetId = 'test_dataset';
      const key = 'test_key';
      const value = { data: [1, 2, 3] };
      
      // Add to cache with dataset ID
      dataManager._addToCache(key, value, datasetId);
      
      // Check cache content
      expect(dataManager.cache.has(`${datasetId}:${key}`)).toBe(true);
      expect(dataManager.cache.get(`${datasetId}:${key}`)).toBe(value);
    });
    
    it('retrieves items from cache with dataset prefix', () => {
      const datasetId = 'test_dataset';
      const key = 'test_key';
      const value = { data: [1, 2, 3] };
      
      // Add to cache with dataset ID
      dataManager.cache.set(`${datasetId}:${key}`, value);
      
      // Get from cache
      const result = dataManager._getFromCache(key, datasetId);
      expect(result).toBe(value);
    });
    
    it('checks if cache has item with dataset prefix', () => {
      const datasetId = 'test_dataset';
      const key = 'test_key';
      const value = { data: [1, 2, 3] };
      
      // Add to cache with dataset ID
      dataManager.cache.set(`${datasetId}:${key}`, value);
      
      // Check if cache has item
      expect(dataManager._hasInCache(key, datasetId)).toBe(true);
      expect(dataManager._hasInCache('nonexistent_key', datasetId)).toBe(false);
    });
    
    it('evicts oldest entries when cache is full', () => {
      // Set a small cache size for testing
      const originalSize = dataManager.cacheMaxSize;
      dataManager.cacheMaxSize = 3;
      
      try {
        const datasetId = 'test_dataset';
        
        // Add items to fill the cache
        dataManager._addToCache('key1', 'value1', datasetId);
        dataManager._addToCache('key2', 'value2', datasetId);
        dataManager._addToCache('key3', 'value3', datasetId);
        
        // Check all items are in cache
        expect(dataManager._hasInCache('key1', datasetId)).toBe(true);
        expect(dataManager._hasInCache('key2', datasetId)).toBe(true);
        expect(dataManager._hasInCache('key3', datasetId)).toBe(true);
        
        // Add one more item to trigger eviction
        dataManager._addToCache('key4', 'value4', datasetId);
        
        // Check the oldest item was evicted
        expect(dataManager._hasInCache('key1', datasetId)).toBe(false);
        expect(dataManager._hasInCache('key2', datasetId)).toBe(true);
        expect(dataManager._hasInCache('key3', datasetId)).toBe(true);
        expect(dataManager._hasInCache('key4', datasetId)).toBe(true);
      } finally {
        // Restore original cache size
        dataManager.cacheMaxSize = originalSize;
      }
    });
  });
  
  describe('dataset management', () => {
    const mockAnndata = { 
      X: {},
      shape: [100, 200],
      obs: { columns: ['cell_type'] },
      var: { columns: ['gene_name'] }
    };
    
    it('sets AnnData with dataset ID', () => {
      // Override the method to spy on the event trigger
      const origMethod = dataManager._triggerEvent;
      dataManager._triggerEvent = jest.fn();
      
      try {
        const datasetId = 'test_dataset_id';
        const result = dataManager.setAnndata(mockAnndata, datasetId);
        
        // Check result
        expect(result).toBe(datasetId);
        
        // Check dataset was added to registry
        expect(dataManager.datasets.has(datasetId)).toBe(true);
        
        // Check it was set as active
        expect(dataManager.activeDatasetId).toBe(datasetId);
        
        // Check event was triggered
        expect(dataManager._triggerEvent).toHaveBeenCalledWith(
          'datasetAdded',
          expect.objectContaining({
            datasetId
          })
        );
      } finally {
        // Restore original method
        dataManager._triggerEvent = origMethod;
      }
    });
    
    it('generates dataset ID if not provided', () => {
      const origMethod = dataManager._triggerEvent;
      dataManager._triggerEvent = jest.fn();
      
      try {
        const result = dataManager.setAnndata(mockAnndata);
        
        // Result should be a string (generated ID)
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
        
        // Check dataset was added and set as active
        expect(dataManager.datasets.has(result)).toBe(true);
        expect(dataManager.activeDatasetId).toBe(result);
      } finally {
        dataManager._triggerEvent = origMethod;
      }
    });
    
    it('switches between datasets', () => {
      // Create two datasets
      const dataset1 = 'dataset_1';
      const dataset2 = 'dataset_2';
      
      const origMethod = dataManager._triggerEvent;
      dataManager._triggerEvent = jest.fn();
      
      try {
        // Add first dataset and set values
        dataManager.setAnndata(mockAnndata, dataset1);
        dataManager.setFocusedCell('cell1');
        dataManager.setFocusedGene('gene1');
        
        // Add second dataset and set different values
        dataManager.setAnndata(mockAnndata, dataset2);
        dataManager.setFocusedCell('cell2');
        dataManager.setFocusedGene('gene2');
        
        // Check current state is dataset2's state
        expect(dataManager.getFocusedCell()).toBe('cell2');
        expect(dataManager.getFocusedGene()).toBe('gene2');
        
        // Switch back to dataset1
        dataManager.setActiveDataset(dataset1);
        
        // Check state is restored to dataset1's state
        expect(dataManager.getFocusedCell()).toBe('cell1');
        expect(dataManager.getFocusedGene()).toBe('gene1');
        
        // Check datasetChanged event was triggered
        expect(dataManager._triggerEvent).toHaveBeenCalledWith(
          'datasetChanged',
          expect.objectContaining({
            previousDatasetId: dataset2,
            newDatasetId: dataset1
          })
        );
      } finally {
        dataManager._triggerEvent = origMethod;
      }
    });
    
    it('removes datasets', () => {
      // Create two datasets
      const dataset1 = 'dataset_1';
      const dataset2 = 'dataset_2';
      
      const origMethod = dataManager._triggerEvent;
      dataManager._triggerEvent = jest.fn();
      
      try {
        // Add datasets
        dataManager.setAnndata(mockAnndata, dataset1);
        dataManager.setAnndata(mockAnndata, dataset2);
        
        // Set dataset1 as active
        dataManager.setActiveDataset(dataset1);
        
        // Remove dataset2 (non-active)
        const result1 = dataManager.removeDataset(dataset2);
        expect(result1).toBe(true);
        expect(dataManager.datasets.has(dataset2)).toBe(false);
        
        // Active dataset should still be dataset1
        expect(dataManager.activeDatasetId).toBe(dataset1);
        
        // Remove dataset1 (active)
        const result2 = dataManager.removeDataset(dataset1);
        expect(result2).toBe(true);
        expect(dataManager.datasets.has(dataset1)).toBe(false);
        
        // No active dataset now
        expect(dataManager.activeDatasetId).toBe(null);
        
        // Check event was triggered
        expect(dataManager._triggerEvent).toHaveBeenCalledWith(
          'datasetRemoved',
          expect.anything()
        );
      } finally {
        dataManager._triggerEvent = origMethod;
      }
    });
    
    it('gets dataset info', () => {
      const datasetId = 'test_info_dataset';
      const metadata = {
        name: 'Test Dataset',
        description: 'Dataset for testing',
        path: '/test/path',
        taxonomyId: 10090,
        species: 'Mus musculus'
      };
      
      // Add a dataset with metadata
      dataManager.setAnndata(mockAnndata, datasetId, metadata);
      
      // Get dataset info
      const info = dataManager.getDatasetInfo(datasetId);
      
      // Check basic info
      expect(info.id).toBe(datasetId);
      expect(info.name).toBe(metadata.name);
      expect(info.description).toBe(metadata.description);
      expect(info.path).toBe(metadata.path);
      expect(info.taxonomyId).toBe(metadata.taxonomyId);
      expect(info.species).toBe(metadata.species);
      
      // Check data info
      expect(info.data).toBeTruthy();
      expect(info.data.nObs).toBe(100);
      expect(info.data.nVars).toBe(200);
    });
    
    it('gets list of loaded datasets', () => {
      // Create three datasets
      dataManager.setAnndata(mockAnndata, 'dataset_a');
      dataManager.setAnndata(mockAnndata, 'dataset_b');
      dataManager.setAnndata(mockAnndata, 'dataset_c');
      
      // Get loaded datasets
      const datasets = dataManager.getLoadedDatasets();
      
      // Check result
      expect(datasets.length).toBe(3);
      expect(datasets.map(d => d.id).sort()).toEqual(['dataset_a', 'dataset_b', 'dataset_c']);
    });
  });
});
"""
Tests for the ZarrReader URL encoding functionality.

These tests specifically verify that the cache system can handle dataset paths
containing special characters like colons, which are used as delimiters in cache keys.
"""

import os
import tempfile
import unittest
import numpy as np
import zarr
from unittest.mock import patch, MagicMock

from annzarro.core.zarr_reader import ZarrReader
from annzarro.core.caching import cached_method

class TestZarrReaderURLPaths(unittest.TestCase):
    """Test cases for ZarrReader URL Path handling."""
    
    def setUp(self):
        """Set up the test environment."""
        self.reader = ZarrReader(enable_caching=True)
        
        # Create a temporary directory for test files
        self.temp_dir = tempfile.TemporaryDirectory()
        
        # Create paths with special characters
        self.normal_path = os.path.join(self.temp_dir.name, 'normal.zarr')
        self.path_with_colon = os.path.join(self.temp_dir.name, 'path:with:colon.zarr')
        
        # Create test zarr stores
        self.create_test_zarr(self.normal_path)
        self.create_test_zarr(self.path_with_colon)
    
    def tearDown(self):
        """Clean up the test environment."""
        self.temp_dir.cleanup()
    
    def create_test_zarr(self, path):
        """Create a simple test zarr store."""
        # Create a new zarr store
        root = zarr.open_group(path, mode='w')
        
        # Create X matrix
        X = np.random.rand(100, 50).astype('float32')
        root.create_dataset('X', data=X)
        
        # Create obs
        obs_group = root.create_group('obs')
        cell_ids = np.array([f'cell_{i}' for i in range(100)])
        obs_group.create_dataset('_index', data=cell_ids)
        
        # Create var
        var_group = root.create_group('var')
        gene_ids = np.array([f'gene_{i}' for i in range(50)])
        var_group.create_dataset('_index', data=gene_ids)
    
    def test_load_zarr_with_colon_in_path(self):
        """Test loading a zarr store with a colon in the path."""
        # Test loading with a normal path first
        normal_id = self.reader.load_zarr(self.normal_path)
        self.assertIsNotNone(normal_id)
        
        # Test loading with a path containing colons
        colon_id = self.reader.load_zarr(self.path_with_colon)
        self.assertIsNotNone(colon_id)
        
        # Verify both datasets are loaded
        self.assertIn(normal_id, self.reader.dataset_stores)
        self.assertIn(colon_id, self.reader.dataset_stores)
    
    def test_metadata_caching_with_colon_in_path(self):
        """Test that metadata is properly cached for paths with colons."""
        # Load the dataset with colon in path
        colon_id = self.reader.load_zarr(self.path_with_colon)
        
        # Get metadata the first time (should cache)
        metadata1 = self.reader.get_metadata(colon_id)
        
        # Mock the _extract_metadata method to track calls
        original_extract = self.reader._extract_metadata
        mock_extract = MagicMock(side_effect=original_extract)
        self.reader._extract_metadata = mock_extract
        
        try:
            # Get metadata again (should use cache)
            metadata2 = self.reader.get_metadata(colon_id)
            
            # Verify it was cached and not extracted again
            mock_extract.assert_not_called()
            
            # Verify we got the same metadata
            self.assertEqual(metadata1, metadata2)
        finally:
            # Restore original method
            self.reader._extract_metadata = original_extract
    
    def test_data_caching_with_colon_in_path(self):
        """Test that data matrices are properly cached for paths with colons."""
        # Load the dataset with colon in path
        colon_id = self.reader.load_zarr(self.path_with_colon)
        
        # Get data the first time
        data1 = self.reader.get_X(colon_id)
        
        # Mock the _get_dense_array method to track calls
        original_get_dense = self.reader._get_dense_array
        mock_get_dense = MagicMock(side_effect=original_get_dense)
        self.reader._get_dense_array = mock_get_dense
        
        try:
            # Get data again (should use cache)
            data2 = self.reader.get_X(colon_id)
            
            # Verify it was cached and low-level array fetching not called again
            mock_get_dense.assert_not_called()
            
            # Verify we got the same data array
            np.testing.assert_array_equal(data1, data2)
        finally:
            # Restore original method
            self.reader._get_dense_array = original_get_dense
    
    def test_remove_from_cache_with_colon_in_path(self):
        """Test removing data from cache when the path contains colons."""
        # Load and use both datasets
        normal_id = self.reader.load_zarr(self.normal_path)
        colon_id = self.reader.load_zarr(self.path_with_colon)
        
        _ = self.reader.get_X(normal_id)
        _ = self.reader.get_X(colon_id)
        
        # Check that both datasets are cached
        cache_info = self.reader.get_cache_info()
        self.assertIn(normal_id, cache_info["datasets"])
        self.assertIn(colon_id, cache_info["datasets"])
        
        # Remove only the dataset with colon in path
        self.reader.clear_cache(dataset_id=colon_id)
        
        # Verify that only the specified dataset is removed
        cache_info = self.reader.get_cache_info()
        self.assertIn(normal_id, cache_info["datasets"])
        self.assertNotIn(colon_id, cache_info["datasets"])
    
    def test_open_dataset_by_path_with_colon_in_path(self):
        """Test opening a dataset with a colon in the path using stateless mode."""
        # Open dataset directly (stateless mode)
        root, metadata = self.reader.open_dataset_by_path(self.path_with_colon)
        
        # Verify it opened correctly
        self.assertIsNotNone(root)
        self.assertIsNotNone(metadata)
        self.assertEqual(metadata['shape'], (100, 50))
        
        # Check that metadata is cached properly
        cache_key = next((k for k in self.reader._metadata_cache.keys() if self.path_with_colon in k), None)
        
        # Verify we found a cache key for this path
        self.assertIsNotNone(cache_key)
        
        # Verify the cache key doesn't have raw colons (would break key parsing)
        self.assertNotIn(f"path:{self.path_with_colon}:", cache_key)
    
    def test_multiple_colon_accesses(self):
        """Test accessing multiple datasets with colons in their paths."""
        # Create multiple paths with colons in different places
        path1 = os.path.join(self.temp_dir.name, 'prefix:middle.zarr')
        path2 = os.path.join(self.temp_dir.name, 'prefix:mid:dle.zarr')
        path3 = os.path.join(self.temp_dir.name, 'prefix:middle:suffix.zarr')
        
        self.create_test_zarr(path1)
        self.create_test_zarr(path2)  
        self.create_test_zarr(path3)
        
        # Load all the datasets
        id1 = self.reader.load_zarr(path1)
        id2 = self.reader.load_zarr(path2)
        id3 = self.reader.load_zarr(path3)
        
        # Access data from each dataset
        data1 = self.reader.get_X(id1)
        data2 = self.reader.get_X(id2)
        data3 = self.reader.get_X(id3)
        
        # Verify data shapes
        self.assertEqual(data1.shape, (100, 50))
        self.assertEqual(data2.shape, (100, 50))
        self.assertEqual(data3.shape, (100, 50))
        
        # Check that all datasets are cached
        cache_info = self.reader.get_cache_info()
        self.assertIn(id1, cache_info["datasets"])
        self.assertIn(id2, cache_info["datasets"])
        self.assertIn(id3, cache_info["datasets"])

    @patch('urllib.parse.quote')
    @patch('urllib.parse.unquote')
    def test_url_encoding_functions_are_called(self, mock_unquote, mock_quote):
        """Test that urllib.parse functions are called for paths with special characters."""
        # Set up mocks to return the input
        mock_quote.side_effect = lambda s, safe='': s
        mock_unquote.side_effect = lambda s: s
        
        # Access data with a path containing a colon
        colon_id = self.reader.load_zarr(self.path_with_colon)
        _ = self.reader.get_X(colon_id)
        
        # Verify quote was called on the path
        mock_quote.assert_called()
        
        # Create a cache key that would contain the path
        self.reader._add_to_cache(f"path:{self.path_with_colon}:test", np.array([1, 2, 3]), cache_type='matrix')
        
        # Verify unquote was called to extract the path
        mock_unquote.assert_called()

if __name__ == '__main__':
    unittest.main()
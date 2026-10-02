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

from annzarro.tests import zarr_compat
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
        root = zarr_compat.open_group(path)
        
        # Create X matrix
        X = np.random.rand(100, 50).astype('float32')
        zarr_compat.write_array(root, 'X', data=X)
        
        # Create obs
        obs_group = root.create_group('obs')
        cell_ids = np.array([f'cell_{i}' for i in range(100)])
        zarr_compat.write_array(obs_group, '_index', data=cell_ids)
        
        # Create var
        var_group = root.create_group('var')
        gene_ids = np.array([f'gene_{i}' for i in range(50)])
        zarr_compat.write_array(var_group, '_index', data=gene_ids)
    
    # The reader is stateless: datasets are addressed by path, and the cache
    # key embeds the URL-encoded path ("path:<quoted>:..."). These tests used
    # the removed load_zarr()/dataset-id API; they now drive the same property
    # through the path API.

    def test_open_dataset_by_path_with_colon_in_path(self):
        root, metadata = self.reader.open_dataset_by_path(self.path_with_colon)
        self.assertIsNotNone(root)
        self.assertEqual(tuple(metadata['shape']), (100, 50))

    # get_X is not cached (cached_method builds no key for it); the cached
    # path is open_dataset_by_path, called with dataset_path= as a keyword
    # (cached_method reads the path from kwargs only).

    def _open(self, path):
        return self.reader.open_dataset_by_path(dataset_path=path)

    def test_caching_with_colon_in_path(self):
        first = self._open(self.path_with_colon)
        self.assertIn(self.path_with_colon, self.reader.get_cache_info()["datasets"])
        self.assertIs(self._open(self.path_with_colon), first)

    def test_clear_cache_with_colon_in_path(self):
        self._open(self.normal_path)
        self._open(self.path_with_colon)
        datasets = self.reader.get_cache_info()["datasets"]
        self.assertIn(self.normal_path, datasets)
        self.assertIn(self.path_with_colon, datasets)

        self.reader.clear_cache(dataset_path=self.path_with_colon)

        datasets = self.reader.get_cache_info()["datasets"]
        self.assertIn(self.normal_path, datasets)
        self.assertNotIn(self.path_with_colon, datasets)

    def test_multiple_colon_accesses(self):
        paths = [os.path.join(self.temp_dir.name, name) for name in
                 ('prefix:middle.zarr', 'prefix:mid:dle.zarr', 'prefix:middle:suffix.zarr')]
        for path in paths:
            self.create_test_zarr(path)
        for path in paths:
            self.assertEqual(self.reader.get_X(dataset_path=path).shape, (100, 50))
            self._open(path)
        datasets = self.reader.get_cache_info()["datasets"]
        for path in paths:
            self.assertIn(path, datasets)

    def test_cache_key_path_is_decoded(self):
        """A "path:<quoted>:..." key files under the original, colon-bearing path."""
        import urllib.parse
        key = f"path:{urllib.parse.quote(self.path_with_colon, safe='')}:test"
        self.reader._add_to_cache(key, np.array([1, 2, 3]), cache_type='matrix')
        self.assertIn(self.path_with_colon, self.reader.get_cache_info()["datasets"])

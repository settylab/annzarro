"""
Tests for the ZarrReader class.
"""
import os
import tempfile
import unittest
import numpy as np
import zarr
from unittest.mock import patch, MagicMock

from annzarro.core.zarr_reader import ZarrReader

class TestZarrReader(unittest.TestCase):
    """Test cases for ZarrReader."""

    def setUp(self):
        """Set up the test environment."""
        self.reader = ZarrReader()
        
        # Create a temporary directory for test files
        self.temp_dir = tempfile.TemporaryDirectory()
        self.zarr_path = os.path.join(self.temp_dir.name, 'test.zarr')
        
        # Create a simple zarr store
        self.create_test_zarr()

    def tearDown(self):
        """Clean up the test environment."""
        self.temp_dir.cleanup()

    def create_test_zarr(self):
        """Create a test zarr archive."""
        # Create a new zarr store
        root = zarr.open_group(self.zarr_path, mode='w')
        
        # Create X matrix
        X = np.random.rand(100, 50).astype('float32')
        root.create_dataset('X', data=X)
        
        # Create obs
        obs_group = root.create_group('obs')
        cell_ids = np.array([f'cell_{i}' for i in range(100)])
        obs_group.create_dataset('_index', data=cell_ids)
        cell_types = np.array(['type_A'] * 50 + ['type_B'] * 50)
        obs_group.create_dataset('cell_type', data=cell_types)
        
        # Create var
        var_group = root.create_group('var')
        gene_ids = np.array([f'gene_{i}' for i in range(50)])
        var_group.create_dataset('_index', data=gene_ids)
        gene_names = np.array([f'GENE_{i}' for i in range(50)])
        var_group.create_dataset('gene_name', data=gene_names)
        
        # Create obsm
        obsm_group = root.create_group('obsm')
        umap = np.random.rand(100, 2).astype('float32')
        obsm_group.create_dataset('X_umap', data=umap)
        
        # Create layers
        layers_group = root.create_group('layers')
        raw = np.random.rand(100, 50).astype('float32')
        layers_group.create_dataset('raw', data=raw)

    def test_open_zarr(self):
        """Test opening zarr from local path."""
        # Test opening a valid zarr file
        result = self.reader.open_zarr(self.zarr_path)
        self.assertTrue(result)
        self.assertTrue(self.reader.loaded)
        
        # Test opening an invalid path
        reader2 = ZarrReader()
        result = reader2.open_zarr('/invalid/path')
        self.assertFalse(result)
        self.assertFalse(reader2.loaded)

    def test_get_metadata(self):
        """Test getting metadata."""
        self.reader.open_zarr(self.zarr_path)
        metadata = self.reader.get_metadata()
        
        # Check that metadata contains expected fields
        self.assertEqual(metadata['shape'], (100, 50))
        self.assertTrue(metadata['has_obs'])
        self.assertTrue(metadata['has_var'])
        self.assertTrue(metadata['has_obsm'])
        self.assertTrue(metadata['has_layers'])
        
        # Check that embeddings and layers are detected
        self.assertIn('X_umap', metadata['embeddings'])
        self.assertIn('raw', metadata['layers'])
        
        # Check that obs and var columns are detected
        self.assertIn('cell_type', metadata['obs_columns'])
        self.assertIn('gene_name', metadata['var_columns'])

    def test_get_obs_names(self):
        """Test getting observation names."""
        self.reader.open_zarr(self.zarr_path)
        obs_names = self.reader.get_obs_names()
        
        # Check that we get 100 cell names
        self.assertEqual(len(obs_names), 100)
        self.assertEqual(obs_names[0], 'cell_0')
        self.assertEqual(obs_names[99], 'cell_99')

    def test_get_var_names(self):
        """Test getting variable names."""
        self.reader.open_zarr(self.zarr_path)
        var_names = self.reader.get_var_names()
        
        # Check that we get 50 gene names
        self.assertEqual(len(var_names), 50)
        self.assertEqual(var_names[0], 'gene_0')
        self.assertEqual(var_names[49], 'gene_49')

    def test_get_X(self):
        """Test getting X matrix."""
        self.reader.open_zarr(self.zarr_path)
        
        # Test getting the entire matrix
        X = self.reader.get_X()
        self.assertEqual(X.shape, (100, 50))
        
        # Test getting a subset of rows
        row_indices = [0, 1, 2]
        X_rows = self.reader.get_X(row_indices=row_indices)
        self.assertEqual(X_rows.shape, (3, 50))
        np.testing.assert_array_equal(X_rows, X[row_indices, :])
        
        # Test getting a subset of columns
        col_indices = [0, 1, 2]
        X_cols = self.reader.get_X(col_indices=col_indices)
        self.assertEqual(X_cols.shape, (100, 3))
        np.testing.assert_array_equal(X_cols, X[:, col_indices])
        
        # Test getting a subset of both rows and columns
        X_subset = self.reader.get_X(row_indices=row_indices, col_indices=col_indices)
        self.assertEqual(X_subset.shape, (3, 3))
        np.testing.assert_array_equal(X_subset, X[row_indices, :][:, col_indices])

    def test_get_layer(self):
        """Test getting layer data."""
        self.reader.open_zarr(self.zarr_path)
        
        # Test getting the entire layer
        raw = self.reader.get_layer('raw')
        self.assertEqual(raw.shape, (100, 50))
        
        # Test getting a subset of rows
        row_indices = [0, 1, 2]
        raw_rows = self.reader.get_layer('raw', row_indices=row_indices)
        self.assertEqual(raw_rows.shape, (3, 50))
        
        # Test getting a subset of columns
        col_indices = [0, 1, 2]
        raw_cols = self.reader.get_layer('raw', col_indices=col_indices)
        self.assertEqual(raw_cols.shape, (100, 3))
        
        # Test getting a subset of both rows and columns
        raw_subset = self.reader.get_layer('raw', row_indices=row_indices, col_indices=col_indices)
        self.assertEqual(raw_subset.shape, (3, 3))
        
        # Test getting a non-existent layer
        nonexistent = self.reader.get_layer('nonexistent')
        self.assertEqual(len(nonexistent), 0)

    def test_get_obs(self):
        """Test getting observation annotations."""
        self.reader.open_zarr(self.zarr_path)
        
        # Test getting all columns
        obs = self.reader.get_obs()
        self.assertIn('_index', obs)
        self.assertIn('cell_type', obs)
        self.assertEqual(len(obs['_index']), 100)
        
        # Test getting a specific column
        cell_types = self.reader.get_obs('cell_type')
        self.assertEqual(len(cell_types), 100)
        self.assertEqual(cell_types[0], 'type_A')
        self.assertEqual(cell_types[50], 'type_B')
        
        # Test getting a subset of rows
        indices = [0, 1, 2]
        cell_types_subset = self.reader.get_obs('cell_type', indices=indices)
        self.assertEqual(len(cell_types_subset), 3)
        
        # Test getting a non-existent column
        nonexistent = self.reader.get_obs('nonexistent')
        self.assertEqual(len(nonexistent), 0)

    def test_get_var(self):
        """Test getting variable annotations."""
        self.reader.open_zarr(self.zarr_path)
        
        # Test getting all columns
        var = self.reader.get_var()
        self.assertIn('_index', var)
        self.assertIn('gene_name', var)
        self.assertEqual(len(var['_index']), 50)
        
        # Test getting a specific column
        gene_names = self.reader.get_var('gene_name')
        self.assertEqual(len(gene_names), 50)
        self.assertEqual(gene_names[0], 'GENE_0')
        
        # Test getting a subset of rows
        indices = [0, 1, 2]
        gene_names_subset = self.reader.get_var('gene_name', indices=indices)
        self.assertEqual(len(gene_names_subset), 3)
        
        # Test getting a non-existent column
        nonexistent = self.reader.get_var('nonexistent')
        self.assertEqual(len(nonexistent), 0)

    def test_get_obsm(self):
        """Test getting obsm data."""
        self.reader.open_zarr(self.zarr_path)
        
        # Test getting a valid obsm key
        umap = self.reader.get_obsm('X_umap')
        self.assertEqual(umap.shape, (100, 2))
        
        # Test getting a subset of rows
        indices = [0, 1, 2]
        umap_subset = self.reader.get_obsm('X_umap', indices=indices)
        self.assertEqual(umap_subset.shape, (3, 2))
        
        # Test getting a non-existent key
        nonexistent = self.reader.get_obsm('nonexistent')
        self.assertEqual(len(nonexistent), 0)

    @patch('zarr.open_group')
    def test_with_url_store(self, mock_open_group):
        """Test the URL store functionality."""
        # Set up mock
        mock_group = MagicMock()
        mock_group.__getitem__.side_effect = lambda key: {
            'X': MagicMock(shape=(100, 50)),
            'obs': MagicMock(keys=lambda: ['_index', 'cell_type']),
            'var': MagicMock(keys=lambda: ['_index', 'gene_name']),
            'obsm': MagicMock(keys=lambda: ['X_umap']),
            'layers': MagicMock(keys=lambda: ['raw']),
        }.get(key, MagicMock())
        mock_open_group.return_value = mock_group
        
        # Call the method
        result = self.reader.open_zarr_url('http://example.com/test.zarr')
        
        # Check result
        self.assertTrue(result)
        mock_open_group.assert_called_once_with('http://example.com/test.zarr', mode='r')
        
    def test_load_chunked_data(self):
        """Test loading chunked data with optimized strategy."""
        self.reader.open_zarr(self.zarr_path)
        
        # Mock the chunks attribute
        original_get_item = self.reader.root.__getitem__
        
        def mocked_get_item(key):
            array = original_get_item(key)
            if key == 'X':
                array.chunks = (20, 10)  # Add chunks attribute
            return array
            
        self.reader.root.__getitem__ = mocked_get_item
        
        # Test chunked loading with row selection
        row_indices = list(range(30))
        chunked_data = self.reader._load_chunked_data('X', row_indices=row_indices)
        self.assertEqual(chunked_data.shape, (30, 50))
        
        # Test chunked loading with column selection
        col_indices = list(range(25))
        chunked_data = self.reader._load_chunked_data('X', col_indices=col_indices)
        self.assertEqual(chunked_data.shape, (100, 25))
        
        # Test chunked loading with both row and column selection
        chunked_data = self.reader._load_chunked_data('X', row_indices=row_indices, col_indices=col_indices)
        self.assertEqual(chunked_data.shape, (30, 25))
        
        # Test with no chunks info
        self.reader.root.__getitem__ = original_get_item
        regular_data = self.reader._load_chunked_data('X', row_indices=row_indices)
        self.assertEqual(regular_data.shape, (30, 50))
        
    def test_downsample_array(self):
        """Test downsampling large arrays."""
        self.reader.open_zarr(self.zarr_path)
        
        # Test downsampling with default parameters
        downsampled = self.reader._downsample_array('X', max_size=20)
        self.assertLessEqual(downsampled.shape[0], 100)
        self.assertLessEqual(downsampled.shape[1], 50)
        
        # Test downsampling with small max_size
        downsampled = self.reader._downsample_array('X', max_size=5)
        self.assertLessEqual(downsampled.shape[0], 100)
        self.assertLessEqual(downsampled.shape[1], 50)
        self.assertGreaterEqual(downsampled.shape[0], 1)
        self.assertGreaterEqual(downsampled.shape[1], 1)
        
    def test_load_progressively(self):
        """Test progressive loading with callbacks."""
        self.reader.open_zarr(self.zarr_path)
        
        # Create a mock callback
        callback_calls = []
        def mock_callback(chunk, progress):
            callback_calls.append((chunk.shape, progress))
        
        # Test progressive loading
        result = self.reader.load_progressively('X', chunk_size=20, callback=mock_callback)
        
        # Check result
        self.assertEqual(result.shape, (100, 50))
        
        # Check that callback was called with increasing progress values
        self.assertGreater(len(callback_calls), 0)
        progress_values = [call[1] for call in callback_calls]
        self.assertTrue(all(progress_values[i] <= progress_values[i+1] for i in range(len(progress_values)-1)))
        self.assertAlmostEqual(progress_values[-1], 1.0)

if __name__ == '__main__':
    unittest.main()
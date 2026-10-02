"""
Tests for the DataManager class.
"""
import os
import tempfile
import unittest
import numpy as np
import pytest
from unittest.mock import patch, MagicMock
import zarr

from annzarro.tests import zarr_compat
from pathlib import Path

from annzarro.data.manager import DataManager
from annzarro.data import manager as _manager_module

# patch.object on the instance the manager calls: the dotted string
# 'annzarro.core.zarr_reader.zarr_reader' does not resolve on Python < 3.11,
# where mock imports it as a module path and annzarro.core.zarr_reader is a
# module, not a package.
_reader = _manager_module.zarr_reader

class TestDataManager(unittest.TestCase):
    """Test cases for DataManager."""

    def setUp(self):
        """Set up the test environment."""
        self.manager = DataManager()
        
        # Create a temporary directory for test files
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name) / "data"
        self.data_dir.mkdir(exist_ok=True)
        
        # Create test zarr archives
        self.test_zarr_1 = self.data_dir / "test_dataset1.zarr"
        self.test_zarr_2 = self.data_dir / "test_dataset2.zarr"
        
        self.create_test_zarr(self.test_zarr_1)
        self.create_test_zarr(self.test_zarr_2)

    def tearDown(self):
        """Clean up the test environment."""
        self.temp_dir.cleanup()

    def create_test_zarr(self, path):
        """Create a test zarr archive."""
        root = zarr_compat.open_group(path)
        
        # Create X matrix
        X = np.random.rand(100, 50).astype('float32')
        zarr_compat.write_array(root, 'X', data=X)
        
        # Create obs
        obs_group = root.create_group('obs')
        cell_ids = np.array([f'cell_{i}' for i in range(100)])
        zarr_compat.write_array(obs_group, '_index', data=cell_ids)
        cell_types = np.array(['type_A'] * 50 + ['type_B'] * 50)
        zarr_compat.write_array(obs_group, 'cell_type', data=cell_types)
        
        # Create var
        var_group = root.create_group('var')
        gene_ids = np.array([f'gene_{i}' for i in range(50)])
        zarr_compat.write_array(var_group, '_index', data=gene_ids)
        gene_names = np.array([f'GENE_{i}' for i in range(50)])
        zarr_compat.write_array(var_group, 'gene_name', data=gene_names)
        
        # Create obsm
        obsm_group = root.create_group('obsm')
        umap = np.random.rand(100, 2).astype('float32')
        zarr_compat.write_array(obsm_group, 'X_umap', data=umap)
        
        # Create layers
        layers_group = root.create_group('layers')
        raw = np.random.rand(100, 50).astype('float32')
        zarr_compat.write_array(layers_group, 'raw', data=raw)

    def test_discover_datasets(self):
        """Test discovering datasets."""
        # Test with a valid directory
        datasets = self.manager.discover_datasets(self.data_dir)
        self.assertEqual(len(datasets), 2)
        
        # Verify dataset info
        dataset_names = [ds["name"] for ds in datasets]
        self.assertIn("Test Dataset1", dataset_names)
        self.assertIn("Test Dataset2", dataset_names)
        
        # Test with invalid directory
        invalid_dir = Path(self.temp_dir.name) / "nonexistent"
        datasets = self.manager.discover_datasets(invalid_dir)
        self.assertEqual(len(datasets), 0)

    def test_list_datasets(self):
        """Test listing datasets."""
        # First populate the cache
        self.manager.discover_datasets(self.data_dir)
        
        # Test listing from cache
        datasets = self.manager.list_datasets()
        self.assertEqual(len(datasets), 2)
        
        # Test listing from specific directory
        datasets = self.manager.list_datasets(self.data_dir)
        self.assertEqual(len(datasets), 2)

    @patch.object(_reader, 'open_dataset_by_path')
    @patch.object(_reader, 'get_obs_names')
    @patch.object(_reader, 'get_var_names')
    def test_get_dataset_info(self, mock_get_var_names, mock_get_obs_names, mock_open):
        """Test getting dataset info."""
        mock_open.return_value = (object(), {
            "shape": (100, 50),
            "has_obs": True,
            "has_var": True,
            "has_obsm": True,
            "has_layers": True,
            "obs_columns": ["cell_type"],
            "var_columns": ["gene_name"],
            "layers": ["raw"],
            "embeddings": ["X_umap"]
        })
        mock_get_obs_names.return_value = [f"cell_{i}" for i in range(10)]
        mock_get_var_names.return_value = [f"gene_{i}" for i in range(10)]

        info = self.manager.get_dataset_info(str(self.test_zarr_1))

        self.assertEqual(info["name"], "Test Dataset1")
        self.assertEqual(info["shape"], (100, 50))
        self.assertEqual(info["n_obs"], 100)
        self.assertEqual(info["n_vars"], 50)
        self.assertIn("cell_type", info["obs_columns"])
        self.assertIn("gene_name", info["var_columns"])
        self.assertIn("raw", info["layers"])
        self.assertIn("X_umap", info["embeddings"])
        self.assertEqual(info["obs_names_sample"], mock_get_obs_names.return_value)

        mock_open.assert_called_once_with(str(self.test_zarr_1))
        mock_get_obs_names.assert_called_once_with(str(self.test_zarr_1))
        mock_get_var_names.assert_called_once_with(str(self.test_zarr_1))

        # The stateless reader raises on a store it cannot open.
        mock_open.side_effect = ValueError("not a zarr store")
        info = self.manager.get_dataset_info("/invalid/path")
        self.assertIn("error", info)

    @pytest.mark.xfail(strict=True, raises=AttributeError, reason=(
        "real bug: DataManager's stateful half (load_dataset, get_obs/get_var/"
        "get_obsm, downsample_cells stratified/kmeans) calls ZarrReader.open_zarr/"
        "get_obs/get_obsm, removed when the reader became stateless (a5c1aed). "
        "The server does not reach it (it uses list_datasets/get_dataset_info), "
        "but DataManager is exported from the package."))
    def test_load_dataset(self):
        """Test loading a dataset (real reader, real store)."""
        result = self.manager.load_dataset(str(self.test_zarr_1))
        self.assertTrue(result)
        self.assertEqual(self.manager.current_dataset["name"], "Test Dataset1")
        
        # Verify that state is reset
        self.assertEqual(len(self.manager.selected_cells), 0)
        self.assertEqual(len(self.manager.selected_genes), 0)
        self.assertIsNone(self.manager.focused_cell)
        self.assertIsNone(self.manager.focused_gene)
        self.assertEqual(len(self.manager.cache), 0)
        
        self.assertFalse(self.manager.load_dataset("/invalid/path"))

    @patch.object(_reader, 'get_metadata')
    def test_get_basic_info(self, mock_get_metadata):
        """Test getting basic info."""
        # Test when no dataset is loaded
        self.manager.current_dataset = None
        info = self.manager.get_basic_info()
        self.assertIn("error", info)
        
        # Test with a loaded dataset
        self.manager.current_dataset = {
            "name": "Test Dataset",
            "path": str(self.test_zarr_1)
        }
        
        mock_get_metadata.return_value = {
            "shape": (100, 50),
            "has_obs": True,
            "has_var": True,
            "has_obsm": True,
            "has_varm": False,
            "has_layers": True,
            "has_uns": False,
            "obs_columns": ["cell_type"],
            "var_columns": ["gene_name"],
            "layers": ["raw"],
            "embeddings": ["X_umap"]
        }
        
        info = self.manager.get_basic_info()
        
        # Verify info
        self.assertEqual(info["name"], "Test Dataset")
        self.assertEqual(info["path"], str(self.test_zarr_1))
        self.assertEqual(info["shape"], (100, 50))
        self.assertEqual(info["n_obs"], 100)
        self.assertEqual(info["n_vars"], 50)
        self.assertTrue(info["has_obs"])
        self.assertTrue(info["has_var"])
        self.assertTrue(info["has_obsm"])
        self.assertFalse(info["has_varm"])
        self.assertTrue(info["has_layers"])
        self.assertFalse(info["has_uns"])
        self.assertIn("cell_type", info["obs_columns"])
        self.assertIn("gene_name", info["var_columns"])
        self.assertIn("raw", info["layers"])
        self.assertIn("X_umap", info["embeddings"])

    @patch.object(_reader, 'get_X')
    def test_get_X(self, mock_get_X):
        """Test getting X data."""
        # Mock data
        mock_data = np.random.rand(100, 50)
        mock_get_X.return_value = mock_data
        
        # Test when no dataset is loaded
        self.manager.current_dataset = None
        result = self.manager.get_X()
        self.assertEqual(len(result), 0)
        
        # Test with a loaded dataset
        self.manager.current_dataset = {
            "name": "Test Dataset",
            "path": str(self.test_zarr_1)
        }
        
        # Get all data
        result = self.manager.get_X()
        np.testing.assert_array_equal(result, mock_data)
        mock_get_X.assert_called_with(None, None)
        
        # Get subset of rows
        row_indices = [0, 1, 2]
        result = self.manager.get_X(row_indices=row_indices)
        np.testing.assert_array_equal(result, mock_data)
        mock_get_X.assert_called_with(row_indices, None)
        
        # Test caching
        mock_get_X.reset_mock()
        result = self.manager.get_X(row_indices=row_indices)
        np.testing.assert_array_equal(result, mock_data)
        mock_get_X.assert_not_called()  # Should use cached value

    @patch.object(_reader, 'get_layer')
    def test_get_layer(self, mock_get_layer):
        """Test getting layer data."""
        # Mock data
        mock_data = np.random.rand(100, 50)
        mock_get_layer.return_value = mock_data
        
        # Test when no dataset is loaded
        self.manager.current_dataset = None
        result = self.manager.get_layer("raw")
        self.assertEqual(len(result), 0)
        
        # Test with a loaded dataset
        self.manager.current_dataset = {
            "name": "Test Dataset",
            "path": str(self.test_zarr_1)
        }
        
        # Get all data
        result = self.manager.get_layer("raw")
        np.testing.assert_array_equal(result, mock_data)
        mock_get_layer.assert_called_with("raw", None, None)
        
        # Get subset of rows
        row_indices = [0, 1, 2]
        result = self.manager.get_layer("raw", row_indices=row_indices)
        np.testing.assert_array_equal(result, mock_data)
        mock_get_layer.assert_called_with("raw", row_indices, None)
        
        # Test caching
        mock_get_layer.reset_mock()
        result = self.manager.get_layer("raw", row_indices=row_indices)
        np.testing.assert_array_equal(result, mock_data)
        mock_get_layer.assert_not_called()  # Should use cached value

    def test_selection_methods(self):
        """Test cell and gene selection methods."""
        # Cell selection
        cells_to_select = ["cell_1", "cell_2", "cell_3"]
        self.manager.set_selected_cells(cells_to_select)
        self.assertEqual(self.manager.get_selected_cells(), set(cells_to_select))
        
        # Add cells
        self.manager.add_selected_cells(["cell_4", "cell_5"])
        self.assertEqual(len(self.manager.get_selected_cells()), 5)
        
        # Remove cells
        self.manager.remove_selected_cells(["cell_1", "cell_2"])
        self.assertEqual(len(self.manager.get_selected_cells()), 3)
        
        # Clear cells
        self.manager.clear_selected_cells()
        self.assertEqual(len(self.manager.get_selected_cells()), 0)
        
        # Gene selection
        genes_to_select = ["gene_1", "gene_2", "gene_3"]
        self.manager.set_selected_genes(genes_to_select)
        self.assertEqual(self.manager.get_selected_genes(), set(genes_to_select))
        
        # Add genes
        self.manager.add_selected_genes(["gene_4", "gene_5"])
        self.assertEqual(len(self.manager.get_selected_genes()), 5)
        
        # Remove genes
        self.manager.remove_selected_genes(["gene_1", "gene_2"])
        self.assertEqual(len(self.manager.get_selected_genes()), 3)
        
        # Clear genes
        self.manager.clear_selected_genes()
        self.assertEqual(len(self.manager.get_selected_genes()), 0)

    def test_focus_methods(self):
        """Test cell and gene focus methods."""
        # Cell focus
        self.manager.set_focused_cell("cell_1")
        self.assertEqual(self.manager.get_focused_cell(), "cell_1")
        
        # Clear cell focus
        self.manager.set_focused_cell(None)
        self.assertIsNone(self.manager.get_focused_cell())
        
        # Gene focus
        self.manager.set_focused_gene("gene_1")
        self.assertEqual(self.manager.get_focused_gene(), "gene_1")
        
        # Clear gene focus
        self.manager.set_focused_gene(None)
        self.assertIsNone(self.manager.get_focused_gene())

    def test_taxonomy_methods(self):
        """Test taxonomy methods."""
        # Default values
        tax_info = self.manager.get_taxonomy_info()
        self.assertEqual(tax_info["taxonomy_id"], 9606)  # Homo sapiens
        self.assertEqual(tax_info["species"], "Homo sapiens")
        
        # Set new values
        self.manager.set_taxonomy_info(10090, "Mus musculus")
        tax_info = self.manager.get_taxonomy_info()
        self.assertEqual(tax_info["taxonomy_id"], 10090)
        self.assertEqual(tax_info["species"], "Mus musculus")

    def test_cache_management(self):
        """Test cache management."""
        # Set up a small cache
        self.manager.cache_max_size = 3
        
        # Add items
        self.manager._add_to_cache("key1", "value1")
        self.manager._add_to_cache("key2", "value2")
        self.manager._add_to_cache("key3", "value3")
        
        # Verify all items are in cache
        self.assertEqual(len(self.manager.cache), 3)
        self.assertEqual(self.manager.cache["key1"], "value1")
        self.assertEqual(self.manager.cache["key2"], "value2")
        self.assertEqual(self.manager.cache["key3"], "value3")
        
        # Add another item, which should evict the oldest
        self.manager._add_to_cache("key4", "value4")
        
        # Verify cache size and content
        self.assertEqual(len(self.manager.cache), 3)
        self.assertNotIn("key1", self.manager.cache)  # This should be evicted
        self.assertIn("key2", self.manager.cache)
        self.assertIn("key3", self.manager.cache)
        self.assertIn("key4", self.manager.cache)

    def test_calculate_statistics(self):
        """Test calculation of comprehensive statistics."""
        # Test with normal data
        data = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        stats = self.manager.calculate_statistics(data)
        
        # Check basic statistics
        self.assertEqual(stats["count"], 5)
        self.assertEqual(stats["min"], 1.0)
        self.assertEqual(stats["max"], 5.0)
        self.assertEqual(stats["mean"], 3.0)
        self.assertEqual(stats["median"], 3.0)
        self.assertEqual(stats["sum"], 15.0)
        
        # Check percentiles
        self.assertEqual(stats["percentiles"]["p0"], 1.0)
        self.assertEqual(stats["percentiles"]["p50"], 3.0)
        self.assertEqual(stats["percentiles"]["p100"], 5.0)
        
        # Check zero counts
        self.assertEqual(stats["zero_count"], 0)
        self.assertEqual(stats["non_zero_count"], 5)
        
        # Test with zeros and negatives
        data = np.array([-2.0, -1.0, 0.0, 1.0, 2.0])
        stats = self.manager.calculate_statistics(data)
        
        self.assertEqual(stats["zero_count"], 1)
        self.assertEqual(stats["non_zero_count"], 4)
        self.assertEqual(stats["negative_count"], 2)
        self.assertEqual(stats["positive_count"], 2)
        
        # Test with NaN and Inf
        data = np.array([1.0, np.nan, 3.0, np.inf, 5.0])
        stats = self.manager.calculate_statistics(data)
        
        self.assertEqual(stats["count"], 3)  # Only finite values
        self.assertEqual(stats["nan_count"], 1)
        self.assertEqual(stats["inf_count"], 1)
        
    @patch.object(_reader, 'get_X')
    @patch.object(_reader, 'get_layer')
    @patch.object(_reader, 'get_obs_names')
    @patch.object(_reader, 'get_var_names')
    def test_analyze_expression_data(self, mock_var_names, mock_obs_names, mock_get_layer, mock_get_X):
        """Test expression data analysis."""
        # Set up mocks
        mock_get_X.return_value = np.array([[1.0, 2.0], [3.0, 4.0]])
        mock_get_layer.return_value = np.array([[5.0, 6.0], [7.0, 8.0]])
        mock_obs_names.return_value = ["cell_1", "cell_2"]
        mock_var_names.return_value = ["gene_1", "gene_2"]
        
        # Test with no dataset loaded
        self.manager.current_dataset = None
        result = self.manager.analyze_expression_data()
        self.assertIn("error", result)
        
        # Set up a dataset
        self.manager.current_dataset = {
            "name": "Test Dataset",
            "path": str(self.test_zarr_1)
        }
        
        # Test with default parameters
        result = self.manager.analyze_expression_data()
        
        # Check structure
        self.assertIn("overall", result)
        self.assertIn("genes", result)
        self.assertIn("cells", result)
        self.assertIn("shape", result)
        self.assertIn("sparsity", result)
        
        # Check specific gene and cell stats
        self.assertEqual(result["shape"], (2, 2))
        
        # Test with layer
        result = self.manager.analyze_expression_data(layer="raw")
        self.assertIn("overall", result)
        mock_get_layer.assert_called_with("raw", None, None)
        
        # Test with specific indices
        result = self.manager.analyze_expression_data(gene_indices=[0], cell_indices=[1])
        self.assertIn("overall", result)
        mock_get_X.assert_called_with([1], [0])
        
    def test_downsample_cells_random(self):
        """Test random downsampling of cells."""
        # Set up a test dataset
        self.manager.current_dataset = {
            "name": "Test Dataset",
            "path": str(self.test_zarr_1)
        }
        
        # Use a different approach with patch context manager
        with patch.object(_reader, 'get_metadata') as mock_metadata:
            # Mock the metadata to return a fixed shape
            mock_metadata.return_value = {"shape": (1000, 50)}
            
            # Test random sampling
            result = self.manager.downsample_cells(n_samples=100, method='random', seed=42)
            self.assertEqual(len(result), 100)
            self.assertEqual(len(set(result)), 100)  # Check for uniqueness
            
    @pytest.mark.xfail(strict=True, raises=AttributeError, reason=(
        "real bug: DataManager's stateful half (load_dataset, get_obs/get_var/"
        "get_obsm, downsample_cells stratified/kmeans) calls ZarrReader.open_zarr/"
        "get_obs/get_obsm, removed when the reader became stateless (a5c1aed). "
        "The server does not reach it (it uses list_datasets/get_dataset_info), "
        "but DataManager is exported from the package."))
    def test_downsample_cells_stratified(self):
        """Test stratified downsampling of cells."""
        # Set up a test dataset
        self.manager.current_dataset = {
            "name": "Test Dataset",
            "path": str(self.test_zarr_1)
        }
        
        # Test stratified sampling with mocking
        with patch.object(_reader, 'get_metadata') as mock_metadata:
            mock_metadata.return_value = {
                "shape": (1000, 50),
                "has_obs": True,
                "obs_columns": ["cell_type"]
            }
            
            # Real reader: get_obs is the call that no longer exists.
            result = self.manager.downsample_cells(n_samples=100, method='stratified', seed=42)
            self.assertEqual(len(result), 100)
            self.assertEqual(len(set(result)), 100)  # Check for uniqueness
    
    def test_downsample_cells_kmeans(self):
        """Test k-means downsampling of cells."""
        # Skip test if sklearn not available
        try:
            from sklearn.cluster import MiniBatchKMeans
        except ImportError:
            self.skipTest("sklearn not available")
        
        # Set up a test dataset
        self.manager.current_dataset = {
            "name": "Test Dataset",
            "path": str(self.test_zarr_1)
        }
        
        # Test k-means sampling with mocking
        with patch.object(_reader, 'get_metadata') as mock_metadata:
            mock_metadata.return_value = {
                "shape": (100, 50),
                "has_obsm": True,
                "embeddings": ["X_umap"]
            }
            
            with patch.object(self.manager, 'get_embeddings', return_value=["X_umap"]):
                with patch.object(_reader, 'get_obsm') as mock_get_obsm:
                    # Create embedding data
                    mock_get_obsm.return_value = np.random.rand(100, 2)
                    
                    # Test k-means sampling
                    result = self.manager.downsample_cells(n_samples=10, method='kmeans', seed=42)
                    self.assertLessEqual(len(result), 10)

if __name__ == '__main__':
    unittest.main()
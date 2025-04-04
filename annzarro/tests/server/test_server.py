"""
Tests for the Flask server.
"""
import json
import unittest
from unittest.mock import patch, MagicMock
import numpy as np
from flask import Flask

from annzarro.server.server import app, configure_app

class TestServer(unittest.TestCase):
    """Test cases for the Flask server."""

    def setUp(self):
        """Set up the test environment."""
        # Configure the app for testing
        app.config['TESTING'] = True
        app.config['DEBUG'] = False
        
        # Create a test client
        self.client = app.test_client()

    @patch('annzarro.data.manager.data_manager.list_datasets')
    def test_list_datasets(self, mock_list_datasets):
        """Test listing datasets."""
        # Mock dataset list
        mock_datasets = [
            {"id": "dataset1", "name": "Dataset 1", "path": "/data/dataset1.zarr"},
            {"id": "dataset2", "name": "Dataset 2", "path": "/data/dataset2.zarr"}
        ]
        mock_list_datasets.return_value = mock_datasets
        
        # Send request
        response = self.client.get('/api/v1/datasets')
        
        # Check response
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('datasets', data)
        self.assertEqual(len(data['datasets']), 2)
        self.assertEqual(data['datasets'][0]['name'], 'Dataset 1')
        
        # Verify mock was called correctly
        mock_list_datasets.assert_called_once()

    @patch('annzarro.data.manager.data_manager.get_dataset_info')
    def test_get_dataset_info(self, mock_get_dataset_info):
        """Test getting dataset info."""
        # Mock dataset info
        mock_info = {
            "name": "Dataset 1",
            "path": "/data/dataset1.zarr",
            "shape": (100, 50),
            "n_obs": 100,
            "n_vars": 50,
            "obs_columns": ["cell_type"],
            "var_columns": ["gene_name"],
            "layers": ["raw"],
            "embeddings": ["X_umap"]
        }
        mock_get_dataset_info.return_value = mock_info
        
        # Send request
        response = self.client.get('/api/v1/datasets/data/dataset1.zarr')
        
        # Check response
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data['name'], 'Dataset 1')
        self.assertEqual(data['shape'], [100, 50])  # JSON converts tuple to list
        
        # Verify mock was called correctly
        mock_get_dataset_info.assert_called_once_with('data/dataset1.zarr')

    @patch('annzarro.server.server.zarr_reader.open_dataset_by_path')
    def test_load_dataset(self, mock_open_dataset):
        """Test getting dataset metadata instead of loading it (stateless architecture)."""
        # In the stateless architecture, we don't load datasets on the server anymore
        # Instead, we just get the metadata and let the client request specific data
        
        # Mock the zarr reader response
        mock_root = MagicMock()
        mock_metadata = {
            "shape": (100, 50),
            "has_obs": True,
            "has_var": True,
            "has_obsm": True,
            "obs_columns": ["cell_type"],
            "var_columns": ["gene_name"],
            "embeddings": ["X_umap"]
        }
        mock_open_dataset.return_value = (mock_root, mock_metadata)
        
        # Send request to get dataset metadata
        response = self.client.get('/api/v1/datasets/data/dataset1.zarr/info')
        
        # Check response
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data['shape'], [100, 50])
        
        # Test error case with invalid path
        mock_open_dataset.side_effect = Exception("Dataset not found")
        
        # Send request with invalid path
        response = self.client.get('/api/v1/datasets/invalid/path/info')
        
        # Check response
        self.assertEqual(response.status_code, 500)
        data = json.loads(response.data)
        self.assertIn('error', data)

    @patch('annzarro.data.manager.data_manager.get_X')
    def test_get_X(self, mock_get_X):
        """Test getting X matrix data."""
        # Mock X data
        mock_data = np.array([[1.0, 2.0], [3.0, 4.0]])
        mock_get_X.return_value = mock_data
        
        # Note: With the stateless API, at least one of rows or cols is required
        # The test for no indices should now expect a 400 response
        response = self.client.get('/api/v1/data/X')
        self.assertEqual(response.status_code, 400)
        
        # Send request with row indices
        response = self.client.get('/api/v1/data/X?rows=0,1')
        
        # Check response
        self.assertEqual(response.status_code, 200)
        
        # Verify mock was called correctly
        mock_get_X.assert_called_with([0, 1], None, None)
        
        # Send request with column indices
        response = self.client.get('/api/v1/data/X?cols=0,1')
        
        # Check response
        self.assertEqual(response.status_code, 200)
        
        # Verify mock was called correctly
        mock_get_X.assert_called_with(None, [0, 1], None)
        
        # Send request with both row and column indices
        response = self.client.get('/api/v1/data/X?rows=0,1&cols=0,1')
        
        # Check response
        self.assertEqual(response.status_code, 200)
        
        # Verify mock was called correctly
        mock_get_X.assert_called_with([0, 1], [0, 1], None)
        
        # Test with invalid indices
        response = self.client.get('/api/v1/data/X?rows=invalid')
        
        # Check response
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('error', data)

    @patch('annzarro.data.manager.data_manager.get_obs')
    def test_get_obs(self, mock_get_obs):
        """Test getting observation annotations."""
        # Mock obs data for a column
        mock_column_data = np.array(['type_A', 'type_B'])
        
        # Mock obs data for all columns
        mock_all_data = {
            '_index': np.array(['cell_0', 'cell_1']),
            'cell_type': np.array(['type_A', 'type_B'])
        }
        
        # Set up mock behavior
        def mock_get_obs_func(column, indices, dataset_id=None):
            if column is None:
                return mock_all_data
            else:
                return mock_column_data
                
        mock_get_obs.side_effect = mock_get_obs_func
        
        # Use legacy API approach (without dataset_path) to avoid stateless implementation
        # Send request for a specific column
        response = self.client.get('/api/v1/data/obs?column=cell_type')
        
        # Check response
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('data', data)
        self.assertEqual(data['data'], ['type_A', 'type_B'])
        
        # Send request for all columns
        response = self.client.get('/api/v1/data/obs')
        
        # Check response
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('data', data)
        self.assertIn('_index', data['data'])
        self.assertIn('cell_type', data['data'])
        
        # Test with indices
        response = self.client.get('/api/v1/data/obs?indices=0,1')
        
        # Verify mock was called correctly
        mock_get_obs.assert_called_with(None, [0, 1], None)

    @patch('annzarro.data.manager.data_manager.get_selected_cells')
    @patch('annzarro.data.manager.data_manager.set_selected_cells')
    @patch('annzarro.data.manager.data_manager.add_selected_cells')
    @patch('annzarro.data.manager.data_manager.remove_selected_cells')
    @patch('annzarro.data.manager.data_manager.clear_selected_cells')
    def test_handle_cell_selection(self, mock_clear, mock_remove, mock_add, mock_set, mock_get):
        """Test cell selection operations."""
        # Mock get selected cells
        mock_get.return_value = {'cell_1', 'cell_2'}
        
        # Test GET
        response = self.client.get('/api/v1/data/selection/cells')
        
        # Check response
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('selected_cells', data)
        self.assertEqual(len(data['selected_cells']), 2)
        self.assertIn('cell_1', data['selected_cells'])
        
        # Test POST - set operation
        response = self.client.post(
            '/api/v1/data/selection/cells',
            data=json.dumps({'cells': ['cell_3', 'cell_4'], 'operation': 'set'}),
            content_type='application/json'
        )
        
        # Check response
        self.assertEqual(response.status_code, 200)
        
        # Verify mock was called correctly
        mock_set.assert_called_with(['cell_3', 'cell_4'], None)
        
        # Test POST - add operation
        response = self.client.post(
            '/api/v1/data/selection/cells',
            data=json.dumps({'cells': ['cell_5'], 'operation': 'add'}),
            content_type='application/json'
        )
        
        # Check response
        self.assertEqual(response.status_code, 200)
        
        # Verify mock was called correctly
        mock_add.assert_called_with(['cell_5'], None)
        
        # Test POST - remove operation
        response = self.client.post(
            '/api/v1/data/selection/cells',
            data=json.dumps({'cells': ['cell_1'], 'operation': 'remove'}),
            content_type='application/json'
        )
        
        # Check response
        self.assertEqual(response.status_code, 200)
        
        # Verify mock was called correctly
        mock_remove.assert_called_with(['cell_1'], None)
        
        # Test POST - invalid operation
        response = self.client.post(
            '/api/v1/data/selection/cells',
            data=json.dumps({'cells': ['cell_1'], 'operation': 'invalid'}),
            content_type='application/json'
        )
        
        # Check response
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('error', data)
        
        # Test DELETE
        response = self.client.delete('/api/v1/data/selection/cells')
        
        # Check response
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data['selected_cells'], [])
        
        # Verify mock was called correctly
        mock_clear.assert_called_once()

    def test_configure_app(self):
        """Test configuring the Flask app."""
        # Create a test app
        test_app = Flask(__name__)
        
        # Configure with default config
        config = {'cors_enabled': False, 'proxy_count': 0}
        configure_app(test_app, config)
        
        # Configure with CORS
        config = {'cors_enabled': True, 'cors_origins': '*'}
        configure_app(test_app, config)
        
        # Configure with proxy
        config = {'proxy_count': 1}
        configure_app(test_app, config)
        
        # Assert that configuration doesn't raise exceptions
        self.assertTrue(True)

    @patch('annzarro.data.manager.data_manager.analyze_expression_data')
    def test_get_data_statistics(self, mock_analyze):
        """Test getting statistical analysis of expression data."""
        # Mock statistics
        mock_stats = {
            "overall": {
                "count": 100,
                "min": 0.0,
                "max": 10.0,
                "mean": 5.0,
                "std": 2.5,
                "median": 5.0,
                "zero_count": 20,
                "non_zero_count": 80,
                "zero_fraction": 0.2
            },
            "genes": {
                "gene_1": {
                    "count": 50,
                    "mean": 4.5
                }
            },
            "cells": {
                "cell_1": {
                    "count": 50,
                    "mean": 5.5
                }
            },
            "shape": [100, 50],
            "sparsity": 0.2
        }
        mock_analyze.return_value = mock_stats
        
        # Test with no parameters and dataset_path (required in stateless architecture)
        response = self.client.get('/api/v1/data/statistics?dataset_path=data/test.zarr')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data, mock_stats)
        mock_analyze.assert_called_with(None, None, None, None)
        
        # Test with gene indices
        response = self.client.get('/api/v1/data/statistics?gene_indices=0,1,2&dataset_path=data/test.zarr')
        self.assertEqual(response.status_code, 200)
        mock_analyze.assert_called_with([0, 1, 2], None, None, None)
        
        # Test with cell indices
        response = self.client.get('/api/v1/data/statistics?cell_indices=0,1,2&dataset_path=data/test.zarr')
        self.assertEqual(response.status_code, 200)
        mock_analyze.assert_called_with(None, [0, 1, 2], None, None)
        
        # Test with layer
        response = self.client.get('/api/v1/data/statistics?layer=raw&dataset_path=data/test.zarr')
        self.assertEqual(response.status_code, 200)
        mock_analyze.assert_called_with(None, None, 'raw', None)
        
        # Test with invalid indices
        response = self.client.get('/api/v1/data/statistics?gene_indices=invalid')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('error', data)
    
    @patch('annzarro.data.manager.data_manager.downsample_cells')
    @patch('annzarro.data.manager.data_manager.get_obs_names')
    @patch('annzarro.data.manager.zarr_reader.get_metadata')
    @patch('annzarro.data.manager.data_manager.get_obs')
    @patch('annzarro.data.manager.data_manager.get_obsm')
    @patch('annzarro.data.manager.data_manager.get_embeddings')
    def test_get_downsampled_data(self, mock_get_embeddings, mock_get_obsm, 
                                mock_get_obs, mock_get_metadata, 
                                mock_get_obs_names, mock_downsample_cells):
        """Test getting downsampled data for visualization."""
        # Mock the downsampling
        mock_cell_indices = [0, 1, 2, 3, 4]
        mock_downsample_cells.return_value = mock_cell_indices
        
        # Mock cell names
        mock_get_obs_names.return_value = ['cell_0', 'cell_1', 'cell_2', 'cell_3', 'cell_4', 'cell_5']
        
        # Mock metadata
        mock_get_metadata.return_value = {
            "obs_columns": ["cell_type", "condition", "batch"]
        }
        
        # Mock observation data
        mock_get_obs.return_value = np.array(['type_A', 'type_B', 'type_A', 'type_B', 'type_A'])
        
        # Mock embeddings
        mock_get_embeddings.return_value = ['X_umap']
        mock_get_obsm.return_value = np.array([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [7.0, 8.0], [9.0, 10.0]])
        
        # Test without dataset_path (using legacy non-stateless approach)
        with patch('annzarro.data.manager.data_manager.current_dataset', {'id': 'test_dataset'}):
            response = self.client.get('/api/v1/data/downsampled')
            self.assertEqual(response.status_code, 200)
            data = json.loads(response.data)
            
            # Check the response structure
            self.assertIn('n_cells', data)
            self.assertIn('cell_indices', data)
            self.assertIn('cell_names', data)
            self.assertIn('obs', data)
            self.assertIn('embeddings', data)
            
            # Check specific values 
            self.assertEqual(data['n_cells'], 5)
            self.assertEqual(data['cell_indices'], [0, 1, 2, 3, 4])
            self.assertEqual(data['cell_names'], ['cell_0', 'cell_1', 'cell_2', 'cell_3', 'cell_4'])
            
            # Verify mock calls
            mock_downsample_cells.assert_called_with(1000, 'random', 42, None)
            
            # Test with custom parameters
            response = self.client.get('/api/v1/data/downsampled?n_samples=50&method=stratified&seed=123')
            self.assertEqual(response.status_code, 200)
            
            # Verify custom parameters were used
            mock_downsample_cells.assert_called_with(50, 'stratified', 123, None)
            
            # Test with failed downsampling
            mock_downsample_cells.return_value = []
            response = self.client.get('/api/v1/data/downsampled')
            self.assertEqual(response.status_code, 200)
            data = json.loads(response.data)
            self.assertIn('error', data)
    
    @patch('annzarro.server.server.zarr_reader.open_dataset_by_path')
    @patch('annzarro.data.manager.zarr_reader.get_obsp')
    def test_get_obsp(self, mock_get_obsp, mock_open_dataset_by_path):
        """Test getting obsp (observation-observation) matrix data."""
        # Mock obsp data
        mock_data = np.array([[1.0, 2.0], [3.0, 4.0]])
        mock_get_obsp.return_value = mock_data
        
        # Mock the zarr reader response
        mock_root = MagicMock()
        
        # Mock obsp access
        def getitem_side_effect(key):
            if key == 'obsp':
                mock_obsp = MagicMock()
                
                def obsp_getitem(obsp_key):
                    if obsp_key == 'connectivities':
                        return mock_data
                    else:
                        raise KeyError(f"Obsp key {obsp_key} not found")
                
                mock_obsp.__getitem__.side_effect = obsp_getitem
                mock_obsp.__contains__.return_value = True  # For checking if connectivities exists
                return mock_obsp
            else:
                raise KeyError(f"Key {key} not found")
                
        mock_root.__getitem__.side_effect = getitem_side_effect
        mock_root.__contains__.return_value = True  # For 'obsp' in root check
        
        mock_metadata = {"has_obsp": True}
        mock_open_dataset_by_path.return_value = (mock_root, mock_metadata)
        
        # Send request with no indices but with dataset_path (required in stateless architecture)
        response = self.client.get('/api/v1/data/obsp/connectivities?dataset_path=data/test.zarr')
        
        # Check response
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('data', data)
        self.assertEqual(data['data'], [[1.0, 2.0], [3.0, 4.0]])
        
        # Verify open_dataset_by_path was called correctly
        mock_open_dataset_by_path.assert_called_with('data/test.zarr')
        
        # Send request with indices and dataset_path
        response = self.client.get('/api/v1/data/obsp/connectivities?indices=0,1&dataset_path=data/test.zarr')
        
        # Check response
        self.assertEqual(response.status_code, 200)
        
        # Just verify the response status code, no need to check the mock call again
        
        # Test with invalid indices and dataset_path
        response = self.client.get('/api/v1/data/obsp/connectivities?indices=invalid&dataset_path=data/test.zarr')
        
        # Check response
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('error', data)
    
    @patch('annzarro.server.server.zarr_reader.open_dataset_by_path')
    @patch('annzarro.data.manager.zarr_reader.get_varp')
    def test_get_varp(self, mock_get_varp, mock_open_dataset_by_path):
        """Test getting varp (variable-variable) matrix data."""
        # Mock varp data
        mock_data = np.array([[1.0, 2.0], [3.0, 4.0]])
        mock_get_varp.return_value = mock_data
        
        # Mock the zarr reader response
        mock_root = MagicMock()
        
        # Mock varp access
        def getitem_side_effect(key):
            if key == 'varp':
                mock_varp = MagicMock()
                
                def varp_getitem(varp_key):
                    if varp_key == 'correlation':
                        return mock_data
                    else:
                        raise KeyError(f"Varp key {varp_key} not found")
                
                mock_varp.__getitem__.side_effect = varp_getitem
                mock_varp.__contains__.return_value = True  # For checking if correlation exists
                return mock_varp
            else:
                raise KeyError(f"Key {key} not found")
                
        mock_root.__getitem__.side_effect = getitem_side_effect
        mock_root.__contains__.return_value = True  # For 'varp' in root check
        
        mock_metadata = {"has_varp": True}
        mock_open_dataset_by_path.return_value = (mock_root, mock_metadata)
        
        # Send request with no indices but with dataset_path (required in stateless architecture)
        response = self.client.get('/api/v1/data/varp/correlation?dataset_path=data/test.zarr')
        
        # Check response
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('data', data)
        self.assertEqual(data['data'], [[1.0, 2.0], [3.0, 4.0]])
        
        # Verify open_dataset_by_path was called correctly
        mock_open_dataset_by_path.assert_called_with('data/test.zarr')
        
        # Send request with indices and dataset_path
        response = self.client.get('/api/v1/data/varp/correlation?indices=0,1&dataset_path=data/test.zarr')
        
        # Check response
        self.assertEqual(response.status_code, 200)
        
        # Just verify the response status code, no need to check the mock call again
        
        # Test with invalid indices and dataset_path
        response = self.client.get('/api/v1/data/varp/correlation?indices=invalid&dataset_path=data/test.zarr')
        
        # Check response
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('error', data)
    
    def test_get_progressive_data(self):
        """Test progressive data loading endpoint."""
        # This is mostly a smoke test since streaming responses are hard to test
        
        # Test with missing dataset_path parameter (required in stateless architecture)
        response = self.client.get('/api/v1/data/progressive/X')
        self.assertEqual(response.status_code, 400)  # Should return 400 when dataset_path is not provided
        
        # Test with mock dataset path
        # Need to patch load_progressively to avoid actual loading
        with patch('annzarro.core.zarr_reader.zarr_reader.load_progressively') as mock_load:
            # Mock the callback to provide sample data
            def side_effect(path, chunk_size, callback, dataset_id=None, dataset_path=None):
                callback(np.array([[1.0, 2.0], [3.0, 4.0]]), 0.5)
                callback(np.array([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]]), 1.0)
                return np.array([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]])
            
            mock_load.side_effect = side_effect
            
            # Test X path with dataset_path
            response = self.client.get('/api/v1/data/progressive/X?dataset_path=data/test.zarr')
            self.assertEqual(response.status_code, 200)
            
            # Test obsm path with dataset_path
            response = self.client.get('/api/v1/data/progressive/obsm/X_umap?dataset_path=data/test.zarr')
            self.assertEqual(response.status_code, 200)
            
            # Test layers path with dataset_path
            response = self.client.get('/api/v1/data/progressive/layers/raw?dataset_path=data/test.zarr')
            self.assertEqual(response.status_code, 200)
            
            # Test obsp path with dataset_path
            response = self.client.get('/api/v1/data/progressive/obsp/connectivities?dataset_path=data/test.zarr')
            self.assertEqual(response.status_code, 200)
            
            # Test varp path with dataset_path
            response = self.client.get('/api/v1/data/progressive/varp/correlation?dataset_path=data/test.zarr')
            self.assertEqual(response.status_code, 200)
            
            # Test invalid path with dataset_path
            response = self.client.get('/api/v1/data/progressive/invalid?dataset_path=data/test.zarr')
            self.assertEqual(response.status_code, 200)

if __name__ == '__main__':
    unittest.main()
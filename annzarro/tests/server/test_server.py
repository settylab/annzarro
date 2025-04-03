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

    @patch('annzarro.data.manager.data_manager.load_dataset')
    @patch('annzarro.data.manager.data_manager.get_basic_info')
    def test_load_dataset(self, mock_get_basic_info, mock_load_dataset):
        """Test loading a dataset."""
        # Mock load success
        mock_load_dataset.return_value = True
        
        # Mock basic info
        mock_info = {
            "name": "Dataset 1",
            "path": "/data/dataset1.zarr",
            "shape": (100, 50),
            "n_obs": 100,
            "n_vars": 50
        }
        mock_get_basic_info.return_value = mock_info
        
        # Send request
        response = self.client.post('/api/v1/datasets/data/dataset1.zarr/load')
        
        # Check response
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertTrue(data['success'])
        self.assertEqual(data['info']['name'], 'Dataset 1')
        
        # Test failure case
        mock_load_dataset.return_value = False
        
        # Send request
        response = self.client.post('/api/v1/datasets/invalid/path/load')
        
        # Check response
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertFalse(data['success'])
        self.assertIn('error', data)

    @patch('annzarro.data.manager.data_manager.get_X')
    def test_get_X(self, mock_get_X):
        """Test getting X matrix data."""
        # Mock X data
        mock_data = np.array([[1.0, 2.0], [3.0, 4.0]])
        mock_get_X.return_value = mock_data
        
        # Send request with no indices
        response = self.client.get('/api/v1/data/X')
        
        # Check response
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('data', data)
        self.assertEqual(data['data'], [[1.0, 2.0], [3.0, 4.0]])
        
        # Send request with row indices
        response = self.client.get('/api/v1/data/X?rows=0,1')
        
        # Check response
        self.assertEqual(response.status_code, 200)
        
        # Verify mock was called correctly
        mock_get_X.assert_called_with([0, 1], None)
        
        # Send request with column indices
        response = self.client.get('/api/v1/data/X?cols=0,1')
        
        # Check response
        self.assertEqual(response.status_code, 200)
        
        # Verify mock was called correctly
        mock_get_X.assert_called_with(None, [0, 1])
        
        # Send request with both row and column indices
        response = self.client.get('/api/v1/data/X?rows=0,1&cols=0,1')
        
        # Check response
        self.assertEqual(response.status_code, 200)
        
        # Verify mock was called correctly
        mock_get_X.assert_called_with([0, 1], [0, 1])
        
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
        def mock_get_obs_func(column, indices):
            if column is None:
                return mock_all_data
            else:
                return mock_column_data
                
        mock_get_obs.side_effect = mock_get_obs_func
        
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
        mock_get_obs.assert_called_with(None, [0, 1])

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
        mock_set.assert_called_with(['cell_3', 'cell_4'])
        
        # Test POST - add operation
        response = self.client.post(
            '/api/v1/data/selection/cells',
            data=json.dumps({'cells': ['cell_5'], 'operation': 'add'}),
            content_type='application/json'
        )
        
        # Check response
        self.assertEqual(response.status_code, 200)
        
        # Verify mock was called correctly
        mock_add.assert_called_with(['cell_5'])
        
        # Test POST - remove operation
        response = self.client.post(
            '/api/v1/data/selection/cells',
            data=json.dumps({'cells': ['cell_1'], 'operation': 'remove'}),
            content_type='application/json'
        )
        
        # Check response
        self.assertEqual(response.status_code, 200)
        
        # Verify mock was called correctly
        mock_remove.assert_called_with(['cell_1'])
        
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

if __name__ == '__main__':
    unittest.main()
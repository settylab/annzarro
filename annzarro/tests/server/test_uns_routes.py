"""
Tests for the uns routes in the zarr API.
"""
import json
import unittest
from unittest.mock import patch, MagicMock
import numpy as np

# For tests we use absolute imports to ensure we're testing the installed package
from annzarro.server.core import create_app, DEFAULT_CONFIG

class TestUnsRoutes(unittest.TestCase):
    """Test cases for the uns routes."""

    def setUp(self):
        """Set up the test environment."""
        # Create and configure the app for testing
        self.app = create_app({
            'TESTING': True,
            'DEBUG': False,
            'data_dir': 'tests/data'
        })
        self.client = self.app.test_client()

    @patch('annzarro.core.zarr_reader.zarr_reader.open_dataset_by_path')
    def test_get_uns_structure(self, mock_open_dataset):
        """Test getting uns structure."""
        # Mock the dataset root and metadata
        mock_root = MagicMock()
        mock_metadata = {
            'shape': (100, 200),
            'has_uns': True
        }

        # Mock uns data
        mock_root['uns'] = {}
        mock_root['uns'].keys = MagicMock(return_value=['spatial', 'neighbors', 'pca'])
        
        # Set up the mock return value
        mock_open_dataset.return_value = (mock_root, mock_metadata)

        # Mock the get_uns_structure method
        mock_structure = {
            'spatial': {'encoding-type': 'dict'},
            'neighbors': {'encoding-type': 'dict'},
            'pca': {'encoding-type': 'array(float32)', 'shape': [50, 50]}
        }
        with patch('annzarro.core.zarr_reader.zarr_reader.get_uns_structure', return_value=mock_structure):
            # Make the request
            response = self.client.get('/api/v1/datasets/test_dataset.zarr/uns/structure')
            
            # Check the response
            self.assertEqual(response.status_code, 200)
            data = json.loads(response.data)
            
            # Verify the data
            self.assertEqual(data['dataset_path'], 'test_dataset.zarr')
            self.assertEqual(data['uns_structure'], mock_structure)

    @patch('annzarro.core.zarr_reader.zarr_reader.open_dataset_by_path')
    @patch('annzarro.core.zarr_reader.zarr_reader.get_uns')
    def test_get_uns_data(self, mock_get_uns, mock_open_dataset):
        """Test getting uns data."""
        # Mock the dataset root and metadata
        mock_root = MagicMock()
        mock_metadata = {
            'shape': (100, 200),
            'has_uns': True
        }
        
        # Set up the mock return value
        mock_open_dataset.return_value = (mock_root, mock_metadata)

        # Mock the get_uns method response
        mock_data = {
            'images': {'hires': np.zeros((100, 100, 3)).tolist()},
            'scalefactors': {'spot_diameter_fullres': 0.8}
        }
        mock_get_uns.return_value = mock_data
        
        # Make the request
        response = self.client.get('/api/v1/datasets/test_dataset.zarr/uns/spatial')
        
        # Check the response
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        
        # Verify the data
        self.assertEqual(data['dataset_path'], 'test_dataset.zarr')
        self.assertEqual(data['uns_key'], 'spatial')
        self.assertEqual(data['data'], mock_data)

    @patch('annzarro.core.zarr_reader.zarr_reader.open_dataset_by_path')
    @patch('annzarro.core.zarr_reader.zarr_reader.get_uns')
    def test_get_uns_data_missing_key(self, mock_get_uns, mock_open_dataset):
        """Test getting uns data with missing key."""
        # Mock the dataset root and metadata
        mock_root = MagicMock()
        mock_metadata = {
            'shape': (100, 200),
            'has_uns': True
        }
        
        # Set up the mock return value
        mock_open_dataset.return_value = (mock_root, mock_metadata)
        
        # Mock the get_uns method to return None (key not found)
        mock_get_uns.return_value = None

        # Make the request for a key that doesn't exist
        response = self.client.get('/api/v1/datasets/test_dataset.zarr/uns/missing_key')
        
        # Check the response - now we expect a 200 with data = None
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        
        # Verify the data
        self.assertEqual(data['dataset_path'], 'test_dataset.zarr')
        self.assertEqual(data['uns_key'], 'missing_key')
        self.assertEqual(data['data'], None)
        self.assertIn('message', data)
        self.assertIn('not found', data['message'])

    @patch('annzarro.core.zarr_reader.zarr_reader.open_dataset_by_path')
    def test_get_uns_data_no_uns(self, mock_open_dataset):
        """Test getting uns data when dataset has no uns."""
        # Mock the dataset root and metadata
        mock_root = MagicMock()
        mock_metadata = {
            'shape': (100, 200),
            'has_uns': False
        }
        
        # Set up the mock return value
        mock_open_dataset.return_value = (mock_root, mock_metadata)

        # Make the request
        response = self.client.get('/api/v1/datasets/test_dataset.zarr/uns/spatial')
        
        # Check the response
        self.assertEqual(response.status_code, 404)
        data = json.loads(response.data)
        
        # Verify the error
        self.assertIn('error', data)
        self.assertIn('does not have uns data', data['error'])

if __name__ == '__main__':
    unittest.main()
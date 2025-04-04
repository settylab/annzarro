"""
Tests for the Flask server.
"""
import json
import unittest
from unittest.mock import patch, MagicMock
import numpy as np
from flask import Flask

# Import from core instead of server directly
from annzarro.server.core import create_app, DEFAULT_CONFIG

class TestServer(unittest.TestCase):
    """Test cases for the Flask server."""

    def setUp(self):
        """Set up the test environment."""
        # Create and configure the app for testing
        self.app = create_app({
            'TESTING': True,
            'DEBUG': False,
            'data_dir': 'tests/data'
        })
        self.client = self.app.test_client()

    def test_get_config(self):
        """Test getting server configuration."""
        response = self.client.get('/api/v1/config')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('host', data)
        self.assertIn('port', data)
        self.assertIn('data_dir', data)

    def test_get_status(self):
        """Test getting server status."""
        response = self.client.get('/api/v1/status')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('server', data)
        self.assertIn('config', data)
        self.assertIn('resources', data)
        self.assertIn('data', data)

    @patch('annzarro.data.manager.data_manager.list_datasets')
    def test_list_datasets(self, mock_list_datasets):
        """Test listing datasets."""
        mock_list_datasets.return_value = [
            {
                'name': 'test_dataset',
                'path': 'tests/data/test_dataset.zarr',
                'size': '123 MB',
                'is_directory': True
            }
        ]
        response = self.client.get('/api/v1/datasets')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('datasets', data)
        self.assertEqual(len(data['datasets']), 1)
        self.assertEqual(data['datasets'][0]['name'], 'test_dataset')

if __name__ == '__main__':
    unittest.main()
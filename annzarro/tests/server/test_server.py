"""
Tests for the Flask server.
"""
import json
import unittest
from unittest.mock import patch, MagicMock
import numpy as np
from flask import Flask

# Import from core instead of server directly
# For tests we use absolute imports to ensure we're testing the installed package
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
        # an absolute server path; schema.yaml marks it internal (issue #32)
        self.assertNotIn('data_dir', data)

    def test_get_status(self):
        """Test getting server status."""
        response = self.client.get('/api/v1/status')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('server', data)
        self.assertIn('config', data)
        self.assertIn('resources', data)
        self.assertIn('data', data)

    def test_list_datasets(self):
        """/api/v1/datasets is the frontend's listing (a JSON list of stores).

        This test used to mock data_manager.list_datasets and expect
        {"datasets": [...]}; that shape belongs to /api/v1/core/datasets.
        """
        import os
        data_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data')
        app = create_app({'TESTING': True, 'DEBUG': False, 'data_dir': data_dir})
        response = app.test_client().get('/api/v1/datasets')
        self.assertEqual(response.status_code, 200)
        entries = {d['rel_path']: d for d in json.loads(response.data)}
        self.assertIn('fixture_small.zarr', entries)
        self.assertEqual(entries['fixture_small.zarr']['cells'], 200)
        self.assertEqual(entries['fixture_small.zarr']['genes'], 20)

if __name__ == '__main__':
    unittest.main()
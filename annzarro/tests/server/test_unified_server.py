"""
Unit tests for the unified server features.

These tests focus specifically on the new static file serving functionality
and configuration handling for the unified server approach.
"""
import os
import json
import unittest
import tempfile
from unittest.mock import patch, MagicMock
from io import BytesIO

from flask import Flask
from annzarro.server.core import create_app
from annzarro.server.routes.static_routes import register_static_routes

class TestUnifiedServerFeatures(unittest.TestCase):
    """Test specific features of the unified server approach."""
    
    @classmethod
    def setUpClass(cls):
        """Set up class-level test environment."""
        # Create a temporary directory for test files
        cls.temp_dir = tempfile.TemporaryDirectory()
        
        # Create some test files in the temp directory
        with open(os.path.join(cls.temp_dir.name, "index.html"), "w") as f:
            f.write("<html><body><h1>Test Index</h1></body></html>")
            
        with open(os.path.join(cls.temp_dir.name, "test.js"), "w") as f:
            f.write("console.log('Test JS file');")
            
        # Create a subdirectory
        os.makedirs(os.path.join(cls.temp_dir.name, "subdir"), exist_ok=True)
        
        with open(os.path.join(cls.temp_dir.name, "subdir", "sub.html"), "w") as f:
            f.write("<html><body><h1>Subdir Test</h1></body></html>")
    
    @classmethod
    def tearDownClass(cls):
        """Clean up after tests."""
        cls.temp_dir.cleanup()
    
    def setUp(self):
        """Set up the test environment."""
        # Create a test Flask app
        self.app = Flask(__name__)
        
        # Configure for testing
        self.app.config.update({
            'TESTING': True,
            'DEBUG': False,
            'static_dir': self.temp_dir.name,
            'data_dir': 'tests/data'
        })
        
        # Register static routes
        register_static_routes(self.app, "v1")
        
        # Create a test client
        self.client = self.app.test_client()
    
    def test_serve_index_html(self):
        """Test serving index.html when requesting root."""
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'Test Index', response.data)
    
    def test_serve_static_file(self):
        """Test serving a static file."""
        response = self.client.get('/test.js')
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Test JS file", response.data)
    
    def test_serve_subdirectory_index(self):
        """Test serving index.html when requesting a subdirectory."""
        response = self.client.get('/subdir')
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'Test Index', response.data)  # Should serve root index.html
    
    def test_serve_subdirectory_file(self):
        """Test serving a file in a subdirectory."""
        response = self.client.get('/subdir/sub.html')
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'Subdir Test', response.data)
    
    def test_serve_nonexistent_file(self):
        """Test serving a non-existent file (should serve index.html for SPA)."""
        response = self.client.get('/not_exist.html')
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'Test Index', response.data)  # Should serve index.html
    
    def test_skip_api_routes(self):
        """Test skipping API routes in static file handler."""
        # This should return 404 since the API route will be skipped by serve_static
        response = self.client.get('/api/v1/some_endpoint')
        self.assertEqual(response.status_code, 404)

class TestServerConfiguration(unittest.TestCase):
    """Test configuration handling for the unified server."""
    
    def test_config_precedence(self):
        """Test configuration precedence."""
        # Create an app with custom config
        with patch.dict(os.environ, {
            "ANNZARRO_PORT": "9000", 
            "ANNZARRO_DATA_DIR": "/env/data"
        }):
            # Config from parameters should override env variables
            app = create_app({
                "port": 8000,
                "data_dir": "/param/data"
            })
            
            self.assertEqual(app.config.get("port"), 8000)
            self.assertEqual(app.config.get("data_dir"), "/param/data")
    
    def test_default_config(self):
        """Test default configuration."""
        app = create_app()
        self.assertEqual(app.config.get("port"), 8000)
        self.assertEqual(app.config.get("host"), "127.0.0.1")
        self.assertEqual(app.config.get("data_dir"), "data")

if __name__ == '__main__':
    unittest.main()
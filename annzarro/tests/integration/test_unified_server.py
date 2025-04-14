"""
Integration tests for the unified server approach.

These tests verify that the unified server properly handles both API requests
and static file serving on a single port.
"""
import os
import json
import time
import unittest
import tempfile
import threading
import subprocess
import shutil
import requests
from pathlib import Path
from unittest.mock import patch, MagicMock

# For tests we use absolute imports to ensure we're testing the installed package
from annzarro.server.core import create_app
from annzarro.server.server import run_server

class TestUnifiedServerIntegration(unittest.TestCase):
    """Integration tests for the unified server approach."""
    
    @classmethod
    def setUpClass(cls):
        """Set up test environment for all tests."""
        # Create temp directory for test files
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.static_dir = os.path.join(cls.temp_dir.name, "static")
        cls.data_dir = os.path.join(cls.temp_dir.name, "data")
        
        # Create directories
        os.makedirs(cls.static_dir, exist_ok=True)
        os.makedirs(cls.data_dir, exist_ok=True)
        
        # Create test files
        with open(os.path.join(cls.static_dir, "index.html"), "w") as f:
            f.write("<html><body><h1>Test Unified Server</h1></body></html>")
            
        with open(os.path.join(cls.static_dir, "test.js"), "w") as f:
            f.write("console.log('Test JS file');")
        
        # Set an unused port for testing
        cls.port = 8123  # Try to use an unusual port to avoid conflicts
        
        # Start the server in a separate thread
        cls.server_thread = threading.Thread(
            target=run_server,
            kwargs={
                "port": cls.port,
                "host": "127.0.0.1",
                "data_dir": cls.data_dir,
                "static_dir": cls.static_dir,
                "debug": False
            }
        )
        cls.server_thread.daemon = True
        cls.server_thread.start()
        
        # Give server time to start up
        time.sleep(1)
        
    @classmethod
    def tearDownClass(cls):
        """Clean up after tests."""
        # Clean up temp directory
        cls.temp_dir.cleanup()
    
    def setUp(self):
        """Set up for each test."""
        # Base URL for requests
        self.base_url = f"http://127.0.0.1:{self.port}"
    
    def test_static_file_serving(self):
        """Test that static files are properly served."""
        response = requests.get(f"{self.base_url}/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("Test Unified Server", response.text)
        
        response = requests.get(f"{self.base_url}/test.js")
        self.assertEqual(response.status_code, 200)
        self.assertIn("Test JS file", response.text)
    
    def test_api_access(self):
        """Test that API endpoints are accessible."""
        response = requests.get(f"{self.base_url}/api/v1/config")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("host", data)
        self.assertIn("port", data)
        self.assertEqual(data["port"], self.port)
        
        response = requests.get(f"{self.base_url}/api/v1/status")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("server", data)
        self.assertIn("status", data["server"])
        self.assertEqual(data["server"]["status"], "running")
    
    def test_nonexistent_path(self):
        """Test that requests to nonexistent paths return index.html."""
        response = requests.get(f"{self.base_url}/nonexistent")
        self.assertEqual(response.status_code, 200)
        self.assertIn("Test Unified Server", response.text)
        
    def test_nonexistent_api_path(self):
        """Test that requests to nonexistent API paths return 404."""
        response = requests.get(f"{self.base_url}/api/v1/nonexistent")
        self.assertEqual(response.status_code, 404)
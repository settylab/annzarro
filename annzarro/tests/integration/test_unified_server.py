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

from werkzeug.serving import make_server

from annzarro.server.core import create_app


class TestUnifiedServerIntegration(unittest.TestCase):
    """Integration tests for the unified server approach.

    A real HTTP server on an OS-assigned port. This used to start run_server
    on the fixed port 8123, so two test runs at once (parallel worktrees, CI
    matrix on one host) talked to each other's servers; and it expected
    static_dir/index.html where the SPA shell is now the Jinja template.
    """

    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.static_dir = os.path.join(cls.temp_dir.name, "static")
        cls.data_dir = os.path.join(cls.temp_dir.name, "data")
        os.makedirs(cls.static_dir, exist_ok=True)
        os.makedirs(cls.data_dir, exist_ok=True)
        with open(os.path.join(cls.static_dir, "test.js"), "w") as f:
            f.write("console.log('Test JS file');")

        app = create_app({
            "host": "127.0.0.1",
            "debug": False,
            "auth_enabled": False,
            "data_dir": cls.data_dir,
            "static_dir": cls.static_dir,
        })
        cls.server = make_server("127.0.0.1", 0, app, threaded=True)
        cls.port = cls.server.server_port
        cls.server_thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()

    @classmethod
    def tearDownClass(cls):
        """Clean up after tests."""
        cls.server.shutdown()
        cls.temp_dir.cleanup()
    
    def setUp(self):
        """Set up for each test."""
        # Base URL for requests
        self.base_url = f"http://127.0.0.1:{self.port}"
    
    def test_static_file_serving(self):
        """Test that static files are properly served."""
        response = requests.get(f"{self.base_url}/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("<title>AnnZarro", response.text)
        
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
        self.assertIn("<title>AnnZarro", response.text)
        
    def test_nonexistent_api_path(self):
        """Test that requests to nonexistent API paths return 404."""
        response = requests.get(f"{self.base_url}/api/v1/nonexistent")
        self.assertEqual(response.status_code, 404)
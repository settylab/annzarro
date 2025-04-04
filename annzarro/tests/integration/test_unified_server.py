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

from annzarro.server.server import app, configure_app, run_server

class TestUnifiedServer(unittest.TestCase):
    """Test cases for the unified server approach."""

    @classmethod
    def setUpClass(cls):
        """Set up the test environment once before all tests."""
        # Create a temporary directory for test data
        cls.temp_dir = tempfile.mkdtemp()
        
        # Create a fake zarr dataset in the temp directory
        os.makedirs(os.path.join(cls.temp_dir, "test_dataset.zarr"), exist_ok=True)
        with open(os.path.join(cls.temp_dir, "test_dataset.zarr", ".zgroup"), "w") as f:
            f.write(json.dumps({"zarr_format": 2}))
            
        # Create a test config
        cls.config = {
            "host": "127.0.0.1",
            "port": 8765,  # Use a port unlikely to be in use
            "debug": False,
            "data_dir": cls.temp_dir,
            "unified_server": True
        }
        
        # Create test HTML file
        cls.static_dir = tempfile.mkdtemp()
        with open(os.path.join(cls.static_dir, "index.html"), "w") as f:
            f.write("<html><body><h1>Test Index</h1></body></html>")
        with open(os.path.join(cls.static_dir, "test.css"), "w") as f:
            f.write("body { color: black; }")
            
        # Start the server in a separate thread
        cls.server_thread = threading.Thread(
            target=cls._run_test_server,
            args=(cls.config, cls.static_dir),
            daemon=True
        )
        cls.server_thread.start()
        
        # Wait for the server to start
        time.sleep(2)
        
    @classmethod
    def tearDownClass(cls):
        """Clean up after all tests."""
        # Remove temporary directories
        shutil.rmtree(cls.temp_dir, ignore_errors=True)
        shutil.rmtree(cls.static_dir, ignore_errors=True)
        
        # No explicit server shutdown as the thread is daemon=True
        
    @classmethod
    def _run_test_server(cls, config, static_dir):
        """Run the test server with the given configuration."""
        # Configure app with test settings
        app.config.update(config)
        app.config.update({"static_dir": static_dir})
        
        try:
            app.run(
                host=config["host"],
                port=config["port"],
                debug=False,  # Always disable debug for testing
                use_reloader=False  # Disable reloader for testing
            )
        except Exception as e:
            print(f"Server error: {e}")
            
    def setUp(self):
        """Set up test client."""
        self.base_url = f"http://{self.config['host']}:{self.config['port']}"
        
    def test_static_file_serving(self):
        """Test that static files are served correctly."""
        # Test index.html
        response = requests.get(f"{self.base_url}/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("Test Index", response.text)
        
        # Test specific static file
        response = requests.get(f"{self.base_url}/test.css")
        self.assertEqual(response.status_code, 200)
        self.assertIn("body { color: black; }", response.text)
        
        # Test nonexistent file should serve index.html (client-side routing)
        response = requests.get(f"{self.base_url}/nonexistent")
        self.assertEqual(response.status_code, 200)
        self.assertIn("Test Index", response.text)
        
    def test_api_endpoints(self):
        """Test that API endpoints work correctly."""
        # Test API config endpoint
        response = requests.get(f"{self.base_url}/api/v1/config")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["port"], self.config["port"])
        self.assertEqual(data["data_dir"], self.config["data_dir"])
        
        # Test API datasets endpoint
        response = requests.get(f"{self.base_url}/api/v1/datasets")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("datasets", data)
        
    def test_api_vs_static_routing(self):
        """Test that API and static routing don't conflict."""
        # API routes should be handled by the API endpoints
        response = requests.get(f"{self.base_url}/api/v1/config")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(isinstance(response.json(), dict))
        
        # Non-API routes should be handled by static file serving
        response = requests.get(f"{self.base_url}/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("<html>", response.text)
        
        # API route that doesn't exist should return 404 with JSON
        response = requests.get(f"{self.base_url}/api/v1/nonexistent")
        self.assertEqual(response.status_code, 404)
        
class TestServerConfiguration(unittest.TestCase):
    """Test server configuration handling."""
    
    def setUp(self):
        """Set up the test environment."""
        # Create a test app
        self.app = app.test_client()
        self.app.testing = True
        
    def test_configure_app_with_defaults(self):
        """Test configuring app with default settings."""
        test_app = MagicMock()
        config = {}
        
        configure_app(test_app, config)
        # No assertions needed, just make sure it runs without errors
        
    def test_configure_app_with_cors(self):
        """Test configuring app with CORS enabled."""
        test_app = MagicMock()
        config = {"cors_enabled": True, "cors_origins": "*"}
        
        configure_app(test_app, config)
        # No assertions needed, just make sure it runs without errors
        
    def test_environment_variables(self):
        """Test environment variables override configuration."""
        with tempfile.NamedTemporaryFile(mode='w+', suffix='.json') as config_file:
            # Create a config file
            config = {
                "host": "localhost",
                "port": 8000,
                "data_dir": "/default/data/dir",
                "static_dir": "/default/static/dir"
            }
            json.dump(config, config_file)
            config_file.flush()
            
            # Set environment variables
            os.environ["ANNZARRO_DATA_DIR"] = "/env/data/dir"
            os.environ["ANNZARRO_PORT"] = "9999"
            os.environ["ANNZARRO_STATIC_DIR"] = "/env/static/dir"
            
            # Mock the Flask app run method
            with patch('flask.Flask.run') as mock_run:
                # Run the server
                run_server(config_file=config_file.name)
                
                # Check that the environment variables were used
                self.assertEqual(app.config["data_dir"], "/env/data/dir")
                self.assertEqual(app.config["port"], 9999)
                self.assertEqual(app.config["static_dir"], "/env/static/dir")
                
            # Clean up environment variables
            del os.environ["ANNZARRO_DATA_DIR"]
            del os.environ["ANNZARRO_PORT"]
            del os.environ["ANNZARRO_STATIC_DIR"]
            
class TestServerEndToEnd(unittest.TestCase):
    """End-to-end tests for the unified server."""
    
    def setUp(self):
        """Set up test environment."""
        # Create a temporary directory for test data and configuration
        self.test_dir = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.test_dir, "data"), exist_ok=True)
        
        # Create a test config file with a random port to avoid conflicts
        import random
        random_port = random.randint(10000, 19999)
        
        self.config_file = os.path.join(self.test_dir, "config.json")
        self.config = {
            "host": "127.0.0.1",
            "port": random_port,
            "debug": False,
            "data_dir": os.path.join(self.test_dir, "data"),
            "unified_server": True
        }
        with open(self.config_file, "w") as f:
            json.dump(self.config, f)
        
    def tearDown(self):
        """Clean up test environment."""
        shutil.rmtree(self.test_dir, ignore_errors=True)
        
    def test_server_startup_shutdown(self):
        """Test server startup and shutdown using subprocess."""
        # Start the server using subprocess
        server_process = None
        try:
            # Get the path to the server entry point
            server_script = Path(__file__).parent.parent.parent / "__main__.py"
            
            # Start the server as a subprocess
            cmd = ["python", "-m", "annzarro.server", 
                   "--config", self.config_file, 
                   "--port", str(self.config["port"])]
                   
            server_process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            
            # Wait for the server to start with retry logic
            max_retries = 5
            retry_delay = 1
            for attempt in range(max_retries):
                try:
                    print(f"Waiting for server to be available (attempt {attempt+1}/{max_retries})...")
                    response = requests.get(
                        f"http://{self.config['host']}:{self.config['port']}/api/v1/config",
                        timeout=2
                    )
                    if response.status_code == 200:
                        data = response.json()
                        self.assertEqual(data["port"], self.config["port"])
                        break
                except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
                    if attempt == max_retries - 1:
                        self.fail(f"Failed to connect to the server after {max_retries} attempts")
                    time.sleep(retry_delay)
                
        finally:
            # Clean up
            if server_process:
                server_process.terminate()
                try:
                    server_process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    server_process.kill()

if __name__ == "__main__":
    unittest.main()
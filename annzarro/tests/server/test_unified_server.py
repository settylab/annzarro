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
from annzarro.server.server import serve_static, configure_app, run_server, app

class TestUnifiedServerFeatures(unittest.TestCase):
    """Test specific features of the unified server approach."""
    
    @classmethod
    def setUpClass(cls):
        """Check if real data is available for testing."""
        # Check for aging.zarr dataset (may not be available in CI environments)
        cls.has_real_data = os.path.exists(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))), "data", "aging.zarr"))
        if cls.has_real_data:
            print("Found aging.zarr dataset - mouse hematopoiesis data will be used in tests")
        else:
            print("No aging.zarr dataset found - skipping real data tests")

    def setUp(self):
        """Set up the test environment."""
        # Create a test app with test client
        self.app = Flask(__name__)
        self.app.testing = True
        self.client = self.app.test_client()
        
        # Create a temporary directory for static files
        self.static_dir = tempfile.mkdtemp()
        
        # Create some test static files
        with open(os.path.join(self.static_dir, "index.html"), "w") as f:
            f.write("<html><body>Test Index</body></html>")
        
        with open(os.path.join(self.static_dir, "test.js"), "w") as f:
            f.write("console.log('test');")
            
        # Create a subdirectory with files
        os.makedirs(os.path.join(self.static_dir, "css"), exist_ok=True)
        with open(os.path.join(self.static_dir, "css", "style.css"), "w") as f:
            f.write("body { margin: 0; }")
            
        # Set static directory in app config
        self.app.config["static_dir"] = self.static_dir
            
    def tearDown(self):
        """Clean up test environment."""
        # Remove temporary directory
        import shutil
        shutil.rmtree(self.static_dir, ignore_errors=True)
        
    def test_serve_static_index(self):
        """Test serving the index.html file."""
        # Add the serve_static route to the test app
        self.app.route("/", defaults={"path": ""})(serve_static)
        self.app.route("/<path:path>")(serve_static)
        
        # Test the root path (should serve index.html)
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Test Index", response.data)
        
    def test_serve_static_files(self):
        """Test serving static files."""
        # Add the serve_static route to the test app
        self.app.route("/", defaults={"path": ""})(serve_static)
        self.app.route("/<path:path>")(serve_static)
        
        # Test a JavaScript file
        response = self.client.get("/test.js")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"console.log('test')", response.data)
        
        # Test a file in subdirectory
        response = self.client.get("/css/style.css")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"body { margin: 0; }", response.data)
        
    def test_serve_static_directory(self):
        """Test serving a directory path."""
        # Add the serve_static route to the test app
        self.app.route("/", defaults={"path": ""})(serve_static)
        self.app.route("/<path:path>")(serve_static)
        
        # Test a directory path (should serve index.html)
        response = self.client.get("/css")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Test Index", response.data)
        
    def test_serve_static_nonexistent(self):
        """Test serving a nonexistent file."""
        # Add the serve_static route to the test app
        self.app.route("/", defaults={"path": ""})(serve_static)
        self.app.route("/<path:path>")(serve_static)
        
        # Test a nonexistent file (should serve index.html for SPA routing)
        response = self.client.get("/nonexistent")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Test Index", response.data)
        
    def test_serve_static_api_path(self):
        """Test API path handling in serve_static."""
        # Add the serve_static route to the test app
        self.app.route("/", defaults={"path": ""})(serve_static)
        self.app.route("/<path:path>")(serve_static)
        
        # Test an API path - should return 404 as it's handled elsewhere
        response = self.client.get("/api/v1/config")
        self.assertEqual(response.status_code, 404)
        
    def test_serve_static_default_directory(self):
        """Test serving from default directory when static_dir is not set."""
        # Create a new app with no static_dir config
        test_app = Flask(__name__)
        test_app.testing = True
        test_client = test_app.test_client()
        
        # Add the serve_static route
        test_app.route("/", defaults={"path": ""})(serve_static)
        test_app.route("/<path:path>")(serve_static)
        
        # Mock os.path functions to avoid actual file system access
        with patch("os.path.exists") as mock_exists, \
             patch("os.path.isdir") as mock_isdir, \
             patch("os.path.isfile") as mock_isfile, \
             patch("os.path.abspath") as mock_abspath, \
             patch("flask.send_file") as mock_send_file:
            
            # Set up mock behavior
            mock_exists.return_value = True
            mock_isdir.return_value = False
            mock_isfile.return_value = True
            mock_abspath.side_effect = lambda x: x
            
            # Mock send_file to return a simple response
            mock_send_file.return_value = "index content"
            
            # Test root path
            response = test_client.get("/")
            mock_send_file.assert_called()
            
    def test_missing_file_error_handling(self):
        """Test error handling when serving a file fails."""
        # Add the serve_static route to the test app
        self.app.route("/", defaults={"path": ""})(serve_static)
        self.app.route("/<path:path>")(serve_static)
        
        # Mock send_from_directory to raise an exception
        with patch("flask.send_from_directory") as mock_send:
            mock_send.side_effect = Exception("Test error")
            
            # Create a file to trigger the send_from_directory call
            test_file = os.path.join(self.static_dir, "error_test.txt")
            with open(test_file, "w") as f:
                f.write("test content")
                
            # Test the file
            response = self.client.get("/error_test.txt")
            self.assertEqual(response.status_code, 500)
            response_data = json.loads(response.data)
            self.assertIn("error", response_data)
            
    def test_real_data_path_setup(self):
        """Test that real data path is correctly set up in the config."""
        # Skip test if no real data
        if not self.has_real_data:
            self.skipTest("No real data (aging.zarr) found in data directory")
            
        data_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))), "data")
        
        # Mock app.run to avoid actually starting the server
        with patch("flask.Flask.run") as mock_run:
            # Test with data_dir pointing to the real data directory
            run_server(data_dir=data_path)
            
            # Check that the data directory was correctly configured
            self.assertEqual(app.config["data_dir"], data_path)
            
            # Test that the files in this directory would be properly listed
            # by mocking the data_manager.list_datasets function
            with patch("annzarro.data.manager.data_manager.list_datasets") as mock_list:
                # Set up a mock implementation
                def mock_list_impl(path, recursive=False, follow_symlinks=False):
                    if path == data_path:
                        return [
                            {"name": "Aging Brain", "path": os.path.join(data_path, "aging.zarr"), "type": "zarr"},
                            {"name": "Linked Aging", "path": os.path.join(data_path, "linked_aging.zarr"), "type": "symlink"}
                        ]
                    return []
                    
                mock_list.side_effect = mock_list_impl
                
                # Configure a test client
                test_client = app.test_client()
                
                # Test the datasets endpoint
                response = test_client.get("/api/v1/datasets")
                self.assertEqual(response.status_code, 200)
                data = json.loads(response.data)
                self.assertIn("datasets", data)
                self.assertEqual(len(data["datasets"]), 2)
                self.assertIn("aging.zarr", data["datasets"][0]["path"])
            
class TestServerConfiguration(unittest.TestCase):
    """Test server configuration handling."""
    
    def test_run_server_config_precedence(self):
        """Test configuration precedence in run_server."""
        # Create a test config file
        with tempfile.NamedTemporaryFile(mode="w+", suffix=".json") as config_file:
            config = {
                "host": "config.example.com",
                "port": 8000,
                "debug": False,
                "data_dir": "/config/data",
                "static_dir": "/config/static"
            }
            json.dump(config, config_file)
            config_file.flush()
            
            # Mock app.run to avoid actually starting the server
            with patch("flask.Flask.run") as mock_run:
                # Test with command line parameters (highest priority)
                run_server(
                    config_file=config_file.name,
                    debug=True,
                    port=9000,
                    data_dir="/cmdline/data",
                    static_dir="/cmdline/static"
                )
                
                # Check that command line parameters were used
                self.assertEqual(app.config["debug"], True)
                self.assertEqual(app.config["port"], 9000)
                self.assertEqual(app.config["data_dir"], "/cmdline/data")
                self.assertEqual(app.config["static_dir"], "/cmdline/static")
                
                # Check that host from config file was used
                self.assertEqual(app.config["host"], "config.example.com")
                
                # Reset app config
                app.config.clear()
                
                # Test with environment variables (medium priority)
                with patch.dict(os.environ, {
                    "ANNZARRO_PORT": "8500",
                    "ANNZARRO_DATA_DIR": "/env/data",
                    "ANNZARRO_STATIC_DIR": "/env/static"
                }):
                    run_server(config_file=config_file.name)
                    
                    # Check that environment variables were used
                    self.assertEqual(app.config["port"], 8500)
                    self.assertEqual(app.config["data_dir"], "/env/data")
                    self.assertEqual(app.config["static_dir"], "/env/static")
                    
                    # Check that host from config file was used
                    self.assertEqual(app.config["host"], "config.example.com")
                
                # Reset app config
                app.config.clear()
                
                # Test with config file only
                run_server(config_file=config_file.name)
                
                # Check that config file values were used
                self.assertEqual(app.config["host"], "config.example.com")
                self.assertEqual(app.config["port"], 8000)
                self.assertEqual(app.config["data_dir"], "/config/data")
                self.assertEqual(app.config["static_dir"], "/config/static")
                
    def test_run_server_default_config(self):
        """Test default configuration values."""
        # Mock app.run to avoid actually starting the server
        with patch("flask.Flask.run") as mock_run:
            # No config file, no parameters
            run_server()
            
            # Check default values
            self.assertEqual(app.config["host"], "127.0.0.1")
            self.assertEqual(app.config["port"], 8000)
            self.assertEqual(app.config["data_dir"], "data")
            self.assertEqual(app.config["static_dir"], None)  # Will use repo root
            
    def test_static_directory_handling(self):
        """Test static directory path handling."""
        # Mock app.run to avoid actually starting the server
        with patch("flask.Flask.run") as mock_run, \
             patch("os.path.expanduser") as mock_expanduser, \
             patch("os.path.abspath") as mock_abspath:
            
            # Set up mocks
            mock_expanduser.side_effect = lambda x: x.replace("~", "/home/user")
            mock_abspath.side_effect = lambda x: f"/abs/{x}" if not x.startswith("/") else x
            
            # Test with relative path
            run_server(static_dir="relative/path")
            
            # Check that path was expanded and made absolute
            mock_expanduser.assert_called_with("relative/path")
            mock_abspath.assert_called()
            self.assertTrue(app.config["static_dir"].startswith("/abs/"))
            
            # Reset app config
            app.config.clear()
            
            # Test with path containing user directory
            run_server(static_dir="~/static/dir")
            
            # Check that user directory was expanded
            mock_expanduser.assert_called_with("~/static/dir")
            self.assertEqual(app.config["static_dir"], "/home/user/static/dir")
            
if __name__ == "__main__":
    unittest.main()
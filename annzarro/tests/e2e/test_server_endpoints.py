"""
End-to-end tests for server endpoints.

These tests require a running server and interact with it through HTTP requests.
"""

import os
import sys
import unittest
import requests
import json
import time
from pathlib import Path


class TestServerEndpoints(unittest.TestCase):
    """Test server endpoints using HTTP requests."""
    
    @classmethod
    def setUpClass(cls):
        """Set up test class."""
        # Get server URL from environment or use default
        cls.server_url = os.environ.get("ANNZARRO_TEST_SERVER_URL", "http://localhost:8000")
        
        # Check if real data is available for more informative output
        cls.has_real_data = os.path.exists(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))), "data", "aging.zarr"))
        if cls.has_real_data:
            print("✓ Found aging.zarr dataset (mouse hematopoiesis data) - will be used in tests")
        else:
            print("⚠️ No aging.zarr dataset found - this is normal in CI environments")
        
        # Wait for server to be available
        cls._wait_for_server()
    
    @classmethod
    def _wait_for_server(cls, max_retries=5, delay=1):
        """Wait for server to be available."""
        for i in range(max_retries):
            try:
                response = requests.get(f"{cls.server_url}/api/v1/config")
                if response.status_code == 200:
                    return True
            except requests.exceptions.ConnectionError:
                pass
                
            print(f"Waiting for server to be available (attempt {i+1}/{max_retries})...")
            time.sleep(delay)
            
        if i == max_retries - 1:
            raise Exception("Server not available after maximum retries")
    
    def test_api_config_endpoint(self):
        """Test the API config endpoint."""
        response = requests.get(f"{self.server_url}/api/v1/config")
        self.assertEqual(response.status_code, 200)
        
        # Parse response
        data = response.json()
        
        # Check that essential fields are present
        self.assertIn("host", data)
        self.assertIn("port", data)
        self.assertIn("data_dir", data)
    
    def test_api_datasets_endpoint(self):
        """Test the API datasets endpoint."""
        response = requests.get(f"{self.server_url}/api/v1/datasets")
        self.assertEqual(response.status_code, 200)
        
        # Parse response
        data = response.json()
        
        # Check that datasets field is present
        self.assertIn("datasets", data)
        
        # Should have at least one dataset (the sample.zarr)
        self.assertGreaterEqual(len(data["datasets"]), 1)
        
    def test_real_zarr_dataset(self):
        """Test loading a real zarr dataset from data directory."""
        # Skip test if real data is not available
        if not self.has_real_data:
            self.skipTest("aging.zarr dataset not found")
            
        # Test accessing a dataset via the stateless API
        dataset_path = "data/aging.zarr"
        response = requests.get(f"{self.server_url}/api/v1/datasets/{dataset_path}/info")
        self.assertEqual(response.status_code, 200)
        
        # Parse response
        data = response.json()
        
        # Basic assertions about the dataset
        self.assertEqual(data["path"], dataset_path)
        self.assertTrue(data["has_obs"])
        self.assertTrue(data["has_var"])
        
        # Get the actual columns first
        columns_response = requests.get(f"{self.server_url}/api/v1/datasets/{dataset_path}/info")
        self.assertEqual(columns_response.status_code, 200)
        info_data = columns_response.json()
        
        # Check for obs columns in dataset metadata
        if "obs_columns" in info_data and info_data["obs_columns"]:
            column_name = info_data["obs_columns"][0]  # Use first available column
            print(f"Testing with observation column: {column_name}")
            # Try to fetch the column data
            response = requests.get(f"{self.server_url}/api/v1/data/obs?dataset_path={dataset_path}&column={column_name}")
            self.assertEqual(response.status_code, 200)
            obs_data = response.json()
            self.assertIn("data", obs_data)
        
        # Test getting embedding data if available
        if "embeddings" in data and data["embeddings"]:
            embedding_key = data["embeddings"][0]
            response = requests.get(
                f"{self.server_url}/api/v1/data/obsm/{embedding_key}?dataset_path={dataset_path}&indices=0,1,2,3,4"
            )
            self.assertEqual(response.status_code, 200)
            embedding_data = response.json()
            self.assertIn("data", embedding_data)
    
    def test_static_file_serving(self):
        """Test static file serving."""
        # Test index.html
        response = requests.get(f"{self.server_url}/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("html", response.text.lower())
        
        # Test CSS file
        response = requests.get(f"{self.server_url}/css/styles.css")
        self.assertEqual(response.status_code, 200)
        self.assertIn("css", response.headers.get("Content-Type", ""))
        
        # Test JavaScript file
        response = requests.get(f"{self.server_url}/js/main.js")
        self.assertEqual(response.status_code, 200)
        self.assertIn("javascript", response.headers.get("Content-Type", ""))
    
    def test_nonexistent_api_endpoint(self):
        """Test accessing a nonexistent API endpoint."""
        response = requests.get(f"{self.server_url}/api/v1/nonexistent")
        self.assertEqual(response.status_code, 404)
    
    def test_client_side_routing(self):
        """Test client-side routing for nonexistent paths."""
        response = requests.get(f"{self.server_url}/nonexistent/path")
        self.assertEqual(response.status_code, 200)
        self.assertIn("html", response.text.lower())


if __name__ == "__main__":
    unittest.main()
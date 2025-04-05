#!/usr/bin/env python
"""
Test script to diagnose the issue with the uns endpoint.
"""
import requests
import json
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def test_uns_endpoint():
    """Test the /uns/ endpoint and diagnose any issues."""
    base_url = "http://localhost:8000"
    dataset_path = "data/aging.zarr"
    uns_key = "Age_colors"
    
    # First, check if the server is running
    try:
        response = requests.get(f"{base_url}/api/v1/health")
        logger.info(f"Server health check: {response.status_code}")
        if response.status_code != 200:
            logger.error(f"Server health check failed: {response.text}")
            return
    except requests.RequestException as e:
        logger.error(f"Server connection error: {e}")
        return
    
    # Check if the dataset exists by calling the info endpoint
    try:
        response = requests.get(f"{base_url}/api/v1/datasets/{dataset_path}/info")
        logger.info(f"Dataset info status: {response.status_code}")
        if response.status_code == 200:
            info = response.json()
            logger.info(f"Dataset has uns: {info.get('has_uns', False)}")
        else:
            logger.error(f"Failed to get dataset info: {response.text}")
            return
    except requests.RequestException as e:
        logger.error(f"Dataset info request error: {e}")
        return
    
    # Get the uns structure to see available keys
    try:
        response = requests.get(f"{base_url}/api/v1/datasets/{dataset_path}/uns/structure")
        logger.info(f"Uns structure status: {response.status_code}")
        if response.status_code == 200:
            structure = response.json()
            logger.info(f"Available uns keys: {list(structure.get('uns_structure', {}).keys())}")
        else:
            logger.error(f"Failed to get uns structure: {response.text}")
    except requests.RequestException as e:
        logger.error(f"Uns structure request error: {e}")
    
    # Test the target uns key endpoint
    try:
        # Use params to pass dataset_path to avoid URL encoding issues
        response = requests.get(
            f"{base_url}/api/v1/datasets/uns/{uns_key}",
            params={"dataset_path": dataset_path}
        )
        logger.info(f"Uns '{uns_key}' status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            logger.info(f"Uns data: {json.dumps(data, indent=2)}")
        else:
            logger.error(f"Failed to get uns data: {response.text}")
    except requests.RequestException as e:
        logger.error(f"Uns data request error: {e}")
    
    # Test without using params (original URL style that's failing)
    try:
        direct_url = f"{base_url}/api/v1/datasets/uns/{uns_key}?dataset_path={dataset_path}"
        logger.info(f"Testing direct URL: {direct_url}")
        response = requests.get(direct_url)
        logger.info(f"Direct URL status: {response.status_code}")
        if response.status_code != 200:
            logger.error(f"Direct URL failed: {response.text}")
    except requests.RequestException as e:
        logger.error(f"Direct URL request error: {e}")

if __name__ == "__main__":
    test_uns_endpoint()
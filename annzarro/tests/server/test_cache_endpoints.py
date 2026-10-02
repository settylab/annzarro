"""
Integration tests for cache-related API endpoints.
"""

import os
import tempfile
import pytest
import numpy as np
import zarr

from annzarro.tests import zarr_compat
import json
from flask import Flask
from flask.testing import FlaskClient

from annzarro.core import zarr_reader
from annzarro.server.core import create_app, DEFAULT_CONFIG
from annzarro.server.routes import register_zarr_routes


def create_test_zarr_dataset(path):
    """Create a minimal test zarr dataset."""
    # Create root group
    root = zarr_compat.open_group(path)
    
    # Add X matrix (main dataset)
    n_obs, n_vars = 50, 20
    zarr_compat.write_array(root, 'X', data=np.random.rand(n_obs, n_vars).astype(np.float32))
    
    return path


@pytest.fixture
def test_client():
    """Create a Flask test client with the cache endpoints registered."""
    # Create a test Flask app
    app = Flask(__name__)
    
    # Use test configuration
    test_config = DEFAULT_CONFIG.copy()
    test_config.update({
        "cache_enabled": True,
        "cache_memory_mb": 100,
        "cache_dataset_limit": 5,
    })
    app.config.update(test_config)
    
    # Configure zarr reader
    from annzarro.core import configure_zarr_reader
    configure_zarr_reader(test_config)
    
    # Register routes
    api_version = "v1"
    register_zarr_routes(app, api_version)
    
    # Create test client
    with app.test_client() as client:
        yield client


@pytest.fixture
def zarr_test_dataset():
    """Create a temporary test zarr dataset."""
    with tempfile.TemporaryDirectory() as temp_dir:
        path = os.path.join(temp_dir, 'test_dataset.zarr')
        create_test_zarr_dataset(path)
        yield path


def test_cache_info_endpoint(test_client):
    """Test the GET /api/v1/cache/info endpoint."""
    # Make request
    response = test_client.get('/api/v1/cache/info')
    
    # Check response
    assert response.status_code == 200
    data = json.loads(response.data)
    
    # The body is DatasetCache.get_cache_info() (annzarro/core/caching.py).
    for key in ("enabled", "memory_usage_mb", "max_memory_mb", "dataset_limit",
                "dataset_count", "datasets", "item_counts"):
        assert key in data, key
    assert set(data["item_counts"]) == {"matrix", "dataframe", "metadata", "total"}


# These two caught every exception as a skip and drove the removed
# load_zarr()/dataset-id API, so they skipped on every run and could not fail.

def _cache_key(path):
    import urllib.parse
    return f"path:{urllib.parse.quote(path, safe='')}:test_data"


def test_cache_reset_endpoint(test_client, zarr_test_dataset):
    """POST /api/v1/cache/reset empties the whole cache."""
    zarr_reader.open_dataset_by_path(dataset_path=zarr_test_dataset)
    zarr_reader._add_to_cache(_cache_key(zarr_test_dataset), np.random.rand(10, 10), 'matrix')
    assert zarr_reader.get_cache_info()["item_counts"]["total"] > 0

    response = test_client.post('/api/v1/cache/reset')

    assert response.status_code == 200
    data = json.loads(response.data)
    assert data["status"] == "success"
    assert data["cleared_all"] is True
    assert data["cache_types_cleared"]["matrix"] > 0
    info = zarr_reader.get_cache_info()
    assert info["item_counts"]["total"] == 0
    assert info["datasets"] == {}


def test_cache_reset_with_dataset_path(test_client):
    """POST /api/v1/cache/reset?dataset_path=X clears only X."""
    zarr_reader.clear_cache()
    zarr_reader._add_to_cache(_cache_key("/d/one.zarr"), np.random.rand(10, 10), 'matrix')
    zarr_reader._add_to_cache(_cache_key("/d/two.zarr"), np.random.rand(10, 10), 'matrix')

    response = test_client.post('/api/v1/cache/reset?dataset_path=/d/one.zarr')

    assert response.status_code == 200
    data = json.loads(response.data)
    assert data["status"] == "success"
    assert data["cleared"] is True
    assert data["items_removed"]["matrix"] == 1
    datasets = zarr_reader.get_cache_info()["datasets"]
    assert "/d/one.zarr" not in datasets
    assert datasets["/d/two.zarr"] == 1

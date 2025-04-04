"""
Tests for the modular server architecture.

This module contains tests for the refactored server architecture
with separate modules for core, data routes, zarr routes, and static routes.
"""

import os
import sys
import json
import pytest
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

from flask import Flask
from annzarro.server.core import create_app, configure_app, setup_logging
from annzarro.server.routes import (
    register_core_routes,
    register_data_routes,
    register_zarr_routes,
    register_static_routes
)

# Test fixtures
@pytest.fixture
def app():
    """Create a Flask app for testing."""
    app = Flask(__name__)
    app.config.update({
        "host": "127.0.0.1",
        "port": 8000,
        "debug": True,
        "data_dir": "tests/data",
        "static_dir": "."
    })
    return app

@pytest.fixture
def client(app):
    """Create a test client."""
    with app.test_client() as client:
        yield client

# Tests for server core
def test_create_app():
    """Test creating a Flask app with default config."""
    app = create_app()
    assert app is not None
    assert app.config.get("host") == "127.0.0.1"
    assert app.config.get("port") == 8000
    assert app.config.get("data_dir") == "data"

def test_create_app_with_config():
    """Test creating a Flask app with custom config."""
    config = {
        "host": "0.0.0.0",
        "port": 9000,
        "data_dir": "/tmp/data"
    }
    app = create_app(config)
    assert app is not None
    assert app.config.get("host") == "0.0.0.0"
    assert app.config.get("port") == 9000
    assert app.config.get("data_dir") == "/tmp/data"

@patch("logging.basicConfig")
def test_setup_logging(mock_basic_config):
    """Test setting up logging."""
    config = {
        "log_file": "test.log",
        "log_level": "DEBUG"
    }
    setup_logging(config)
    mock_basic_config.assert_called_once()

# Tests for routes registration
def test_register_core_routes(app):
    """Test registering core routes."""
    register_core_routes(app, "v1")
    routes = [rule.rule for rule in app.url_map.iter_rules()]
    assert "/api/v1/datasets" in routes
    assert "/api/v1/config" in routes
    assert "/api/v1/status" in routes

def test_register_data_routes(app):
    """Test registering data routes."""
    register_data_routes(app, "v1")
    routes = [rule.rule for rule in app.url_map.iter_rules()]
    assert "/api/v1/data/X" in routes
    assert "/api/v1/data/obs" in routes
    assert "/api/v1/data/var" in routes
    assert "/api/v1/data/layer/<path:layer_name>" in routes
    assert "/api/v1/data/obsm/<path:obsm_key>" in routes
    assert "/api/v1/data/varm/<path:varm_key>" in routes
    assert "/api/v1/data/obsp/<path:obsp_key>" in routes
    assert "/api/v1/data/varp/<path:varp_key>" in routes

def test_register_zarr_routes(app):
    """Test registering zarr routes."""
    register_zarr_routes(app, "v1")
    routes = [rule.rule for rule in app.url_map.iter_rules()]
    assert "/api/v1/datasets/<path:dataset_path>/info" in routes
    assert "/api/v1/zarr/to_anndata" in routes
    assert "/api/v1/zarr/url" in routes

def test_register_static_routes(app):
    """Test registering static routes."""
    register_static_routes(app, "v1")
    routes = [rule.rule for rule in app.url_map.iter_rules()]
    assert "/" in routes
    assert "/<path:path>" in routes

# Integration tests for full app
def test_full_app_creation():
    """Test creating a full app with all routes registered."""
    app = create_app()
    routes = [rule.rule for rule in app.url_map.iter_rules()]
    
    # Core routes
    assert "/api/v1/datasets" in routes
    assert "/api/v1/config" in routes
    assert "/api/v1/status" in routes
    
    # Data routes
    assert "/api/v1/data/X" in routes
    assert "/api/v1/data/obs" in routes
    assert "/api/v1/data/var" in routes
    
    # Zarr routes
    assert "/api/v1/datasets/<path:dataset_path>/info" in routes
    assert "/api/v1/zarr/to_anndata" in routes
    
    # Static routes
    assert "/" in routes
    assert "/<path:path>" in routes

@patch("annzarro.server.core.setup_logging")
def test_app_configuration(mock_setup_logging):
    """Test app configuration with environment variables."""
    with patch.dict(os.environ, {
        "ANNZARRO_HOST": "0.0.0.0",
        "ANNZARRO_PORT": "9000",
        "ANNZARRO_DATA_DIR": "/tmp/data",
        "ANNZARRO_DEBUG": "true"
    }):
        app = create_app()
        assert app.config.get("host") == "0.0.0.0"
        assert app.config.get("port") == 9000
        assert app.config.get("data_dir") == "/tmp/data"
        assert app.config.get("debug") is True
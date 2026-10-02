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
# For tests we use absolute imports to ensure we're testing the installed package
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

def test_setup_logging(tmp_path):
    """setup_logging installs file + console handlers at the configured level.

    It configures the root logger directly; it never called basicConfig, which
    is what this test used to assert.
    """
    import logging
    root = logging.getLogger("")
    saved_handlers, saved_level = root.handlers[:], root.level
    log_file = tmp_path / "test.log"
    try:
        setup_logging({"log_file": str(log_file), "log_level": "DEBUG"})
        assert root.level == logging.DEBUG
        files = [h for h in root.handlers if isinstance(h, logging.FileHandler)]
        assert [h.baseFilename for h in files] == [str(log_file)]
    finally:
        for h in root.handlers[:]:
            root.removeHandler(h)
            h.close()
        for h in saved_handlers:
            root.addHandler(h)
        root.setLevel(saved_level)

# Tests for routes registration
def test_register_core_routes(app):
    """Test registering core routes."""
    register_core_routes(app, "v1")
    routes = [rule.rule for rule in app.url_map.iter_rules()]
    assert "/api/v1/core/datasets" in routes
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

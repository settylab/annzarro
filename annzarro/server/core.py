"""
Core module for the Annzarro server.

This module contains core functionality for the Annzarro server,
including configuration, initialization, and routing.
"""

import os
import json
import logging
from pathlib import Path
from typing import Dict, Any, Optional

from flask import Flask
from flask_cors import CORS
from werkzeug.middleware.proxy_fix import ProxyFix

logger = logging.getLogger(__name__)

# Default configuration
DEFAULT_CONFIG = {
    "host": "127.0.0.1",
    "port": 8000,
    "debug": False,
    "cors_enabled": False,  # Not needed for unified server but kept for backward compatibility
    "cors_origins": "*",
    "https_enabled": False,
    "cert_file": None,
    "key_file": None,
    "data_dir": "data",
    "static_dir": None,  # Will default to project root directory
    "log_file": "annzarro_server.log",
    "log_level": "INFO",
    "auth_enabled": False,
    "user_file": "users.json",
    "unified_server": True,  # New flag to indicate we're using the unified server approach
    "max_response_elements": 1000000,  # Maximum number of elements in array responses
    "max_cells_per_request": 10000,    # Maximum number of cells in a single request
    "max_genes_per_request": 10000,    # Maximum number of genes in a single request
    "max_embedding_dims": 50           # Maximum number of dimensions in embedding requests
}

def create_app(config: Dict[str, Any] = None) -> Flask:
    """
    Create and configure the Flask application.
    
    Args:
        config: Optional configuration dictionary to override defaults
        
    Returns:
        Configured Flask application
    """
    # Create Flask app
    app = Flask(__name__)
    
    # Enable CORS by default for all routes - important during development
    CORS(app)
    
    # Set default configuration
    app.config.update(DEFAULT_CONFIG)
    
    # Check environment variables before applying provided config
    if os.environ.get("ANNZARRO_HOST"):
        app.config["host"] = os.environ.get("ANNZARRO_HOST")
    
    if os.environ.get("ANNZARRO_PORT"):
        try:
            app.config["port"] = int(os.environ.get("ANNZARRO_PORT"))
        except ValueError:
            logger.warning(f"Invalid port in environment variable: {os.environ.get('ANNZARRO_PORT')}")
    
    if os.environ.get("ANNZARRO_DATA_DIR"):
        app.config["data_dir"] = os.environ.get("ANNZARRO_DATA_DIR")
    
    if os.environ.get("ANNZARRO_STATIC_DIR"):
        app.config["static_dir"] = os.environ.get("ANNZARRO_STATIC_DIR")
    
    if os.environ.get("ANNZARRO_DEBUG"):
        app.config["debug"] = os.environ.get("ANNZARRO_DEBUG").lower() in ("true", "1", "yes")
    
    # Update with provided config if any (allowing it to override environment variables)
    if config:
        app.config.update(config)
    
    # Configure the app
    configure_app(app, app.config)
    
    # Setup logging
    setup_logging(app.config)
    
    # Set up routes
    register_routes(app)
    
    return app

def configure_app(app: Flask, config: Dict[str, Any]) -> None:
    """
    Configure the Flask app with the given config.
    
    Args:
        app: Flask application instance
        config: Configuration dictionary
    """
    # Enable CORS if configured
    if config.get("cors_enabled", False):
        CORS(app, resources={r"/api/*": {"origins": config.get("cors_origins", "*")}})
    
    # Enable proxy fix if needed
    if config.get("proxy_count", 0) > 0:
        app.wsgi_app = ProxyFix(
            app.wsgi_app,
            x_for=config.get("proxy_count", 0),
            x_proto=config.get("proxy_count", 0),
            x_host=config.get("proxy_count", 0)
        )

def setup_logging(config: Dict[str, Any]) -> None:
    """
    Set up logging configuration.
    
    Args:
        config: Configuration dictionary
    """
    log_file = config.get("log_file", "annzarro_server.log")
    log_level_str = config.get("log_level", "INFO")
    
    # Convert string log level to numeric value
    log_level = getattr(logging, log_level_str.upper(), logging.INFO)
    
    # Create logs directory if it doesn't exist
    log_dir = os.path.dirname(log_file)
    if log_dir and not os.path.exists(log_dir):
        os.makedirs(log_dir)
    
    # Configure logging
    logging.basicConfig(
        filename=log_file,
        level=log_level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )
    
    # Add console handler
    console = logging.StreamHandler()
    console.setLevel(log_level)
    console.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s"))
    logging.getLogger("").addHandler(console)

def register_routes(app: Flask) -> None:
    """
    Register all routes with the Flask app.
    
    Args:
        app: Flask application instance
    """
    # Import route modules here to avoid circular imports
    from annzarro.server.routes import (
        register_core_routes,
        register_data_routes,
        register_zarr_routes, 
        register_static_routes
    )
    
    # API version
    api_version = "v1"
    
    # Register routes from each module
    register_core_routes(app, api_version)
    register_data_routes(app, api_version)
    register_zarr_routes(app, api_version)
    register_static_routes(app, api_version)
    
    logger.info(f"Registered all routes for API version {api_version}")

def load_config_from_file(config_file: str) -> Dict[str, Any]:
    """
    Load configuration from a JSON file.
    
    Args:
        config_file: Path to the configuration file
        
    Returns:
        Configuration dictionary
    """
    try:
        with open(config_file, 'r') as f:
            config = json.load(f)
        return config
    except Exception as e:
        logger.error(f"Error loading config file {config_file}: {e}")
        return {}
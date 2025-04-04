"""
Unified Server module for Annzarro

This module provides a Flask-based web server for the Annzarro application.
It serves both the web UI static content and the API endpoints for data access
through a single unified server on one port.
"""

import os
import json
import logging
from pathlib import Path
from typing import Dict, Any, Optional

from flask import Flask

from annzarro.server.core import create_app, DEFAULT_CONFIG, load_config_from_file

# Set up logging
logger = logging.getLogger(__name__)

def run_server(
    config_file: Optional[str] = None,
    config: Optional[Dict[str, Any]] = None,
    debug: Optional[bool] = None,
    port: Optional[int] = None,
    host: Optional[str] = None,
    data_dir: Optional[str] = None,
    static_dir: Optional[str] = None
) -> None:
    """
    Run the Annzarro server.
    
    Args:
        config_file: Path to configuration file (optional)
        config: Configuration dictionary (optional)
        debug: Enable debug mode (optional)
        port: Port to run the server on (optional)
        host: Host to bind to (optional)
        data_dir: Directory to use for data storage (optional)
        static_dir: Directory containing static files (optional)
    """
    # Initialize configuration
    final_config = DEFAULT_CONFIG.copy()
    
    # Load config from file if provided
    if config_file:
        file_config = load_config_from_file(config_file)
        final_config.update(file_config)
    
    # Update with provided config dictionary
    if config:
        final_config.update(config)
    
    # Environment variables are now applied directly in create_app
    
    # Override with function parameters
    if host:
        final_config["host"] = host
    
    if port:
        final_config["port"] = port
    
    if debug is not None:
        final_config["debug"] = debug
    
    if data_dir:
        final_config["data_dir"] = data_dir
    
    if static_dir:
        final_config["static_dir"] = static_dir
    
    # Create and configure the Flask app
    app = create_app(final_config)
    
    # Ensure data directory exists
    os.makedirs(final_config["data_dir"], exist_ok=True)
    
    # Log configuration
    logger.info(f"Starting Annzarro server on {final_config['host']}:{final_config['port']}")
    logger.info(f"Data directory: {final_config['data_dir']}")
    logger.info(f"Static directory: {final_config.get('static_dir', 'project root')}")
    logger.info(f"Debug mode: {final_config['debug']}")
    
    # Run the server
    app.run(
        host=final_config["host"],
        port=final_config["port"],
        debug=final_config["debug"],
        threaded=True
    )
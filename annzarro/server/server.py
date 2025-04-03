"""
Server module for Annzarro

This module provides a Flask-based web server for the Annzarro application.
It serves both the web UI and the API endpoints for data access.
"""

import os
import json
import logging
import tempfile
from pathlib import Path
from typing import Dict, Any, Optional, List, Union

from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
from werkzeug.middleware.proxy_fix import ProxyFix

from annzarro.data.manager import data_manager
from annzarro.core.zarr_reader import zarr_reader

# Set up logging
logger = logging.getLogger(__name__)

# Create Flask app
app = Flask(__name__)

# Default config
DEFAULT_CONFIG = {
    "host": "127.0.0.1",
    "port": 8000,
    "debug": False,
    "cors_enabled": False,
    "cors_origins": "*",
    "https_enabled": False,
    "cert_file": None,
    "key_file": None,
    "data_dir": "data",
    "static_dir": None,
    "log_file": "annzarro_server.log",
    "log_level": "INFO",
    "auth_enabled": False,
    "user_file": "users.json"
}

# API version
API_VERSION = "v1"

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

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_static(path: str):
    """
    Serve static files for the web UI.
    
    Args:
        path: Path to the requested file
        
    Returns:
        Flask response
    """
    # Get static directory from config
    static_dir = app.config.get("static_dir")
    
    if not static_dir:
        # Use repository root as default
        static_dir = Path(__file__).resolve().parent.parent.parent
    
    # If path is empty or a directory, serve index.html
    if not path or os.path.isdir(os.path.join(static_dir, path)):
        return send_file(os.path.join(static_dir, "index.html"))
    
    # Otherwise serve the requested file
    return send_from_directory(static_dir, path)

@app.route(f"/api/{API_VERSION}/datasets", methods=["GET"])
def list_datasets():
    """
    List available datasets.
    
    Returns:
        JSON response with dataset list
    """
    # Get data directory from config
    data_dir = app.config.get("data_dir", "data")
    
    # Override from query parameter if provided
    if "dir" in request.args:
        data_dir = request.args.get("dir")
    
    # List datasets
    datasets = data_manager.list_datasets(data_dir)
    
    return jsonify({"datasets": datasets})

@app.route(f"/api/{API_VERSION}/datasets/<path:dataset_path>", methods=["GET"])
def get_dataset_info(dataset_path: str):
    """
    Get information about a dataset.
    
    Args:
        dataset_path: Path to the dataset
        
    Returns:
        JSON response with dataset information
    """
    # Get dataset info
    info = data_manager.get_dataset_info(dataset_path)
    
    return jsonify(info)

@app.route(f"/api/{API_VERSION}/datasets/<path:dataset_path>/load", methods=["POST"])
def load_dataset(dataset_path: str):
    """
    Load a dataset.
    
    Args:
        dataset_path: Path to the dataset
        
    Returns:
        JSON response with success status
    """
    # Load dataset
    success = data_manager.load_dataset(dataset_path)
    
    if success:
        # Get basic info
        info = data_manager.get_basic_info()
        return jsonify({"success": True, "info": info})
    else:
        return jsonify({"success": False, "error": "Failed to load dataset"})

@app.route(f"/api/{API_VERSION}/data/info", methods=["GET"])
def get_data_info():
    """
    Get information about the currently loaded dataset.
    
    Returns:
        JSON response with dataset information
    """
    # Get basic info
    info = data_manager.get_basic_info()
    
    return jsonify(info)

@app.route(f"/api/{API_VERSION}/data/obs", methods=["GET"])
def get_obs():
    """
    Get observation annotations.
    
    Returns:
        JSON response with observation data
    """
    # Get parameters
    column = request.args.get("column")
    indices_str = request.args.get("indices")
    
    # Parse indices if provided
    indices = None
    if indices_str:
        try:
            indices = [int(i) for i in indices_str.split(",")]
        except ValueError:
            return jsonify({"error": "Invalid indices format"})
    
    # Get data
    data = data_manager.get_obs(column, indices)
    
    # Convert to JSON-serializable format
    if isinstance(data, dict):
        # For dictionary result (all columns)
        result = {}
        for key, value in data.items():
            if hasattr(value, "tolist"):
                result[key] = value.tolist()
            else:
                result[key] = value
    else:
        # For array result (single column)
        if hasattr(data, "tolist"):
            result = data.tolist()
        else:
            result = data
    
    return jsonify({"data": result})

@app.route(f"/api/{API_VERSION}/data/var", methods=["GET"])
def get_var():
    """
    Get variable annotations.
    
    Returns:
        JSON response with variable data
    """
    # Get parameters
    column = request.args.get("column")
    indices_str = request.args.get("indices")
    
    # Parse indices if provided
    indices = None
    if indices_str:
        try:
            indices = [int(i) for i in indices_str.split(",")]
        except ValueError:
            return jsonify({"error": "Invalid indices format"})
    
    # Get data
    data = data_manager.get_var(column, indices)
    
    # Convert to JSON-serializable format
    if isinstance(data, dict):
        # For dictionary result (all columns)
        result = {}
        for key, value in data.items():
            if hasattr(value, "tolist"):
                result[key] = value.tolist()
            else:
                result[key] = value
    else:
        # For array result (single column)
        if hasattr(data, "tolist"):
            result = data.tolist()
        else:
            result = data
    
    return jsonify({"data": result})

@app.route(f"/api/{API_VERSION}/data/X", methods=["GET"])
def get_X():
    """
    Get X matrix data.
    
    Returns:
        JSON response with X matrix data
    """
    # Get parameters
    row_indices_str = request.args.get("rows")
    col_indices_str = request.args.get("cols")
    
    # Parse indices if provided
    row_indices = None
    if row_indices_str:
        try:
            row_indices = [int(i) for i in row_indices_str.split(",")]
        except ValueError:
            return jsonify({"error": "Invalid row indices format"})
    
    col_indices = None
    if col_indices_str:
        try:
            col_indices = [int(i) for i in col_indices_str.split(",")]
        except ValueError:
            return jsonify({"error": "Invalid column indices format"})
    
    # Get data
    data = data_manager.get_X(row_indices, col_indices)
    
    # Convert to JSON-serializable format
    if hasattr(data, "tolist"):
        result = data.tolist()
    else:
        result = data
    
    return jsonify({"data": result})

@app.route(f"/api/{API_VERSION}/data/layer/<layer_name>", methods=["GET"])
def get_layer(layer_name: str):
    """
    Get layer data.
    
    Args:
        layer_name: Name of the layer
        
    Returns:
        JSON response with layer data
    """
    # Get parameters
    row_indices_str = request.args.get("rows")
    col_indices_str = request.args.get("cols")
    
    # Parse indices if provided
    row_indices = None
    if row_indices_str:
        try:
            row_indices = [int(i) for i in row_indices_str.split(",")]
        except ValueError:
            return jsonify({"error": "Invalid row indices format"})
    
    col_indices = None
    if col_indices_str:
        try:
            col_indices = [int(i) for i in col_indices_str.split(",")]
        except ValueError:
            return jsonify({"error": "Invalid column indices format"})
    
    # Get data
    data = data_manager.get_layer(layer_name, row_indices, col_indices)
    
    # Convert to JSON-serializable format
    if hasattr(data, "tolist"):
        result = data.tolist()
    else:
        result = data
    
    return jsonify({"data": result})

@app.route(f"/api/{API_VERSION}/data/obsm/<obsm_key>", methods=["GET"])
def get_obsm(obsm_key: str):
    """
    Get obsm data.
    
    Args:
        obsm_key: Key of the obsm entry
        
    Returns:
        JSON response with obsm data
    """
    # Get parameters
    indices_str = request.args.get("indices")
    
    # Parse indices if provided
    indices = None
    if indices_str:
        try:
            indices = [int(i) for i in indices_str.split(",")]
        except ValueError:
            return jsonify({"error": "Invalid indices format"})
    
    # Get data
    data = data_manager.get_obsm(obsm_key, indices)
    
    # Convert to JSON-serializable format
    if hasattr(data, "tolist"):
        result = data.tolist()
    else:
        result = data
    
    return jsonify({"data": result})

@app.route(f"/api/{API_VERSION}/data/cells", methods=["GET"])
def get_cells():
    """
    Get cell names.
    
    Returns:
        JSON response with cell names
    """
    # Get cell names
    cells = data_manager.get_obs_names()
    
    return jsonify({"cells": cells})

@app.route(f"/api/{API_VERSION}/data/genes", methods=["GET"])
def get_genes():
    """
    Get gene names.
    
    Returns:
        JSON response with gene names
    """
    # Get gene names
    genes = data_manager.get_var_names()
    
    return jsonify({"genes": genes})

@app.route(f"/api/{API_VERSION}/data/selection/cells", methods=["GET", "POST", "DELETE"])
def handle_cell_selection():
    """
    Handle cell selection operations.
    
    GET: Get the currently selected cells
    POST: Add or set selected cells
    DELETE: Remove or clear selected cells
    
    Returns:
        JSON response with selected cells
    """
    if request.method == "GET":
        # Get selected cells
        cells = list(data_manager.get_selected_cells())
        return jsonify({"selected_cells": cells})
        
    elif request.method == "POST":
        # Get request data
        data = request.get_json()
        cells = data.get("cells", [])
        operation = data.get("operation", "set")  # "set", "add", or "remove"
        
        # Perform the requested operation
        if operation == "set":
            data_manager.set_selected_cells(cells)
        elif operation == "add":
            data_manager.add_selected_cells(cells)
        elif operation == "remove":
            data_manager.remove_selected_cells(cells)
        else:
            return jsonify({"error": f"Invalid operation: {operation}"})
        
        # Return the updated selection
        cells = list(data_manager.get_selected_cells())
        return jsonify({"selected_cells": cells})
        
    elif request.method == "DELETE":
        # Clear selection
        data_manager.clear_selected_cells()
        return jsonify({"selected_cells": []})

@app.route(f"/api/{API_VERSION}/data/selection/genes", methods=["GET", "POST", "DELETE"])
def handle_gene_selection():
    """
    Handle gene selection operations.
    
    GET: Get the currently selected genes
    POST: Add or set selected genes
    DELETE: Remove or clear selected genes
    
    Returns:
        JSON response with selected genes
    """
    if request.method == "GET":
        # Get selected genes
        genes = list(data_manager.get_selected_genes())
        return jsonify({"selected_genes": genes})
        
    elif request.method == "POST":
        # Get request data
        data = request.get_json()
        genes = data.get("genes", [])
        operation = data.get("operation", "set")  # "set", "add", or "remove"
        
        # Perform the requested operation
        if operation == "set":
            data_manager.set_selected_genes(genes)
        elif operation == "add":
            data_manager.add_selected_genes(genes)
        elif operation == "remove":
            data_manager.remove_selected_genes(genes)
        else:
            return jsonify({"error": f"Invalid operation: {operation}"})
        
        # Return the updated selection
        genes = list(data_manager.get_selected_genes())
        return jsonify({"selected_genes": genes})
        
    elif request.method == "DELETE":
        # Clear selection
        data_manager.clear_selected_genes()
        return jsonify({"selected_genes": []})

@app.route(f"/api/{API_VERSION}/data/focus/cell", methods=["GET", "POST", "DELETE"])
def handle_cell_focus():
    """
    Handle cell focus operations.
    
    GET: Get the currently focused cell
    POST: Set the focused cell
    DELETE: Clear the focused cell
    
    Returns:
        JSON response with focused cell
    """
    if request.method == "GET":
        # Get focused cell
        cell = data_manager.get_focused_cell()
        return jsonify({"focused_cell": cell})
        
    elif request.method == "POST":
        # Get request data
        data = request.get_json()
        cell = data.get("cell")
        
        # Set focused cell
        data_manager.set_focused_cell(cell)
        
        return jsonify({"focused_cell": cell})
        
    elif request.method == "DELETE":
        # Clear focused cell
        data_manager.set_focused_cell(None)
        return jsonify({"focused_cell": None})

@app.route(f"/api/{API_VERSION}/data/focus/gene", methods=["GET", "POST", "DELETE"])
def handle_gene_focus():
    """
    Handle gene focus operations.
    
    GET: Get the currently focused gene
    POST: Set the focused gene
    DELETE: Clear the focused gene
    
    Returns:
        JSON response with focused gene
    """
    if request.method == "GET":
        # Get focused gene
        gene = data_manager.get_focused_gene()
        return jsonify({"focused_gene": gene})
        
    elif request.method == "POST":
        # Get request data
        data = request.get_json()
        gene = data.get("gene")
        
        # Set focused gene
        data_manager.set_focused_gene(gene)
        
        return jsonify({"focused_gene": gene})
        
    elif request.method == "DELETE":
        # Clear focused gene
        data_manager.set_focused_gene(None)
        return jsonify({"focused_gene": None})

def run_server(config_file: Optional[str] = None, 
              debug: bool = False, 
              port: Optional[int] = None) -> None:
    """
    Run the Annzarro server.
    
    Args:
        config_file: Path to the configuration file
        debug: Whether to run in debug mode
        port: Port to run the server on (overrides config)
    """
    # Load configuration
    config = dict(DEFAULT_CONFIG)
    
    if config_file:
        try:
            with open(config_file, "r") as f:
                config.update(json.load(f))
        except Exception as e:
            logger.error(f"Error loading config file: {e}")
    
    # Override config with function parameters
    if debug:
        config["debug"] = True
    if port:
        config["port"] = port
    
    # Set up logging
    setup_logging(config)
    
    # Configure Flask app
    app.config.update(config)
    configure_app(app, config)
    
    # Run the server
    ssl_context = None
    if config.get("https_enabled", False):
        cert_file = config.get("cert_file")
        key_file = config.get("key_file")
        
        if cert_file and key_file:
            ssl_context = (cert_file, key_file)
        else:
            ssl_context = "adhoc"
    
    # Log startup message
    logger.info(f"Starting Annzarro server on {config['host']}:{config['port']}")
    
    # Run Flask app
    app.run(
        host=config["host"],
        port=config["port"],
        debug=config["debug"],
        ssl_context=ssl_context
    )

if __name__ == "__main__":
    run_server()
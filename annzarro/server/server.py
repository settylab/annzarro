"""
Unified Server module for Annzarro

This module provides a Flask-based web server for the Annzarro application.
It serves both the web UI static content and the API endpoints for data access
through a single unified server on one port.
"""

import os
import json
import logging
import tempfile
import time
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

# Enable CORS by default for all routes - important during development
CORS(app)

# Default config
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
    "max_response_elements": 1000000,  # Maximum number of elements in array responses (can be increased for large datasets)
    "max_cells_per_request": 10000,    # Maximum number of cells in a single request
    "max_genes_per_request": 10000,    # Maximum number of genes in a single request
    "max_embedding_dims": 50           # Maximum number of dimensions in embedding requests
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
    
    This function handles all non-API routes and serves static files from the configured
    static directory or the repository root by default. It makes the Flask server act 
    as both an API server and a static file server, eliminating the need for a separate
    frontend server.
    
    Args:
        path: Path to the requested file
        
    Returns:
        Flask response
    """
    # Skip API routes - they will be handled by the API endpoints
    if path.startswith(f"api/{API_VERSION}") or path.startswith(f"api"):
        return {"error": "Not found"}, 404
    
    # Get static directory from config
    static_dir = app.config.get("static_dir")
    
    if not static_dir:
        # Use repository root as default
        static_dir = Path(__file__).resolve().parent.parent.parent
    
    # Normalize the path
    static_dir = os.path.abspath(static_dir)
    logger.debug(f"Serving static content from: {static_dir}")
    
    # If path is empty or a directory, serve index.html
    full_path = os.path.join(static_dir, path)
    if not path or (os.path.exists(full_path) and os.path.isdir(full_path)):
        index_path = os.path.join(static_dir, "index.html")
        logger.debug(f"Serving index.html from: {index_path}")
        return send_file(index_path)
    
    # Check if the file exists
    if os.path.exists(full_path) and os.path.isfile(full_path):
        logger.debug(f"Serving file: {full_path}")
        try:
            return send_from_directory(static_dir, path)
        except Exception as e:
            logger.error(f"Error serving file {path}: {e}")
            return {"error": "Error serving file"}, 500
    else:
        # File not found - for single page apps, return index.html for client-side routing
        logger.debug(f"File not found: {full_path}, serving index.html for client-side routing")
        return send_file(os.path.join(static_dir, "index.html"))

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
        
        # Handle "." as current directory by converting to os.getcwd()
        if data_dir == ".":
            data_dir = os.getcwd()
    
    # Add option to scan recursively
    recursive = request.args.get("recursive", "true").lower() == "true"
    
    # Add option to follow symlinks
    follow_symlinks = request.args.get("follow_symlinks", "true").lower() == "true"
    
    # List datasets with new options
    datasets = data_manager.list_datasets(data_dir, recursive=recursive, follow_symlinks=follow_symlinks)
    
    return jsonify({"datasets": datasets})

@app.route(f"/api/{API_VERSION}/config", methods=["GET"])
def get_config():
    """
    Get server configuration.
    
    Returns:
        JSON response with configuration (limited to what clients need to know)
    """
    # Only return necessary configuration
    client_config = {
        "host": app.config.get("host", DEFAULT_CONFIG["host"]),
        "port": app.config.get("port", DEFAULT_CONFIG["port"]),
        "data_dir": app.config.get("data_dir", DEFAULT_CONFIG["data_dir"])
    }
    
    return jsonify(client_config)
    
@app.route(f"/api/{API_VERSION}/status", methods=["GET"])
def get_status():
    """
    Get server status information.
    
    Returns:
        JSON response with server status information
    """
    import os
    import psutil
    import time
    import platform
    from datetime import datetime, timedelta
    
    try:
        # Get process information
        process = psutil.Process(os.getpid())
        
        # Calculate uptime
        start_time = datetime.fromtimestamp(process.create_time())
        uptime = datetime.now() - start_time
        
        # Format uptime
        days, remainder = divmod(uptime.total_seconds(), 86400)
        hours, remainder = divmod(remainder, 3600)
        minutes, seconds = divmod(remainder, 60)
        uptime_str = f"{int(days)}d {int(hours)}h {int(minutes)}m {int(seconds)}s"
        
        # Get memory usage
        memory_info = process.memory_info()
        memory_usage_mb = memory_info.rss / (1024 * 1024)  # Convert to MB
        
        # Get load information
        cpu_load = process.cpu_percent(interval=0.1)
        system_load = psutil.cpu_percent(interval=0.1)
        
        # Get connection count
        connections_count = len(process.connections())
        
        # Check data directory
        data_dir = app.config.get("data_dir", DEFAULT_CONFIG["data_dir"])
        data_dir_exists = os.path.exists(data_dir)
        data_dir_is_readable = os.access(data_dir, os.R_OK)
        data_dir_is_writable = os.access(data_dir, os.W_OK)
        
        # Count files in data directory
        zarr_count = 0
        if data_dir_exists and data_dir_is_readable:
            for root, dirs, files in os.walk(data_dir):
                if '.zgroup' in files:
                    zarr_count += 1
        
        # Get version from the package
        try:
            from annzarro import __version__
            version = __version__
        except ImportError:
            version = "0.1.0"  # Fallback version
            
        # Build status information
        status = {
            "server": {
                "status": "running",
                "version": version,
                "start_time": start_time.isoformat(),
                "uptime": uptime_str,
                "uptime_seconds": int(uptime.total_seconds()),
                "pid": process.pid,
                "python_version": platform.python_version(),
                "platform": platform.platform(),
                "hostname": platform.node()
            },
            "config": {
                "host": app.config.get("host", DEFAULT_CONFIG["host"]),
                "port": app.config.get("port", DEFAULT_CONFIG["port"]),
                "data_dir": data_dir,
                "static_dir": app.config.get("static_dir"),
                "unified_server": app.config.get("unified_server", True)
            },
            "resources": {
                "memory_usage_mb": round(memory_usage_mb, 2),
                "cpu_load": round(cpu_load, 2),
                "system_load": round(system_load, 2),
                "connections": connections_count
            },
            "data": {
                "data_dir_exists": data_dir_exists,
                "data_dir_readable": data_dir_is_readable,
                "data_dir_writable": data_dir_is_writable,
                "zarr_file_count": zarr_count
            }
        }
        
        return jsonify(status)
    except Exception as e:
        logger.error(f"Error in get_status: {e}")
        return jsonify({
            "server": {
                "status": "error",
                "error": str(e)
            }
        }), 500

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

@app.route(f"/api/{API_VERSION}/datasets/<path:dataset_path>/info", methods=["GET"])
def get_dataset_metadata(dataset_path: str):
    """
    Get metadata for a dataset by path without loading it into memory.
    This is the stateless way to get dataset information.
    
    Args:
        dataset_path: Path to the dataset
        
    Returns:
        JSON response with dataset metadata
    """
    try:
        # Use the stateless approach to get dataset info
        # Use direct file access without maintaining state
        root, metadata = zarr_reader.open_dataset_by_path(dataset_path)
        
        # Generate a dataset ID from the path if needed
        dataset_id = os.path.basename(os.path.normpath(dataset_path))
        
        # Format response with basic info
        shape = metadata.get('shape', (0, 0))
        info = {
            "dataset_id": dataset_id,
            "path": dataset_path,
            "name": Path(dataset_path).stem.replace("_", " ").title(),
            "shape": shape,
            "n_obs": shape[0] if len(shape) > 0 else 0,
            "n_vars": shape[1] if len(shape) > 1 else 0,
            "has_obs": metadata.get("has_obs", False),
            "has_var": metadata.get("has_var", False),
            "has_obsm": metadata.get("has_obsm", False),
            "has_varm": metadata.get("has_varm", False),
            "has_layers": metadata.get("has_layers", False),
            "has_uns": metadata.get("has_uns", False),
            "obs_columns": metadata.get("obs_columns", []),
            "var_columns": metadata.get("var_columns", []),
            "layers": metadata.get("layers", {})
        }
        
        # Add embeddings (obsm) information
        embeddings = metadata.get("embeddings", [])
        info["embeddings"] = embeddings
        
        # Add detailed obsm information
        if metadata.get("has_obsm", False) and "obsm" in root:
            obsm_info = {}
            for key in root["obsm"].keys():
                try:
                    shape = root["obsm"][key].shape
                    dtype = str(root["obsm"][key].dtype)
                    obsm_info[key] = {"shape": shape, "dtype": dtype}
                except Exception as e:
                    logger.warning(f"Error getting shape for obsm/{key}: {e}")
            info["obsm_details"] = obsm_info
        
        # Add detailed varm information
        if metadata.get("has_varm", False) and "varm" in root:
            varm_info = {}
            for key in root["varm"].keys():
                try:
                    shape = root["varm"][key].shape
                    dtype = str(root["varm"][key].dtype)
                    varm_info[key] = {"shape": shape, "dtype": dtype}
                except Exception as e:
                    logger.warning(f"Error getting shape for varm/{key}: {e}")
            info["varm_details"] = varm_info
        
        # Add detailed layers information
        if metadata.get("has_layers", False) and "layers" in root:
            layers_info = {}
            for key in root["layers"].keys():
                try:
                    shape = root["layers"][key].shape
                    dtype = str(root["layers"][key].dtype)
                    layers_info[key] = {"shape": shape, "dtype": dtype}
                except Exception as e:
                    logger.warning(f"Error getting shape for layers/{key}: {e}")
            info["layers_details"] = layers_info
            
        # Add detailed obsp information
        if metadata.get("has_obsp", False) and "obsp" in root:
            obsp_info = {}
            for key in root["obsp"].keys():
                try:
                    shape = root["obsp"][key].shape
                    dtype = str(root["obsp"][key].dtype)
                    obsp_info[key] = {"shape": shape, "dtype": dtype}
                except Exception as e:
                    logger.warning(f"Error getting shape for obsp/{key}: {e}")
            info["obsp_details"] = obsp_info
            
        # Add detailed varp information
        if metadata.get("has_varp", False) and "varp" in root:
            varp_info = {}
            for key in root["varp"].keys():
                try:
                    shape = root["varp"][key].shape
                    dtype = str(root["varp"][key].dtype)
                    varp_info[key] = {"shape": shape, "dtype": dtype}
                except Exception as e:
                    logger.warning(f"Error getting shape for varp/{key}: {e}")
            info["varp_details"] = varp_info
            
        # Get sample obs and var names if available
        if metadata.get("has_obs", False) and 'obs' in root and '_index' in root['obs']:
            # Get first 10 observation names
            obs_names = root['obs']['_index'][:10]
            info["obs_names_sample"] = [str(x) for x in obs_names]
            
        if metadata.get("has_var", False) and 'var' in root and '_index' in root['var']:
            # Get first 10 variable names
            var_names = root['var']['_index'][:10]
            info["var_names_sample"] = [str(x) for x in var_names]
        
        return jsonify(info)
    except Exception as e:
        logger.error(f"Error getting dataset metadata for {dataset_path}: {e}")
        return jsonify({"error": f"Failed to get dataset metadata: {str(e)}"}), 500

@app.route(f"/api/{API_VERSION}/data/info", methods=["GET"])
def get_data_info():
    """
    Get information about a dataset.
    
    Query parameters:
        dataset_id: Optional. ID of the dataset to get info for.
        dataset_path: Optional. Path to the dataset.
                     Only one of dataset_id or dataset_path should be provided.
    
    Returns:
        JSON response with dataset information
    """
    # Get dataset identification
    dataset_id = request.args.get("dataset_id")
    dataset_path = request.args.get("dataset_path")
    
    if dataset_path:
        # Use the direct access approach for stateless operation
        try:
            root, metadata = zarr_reader.open_dataset_by_path(dataset_path)
            
            # Format basic info
            shape = metadata.get('shape', (0, 0))
            info = {
                "path": dataset_path,
                "name": Path(dataset_path).stem.replace("_", " ").title(),
                "shape": shape,
                "n_obs": shape[0] if len(shape) > 0 else 0,
                "n_vars": shape[1] if len(shape) > 1 else 0,
                "has_obs": metadata.get("has_obs", False),
                "has_var": metadata.get("has_var", False),
                "has_obsm": metadata.get("has_obsm", False),
                "has_varm": metadata.get("has_varm", False),
                "has_layers": metadata.get("has_layers", False),
                "has_uns": metadata.get("has_uns", False),
                "obs_columns": metadata.get("obs_columns", []),
                "var_columns": metadata.get("var_columns", []),
                "layers": metadata.get("layers", {}),
                "embeddings": metadata.get("embeddings", [])
            }
            
            # Generate a dataset ID from the path if needed
            if not dataset_id:
                dataset_id = os.path.basename(os.path.normpath(dataset_path))
                info["dataset_id"] = dataset_id
                
            return jsonify(info)
        except Exception as e:
            logger.error(f"Error getting dataset info for path {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get dataset info: {str(e)}"}), 500
    
    elif dataset_id:
        # For backward compatibility, use legacy approach
        info = data_manager.get_basic_info(dataset_id)
        
        # Add dataset ID to response
        info["dataset_id"] = dataset_id
        
        return jsonify(info)
    else:
        return jsonify({"error": "Either dataset_id or dataset_path must be provided"}), 400

@app.route(f"/api/{API_VERSION}/data/obs", methods=["GET"])
def get_obs():
    """
    Get observation annotations.
    
    Query parameters:
        column: Optional name of the column to retrieve
        indices: Optional comma-separated list of indices to select
        dataset_id: Optional dataset ID. If not provided, uses the active dataset.
        dataset_path: Optional path to the dataset. If provided, direct file access is used.
    
    Returns:
        JSON response with observation data
    """
    # Get parameters
    column = request.args.get("column")
    indices_str = request.args.get("indices")
    dataset_id = request.args.get("dataset_id")
    dataset_path = request.args.get("dataset_path")
    
    # Parse indices if provided
    indices = None
    if indices_str:
        try:
            indices = [int(i) for i in indices_str.split(",")]
        except ValueError:
            return jsonify({"error": "Invalid indices format"})
    
    # Use stateless approach if dataset_path is provided
    if dataset_path:
        try:
            # Open the dataset directly
            root, metadata = zarr_reader.open_dataset_by_path(dataset_path)
            
            # Check if 'obs' component exists
            if 'obs' not in root:
                return jsonify({"error": "Dataset has no observation annotations"}), 404
                
            # Get data from the specified column or all columns
            if column:
                # Check if the column exists
                if column not in root['obs']:
                    return jsonify({"error": f"Column '{column}' not found in 'obs'"}), 404
                    
                # Get data for the specific column
                try:
                    array = root['obs'][column]
                    
                    # Handle AnnData categorical arrays which have a special structure
                    if hasattr(array, 'keys') and 'categories' in array and 'codes' in array:
                        # This is likely a categorical array with categories and codes
                        logger.info(f"Found categorical data in obs/{column}")
                        if indices is not None:
                            codes = array['codes'][indices]
                        else:
                            codes = array['codes'][:]
                            
                        categories = array['categories'][:]
                        
                        # Convert codes to category names
                        import numpy as np
                        data = [categories[code] if 0 <= code < len(categories) else None for code in codes]
                    else:
                        # Handle regular arrays
                        if indices is not None:
                            data = array[indices]
                        else:
                            data = array[:]
                except Exception as e:
                    logger.error(f"Error accessing obs data with direct indexing: {e}")
                    # Fall back to numpy array conversion if direct indexing fails
                    try:
                        import numpy as np
                        if hasattr(array, 'keys') and set(array.keys()) == {'categories', 'codes'}:
                            # It's a categorical array but indexing failed
                            codes = np.array(array['codes'])
                            categories = np.array(array['categories'])
                            if indices is not None:
                                selected_codes = codes[indices]
                            else:
                                selected_codes = codes
                            data = [categories[code] if 0 <= code < len(categories) else None for code in selected_codes]
                        else:
                            # Regular array
                            np_array = np.array(array)
                            if indices is not None:
                                data = np_array[indices]
                            else:
                                data = np_array
                    except Exception as nested_e:
                        logger.error(f"Fallback indexing also failed: {nested_e}")
                        return jsonify({"error": f"Failed to access observation data: {str(e)}"}), 500
                    
                # Convert to JSON-serializable format
                if hasattr(data, "tolist"):
                    result = data.tolist()
                else:
                    result = data
            else:
                # Get all columns
                result = {}
                
                # First get the _index column if available
                if '_index' in root['obs']:
                    if indices is not None:
                        result['_index'] = root['obs']['_index'][indices].tolist()
                    else:
                        result['_index'] = root['obs']['_index'][:].tolist()
                
                # Then get all other columns
                for col in root['obs'].keys():
                    if col != '_index':
                        if indices is not None:
                            data = root['obs'][col][indices]
                        else:
                            data = root['obs'][col][:]
                            
                        if hasattr(data, "tolist"):
                            result[col] = data.tolist()
                        else:
                            result[col] = data
            
            # Create response
            response = {"data": result}
            
            # Generate a dataset ID from the path if needed
            if not dataset_id:
                dataset_id = os.path.basename(os.path.normpath(dataset_path))
                
            # Include dataset ID in response
            response["dataset_id"] = dataset_id
            
            return jsonify(response)
        except Exception as e:
            logger.error(f"Error getting obs data from {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get observation data: {str(e)}"}), 500
    
    # Legacy approach using DataManager
    else:
        # Get data
        data = data_manager.get_obs(column, indices, dataset_id)
        
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
        
        # Include dataset ID in response if provided
        response = {"data": result}
        if dataset_id:
            response["dataset_id"] = dataset_id
        
        return jsonify(response)

@app.route(f"/api/{API_VERSION}/data/var", methods=["GET"])
def get_var():
    """
    Get variable annotations.
    
    Query parameters:
        column: Optional name of the column to retrieve
        indices: Optional comma-separated list of indices to select
        dataset_id: Optional dataset ID. If not provided, uses the active dataset.
        dataset_path: Optional path to the dataset. If provided, direct file access is used.
    
    Returns:
        JSON response with variable data
    """
    # Get parameters
    column = request.args.get("column")
    indices_str = request.args.get("indices")
    dataset_id = request.args.get("dataset_id")
    dataset_path = request.args.get("dataset_path")
    
    # Parse indices if provided
    indices = None
    if indices_str:
        try:
            indices = [int(i) for i in indices_str.split(",")]
        except ValueError:
            return jsonify({"error": "Invalid indices format"})
    
    # Use stateless approach if dataset_path is provided
    if dataset_path:
        try:
            # Open the dataset directly
            root, metadata = zarr_reader.open_dataset_by_path(dataset_path)
            
            # Check if 'var' component exists
            if 'var' not in root:
                return jsonify({"error": "Dataset has no variable annotations"}), 404
                
            # Get data from the specified column or all columns
            if column:
                # Check if the column exists
                if column not in root['var']:
                    return jsonify({"error": f"Column '{column}' not found in 'var'"}), 404
                    
                # Get data for the specific column
                if indices is not None:
                    # Apply indices filter
                    data = root['var'][column][indices]
                else:
                    # Get all indices
                    data = root['var'][column][:]
                    
                # Convert to JSON-serializable format
                if hasattr(data, "tolist"):
                    result = data.tolist()
                else:
                    result = data
            else:
                # Get all columns
                result = {}
                
                # First get the _index column if available
                if '_index' in root['var']:
                    if indices is not None:
                        result['_index'] = root['var']['_index'][indices].tolist()
                    else:
                        result['_index'] = root['var']['_index'][:].tolist()
                
                # Then get all other columns
                for col in root['var'].keys():
                    if col != '_index':
                        if indices is not None:
                            data = root['var'][col][indices]
                        else:
                            data = root['var'][col][:]
                            
                        if hasattr(data, "tolist"):
                            result[col] = data.tolist()
                        else:
                            result[col] = data
            
            # Create response
            response = {"data": result}
            
            # Generate a dataset ID from the path if needed
            if not dataset_id:
                dataset_id = os.path.basename(os.path.normpath(dataset_path))
                
            # Include dataset ID in response
            response["dataset_id"] = dataset_id
            
            return jsonify(response)
        except Exception as e:
            logger.error(f"Error getting var data from {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get variable data: {str(e)}"}), 500
    
    # Legacy approach using DataManager
    else:
        # Get data
        data = data_manager.get_var(column, indices, dataset_id)
        
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
        
        # Include dataset ID in response if provided
        response = {"data": result}
        if dataset_id:
            response["dataset_id"] = dataset_id
        
        return jsonify(response)

def process_array_response(data, dataset_id=None):
    """
    Process array data for JSON response, converting numpy arrays to lists.
    
    Args:
        data: Data to convert
        dataset_id: Optional dataset ID to include in response
        
    Returns:
        Dictionary ready for JSON response
    """
    # Convert to JSON-serializable format
    if hasattr(data, "tolist"):
        result = data.tolist()
    else:
        result = data
    
    # Create response
    response = {"data": result}
    
    # Include dataset ID in response if provided
    if dataset_id:
        response["dataset_id"] = dataset_id
    
    return response

@app.route(f"/api/{API_VERSION}/data/X", methods=["GET"])
def get_X():
    """
    Get X matrix data.
    
    Query parameters:
        rows: Required comma-separated list of row indices (cells) to select
        cols: Required comma-separated list of column indices (genes) to select
        dataset_id: Optional dataset ID. If not provided, uses the active dataset.
        dataset_path: Optional path to the dataset. If provided, direct file access is used.
        page: Optional page number for pagination (requires page_size)
        page_size: Optional page size for pagination (requires page)
    
    Returns:
        JSON response with X matrix data for the requested rows and columns
    """
    # Get parameters
    row_indices_str = request.args.get("rows")
    col_indices_str = request.args.get("cols")
    dataset_id = request.args.get("dataset_id")
    dataset_path = request.args.get("dataset_path")
    
    # Get pagination parameters
    page = request.args.get("page", type=int)
    page_size = request.args.get("page_size", type=int)
    
    # For X matrix access, we require at least one of rows or columns for efficient access
    if not row_indices_str and not col_indices_str:
        return jsonify({
            "error": "At least one of 'rows' or 'cols' query parameters must be provided",
            "message": "For efficient access, specify which rows/columns you need instead of requesting the entire matrix"
        }), 400
    
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
    
    # Limit number of elements to avoid performance issues
    max_elements = app.config.get("max_response_elements", DEFAULT_CONFIG["max_response_elements"])
    max_cells = app.config.get("max_cells_per_request", DEFAULT_CONFIG["max_cells_per_request"])
    max_genes = app.config.get("max_genes_per_request", DEFAULT_CONFIG["max_genes_per_request"])
    
    # Check limits for cells and genes separately
    if row_indices and len(row_indices) > max_cells:
        return jsonify({
            "error": "Too many cells requested",
            "message": f"Requested {len(row_indices)} cells exceeds limit of {max_cells}",
            "hint": "Reduce the number of cells in your request or increase server max_cells_per_request limit"
        }), 413
    
    if col_indices and len(col_indices) > max_genes:
        return jsonify({
            "error": "Too many genes requested",
            "message": f"Requested {len(col_indices)} genes exceeds limit of {max_genes}",
            "hint": "Reduce the number of genes in your request or increase server max_genes_per_request limit"
        }), 413
    
    # Also check total number of elements
    if row_indices and col_indices and len(row_indices) * len(col_indices) > max_elements:
        return jsonify({
            "error": "Request too large",
            "message": f"Requested {len(row_indices)}x{len(col_indices)}={len(row_indices)*len(col_indices)} elements exceeds limit of {max_elements}",
            "hint": "Reduce the number of rows or columns in your request or increase server max_response_elements limit"
        }), 413
    
    # Use stateless approach if dataset_path is provided
    if dataset_path:
        try:
            # Open the dataset directly
            root, metadata = zarr_reader.open_dataset_by_path(dataset_path)
            
            # Check if 'X' component exists
            if 'X' not in root:
                return jsonify({"error": "Dataset has no X matrix"}), 404
            
            # Get data with indices filtering
            if row_indices is not None and col_indices is not None:
                # Both row and column indices provided
                data = root['X'][row_indices, :][:, col_indices]
            elif row_indices is not None:
                # Only row indices provided
                if len(row_indices) > 1000:  # Limit number of rows when all columns are requested
                    return jsonify({
                        "error": "Request too large",
                        "message": "When requesting all columns, limit the number of rows to 1000 or less",
                        "hint": "Add a 'cols' parameter to select specific columns"
                    }), 413
                data = root['X'][row_indices, :]
            elif col_indices is not None:
                # Only column indices provided
                if len(col_indices) > 1000:  # Limit number of columns when all rows are requested
                    return jsonify({
                        "error": "Request too large",
                        "message": "When requesting all rows, limit the number of columns to 1000 or less",
                        "hint": "Add a 'rows' parameter to select specific rows"
                    }), 413
                data = root['X'][:, col_indices]
            
            # Generate a dataset ID from the path if needed
            if not dataset_id:
                dataset_id = os.path.basename(os.path.normpath(dataset_path))
            
            # Process and return response
            return jsonify(process_array_response(data, dataset_id))
            
        except Exception as e:
            logger.error(f"Error getting X data from {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get X matrix data: {str(e)}"}), 500
    
    # Legacy approach using DataManager
    else:    
        # Get data
        data = data_manager.get_X(row_indices, col_indices, dataset_id)
        
        # Process and return response
        return jsonify(process_array_response(data, dataset_id))

@app.route(f"/api/{API_VERSION}/data/layer/<layer_name>", methods=["GET"])
def get_layer(layer_name: str):
    """
    Get layer data.
    
    Args:
        layer_name: Name of the layer
        
    Query parameters:
        rows: Required comma-separated list of row indices (cells) to select
        cols: Required comma-separated list of column indices (genes) to select
        dataset_id: Optional dataset ID. If not provided, uses the active dataset.
        dataset_path: Optional path to the dataset. If provided, direct file access is used.
        
    Returns:
        JSON response with layer data for the requested rows and columns
    """
    # Get parameters
    row_indices_str = request.args.get("rows")
    col_indices_str = request.args.get("cols")
    dataset_id = request.args.get("dataset_id")
    dataset_path = request.args.get("dataset_path")
    
    # For layer access, we require at least one of rows or columns for efficient access
    if not row_indices_str and not col_indices_str:
        return jsonify({
            "error": "At least one of 'rows' or 'cols' query parameters must be provided",
            "message": "For efficient access, specify which rows/columns you need instead of requesting the entire matrix"
        }), 400
    
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
    
    # Limit number of elements to avoid performance issues
    max_elements = app.config.get("max_response_elements", DEFAULT_CONFIG["max_response_elements"])
    max_cells = app.config.get("max_cells_per_request", DEFAULT_CONFIG["max_cells_per_request"])
    max_genes = app.config.get("max_genes_per_request", DEFAULT_CONFIG["max_genes_per_request"])
    
    # Check limits for cells and genes separately
    if row_indices and len(row_indices) > max_cells:
        return jsonify({
            "error": "Too many cells requested",
            "message": f"Requested {len(row_indices)} cells exceeds limit of {max_cells}",
            "hint": "Reduce the number of cells in your request or increase server max_cells_per_request limit"
        }), 413
    
    if col_indices and len(col_indices) > max_genes:
        return jsonify({
            "error": "Too many genes requested",
            "message": f"Requested {len(col_indices)} genes exceeds limit of {max_genes}",
            "hint": "Reduce the number of genes in your request or increase server max_genes_per_request limit"
        }), 413
    
    # Also check total number of elements
    if row_indices and col_indices and len(row_indices) * len(col_indices) > max_elements:
        return jsonify({
            "error": "Request too large",
            "message": f"Requested {len(row_indices)}x{len(col_indices)}={len(row_indices)*len(col_indices)} elements exceeds limit of {max_elements}",
            "hint": "Reduce the number of rows or columns in your request or increase server max_response_elements limit"
        }), 413
    
    # Use stateless approach if dataset_path is provided
    if dataset_path:
        try:
            # Open the dataset directly
            root, metadata = zarr_reader.open_dataset_by_path(dataset_path)
            
            # Check if 'layers' component exists
            if 'layers' not in root or layer_name not in root['layers']:
                return jsonify({"error": f"Layer '{layer_name}' not found in dataset"}), 404
            
            # Get layer data
            layer = root['layers'][layer_name]
            
            # Get data with indices filtering
            if row_indices is not None and col_indices is not None:
                # Both row and column indices provided
                data = layer[row_indices, :][:, col_indices]
            elif row_indices is not None:
                # Only row indices provided
                if len(row_indices) > 1000:  # Limit number of rows when all columns are requested
                    return jsonify({
                        "error": "Request too large",
                        "message": "When requesting all columns, limit the number of rows to 1000 or less",
                        "hint": "Add a 'cols' parameter to select specific columns"
                    }), 413
                data = layer[row_indices, :]
            elif col_indices is not None:
                # Only column indices provided
                if len(col_indices) > 1000:  # Limit number of columns when all rows are requested
                    return jsonify({
                        "error": "Request too large",
                        "message": "When requesting all rows, limit the number of columns to 1000 or less",
                        "hint": "Add a 'rows' parameter to select specific rows"
                    }), 413
                data = layer[:, col_indices]
            
            # Generate a dataset ID from the path if needed
            if not dataset_id:
                dataset_id = os.path.basename(os.path.normpath(dataset_path))
            
            # Process and return response
            return jsonify(process_array_response(data, dataset_id))
            
        except Exception as e:
            logger.error(f"Error getting layer '{layer_name}' data from {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get layer data: {str(e)}"}), 500
    
    # Legacy approach using DataManager
    else:
        # Get data
        data = data_manager.get_layer(layer_name, row_indices, col_indices, dataset_id)
        
        # Process and return response
        return jsonify(process_array_response(data, dataset_id))

@app.route(f"/api/{API_VERSION}/data/obsm/<obsm_key>", methods=["GET"])
def get_obsm(obsm_key: str):
    """
    Get obsm data (observation multidimensional arrays like embeddings).
    
    Args:
        obsm_key: Key of the obsm entry (like 'X_umap', 'X_pca', etc.)
        
    Query parameters:
        indices: Required comma-separated list of cell indices to select
        cols: Optional comma-separated list of component indices (dimensions) to select
        info_only: Optional flag to return only shape and metadata without data (true/false)
        dataset_id: Optional dataset ID. If not provided, uses the active dataset.
        dataset_path: Optional path to the dataset. If provided, direct file access is used.
        
    Returns:
        JSON response with obsm data for the specified embedding and cells
    """
    # Get parameters
    indices_str = request.args.get("indices")
    cols_str = request.args.get("cols")
    info_only = request.args.get("info_only", "false").lower() == "true"
    dataset_id = request.args.get("dataset_id")
    dataset_path = request.args.get("dataset_path")
    
    # Parse indices if provided
    indices = None
    if indices_str:
        try:
            indices = [int(i) for i in indices_str.split(",")]
        except ValueError:
            return jsonify({"error": "Invalid indices format"})
    
    # Parse column indices if provided
    col_indices = None
    if cols_str:
        try:
            col_indices = [int(i) for i in cols_str.split(",")]
        except ValueError:
            return jsonify({"error": "Invalid column indices format"})
    
    # Use stateless approach if dataset_path is provided
    if dataset_path:
        try:
            # Open the dataset directly
            root, metadata = zarr_reader.open_dataset_by_path(dataset_path)
            
            # Check if 'obsm' component exists
            if 'obsm' not in root or obsm_key not in root['obsm']:
                return jsonify({"error": f"Obsm key '{obsm_key}' not found in dataset"}), 404
            
            # Get basic info about the array
            obsm_array = root['obsm'][obsm_key]
            array_shape = obsm_array.shape
            array_dtype = str(obsm_array.dtype)
            
            # Prepare a response with metadata
            response = {
                "shape": array_shape,
                "dtype": array_dtype,
                "key": obsm_key
            }
            
            # If info_only flag is set, return only metadata
            if info_only:
                # Generate a dataset ID from the path if needed
                if not dataset_id:
                    dataset_id = os.path.basename(os.path.normpath(dataset_path))
                
                response["dataset_id"] = dataset_id
                return jsonify(response)
            
            # For data access, we require cell indices
            if indices is None:
                return jsonify({
                    "error": "Missing required 'indices' parameter",
                    "message": "For efficient access, specify which cells you need with the 'indices' parameter"
                }), 400
            
            # Limit number of elements to avoid performance issues
            max_elements = app.config.get("max_response_elements", DEFAULT_CONFIG["max_response_elements"])
            max_cells = app.config.get("max_cells_per_request", DEFAULT_CONFIG["max_cells_per_request"])
            max_dims = app.config.get("max_embedding_dims", DEFAULT_CONFIG["max_embedding_dims"])
            
            # Get data with filtering
            if col_indices is not None:
                # Check cell limit
                if len(indices) > max_cells:
                    return jsonify({
                        "error": "Too many cells requested",
                        "message": f"Requested {len(indices)} cells exceeds limit of {max_cells}",
                        "hint": "Reduce the number of cells or increase server max_cells_per_request limit"
                    }), 413
                
                # Check dimensions limit
                if len(col_indices) > max_dims:
                    return jsonify({
                        "error": "Too many dimensions requested",
                        "message": f"Requested {len(col_indices)} dimensions exceeds limit of {max_dims}",
                        "hint": "Reduce the number of dimensions or increase server max_embedding_dims limit"
                    }), 413
                
                # Apply total elements limit
                if len(indices) * len(col_indices) > max_elements:
                    return jsonify({
                        "error": "Request too large",
                        "message": f"Requested {len(indices)}x{len(col_indices)}={len(indices)*len(col_indices)} elements exceeds limit of {max_elements}",
                        "hint": "Reduce the request size or increase server max_response_elements limit"
                    }), 413
                data = obsm_array[indices][:, col_indices]
            else:
                # Only filter by rows (cells)
                # Check cell limit
                if len(indices) > max_cells:
                    return jsonify({
                        "error": "Too many cells requested",
                        "message": f"Requested {len(indices)} cells exceeds limit of {max_cells}",
                        "hint": "Reduce the number of cells or increase server max_cells_per_request limit"
                    }), 413
                
                # Check if number of dimensions is too large
                if array_shape[1] > max_dims:
                    return jsonify({
                        "error": "Too many dimensions in this embedding",
                        "message": f"This embedding has {array_shape[1]} dimensions, which exceeds the display limit of {max_dims}",
                        "hint": "Use the 'cols' parameter to select specific dimensions or increase max_embedding_dims limit"
                    }), 413
                    
                # Apply total elements limit
                if len(indices) * array_shape[1] > max_elements:
                    return jsonify({
                        "error": "Request too large",
                        "message": f"Requested {len(indices)}x{array_shape[1]}={len(indices)*array_shape[1]} elements exceeds limit of {max_elements}",
                        "hint": "Use the 'cols' parameter to select specific dimensions or increase max_response_elements limit"
                    }), 413
                data = obsm_array[indices]
            
            # Add data to response
            if hasattr(data, "tolist"):
                response["data"] = data.tolist()
            else:
                response["data"] = data
            
            # Generate a dataset ID from the path if needed
            if not dataset_id:
                dataset_id = os.path.basename(os.path.normpath(dataset_path))
            
            response["dataset_id"] = dataset_id
            return jsonify(response)
            
        except Exception as e:
            logger.error(f"Error getting obsm '{obsm_key}' data from {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get obsm data: {str(e)}"}), 500
    
    # Legacy approach using DataManager
    else:
        # Get data
        data = data_manager.get_obsm(obsm_key, indices, dataset_id)
        
        # Process and return response
        return jsonify(process_array_response(data, dataset_id))

@app.route(f"/api/{API_VERSION}/data/obsp/<obsp_key>", methods=["GET"])
def get_obsp(obsp_key: str):
    """
    Get observation-observation matrices (cell-cell relationships).
    
    Args:
        obsp_key: Key of the obsp entry
        
    Query parameters:
        indices: Optional comma-separated list of indices to select
        dataset_id: Optional dataset ID. If not provided, uses the active dataset.
        dataset_path: Optional path to the dataset. If provided, direct file access is used.
        
    Returns:
        JSON response with obsp data
    """
    # Get parameters
    indices_str = request.args.get("indices")
    dataset_id = request.args.get("dataset_id")
    dataset_path = request.args.get("dataset_path")
    
    # Parse indices if provided
    indices = None
    if indices_str:
        try:
            indices = [int(i) for i in indices_str.split(",")]
        except ValueError:
            return jsonify({"error": "Invalid indices format"})
    
    # Use stateless approach if dataset_path is provided
    if dataset_path:
        try:
            # Open the dataset directly
            root, metadata = zarr_reader.open_dataset_by_path(dataset_path)
            
            # Check if 'obsp' component exists
            if 'obsp' not in root or obsp_key not in root['obsp']:
                return jsonify({"error": f"Obsp key '{obsp_key}' not found in dataset"}), 404
            
            # Get obsp data
            if indices is not None:
                # For cell-cell matrices, we need to select both rows and columns with the same indices
                data = root['obsp'][obsp_key][indices, :][:, indices]
            else:
                data = root['obsp'][obsp_key][:]
            
            # Generate a dataset ID from the path if needed
            if not dataset_id:
                dataset_id = os.path.basename(os.path.normpath(dataset_path))
            
            # Process and return response
            return jsonify(process_array_response(data, dataset_id))
            
        except Exception as e:
            logger.error(f"Error getting obsp '{obsp_key}' data from {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get obsp data: {str(e)}"}), 500
    
    # Legacy approach using ZarrReader directly
    else:
        # Get data
        data = zarr_reader.get_obsp(obsp_key, indices, dataset_id)
        
        # Process and return response
        return jsonify(process_array_response(data, dataset_id))

@app.route(f"/api/{API_VERSION}/data/cells", methods=["GET"])
def get_cells():
    """
    Get cell names.
    
    Query parameters:
        dataset_id: Optional dataset ID. If not provided, uses the active dataset.
        dataset_path: Optional path to the dataset. If provided, direct file access is used.
        limit: Optional maximum number of cell names to return.
    
    Returns:
        JSON response with cell names
    """
    # Get parameters
    dataset_id = request.args.get("dataset_id")
    dataset_path = request.args.get("dataset_path")
    limit_str = request.args.get("limit")
    
    # Parse limit if provided
    limit = None
    if limit_str:
        try:
            limit = int(limit_str)
        except ValueError:
            return jsonify({"error": "Invalid limit format"}), 400
    
    # Use stateless approach if dataset_path is provided
    if dataset_path:
        try:
            # Open the dataset directly
            root, metadata = zarr_reader.open_dataset_by_path(dataset_path)
            
            # Check if 'obs' component exists
            if 'obs' not in root or '_index' not in root['obs']:
                return jsonify({"error": "Dataset has no observation index"}), 404
                
            # Get cell names directly from the root
            if limit is not None and limit > 0:
                # Apply limit
                cells_array = root['obs']['_index'][:limit]
            else:
                # Get all cell names
                cells_array = root['obs']['_index'][:]
                
            # Convert to JSON-serializable format
            cells = [str(x) for x in cells_array]
            
            # Create response
            response = {"cells": cells}
            
            # Generate a dataset ID from the path if needed
            if not dataset_id:
                dataset_id = os.path.basename(os.path.normpath(dataset_path))
                
            # Include dataset ID in response
            response["dataset_id"] = dataset_id
            
            return jsonify(response)
        except Exception as e:
            logger.error(f"Error getting cell names from {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get cell names: {str(e)}"}), 500
    
    # Legacy approach using DataManager
    else:
        # Get cell names
        cells = data_manager.get_obs_names(dataset_id)
        
        # Apply limit if specified
        if limit is not None and limit > 0 and len(cells) > limit:
            cells = cells[:limit]
        
        # Create response
        response = {"cells": cells}
        if dataset_id:
            response["dataset_id"] = dataset_id
        
        return jsonify(response)

@app.route(f"/api/{API_VERSION}/data/genes", methods=["GET"])
def get_genes():
    """
    Get gene names.
    
    Query parameters:
        column: Optional name of the column containing gene names
        dataset_id: Optional dataset ID. If not provided, uses the active dataset.
        dataset_path: Optional path to the dataset. If provided, direct file access is used.
        limit: Optional maximum number of gene names to return.
    
    Returns:
        JSON response with gene names
    """
    # Get parameters
    column = request.args.get("column")
    dataset_id = request.args.get("dataset_id")
    dataset_path = request.args.get("dataset_path")
    limit_str = request.args.get("limit")
    
    # Parse limit if provided
    limit = None
    if limit_str:
        try:
            limit = int(limit_str)
        except ValueError:
            return jsonify({"error": "Invalid limit format"}), 400
    
    # Use stateless approach if dataset_path is provided
    if dataset_path:
        try:
            # Open the dataset directly
            root, metadata = zarr_reader.open_dataset_by_path(dataset_path)
            
            # Check if 'var' component exists
            if 'var' not in root:
                return jsonify({"error": "Dataset has no variable annotations"}), 404
            
            # Get gene names column - use specified column or default to _index
            target_column = column if column and column in root['var'] else '_index'
            
            if target_column not in root['var']:
                return jsonify({"error": f"Column '{target_column}' not found in var"}), 404
            
            # Get gene names
            if limit is not None and limit > 0:
                gene_array = root['var'][target_column][:limit]
            else:
                gene_array = root['var'][target_column][:]
            
            # Convert to list of strings
            genes = [str(x) for x in gene_array]
            
            # Generate a dataset ID from the path if needed
            if not dataset_id:
                dataset_id = os.path.basename(os.path.normpath(dataset_path))
            
            # Create response
            response = {"genes": genes}
            response["dataset_id"] = dataset_id
            
            # Include source column in response
            response["source_column"] = target_column
            
            return jsonify(response)
            
        except Exception as e:
            logger.error(f"Error getting gene names from {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get gene names: {str(e)}"}), 500
    
    # Legacy approach using DataManager
    else:
        # Get gene names
        genes = data_manager.get_var_names(column, dataset_id)
        
        # Create response
        response = {"genes": genes}
        if dataset_id:
            response["dataset_id"] = dataset_id
        
        return jsonify(response)

@app.route(f"/api/{API_VERSION}/data/varp/<varp_key>", methods=["GET"])
def get_varp(varp_key: str):
    """
    Get variable-variable matrices (gene-gene relationships).
    
    Args:
        varp_key: Key of the varp entry
        
    Query parameters:
        indices: Optional comma-separated list of indices to select
        dataset_id: Optional dataset ID. If not provided, uses the active dataset.
        dataset_path: Optional path to the dataset. If provided, direct file access is used.
        
    Returns:
        JSON response with varp data
    """
    # Get parameters
    indices_str = request.args.get("indices")
    dataset_id = request.args.get("dataset_id")
    dataset_path = request.args.get("dataset_path")
    
    # Parse indices if provided
    indices = None
    if indices_str:
        try:
            indices = [int(i) for i in indices_str.split(",")]
        except ValueError:
            return jsonify({"error": "Invalid indices format"})
    
    # Use stateless approach if dataset_path is provided
    if dataset_path:
        try:
            # Open the dataset directly
            root, metadata = zarr_reader.open_dataset_by_path(dataset_path)
            
            # Check if 'varp' component exists
            if 'varp' not in root or varp_key not in root['varp']:
                return jsonify({"error": f"Varp key '{varp_key}' not found in dataset"}), 404
            
            # Get varp data
            if indices is not None:
                # For gene-gene matrices, we need to select both rows and columns with the same indices
                data = root['varp'][varp_key][indices, :][:, indices]
            else:
                data = root['varp'][varp_key][:]
            
            # Generate a dataset ID from the path if needed
            if not dataset_id:
                dataset_id = os.path.basename(os.path.normpath(dataset_path))
            
            # Process and return response
            return jsonify(process_array_response(data, dataset_id))
            
        except Exception as e:
            logger.error(f"Error getting varp '{varp_key}' data from {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get varp data: {str(e)}"}), 500
    
    # Legacy approach using ZarrReader directly
    else:
        # Get data
        data = zarr_reader.get_varp(varp_key, indices, dataset_id)
        
        # Process and return response
        return jsonify(process_array_response(data, dataset_id))

# Cell selection endpoint removed - client-side concern only

# Gene selection endpoint removed - client-side concern only

# Cell focus endpoint removed - client-side concern only

# Gene focus endpoint removed - client-side concern only
        
@app.route(f"/api/{API_VERSION}/data/statistics", methods=["GET"])
def get_data_statistics():
    """
    Get statistical analysis of expression data.
    
    Query parameters:
        gene_indices: Comma-separated list of gene indices
        cell_indices: Comma-separated list of cell indices
        layer: Layer name (optional)
        dataset_id: Optional dataset ID. If not provided, uses the active dataset.
    
    Returns:
        JSON response with statistical analysis
    """
    # Get parameters
    gene_indices_str = request.args.get("gene_indices")
    cell_indices_str = request.args.get("cell_indices")
    layer = request.args.get("layer")
    dataset_id = request.args.get("dataset_id")
    
    # Parse indices if provided
    gene_indices = None
    if gene_indices_str:
        try:
            gene_indices = [int(i) for i in gene_indices_str.split(",")]
        except ValueError:
            return jsonify({"error": "Invalid gene indices format"})
    
    cell_indices = None
    if cell_indices_str:
        try:
            cell_indices = [int(i) for i in cell_indices_str.split(",")]
        except ValueError:
            return jsonify({"error": "Invalid cell indices format"})
    
    # Get statistics
    stats = data_manager.analyze_expression_data(gene_indices, cell_indices, layer, dataset_id)
    
    # Include dataset ID in response if provided
    if dataset_id:
        stats["dataset_id"] = dataset_id
    
    return jsonify(stats)

@app.route(f"/api/{API_VERSION}/data/downsampled", methods=["GET"])
def get_downsampled_data():
    """
    Get downsampled data for visualization.
    
    Query parameters:
        n_samples: Number of cells to sample (default: 1000)
        method: Downsampling method ('random', 'stratified', or 'kmeans') (default: 'random')
        seed: Random seed (default: 42)
        include_embeddings: Whether to include embeddings data (default: true)
        include_obs: Whether to include observation annotations (default: true)
        dataset_id: Optional dataset ID. If not provided, uses the active dataset.
        
    Returns:
        JSON response with downsampled data
    """
    # Get parameters
    n_samples = request.args.get("n_samples", 1000, type=int)
    method = request.args.get("method", "random")
    seed = request.args.get("seed", 42, type=int)
    include_embeddings = request.args.get("include_embeddings", "true").lower() == "true"
    include_obs = request.args.get("include_obs", "true").lower() == "true"
    dataset_id = request.args.get("dataset_id")
    
    # Get downsampled cell indices
    cell_indices = data_manager.downsample_cells(n_samples, method, seed, dataset_id)
    
    if not cell_indices:
        return jsonify({"error": "Failed to downsample cells"})
    
    # Prepare response data
    result = {
        "n_cells": len(cell_indices),
        "cell_indices": cell_indices
    }
    
    # Include dataset ID in response if provided
    if dataset_id:
        result["dataset_id"] = dataset_id
    
    # Add cell names
    cell_names = data_manager.get_obs_names(dataset_id)
    if cell_indices and cell_names:
        result["cell_names"] = [cell_names[i] for i in cell_indices if i < len(cell_names)]
    
    # Include observation annotations if requested
    if include_obs:
        # Get key observation columns
        obs_data = {}
        metadata = zarr_reader.get_metadata(dataset_id)
        obs_columns = metadata.get("obs_columns", [])
        
        # Limit to important columns to reduce payload size
        important_columns = ["cell_type", "leiden", "louvain", "cluster", "group", "condition", "state"]
        columns_to_include = [col for col in obs_columns if col in important_columns or "cluster" in col.lower()]
        
        # Get data for each column
        for column in columns_to_include[:5]:  # Limit to 5 columns max
            column_data = data_manager.get_obs(column, cell_indices, dataset_id)
            if column_data is not None and len(column_data) > 0:
                if hasattr(column_data, "tolist"):
                    obs_data[column] = column_data.tolist()
                else:
                    obs_data[column] = column_data
                    
        result["obs"] = obs_data
    
    # Include embeddings if requested
    if include_embeddings:
        embeddings = data_manager.get_embeddings(dataset_id)
        if embeddings:
            embedding_data = {}
            
            # Get the first 2-3 embeddings
            for embedding in embeddings[:3]:
                data = data_manager.get_obsm(embedding, cell_indices, dataset_id)
                if data is not None and len(data) > 0:
                    # Keep only the first two dimensions for 2D visualization
                    if data.shape[1] > 2:
                        data = data[:, :2]
                        
                    if hasattr(data, "tolist"):
                        embedding_data[embedding] = data.tolist()
                    else:
                        embedding_data[embedding] = data
                        
            result["embeddings"] = embedding_data
    
    return jsonify(result)

@app.route(f"/api/{API_VERSION}/data/progressive/<path:data_path>", methods=["GET"])
def get_progressive_data(data_path):
    """
    Stream data progressively using chunked encoding.
    
    Args:
        data_path: Path to the data component (e.g., 'X', 'obsm/X_umap')
        
    Query parameters:
        chunk_size: Size of chunks to load at once (default: 1000)
        dataset_id: Optional dataset ID. If not provided, uses the active dataset.
        dataset_path: Optional path to the dataset. If provided, direct file access is used.
        
    Returns:
        Streamed JSON responses with data chunks
    """
    # Get parameters
    chunk_size = request.args.get("chunk_size", 1000, type=int)
    dataset_id = request.args.get("dataset_id")
    dataset_path = request.args.get("dataset_path")
    
    # For stateless architecture, dataset_path is required
    if not dataset_path and not dataset_id:
        return jsonify({"error": "Either dataset_path or dataset_id must be provided"}), 400
    
    # Start the chunked response
    def generate():
        try:
            # Define a callback for progressive loading
            chunk_count = 0
            
            def progress_callback(chunk, progress):
                nonlocal chunk_count
                chunk_count += 1
                
                # Convert numpy arrays to lists
                if hasattr(chunk, "tolist"):
                    chunk_data = chunk.tolist()
                else:
                    chunk_data = chunk
                    
                # Create a chunk response
                response = {
                    "chunk": chunk_count,
                    "progress": progress,
                    "data": chunk_data,
                    "final": progress >= 0.99
                }
                
                # Generate a dataset ID from the path if needed
                if dataset_path and not dataset_id:
                    response["dataset_id"] = os.path.basename(os.path.normpath(dataset_path))
                elif dataset_id:
                    response["dataset_id"] = dataset_id
                
                # Yield chunk as a JSON string
                yield json.dumps(response) + "\n"
            
            # Start progressive loading
            if data_path == "X":
                # Load from X matrix
                zarr_reader.load_progressively("X", chunk_size, progress_callback, dataset_id, dataset_path)
            elif data_path.startswith("obsm/"):
                # Load from obsm
                obsm_key = data_path[5:]  # Remove 'obsm/' prefix
                zarr_reader.load_progressively(f"obsm/{obsm_key}", chunk_size, progress_callback, dataset_id, dataset_path)
            elif data_path.startswith("layers/"):
                # Load from layers
                layer_key = data_path[7:]  # Remove 'layers/' prefix
                zarr_reader.load_progressively(f"layers/{layer_key}", chunk_size, progress_callback, dataset_id, dataset_path)
            elif data_path.startswith("obsp/"):
                # Load from obsp
                obsp_key = data_path[5:]  # Remove 'obsp/' prefix
                zarr_reader.load_progressively(f"obsp/{obsp_key}", chunk_size, progress_callback, dataset_id, dataset_path)
            elif data_path.startswith("varp/"):
                # Load from varp
                varp_key = data_path[5:]  # Remove 'varp/' prefix
                zarr_reader.load_progressively(f"varp/{varp_key}", chunk_size, progress_callback, dataset_id, dataset_path)
            else:
                # Invalid path
                yield json.dumps({"error": f"Invalid data path: {data_path}"}) + "\n"
                
        except Exception as e:
            logger.error(f"Error in progressive loading: {e}")
            yield json.dumps({"error": str(e)}) + "\n"
    
    # Return a streaming response
    return app.response_class(
        generate(),
        mimetype="application/x-ndjson"
    )


@app.route(f"/api/{API_VERSION}/zarr/upload", methods=["POST"])
def upload_zarr_files():
    """
    Upload zarr files to the server's data directory.
    
    This API supports stateless operation by saving the uploaded files
    to the configured data directory and returning a dataset_path that
    can be used with other stateless API endpoints.
    
    Query parameters or form data:
        target_name: Optional name for the dataset directory in the data dir
                    (if not provided, a timestamp-based name will be generated)
    
    Returns:
        JSON response with upload status and dataset_path for future API calls
    """
    try:
        # Determine the data directory from app config
        data_dir = app.config.get("data_dir", "data")
        if not os.path.exists(data_dir):
            try:
                os.makedirs(data_dir, exist_ok=True)
            except Exception as e:
                logger.error(f"Failed to create data directory: {e}")
                return jsonify({"error": f"Failed to create data directory: {str(e)}"}), 500
        
        # Get target name if provided, otherwise create one
        target_name = request.form.get("target_name")
        if not target_name:
            target_name = f"uploaded_dataset_{int(time.time())}"
        
        # Ensure the name is filesystem-safe
        target_name = "".join(c for c in target_name if c.isalnum() or c in "._-")
        target_path = os.path.join(data_dir, target_name)
        
        # Check for naming conflicts
        if os.path.exists(target_path):
            target_name = f"{target_name}_{int(time.time())}"
            target_path = os.path.join(data_dir, target_name)
        
        # Check for files
        if 'files[]' not in request.files:
            return jsonify({"error": "No files uploaded"}), 400
            
        files = request.files.getlist('files[]')
        if not files:
            return jsonify({"error": "No files selected"}), 400
        
        # Create target zarr directory
        try:
            os.makedirs(target_path, exist_ok=True)
        except Exception as e:
            logger.error(f"Failed to create target directory: {e}")
            return jsonify({"error": f"Failed to create target directory: {str(e)}"}), 500
        
        # Save all files to the target directory
        file_count = 0
        for file in files:
            # Get the path from the filename (might include subdirectories)
            relative_path = file.filename
            if not relative_path:
                continue
                
            # Create subdirectories if needed
            full_path = os.path.join(target_path, relative_path)
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            
            # Save the file
            file.save(full_path)
            file_count += 1
        
        # Only validate the saved files, don't load them into memory
        try:
            dataset_path = target_path
            
            # Check if it's a valid zarr directory by trying to open it (without loading data)
            root, metadata = zarr_reader.open_dataset_by_path(dataset_path)
            
            if root is None or metadata is None:
                # Something went wrong, but we'll keep the files for manual inspection
                logger.warning(f"Uploaded files don't appear to be a valid zarr directory: {dataset_path}")
                
                return jsonify({
                    "success": True,
                    "warning": "Files uploaded but don't appear to be a valid zarr directory",
                    "message": "Files uploaded successfully but may not be a valid zarr directory",
                    "dataset_path": dataset_path,
                    "file_count": file_count,
                    "data_valid": False
                })
            
            # Get basic shape info
            shape = metadata.get('shape', [0, 0])
            
            return jsonify({
                "success": True,
                "message": "Files uploaded successfully",
                "dataset_path": dataset_path,
                "name": target_name,
                "file_count": file_count,
                "data_valid": True,
                "shape": shape,
                "note": "Use this dataset_path with other API endpoints"
            })
        except Exception as e:
            logger.error(f"Error validating uploaded dataset: {e}")
            return jsonify({
                "success": True,
                "warning": f"Error validating dataset: {str(e)}",
                "message": "Files uploaded successfully but validation failed",
                "dataset_path": target_path,
                "file_count": file_count,
                "data_valid": False
            })
    except Exception as e:
        logger.error(f"Error uploading files: {e}")
        return jsonify({"error": f"Error uploading files: {str(e)}"}), 500


@app.route(f"/api/{API_VERSION}/zarr/url", methods=["GET", "POST"])
def validate_zarr_url():
    """
    Validate a zarr dataset URL for client-side operations (stateless).
    
    This endpoint doesn't load the dataset into server memory.
    It only validates if the URL points to a valid zarr path.
    The client should manage dataset state.
    
    GET parameters or POST body:
        url: URL to the zarr dataset
    
    Returns:
        JSON response with validation status and dataset_path for future API calls
    """
    try:
        # Get URL from request
        url = None
        if request.method == "GET":
            url = request.args.get("url")
        else:  # POST
            data = request.get_json()
            if data and 'url' in data:
                url = data['url']
        
        if not url:
            return jsonify({"error": "No URL provided"}), 400
        
        # Validate URL format
        if not url.startswith(('http://', 'https://', 'file://', 's3://', '/')) and not os.path.exists(url):
            return jsonify({
                "error": "Invalid URL format or inaccessible path", 
                "url": url
            }), 400
        
        # For stateless operation, we don't actually load the dataset
        # Just validate if the URL/path looks reasonable
        
        # Generate a suggested dataset_path to use in future API calls
        dataset_path = url
        
        # If it's a local path, check if it exists
        if os.path.exists(url):
            if not os.path.isdir(url) and not (url.endswith('.zarr') or url.endswith('.h5ad')):
                return jsonify({"error": "Path does not appear to be a zarr directory or anndata file"}), 400
        
        return jsonify({
            "success": True,
            "message": "URL validated successfully. Use dataset_path in your API requests.",
            "dataset_path": dataset_path,
            "suggested_name": os.path.basename(url),
            "note": "This endpoint is stateless. Store dataset_path client-side for use in API calls."
        })
    except Exception as e:
        logger.error(f"Error validating URL: {e}")
        return jsonify({"error": f"Error validating URL: {str(e)}"}), 500


@app.route(f"/api/{API_VERSION}/zarr/s3", methods=["GET", "POST"])
def validate_zarr_s3():
    """
    Validate a zarr dataset in S3 for client-side operations (stateless).
    
    This endpoint doesn't load the dataset into server memory.
    It only validates if the S3 path is well-formed.
    The client should manage dataset state.
    
    GET parameters or POST body:
        bucket: S3 bucket name
        key: Path within the bucket
        region: Optional AWS region (default: us-east-1)
        anonymous: Optional boolean indicating whether to use anonymous access (default: true)
        accessKey: Optional AWS access key ID (required if anonymous is false)
        secretKey: Optional AWS secret access key (required if anonymous is false)
    
    Returns:
        JSON response with validation status and dataset_path for future API calls
    """
    try:
        # Get S3 configuration from request
        bucket = None
        key = None
        region = 'us-east-1'
        anonymous = True
        aws_access_key_id = None
        aws_secret_access_key = None
        
        if request.method == "GET":
            bucket = request.args.get("bucket")
            key = request.args.get("key")
            region = request.args.get("region", 'us-east-1')
            anonymous_str = request.args.get("anonymous", "true").lower()
            anonymous = anonymous_str == "true"
            aws_access_key_id = request.args.get("accessKey")
            aws_secret_access_key = request.args.get("secretKey")
        else:  # POST
            data = request.get_json()
            if not data:
                return jsonify({"error": "No S3 configuration provided"}), 400
                
            bucket = data.get('bucket')
            key = data.get('key')
            region = data.get('region', 'us-east-1')
            anonymous = data.get('anonymous', True)
            aws_access_key_id = data.get('accessKey')
            aws_secret_access_key = data.get('secretKey')
        
        # Validate required fields
        if not bucket or not key:
            return jsonify({"error": "S3 bucket and key are required"}), 400
        
        # Construct S3 URL for dataset_path
        s3_url = f"s3://{bucket}/{key}"
        
        # For stateless operation, we don't actually load the dataset
        # Just validate if the S3 path looks reasonable
        
        # Create a sanitized response (without secret key for security)
        s3_config = {
            'bucket': bucket,
            'key': key,
            'region': region,
            'anonymous': anonymous
        }
        
        if not anonymous and aws_access_key_id:
            s3_config['access_key_id_provided'] = True
            # Don't include the actual secret key in the response
        
        return jsonify({
            "success": True,
            "message": "S3 path validated. Use dataset_path in your API requests.",
            "dataset_path": s3_url,
            "suggested_name": os.path.basename(key),
            "s3_config": s3_config,
            "note": "This endpoint is stateless. Store dataset_path client-side for use in API calls."
        })
    except Exception as e:
        logger.error(f"Error validating S3 path: {e}")
        return jsonify({"error": f"Error validating S3 path: {str(e)}"}), 500


@app.route(f"/api/{API_VERSION}/zarr/to_anndata", methods=["GET"])
def get_anndata_structure():
    """
    Get AnnData-like structure for a dataset (stateless).
    
    Query parameters:
        dataset_path: Path to the dataset (required)
    
    Returns:
        JSON response with AnnData structure
    """
    try:
        # Get the dataset path from the request
        dataset_path = request.args.get("dataset_path")
        if not dataset_path:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        # Open the dataset by path (stateless)
        root, metadata = zarr_reader.open_dataset_by_path(dataset_path)
        if root is None or metadata is None:
            return jsonify({"error": f"Cannot open dataset at path: {dataset_path}"}), 404
        
        # Get basic shape and structure info from metadata
        shape = metadata.get('shape', [0, 0])
        
        # Create a simplified AnnData structure based on available metadata
        result = {
            "dataset_path": dataset_path,
            "shape": list(shape) if shape else [0, 0],
            "X": {
                "shape": list(shape) if shape else [0, 0],
                "dtype": metadata.get('X', {}).get('dtype', "float32"),
                "path": "X"
            },
            "observations": shape[0] if shape else 0,
            "variables": shape[1] if shape else 0,
            "obs": {},
            "var": {},
            "obsm": {},
            "layers": {}
        }
        
        # Add observation (cell) metadata if available
        if metadata.get('has_obs', False) and 'obs_columns' in metadata:
            result['obs_names'] = True
            result['obs_columns'] = metadata['obs_columns']
        
        # Add variable (gene) metadata if available
        if metadata.get('has_var', False) and 'var_columns' in metadata:
            result['var_names'] = True
            result['var_columns'] = metadata['var_columns']
        
        # Add obsm information if available
        if metadata.get('has_obsm', False) and 'obsm' in metadata:
            obsm_info = metadata['obsm']
            result['obsm'] = {
                'keys': obsm_info.get('keys', [])
            }
            
            # Add embeddings if available
            if 'embeddings' in metadata:
                result['embeddings'] = metadata['embeddings']
        
        # Add layers information if available
        if metadata.get('has_layers', False):
            result['layers'] = {
                'keys': metadata.get('layers', {}).get('keys', [])
            }
        
        # Include additional matrix types
        if metadata.get('has_varm', False) and 'varm' in metadata:
            result['varm'] = {
                'keys': metadata['varm'].get('keys', [])
            }
        
        if metadata.get('has_obsp', False) and 'obsp' in metadata:
            result['obsp'] = {
                'keys': metadata['obsp'].get('keys', [])
            }
        
        if metadata.get('has_varp', False) and 'varp' in metadata:
            result['varp'] = {
                'keys': metadata['varp'].get('keys', [])
            }
        
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error getting AnnData structure: {e}")
        return jsonify({"error": f"Error getting AnnData structure: {str(e)}"}), 500


@app.route(f"/api/{API_VERSION}/datasets/compare", methods=["GET"])
def compare_datasets():
    """
    Compare multiple datasets.
    
    Query parameters:
        dataset_ids: Comma-separated list of dataset IDs to compare
        include_metadata: Whether to include metadata (default: true)
        include_obs_columns: Whether to include observation column names (default: true)
        include_var_columns: Whether to include variable column names (default: true)
        include_shape: Whether to include shape information (default: true)
    
    Returns:
        JSON response with dataset comparison
    """
    try:
        # Get parameters
        dataset_ids_str = request.args.get("dataset_ids")
        if not dataset_ids_str:
            return jsonify({"error": "dataset_ids parameter is required"}), 400
            
        # Parse dataset IDs
        dataset_ids = [id.strip() for id in dataset_ids_str.split(",")]
        
        # Check if datasets exist
        for dataset_id in dataset_ids:
            if not data_manager.has_dataset(dataset_id):
                return jsonify({"error": f"Dataset {dataset_id} not found"}), 404
        
        # Get comparison options
        include_metadata = request.args.get("include_metadata", "true").lower() == "true"
        include_obs_columns = request.args.get("include_obs_columns", "true").lower() == "true"
        include_var_columns = request.args.get("include_var_columns", "true").lower() == "true"
        include_shape = request.args.get("include_shape", "true").lower() == "true"
        
        # Build comparison result
        comparison = {
            "dataset_ids": dataset_ids,
            "datasets": {}
        }
        
        # Get dataset information
        for dataset_id in dataset_ids:
            dataset_info = {}
            
            # Get shape information
            if include_shape:
                dataset_info["shape"] = data_manager.get_shape(dataset_id)
            
            # Get metadata
            if include_metadata:
                dataset_info["metadata"] = zarr_reader.get_metadata(dataset_id)
            
            # Get observation columns
            if include_obs_columns:
                dataset_info["obs_columns"] = data_manager.get_obs_columns(dataset_id)
            
            # Get variable columns
            if include_var_columns:
                dataset_info["var_columns"] = data_manager.get_var_columns(dataset_id)
            
            comparison["datasets"][dataset_id] = dataset_info
        
        # Add common features
        if include_obs_columns:
            # Find common observation columns
            obs_columns_sets = [set(data_manager.get_obs_columns(dataset_id)) for dataset_id in dataset_ids]
            common_obs_columns = list(set.intersection(*obs_columns_sets)) if obs_columns_sets else []
            comparison["common_obs_columns"] = common_obs_columns
        
        if include_var_columns:
            # Find common variable columns
            var_columns_sets = [set(data_manager.get_var_columns(dataset_id)) for dataset_id in dataset_ids]
            common_var_columns = list(set.intersection(*var_columns_sets)) if var_columns_sets else []
            comparison["common_var_columns"] = common_var_columns
        
        return jsonify(comparison)
    except Exception as e:
        logger.error(f"Error comparing datasets: {e}")
        return jsonify({"error": f"Error comparing datasets: {str(e)}"}), 500

@app.route(f"/api/{API_VERSION}/zarr/data", methods=["GET"])
def get_zarr_data():
    """
    Get data from zarr array.
    
    Query parameters:
        path: Path to the zarr array (e.g., 'X', 'obs/cell_type')
        selection: Optional JSON-encoded selection indices
        dataset_id: Optional dataset ID. If not provided, uses the active dataset.
    
    Returns:
        JSON response with array data
    """
    try:
        # Get parameters
        path = request.args.get("path")
        selection_str = request.args.get("selection")
        dataset_id = request.args.get("dataset_id")
        
        if not path:
            return jsonify({"error": "Path parameter is required"}), 400
        
        # Parse selection if provided
        selection = None
        if selection_str:
            try:
                selection = json.loads(selection_str)
            except json.JSONDecodeError:
                return jsonify({"error": "Invalid selection format"}), 400
        
        # Get data from zarr array
        if hasattr(zarr_reader, 'get_array'):
            data = zarr_reader.get_array(path, selection, dataset_id)
        else:
            # Fallback to data manager methods
            if path == 'X':
                data = data_manager.get_X(None, None, dataset_id)
            elif path.startswith('obs/'):
                column = path.split('/', 1)[1] if '/' in path else None
                data = data_manager.get_obs(column, None, dataset_id)
            elif path.startswith('var/'):
                column = path.split('/', 1)[1] if '/' in path else None
                data = data_manager.get_var(column, None, dataset_id)
            elif path.startswith('obsm/'):
                key = path.split('/', 1)[1] if '/' in path else None
                data = data_manager.get_obsm(key, None, dataset_id)
            else:
                return jsonify({"error": f"Unsupported path: {path}"}), 400
        
        # Process and format the response
        response = process_array_response(data, dataset_id)
        
        return jsonify(response)
    except Exception as e:
        logger.error(f"Error getting zarr data: {e}")
        return jsonify({"error": f"Error getting zarr data: {str(e)}"}), 500


@app.route(f"/api/{API_VERSION}/data/paginated", methods=["GET"])
def get_paginated_data():
    """
    Get matrix data with pagination support.
    
    This endpoint is optimized for efficiently accessing large matrices in chunks.
    
    Query parameters:
        matrix_type: Type of matrix to access ('X', 'layer', 'obsm', 'varm', 'obsp', 'varp')
        key: Required for all matrix types except 'X' (e.g., layer name, obsm key)
        rows: Required comma-separated list of row indices
        cols: Optional comma-separated list of column indices
        page: Required page number (0-based)
        page_size: Required number of items per page
        dataset_id: Optional dataset ID. If not provided, uses the active dataset.
        dataset_path: Optional path to the dataset. If provided, direct file access is used.
    
    Returns:
        JSON response with paginated matrix data and pagination metadata in headers
    """
    # Get basic parameters
    matrix_type = request.args.get("matrix_type")
    key = request.args.get("key")
    dataset_id = request.args.get("dataset_id")
    dataset_path = request.args.get("dataset_path")
    
    # Get pagination parameters - these are required for this endpoint
    try:
        page = int(request.args.get("page", 0))
        page_size = int(request.args.get("page_size", 100))
    except (ValueError, TypeError):
        return jsonify({
            "error": "Invalid pagination parameters",
            "message": "page and page_size must be valid integers"
        }), 400
    
    # Validate matrix_type
    valid_matrix_types = ["X", "layer", "obsm", "varm", "obsp", "varp"]
    if not matrix_type or matrix_type not in valid_matrix_types:
        return jsonify({
            "error": "Invalid matrix_type",
            "message": f"matrix_type must be one of: {', '.join(valid_matrix_types)}"
        }), 400
    
    # Validate key for matrix types that need it
    if matrix_type != "X" and not key:
        return jsonify({
            "error": "Missing key parameter",
            "message": f"key is required for matrix_type '{matrix_type}'"
        }), 400
    
    # Validate pagination parameters
    if page < 0:
        return jsonify({"error": "Page number must be non-negative"}), 400
    if page_size <= 0 or page_size > 1000:
        return jsonify({
            "error": "Invalid page size",
            "message": "page_size must be positive and not exceed 1000"
        }), 400
    
    # Parse indices - rows are required
    row_indices_str = request.args.get("rows")
    if not row_indices_str:
        return jsonify({
            "error": "Missing rows parameter",
            "message": "rows parameter is required with comma-separated list of indices"
        }), 400
    
    try:
        row_indices = [int(i) for i in row_indices_str.split(",")]
    except ValueError:
        return jsonify({"error": "Invalid row indices format"}), 400
    
    # Parse column indices if provided
    col_indices = None
    col_indices_str = request.args.get("cols")
    if col_indices_str:
        try:
            col_indices = [int(i) for i in col_indices_str.split(",")]
        except ValueError:
            return jsonify({"error": "Invalid column indices format"}), 400
    
    # Calculate total rows and validate pagination
    total_rows = len(row_indices)
    total_pages = (total_rows + page_size - 1) // page_size
    
    # Check if page is out of bounds
    if page >= total_pages:
        return jsonify({
            "error": "Page out of bounds",
            "message": f"Page {page} exceeds available pages ({total_pages})",
            "total_rows": total_rows,
            "total_pages": total_pages,
            "max_page": total_pages - 1 if total_pages > 0 else 0
        }), 400
    
    # Apply pagination to row indices
    start_idx = page * page_size
    end_idx = min(start_idx + page_size, total_rows)
    paginated_row_indices = row_indices[start_idx:end_idx]
    
    # Use stateless approach if dataset_path is provided
    if dataset_path:
        try:
            # Open the dataset directly
            root, metadata = zarr_reader.open_dataset_by_path(dataset_path)
            
            # Get data based on matrix type
            if matrix_type == "X":
                # Check if X exists
                if "X" not in root:
                    return jsonify({"error": "Dataset has no X matrix"}), 404
                
                # Get data with indices filtering
                if col_indices is not None:
                    data = root["X"][paginated_row_indices, :][:, col_indices]
                else:
                    data = root["X"][paginated_row_indices, :]
                    
            elif matrix_type == "layer":
                # Check if layer exists
                if "layers" not in root or key not in root["layers"]:
                    return jsonify({"error": f"Layer '{key}' not found"}), 404
                
                # Get data with indices filtering
                if col_indices is not None:
                    data = root["layers"][key][paginated_row_indices, :][:, col_indices]
                else:
                    data = root["layers"][key][paginated_row_indices, :]
                    
            elif matrix_type == "obsm":
                # Check if obsm exists
                if "obsm" not in root or key not in root["obsm"]:
                    return jsonify({"error": f"Obsm key '{key}' not found"}), 404
                
                # Get data with indices filtering
                if col_indices is not None:
                    data = root["obsm"][key][paginated_row_indices, :][:, col_indices]
                else:
                    data = root["obsm"][key][paginated_row_indices, :]
                    
            elif matrix_type == "varm":
                # Check if varm exists
                if "varm" not in root or key not in root["varm"]:
                    return jsonify({"error": f"Varm key '{key}' not found"}), 404
                
                # Get data with indices filtering
                if col_indices is not None:
                    data = root["varm"][key][paginated_row_indices, :][:, col_indices]
                else:
                    data = root["varm"][key][paginated_row_indices, :]
                    
            elif matrix_type == "obsp":
                # Check if obsp exists
                if "obsp" not in root or key not in root["obsp"]:
                    return jsonify({"error": f"Obsp key '{key}' not found"}), 404
                
                # Get data with indices filtering
                if col_indices is not None:
                    data = root["obsp"][key][paginated_row_indices, :][:, col_indices]
                else:
                    data = root["obsp"][key][paginated_row_indices, :]
                    
            elif matrix_type == "varp":
                # Check if varp exists
                if "varp" not in root or key not in root["varp"]:
                    return jsonify({"error": f"Varp key '{key}' not found"}), 404
                
                # Get data with indices filtering
                if col_indices is not None:
                    data = root["varp"][key][paginated_row_indices, :][:, col_indices]
                else:
                    data = root["varp"][key][paginated_row_indices, :]
            
            # Generate a dataset ID from the path if needed
            if not dataset_id:
                dataset_id = os.path.basename(os.path.normpath(dataset_path))
            
            # Create response with pagination metadata
            result = process_array_response(data, dataset_id)
            
            # Add pagination information to the response
            result["pagination"] = {
                "page": page,
                "page_size": page_size,
                "total_rows": total_rows,
                "total_pages": total_pages,
                "current_page_items": len(paginated_row_indices)
            }
            
            # Also add pagination information to headers
            response = jsonify(result)
            response.headers["X-Pagination-Page"] = str(page)
            response.headers["X-Pagination-PageSize"] = str(page_size)
            response.headers["X-Pagination-TotalRows"] = str(total_rows)
            response.headers["X-Pagination-TotalPages"] = str(total_pages)
            
            return response
            
        except Exception as e:
            logger.error(f"Error getting paginated data from {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get paginated data: {str(e)}"}), 500
    
    # Legacy approach using DataManager (not implemented for all matrix types)
    else:
        return jsonify({
            "error": "Stateful mode not supported for paginated endpoint",
            "message": "Please provide a dataset_path parameter"
        }), 400

@app.route(f"/api/{API_VERSION}/zarr/chunked_data", methods=["GET"])
def get_chunked_data():
    """
    Get data using optimized chunking strategy.
    
    Query parameters:
        path: Path to the zarr array (e.g., 'X', 'obsm/X_umap')
        selection: Optional JSON-encoded selection indices
        dataset_id: Optional dataset ID. If not provided, uses the active dataset.
    
    Returns:
        JSON response with chunked array data
    """
    try:
        # Get parameters
        path = request.args.get("path")
        selection_str = request.args.get("selection")
        dataset_id = request.args.get("dataset_id")
        
        if not path:
            return jsonify({"error": "Path parameter is required"}), 400
        
        # Parse selection if provided
        selection = None
        if selection_str:
            try:
                selection = json.loads(selection_str)
            except json.JSONDecodeError:
                return jsonify({"error": "Invalid selection format"}), 400
        
        # Get data with chunking optimization
        if hasattr(zarr_reader, 'load_chunked_data'):
            data = zarr_reader.load_chunked_data(path, selection, dataset_id)
        else:
            # Fallback to regular data access if chunked method not available
            if hasattr(zarr_reader, 'get_array'):
                data = zarr_reader.get_array(path, selection, dataset_id)
            else:
                return jsonify({"error": "Chunked data loading not supported"}), 501
        
        # Process and format the response
        response = process_array_response(data, dataset_id)
        
        return jsonify(response)
    except Exception as e:
        logger.error(f"Error getting chunked zarr data: {e}")
        return jsonify({"error": f"Error getting chunked zarr data: {str(e)}"}), 500


def run_server(config_file: Optional[str] = None, 
              debug: bool = False, 
              port: Optional[int] = None,
              data_dir: Optional[str] = None,
              static_dir: Optional[str] = None,
              max_response_elements: Optional[int] = None,
              max_cells_per_request: Optional[int] = None,
              max_genes_per_request: Optional[int] = None) -> None:
    """
    Run the unified Annzarro server.
    
    This is the main entry point for starting the Annzarro server, which now serves
    both the API endpoints and static content on a single port.
    
    Args:
        config_file: Path to the configuration file
        debug: Whether to run in debug mode
        port: Port to run the server on (overrides config)
        data_dir: Path to the data directory (overrides config)
        static_dir: Path to the directory containing static files (overrides config)
        max_response_elements: Maximum number of total elements allowed in array responses
                              (default: 1,000,000). Increase for large datasets.
        max_cells_per_request: Maximum number of cells allowed in a single request
                              (default: 10,000). Increase for datasets with millions of cells.
        max_genes_per_request: Maximum number of genes allowed in a single request
                              (default: 10,000). Increase for datasets with many genes.
    
    Configuration parameters for large datasets:
        For servers hosting large single-cell datasets (millions of cells), you may need
        to increase the following limits in the config file or command line parameters:
        
        - max_response_elements: Limits the total size of array responses (rows*columns)
        - max_cells_per_request: Limits the number of cells that can be queried at once
        - max_genes_per_request: Limits the number of genes that can be queried at once
        - max_embedding_dims: Limits the number of embedding dimensions that can be requested
        
        These limits are in place to prevent excessive memory use and response size.
        Adjust based on your server capacity and dataset characteristics.
    """
    # Load configuration
    config = dict(DEFAULT_CONFIG)
    
    if config_file:
        try:
            with open(config_file, "r") as f:
                config.update(json.load(f))
        except Exception as e:
            logger.error(f"Error loading config file: {e}")
    
    # Check for environment variables (override config file)
    # ANNZARRO_DATA_DIR environment variable
    if "ANNZARRO_DATA_DIR" in os.environ:
        env_data_dir = os.environ.get("ANNZARRO_DATA_DIR")
        if env_data_dir:
            # Expand user directory (~/path) if present
            env_data_dir = os.path.expanduser(env_data_dir)
            
            # Convert to absolute path if it's relative
            if not os.path.isabs(env_data_dir):
                env_data_dir = os.path.abspath(env_data_dir)
                
            config["data_dir"] = env_data_dir
            logger.info(f"Using data directory from environment variable: {env_data_dir}")
    
    # ANNZARRO_PORT environment variable
    if "ANNZARRO_PORT" in os.environ:
        try:
            env_port = int(os.environ.get("ANNZARRO_PORT"))
            config["port"] = env_port
            logger.info(f"Using port from environment variable: {env_port}")
        except (ValueError, TypeError):
            logger.warning(f"Invalid port in environment variable: {os.environ.get('ANNZARRO_PORT')}")
    
    # ANNZARRO_STATIC_DIR environment variable
    if "ANNZARRO_STATIC_DIR" in os.environ:
        env_static_dir = os.environ.get("ANNZARRO_STATIC_DIR")
        if env_static_dir:
            # Expand user directory (~/path) if present
            env_static_dir = os.path.expanduser(env_static_dir)
            
            # Convert to absolute path if it's relative
            if not os.path.isabs(env_static_dir):
                env_static_dir = os.path.abspath(env_static_dir)
                
            config["static_dir"] = env_static_dir
            logger.info(f"Using static directory from environment variable: {env_static_dir}")
    
    # Override config with function parameters (highest priority)
    if debug:
        config["debug"] = True
    if port:
        config["port"] = port
    if data_dir:
        # Expand user directory (~/path) if present
        data_dir = os.path.expanduser(data_dir)
        
        # Convert to absolute path if it's relative
        if not os.path.isabs(data_dir):
            data_dir = os.path.abspath(data_dir)
            
        config["data_dir"] = data_dir
        logger.info(f"Using data directory from command line: {data_dir}")
    
    if static_dir:
        # Expand user directory (~/path) if present
        static_dir = os.path.expanduser(static_dir)
        
        # Convert to absolute path if it's relative
        if not os.path.isabs(static_dir):
            static_dir = os.path.abspath(static_dir)
            
        config["static_dir"] = static_dir
        logger.info(f"Using static directory from command line: {static_dir}")
    
    # Update server limits for large datasets
    if max_response_elements:
        config["max_response_elements"] = max_response_elements
        logger.info(f"Setting max_response_elements to {max_response_elements}")
    
    if max_cells_per_request:
        config["max_cells_per_request"] = max_cells_per_request
        logger.info(f"Setting max_cells_per_request to {max_cells_per_request}")
    
    if max_genes_per_request:
        config["max_genes_per_request"] = max_genes_per_request
        logger.info(f"Setting max_genes_per_request to {max_genes_per_request}")
    
    # Set up logging
    setup_logging(config)
    
    # Configure Flask app
    app.config.update(config)
    configure_app(app, config)
    
    # Ensure data directory exists
    data_dir = config.get("data_dir", "data")
    os.makedirs(data_dir, exist_ok=True)
    logger.info(f"Using data directory: {data_dir}")
    
    # Ensure static directory info is logged
    static_dir = config.get("static_dir")
    if static_dir:
        static_dir = os.path.abspath(static_dir)
        logger.info(f"Using static directory: {static_dir}")
    else:
        # Use repository root as default
        static_dir = str(Path(__file__).resolve().parent.parent.parent)
        logger.info(f"Using default static directory (repository root): {static_dir}")
    
    # Run the server
    ssl_context = None
    if config.get("https_enabled", False):
        cert_file = config.get("cert_file")
        key_file = config.get("key_file")
        
        if cert_file and key_file:
            ssl_context = (cert_file, key_file)
        else:
            ssl_context = "adhoc"
    
    # Log startup message with unified server info
    host = config['host']
    port = config['port']
    host_display = "localhost" if host in ["127.0.0.1", "0.0.0.0"] else host
    protocol = "https" if ssl_context else "http"
    
    logger.info(f"Starting unified Annzarro server on {host}:{port}")
    logger.info(f"Access the application at: {protocol}://{host_display}:{port}")
    logger.info(f"API endpoints available at: {protocol}://{host_display}:{port}/api/{API_VERSION}")
    
    # Run Flask app
    app.run(
        host=config["host"],
        port=config["port"],
        debug=config["debug"],
        ssl_context=ssl_context
    )

if __name__ == "__main__":
    run_server()
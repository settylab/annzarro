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

# Enable CORS by default for all routes - important for frontend communication
CORS(app)

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

@app.route(f"/api/{API_VERSION}/data/obsp/<obsp_key>", methods=["GET"])
def get_obsp(obsp_key: str):
    """
    Get observation-observation matrices (cell-cell relationships).
    
    Args:
        obsp_key: Key of the obsp entry
        
    Returns:
        JSON response with obsp data
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
    data = zarr_reader.get_obsp(obsp_key, indices)
    
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
    
    Query parameters:
        column: Optional name of the column containing gene names
    
    Returns:
        JSON response with gene names
    """
    # Get optional column parameter
    column = request.args.get("column")
    
    # Get gene names
    genes = data_manager.get_var_names(column)
    
    return jsonify({"genes": genes})

@app.route(f"/api/{API_VERSION}/data/varp/<varp_key>", methods=["GET"])
def get_varp(varp_key: str):
    """
    Get variable-variable matrices (gene-gene relationships).
    
    Args:
        varp_key: Key of the varp entry
        
    Returns:
        JSON response with varp data
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
    data = zarr_reader.get_varp(varp_key, indices)
    
    # Convert to JSON-serializable format
    if hasattr(data, "tolist"):
        result = data.tolist()
    else:
        result = data
    
    return jsonify({"data": result})

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
        
@app.route(f"/api/{API_VERSION}/data/statistics", methods=["GET"])
def get_data_statistics():
    """
    Get statistical analysis of expression data.
    
    Query parameters:
        gene_indices: Comma-separated list of gene indices
        cell_indices: Comma-separated list of cell indices
        layer: Layer name (optional)
    
    Returns:
        JSON response with statistical analysis
    """
    # Get parameters
    gene_indices_str = request.args.get("gene_indices")
    cell_indices_str = request.args.get("cell_indices")
    layer = request.args.get("layer")
    
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
    stats = data_manager.analyze_expression_data(gene_indices, cell_indices, layer)
    
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
        
    Returns:
        JSON response with downsampled data
    """
    # Get parameters
    n_samples = request.args.get("n_samples", 1000, type=int)
    method = request.args.get("method", "random")
    seed = request.args.get("seed", 42, type=int)
    include_embeddings = request.args.get("include_embeddings", "true").lower() == "true"
    include_obs = request.args.get("include_obs", "true").lower() == "true"
    
    # Get downsampled cell indices
    cell_indices = data_manager.downsample_cells(n_samples, method, seed)
    
    if not cell_indices:
        return jsonify({"error": "Failed to downsample cells"})
    
    # Prepare response data
    result = {
        "n_cells": len(cell_indices),
        "cell_indices": cell_indices
    }
    
    # Add cell names
    cell_names = data_manager.get_obs_names()
    if cell_indices and cell_names:
        result["cell_names"] = [cell_names[i] for i in cell_indices if i < len(cell_names)]
    
    # Include observation annotations if requested
    if include_obs:
        # Get key observation columns
        obs_data = {}
        metadata = zarr_reader.get_metadata()
        obs_columns = metadata.get("obs_columns", [])
        
        # Limit to important columns to reduce payload size
        important_columns = ["cell_type", "leiden", "louvain", "cluster", "group", "condition", "state"]
        columns_to_include = [col for col in obs_columns if col in important_columns or "cluster" in col.lower()]
        
        # Get data for each column
        for column in columns_to_include[:5]:  # Limit to 5 columns max
            column_data = data_manager.get_obs(column, cell_indices)
            if column_data is not None and len(column_data) > 0:
                if hasattr(column_data, "tolist"):
                    obs_data[column] = column_data.tolist()
                else:
                    obs_data[column] = column_data
                    
        result["obs"] = obs_data
    
    # Include embeddings if requested
    if include_embeddings:
        embeddings = data_manager.get_embeddings()
        if embeddings:
            embedding_data = {}
            
            # Get the first 2-3 embeddings
            for embedding in embeddings[:3]:
                data = data_manager.get_obsm(embedding, cell_indices)
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
        
    Returns:
        Streamed JSON responses with data chunks
    """
    # Get parameters
    chunk_size = request.args.get("chunk_size", 1000, type=int)
    
    if not data_manager.current_dataset:
        return jsonify({"error": "No dataset loaded"})
    
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
                
                # Yield chunk as a JSON string
                yield json.dumps(response) + "\n"
            
            # Start progressive loading
            if data_path == "X":
                # Load from X matrix
                zarr_reader.load_progressively("X", chunk_size, progress_callback)
            elif data_path.startswith("obsm/"):
                # Load from obsm
                obsm_key = data_path[5:]  # Remove 'obsm/' prefix
                zarr_reader.load_progressively(f"obsm/{obsm_key}", chunk_size, progress_callback)
            elif data_path.startswith("layers/"):
                # Load from layers
                layer_key = data_path[7:]  # Remove 'layers/' prefix
                zarr_reader.load_progressively(f"layers/{layer_key}", chunk_size, progress_callback)
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
    Upload zarr files to the server.
    
    Returns:
        JSON response with upload status
    """
    try:
        if 'files[]' not in request.files:
            return jsonify({"error": "No files uploaded"}), 400
            
        files = request.files.getlist('files[]')
        if not files:
            return jsonify({"error": "No files selected"}), 400
            
        # Create a temporary directory for the uploaded files
        with tempfile.TemporaryDirectory() as temp_dir:
            # Save all files to the temporary directory
            for file in files:
                # Get the path from the filename (might include subdirectories)
                relative_path = file.filename
                if not relative_path:
                    continue
                    
                # Create subdirectories if needed
                full_path = os.path.join(temp_dir, relative_path)
                os.makedirs(os.path.dirname(full_path), exist_ok=True)
                
                # Save the file
                file.save(full_path)
            
            # Load the zarr dataset
            zarr_path = temp_dir
            try:
                # Initialize the zarr reader with the uploaded files
                zarr_reader.load_zarr(zarr_path)
                
                # Initialize the data manager with the zarr dataset
                data_manager.load_from_zarr(zarr_reader)
                
                return jsonify({
                    "success": True,
                    "message": "Zarr dataset loaded successfully",
                    "datasetInfo": {
                        "name": os.path.basename(zarr_path),
                        "path": zarr_path,
                        "shape": data_manager.get_shape() if hasattr(data_manager, 'get_shape') else None
                    }
                })
            except Exception as e:
                logger.error(f"Error loading zarr dataset: {e}")
                return jsonify({"error": f"Error loading zarr dataset: {str(e)}"}), 500
    except Exception as e:
        logger.error(f"Error uploading files: {e}")
        return jsonify({"error": f"Error uploading files: {str(e)}"}), 500


@app.route(f"/api/{API_VERSION}/zarr/url", methods=["POST"])
def load_zarr_from_url():
    """
    Load zarr dataset from URL.
    
    Returns:
        JSON response with loading status
    """
    try:
        # Get URL from request
        data = request.get_json()
        if not data or 'url' not in data:
            return jsonify({"error": "No URL provided"}), 400
            
        url = data['url']
        
        # Load the zarr dataset from URL
        try:
            # Initialize the zarr reader with the URL
            # Note: This function may need to be implemented in zarr_reader
            if hasattr(zarr_reader, 'load_zarr_from_url'):
                zarr_reader.load_zarr_from_url(url)
            else:
                # Fallback to regular load_zarr if from_url is not implemented
                zarr_reader.load_zarr(url)
            
            # Initialize the data manager with the zarr dataset
            data_manager.load_from_zarr(zarr_reader)
            
            return jsonify({
                "success": True,
                "message": "Zarr dataset loaded successfully from URL",
                "datasetInfo": {
                    "name": os.path.basename(url),
                    "path": url,
                    "shape": data_manager.get_shape() if hasattr(data_manager, 'get_shape') else None
                }
            })
        except Exception as e:
            logger.error(f"Error loading zarr dataset from URL: {e}")
            return jsonify({"error": f"Error loading zarr dataset from URL: {str(e)}"}), 500
    except Exception as e:
        logger.error(f"Error processing URL request: {e}")
        return jsonify({"error": f"Error processing URL request: {str(e)}"}), 500


@app.route(f"/api/{API_VERSION}/zarr/s3", methods=["POST"])
def load_zarr_from_s3():
    """
    Load zarr dataset from S3.
    
    Returns:
        JSON response with loading status
    """
    try:
        # Get S3 configuration from request
        data = request.get_json()
        if not data:
            return jsonify({"error": "No S3 configuration provided"}), 400
            
        # Validate required fields
        if 'bucket' not in data or 'key' not in data:
            return jsonify({"error": "S3 bucket and key are required"}), 400
            
        # Configure S3 parameters
        s3_params = {
            'bucket': data['bucket'],
            'key': data['key'],
            'region': data.get('region', 'us-east-1'),
            'anonymous': data.get('anonymous', True)
        }
        
        # Add credentials if not anonymous
        if not s3_params['anonymous'] and 'accessKey' in data and 'secretKey' in data:
            s3_params['aws_access_key_id'] = data['accessKey']
            s3_params['aws_secret_access_key'] = data['secretKey']
        
        # Load the zarr dataset from S3
        try:
            # Initialize the zarr reader with the S3 parameters
            # Note: This function may need to be implemented in zarr_reader
            if hasattr(zarr_reader, 'load_zarr_from_s3'):
                zarr_reader.load_zarr_from_s3(**s3_params)
            else:
                # Fallback to url-based loading if S3 is not directly supported
                s3_url = f"s3://{s3_params['bucket']}/{s3_params['key']}"
                if hasattr(zarr_reader, 'load_zarr_from_url'):
                    zarr_reader.load_zarr_from_url(s3_url)
                else:
                    return jsonify({"error": "S3 loading not supported by zarr reader"}), 501
            
            # Initialize the data manager with the zarr dataset
            data_manager.load_from_zarr(zarr_reader)
            
            return jsonify({
                "success": True,
                "message": "Zarr dataset loaded successfully from S3",
                "datasetInfo": {
                    "name": os.path.basename(s3_params['key']),
                    "path": f"s3://{s3_params['bucket']}/{s3_params['key']}",
                    "shape": data_manager.get_shape() if hasattr(data_manager, 'get_shape') else None
                }
            })
        except Exception as e:
            logger.error(f"Error loading zarr dataset from S3: {e}")
            return jsonify({"error": f"Error loading zarr dataset from S3: {str(e)}"}), 500
    except Exception as e:
        logger.error(f"Error processing S3 request: {e}")
        return jsonify({"error": f"Error processing S3 request: {str(e)}"}), 500


@app.route(f"/api/{API_VERSION}/zarr/to_anndata", methods=["GET"])
def convert_to_anndata():
    """
    Convert current zarr store to AnnData-like structure.
    
    Returns:
        JSON response with AnnData structure
    """
    try:
        # Check if zarr dataset is loaded
        if not hasattr(zarr_reader, 'is_initialized') or not zarr_reader.is_initialized():
            return jsonify({"error": "No zarr dataset loaded"}), 400
        
        # Get basic shape and structure info
        shape = data_manager.get_shape()
        
        # Create a simplified AnnData structure based on available information
        result = {
            "shape": list(shape) if shape else [0, 0],
            "X": {
                "shape": list(shape) if shape else [0, 0],
                "dtype": "float32",
                "path": "X"
            },
            "observations": shape[0] if shape else 0,
            "variables": shape[1] if shape else 0,
            "obs": {},
            "var": {},
            "obsm": {},
            "layers": {}
        }
        
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error converting to AnnData: {e}")
        return jsonify({"error": f"Error converting to AnnData: {str(e)}"}), 500


@app.route(f"/api/{API_VERSION}/zarr/data", methods=["GET"])
def get_zarr_data():
    """
    Get data from zarr array.
    
    Returns:
        JSON response with array data
    """
    try:
        # Get parameters
        path = request.args.get("path")
        selection_str = request.args.get("selection")
        
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
            data = zarr_reader.get_array(path, selection)
        else:
            # Fallback to data manager methods
            if path == 'X':
                data = data_manager.get_X()
            elif path.startswith('obs/'):
                column = path.split('/', 1)[1] if '/' in path else None
                data = data_manager.get_obs(column)
            elif path.startswith('var/'):
                column = path.split('/', 1)[1] if '/' in path else None
                data = data_manager.get_var(column)
            elif path.startswith('obsm/'):
                key = path.split('/', 1)[1] if '/' in path else None
                data = data_manager.get_obsm(key)
            else:
                return jsonify({"error": f"Unsupported path: {path}"}), 400
        
        # Convert to JSON-serializable format
        if hasattr(data, "tolist"):
            result = data.tolist()
        else:
            result = data
        
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error getting zarr data: {e}")
        return jsonify({"error": f"Error getting zarr data: {str(e)}"}), 500


@app.route(f"/api/{API_VERSION}/zarr/chunked_data", methods=["GET"])
def get_chunked_data():
    """
    Get data using optimized chunking strategy.
    
    Returns:
        JSON response with chunked array data
    """
    try:
        # Get parameters
        path = request.args.get("path")
        selection_str = request.args.get("selection")
        
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
            data = zarr_reader.load_chunked_data(path, selection)
        else:
            # Fallback to regular data access if chunked method not available
            if hasattr(zarr_reader, 'get_array'):
                data = zarr_reader.get_array(path, selection)
            else:
                return jsonify({"error": "Chunked data loading not supported"}), 501
        
        # Convert to JSON-serializable format
        if hasattr(data, "tolist"):
            result = data.tolist()
        else:
            result = data
        
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error getting chunked zarr data: {e}")
        return jsonify({"error": f"Error getting chunked zarr data: {str(e)}"}), 500


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
    
    # Ensure data directory exists
    data_dir = config.get("data_dir", "data")
    os.makedirs(data_dir, exist_ok=True)
    logger.info(f"Using data directory: {data_dir}")
    
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
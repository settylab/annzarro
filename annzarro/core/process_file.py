from . import h5ad_reader_obj
from flask import jsonify
from pathlib import Path
from .reader import Reader
from typing import Literal
import logging

logger = logging.getLogger("data_routes")

def get_keys(metadata, field):
    return list(metadata.get(field, {"keys": []}).get("keys", []))

def extract_metadata(dataset_path: str, reader: Reader):
    try:
        # Only wrap the risky operation of opening the dataset.
        metadata = reader.get_metadata(dataset_path)
    except FileNotFoundError as e:
        logger.exception(f"Dataset not found: {dataset_path}")
        return jsonify({
            "status": "error",
            "error": "Dataset not found", 
            "message": f"The dataset path '{dataset_path}' does not exist."
        }), 404
    except ValueError as e:
        # Handle validation errors with a 400 Bad Request
        error_message = str(e)
        logger.warning(f"Invalid dataset path: {dataset_path}: {error_message}")
        return jsonify({
            "status": "error",
            "error": "Invalid dataset path", 
            "message": error_message, 
            "path": dataset_path
        }), 400
    except Exception as e:
        logger.exception(f"Error opening dataset at {dataset_path}")
        return jsonify({
            "status": "error",
            "error": "Failed to open dataset", 
            "message": str(e)
        }), 500


    try:
        # Format basic dataset information.
        shape = metadata.get("shape", (0, 0))
        dataset_structure = {
            "path": dataset_path,
            "name": Path(dataset_path).stem.replace("_", " ").title(),
            "shape": shape,
            "n_obs": shape[0] if len(shape) > 0 else 0,
            "n_vars": shape[1] if len(shape) > 1 else 0,
            "obs": {
                "available": metadata.get("has_obs", False),
                "columns": metadata.get("obs_columns", []),
                "columns_info": metadata.get("obs_columns_info", {})
            },
            "var": {
                "available": metadata.get("has_var", False),
                "columns": metadata.get("var_columns", []),
                "columns_info": metadata.get("var_columns_info", {})
            },
            "X": {
                "available": True,
                "shape": shape
            },
            "layers": {
                "available": metadata.get("has_layers", False),
                "keys": get_keys(metadata, "layers"),
                "details": metadata.get("layers", {}),
                "info": metadata.get("layers_info", {})
            },
            "obsm": {
                "available": metadata.get("has_obsm", False),
                "keys": get_keys(metadata, "obsm"),
                "dataframes": metadata.get("obsm_dataframes", {}),
                "matrices": metadata.get("obsm_matrices", {}),
                "info": metadata.get("obsm_info", {})
            },
            "varm": {
                "available": metadata.get("has_varm", False),
                "keys": get_keys(metadata, "varm"),
                "dataframes": metadata.get("varm_dataframes", {}),
                "matrices": metadata.get("varm_matrices", {}),
                "info": metadata.get("varm_info", {})
            },
            "obsp": {
                "available": metadata.get("has_obsp", False),
                "keys": get_keys(metadata, "obsp")
            },
            "varp": {
                "available": metadata.get("has_varp", False),
                "keys": get_keys(metadata, "varp")
            },
            "uns": {
                "available": metadata.get("has_uns", False),
                "keys": get_keys(metadata, "uns")
            },
            "embeddings": metadata.get("embeddings", [])
        }
        # Use pathlib for consistency when adding dataset_id.
        # Frontend uses path directly, so no need for dataset_id
        return jsonify(dataset_structure)
    
    except Exception as e:
        logger.exception(f"Error building dataset structure for path {dataset_path}")
        return jsonify({"error": f"Failed to get dataset structure: {str(e)}"}), 500

def extract_cells_genes(dataset_path: str, type: Literal["cells", "genes"], reader: Reader):
    try:
        # Use direct zarr access for stateless operation
        logger.info(f"API {type.upper()}: Loading {'gene' if type == 'genes' else 'cell'} names for {dataset_path} with use_cache=True")
        entities = reader.get_cell_gene_names(dataset_path, type, use_cache=True)
        logger.info(f"API {type.upper()}: Successfully loaded {len(entities)} {type}")
        
        return jsonify({
            type: entities,
            "dataset_path": dataset_path
        })
    except ValueError as e:
        # Handle validation errors with a 400 Bad Request
        error_message = str(e)
        logger.warning(f"Invalid dataset path for {type}: {dataset_path}: {error_message}")
        return jsonify({
            "error": "Invalid dataset path", 
            "message": error_message, 
            "path": dataset_path,
            "status": "error",
            type: []
        }), 400
    except RuntimeError as e:
        # Handle operational errors with a 500 Internal Server Error
        error_message = str(e)
        logger.error(f"Error processing dataset for {type}: {dataset_path}: {error_message}")
        return jsonify({
            "error": "Failed to process dataset",
            "message": error_message,
            "path": dataset_path,
            "status": "error",
            type: []
        }), 500
    except Exception as e:
        # Handle unexpected errors
        error_message = str(e)
        logger.error(f"Unexpected error getting {'gene' if type == 'genes' else 'cell'} names for {dataset_path}: {e}")
        return jsonify({
            "error": f"Failed to get {'gene' if type == 'genes' else 'cell'} names",
            "message": error_message,
            "path": dataset_path,
            "status": "error",
            type: []
        }), 500
    
def extract_obs_var(dataset_path: str, reader: Reader, indices: list[int], column_names: list[str], include_categories: bool, type: Literal["cells", "genes"]):
    try:
        result = reader.get_obs_var(
            dataset_path=dataset_path, 
            entity = type,
            indices=indices, 
            column_names=column_names, 
            include_categories=include_categories
        )
    
        # Add dataset path to the response
        response = {"dataset_path": dataset_path}
        
        # Handle both dict and array results
        if isinstance(result, dict):
            if 'data' in result:
                # New format with data and potentially categories
                response.update(result)
            else:
                # Old format where result is just data dict
                response["data"] = result
        else:
            # Single column result
            response["data"] = result
            
        return jsonify(response)
    except Exception as e:
        logger.error(f"Error getting {'obs' if type == 'cells' else 'var'} data for {dataset_path}: {e}")
        return jsonify({"error": f"Failed to get {'obs' if type == 'cells' else 'var'} data: {str(e)}"}), 500
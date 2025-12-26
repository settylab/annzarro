from . import zarr_reader
from flask import jsonify
from pathlib import Path
import logging
from typing import Literal

logger = logging.getLogger("data_routes")

def get_keys(metadata, field):
    return list(metadata.get(field, {"keys": []}).get("keys", []))

def extract_zarr_metadata(dataset_path: str):
    try:
        # Only wrap the risky operation of opening the dataset.
        metadata = zarr_reader.get_metadata(dataset_path)
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

def extract_zarr_cells_genes(dataset_path: str, type: Literal["cells", "genes"]):
    try:
        # Use direct zarr access for stateless operation
        logger.info(f"API {type.upper()}: Loading {'gene' if type == 'genes' else 'cell'} names for {dataset_path} with use_cache=True")
        entities = zarr_reader.get_gene_names(dataset_path, use_cache=True) if type == "genes" else zarr_reader.get_cell_names(dataset_path, use_cache=True)
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

def extract_zarr_obs_var(dataset_path: str, indices, column_names, include_categories, type: Literal["cells", "genes"]):
    try:
        if type == "cells":
            result = zarr_reader.get_obs(
                dataset_path=dataset_path, 
                indices=indices, 
                column_names=column_names, 
                include_categories=include_categories
            )
        else:
            result = zarr_reader.get_var(
                dataset_path=dataset_path, 
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

def extract_zarr_obsm_varm(dataset_path: str, key, indices, column_indices, column_name, entity_type = Literal["cells", "genes"]):
    try:
        # Use direct zarr access for stateless operation
        if entity_type == "cells":
            data = zarr_reader.get_obsm(obsm_key=key, dataset_path=dataset_path, 
                                    indices=indices, col_indices=column_indices,
                                    column_name=column_name)
        else:
            data = zarr_reader.get_varm(varm_key=key, dataset_path=dataset_path, 
                                    indices=indices, col_indices=column_indices,
                                    column_name=column_name)
        
        # Convert NumPy arrays to Python lists for JSON serialization
        if hasattr(data, 'tolist'):
            # Direct conversion for simple ndarray
            serialized_data = data.tolist()
        elif isinstance(data, list) and data and hasattr(data[0], 'tolist'):
            # Handle list of ndarrays case
            serialized_data = [row.tolist() if hasattr(row, 'tolist') else row for row in data]
        else:
            # Already serializable or empty
            serialized_data = data
            
        logger.info(f"Successfully loaded {'obsm' if entity_type == 'cells' else 'varm'}/{key} data: {type(data)}, shape: {getattr(data, 'shape', 'unknown')}")

        
        response_data = {
            "data": serialized_data,
            f"{'obsm' if entity_type == 'cells' else 'varm'}_key": key,
            "dataset_path": dataset_path
        }
        
        # Include column name in response if provided
        if column_name:
            response_data["column_name"] = column_name
        
        return jsonify(response_data)
    except Exception as e:
        logger.error(f"Error getting {'obsm' if entity_type == 'cells' else 'varm'}/{key} data for {dataset_path}: {e}")
        return jsonify({"error": f"Failed to get {'obsm' if entity_type == 'cells' else 'varm'} data: {str(e)}"}), 500

def extract_zarr_obsp_varp(dataset_path: str, key: str, row_indices, col_indices, entity_type: Literal["cells", "genes"]):
    try:
    # Use direct zarr access for stateless operation
        if entity_type == "cells":
            data = zarr_reader.get_obsp(key, dataset_path, row_indices, col_indices)
        else:
            data = zarr_reader.get_varp(key, dataset_path, row_indices, col_indices)
        
        # Convert NumPy arrays to Python lists for JSON serialization
        if hasattr(data, 'tolist'):
            # Direct conversion for simple ndarray
            serialized_data = data.tolist()
        elif isinstance(data, list) and data and hasattr(data[0], 'tolist'):
            # Handle list of ndarrays case
            serialized_data = [row.tolist() if hasattr(row, 'tolist') else row for row in data]
        else:
            # Already serializable or empty
            serialized_data = data
            
        logger.info(f"Successfully loaded {'obsp' if entity_type == 'cells' else 'varp'}/{key} data: {type(data)}, shape: {getattr(data, 'shape', 'unknown')}")
        
        return jsonify({
            "data": serialized_data,
            f"{'obsp' if entity_type == 'cells' else 'varp'}_key": key,
            "dataset_path": dataset_path
        })
    except Exception as e:
        logger.error(f"Error getting {'obsp' if entity_type == 'cells' else 'varp'}/{key} data for {dataset_path}: {e}")
        return jsonify({"error": f"Failed to get {'obsp' if entity_type == 'cells' else 'varp'} data: {str(e)}"}), 500

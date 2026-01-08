from . import zarr_reader
from flask import jsonify
from pathlib import Path
import logging
from typing import Literal

logger = logging.getLogger("data_routes")

def extract_zarr_obs_var(dataset_path: str, indices: list[int], column_names: list[str], include_categories: bool, type: Literal["cells", "genes"]):
    try:
        result = zarr_reader.get_obs_var(
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

def extract_zarr_obsm_varm(dataset_path: str, key, indices, column_indices, column_name, entity_type = Literal["cells", "genes"]):
    try:
        # Use direct zarr access for stateless operation
        data = zarr_reader.get_obsm_varm(key=key, entity = entity_type, dataset_path=dataset_path, 
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
        data = zarr_reader.get_obsp_varp(key = key, entity = entity_type, 
                                        dataset_path=dataset_path, row_indices=row_indices, 
                                        col_indices = col_indices)
        
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

def extract_zarr_layer(dataset_path: str, layer_name: str, row_indices, col_indices):
    try:
        # Use direct zarr access for stateless operation
        data = zarr_reader.get_layer(layer_name, dataset_path, row_indices, col_indices)

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
            
        logger.info(f"Successfully loaded layer/{layer_name} data: {type(data)}, shape: {getattr(data, 'shape', 'unknown')}")
        
        return jsonify({
            "data": serialized_data,
            "layer_name": layer_name,
            "dataset_path": dataset_path
        })
    except Exception as e:
        logger.error(f"Error getting layer {layer_name} data for {dataset_path}: {e}")
        return jsonify({"error": f"Failed to get layer data: {str(e)}"}), 500

def extract_zarr_X(dataset_path: str, row_indices, col_indices):
    try:
        # Use direct zarr access for stateless operation
        data = zarr_reader.get_X(dataset_path, row_indices, col_indices)
        
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
            
        logger.info(f"Successfully loaded X data: {type(data)}, shape: {getattr(data, 'shape', 'unknown')}")
        
        return jsonify({
            "data": serialized_data,
            "dataset_path": dataset_path
        })
    except Exception as e:
        logger.error(f"Error getting X data for {dataset_path}: {e}")
        return jsonify({"error": f"Failed to get X data: {str(e)}"}), 500

def extract_zarr_uns(uns_key: str, dataset_path: str):
    try:
        # Use direct zarr access for stateless operation
        data = zarr_reader.get_uns(uns_key, dataset_path)
        
        logger.info(f"Successfully loaded uns/{uns_key} data: {type(data)}, shape: {getattr(data, 'shape', 'unknown')}")
        
        return jsonify({
            "data": data,
            "uns_key": uns_key,
            "dataset_path": dataset_path
        })
    except Exception as e:
        logger.error(f"Error getting uns/{uns_key} data for {dataset_path}: {e}")
        return jsonify({"error": f"Failed to get uns data: {str(e)}"}), 500
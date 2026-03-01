from . import zarr_reader
from flask import jsonify
from pathlib import Path
import logging
from typing import Literal

logger = logging.getLogger("data_routes")

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
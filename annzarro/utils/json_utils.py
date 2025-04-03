"""
JSON utilities for Annzarro

This module provides functions for converting complex objects to JSON-compatible format,
particularly for handling NumPy arrays and other scientific data types.
"""

import json
import numpy as np
from typing import Any, Dict, List, Union, Optional
from pathlib import Path

class NumpyJSONEncoder(json.JSONEncoder):
    """
    JSON encoder that can handle NumPy arrays and other scientific data types.
    """
    
    def default(self, obj: Any) -> Any:
        """
        Convert the object to a JSON-serializable type.
        
        Args:
            obj: Object to convert
            
        Returns:
            JSON-serializable representation of the object
        """
        if isinstance(obj, np.integer):
            return int(obj)
        elif isinstance(obj, np.floating):
            return float(obj)
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        elif isinstance(obj, Path):
            return str(obj)
        elif isinstance(obj, set):
            return list(obj)
        return super().default(obj)

def to_json(obj: Any) -> str:
    """
    Convert an object to a JSON string.
    
    Args:
        obj: Object to convert
        
    Returns:
        JSON string
    """
    return json.dumps(obj, cls=NumpyJSONEncoder)

def from_json(json_str: str) -> Any:
    """
    Convert a JSON string to an object.
    
    Args:
        json_str: JSON string
        
    Returns:
        Decoded object
    """
    return json.loads(json_str)

def save_json(obj: Any, file_path: Union[str, Path]) -> None:
    """
    Save an object to a JSON file.
    
    Args:
        obj: Object to save
        file_path: Path to the file
    """
    with open(file_path, 'w') as f:
        json.dump(obj, f, cls=NumpyJSONEncoder, indent=2)

def load_json(file_path: Union[str, Path]) -> Any:
    """
    Load an object from a JSON file.
    
    Args:
        file_path: Path to the file
        
    Returns:
        Loaded object
    """
    with open(file_path, 'r') as f:
        return json.load(f)

def numpy_to_json_compatible(arr: np.ndarray) -> Union[List, Dict, float, int, str]:
    """
    Convert a NumPy array to a JSON-compatible type.
    
    Args:
        arr: NumPy array
        
    Returns:
        JSON-compatible representation
    """
    if arr.ndim == 0:  # Scalar
        if np.issubdtype(arr.dtype, np.integer):
            return int(arr.item())
        elif np.issubdtype(arr.dtype, np.floating):
            return float(arr.item())
        elif np.issubdtype(arr.dtype, np.bool_):
            return bool(arr.item())
        else:
            return str(arr.item())
    else:  # Array
        return arr.tolist()

def convert_to_json_compatible(obj: Any) -> Any:
    """
    Recursively convert an object to a JSON-compatible representation.
    
    Args:
        obj: Object to convert
        
    Returns:
        JSON-compatible representation
    """
    if isinstance(obj, np.ndarray):
        return numpy_to_json_compatible(obj)
    elif isinstance(obj, (np.integer, np.floating, np.bool_)):
        return obj.item()
    elif isinstance(obj, (list, tuple)):
        return [convert_to_json_compatible(item) for item in obj]
    elif isinstance(obj, dict):
        return {key: convert_to_json_compatible(value) for key, value in obj.items()}
    elif isinstance(obj, Path):
        return str(obj)
    elif isinstance(obj, set):
        return list(obj)
    elif hasattr(obj, 'tolist'):
        return obj.tolist()
    return obj
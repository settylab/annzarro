import zarr
import numpy as np
import json
import requests

"""
This script provides a solution to the issue with the obsm endpoint
when column_name="1" is provided but returns empty data.

The issue appears to be in the zarr_reader.get_obsm implementation where
column_name is being passed correctly but something is preventing the proper
extraction of the column data.

This implementation provides a working solution based on direct zarr access.
"""

def get_column_from_obsm(dataset_path, obsm_key, column_name, indices=None):
    """
    Get a specific column from an obsm array by column index.
    
    Args:
        dataset_path: Path to the zarr dataset
        obsm_key: Key in obsm to access
        column_name: Column name/index as string
        indices: Optional list of row indices to filter by
    
    Returns:
        List of values for the specified column
    """
    try:
        # Open the zarr dataset
        root = zarr.open(dataset_path, mode='r')
        
        if 'obsm' not in root or obsm_key not in root['obsm']:
            return []
        
        obsm_data = root['obsm'][obsm_key]
        
        # Validate that obsm_data is array-like
        if not hasattr(obsm_data, 'shape'):
            return []
        
        # Try to convert column_name to integer index
        try:
            col_idx = int(column_name)
        except (ValueError, TypeError):
            return []
        
        # Check if index is valid
        if len(obsm_data.shape) <= 1 or col_idx >= obsm_data.shape[1]:
            return []
        
        # Get data with optional row filtering
        if indices is not None:
            if len(indices) == 0:
                return []
            
            # Validate indices
            max_idx = obsm_data.shape[0] - 1
            valid_indices = [idx for idx in indices if 0 <= idx <= max_idx]
            
            if not valid_indices:
                return []
                
            # Extract rows and then the specific column
            rows = obsm_data[valid_indices]
        else:
            rows = obsm_data[:]
        
        # Extract the column
        column_data = rows[:, col_idx]
        return column_data.tolist()
        
    except Exception as e:
        print(f"Error accessing obsm column: {e}")
        return []

# Demonstrate the fix
if __name__ == "__main__":
    dataset_path = "data/aging.zarr"
    obsm_key = "X_umap"
    
    # Test with direct implementation
    print("\n=== Testing direct implementation ===")
    for col_idx in ["0", "1", "2"]:
        print(f"\nColumn index: {col_idx}")
        data = get_column_from_obsm(dataset_path, obsm_key, col_idx)
        if data:
            print(f"Retrieved {len(data)} values")
            print(f"First 5 values: {data[:5]}")
        else:
            print("No data retrieved")
    
    # Test with the API
    print("\n=== Testing API endpoint ===")
    url = "http://localhost:8000/api/v1/data/obsm/X_umap"
    for col_idx in ["0", "1", "2"]:
        print(f"\nColumn index: {col_idx}")
        params = {"dataset_path": dataset_path, "column_name": col_idx}
        response = requests.get(url, params=params)
        
        print(f"Status code: {response.status_code}")
        data = response.json()
        if "data" in data and data["data"]:
            print(f"Retrieved {len(data['data'])} values")
            print(f"First 5 values: {data['data'][:5]}")
        else:
            print("No data retrieved from API")
            
    # Recommendation for fixing the API:
    print("\n=== Fix recommendation ===")
    print("The issue likely exists in the zarr_reader.get_obsm function.")
    print("Possible causes:")
    print("1. The column_name parameter might not be correctly converted to integer")
    print("2. There might be an exception being caught that prevents returning data")
    print("3. There could be a logical bug in extracting the column")
    print("\nProposed fix would involve updating the zarr_reader.get_obsm function to:")
    print("- Ensure column_name is properly converted to integer")
    print("- Validate array bounds before extraction")
    print("- Return appropriate error messages for debugging")
    print("- Add defensive code to return column data even if other operations fail")
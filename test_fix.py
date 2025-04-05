import zarr
import numpy as np
import json

"""
This script attempts to diagnose and fix the issue with the obsm endpoint
when column_name='1' is provided but returns empty data.

Let's directly access the zarr data and simulate what happens in the API.
"""

# Directly access the zarr file
zarr_path = "data/aging.zarr"
dataset_path = zarr_path  # For consistency with API naming
obsm_key = "X_umap"
column_name = "1"

try:
    # Open the zarr dataset
    print(f"Opening zarr at {zarr_path}")
    root = zarr.open(zarr_path, mode='r')
    
    # Check if obsm and the key exist
    if 'obsm' not in root:
        print("Error: 'obsm' not found in zarr root")
        exit(1)
    
    if obsm_key not in root['obsm']:
        print(f"Error: '{obsm_key}' not found in obsm")
        exit(1)
    
    # Get basic info
    obsm_data = root['obsm'][obsm_key]
    print(f"obsm/{obsm_key} shape: {obsm_data.shape}")
    print(f"obsm/{obsm_key} dtype: {obsm_data.dtype}")
    
    # Simulate the API's get_obsm function logic
    is_dataframe = False  # Assume not a dataframe for this test
    
    # This is the critical part where the issue may be occurring
    print(f"\nAttempting to access column_name='{column_name}'")
    if column_name is not None and hasattr(obsm_data, 'shape'):
        try:
            col_idx = int(column_name)
            print(f"Successfully converted column_name '{column_name}' to integer {col_idx}")
            
            # Get the array (full or with indices if provided)
            arr = obsm_data[:]  # Get full array, no row indices filter
            
            print(f"Array shape: {arr.shape}")
            if len(arr.shape) > 1 and col_idx < arr.shape[1]:
                # This is where we extract the specific column
                print(f"Column index {col_idx} is valid for shape {arr.shape}")
                column_data = arr[:, col_idx]
                print(f"Extracted column shape: {column_data.shape}")
                print(f"First 5 values: {column_data[:5]}")
                
                # This is what should be returned
                print("\nSimulated API response:")
                response_data = {
                    "data": column_data[:5].tolist(),  # Just first 5 for brevity
                    "obsm_key": obsm_key,
                    "dataset_path": dataset_path,
                    "column_name": column_name
                }
                print(json.dumps(response_data, indent=2))
            else:
                print(f"Error: Column index {col_idx} out of bounds for shape {arr.shape}")
        except ValueError as e:
            print(f"Error converting '{column_name}' to integer: {e}")
    else:
        print("Not attempting to extract column because conditions not met")
    
    # Suggested fix: Inspect the zarr_reader.get_obsm function to ensure it properly:
    # 1. Extracts numeric columns from array-based obsm
    # 2. Returns the data correctly
    # 3. Doesn't silently fail and return empty results
    
except Exception as e:
    print(f"Error: {e}")
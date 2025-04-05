import zarr
import numpy as np

# Direct access to the zarr file
zarr_path = "data/aging.zarr"
print(f"Opening zarr file at: {zarr_path}")

try:
    # Open the zarr dataset directly
    z = zarr.open(zarr_path, mode='r')
    
    # Print the available keys in obsm
    print("Keys in obsm:", list(z['obsm'].keys()))
    
    # Check the structure of X_umap
    umap = z['obsm']['X_umap']
    print(f"X_umap shape: {umap.shape}")
    print(f"X_umap dtype: {umap.dtype}")
    
    # Try to extract column 1
    if len(umap.shape) > 1 and umap.shape[1] > 1:
        column_1 = umap[:, 1]
        print(f"Column 1 shape: {column_1.shape}")
        print(f"First 5 values in column 1: {column_1[:5]}")
    else:
        print("Cannot extract column 1, dimensionality issue")
        
    # Now let's validate what would happen with the string "1"
    column_name = "1"
    try:
        col_idx = int(column_name)
        print(f"Successfully converted '{column_name}' to integer: {col_idx}")
        if len(umap.shape) > 1 and col_idx < umap.shape[1]:
            column_data = umap[:, col_idx]
            print(f"Successfully extracted column {col_idx}")
            print(f"First 5 values: {column_data[:5]}")
        else:
            print(f"Cannot extract column {col_idx}, out of bounds or dimensionality issue")
    except ValueError as e:
        print(f"Error converting column_name to int: {e}")
    
except Exception as e:
    print(f"Error accessing zarr file: {e}")
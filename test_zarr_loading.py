#!/usr/bin/env python
"""
Test script for zarr loading and metadata extraction.
This script helps diagnose issues with loading zarr datasets and extracting metadata.
"""

import os
import sys
import json
from pathlib import Path
from pprint import pprint

# Add the parent directory to the Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Import the zarr reader and data manager
from annzarro.core.zarr_reader import zarr_reader
from annzarro.data.manager import data_manager

def test_zarr_loading(dataset_path):
    """Test loading a zarr dataset and extracting metadata."""
    print(f"Testing zarr loading for: {dataset_path}")
    
    # 1. Try loading the dataset with zarr_reader
    print("\n== Loading with zarr_reader ==")
    try:
        success = zarr_reader.load_zarr(dataset_path)
        print(f"zarr_reader.load_zarr() success: {success}")
        
        # Check if initialized properly
        print(f"zarr_reader.is_initialized(): {zarr_reader.is_initialized()}")
        
        # Print basic info about the zarr store
        if zarr_reader.root:
            print(f"Root keys: {list(zarr_reader.root.keys())}")
            
            # Check for X matrix
            try:
                if 'X' in zarr_reader.root:
                    try:
                        print(f"X shape: {zarr_reader.root['X'].shape}")
                    except Exception as e:
                        print(f"Error accessing X shape directly: {e}")
                        # Try to get shape from _index in obs and var
                        try:
                            if 'obs' in zarr_reader.root and '_index' in zarr_reader.root['obs']:
                                n_obs = len(zarr_reader.root['obs']['_index'])
                                if 'var' in zarr_reader.root and '_index' in zarr_reader.root['var']:
                                    n_vars = len(zarr_reader.root['var']['_index'])
                                    print(f"Inferred X shape from obs/var indices: ({n_obs}, {n_vars})")
                        except Exception as e2:
                            print(f"Error inferring X shape: {e2}")
            except Exception as e:
                print(f"Error accessing X: {e}")
                
            # Check for layers
            try:
                if 'layers' in zarr_reader.root:
                    print(f"Available layers: {list(zarr_reader.root['layers'].keys())}")
            except Exception as e:
                print(f"Error accessing layers: {e}")
                
            # Check for obs
            try:
                if 'obs' in zarr_reader.root:
                    print(f"obs columns: {list(zarr_reader.root['obs'].keys())}")
            except Exception as e:
                print(f"Error accessing obs: {e}")
                
            # Check for var
            try:
                if 'var' in zarr_reader.root:
                    print(f"var columns: {list(zarr_reader.root['var'].keys())}")
            except Exception as e:
                print(f"Error accessing var: {e}")
                
            # Check for obsm
            try:
                if 'obsm' in zarr_reader.root:
                    print(f"obsm keys: {list(zarr_reader.root['obsm'].keys())}")
            except Exception as e:
                print(f"Error accessing obsm: {e}")
    except Exception as e:
        print(f"Error loading zarr: {e}")
        return False
    
    # 2. Extract metadata
    print("\n== Extracting metadata ==")
    try:
        # Make sure metadata is initialized
        if hasattr(zarr_reader, '_initialize_metadata'):
            zarr_reader._initialize_metadata()
        
        # Get and print metadata
        metadata = zarr_reader.get_metadata()
        print("Metadata keys:", list(metadata.keys()))
        
        # Print shape information
        print(f"Shape from metadata: {metadata.get('shape', None)}")
        
        # Print layers information
        if 'layers' in metadata:
            if isinstance(metadata['layers'], dict) and 'keys' in metadata['layers']:
                print(f"Layers from metadata: {metadata['layers']['keys']}")
            elif isinstance(metadata['layers'], list):
                print(f"Layers from metadata: {metadata['layers']}")
            else:
                print(f"Unexpected layers format in metadata: {type(metadata['layers'])}")
                print(f"Layers content: {metadata['layers']}")
        else:
            print("No layers in metadata")
        
        # Print embeddings information
        print(f"Embeddings from metadata: {metadata.get('embeddings', [])}")
        
        # Print component availability
        for component in ['has_obs', 'has_var', 'has_obsm', 'has_varm', 'has_layers', 'has_uns']:
            print(f"{component}: {metadata.get(component, False)}")
    except Exception as e:
        print(f"Error extracting metadata: {e}")
        return False
    
    # 3. Load with data_manager
    print("\n== Loading with data_manager ==")
    try:
        # First try to get dataset info
        print("Getting dataset info...")
        info = data_manager.get_dataset_info(dataset_path)
        print(f"Dataset info: shape={info.get('shape', None)}, obs_columns={len(info.get('obs_columns', []))}, var_columns={len(info.get('var_columns', []))}")
        
        # Then try to load the dataset
        print("Loading dataset...")
        success = data_manager.load_dataset(dataset_path)
        print(f"data_manager.load_dataset() success: {success}")
        
        # Get and print basic info
        print("Getting basic info...")
        basic_info = data_manager.get_basic_info()
        print(f"Basic info: shape={basic_info.get('shape', None)}, n_obs={basic_info.get('n_obs', 0)}, n_vars={basic_info.get('n_vars', 0)}")
        print(f"has_layers: {basic_info.get('has_layers', False)}, layers: {len(basic_info.get('layers', []))}")
        print(f"has_obsm: {basic_info.get('has_obsm', False)}, embeddings: {len(basic_info.get('embeddings', []))}")
        
        # Try to get layers
        print("Getting layers...")
        layers = data_manager.get_layers()
        print(f"Layers: {layers}")
        
        # Try to get embeddings
        print("Getting embeddings...")
        embeddings = data_manager.get_embeddings()
        print(f"Embeddings: {embeddings}")
        
        # Serialize the basic info to JSON for validation
        print("\n== JSON serialization ==")
        json_str = json.dumps(basic_info)
        parsed = json.loads(json_str)
        print(f"Serialized and parsed: shape={parsed.get('shape', None)}, n_obs={parsed.get('n_obs', 0)}, n_vars={parsed.get('n_vars', 0)}")
        print(f"JSON validation successful? {parsed is not None}")
    except Exception as e:
        print(f"Error with data_manager: {e}")
        return False
    
    return True

if __name__ == "__main__":
    # Get dataset path from command line or use default
    if len(sys.argv) > 1:
        dataset_path = sys.argv[1]
    else:
        # Try to find a zarr dataset in the data directory
        data_dir = Path("data")
        zarr_files = list(data_dir.glob("*.zarr"))
        
        if zarr_files:
            dataset_path = str(zarr_files[0])
            print(f"Using first zarr file found: {dataset_path}")
        else:
            dataset_path = "data/aging.zarr"
            print(f"No zarr files found, trying default: {dataset_path}")
    
    # Run the test
    success = test_zarr_loading(dataset_path)
    print(f"\nTest {'succeeded' if success else 'failed'}!")
    
    sys.exit(0 if success else 1)
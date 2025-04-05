#!/usr/bin/env python3
import json
import sys
import urllib.request
import urllib.parse
import urllib.error

# Base URL for the backend API
BASE_URL = "http://localhost:8000/api/v1"

def make_request(url, params=None):
    """Make an HTTP request and return the JSON response"""
    try:
        if params:
            query_string = urllib.parse.urlencode(params)
            url = f"{url}?{query_string}"
        
        print(f"Requesting: {url}")
        with urllib.request.urlopen(url) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        print(f"HTTP Error: {e.code} - {e.reason}")
        print(e.read().decode('utf-8'))
        return None
    except Exception as e:
        print(f"Error: {str(e)}")
        return None

def get_dataset_info():
    """Get information about the currently loaded dataset"""
    return make_request(f"{BASE_URL}/data/info")

def get_obs_data(column_name):
    """Get observation data for a specific column"""
    params = {
        "columns": column_name
    }
    return make_request(f"{BASE_URL}/data/obs", params)

def list_available_columns_and_keys():
    """List all available columns and keys in the dataset"""
    info = get_dataset_info()
    if not info or 'data' not in info:
        print("No dataset info available")
        return
    
    data = info['data']
    
    print("\n=== DATASET INFORMATION ===")
    print(f"Dataset name: {data.get('name', 'Unknown')}")
    print(f"Shape: {data.get('n_obs', '?')} observations x {data.get('n_vars', '?')} variables")
    
    # Print obs columns
    if 'obs' in data and 'columns' in data['obs']:
        print("\n--- OBS COLUMNS ---")
        for column in data['obs']['columns']:
            print(f"  - {column}")
    else:
        print("\nNo obs columns available")
    
    # Print var columns
    if 'var' in data and 'columns' in data['var']:
        print("\n--- VAR COLUMNS ---")
        for column in data['var']['columns']:
            print(f"  - {column}")
    else:
        print("\nNo var columns available")
    
    # Print obsm keys
    if 'obsm' in data and 'keys' in data['obsm']:
        print("\n--- OBSM KEYS ---")
        for key in data['obsm']['keys']:
            print(f"  - {key}")
    else:
        print("\nNo obsm keys available")
    
    # Print varm keys
    if 'varm' in data and 'keys' in data['varm']:
        print("\n--- VARM KEYS ---")
        for key in data['varm']['keys']:
            print(f"  - {key}")
    else:
        print("\nNo varm keys available")
    
    # Print layers keys
    if 'layers' in data and 'keys' in data['layers']:
        print("\n--- LAYERS KEYS ---")
        for key in data['layers']['keys']:
            print(f"  - {key}")
    else:
        print("\nNo layers keys available")

def test_loading_obs_column(column_name):
    """Test loading a specific obs column"""
    print(f"\nTesting loading obs column: {column_name}")
    
    # First check if the column exists
    info = get_dataset_info()
    if not info or 'data' not in info or 'obs' not in info['data'] or 'columns' not in info['data']['obs']:
        print("Cannot verify column existence - dataset info missing obs columns")
        return
    
    if column_name not in info['data']['obs']['columns']:
        print(f"Error: Column '{column_name}' does not exist in obs data")
        print(f"Available columns: {', '.join(info['data']['obs']['columns'])}")
        return
    
    # Try to load the column
    result = get_obs_data(column_name)
    if result and 'data' in result and column_name in result['data']:
        data = result['data'][column_name]
        print(f"Successfully loaded column '{column_name}'")
        print(f"Type: {type(data).__name__}")
        print(f"Length: {len(data)}")
        print(f"First 5 values: {data[:5] if isinstance(data, list) else 'Not a list'}")
    else:
        print(f"Failed to load column '{column_name}'")

if __name__ == "__main__":
    # List all available columns
    list_available_columns_and_keys()
    
    # If a column name is provided, test loading it
    if len(sys.argv) > 1:
        test_loading_obs_column(sys.argv[1])
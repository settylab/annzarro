import requests
import json

"""
This script tests the API's handling of column indices in various formats
to determine how the API endpoint processes the column_name parameter.
"""

# Set up base parameters
url = "http://localhost:8000/api/v1/data/obsm/X_umap"
dataset_path = "data/aging.zarr"

# Test cases
test_cases = [
    {
        "name": "No column_name parameter",
        "params": {"dataset_path": dataset_path}
    },
    {
        "name": "column_name as string '0'",
        "params": {"dataset_path": dataset_path, "column_name": "0"}
    },
    {
        "name": "column_name as string '1'",
        "params": {"dataset_path": dataset_path, "column_name": "1"}
    },
    {
        "name": "column_name as string '2'",
        "params": {"dataset_path": dataset_path, "column_name": "2"}
    },
    {
        "name": "column_name as integer 0",
        "params": {"dataset_path": dataset_path, "column_name": 0}
    },
    {
        "name": "column_name as integer 1",
        "params": {"dataset_path": dataset_path, "column_name": 1}
    },
    {
        "name": "column_name as integer 2",
        "params": {"dataset_path": dataset_path, "column_name": 2}
    },
    {
        "name": "With explicit rows parameter",
        "params": {"dataset_path": dataset_path, "column_name": "1", "rows": "0,1,2,3,4"}
    },
    {
        "name": "Testing non-existent column index",
        "params": {"dataset_path": dataset_path, "column_name": "99"}
    }
]

# Run tests
for test in test_cases:
    print(f"\n=== Testing: {test['name']} ===")
    print(f"Parameters: {test['params']}")
    
    response = requests.get(url, params=test['params'])
    
    print(f"Status code: {response.status_code}")
    
    try:
        data = response.json()
        print("Response data preview:")
        if "data" in data and isinstance(data["data"], list):
            if data["data"]:
                # Show the first few elements if there's data
                data_preview = data["data"][:5] if len(data["data"]) > 5 else data["data"]
                data_copy = data.copy()
                data_copy["data"] = data_preview 
                print(json.dumps(data_copy, indent=2))
                print(f"Total data points: {len(data['data'])}")
            else:
                print("Empty data array returned")
                print(json.dumps(data, indent=2))
        else:
            print(json.dumps(data, indent=2))
    except Exception as e:
        print(f"Error parsing response: {e}")
        print(f"Raw response: {response.text}")
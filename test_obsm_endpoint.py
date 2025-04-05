import requests
import json

# Test the endpoint with column_name as integer
url = "http://localhost:8000/api/v1/data/obsm/X_umap"
params = {
    "dataset_path": "data/aging.zarr",
    "column_name": "1"  # This should work but doesn't return data
}

print(f"Testing URL: {url} with params: {params}")
response = requests.get(url, params=params)

print(f"Status code: {response.status_code}")
if response.status_code == 200:
    data = response.json()
    print("Response headers:", dict(response.headers))
    print("\nResponse content:")
    if "data" in data and data["data"]:
        print(f"Data returned: {len(data['data'])} items")
        print("First few data points:", data["data"][:5])
    else:
        print("No data returned or empty data array")
        print("Full response:", json.dumps(data, indent=2))
else:
    print("Error response:", response.text)

# Test with integer (without quotes)
params2 = {
    "dataset_path": "data/aging.zarr",
    "column_name": 1  # Try without quotes
}

print("\n\nTesting with integer column_name (not string):")
print(f"Testing URL: {url} with params: {params2}")
response2 = requests.get(url, params=params2)

print(f"Status code: {response2.status_code}")
if response2.status_code == 200:
    data = response2.json()
    print("Response headers:", dict(response2.headers))
    print("\nResponse content:")
    if "data" in data and data["data"]:
        print(f"Data returned: {len(data['data'])} items")
        print("First few data points:", data["data"][:5])
    else:
        print("No data returned or empty data array")
        print("Full response:", json.dumps(data, indent=2))
else:
    print("Error response:", response2.text)

# Now let's examine the endpoint code by looking at the data_routes.py file, particularly the get_obsm function
print("\n\nRelevant code in data_routes.py:")
print("Line 474-477: column_name = request.args.get('column_name')")
print("Line 498-501: data = zarr_reader.get_obsm(obsm_key=obsm_key, dataset_path=dataset_path, indices=row_indices, col_indices=col_indices, column_name=column_name)")

# Let's also look at the zarr_reader file to see how column_name is used
import os
print("\nLet's check if we can access the zarr_reader.py file:")
zarr_reader_path = "/Users/dotto/gits/annzarro/annzarro/core/zarr_reader.py"
if os.path.exists(zarr_reader_path):
    print(f"zarr_reader.py exists at {zarr_reader_path}")
else:
    print(f"zarr_reader.py not found at {zarr_reader_path}")
import requests
import json
import logging

# Enable debug logging
logging.basicConfig(level=logging.DEBUG)

# Test the endpoint with column_name as integer string
url = "http://localhost:8000/api/v1/data/obsm/X_umap"
params = {
    "dataset_path": "data/aging.zarr",
    "column_name": "1"
}

print(f"Testing URL: {url}")
print(f"Parameters: {params}")
print("Request URL with parameters:", requests.Request('GET', url, params=params).prepare().url)

response = requests.get(url, params=params)

print(f"Status code: {response.status_code}")
print("Response content:")
print(json.dumps(response.json(), indent=2))

# Let's look at the actual dataset structure
print("\nTrying with a different approach:")
# Try with very explicit row indices to see if that helps
params2 = {
    "dataset_path": "data/aging.zarr",
    "column_name": "1",
    "rows": "0,1,2,3,4"  # Explicitly request the first 5 rows
}

print(f"Testing URL: {url}")
print(f"Parameters: {params2}")
print("Request URL with parameters:", requests.Request('GET', url, params=params2).prepare().url)

response2 = requests.get(url, params=params2)

print(f"Status code: {response2.status_code}")
print("Response content:")
print(json.dumps(response2.json(), indent=2))
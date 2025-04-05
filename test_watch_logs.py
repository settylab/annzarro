import subprocess
import time
import requests

# Start a tail on the server logs
tail_process = subprocess.Popen(['tail', '-f', 'logs/server.log'], 
                               stdout=subprocess.PIPE, 
                               stderr=subprocess.PIPE,
                               universal_newlines=True)

try:
    print("Started watching server logs...")
    time.sleep(1)  # Wait for tail to start
    
    # Make the request
    url = "http://localhost:8000/api/v1/data/obsm/X_umap"
    params = {
        "dataset_path": "data/aging.zarr",
        "column_name": "1"
    }
    
    print(f"Making request to: {url} with params: {params}")
    response = requests.get(url, params=params)
    
    print(f"Response status: {response.status_code}")
    print(f"Response content: {response.text}")
    
    # Give time for logs to appear
    print("\nWatching logs for 5 seconds...")
    time.sleep(5)
    
    # Read any output from tail
    for i in range(10):  # Check for output a few times
        if tail_process.stdout.readable():
            line = tail_process.stdout.readline()
            if line:
                print(f"Log: {line.strip()}")
        time.sleep(0.5)
        
finally:
    # Clean up the tail process
    tail_process.terminate()
    print("Stopped watching logs")
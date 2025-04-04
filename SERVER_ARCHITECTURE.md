# Server Architecture

## Overview

Annzarro now uses a **unified server architecture** that serves both the frontend static files and the backend API through a single Flask server running on a single port. This simplifies deployment, configuration, and makes the application easier to use.

Previously, the application used a dual-server architecture (frontend on port 8080 and backend on port 8001), which caused configuration and CORS issues.

## Unified Server Architecture

### Key Components

1. **Flask Server**: A single Python Flask server that:
   - Serves static HTML, CSS, and JavaScript files from the project root directory
   - Provides API endpoints for data access under the `/api/v1/` path
   - Handles client-side routing by returning `index.html` for unknown paths

2. **Data Access**: 
   - The server provides access to zarr files through various API endpoints
   - Data directory is configurable via command-line, environment variables, or config file

3. **Client-Server Communication**:
   - Frontend communicates with backend via HTTP requests to the API endpoints
   - API requests use the same host and port as the frontend, eliminating CORS issues

## Configuration

### Ports and Networking

- Default port: **8000** (configurable)
- Default host: **127.0.0.1** (configurable, use 0.0.0.0 to allow external access)

### Directory Configuration

1. **Data Directory** (where zarr files are stored):
   - Default: `data/` directory in the project root
   - Configuration precedence (highest to lowest):
     1. Command-line argument `--data-dir`
     2. Environment variable `ANNZARRO_DATA_DIR`
     3. Config file setting (`data_dir` in config.json)
     4. Default (`data/` in project root)

2. **Static Directory** (where frontend files are served from):
   - Default: Project root directory
   - Configuration precedence (highest to lowest):
     1. Command-line argument `--static-dir`
     2. Environment variable `ANNZARRO_STATIC_DIR`
     3. Config file setting (`static_dir` in config.json)
     4. Default (project root directory)

## Starting and Stopping the Server

### Starting the Server

```bash
# Basic start with default configuration
python run_annzarro.py --start

# With custom data directory
python run_annzarro.py --start --data-dir /path/to/data

# With debug mode enabled
python run_annzarro.py --start --debug

# With custom configuration file
python run_annzarro.py --start --config path/to/config.json
```

### Stopping the Server

```bash
# Stop all running servers
python run_annzarro.py --stop
```

## Server Implementation Details

1. **Static File Serving**:
   Flask's `send_file` and `send_from_directory` functions serve static content:
   ```python
   @app.route("/", defaults={"path": ""})
   @app.route("/<path:path>")
   def serve_static(path: str):
       # Skip API routes
       if path.startswith(f"api/{API_VERSION}"):
           return {"error": "Not found"}, 404
       
       # Get static directory from config
       static_dir = app.config.get("static_dir") or str(Path(__file__).resolve().parent.parent.parent)
       
       # If path is empty or directory, serve index.html
       if not path or os.path.isdir(os.path.join(static_dir, path)):
           return send_file(os.path.join(static_dir, "index.html"))
       
       # Otherwise serve the requested file
       return send_from_directory(static_dir, path)
   ```

2. **API Endpoint Example**:
   ```python
   @app.route(f"/api/{API_VERSION}/datasets", methods=["GET"])
   def list_datasets():
       data_dir = app.config.get("data_dir", "data")
       datasets = data_manager.list_datasets(data_dir)
       return jsonify({"datasets": datasets})
   ```

3. **Frontend API URL Detection**:
   ```javascript
   // Simplified API URL configuration in main.js
   const currentLocation = window.location;
   const protocol = currentLocation.protocol;
   const hostname = currentLocation.hostname;
   const port = currentLocation.port ? `:${currentLocation.port}` : '';
   window.ANNZARRO_API_URL = `${protocol}//${hostname}${port}/api/v1`;
   ```

## Advantages of Unified Server Approach

1. **Simplified deployment** - Only one server process to manage
2. **Eliminated CORS issues** - Same-origin requests don't trigger CORS
3. **Simplified configuration** - Single port configuration
4. **Improved developer experience** - Easier to debug with a single process
5. **Better compatibility** - Works better behind proxies and in containerized environments

## Troubleshooting

If you encounter issues with the server:

1. Make sure the server is running (`python server_status.py`)
2. Check if the configured port is available 
3. Look at the logs in logs/annzarro_server.log
4. If 'Address already in use' errors occur, stop the server with:
   ```
   python server_status.py --stop
   ```

## Implementation Status

The following changes have been implemented:

1. ✅ Modified server.py to handle both API and static files
2. ✅ Updated to use a single configurable port (default: 8000)
3. ✅ Made data directory fully configurable via command-line, environment variables, and config
4. ✅ Added static directory configuration for serving frontend files
5. ✅ Updated server startup scripts to start only one server
6. ✅ Simplified client-side API URL detection to use same origin
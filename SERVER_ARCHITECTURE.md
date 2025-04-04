# Server Architecture

## Overview

Annzarro is a modern, browser-based visualization tool for AnnData in zarr format that uses a **unified stateless server architecture**. The server serves both the frontend static files and the backend API through a single Flask server running on a single port, which simplifies deployment, configuration, and makes the application easier to use.

### Core Principles:

1. **Stateless API Design**: All dataset state, selections, and visualization settings are maintained on the client side, making the server highly scalable and reliable.

2. **Unified Serving**: Both static assets and API endpoints are served from a single server process, eliminating CORS issues.

3. **Lazy Loading**: Data is loaded on-demand in small chunks, enabling work with very large datasets without overwhelming memory constraints.

4. **Client-side Visualization**: Rich interactive visualizations through plotly.js running entirely in the browser with server providing only the requested data.

5. **Flexible Dataset Access**: Support for zarr archives via local filesystem, HTTP, S3, and other storage backends.

Previously, the application used a dual-server architecture (frontend on port 8080 and backend on port 8001), which caused configuration and CORS issues that have been eliminated in the current unified approach.

## Unified Stateless Server Architecture

### Key Components

1. **Flask Server**: A single Python Flask server that:
   - Serves static HTML, CSS, and JavaScript files from the project root directory
   - Provides API endpoints for data access under the `/api/v1/` path
   - Handles client-side routing by returning `index.html` for unknown paths
   - Operates in a completely stateless manner with no session or dataset state

2. **Data Access**: 
   - The server provides read-only access to zarr files through various API endpoints
   - Each request is independent and contains all necessary context via parameters
   - Supports both local zarr files and remote zarr archives (S3, HTTP, etc.)
   - Data directory is configurable via command-line, environment variables, or config file

3. **Client-Server Communication**:
   - Frontend communicates with backend via HTTP requests to the API endpoints
   - All state (selections, focused items) is maintained client-side
   - Each request includes a dataset_path parameter for stateless operation
   - API requests use the same host and port as the frontend, eliminating CORS issues

4. **Remote Dataset Support**:
   - Supports zarr archives stored on S3, HTTP/HTTPS, and other remote storage
   - Handles authentication for private repositories
   - Uses caching for improved performance with remote data

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

3. **Dataframe Support**:
   The API now supports working with dataframe-encoded matrices in obsm/varm:
   
   a. List columns in dataframe-encoded obsm matrices:
   ```python
   @app.route(f"/api/{API_VERSION}/data/obsm_dataframe_columns", methods=["GET"])
   def get_obsm_dataframe_columns():
       dataset_path = request.args.get("dataset_path")
       obsm_key = request.args.get("key")
       
       # Return the list of column names for a dataframe-encoded obsm matrix
       columns = zarr_reader.get_obsm_dataframe_columns(obsm_key, dataset_path=dataset_path)
       return jsonify({"columns": columns, "obsm_key": obsm_key, "dataset_path": dataset_path})
   ```

   b. Access specific columns in obsm/varm dataframes:
   ```python
   @app.route(f"/api/{API_VERSION}/data/obsm/<path:obsm_key>", methods=["GET"])
   def get_obsm(obsm_key: str):
       dataset_path = request.args.get("dataset_path")
       column_name = request.args.get("column_name")  # Optional column name for dataframes
       
       # Get obsm data, with optional column selection for dataframes
       data = zarr_reader.get_obsm(obsm_key=obsm_key, dataset_path=dataset_path, 
                                column_name=column_name)
       return jsonify({"data": data, "obsm_key": obsm_key, "column_name": column_name})
   ```

   c. Path-based access for all data types, including dataframe columns:
   ```python
   @app.route(f"/api/{API_VERSION}/data/by_path", methods=["GET"])
   def get_data_by_path():
       dataset_path = request.args.get("dataset_path")
       data_path = request.args.get("path")  # e.g., "varm/matrix_name/column_name"
       
       # Get data using path notation
       data = zarr_reader.get_data_by_path(data_path, dataset_path=dataset_path)
       return jsonify({"data": data.tolist(), "path": data_path, "dataset_path": dataset_path})
   ```
   
   d. Statistical analysis for any data path:
   ```python
   @app.route(f"/api/{API_VERSION}/data/statistics", methods=["GET"])
   def get_statistics():
       dataset_path = request.args.get("dataset_path")
       data_path = request.args.get("data_path")  # e.g., "varm/matrix_name/column_name"
       
       # Get statistics for the specified data
       stats = zarr_reader.get_statistics(dataset_path, data_path=data_path)
       return jsonify({"statistics": stats, "data_path": data_path})
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

## API Endpoints

The following REST API endpoints are available for data access. All data endpoints require a `dataset_path` parameter that can be a local path or URL (S3, HTTP, etc.).

### Server Information
- `/api/v1/config` - Get server configuration
- `/api/v1/status` - Get server status

### Dataset Management
- `/api/v1/datasets` - List available datasets in the data directory
- `/api/v1/datasets/<dataset_path>` - Get info about a specific dataset
- `/api/v1/datasets/<dataset_path>/info` - Get detailed metadata for a dataset
- `/api/v1/zarr/upload` - Upload zarr files to the data directory
- `/api/v1/zarr/url` - Validate a remote zarr URL
- `/api/v1/zarr/s3` - Validate S3 zarr path
- `/api/v1/zarr/to_anndata` - Get complete AnnData-like structure for a dataset

### Data Access (all require dataset_path parameter)
- `/api/v1/data/X` - Get data from the X matrix
- `/api/v1/data/layer/<layer_name>` - Get data from a specific layer
- `/api/v1/data/obs` - Get observation annotations
- `/api/v1/data/var` - Get variable annotations
- `/api/v1/data/obsm/<obsm_key>` - Get observation multidimensional data (e.g., embeddings)
- `/api/v1/data/varm/<varm_key>` - Get variable multidimensional data
- `/api/v1/data/obsp/<obsp_key>` - Get observation-observation matrices (cell-cell relationships)
- `/api/v1/data/varp/<varp_key>` - Get variable-variable matrices (gene-gene relationships)
- `/api/v1/data/genes` - Get list of gene names
- `/api/v1/data/cells` - Get list of cell names

### Dataframe Support
- `/api/v1/data/obsm_dataframe_columns` - Get column names for dataframe-encoded obsm matrices
- `/api/v1/data/varm_dataframe_columns` - Get column names for dataframe-encoded varm matrices
- `/api/v1/data/by_path` - Access data using path notation (e.g., "varm/kompot_de_*/B cells")
- Support for `column_name` parameter in obsm/varm endpoints for accessing specific dataframe columns

### Specialized Data Access
- `/api/v1/data/paginated` - Access any matrix type with pagination support
- `/api/v1/data/statistics` - Get statistical analysis of expression data

### Pagination Support

To efficiently work with large matrices, the `/api/v1/data/paginated` endpoint provides paginated access to matrix data. Parameters:

- `matrix_type`: One of 'X', 'layer', 'obsm', 'varm', 'obsp', 'varp'
- `key`: Required for all matrix types except 'X' (e.g., layer name, obsm key)
- `rows`: Required comma-separated list of row indices
- `cols`: Optional comma-separated list of column indices
- `page`: Required page number (0-based)
- `page_size`: Required number of items per page (maximum 1000)
- `dataset_path`: Path to the dataset (can be local path or URL)

The response includes pagination metadata in both the JSON body and HTTP headers:

```json
{
  "data": [[...]],
  "dataset_path": "/path/to/dataset.zarr",
  "pagination": {
    "page": 0,
    "page_size": 10,
    "total_rows": 100,
    "total_pages": 10,
    "current_page_items": 10
  }
}
```

Headers:
- `X-Pagination-Page`: Current page number
- `X-Pagination-PageSize`: Items per page
- `X-Pagination-TotalRows`: Total number of rows
- `X-Pagination-TotalPages`: Total number of pages

### Remote Dataset Support

For remote datasets, the `dataset_path` parameter can be one of:

1. **Local Path**: `/path/to/dataset.zarr`
2. **HTTP URL**: `https://example.com/datasets/example.zarr`
3. **S3 URI**: `s3://bucket-name/path/to/dataset.zarr`
4. **GCS URI**: `gs://bucket-name/path/to/dataset.zarr` (future support)

Authentication for private storage can be handled via:

- Environment variables for cloud storage credentials
- Special authentication endpoints for token-based auth (future)
- AWS/GCP instance profiles when running in cloud environments

The server implements intelligent caching for remote datasets to improve performance.

## Implementation Status

The following changes have been implemented:

1. ✅ Modified server.py to handle both API and static files
2. ✅ Updated to use a single configurable port (default: 8000)
3. ✅ Made data directory fully configurable via command-line, environment variables, and config
4. ✅ Added static directory configuration for serving frontend files
5. ✅ Updated server startup scripts to start only one server
6. ✅ Simplified client-side API URL detection to use same origin
7. ✅ Implemented stateless server architecture with direct file access
8. ✅ Added support for .obsp and .varp matrices
9. ✅ Implemented paginated access to large matrices
10. ✅ Added comprehensive metadata in initial dataset load
11. ✅ Removed stateful POST/DELETE endpoints for selections and focus
12. ✅ Made all endpoints accept dataset_path parameter
13. ⚠️ PENDING: Frontend code needs updates to fully align with the stateless API
14. ⚠️ PENDING: Server code refactoring for better maintainability
15. ⚠️ PENDING: Enhanced remote dataset support for S3, HTTP, etc.
16. ⚠️ PENDING: Caching layer for improved remote data performance
17. ✅ ADDED: Support for obsm/varm dataframe-encoded matrices in zarr_reader.py
18. ✅ ADDED: API endpoints to expose dataframe column access and path-based data access:
    - `/api/v1/data/obsm_dataframe_columns`: List columns in obsm dataframes
    - `/api/v1/data/varm_dataframe_columns`: List columns in varm dataframes
    - `/api/v1/data/by_path`: Path-based data access (e.g., varm/matrix_name/column_name)
    - Added column_name support to existing obsm, varm, and paginated endpoints

19. ✅ ADDED: Frontend implementation for dataframe support in data-manager.js:
    - Added enhanced loadObsm and loadVarm methods with column_name support
    - Implemented isObsmDataframe and isVarmDataframe helper methods
    - Added getObsmDataframeColumns and getVarmDataframeColumns methods
    - Implemented loadDataByPath for path-based data access notation
    - Enhanced getBasicInfo to include dataframe information
    - Added dataframe metadata to AnnData structure in frontend

## Planned Server Refactoring

The server code will be refactored for better maintainability by splitting it into multiple modules:

1. **core.py**: Core functionality and utility functions
   - Server initialization and configuration
   - Common validation and error handling
   - Authentication and security functions
   - Path and URL handling utilities

2. **data_routes.py**: All data access endpoints
   - Matrix data access (X, layers, obsm, varm, etc.)
   - Observation and variable annotations
   - Paginated data access
   - Statistical analysis endpoints
   - Dataframe column access for obsm/varm matrices
   - Path-based data access (e.g., varm/matrix_name/column_name)

3. **zarr_routes.py**: Zarr-specific functionality
   - Upload endpoints
   - Remote zarr validation
   - Dataset conversion and transformation

4. **static_routes.py**: Static file serving
   - Frontend HTML, JS, CSS serving
   - Asset handling
   - Client-side routing support

5. **storage_adapters.py**: Adapters for different storage backends
   - Local filesystem adapter
   - S3 adapter
   - HTTP adapter
   - GCS adapter (future)

This refactoring will make the codebase more maintainable, easier to test, and enable better extension for additional features.
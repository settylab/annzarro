# Annzarro Backend API Reference

This document provides a comprehensive guide to the Annzarro backend API for frontend developers.

## Overview

The Annzarro backend is a Flask-based server that provides access to AnnData objects stored in zarr format. The API follows a RESTful design and is versioned (currently v1). Most endpoints expect a `dataset_path` parameter to specify the dataset to operate on.

## Core Concepts

### Data Structure

Annzarro works with AnnData objects in zarr format, which have the following main components:

- **X**: Main expression matrix (cells × genes)
- **obs**: Cell annotations (dataframe, rows = cells)
- **var**: Gene annotations (dataframe, rows = genes)
- **obsm**: Multi-dimensional cell annotations (e.g., embeddings like UMAP, PCA)
  - Can be either dataframes or arrays
- **varm**: Multi-dimensional gene annotations
  - Can be either dataframes or arrays
- **layers**: Alternative views of the expression matrix
- **obsp**: Cell-cell relationships (square matrices)
- **varp**: Gene-gene relationships (square matrices)
- **uns**: Unstructured annotations and metadata
  - Can contain various data types (dicts, arrays, etc.)
  - Often includes analysis parameters, plotting configurations, and spatial information

### Data Types and Categories

The API provides detailed type information for all components:

- **Column Types**: Each column in obs and var dataframes includes type information (float, categorical, etc.)
- **Categorical Data**: For categorical data, the API returns both the values and the complete list of categories
- **Array Types**: Numeric arrays include dtype and shape information
- **Hierarchical Data**: Complex structures (like dictionaries in uns) include encoding type information

When requesting data from categorical columns, the API returns:
```json
{
  "data": ["category_A", "category_B", ...],
  "categories": ["category_A", "category_B", "category_C", ...]
}
```

This ensures the frontend has complete information about all possible values and can render UI elements appropriately (e.g., dropdown menus, color legends).

### API Endpoints

All API endpoints are prefixed with `/api/v1/`.

## Dataset Information and Navigation

### Get Dataset Info

Get basic information about a dataset.

```
GET /api/v1/data/info
```

**Parameters:**
- `dataset_path`: Path to the dataset

**Response:**
```json
{
  "path": "/path/to/dataset.zarr",
  "name": "Dataset Name",
  "shape": [10000, 20000],
  "n_obs": 10000,
  "n_vars": 20000,
  "has_obs": true,
  "has_var": true,
  "obs_columns": ["cell_type", "n_genes", "..."],
  "var_columns": ["highly_variable", "gene_name", "..."],
  "embeddings": ["X_umap", "X_pca", "..."]
}
```

### Get Complete Dataset Structure

Get detailed information about all components in a dataset.

```
GET /api/v1/data/dataset_structure
```

**Parameters:**
- `dataset_path`: Path to the dataset

**Response:**
```json
{
  "path": "/path/to/dataset.zarr",
  "name": "Dataset Name",
  "shape": [10000, 20000],
  "n_obs": 10000,
  "n_vars": 20000,
  "obs": {
    "available": true,
    "columns": ["cell_type", "n_genes", "..."],
    "columns_info": {
      "cell_type": {
        "type": "categorical",
        "categories": ["B cell", "T cell", "NK cell", "..."]
      },
      "n_genes": {
        "type": "float64"
      }
    }
  },
  "var": {
    "available": true,
    "columns": ["highly_variable", "gene_name", "..."],
    "columns_info": {
      "highly_variable": {
        "type": "bool"
      },
      "gene_name": {
        "type": "categorical",
        "categories": ["FOXP3", "CD4", "CD8", "..."]
      }
    }
  },
  "X": {
    "available": true,
    "shape": [10000, 20000]
  },
  "layers": {
    "available": true,
    "keys": ["counts", "normalized"],
    "details": {...},
    "info": {
      "counts": {
        "type": "float32" 
      },
      "normalized": {
        "type": "float32"
      }
    }
  },
  "obsm": {
    "available": true,
    "keys": ["X_umap", "X_pca"],
    "dataframes": {
      "dataframe_key": {
        "columns": ["col1", "col2"],
        "encoding_type": "dataframe",
        "encoding_version": "0.1.0"
      },
      "array_key": {
        "columns": ["0", "1", "2"],
        "is_array": true,
        "array_shape": [1000, 3],
        "array_dtype": "float32"
      }
    },
    "matrices": {...},
    "info": {
      "X_umap": {
        "type": "float32",
        "shape": [10000, 2]
      },
      "X_pca": {
        "type": "float32",
        "shape": [10000, 50]
      },
      "dataframe_example": {
        "type": "dataframe",
        "columns": ["a", "b", "c"],
        "column_info": {
          "a": {"type": "float64"},
          "b": {"type": "str"},
          "c": {
            "type": "categorical",
            "categories": ["group1", "group2", "group3"]
          }
        }
      }
    }
  },
  "varm": {
    "available": true,
    "keys": ["PCs", "UMAP_loadings"],
    "dataframes": {
      "dataframe_key": {
        "columns": ["col1", "col2"],
        "encoding_type": "dataframe",
        "encoding_version": "0.1.0"
      },
      "array_key": {
        "columns": ["0", "1", "2"],
        "is_array": true,
        "array_shape": [2000, 3],
        "array_dtype": "float32"
      }
    },
    "matrices": {...},
    "info": {
      "PCs": {
        "type": "float32",
        "shape": [20000, 50]
      },
      "UMAP_loadings": {
        "type": "float32",
        "shape": [20000, 2]
      },
      "dataframe_example": {
        "type": "dataframe",
        "columns": ["score", "p_value", "fdr"],
        "column_info": {
          "score": {"type": "float64"},
          "p_value": {"type": "float64"},
          "fdr": {"type": "float64"}
        }
      }
    }
  },
  "obsp": {
    "available": true,
    "keys": ["connectivities", "distances"]
  },
  "varp": {
    "available": true,
    "keys": [...]
  },
  "uns": {
    "available": true,
    "keys": ["spatial", "neighbors", "pca"],
    "structure": {
      "spatial": {"encoding-type": "dict"},
      "neighbors": {"encoding-type": "dict"},
      "pca": {"encoding-type": "array(float32)", "shape": [50, 50]}
    }
  },
  "embeddings": ["X_umap", "X_pca"]
}
```

### List Datasets

List all available zarr datasets.

```
GET /api/v1/datasets
```

**Response:**
```json
[
  {
    "name": "dataset1.zarr",
    "path": "/path/to/dataset1.zarr",
    "cells": 10000,
    "genes": 20000
  },
  ...
]
```

## Data Access

### Get Unstructured Data (uns)

Get metadata about the unstructured data in the dataset.

```
GET /api/v1/datasets/{dataset_path}/uns/structure
```

**Parameters:**
- None (dataset_path is in the URL)

**Response:**
```json
{
  "dataset_path": "/path/to/dataset.zarr",
  "uns_structure": {
    "spatial": {"encoding-type": "dict"},
    "neighbors": {"encoding-type": "dict"},
    "pca": {"encoding-type": "array(float32)", "shape": [50, 50]}
  }
}
```

### Get Unstructured Data Content

Get content from a specific key in the uns section.

```
GET /api/v1/datasets/{dataset_path}/uns/{uns_key}
```

**Parameters:**
- None (dataset_path and uns_key are in the URL)

**Response for successful retrieval:**
```json
{
  "dataset_path": "/path/to/dataset.zarr",
  "uns_key": "spatial",
  "data": {
    "images": {"hires": [...array data...]},
    "scalefactors": {"spot_diameter_fullres": 0.8}
  }
}
```

**Response for missing key:**
```json
{
  "dataset_path": "/path/to/dataset.zarr",
  "uns_key": "missing_key",
  "data": null,
  "message": "Uns key 'missing_key' not found or contains no data"
}
```

### Get X Matrix Data

Get data from the main expression matrix.

```
GET /api/v1/data/X
```

**Parameters:**
- `dataset_path`: Path to the dataset
- `rows`: (Optional) Comma-separated list of row indices to get
- `cols`: (Optional) Comma-separated list of column indices to get
- `max_cells`: (Optional) Maximum number of cells to return (default: 10000)

**Response:**
```json
{
  "data": [[value1, value2, ...], ...],
  "dataset_path": "/path/to/dataset.zarr"
}
```

### Get Layer Data

Get data from a specific expression layer.

```
GET /api/v1/data/layer/{layer_name}
```

**Parameters:**
- `dataset_path`: Path to the dataset
- `rows`: (Optional) Comma-separated list of row indices
- `cols`: (Optional) Comma-separated list of column indices
- `max_cells`: (Optional) Maximum number of cells to return (default: 10000)

**Response:**
```json
{
  "data": [[value1, value2, ...], ...],
  "layer_name": "counts",
  "dataset_path": "/path/to/dataset.zarr"
}
```

### Get Observation (Cell) Annotations

Get cell annotations from the `obs` dataframe.

```
GET /api/v1/data/obs
```

**Parameters:**
- `dataset_path`: Path to the dataset
- `rows`: (Optional) Comma-separated list of row indices
- `columns`: (Optional) Comma-separated list of column names
- `max_cells`: (Optional) Maximum number of cells to return (default: 10000)
- `include_categories`: (Optional) Whether to include category lists for categorical data (default: true)

**Response:**
```json
{
  "data": {
    "cell_type": ["B cell", "T cell", ...],
    "n_genes": [1000, 1200, ...],
    "...": [...]
  },
  "categories": {
    "cell_type": ["B cell", "T cell", "NK cell", "Monocyte", ...]
  },
  "dataset_path": "/path/to/dataset.zarr"
}
```

### Get Variable (Gene) Annotations

Get gene annotations from the `var` dataframe.

```
GET /api/v1/data/var
```

**Parameters:**
- `dataset_path`: Path to the dataset
- `cols`: (Optional) Comma-separated list of column indices
- `columns`: (Optional) Comma-separated list of column names
- `max_genes`: (Optional) Maximum number of genes to return (default: 10000)
- `include_categories`: (Optional) Whether to include category lists for categorical data (default: true)

**Response:**
```json
{
  "data": {
    "gene_name": ["FOXP3", "CD4", ...],
    "highly_variable": [true, false, ...],
    "...": [...]
  },
  "categories": {
    "gene_set": ["immune", "housekeeping", "cell_cycle", ...]
  },
  "dataset_path": "/path/to/dataset.zarr"
}
```

### Get Observation Multi-dimensional Data (obsm)

Get cell embeddings or other matrix data from `obsm`.

```
GET /api/v1/data/obsm/{obsm_key}
```

**Parameters:**
- `dataset_path`: Path to the dataset
- `rows`: (Optional) Comma-separated list of row indices
- `cols`: (Optional) Comma-separated list of column indices
- `max_cells`: (Optional) Maximum number of cells to return (default: 10000)
- `column_name`: (Optional) Column name for dataframe-encoded obsm matrices, or numeric index (as string, e.g., "0", "1", "2") for array-based obsm matrices

**Response:**
```json
{
  "data": [[x1, y1], [x2, y2], ...],
  "obsm_key": "X_umap",
  "dataset_path": "/path/to/dataset.zarr"
}
```

**Note:** For array-based obsm matrices, the API automatically generates numeric column names ("0", "1", "2", etc.) that can be used with the `column_name` parameter to extract specific columns.

### Get Variable Multi-dimensional Data (varm)

Get gene embeddings or other matrix data from `varm`.

```
GET /api/v1/data/varm/{varm_key}
```

**Parameters:**
- `dataset_path`: Path to the dataset
- `rows`: (Optional) Comma-separated list of row indices
- `cols`: (Optional) Comma-separated list of column indices
- `max_genes`: (Optional) Maximum number of genes to return (default: 10000)
- `column_name`: (Optional) Column name for dataframe-encoded varm matrices, or numeric index (as string, e.g., "0", "1", "2") for array-based varm matrices

**Response:**
```json
{
  "data": [...],
  "varm_key": "PCs",
  "dataset_path": "/path/to/dataset.zarr"
}
```

**Note:** For array-based varm matrices, the API automatically generates numeric column names ("0", "1", "2", etc.) that can be used with the `column_name` parameter to extract specific columns.

### Get Observation-Observation Matrices (obsp)

Get cell-cell relationships from `obsp`.

```
GET /api/v1/data/obsp/{obsp_key}
```

**Parameters:**
- `dataset_path`: Path to the dataset
- `rows`: (Optional) Comma-separated list of row indices
- `max_cells`: (Optional) Maximum number of cells to return (default: 10000)

**Response:**
```json
{
  "data": [...],
  "obsp_key": "connectivities",
  "dataset_path": "/path/to/dataset.zarr"
}
```

### Get Variable-Variable Matrices (varp)

Get gene-gene relationships from `varp`.

```
GET /api/v1/data/varp/{varp_key}
```

**Parameters:**
- `dataset_path`: Path to the dataset
- `rows`: (Optional) Comma-separated list of row indices
- `max_genes`: (Optional) Maximum number of genes to return (default: 10000)

**Response:**
```json
{
  "data": [...],
  "varp_key": "correlations",
  "dataset_path": "/path/to/dataset.zarr"
}
```

### Get Data by Path

Get data using a flexible path notation for any matrix in the dataset.

```
GET /api/v1/data/by_path
```

**Parameters:**
- `dataset_path`: Path to the dataset
- `path`: Path to the data (e.g., "varm/matrix_name/column_name", "obsm/X_umap", or "varm/array_matrix/0" for numeric column in array)
- `rows`: (Optional) Comma-separated list of row indices
- `cols`: (Optional) Comma-separated list of column indices

**Response:**
```json
{
  "data": [...],
  "path": "obsm/X_umap",
  "dataset_path": "/path/to/dataset.zarr"
}
```

**Note:** For array-based obsm/varm matrices, you can access specific columns using numeric indices in the path (e.g., "obsm/X_pca/0" for the first dimension).

### Get Gene and Cell Names

Get lists of gene or cell names.

```
GET /api/v1/data/genes
GET /api/v1/data/cells
```

**Parameters:**
- `dataset_path`: Path to the dataset

**Response:**
```json
{
  "genes": ["FOXP3", "CD4", ...],
  "dataset_path": "/path/to/dataset.zarr"
}
```

```json
{
  "cells": ["cell_1", "cell_2", ...],
  "dataset_path": "/path/to/dataset.zarr"
}
```

### Get DataFrame Column Information

Get column names for dataframe-encoded or array-based matrices.

```
GET /api/v1/data/obsm_dataframe_columns
GET /api/v1/data/varm_dataframe_columns
```

**Parameters:**
- `dataset_path`: Path to the dataset
- `key`: Key in obsm/varm to get columns for

**Response for dataframe-encoded matrices:**
```json
{
  "columns": ["column1", "column2", ...],
  "obsm_key": "key",
  "dataset_path": "/path/to/dataset.zarr"
}
```

**Response for array-based matrices:**
```json
{
  "columns": ["0", "1", "2", ...],
  "obsm_key": "key",
  "dataset_path": "/path/to/dataset.zarr"
}
```

**Note:** For arrays, the API automatically generates numeric column names corresponding to the array dimensions (0, 1, 2, etc.).

## Performance Considerations

### Pagination

For large datasets, pagination is available using the `page` and `page_size` parameters in the `/api/v1/data/paginated` endpoint.

### Parameter Guidelines

- **Limiting Data**: Always use `max_cells` or `max_genes` to limit the amount of data transferred.
- **Sparse Matrix Handling**: For sparse data, the API will automatically handle conversion.
- **Efficient Field Selection**: When querying observations or variables, always provide specific column names to reduce data transfer.

## Common Frontend Patterns

### Loading Dataset Structure

Typically, a frontend application should:

1. Load basic dataset info using `/api/v1/data/dataset_structure` first
2. Cache this metadata to avoid repeated requests
3. Use it to populate UI components for data exploration

### Visualizing Embeddings

For scatter plots with embeddings:

1. Request embedding data using `/api/v1/data/obsm/{embedding_key}`
2. For coloring by observation (cell) features, use `/api/v1/data/obs` with specific columns
3. For gene expression coloring, use `/api/v1/data/X` with a specific gene index

### Performance Tips

- Cache metadata and commonly used data like gene/cell names
- For large matrices, use pagination or request specific subsets
- Batch related requests to reduce latency
- Use appropriate `max_cells` and `max_genes` parameters based on visualization needs

## Example Usage Workflows

### Creating a UMAP Visualization

1. **Get dataset structure**:
   ```javascript
   fetch(`/api/v1/data/dataset_structure?dataset_path=${encodeURIComponent(path)}`)
   ```

2. **Load UMAP coordinates**:
   ```javascript
   fetch(`/api/v1/data/obsm/X_umap?dataset_path=${encodeURIComponent(path)}`)
   ```

3. **Load cell type annotations for coloring**:
   ```javascript
   fetch(`/api/v1/data/obs?dataset_path=${encodeURIComponent(path)}&columns=cell_type`)
   ```

### Accessing Unstructured Data (uns)

1. **Get uns metadata and structure**:
   ```javascript
   fetch(`/api/v1/datasets/${encodeURIComponent(path)}/uns/structure`)
   ```

2. **Load specific uns data (e.g., spatial information)**:
   ```javascript
   fetch(`/api/v1/datasets/${encodeURIComponent(path)}/uns/spatial`)
   ```

3. **Process uns data based on encoding type**:
   ```javascript
   // Example handling of spatial data for visualization
   fetch(`/api/v1/datasets/${encodeURIComponent(path)}/uns/spatial`)
     .then(response => response.json())
     .then(data => {
       if (data.data && data.data.images && data.data.scalefactors) {
         // Use image data and scale factors for spatial visualization
         const imageData = data.data.images.hires;
         const scaleFactor = data.data.scalefactors.spot_diameter_fullres;
         // Render spatial plot with this information
       }
     })
   ```

### Loading Gene Expression

1. **Get gene names**:
   ```javascript
   fetch(`/api/v1/data/genes?dataset_path=${encodeURIComponent(path)}`)
   ```

2. **Find the index of the gene of interest** (e.g., "FOXP3")

3. **Load expression values for that gene**:
   ```javascript
   fetch(`/api/v1/data/X?dataset_path=${encodeURIComponent(path)}&cols=${geneIndex}`)
   ```

### Creating a Gene Expression Heatmap

1. **Select a subset of genes and cells**

2. **Load the expression data for these subsets**:
   ```javascript
   fetch(`/api/v1/data/X?dataset_path=${encodeURIComponent(path)}&rows=${cellIndices.join(',')}&cols=${geneIndices.join(',')}`)
   ```

## Troubleshooting

### Common Issues

1. **Missing Parameters**:
   - Most endpoints require `dataset_path`
   - Some endpoints may require specific IDs or indices

2. **Data Too Large**:
   - If requesting too much data, you'll receive a 400 error
   - Use `max_cells` or `max_genes` parameters to limit data

3. **Invalid Paths**:
   - Verify dataset paths exist
   - Check that matrix keys (e.g., `obsm` keys) are valid for the dataset

4. **Categorical Data**:
   - AnnData's obs and var dataframes often contain categorical data
   - These are stored in a special format in zarr with 'codes' and 'categories'
   - The API converts these to their string values automatically

5. **Array vs. DataFrame Encoded Matrices**:
   - In AnnData, obsm and varm matrices can be either dataframes or arrays
   - For dataframe-encoded matrices, column names are preserved from the original data
   - For array-based matrices, column names are auto-generated as strings of indices ("0", "1", "2", etc.)
   - You can check if a matrix is an array by looking for the `is_array` property in the dataset structure response

### Error Responses

Error responses follow this format:

```json
{
  "error": "Error message describing the problem"
}
```

Common HTTP status codes:
- 400: Bad request (missing parameters, invalid values)
- 404: Resource not found
- 500: Server error

### Note on Parameter Naming

When using the API, be careful with parameter names:
- Use `dataset_path` to specify the zarr dataset location
- Use explicit named parameters when calling internal methods
- Always provide column names as a comma-separated list to the `columns` parameter, not as separate arguments

## Sessions API

The Sessions API allows saving, loading, and managing user sessions. Sessions store the state of the UI, including selected datasets, visualizations, and other user preferences.

### Session Structure

Sessions are stored as JSON files with the following structure:
```json
{
  "name": "Session name",
  "dataset": "Path to the dataset",
  "timestamp": "2023-01-01T12:00:00.000Z",
  "datasetName": "User-friendly dataset name",
  ...other session-specific data
}
```

### Save Session

Save a new session or update an existing one.

```
POST /api/v1/sessions/save
```

**Request Body:**
```json
{
  "name": "My Analysis Session",
  "dataset": "/path/to/dataset.zarr",
  "datasetName": "Human PBMC Dataset",
  ...
}
```

**Response:**
```json
{
  "status": "success",
  "message": "Session saved as My_Analysis_Session",
  "file": "/path/to/sessions/My_Analysis_Session.json",
  "sanitized_name": "My_Analysis_Session"
}
```

**Notes:**
- Session names are sanitized to remove invalid characters and prevent path traversal
- If the provided name contains invalid characters, the sanitized name will be returned
- Timestamps are automatically added if not provided

### List Sessions

List all available sessions.

```
GET /api/v1/sessions/list
```

**Response:**
```json
[
  {
    "name": "My Analysis Session",
    "dataset": "/path/to/dataset.zarr",
    "timestamp": "2023-01-01T12:00:00.000Z",
    "datasetName": "Human PBMC Dataset",
    "file": "/path/to/sessions/My_Analysis_Session.json"
  },
  ...
]
```

**Notes:**
- Sessions are sorted by timestamp with newest first
- Basic session metadata is included in the response

### Load Session

Load a session by name or file path.

```
GET /api/v1/sessions/load
```

**Parameters:**
- `name`: Name of the session to load
- `file`: (Optional) Path to the session file

**Response:**
```json
{
  "name": "My Analysis Session",
  "dataset": "/path/to/dataset.zarr",
  "timestamp": "2023-01-01T12:00:00.000Z",
  "datasetName": "Human PBMC Dataset",
  ...
}
```

**Notes:**
- Either `name` or `file` parameter must be provided
- If both are provided, `file` takes precedence

### Delete Session

Delete a session by name or file path.

```
DELETE /api/v1/sessions/delete
```

**Parameters:**
- `name`: Name of the session to delete
- `file`: (Optional) Path to the session file

**Response:**
```json
{
  "status": "success",
  "message": "Session My Analysis Session deleted successfully"
}
```

**Notes:**
- Either `name` or `file` parameter must be provided
- If both are provided, `file` takes precedence

### Export Session

Export a session as a downloadable file.

```
GET /api/v1/sessions/export
```

**Parameters:**
- `name`: Name of the session to export
- `file`: (Optional) Path to the session file

**Response:**
The session file is returned as an attachment with Content-Type `application/json`.

**Notes:**
- Either `name` or `file` parameter must be provided
- If both are provided, `file` takes precedence

### Check Session Exists

Check if a session with a given name exists.

```
GET /api/v1/sessions/exists
```

**Parameters:**
- `name`: Name of the session to check

**Response:**
```json
{
  "exists": true,
  "file": "/path/to/sessions/My_Analysis_Session.json",
  "sanitized_name": "My_Analysis_Session"
}
```

### Rename Session

Rename an existing session.

```
POST /api/v1/sessions/rename
```

**Request Body:**
```json
{
  "old_name": "My Analysis Session",
  "new_name": "Updated Analysis Session"
}
```

**Response:**
```json
{
  "status": "success",
  "message": "Session renamed from 'My Analysis Session' to 'Updated Analysis Session'",
  "old_file": "/path/to/sessions/My_Analysis_Session.json",
  "new_file": "/path/to/sessions/Updated_Analysis_Session.json",
  "session": {...session data...},
  "sanitized_old_name": "My_Analysis_Session",
  "sanitized_new_name": "Updated_Analysis_Session"
}
```

**Notes:**
- Returns a 409 Conflict if a session with `new_name` already exists
- Both names are sanitized to prevent path traversal

### Duplicate Session

Create a copy of an existing session with a new name.

```
POST /api/v1/sessions/duplicate
```

**Request Body:**
```json
{
  "source_name": "My Analysis Session",
  "new_name": "Copy of Analysis Session"
}
```

**Response:**
```json
{
  "status": "success",
  "message": "Session duplicated from 'My Analysis Session' to 'Copy of Analysis Session'",
  "source_file": "/path/to/sessions/My_Analysis_Session.json",
  "new_file": "/path/to/sessions/Copy_of_Analysis_Session.json",
  "session": {...session data...},
  "sanitized_source_name": "My_Analysis_Session",
  "sanitized_new_name": "Copy_of_Analysis_Session"
}
```

**Notes:**
- Returns a 409 Conflict if a session with `new_name` already exists
- Both names are sanitized to prevent path traversal
- A new timestamp is generated for the duplicate

### Import Session

Import a session from an uploaded file.

```
POST /api/v1/sessions/import
```

**Form Parameters:**
- `file`: Session file to upload (must be a valid JSON file)
- `overwrite`: (Optional) Boolean to overwrite existing session with the same name (default: false)

**Response:**
```json
{
  "status": "success",
  "message": "Session imported as Imported_Session",
  "file": "/path/to/sessions/Imported_Session.json",
  "session": {...session data...},
  "sanitized_name": "Imported_Session"
}
```

**Notes:**
- Returns a 409 Conflict if a session with the same name exists and `overwrite` is false
- Session name from the file is sanitized to prevent path traversal

### Example Usage Workflows

#### Saving and Loading a Session

1. **Save the current state**:
   ```javascript
   fetch('/api/v1/sessions/save', {
     method: 'POST',
     headers: {
       'Content-Type': 'application/json',
     },
     body: JSON.stringify({
       name: 'My Analysis',
       dataset: '/path/to/dataset.zarr',
       datasetName: 'PBMC Dataset',
       // Include application state
       selectedGenes: ['CD4', 'CD8', 'FOXP3'],
       activePanel: 'umap',
       colorBy: 'cell_type',
     }),
   })
   ```

2. **List available sessions**:
   ```javascript
   fetch('/api/v1/sessions/list')
     .then(response => response.json())
     .then(sessions => {
       // Display sessions in a dropdown or list
       const sessionList = sessions.map(s => s.name);
     })
   ```

3. **Load a selected session**:
   ```javascript
   fetch(`/api/v1/sessions/load?name=${encodeURIComponent('My Analysis')}`)
     .then(response => response.json())
     .then(session => {
       // Restore application state
       const { selectedGenes, activePanel, colorBy } = session;
       // Update UI based on loaded state
     })
   ```

#### Working with Session Files

1. **Export a session for sharing**:
   ```javascript
   // Redirects browser to download the file
   window.location.href = `/api/v1/sessions/export?name=${encodeURIComponent('My Analysis')}`;
   ```

2. **Import a shared session**:
   ```javascript
   const formData = new FormData();
   formData.append('file', sessionFile); // File from input element
   formData.append('overwrite', 'false');
   
   fetch('/api/v1/sessions/import', {
     method: 'POST',
     body: formData,
   })
   ```

## API Versioning

The current API version is v1, indicated in all endpoint paths as `/api/v1/...`.
Future versions may be introduced with a new version prefix while maintaining backward compatibility.
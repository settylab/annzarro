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
- **varm**: Multi-dimensional gene annotations
- **layers**: Alternative views of the expression matrix
- **obsp**: Cell-cell relationships (square matrices)
- **varp**: Gene-gene relationships (square matrices)

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
    "columns": ["cell_type", "n_genes", "..."]
  },
  "var": {
    "available": true,
    "columns": ["highly_variable", "gene_name", "..."]
  },
  "X": {
    "available": true,
    "shape": [10000, 20000]
  },
  "layers": {
    "available": true,
    "keys": ["counts", "normalized"],
    "details": {...}
  },
  "obsm": {
    "available": true,
    "keys": ["X_umap", "X_pca"],
    "dataframes": {...},
    "matrices": {...}
  },
  "varm": {
    "available": true,
    "keys": [...],
    "dataframes": {...},
    "matrices": {...}
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
    "keys": [...]
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

**Response:**
```json
{
  "data": {
    "cell_type": ["B cell", "T cell", ...],
    "n_genes": [1000, 1200, ...],
    "...": [...]
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

**Response:**
```json
{
  "data": {
    "gene_name": ["FOXP3", "CD4", ...],
    "highly_variable": [true, false, ...],
    "...": [...]
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
- `column_name`: (Optional) Column name for dataframe-encoded obsm matrices

**Response:**
```json
{
  "data": [[x1, y1], [x2, y2], ...],
  "obsm_key": "X_umap",
  "dataset_path": "/path/to/dataset.zarr"
}
```

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
- `column_name`: (Optional) Column name for dataframe-encoded varm matrices

**Response:**
```json
{
  "data": [...],
  "varm_key": "PCs",
  "dataset_path": "/path/to/dataset.zarr"
}
```

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
- `path`: Path to the data (e.g., "varm/matrix_name/column_name" or "obsm/X_umap")
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

Get column names for dataframe-encoded matrices.

```
GET /api/v1/data/obsm_dataframe_columns
GET /api/v1/data/varm_dataframe_columns
```

**Parameters:**
- `dataset_path`: Path to the dataset
- `key`: Key in obsm/varm to get columns for

**Response:**
```json
{
  "columns": ["column1", "column2", ...],
  "obsm_key": "key",
  "dataset_path": "/path/to/dataset.zarr"
}
```

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

## API Versioning

The current API version is v1, indicated in all endpoint paths as `/api/v1/...`.
Future versions may be introduced with a new version prefix while maintaining backward compatibility.
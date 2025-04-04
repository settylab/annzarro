"""
Data access routes for the Annzarro server.

This module contains routes for accessing AnnData matrix data,
including X, obs, var, obsm, varm, obsp, varp, etc.
"""

import os
import logging
import numpy as np
from pathlib import Path
from flask import jsonify, request, current_app as app
import json

from annzarro.core.zarr_reader import zarr_reader
from annzarro.data.manager import data_manager

logger = logging.getLogger(__name__)

def register_data_routes(app, api_version):
    """
    Register data access routes with the Flask app.
    
    Args:
        app: Flask application instance
        api_version: API version string
    """
    
    @app.route(f"/api/{api_version}/data/info", methods=["GET"])
    def get_data_info():
        """
        Get information about a dataset.
        
        Query parameters:
            dataset_id: Optional. ID of the dataset to get info for.
            dataset_path: Optional. Path to the dataset.
                         Only one of dataset_id or dataset_path should be provided.
        
        Returns:
            JSON response with dataset information
        """
        # Get dataset identification
        dataset_id = request.args.get("dataset_id")
        dataset_path = request.args.get("dataset_path")
        
        if dataset_path:
            # Use the direct access approach for stateless operation
            try:
                root, metadata = zarr_reader.open_dataset_by_path(dataset_path)
                
                # Format basic info
                shape = metadata.get('shape', (0, 0))
                info = {
                    "path": dataset_path,
                    "name": Path(dataset_path).stem.replace("_", " ").title(),
                    "shape": shape,
                    "n_obs": shape[0] if len(shape) > 0 else 0,
                    "n_vars": shape[1] if len(shape) > 1 else 0,
                    "has_obs": metadata.get("has_obs", False),
                    "has_var": metadata.get("has_var", False),
                    "has_obsm": metadata.get("has_obsm", False),
                    "has_varm": metadata.get("has_varm", False),
                    "has_layers": metadata.get("has_layers", False),
                    "has_uns": metadata.get("has_uns", False),
                    "obs_columns": metadata.get("obs_columns", []),
                    "var_columns": metadata.get("var_columns", []),
                    "layers": metadata.get("layers", {}),
                    "embeddings": metadata.get("embeddings", [])
                }
                
                # Generate a dataset ID from the path if needed
                if not dataset_id:
                    dataset_id = os.path.basename(os.path.normpath(dataset_path))
                    info["dataset_id"] = dataset_id
                    
                return jsonify(info)
            except Exception as e:
                logger.error(f"Error getting dataset info for path {dataset_path}: {e}")
                return jsonify({"error": f"Failed to get dataset info: {str(e)}"}), 500
        
        elif dataset_id:
            # For backward compatibility, use legacy approach
            info = data_manager.get_basic_info(dataset_id)
            if not info:
                return jsonify({"error": f"Dataset {dataset_id} not found"}), 404
            return jsonify(info)
        else:
            return jsonify({"error": "Either dataset_id or dataset_path parameter is required"}), 400
    
    @app.route(f"/api/{api_version}/data/X", methods=["GET"])
    def get_data_X():
        """
        Get data from the X matrix.
        
        Query parameters:
            dataset_path: Path to the dataset.
            rows: Comma-separated list of row indices to get.
            cols: Comma-separated list of column indices to get.
            max_cells: Maximum number of cells to return (default: 10000).
            
        Returns:
            JSON response with X matrix data
        """
        # Get dataset identification 
        dataset_path = request.args.get("dataset_path")
        
        if not dataset_path:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        # Parse row and column indices
        rows = request.args.get("rows")
        cols = request.args.get("cols")
        
        # Parse max cells
        try:
            max_cells = int(request.args.get("max_cells", app.config.get("max_cells_per_request", 10000)))
        except ValueError:
            max_cells = app.config.get("max_cells_per_request", 10000)
        
        # Convert rows and cols to integer lists
        row_indices = _parse_indices(rows)
        col_indices = _parse_indices(cols)
        
        try:
            # Check for too many cells
            if row_indices and col_indices and len(row_indices) * len(col_indices) > max_cells:
                return jsonify({
                    "error": f"Too many cells requested: {len(row_indices) * len(col_indices)}. "
                             f"Maximum allowed is {max_cells}. "
                             "Please reduce the number of rows or columns."
                }), 400

            # Use direct zarr access for stateless operation
            data = zarr_reader.get_X(dataset_path, row_indices, col_indices)
            
            return jsonify({
                "data": data,
                "dataset_path": dataset_path
            })
        except Exception as e:
            logger.error(f"Error getting X data for {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get X data: {str(e)}"}), 500
    
    @app.route(f"/api/{api_version}/data/layer/<path:layer_name>", methods=["GET"])
    def get_layer(layer_name: str):
        """
        Get data from a specific layer.
        
        Path parameters:
            layer_name: Name of the layer to get.
            
        Query parameters:
            dataset_path: Path to the dataset.
            rows: Comma-separated list of row indices to get.
            cols: Comma-separated list of column indices to get.
            max_cells: Maximum number of cells to return (default: 10000).
            
        Returns:
            JSON response with layer data
        """
        # Get dataset identification
        dataset_path = request.args.get("dataset_path")
        
        if not dataset_path:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        # Parse row and column indices
        rows = request.args.get("rows")
        cols = request.args.get("cols")
        
        # Parse max cells
        try:
            max_cells = int(request.args.get("max_cells", app.config.get("max_cells_per_request", 10000)))
        except ValueError:
            max_cells = app.config.get("max_cells_per_request", 10000)
        
        # Convert rows and cols to integer lists
        row_indices = _parse_indices(rows)
        col_indices = _parse_indices(cols)
        
        try:
            # Check for too many cells
            if row_indices and col_indices and len(row_indices) * len(col_indices) > max_cells:
                return jsonify({
                    "error": f"Too many cells requested: {len(row_indices) * len(col_indices)}. "
                             f"Maximum allowed is {max_cells}. "
                             "Please reduce the number of rows or columns."
                }), 400

            # Use direct zarr access for stateless operation
            data = zarr_reader.get_layer(dataset_path, layer_name, row_indices, col_indices)
            
            return jsonify({
                "data": data,
                "layer_name": layer_name,
                "dataset_path": dataset_path
            })
        except Exception as e:
            logger.error(f"Error getting layer {layer_name} data for {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get layer data: {str(e)}"}), 500
    
    @app.route(f"/api/{api_version}/data/obs", methods=["GET"])
    def get_obs():
        """
        Get observation annotations.
        
        Query parameters:
            dataset_path: Path to the dataset.
            rows: Comma-separated list of row indices to get.
            columns: Comma-separated list of column names to get.
            max_cells: Maximum number of cells to return (default: 10000).
            
        Returns:
            JSON response with observation annotations
        """
        # Get dataset identification
        dataset_path = request.args.get("dataset_path")
        
        if not dataset_path:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        # Parse row indices and column names
        rows = request.args.get("rows")
        columns = request.args.get("columns")
        
        # Parse max cells
        try:
            max_cells = int(request.args.get("max_cells", app.config.get("max_cells_per_request", 10000)))
        except ValueError:
            max_cells = app.config.get("max_cells_per_request", 10000)
        
        # Convert rows to integer list and columns to string list
        row_indices = _parse_indices(rows)
        column_names = _parse_strings(columns)
        
        try:
            # Check for too many cells
            if row_indices and len(row_indices) > max_cells:
                return jsonify({
                    "error": f"Too many cells requested: {len(row_indices)}. "
                             f"Maximum allowed is {max_cells}. "
                             "Please reduce the number of rows."
                }), 400

            # Use direct zarr access for stateless operation
            data = zarr_reader.get_obs(dataset_path, row_indices, column_names)
            
            return jsonify({
                "data": data,
                "dataset_path": dataset_path
            })
        except Exception as e:
            logger.error(f"Error getting obs data for {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get obs data: {str(e)}"}), 500
    
    @app.route(f"/api/{api_version}/data/var", methods=["GET"])
    def get_var():
        """
        Get variable annotations.
        
        Query parameters:
            dataset_path: Path to the dataset.
            cols: Comma-separated list of column indices to get.
            columns: Comma-separated list of column names to get.
            max_genes: Maximum number of genes to return (default: 10000).
            
        Returns:
            JSON response with variable annotations
        """
        # Get dataset identification
        dataset_path = request.args.get("dataset_path")
        
        if not dataset_path:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        # Parse column indices and column names
        cols = request.args.get("cols")
        columns = request.args.get("columns")
        
        # Parse max genes
        try:
            max_genes = int(request.args.get("max_genes", app.config.get("max_genes_per_request", 10000)))
        except ValueError:
            max_genes = app.config.get("max_genes_per_request", 10000)
        
        # Convert cols to integer list and columns to string list
        col_indices = _parse_indices(cols)
        column_names = _parse_strings(columns)
        
        try:
            # Check for too many genes
            if col_indices and len(col_indices) > max_genes:
                return jsonify({
                    "error": f"Too many genes requested: {len(col_indices)}. "
                             f"Maximum allowed is {max_genes}. "
                             "Please reduce the number of columns."
                }), 400

            # Use direct zarr access for stateless operation
            data = zarr_reader.get_var(dataset_path, col_indices, column_names)
            
            return jsonify({
                "data": data,
                "dataset_path": dataset_path
            })
        except Exception as e:
            logger.error(f"Error getting var data for {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get var data: {str(e)}"}), 500
    
    @app.route(f"/api/{api_version}/data/obsm/<path:obsm_key>", methods=["GET"])
    def get_obsm(obsm_key: str):
        """
        Get observation multidimensional data.
        
        Path parameters:
            obsm_key: Key in obsm to get.
            
        Query parameters:
            dataset_path: Path to the dataset.
            rows: Comma-separated list of row indices to get.
            cols: Comma-separated list of column indices to get.
            max_cells: Maximum number of cells to return (default: 10000).
            column_name: Optional column name for dataframe-encoded obsm matrices.
            
        Returns:
            JSON response with obsm data
        """
        # Get dataset identification
        dataset_path = request.args.get("dataset_path")
        
        if not dataset_path:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        # Parse row and column indices
        rows = request.args.get("rows")
        cols = request.args.get("cols")
        
        # Get optional column name for dataframe-encoded matrices
        column_name = request.args.get("column_name")
        
        # Parse max cells
        try:
            max_cells = int(request.args.get("max_cells", app.config.get("max_cells_per_request", 10000)))
        except ValueError:
            max_cells = app.config.get("max_cells_per_request", 10000)
        
        # Convert rows and cols to integer lists
        row_indices = _parse_indices(rows)
        col_indices = _parse_indices(cols)
        
        try:
            # Check for too many cells
            if row_indices and len(row_indices) > max_cells:
                return jsonify({
                    "error": f"Too many cells requested: {len(row_indices)}. "
                             f"Maximum allowed is {max_cells}. "
                             "Please reduce the number of rows."
                }), 400

            # Use direct zarr access for stateless operation
            data = zarr_reader.get_obsm(obsm_key=obsm_key, dataset_path=dataset_path, 
                                     indices=row_indices, col_indices=col_indices,
                                     column_name=column_name)
            
            response_data = {
                "data": data,
                "obsm_key": obsm_key,
                "dataset_path": dataset_path
            }
            
            # Include column name in response if provided
            if column_name:
                response_data["column_name"] = column_name
            
            return jsonify(response_data)
        except Exception as e:
            logger.error(f"Error getting obsm/{obsm_key} data for {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get obsm data: {str(e)}"}), 500
    
    @app.route(f"/api/{api_version}/data/varm/<path:varm_key>", methods=["GET"])
    def get_varm(varm_key: str):
        """
        Get variable multidimensional data.
        
        Path parameters:
            varm_key: Key in varm to get.
            
        Query parameters:
            dataset_path: Path to the dataset.
            rows: Comma-separated list of row indices to get.
            cols: Comma-separated list of column indices to get.
            max_genes: Maximum number of genes to return (default: 10000).
            column_name: Optional column name for dataframe-encoded varm matrices.
            
        Returns:
            JSON response with varm data
        """
        # Get dataset identification
        dataset_path = request.args.get("dataset_path")
        
        if not dataset_path:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        # Parse row and column indices
        rows = request.args.get("rows")
        cols = request.args.get("cols")
        
        # Get optional column name for dataframe-encoded matrices
        column_name = request.args.get("column_name")
        
        # Parse max genes
        try:
            max_genes = int(request.args.get("max_genes", app.config.get("max_genes_per_request", 10000)))
        except ValueError:
            max_genes = app.config.get("max_genes_per_request", 10000)
        
        # Convert rows and cols to integer lists
        row_indices = _parse_indices(rows)
        col_indices = _parse_indices(cols)
        
        try:
            # Check for too many genes
            if row_indices and len(row_indices) > max_genes:
                return jsonify({
                    "error": f"Too many genes requested: {len(row_indices)}. "
                             f"Maximum allowed is {max_genes}. "
                             "Please reduce the number of rows."
                }), 400

            # Use direct zarr access for stateless operation
            data = zarr_reader.get_varm(varm_key=varm_key, dataset_path=dataset_path, 
                                     indices=row_indices, col_indices=col_indices,
                                     column_name=column_name)
            
            response_data = {
                "data": data,
                "varm_key": varm_key,
                "dataset_path": dataset_path
            }
            
            # Include column name in response if provided
            if column_name:
                response_data["column_name"] = column_name
            
            return jsonify(response_data)
        except Exception as e:
            logger.error(f"Error getting varm/{varm_key} data for {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get varm data: {str(e)}"}), 500
    
    @app.route(f"/api/{api_version}/data/obsp/<path:obsp_key>", methods=["GET"])
    def get_obsp(obsp_key: str):
        """
        Get observation-observation matrices (cell-cell relationships).
        
        Path parameters:
            obsp_key: Key in obsp to get.
            
        Query parameters:
            dataset_path: Path to the dataset.
            rows: Comma-separated list of row indices to get.
            cols: Comma-separated list of column indices to get.
            max_cells: Maximum number of cells to return (default: 10000).
            
        Returns:
            JSON response with obsp data
        """
        # Get dataset identification
        dataset_path = request.args.get("dataset_path")
        
        if not dataset_path:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        # Parse row and column indices
        rows = request.args.get("rows")
        cols = request.args.get("cols")
        
        # Parse max cells
        try:
            max_cells = int(request.args.get("max_cells", app.config.get("max_cells_per_request", 10000)))
        except ValueError:
            max_cells = app.config.get("max_cells_per_request", 10000)
        
        # Convert rows and cols to integer lists
        row_indices = _parse_indices(rows)
        col_indices = _parse_indices(cols)
        
        try:
            # Check for too many cells
            if row_indices and col_indices and len(row_indices) * len(col_indices) > max_cells:
                return jsonify({
                    "error": f"Too many cells requested: {len(row_indices) * len(col_indices)}. "
                             f"Maximum allowed is {max_cells}. "
                             "Please reduce the number of rows or columns."
                }), 400

            # Use direct zarr access for stateless operation
            data = zarr_reader.get_obsp(dataset_path, obsp_key, row_indices, col_indices)
            
            return jsonify({
                "data": data,
                "obsp_key": obsp_key,
                "dataset_path": dataset_path
            })
        except Exception as e:
            logger.error(f"Error getting obsp/{obsp_key} data for {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get obsp data: {str(e)}"}), 500
    
    @app.route(f"/api/{api_version}/data/varp/<path:varp_key>", methods=["GET"])
    def get_varp(varp_key: str):
        """
        Get variable-variable matrices (gene-gene relationships).
        
        Path parameters:
            varp_key: Key in varp to get.
            
        Query parameters:
            dataset_path: Path to the dataset.
            rows: Comma-separated list of row indices to get.
            cols: Comma-separated list of column indices to get.
            max_genes: Maximum number of genes to return (default: 10000).
            
        Returns:
            JSON response with varp data
        """
        # Get dataset identification
        dataset_path = request.args.get("dataset_path")
        
        if not dataset_path:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        # Parse row and column indices
        rows = request.args.get("rows")
        cols = request.args.get("cols")
        
        # Parse max genes
        try:
            max_genes = int(request.args.get("max_genes", app.config.get("max_genes_per_request", 10000)))
        except ValueError:
            max_genes = app.config.get("max_genes_per_request", 10000)
        
        # Convert rows and cols to integer lists
        row_indices = _parse_indices(rows)
        col_indices = _parse_indices(cols)
        
        try:
            # Check for too many genes
            if row_indices and col_indices and len(row_indices) * len(col_indices) > max_genes:
                return jsonify({
                    "error": f"Too many genes requested: {len(row_indices) * len(col_indices)}. "
                             f"Maximum allowed is {max_genes}. "
                             "Please reduce the number of rows or columns."
                }), 400

            # Use direct zarr access for stateless operation
            data = zarr_reader.get_varp(dataset_path, varp_key, row_indices, col_indices)
            
            return jsonify({
                "data": data,
                "varp_key": varp_key,
                "dataset_path": dataset_path
            })
        except Exception as e:
            logger.error(f"Error getting varp/{varp_key} data for {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get varp data: {str(e)}"}), 500
    
    @app.route(f"/api/{api_version}/data/paginated", methods=["GET"])
    def get_paginated_data():
        """
        Get paginated data from any matrix type.
        
        Query parameters:
            dataset_path: Path to the dataset.
            matrix_type: Type of matrix to get ('X', 'layer', 'obsm', 'varm', 'obsp', 'varp').
            key: Key in matrix to get (required for all types except 'X').
            rows: Comma-separated list of row indices to get.
            cols: Optional comma-separated list of column indices to get.
            page: Page number (0-based).
            page_size: Number of items per page (max 1000).
            
        Returns:
            JSON response with paginated data and pagination metadata
        """
        # Get dataset identification
        dataset_path = request.args.get("dataset_path")
        
        if not dataset_path:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        # Get matrix type and key
        matrix_type = request.args.get("matrix_type")
        key = request.args.get("key")
        
        if not matrix_type:
            return jsonify({"error": "matrix_type parameter is required"}), 400
        
        if matrix_type not in ["X", "layer", "obsm", "varm", "obsp", "varp"]:
            return jsonify({"error": f"Invalid matrix_type: {matrix_type}"}), 400
        
        if matrix_type != "X" and not key:
            return jsonify({"error": f"key parameter is required for matrix_type {matrix_type}"}), 400
        
        # Parse row and column indices
        rows = request.args.get("rows")
        cols = request.args.get("cols")
        
        # Parse pagination parameters
        try:
            page = int(request.args.get("page", 0))
            page_size = min(int(request.args.get("page_size", 100)), 1000)
        except ValueError:
            return jsonify({"error": "Invalid pagination parameters"}), 400
        
        # Convert rows and cols to integer lists
        row_indices = _parse_indices(rows)
        col_indices = _parse_indices(cols)
        
        if not row_indices:
            return jsonify({"error": "rows parameter is required"}), 400
        
        try:
            # Get paginated data based on matrix type
            if matrix_type == "X":
                data, pagination = zarr_reader.get_X_paginated(dataset_path, row_indices, col_indices, page, page_size)
            elif matrix_type == "layer":
                data, pagination = zarr_reader.get_layer_paginated(dataset_path, key, row_indices, col_indices, page, page_size)
            elif matrix_type == "obsm":
                # Get optional column name for dataframe-encoded matrices
                column_name = request.args.get("column_name")
                data, pagination = zarr_reader.get_obsm_paginated(dataset_path, key, row_indices, col_indices, 
                                                              page, page_size, column_name=column_name)
            elif matrix_type == "varm":
                # Get optional column name for dataframe-encoded matrices
                column_name = request.args.get("column_name")
                data, pagination = zarr_reader.get_varm_paginated(dataset_path, key, row_indices, col_indices, 
                                                              page, page_size, column_name=column_name)
            elif matrix_type == "obsp":
                data, pagination = zarr_reader.get_obsp_paginated(dataset_path, key, row_indices, col_indices, page, page_size)
            elif matrix_type == "varp":
                data, pagination = zarr_reader.get_varp_paginated(dataset_path, key, row_indices, col_indices, page, page_size)
            
            # Prepare response data
            response_data = {
                "data": data,
                "dataset_path": dataset_path,
                "pagination": pagination
            }
            
            # Add matrix key and column name if applicable
            if matrix_type != "X":
                response_data["key"] = key
                
                # Add column name for dataframe-encoded matrices
                if matrix_type in ["obsm", "varm"]:
                    column_name = request.args.get("column_name")
                    if column_name:
                        response_data["column_name"] = column_name
            
            # Add pagination headers
            response = jsonify(response_data)
            
            # Add pagination metadata to headers
            response.headers["X-Pagination-Page"] = pagination["page"]
            response.headers["X-Pagination-PageSize"] = pagination["page_size"]
            response.headers["X-Pagination-TotalRows"] = pagination["total_rows"]
            response.headers["X-Pagination-TotalPages"] = pagination["total_pages"]
            
            return response
        except Exception as e:
            logger.error(f"Error getting paginated data for {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get paginated data: {str(e)}"}), 500
    
    @app.route(f"/api/{api_version}/data/genes", methods=["GET"])
    def get_genes():
        """
        Get list of gene names.
        
        Query parameters:
            dataset_path: Path to the dataset.
            
        Returns:
            JSON response with gene names
        """
        # Get dataset identification
        dataset_path = request.args.get("dataset_path")
        
        if not dataset_path:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        try:
            # Use direct zarr access for stateless operation
            genes = zarr_reader.get_gene_names(dataset_path)
            
            return jsonify({
                "genes": genes,
                "dataset_path": dataset_path
            })
        except Exception as e:
            logger.error(f"Error getting gene names for {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get gene names: {str(e)}"}), 500
    
    @app.route(f"/api/{api_version}/data/cells", methods=["GET"])
    def get_cells():
        """
        Get list of cell names.
        
        Query parameters:
            dataset_path: Path to the dataset.
            
        Returns:
            JSON response with cell names
        """
        # Get dataset identification
        dataset_path = request.args.get("dataset_path")
        
        if not dataset_path:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        try:
            # Use direct zarr access for stateless operation
            cells = zarr_reader.get_cell_names(dataset_path)
            
            return jsonify({
                "cells": cells,
                "dataset_path": dataset_path
            })
        except Exception as e:
            logger.error(f"Error getting cell names for {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get cell names: {str(e)}"}), 500
    
    @app.route(f"/api/{api_version}/data/statistics", methods=["GET"])
    def get_statistics():
        """
        Get statistical analysis of expression data.
        
        Query parameters:
            dataset_path: Path to the dataset.
            rows: Comma-separated list of row indices to get.
            cols: Comma-separated list of column indices to get.
            data_path: Optional path to the data (e.g., "varm/matrix_name/column_name").
                      If not provided, uses X matrix.
            
        Returns:
            JSON response with statistics
        """
        # Get dataset identification
        dataset_path = request.args.get("dataset_path")
        
        if not dataset_path:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        # Parse row and column indices
        rows = request.args.get("rows")
        cols = request.args.get("cols")
        
        # Get optional data path
        data_path = request.args.get("data_path")
        
        # Convert rows and cols to integer lists
        row_indices = _parse_indices(rows)
        col_indices = _parse_indices(cols)
        
        try:
            # Use direct zarr access for stateless operation
            stats = zarr_reader.get_statistics(dataset_path, row_indices, col_indices, data_path)
            
            return jsonify({
                "statistics": stats,
                "dataset_path": dataset_path,
                "data_path": data_path
            })
        except Exception as e:
            logger.error(f"Error getting statistics for {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get statistics: {str(e)}"}), 500
            
    @app.route(f"/api/{api_version}/data/obsm_dataframe_columns", methods=["GET"])
    def get_obsm_dataframe_columns():
        """
        Get column names for a dataframe-encoded obsm matrix.
        
        Query parameters:
            dataset_path: Path to the dataset.
            key: Key in obsm to get columns for.
            
        Returns:
            JSON response with column names
        """
        # Get dataset identification
        dataset_path = request.args.get("dataset_path")
        
        if not dataset_path:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        # Get obsm key
        obsm_key = request.args.get("key")
        
        if not obsm_key:
            return jsonify({"error": "key parameter is required"}), 400
        
        try:
            # Use direct zarr access for stateless operation
            columns = zarr_reader.get_obsm_dataframe_columns(obsm_key, dataset_path=dataset_path)
            
            return jsonify({
                "columns": columns,
                "obsm_key": obsm_key,
                "dataset_path": dataset_path
            })
        except Exception as e:
            logger.error(f"Error getting obsm dataframe columns for {obsm_key} in {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get obsm dataframe columns: {str(e)}"}), 500
            
    @app.route(f"/api/{api_version}/data/varm_dataframe_columns", methods=["GET"])
    def get_varm_dataframe_columns():
        """
        Get column names for a dataframe-encoded varm matrix.
        
        Query parameters:
            dataset_path: Path to the dataset.
            key: Key in varm to get columns for.
            
        Returns:
            JSON response with column names
        """
        # Get dataset identification
        dataset_path = request.args.get("dataset_path")
        
        if not dataset_path:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        # Get varm key
        varm_key = request.args.get("key")
        
        if not varm_key:
            return jsonify({"error": "key parameter is required"}), 400
        
        try:
            # Use direct zarr access for stateless operation
            columns = zarr_reader.get_varm_dataframe_columns(varm_key, dataset_path=dataset_path)
            
            return jsonify({
                "columns": columns,
                "varm_key": varm_key,
                "dataset_path": dataset_path
            })
        except Exception as e:
            logger.error(f"Error getting varm dataframe columns for {varm_key} in {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get varm dataframe columns: {str(e)}"}), 500
            
    @app.route(f"/api/{api_version}/data/by_path", methods=["GET"])
    def get_data_by_path():
        """
        Get data using a path notation (e.g., "varm/matrix_name/column_name").
        
        This endpoint provides a unified way to access any data in the zarr file,
        including specific columns from dataframe-encoded matrices.
        
        Query parameters:
            dataset_path: Path to the dataset.
            path: Path to the data (e.g., "varm/matrix_name/column_name" or "obsm/matrix_name/column_name").
            rows: Optional comma-separated list of row indices to get.
            cols: Optional comma-separated list of column indices to get.
            
        Returns:
            JSON response with the requested data
        """
        # Get dataset identification
        dataset_path = request.args.get("dataset_path")
        
        if not dataset_path:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        # Get data path
        data_path = request.args.get("path")
        
        if not data_path:
            return jsonify({"error": "path parameter is required"}), 400
        
        # Parse row and column indices
        rows = request.args.get("rows")
        cols = request.args.get("cols")
        
        # Convert rows and cols to integer lists
        row_indices = _parse_indices(rows)
        col_indices = _parse_indices(cols)
        
        try:
            # Use direct zarr access for stateless operation
            data = zarr_reader.get_data_by_path(data_path, dataset_path=dataset_path, 
                                             indices=row_indices, col_indices=col_indices)
            
            # Convert data to list for JSON serialization
            if hasattr(data, 'tolist'):
                data = data.tolist()
            
            return jsonify({
                "data": data,
                "path": data_path,
                "dataset_path": dataset_path
            })
        except Exception as e:
            logger.error(f"Error getting data at path {data_path} in {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get data at path {data_path}: {str(e)}"}), 500


def _parse_indices(indices_str):
    """
    Parse a comma-separated string of indices into a list of integers.
    
    Args:
        indices_str: Comma-separated string of indices.
        
    Returns:
        List of integers, or None if indices_str is None or empty.
    """
    if not indices_str:
        return None
    
    try:
        return [int(i) for i in indices_str.split(",")]
    except ValueError:
        # Handle case where the input might be JSON-encoded
        try:
            return json.loads(indices_str)
        except:
            return None

def _parse_strings(strings_str):
    """
    Parse a comma-separated string into a list of strings.
    
    Args:
        strings_str: Comma-separated string.
        
    Returns:
        List of strings, or None if strings_str is None or empty.
    """
    if not strings_str:
        return None
    
    try:
        # Handle case where the input might be JSON-encoded
        parsed = json.loads(strings_str)
        if isinstance(parsed, list):
            return parsed
    except:
        pass
    
    # Default to simple comma splitting
    return strings_str.split(",")
"""
Zarr-specific routes for the Annzarro server.

This module contains routes for zarr-specific operations like dataset metadata,
zarr uploads, and zarr URL validation.
"""

import os
import logging
from pathlib import Path
from flask import jsonify, request, current_app as app

from ...core import zarr_reader, h5ad_reader_obj
from ...core import name_index
from ...core import freshness

logger = logging.getLogger(__name__)

def register_zarr_routes(app, api_version):
    """
    Register zarr-specific routes with the Flask app.
    
    Args:
        app: Flask application instance
        api_version: API version string
    """
    
    @app.route(f"/api/{api_version}/cache/info", methods=["GET"])
    def get_cache_info():
        """
        Get information about the current cache state.
        
        Returns:
            JSON response with cache information
        """
        try:
            # Get cache info
            result = zarr_reader.get_cache_info()
            return jsonify(result)
        except Exception as e:
            logger.error(f"Error getting cache info: {str(e)}")
            return jsonify({
                "status": "error", 
                "message": f"Failed to get cache info: {str(e)}"
            }), 500
            
    @app.route(f"/api/{api_version}/cache/reset", methods=["POST"])
    def reset_cache():
        """
        Reset the zarr reader cache.
        
        Query parameters:
            dataset_path: Optional dataset path to clear from cache.
                       If not provided, clears the entire cache.
        
        Returns:
            JSON response with cache reset result

        On a hosted server only an admin may do this: the cache is shared by
        every user, and emptying it on demand makes every open session re-read
        its data from disk. A hosted server with login disabled has no admins,
        so nobody may (restart it to empty the cache). The frontend's refresh
        button tolerates the 403.
        """
        from ..confinement import is_hosted
        from .. import permissions
        if is_hosted(app.config):
            _, is_admin = permissions.current_user()
            if not is_admin:
                return jsonify({
                    "status": "error",
                    "reason": "admin_only",
                    "message": "Only an admin can reset the shared cache on this server.",
                }), 403
        try:
            # Get optional dataset_path query parameter
            dataset_path = request.args.get('dataset_path', None)
            
            # Clear the cache: both readers. The h5ad reader keeps its own
            # result cache (it opens the file per read and holds no handle);
            # resetting the zarr reader alone served an .h5ad's old reads
            # until a restart.
            result = zarr_reader.clear_cache(dataset_path=dataset_path)
            h5ad_reader_obj.clear_cache(dataset_path=dataset_path)
            # The name search index is a cache too: a reset must rebuild it.
            name_index.clear(dataset_path)
            # A new generation: the ETags change (an in-place chunk write
            # kept the old ones, so the browser was answered 304 with its old
            # body), and every other process, each gunicorn worker, drops
            # its cached reads of the dataset on its next request.
            freshness.bump(dataset_path, reason="cache_reset")
            
            # Add cache configuration to the response
            result["cache_config"] = {
                "cache_enabled": zarr_reader.enable_caching,
                "cache_memory_mb": zarr_reader.max_memory_mb,
                "cache_dataset_limit": zarr_reader.cache_limit
            }
            
            # Return result as JSON
            return jsonify(result)
        except Exception as e:
            logger.error(f"Error clearing cache: {str(e)}")
            return jsonify({
                "status": "error", 
                "message": f"Failed to clear cache: {str(e)}"
            }), 500
    
    @app.route(f"/api/{api_version}/datasets/<path:dataset_path>/info", methods=["GET"])
    def get_dataset_metadata(dataset_path: str):
        """
        Get metadata for a dataset by path without loading it into memory.
        This is the stateless way to get dataset information.
        
        Args:
            dataset_path: Path to the dataset
            
        Returns:
            JSON response with dataset metadata
        """
        try:
            # Use the stateless approach to get dataset info
            # Use direct file access without maintaining state
            root, metadata = zarr_reader.open_dataset_by_path(dataset_path, use_cache=True)
            
            # Format response with basic info
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
                "layers": metadata.get("layers", {})
            }
            
            # Add embeddings (obsm) information
            embeddings = metadata.get("embeddings", [])
            info["embeddings"] = embeddings
            
            # Add detailed obsm information
            if metadata.get("has_obsm", False) and "obsm" in root:
                obsm_info = {}
                for key in root["obsm"].keys():
                    try:
                        shape = root["obsm"][key].shape
                        dtype = str(root["obsm"][key].dtype)
                        obsm_info[key] = {"shape": shape, "dtype": dtype}
                    except Exception as e:
                        logger.warning(f"Error getting shape for obsm/{key}: {e}")
                info["obsm_details"] = obsm_info
                
            # Add obsm_dataframes information
            if "obsm_dataframes" in metadata:
                info["obsm_dataframes"] = metadata.get("obsm_dataframes", {})
            
            # Add detailed varm information
            if metadata.get("has_varm", False) and "varm" in root:
                varm_info = {}
                for key in root["varm"].keys():
                    try:
                        shape = root["varm"][key].shape
                        dtype = str(root["varm"][key].dtype)
                        varm_info[key] = {"shape": shape, "dtype": dtype}
                    except Exception as e:
                        logger.warning(f"Error getting shape for varm/{key}: {e}")
                info["varm_details"] = varm_info
                
            # Add varm_dataframes information
            if "varm_dataframes" in metadata:
                info["varm_dataframes"] = metadata.get("varm_dataframes", {})
            
            # Add detailed layers information
            if metadata.get("has_layers", False) and "layers" in root:
                layers_info = {}
                for key in root["layers"].keys():
                    try:
                        shape = root["layers"][key].shape
                        dtype = str(root["layers"][key].dtype)
                        layers_info[key] = {"shape": shape, "dtype": dtype}
                    except Exception as e:
                        logger.warning(f"Error getting shape for layers/{key}: {e}")
                info["layers_details"] = layers_info
                
            # Add detailed obsp information
            if metadata.get("has_obsp", False) and "obsp" in root:
                obsp_info = {}
                for key in root["obsp"].keys():
                    try:
                        shape = root["obsp"][key].shape
                        dtype = str(root["obsp"][key].dtype)
                        obsp_info[key] = {"shape": shape, "dtype": dtype}
                    except Exception as e:
                        logger.warning(f"Error getting shape for obsp/{key}: {e}")
                info["obsp_details"] = obsp_info
                
            # Add detailed varp information
            if metadata.get("has_varp", False) and "varp" in root:
                varp_info = {}
                for key in root["varp"].keys():
                    try:
                        shape = root["varp"][key].shape
                        dtype = str(root["varp"][key].dtype)
                        varp_info[key] = {"shape": shape, "dtype": dtype}
                    except Exception as e:
                        logger.warning(f"Error getting shape for varp/{key}: {e}")
                info["varp_details"] = varp_info
                
            # Get sample obs and var names if available
            if metadata.get("has_obs", False) and 'obs' in root and '_index' in root['obs']:
                # Get first 10 observation names
                obs_names = root['obs']['_index'][:10]
                info["obs_names_sample"] = [str(x) for x in obs_names]
                
            if metadata.get("has_var", False) and 'var' in root and '_index' in root['var']:
                # Get first 10 variable names
                var_names = root['var']['_index'][:10]
                info["var_names_sample"] = [str(x) for x in var_names]
            
            return jsonify(info)
        except ValueError as e:
            # Handle validation errors with a 400 Bad Request
            error_message = str(e)
            logger.warning(f"Invalid dataset path: {dataset_path}: {error_message}")
            return jsonify({
                "error": "Invalid dataset path", 
                "message": error_message, 
                "path": dataset_path,
                "status": "error"
            }), 400
        except RuntimeError as e:
            # Handle operational errors with a 500 Internal Server Error
            error_message = str(e)
            logger.error(f"Error processing dataset: {dataset_path}: {error_message}")
            return jsonify({
                "error": "Failed to process dataset",
                "message": error_message,
                "path": dataset_path,
                "status": "error"
            }), 500
        except Exception as e:
            # Handle unexpected errors
            error_message = str(e)
            logger.error(f"Unexpected error getting dataset metadata for {dataset_path}: {e}")
            return jsonify({
                "error": "Failed to get dataset metadata",
                "message": error_message,
                "path": dataset_path,
                "status": "error"
            }), 500
    
    @app.route(f"/api/{api_version}/zarr/to_anndata", methods=["GET"])
    def get_anndata_structure():
        """
        Convert a zarr dataset to an AnnData-like structure.
        
        Query parameters:
            dataset_path: Path to the dataset.
            
        Returns:
            JSON response with AnnData-like structure
        """
        dataset_path = request.args.get("dataset_path")
        
        if not dataset_path:
            return jsonify({"error": "dataset_path parameter is required"}), 400
            
        try:
            # Use direct zarr access for stateless operation
            root, metadata = zarr_reader.open_dataset_by_path(dataset_path, use_cache=True)
            
            # Extract data based on AnnData structure
            result = zarr_reader.get_anndata_structure(root, metadata)
            
            # Add dataset path to response
            result["dataset_path"] = dataset_path
            
            return jsonify(result)
        except Exception as e:
            logger.error(f"Error getting AnnData structure for {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get AnnData structure: {str(e)}"}), 500
    
    @app.route(f"/api/{api_version}/zarr/url", methods=["GET"])
    def validate_zarr_url():
        """
        Validate a remote zarr URL.
        
        Query parameters:
            url: URL to validate.
            
        Returns:
            JSON response with validation result
        """
        url = request.args.get("url")
        
        if not url:
            return jsonify({"error": "url parameter is required"}), 400
            
        try:
            # Check if URL is a valid zarr archive
            valid, message = zarr_reader.validate_zarr_url(url)
            
            return jsonify({
                "valid": valid,
                "message": message,
                "url": url
            })
        except Exception as e:
            logger.error(f"Error validating zarr URL {url}: {e}")
            return jsonify({
                "valid": False,
                "message": f"Error validating URL: {str(e)}",
                "url": url
            }), 500
            
    @app.route(f"/api/{api_version}/datasets/<path:dataset_path>/uns/structure", methods=["GET"])
    def get_uns_structure(dataset_path: str):
        """
        Get the structure of the uns section including keys and encoding types.
        
        Args:
            dataset_path: Path to the dataset
            
        Returns:
            JSON response with uns structure
        """
        try:
            # Use the stateless approach to get dataset info
            root, metadata = zarr_reader.open_dataset_by_path(dataset_path, use_cache=True)
            
            # Check if dataset has uns
            if not metadata.get("has_uns", False):
                return jsonify({
                    "error": "Dataset does not have uns data"
                }), 404
                
            # Get uns structure with encoding types
            uns_structure = zarr_reader.get_uns_structure(dataset_path=dataset_path)
            
            return jsonify({
                "dataset_path": dataset_path,
                "uns_structure": uns_structure
            })
        except ValueError as e:
            return jsonify({"error": f"Cannot open dataset: {e}", "reason": "unsupported_type"}), 400
        except Exception as e:
            logger.error(f"Error getting uns structure for {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get uns structure: {str(e)}"}), 500
            
    @app.route(f"/api/{api_version}/datasets/uns/<path:uns_key>", methods=["GET"])
    def get_uns_data(uns_key: str):
        """
        Get data from the uns section.
        
        Path parameters:
            uns_key: Key in uns to get
            
        Query parameters:
            dataset_path: Path to the dataset
            
        Returns:
            JSON response with uns data
        """
        # Get dataset_path from query parameters
        dataset_path = request.args.get("dataset_path")
        
        if not dataset_path:
            return jsonify({"error": "dataset_path parameter is required"}), 400
            
        try:
            # Use the stateless approach to get dataset info
            root, metadata = zarr_reader.open_dataset_by_path(dataset_path, use_cache=True)
            
            # Check if dataset has uns
            if not metadata.get("has_uns", False):
                return jsonify({
                    "error": "Dataset does not have uns data"
                }), 404
                
            # Skip the key existence check and let get_uns handle missing keys
                
            # Get the uns data
            data = zarr_reader.get_uns(uns_key, dataset_path=dataset_path)
            
            return jsonify({
                "dataset_path": dataset_path,
                "uns_key": uns_key,
                "data": data
            })
        except KeyError as e:
            return jsonify({"error": e.args[0], "reason": "key_not_found"}), 404
        except Exception as e:
            logger.error(f"Error getting uns data for {dataset_path}/{uns_key}: {e}")
            return jsonify({"error": f"Failed to get uns data: {str(e)}"}), 500
        
    @app.route(f"/api/{api_version}/datasets/<path:dataset_path>/uns/<path:uns_key>", methods=["GET"])
    def get_uns_data_alt(dataset_path: str, uns_key: str):
        """
        Alternative route for getting data from the uns section.
        This maintains backward compatibility with the path-based approach.
        
        Args:
            dataset_path: Path to the dataset
            uns_key: Key in uns to get
            
        Returns:
            JSON response with uns data
        """
        try:
            # Use the stateless approach to get dataset info
            root, metadata = zarr_reader.open_dataset_by_path(dataset_path, use_cache=True)
            
            # Check if dataset has uns
            if not metadata.get("has_uns", False):
                return jsonify({
                    "error": "Dataset does not have uns data"
                }), 404
                
            # Skip the key existence check and let get_uns handle missing keys
                
            # Get the uns data
            data = zarr_reader.get_uns(uns_key, dataset_path=dataset_path)
            
            return jsonify({
                "dataset_path": dataset_path,
                "uns_key": uns_key,
                "data": data
            })
        except KeyError as e:
            return jsonify({"error": e.args[0], "reason": "key_not_found"}), 404
        except Exception as e:
            logger.error(f"Error getting uns data for {dataset_path}/{uns_key}: {e}")
            return jsonify({"error": f"Failed to get uns data: {str(e)}"}), 500
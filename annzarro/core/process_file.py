from flask import jsonify
from pathlib import Path
from .reader import Reader
from .remote import raise_if_timeout
from .array_response import array_response, binary_response, categorical_response, numeric_array
from . import categories as category_rules
from typing import Literal, Optional
import logging
from . import freshness
from .zarr_reader import consolidated_notice

logger = logging.getLogger("data_routes")

def _raise_if_store_error(exc):
    """Let a failed read reach the route's error handler with its reason
    (stale_metadata, read_failed, unsupported_type, key_not_found) instead of
    a generic 500 here."""
    from .zarr_reader import StoreReadError, UnsupportedEncodingError, MissingKeyError
    from .read_guard import ReadTooLargeError
    if isinstance(exc, (StoreReadError, UnsupportedEncodingError, MissingKeyError, ReadTooLargeError)):
        raise exc


def get_keys(metadata, field):
    return list(metadata.get(field, {"keys": []}).get("keys", []))

def extract_metadata(dataset_path: str, reader: Reader):
    try:
        # Only wrap the risky operation of opening the dataset.
        metadata = reader.get_metadata(dataset_path)
    except FileNotFoundError as e:
        logger.exception(f"Dataset not found: {dataset_path}")
        return jsonify({
            "status": "error",
            "error": "Dataset not found", 
            "message": f"The dataset path '{dataset_path}' does not exist."
        }), 404
    except ValueError as e:
        # Handle validation errors with a 400 Bad Request
        error_message = str(e)
        logger.warning(f"Invalid dataset path: {dataset_path}: {error_message}")
        return jsonify({
            "status": "error",
            "error": "Invalid dataset path", 
            "message": error_message, 
            "path": dataset_path
        }), 400
    except Exception as e:
        raise_if_timeout(e)
        _raise_if_store_error(e)
        logger.exception(f"Error opening dataset at {dataset_path}")
        return jsonify({
            "status": "error",
            "error": "Failed to open dataset", 
            "message": str(e)
        }), 500


    try:
        # Format basic dataset information.
        shape = metadata.get("shape", (0, 0))
        dataset_structure = {
            "path": dataset_path,
            "name": Path(dataset_path).stem.replace("_", " ").title(),
            "shape": shape,
            "n_obs": shape[0] if len(shape) > 0 else 0,
            "n_vars": shape[1] if len(shape) > 1 else 0,
            "obs": {
                "available": metadata.get("has_obs", False),
                "columns": metadata.get("obs_columns", []),
                "columns_info": metadata.get("obs_columns_info", {})
            },
            "var": {
                "available": metadata.get("has_var", False),
                "columns": metadata.get("var_columns", []),
                "columns_info": metadata.get("var_columns_info", {})
            },
            "X": {
                # A store may have no X (anndata allows X=None); claiming one
                # sent clients to /data/X for an empty answer.
                "available": bool(metadata.get("has_X", True)),
                "shape": shape if metadata.get("has_X", True) else None
            },
            "layers": {
                "available": metadata.get("has_layers", False),
                "keys": get_keys(metadata, "layers"),
                "details": metadata.get("layers", {}),
                "info": metadata.get("layers_info", {})
            },
            "obsm": {
                "available": metadata.get("has_obsm", False),
                "keys": get_keys(metadata, "obsm"),
                "dataframes": metadata.get("obsm_dataframes", {}),
                "matrices": metadata.get("obsm_matrices", {}),
                "info": metadata.get("obsm_info", {})
            },
            "varm": {
                "available": metadata.get("has_varm", False),
                "keys": get_keys(metadata, "varm"),
                "dataframes": metadata.get("varm_dataframes", {}),
                "matrices": metadata.get("varm_matrices", {}),
                "info": metadata.get("varm_info", {})
            },
            "obsp": {
                "available": metadata.get("has_obsp", False),
                "keys": get_keys(metadata, "obsp")
            },
            "varp": {
                "available": metadata.get("has_varp", False),
                "keys": get_keys(metadata, "varp")
            },
            "uns": {
                "available": metadata.get("has_uns", False),
                "keys": get_keys(metadata, "uns")
            },
            "embeddings": metadata.get("embeddings", []),
            # set when a refresh found the consolidated metadata out of date
            # (the store is then read without it): the client says so
            "consolidated_metadata": consolidated_notice(
                freshness.recorded(dataset_path).get("consolidated_stale")),
        }
        # Use pathlib for consistency when adding dataset_id.
        # Frontend uses path directly, so no need for dataset_id
        return jsonify(dataset_structure)
    
    except Exception as e:
        raise_if_timeout(e)
        _raise_if_store_error(e)
        logger.exception(f"Error building dataset structure for path {dataset_path}")
        return jsonify({"error": f"Failed to get dataset structure: {str(e)}"}), 500

def extract_cells_genes(dataset_path: str, type: Literal["cells", "genes"], reader: Reader):
    try:
        # Use direct zarr access for stateless operation
        logger.info(f"API {type.upper()}: Loading {'gene' if type == 'genes' else 'cell'} names for {dataset_path} with use_cache=True")
        entities = reader.get_cell_gene_names(dataset_path, type, use_cache=True)
        logger.info(f"API {type.upper()}: Successfully loaded {len(entities)} {type}")
        
        return jsonify({
            type: entities,
            "dataset_path": dataset_path
        })
    except ValueError as e:
        # Handle validation errors with a 400 Bad Request
        error_message = str(e)
        logger.warning(f"Invalid dataset path for {type}: {dataset_path}: {error_message}")
        return jsonify({
            "error": "Invalid dataset path", 
            "message": error_message, 
            "path": dataset_path,
            "status": "error",
            type: []
        }), 400
    except RuntimeError as e:
        # Handle operational errors with a 500 Internal Server Error
        error_message = str(e)
        logger.error(f"Error processing dataset for {type}: {dataset_path}: {error_message}")
        return jsonify({
            "error": "Failed to process dataset",
            "message": error_message,
            "path": dataset_path,
            "status": "error",
            type: []
        }), 500
    except Exception as e:
        raise_if_timeout(e)
        _raise_if_store_error(e)
        # Handle unexpected errors
        error_message = str(e)
        logger.error(f"Unexpected error getting {'gene' if type == 'genes' else 'cell'} names for {dataset_path}: {e}")
        return jsonify({
            "error": f"Failed to get {'gene' if type == 'genes' else 'cell'} names",
            "message": error_message,
            "path": dataset_path,
            "status": "error",
            type: []
        }), 500
    
def extract_obs_var_codes(dataset_path: str, reader: Reader, indices, column: str,
                          type: Literal["cells", "genes"], used_only: bool = False,
                          n_categories: Optional[int] = None, ranked: bool = False):
    """One categorical obs/var column as codes + categories (binary), or None
    when the column is not categorical or the reader cannot give codes; the
    caller then answers as before. With ``used_only`` (or past
    READ_ALL_MAX categories) the categories are those the rows use, and the
    reply says the column's full count. With ``ranked``, each row's code is
    its category's rank over the whole column and no label is sent
    (core/categories.py)."""
    get_codes = getattr(reader, "get_obs_var_codes", None)
    if get_codes is None:
        return None
    if ranked:
        result = get_codes(entity=type, dataset_path=dataset_path, column_name=column, indices=indices,
                           ranked=True)
        if result is None:
            return None
        ranks, used = result
        return categorical_response(ranks, [], total=n_categories, used=used, ranked=True)
    result = get_codes(entity=type, dataset_path=dataset_path, column_name=column, indices=indices,
                       used_only=used_only)
    if result is None:
        return None
    codes, categories = result
    compact = used_only or (n_categories is not None and n_categories > category_rules.READ_ALL_MAX)
    return categorical_response(codes, categories, total=n_categories if compact else None)


BOOLEAN_CATEGORIES = [False, True]


def _add_boolean_categories(response: dict, include_categories: bool) -> None:
    """Serve a boolean column's categories as ``[false, true]``.

    A boolean obs column is stored as plain values, so it came without
    categories and a client ordered them by first appearance; the
    ``uns/<col>_colors`` pair that scanpy/pandas write is aligned to
    pandas' ``Categorical(bool).categories`` = [False, True], and was applied
    in whatever order the values first appeared (nexus #407). scanpy's own
    plots fix the same order (``categories=("False", "True")`` in
    scanpy/plotting/_tools/scatterplots.py ``_get_palette``). Both are always given, so a
    column of only True still maps True to the second colour. A column that
    already has categories keeps them.
    """
    data = response.get("data")
    if not include_categories or not isinstance(data, dict):
        return
    for name, values in data.items():
        if name == "_index" or not isinstance(values, list) or name in (response.get("categories") or {}):
            continue
        first = next((v for v in values if v is not None), None)
        if isinstance(first, bool):
            response.setdefault("categories", {})[name] = list(BOOLEAN_CATEGORIES)


def extract_obs_var(dataset_path: str, reader: Reader, indices: list[int], column_names: list[str], include_categories: bool, type: Literal["cells", "genes"], binary: bool = False):
    if binary and column_names and len(column_names) == 1:
        # One numeric column, binary: the array as read, without the Python
        # list get_obs_var builds for JSON (95.6M floats: ~3 GB of objects,
        # costed for the cache item by item). The same bytes as the list
        # path below; anything else (categorical, string, boolean, a missing
        # entry) falls through to it.
        take = getattr(reader, "get_obs_var_numeric", None)
        values = None
        if take is not None:
            try:
                values = take(entity=type, dataset_path=dataset_path, column_name=column_names[0], indices=indices)
            except Exception as e:
                raise_if_timeout(e)
                values = None       # the list path reads it again and states the error
        if values is not None:
            return binary_response(values)
    try:
        result = reader.get_obs_var(
            dataset_path=dataset_path, 
            entity = type,
            indices=indices, 
            column_names=column_names, 
            include_categories=include_categories
        )
    
        # Add dataset path to the response
        response = {"dataset_path": dataset_path}
        
        # Handle both dict and array results
        if isinstance(result, dict):
            if 'data' in result:
                # New format with data and potentially categories
                response.update(result)
            else:
                # Old format where result is just data dict
                response["data"] = result
        else:
            # Single column result
            response["data"] = result

        _add_boolean_categories(response, include_categories)

        if binary:
            # One plain numeric column goes binary; anything with categories,
            # strings, booleans or missing entries (None) stays JSON.
            data = response.get("data")
            if (isinstance(data, dict) and column_names and len(column_names) == 1
                    and list(data) == list(column_names)
                    and column_names[0] not in (response.get("categories") or {})):
                values = numeric_array(data[column_names[0]])
                if values is not None and values.ndim == 1:
                    return binary_response(values)

        return jsonify(response)
    except Exception as e:
        raise_if_timeout(e)
        _raise_if_store_error(e)
        logger.error(f"Error getting {'obs' if type == 'cells' else 'var'} data for {dataset_path}: {e}")
        return jsonify({"error": f"Failed to get {'obs' if type == 'cells' else 'var'} data: {str(e)}",
                        "reason": "read_failed"}), 500
    

def extract_obsm_varm(dataset_path: str, reader: Reader, key, indices, column_indices, column_name, entity_type = Literal["cells", "genes"], binary: bool = False):
    try:
        # Use direct zarr access for stateless operation
        data = reader.get_obsm_varm(key=key, 
                                    entity = entity_type, 
                                    dataset_path=dataset_path, 
                                    indices=indices, 
                                    col_indices=column_indices,
                                    column_name=column_name
                                    )

        logger.info(f"Successfully loaded {'obsm' if entity_type == 'cells' else 'varm'}/{key} data: {type(data)}, shape: {getattr(data, 'shape', 'unknown')}")

        
        meta = {
            f"{'obsm' if entity_type == 'cells' else 'varm'}_key": key,
            "dataset_path": dataset_path
        }

        # Include column name in response if provided
        if column_name:
            meta["column_name"] = column_name

        return array_response(data, meta, binary)
    except Exception as e:
        raise_if_timeout(e)
        _raise_if_store_error(e)
        logger.error(f"Error getting {'obsm' if entity_type == 'cells' else 'varm'}/{key} data for {dataset_path}: {e}")
        return jsonify({"error": f"Failed to get {'obsm' if entity_type == 'cells' else 'varm'} data: {str(e)}",
                        "reason": "read_failed"}), 500


def extract_uns(uns_key: str, dataset_path: str, reader: Reader):
    try:
        # Use direct zarr access for stateless operation
        data = reader.get_uns(uns_key, dataset_path)
        
        logger.info(f"Successfully loaded uns/{uns_key} data: {type(data)}, shape: {getattr(data, 'shape', 'unknown')}")
        
        return jsonify({
            "data": data,
            "uns_key": uns_key,
            "dataset_path": dataset_path
        })
    except KeyError:
        raise
    except Exception as e:
        raise_if_timeout(e)
        _raise_if_store_error(e)
        logger.error(f"Error getting uns/{uns_key} data for {dataset_path}: {e}")
        return jsonify({"error": f"Failed to get uns data: {str(e)}"}), 500
    
def extract_X(dataset_path: str, row_indices, col_indices, reader: Reader, binary: bool = False):
    try:
        # Use direct zarr access for stateless operation
        data = reader.get_X(dataset_path, row_indices, col_indices)

        logger.info(f"Successfully loaded X data: {type(data)}, shape: {getattr(data, 'shape', 'unknown')}")
        
        return array_response(data, {"dataset_path": dataset_path}, binary)
    except Exception as e:
        raise_if_timeout(e)
        _raise_if_store_error(e)
        logger.error(f"Error getting X data for {dataset_path}: {e}")
        return jsonify({"error": f"Failed to get X data: {str(e)}"}), 500

def extract_layer(dataset_path: str, layer_name: str, row_indices, col_indices, reader: Reader, binary: bool = False):
    try:
        # Use direct zarr access for stateless operation
        data = reader.get_layer(layer_name, dataset_path, row_indices, col_indices)

        logger.info(f"Successfully loaded layer/{layer_name} data: {type(data)}, shape: {getattr(data, 'shape', 'unknown')}")
        
        return array_response(data, {"layer_name": layer_name, "dataset_path": dataset_path}, binary)
    except Exception as e:
        raise_if_timeout(e)
        _raise_if_store_error(e)
        logger.error(f"Error getting layer {layer_name} data for {dataset_path}: {e}")
        return jsonify({"error": f"Failed to get layer data: {str(e)}"}), 500

def extract_obsp_varp(dataset_path: str, key: str, row_indices, col_indices, entity_type: Literal["cells", "genes"], reader: Reader, binary: bool = False):
    try:
    # Use direct zarr access for stateless operation
        data = reader.get_obsp_varp(key = key, entity = entity_type, 
                                        dataset_path=dataset_path, row_indices=row_indices, 
                                        col_indices = col_indices)

        logger.info(f"Successfully loaded {'obsp' if entity_type == 'cells' else 'varp'}/{key} data: {type(data)}, shape: {getattr(data, 'shape', 'unknown')}")
        
        return array_response(data, {
            f"{'obsp' if entity_type == 'cells' else 'varp'}_key": key,
            "dataset_path": dataset_path
        }, binary)
    except Exception as e:
        raise_if_timeout(e)
        _raise_if_store_error(e)
        logger.error(f"Error getting {'obsp' if entity_type == 'cells' else 'varp'}/{key} data for {dataset_path}: {e}")
        return jsonify({"error": f"Failed to get {'obsp' if entity_type == 'cells' else 'varp'} data: {str(e)}"}), 500
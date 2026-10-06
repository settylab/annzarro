"""
Efficient zarr metadata extraction using visititems traversal.

This module provides an optimized function for extracting metadata from zarr stores
using the visititems traversal method for faster performance without loading data.
"""

import zarr
import time
import logging
from typing import Dict, List, Tuple, Optional, Any, Union

logger = logging.getLogger(__name__)



def _category_count(group):
    """Length of a categorical group's categories array, or None."""
    try:
        categories = group['categories']
        shape = getattr(categories, 'shape', None)
        return int(shape[0]) if shape else None
    except Exception:
        return None


def extract_metadata(path: Optional[str] = None, root: Optional[zarr.Group] = None, detail_level: str = 'full') -> Dict[str, Any]:
    """
    Extract metadata from a zarr store using visititems for efficient single-pass traversal
    without loading actual data.
    
    This implementation is significantly faster than the original approach because it:
    1. Uses visititems to traverse the zarr store in a single pass
    2. Only examines metadata attributes without loading actual data arrays
    3. Provides configurable detail levels for different performance needs
    
    Args:
        path: Path to the zarr store
        detail_level: Level of detail to extract
            'minimal' - Only basic structure (fastest)
            'standard' - Column names and embeddings (faster)
            'full' - Complete detailed metadata (default)
        
    Returns:
        Dict of metadata
    """
    start_time = time.time()
    
    if path is None and root is None:
        raise ValueError("Either 'path' or 'root' must be provided.")
    if path is not None and root is not None:
        raise ValueError("Only one of 'path' or 'root' should be provided.")
    if detail_level not in ['minimal', 'standard', 'full']:
        raise ValueError("Invalid detail level. Choose from 'minimal', 'standard', or 'full'.")
    
    if root is not None:
        # Use the provided root zarr group
        zs = root
    else:
        # Open zarr store in read-only mode to avoid creating new directories
        zs = zarr.open_group(path, mode='r')
    open_time = time.time()
    
    # Initialize metadata with basic structural components
    metadata = {
        'has_X': 'X' in zs,
        'has_obs': 'obs' in zs,
        'has_var': 'var' in zs,
        'has_obsm': 'obsm' in zs,
        'has_varm': 'varm' in zs,
        'has_layers': 'layers' in zs,
        'has_uns': 'uns' in zs,
        'has_obsp': 'obsp' in zs,
        'has_varp': 'varp' in zs,
    }
    
    # Extract shape - always needed even for minimal level
    shape = None
    
    # Method 1: Get from X attributes (for sparse matrices)
    if metadata['has_X'] and hasattr(zs['X'], 'attrs') and 'shape' in zs['X'].attrs:
        shape = tuple(zs['X'].attrs['shape'])
        logger.info(f"Got shape from X.attrs: {shape}")
    
    # Method 2: Get from X shape directly (without loading data)
    elif metadata['has_X'] and hasattr(zs['X'], 'shape'):
        shape = zs['X'].shape
        logger.info(f"Got shape from X.shape: {shape}")
    
    # Method 3: Infer from obs and var indices
    elif metadata['has_obs'] and metadata['has_var']:
        # Check for _index attribute in obs group
        obs_index_column = '_index'
        if hasattr(zs['obs'], 'attrs') and '_index' in zs['obs'].attrs:
            obs_index_column = zs['obs'].attrs['_index']
            logger.debug(f"Using custom index column '{obs_index_column}' for obs group from _index attribute")
        
        # Check for _index attribute in var group
        var_index_column = '_index'
        if hasattr(zs['var'], 'attrs') and '_index' in zs['var'].attrs:
            var_index_column = zs['var'].attrs['_index']
            logger.debug(f"Using custom index column '{var_index_column}' for var group from _index attribute")
        
        # Use custom index columns if they exist
        if obs_index_column in zs['obs'] and var_index_column in zs['var']:
            n_obs = zs['obs'][obs_index_column].shape[0]  # Just reads metadata
            n_vars = zs['var'][var_index_column].shape[0]  # Just reads metadata
            shape = (n_obs, n_vars)
            logger.info(f"Inferred shape from obs/var indices: {shape}")
    
    # Method 4: Try from layers
    elif metadata['has_layers'] and list(zs['layers'].keys()):
        layer_name = list(zs['layers'].keys())[0]
        layer = zs['layers'][layer_name]
        
        if hasattr(layer, 'attrs') and 'shape' in layer.attrs:
            shape = tuple(layer.attrs['shape'])
            logger.info(f"Got shape from layer {layer_name} attrs: {shape}")
        elif hasattr(layer, 'shape'):
            shape = layer.shape
            logger.info(f"Got shape from layer {layer_name} shape: {shape}")
    
    metadata['shape'] = shape if shape is not None else (0, 0)
    
    # For minimal level, we're done
    if detail_level == 'minimal':
        logger.info(f"Zarr metadata extraction (minimal): {time.time() - start_time:.4f}s")
        return metadata
    
    # --- Standard level metadata ---
    
    # Extract column lists, embeddings, and key lists - all fast operations
    if metadata['has_obs']:
        metadata['obs_columns'] = list(zs['obs'].keys())
    else:
        metadata['obs_columns'] = []
        
    if metadata['has_var']:
        metadata['var_columns'] = list(zs['var'].keys())
    else:
        metadata['var_columns'] = []
        
    if metadata['has_obsm']:
        # Every obsm key, as the plot axis menus offer: a 'spatial' or
        # 'spatial_upright' embedding has no X_ prefix and was missing here.
        metadata['embeddings'] = list(zs['obsm'].keys())
        metadata['obsm'] = {'keys': list(zs['obsm'].keys())}
    else:
        metadata['embeddings'] = []
        
    if metadata['has_layers']:
        metadata['layers'] = {'keys': list(zs['layers'].keys())}
    
    if metadata['has_obsp']:
        metadata['obsp'] = {'keys': list(zs['obsp'].keys())}
        
    if metadata['has_varp']:
        metadata['varp'] = {'keys': list(zs['varp'].keys())}
        
    if metadata['has_varm']:
        metadata['varm'] = {'keys': list(zs['varm'].keys())}
        
    if metadata['has_uns']:
        metadata['uns'] = {'keys': list(zs['uns'].keys())}
    
    standard_time = time.time()
    
    # For standard level, we're done
    if detail_level == 'standard':
        logger.info(f"Zarr metadata extraction (standard): {time.time() - start_time:.4f}s")
        return metadata
    
    # --- Full level metadata (using visititems) ---
    
    # Initialize containers for detailed info
    metadata['obs_columns_info'] = {}
    metadata['var_columns_info'] = {}
    metadata['layers_info'] = {}
    metadata['obsm_info'] = {}
    metadata['obsm_dataframes'] = {}
    metadata['varm_info'] = {}
    metadata['varm_dataframes'] = {}
    
    # Track processed items to avoid duplicates
    processed = set()
    
    # Helper function to gather data about the zarr structure
    def visitor_function(name: str, obj: Any) -> None:
        """Process each item during hierarchy traversal"""
        # Skip if already processed
        if name in processed:
            return
            
        processed.add(name)
        
        # Extract attributes if available
        attrs = {}
        if hasattr(obj, 'attrs'):
            attrs = dict(obj.attrs)
        
        # Handle arrays (direct access)
        if hasattr(obj, 'shape'):
            # Process arrays based on their path
            path_parts = name.split('/')
            
            # Handle obs columns
            if len(path_parts) >= 2 and path_parts[0] == 'obs':
                col_name = path_parts[1]
                
                # Get the index column name from attributes or default to '_index'
                obs_index_column = '_index'
                if hasattr(zs['obs'], 'attrs') and '_index' in zs['obs'].attrs:
                    obs_index_column = zs['obs'].attrs['_index']
                
                if col_name != obs_index_column and len(path_parts) == 2:
                    info = {'type': str(obj.dtype)}
                    metadata['obs_columns_info'][col_name] = info
            
            # Handle var columns
            elif len(path_parts) >= 2 and path_parts[0] == 'var':
                col_name = path_parts[1]
                
                # Get the index column name from attributes or default to '_index'
                var_index_column = '_index'
                if hasattr(zs['var'], 'attrs') and '_index' in zs['var'].attrs:
                    var_index_column = zs['var'].attrs['_index']
                
                if col_name != var_index_column and len(path_parts) == 2:
                    info = {'type': str(obj.dtype)}
                    metadata['var_columns_info'][col_name] = info
            
            # Handle obsm arrays
            elif len(path_parts) >= 2 and path_parts[0] == 'obsm':
                obsm_name = path_parts[1]
                if len(path_parts) == 2:  # Direct array
                    metadata['obsm_info'][obsm_name] = {
                        'type': str(obj.dtype),
                        'shape': obj.shape
                    }
                    
                    # Add to dataframes if 2D
                    if len(obj.shape) > 1:
                        metadata['obsm_dataframes'][obsm_name] = {
                            'columns': [str(i) for i in range(obj.shape[1])],
                            'is_array': True,
                            'array_shape': obj.shape,
                            'array_dtype': str(obj.dtype)
                        }
                
                elif len(path_parts) == 3:  # Column within a dataframe
                    df_name = path_parts[1]
                    col_name = path_parts[2]
                    
                    # The member arrays of a sparse matrix are not columns,
                    # and a DataFrame's row index is not one either.
                    if (metadata['obsm_dataframes'].get(df_name, {}).get('is_array')
                            or col_name == '_index'):
                        return

                    # Ensure dataframe entry exists
                    if df_name not in metadata['obsm_dataframes']:
                        metadata['obsm_dataframes'][df_name] = {
                            'columns': [],
                            'columns_info': {}
                        }
                    
                    # Add column info
                    if 'columns' in metadata['obsm_dataframes'][df_name] and col_name not in metadata['obsm_dataframes'][df_name]['columns']:
                        metadata['obsm_dataframes'][df_name]['columns'].append(col_name)
                    
                    # Add column metadata
                    if 'columns_info' in metadata['obsm_dataframes'][df_name]:
                        metadata['obsm_dataframes'][df_name]['columns_info'][col_name] = {'type': str(obj.dtype)}
            
            # Handle varm arrays
            elif len(path_parts) >= 2 and path_parts[0] == 'varm':
                varm_name = path_parts[1]
                if len(path_parts) == 2:  # Direct array
                    metadata['varm_info'][varm_name] = {
                        'type': str(obj.dtype),
                        'shape': obj.shape
                    }
                    
                    # Add to dataframes if 2D
                    if len(obj.shape) > 1:
                        metadata['varm_dataframes'][varm_name] = {
                            'columns': [str(i) for i in range(obj.shape[1])],
                            'is_array': True,
                            'array_shape': obj.shape,
                            'array_dtype': str(obj.dtype)
                        }
                
                elif len(path_parts) == 3:  # Column within a dataframe
                    df_name = path_parts[1]
                    col_name = path_parts[2]
                    
                    # The member arrays of a sparse matrix are not columns,
                    # and a DataFrame's row index is not one either.
                    if (metadata['varm_dataframes'].get(df_name, {}).get('is_array')
                            or col_name == '_index'):
                        return

                    # Ensure dataframe entry exists
                    if df_name not in metadata['varm_dataframes']:
                        metadata['varm_dataframes'][df_name] = {
                            'columns': [],
                            'columns_info': {}
                        }
                    
                    # Add column info
                    if 'columns' in metadata['varm_dataframes'][df_name] and col_name not in metadata['varm_dataframes'][df_name]['columns']:
                        metadata['varm_dataframes'][df_name]['columns'].append(col_name)
                    
                    # Add column metadata
                    if 'columns_info' in metadata['varm_dataframes'][df_name]:
                        metadata['varm_dataframes'][df_name]['columns_info'][col_name] = {'type': str(obj.dtype)}
        
        # Handle groups
        elif isinstance(obj, zarr.Group):
            # Extract attributes for type detection
            encoding_type = attrs.get('encoding-type')
            
            # Check for sparse matrices in groups
            if encoding_type in ['csr_matrix', 'csc_matrix', 'coo_matrix'] and 'shape' in attrs:
                shape = tuple(attrs['shape'])
                path_parts = name.split('/')
                
                # Handle X matrix
                if name == 'X':
                    pass  # Already handled in shape detection
                
                # Handle layers
                elif len(path_parts) == 2 and path_parts[0] == 'layers':
                    layer_name = path_parts[1]
                    metadata['layers_info'][layer_name] = {
                        'type': encoding_type,
                        'shape': shape
                    }

                # A sparse obsm/varm matrix is a matrix, addressed by column
                # position like a dense one. Left unhandled here, its
                # data/indices/indptr arrays were listed below as the columns
                # of a "dataframe", so the column picker offered "data",
                # "indices" and "indptr" for X_cnv (settylab/annzarro#42).
                elif len(path_parts) == 2 and path_parts[0] in ('obsm', 'varm'):
                    slot, key = path_parts
                    data_dtype = str(obj['data'].dtype) if 'data' in obj else encoding_type
                    metadata[f'{slot}_info'][key] = {'type': encoding_type, 'shape': shape}
                    if len(shape) > 1:
                        metadata[f'{slot}_dataframes'][key] = {
                            'columns': [str(i) for i in range(shape[1])],
                            'is_array': True,
                            'array_shape': shape,
                            'array_dtype': data_dtype,
                            'sparse': encoding_type
                        }
            
            # Handle categorical columns
            elif encoding_type == 'categorical':
                path_parts = name.split('/')
                
                # Handle obs/var categorical. The number of categories is the
                # length of the categories array, from its metadata (no read):
                # a client decides from it whether a column can be coloured by
                # (core/categories.py) before asking for anything.
                if len(path_parts) == 2 and path_parts[0] in ('obs', 'var'):
                    info = {'type': 'categorical'}
                    n_categories = _category_count(obj)
                    if n_categories is not None:
                        info['n_categories'] = n_categories
                    metadata[f'{path_parts[0]}_columns_info'][path_parts[1]] = info
            
            # Handle root-level containers
            elif name == 'layers':
                # Process each layer to get its type
                for layer_key in obj.keys():
                    layer = obj[layer_key]
                    
                    # Skip if already processed
                    if layer_key in metadata['layers_info']:
                        continue
                        
                    layer_info = {'type': 'unknown'}
                    
                    # Check for arrays (dense layers)
                    if hasattr(layer, 'dtype'):
                        layer_info = {
                            'type': str(layer.dtype),
                            'shape': layer.shape
                        }
                    # Check for sparse matrices
                    elif hasattr(layer, 'attrs'):
                        layer_attrs = dict(layer.attrs)
                        if 'encoding-type' in layer_attrs and layer_attrs['encoding-type'] in ['csr_matrix', 'csc_matrix', 'coo_matrix']:
                            layer_info = {
                                'type': layer_attrs['encoding-type']
                            }
                            if 'shape' in layer_attrs:
                                layer_info['shape'] = tuple(layer_attrs['shape'])
                    
                    metadata['layers_info'][layer_key] = layer_info
            
            # Handle dataframe groups in obsm and varm
            elif len(name.split('/')) == 2:
                path_parts = name.split('/')
                if path_parts[0] == 'obsm':
                    df_name = path_parts[1]
                    # Filter out '_index' from columns list
                    columns = [col for col in obj.keys() if col != '_index']
                    
                    # Add to obsm_info
                    metadata['obsm_info'][df_name] = {
                        'type': 'dataframe',
                        'columns': columns
                    }
                    
                    # Add to obsm_dataframes
                    if df_name not in metadata['obsm_dataframes']:
                        metadata['obsm_dataframes'][df_name] = {
                            'columns': columns,
                            'columns_info': {}
                        }
                        
                        # Add encoding info if available
                        if 'encoding-type' in attrs:
                            metadata['obsm_dataframes'][df_name]['encoding_type'] = attrs['encoding-type']
                        if 'encoding-version' in attrs:
                            metadata['obsm_dataframes'][df_name]['encoding_version'] = attrs['encoding-version']
                
                elif path_parts[0] == 'varm':
                    df_name = path_parts[1]
                    # Filter out '_index' from columns list
                    columns = [col for col in obj.keys() if col != '_index']
                    
                    # Add to varm_info
                    metadata['varm_info'][df_name] = {
                        'type': 'dataframe',
                        'columns': columns
                    }
                    
                    # Add to varm_dataframes
                    if df_name not in metadata['varm_dataframes']:
                        metadata['varm_dataframes'][df_name] = {
                            'columns': columns,
                            'columns_info': {}
                        }
                        
                        # Add encoding info if available
                        if 'encoding-type' in attrs:
                            metadata['varm_dataframes'][df_name]['encoding_type'] = attrs['encoding-type']
                        if 'encoding-version' in attrs:
                            metadata['varm_dataframes'][df_name]['encoding_version'] = attrs['encoding-version']
    
    # Use visititems if available, otherwise use key-based traversal
    if hasattr(zs, 'visititems'):
        # Use visititems if available (for backward compatibility)
        zs.visititems(visitor_function)
    else:
        # Key-based traversal for zarr 3.0+
        def fast_traverse(group, prefix=''):
            # Process direct children (arrays and groups)
            for key in group.keys():
                item = group[key]
                item_path = f"{prefix}/{key}" if prefix else key
                
                # Process the item
                visitor_function(item_path, item)
                
                # If it's a group, recursively traverse
                if isinstance(item, zarr.Group):
                    fast_traverse(item, item_path)
        
        # Start traversal at the root
        fast_traverse(zs)
    
    # Sort any lists for consistency
    for key in ['obs_columns', 'var_columns']:
        if key in metadata and isinstance(metadata[key], list):
            metadata[key] = sorted(metadata[key])
    
    visit_time = time.time()
    logger.info(f"Zarr metadata extraction (full): {time.time() - start_time:.4f}s "
                f"(Open: {open_time - start_time:.4f}s, "
                f"Standard: {standard_time - open_time:.4f}s, "
                f"Detailed: {visit_time - standard_time:.4f}s)")
    
    return metadata
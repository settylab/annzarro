import logging
from typing import Dict, Any, Optional
import zarr


# Set up logging
logger = logging.getLogger(__name__)


def extract_metadata_legacy(self, root: zarr.Group, dataset_id: Optional[str] = None, 
                        disable_caching: bool = False) -> Dict[str, Any]:
    """
    Legacy implementation of metadata extraction.
    Used as fallback when path-based extraction is not possible.
    
    Args:
        self: Instance of the zarr_reader class containing since this used to be a method
        root: Zarr root group
        dataset_id: Optional dataset ID
        disable_caching: If True, don't cache the metadata results even if caching is enabled
        
    Returns:
        Dict of metadata
    """

    metadata = {}
    
    # Get dataset shape
    shape = self._get_dataset_shape(root)
    metadata['shape'] = shape if shape is not None else (0, 0)
    
    # Check for presence of various components
    metadata['has_X'] = 'X' in root
    metadata['has_obs'] = 'obs' in root
    metadata['has_var'] = 'var' in root
    metadata['has_obsm'] = 'obsm' in root
    metadata['has_varm'] = 'varm' in root
    metadata['has_layers'] = 'layers' in root
    metadata['has_uns'] = 'uns' in root
    metadata['has_obsp'] = 'obsp' in root
    metadata['has_varp'] = 'varp' in root
    
    # Get column names and types for obs and var
    metadata['obs_columns'] = []
    metadata['var_columns'] = []
    metadata['obs_columns_info'] = {}
    metadata['var_columns_info'] = {}
    
    if metadata['has_obs'] and hasattr(root['obs'], 'keys'):
        metadata['obs_columns'] = list(root['obs'].keys())
        
        # Get column type information
        for col in metadata['obs_columns']:
            if col == '_index':
                continue
            
            col_info = {}
            try:
                # Check if it's a categorical
                if hasattr(root['obs'][col], 'attrs') and 'encoding-type' in root['obs'][col].attrs:
                    encoding_type = root['obs'][col].attrs['encoding-type']
                    col_info['type'] = encoding_type
                    
                    # Include categories for categorical data
                    if encoding_type == 'categorical' and 'categories' in root['obs'][col]:
                        categories = root['obs'][col]['categories'][:]
                        col_info['categories'] = categories.tolist() if hasattr(categories, 'tolist') else list(categories)
                else:
                    # Regular array, get dtype
                    if hasattr(root['obs'][col], 'dtype'):
                        col_info['type'] = str(root['obs'][col].dtype)
                    else:
                        col_info['type'] = 'unknown'
                
                metadata['obs_columns_info'][col] = col_info
            except Exception as e:
                logger.error(f"Error getting type info for obs column {col}: {e}")
                metadata['obs_columns_info'][col] = {'type': 'error', 'error': str(e)}
    
    if metadata['has_var'] and hasattr(root['var'], 'keys'):
        metadata['var_columns'] = list(root['var'].keys())
        
        # Get column type information
        for col in metadata['var_columns']:
            if col == '_index':
                continue
            
            col_info = {}
            try:
                # Check if it's a categorical
                if hasattr(root['var'][col], 'attrs') and 'encoding-type' in root['var'][col].attrs:
                    encoding_type = root['var'][col].attrs['encoding-type']
                    col_info['type'] = encoding_type
                    
                    # Include categories for categorical data
                    if encoding_type == 'categorical' and 'categories' in root['var'][col]:
                        categories = root['var'][col]['categories'][:]
                        col_info['categories'] = categories.tolist() if hasattr(categories, 'tolist') else list(categories)
                else:
                    # Regular array, get dtype
                    if hasattr(root['var'][col], 'dtype'):
                        col_info['type'] = str(root['var'][col].dtype)
                    else:
                        col_info['type'] = 'unknown'
                
                metadata['var_columns_info'][col] = col_info
            except Exception as e:
                logger.error(f"Error getting type info for var column {col}: {e}")
                metadata['var_columns_info'][col] = {'type': 'error', 'error': str(e)}
        
    # Get embeddings from obsm
    metadata['embeddings'] = []
    if metadata['has_obsm'] and hasattr(root['obsm'], 'keys'):
        metadata['embeddings'] = [key for key in root['obsm'].keys() if key.startswith('X_')]
        
    # Get layer names
    if metadata['has_layers'] and hasattr(root['layers'], 'keys'):
        metadata['layers'] = {'keys': list(root['layers'].keys())}
        metadata['layers_info'] = {}
        
        # Get layer data types
        for layer_key in metadata['layers']['keys']:
            try:
                if hasattr(root['layers'][layer_key], 'dtype'):
                    metadata['layers_info'][layer_key] = {
                        'type': str(root['layers'][layer_key].dtype)
                    }
                else:
                    metadata['layers_info'][layer_key] = {'type': 'unknown'}
            except Exception as e:
                logger.error(f"Error getting type info for layer {layer_key}: {e}")
                metadata['layers_info'][layer_key] = {'type': 'error', 'error': str(e)}
        
    # Get obsm keys and dataframe information
    if metadata['has_obsm'] and hasattr(root['obsm'], 'keys'):
        obsm_keys = list(root['obsm'].keys())
        metadata['obsm'] = {'keys': obsm_keys}
        metadata['obsm_info'] = {}
        
        # Get obsm data types
        for obsm_key in obsm_keys:
            try:
                if hasattr(root['obsm'][obsm_key], 'dtype'):
                    metadata['obsm_info'][obsm_key] = {
                        'type': str(root['obsm'][obsm_key].dtype),
                        'shape': root['obsm'][obsm_key].shape
                    }
                elif hasattr(root['obsm'][obsm_key], 'keys'):
                    # It's a group (likely a dataframe)
                    columns = list(root['obsm'][obsm_key].keys())
                    col_info = {}
                    
                    for col in columns:
                        if hasattr(root['obsm'][obsm_key][col], 'dtype'):
                            col_info[col] = {
                                'type': str(root['obsm'][obsm_key][col].dtype)
                            }
                            # Check for categorical
                            if (hasattr(root['obsm'][obsm_key][col], 'attrs') and 
                                'encoding-type' in root['obsm'][obsm_key][col].attrs and
                                root['obsm'][obsm_key][col].attrs['encoding-type'] == 'categorical'):
                                
                                if 'categories' in root['obsm'][obsm_key][col]:
                                    categories = root['obsm'][obsm_key][col]['categories'][:]
                                    col_info[col]['categories'] = categories.tolist() if hasattr(categories, 'tolist') else list(categories)
                    
                    metadata['obsm_info'][obsm_key] = {
                        'type': 'dataframe', 
                        'columns': columns,
                        'column_info': col_info
                    }
                else:
                    metadata['obsm_info'][obsm_key] = {'type': 'unknown'}
            except Exception as e:
                logger.error(f"Error getting type info for obsm {obsm_key}: {e}")
                metadata['obsm_info'][obsm_key] = {'type': 'error', 'error': str(e)}
        
        # Check for dataframe structures in obsm
        metadata['obsm_dataframes'] = {}
        for key in obsm_keys:
            if key in root['obsm']:
                if self._is_dataframe(root['obsm'][key]):
                    # Add dataframe column information
                    columns = self._get_dataframe_columns(root['obsm'][key])
                    columns_info = self._get_dataframe_columns_info(root['obsm'][key])
                    
                    metadata['obsm_dataframes'][key] = {
                        'columns': columns,
                        'columns_info': columns_info,
                        'encoding_type': root['obsm'][key].attrs.get('encoding-type'),
                        'encoding_version': root['obsm'][key].attrs.get('encoding-version', ''),
                    }
                elif hasattr(root['obsm'][key], 'shape'):
                    # Handle regular arrays - create numbered column names
                    shape = root['obsm'][key].shape
                    if len(shape) > 1:  # Only process 2D arrays
                        # Create numbered column names (0, 1, 2, ...)
                        columns = [str(i) for i in range(shape[1])]
                        
                        metadata['obsm_dataframes'][key] = {
                            'columns': columns,
                            'is_array': True,  # Mark as array rather than dataframe
                            'array_shape': shape,
                            'array_dtype': str(root['obsm'][key].dtype),
                        }
        
    # Get varm keys and dataframe information
    if metadata['has_varm'] and hasattr(root['varm'], 'keys'):
        varm_keys = list(root['varm'].keys())
        metadata['varm'] = {'keys': varm_keys}
        metadata['varm_info'] = {}
        
        # Get varm data types
        for varm_key in varm_keys:
            try:
                if hasattr(root['varm'][varm_key], 'dtype'):
                    metadata['varm_info'][varm_key] = {
                        'type': str(root['varm'][varm_key].dtype),
                        'shape': root['varm'][varm_key].shape
                    }
                elif hasattr(root['varm'][varm_key], 'keys'):
                    # It's a group (likely a dataframe)
                    columns = list(root['varm'][varm_key].keys())
                    col_info = {}
                    
                    for col in columns:
                        if hasattr(root['varm'][varm_key][col], 'dtype'):
                            col_info[col] = {
                                'type': str(root['varm'][varm_key][col].dtype)
                            }
                            # Check for categorical
                            if (hasattr(root['varm'][varm_key][col], 'attrs') and 
                                'encoding-type' in root['varm'][varm_key][col].attrs and
                                root['varm'][varm_key][col].attrs['encoding-type'] == 'categorical'):
                                
                                if 'categories' in root['varm'][varm_key][col]:
                                    categories = root['varm'][varm_key][col]['categories'][:]
                                    col_info[col]['categories'] = categories.tolist() if hasattr(categories, 'tolist') else list(categories)
                    
                    metadata['varm_info'][varm_key] = {
                        'type': 'dataframe', 
                        'columns': columns,
                        'column_info': col_info
                    }
                else:
                    metadata['varm_info'][varm_key] = {'type': 'unknown'}
            except Exception as e:
                logger.error(f"Error getting type info for varm {varm_key}: {e}")
                metadata['varm_info'][varm_key] = {'type': 'error', 'error': str(e)}
        
        # Check for dataframe structures in varm
        metadata['varm_dataframes'] = {}
        for key in varm_keys:
            if key in root['varm']:
                if self._is_dataframe(root['varm'][key]):
                    # Add dataframe column information
                    columns = self._get_dataframe_columns(root['varm'][key])
                    columns_info = self._get_dataframe_columns_info(root['varm'][key])
                    
                    metadata['varm_dataframes'][key] = {
                        'columns': columns,
                        'columns_info': columns_info,
                        'encoding_type': root['varm'][key].attrs.get('encoding-type'),
                        'encoding_version': root['varm'][key].attrs.get('encoding-version', ''),
                    }
                elif hasattr(root['varm'][key], 'shape'):
                    # Handle regular arrays - create numbered column names
                    shape = root['varm'][key].shape
                    if len(shape) > 1:  # Only process 2D arrays
                        # Create numbered column names (0, 1, 2, ...)
                        columns = [str(i) for i in range(shape[1])]
                        
                        metadata['varm_dataframes'][key] = {
                            'columns': columns,
                            'is_array': True,  # Mark as array rather than dataframe
                            'array_shape': shape,
                            'array_dtype': str(root['varm'][key].dtype),
                        }
        
    # Get obsp keys
    if metadata['has_obsp'] and hasattr(root['obsp'], 'keys'):
        metadata['obsp'] = {'keys': list(root['obsp'].keys())}
        
    # Get varp keys
    if metadata['has_varp'] and hasattr(root['varp'], 'keys'):
        metadata['varp'] = {'keys': list(root['varp'].keys())}

    # Get uns keys
    if metadata['has_uns'] and hasattr(root['uns'], 'keys'):
        metadata['uns'] = {'keys': list(root['uns'].keys())}
        
    return metadata

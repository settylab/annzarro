"""
Zarr Reader - Handles loading AnnData in zarr format

This module provides functionality for loading zarr data from various sources:
- Local files (directory or archive)
- URL (HTTP/HTTPS)
- S3 bucket

Features:
- Lazy loading support for efficient memory usage
- Support for sparse matrices (CSR, CSC, COO formats)
- Multi-dataset support with stateless API
- Advanced shape discovery
- Subset selection for matrices (rows, columns)
- Paginated data access
- Handling of all AnnData components (X, obs, var, obsm, varm, layers, obsp, varp)
"""

import os
import logging
import numpy as np
import zarr
from typing import Dict, List, Tuple, Optional, Union, Any, Callable, Literal
from pathlib import Path

from .metadata_extraction import extract_metadata
from .caching import DatasetCache, cached_method

# Try to import optional dependencies
try:
    import dask.array as da
    DASK_AVAILABLE = True
except ImportError:
    DASK_AVAILABLE = False

try:
    import scipy.sparse as sp
    SCIPY_SPARSE_AVAILABLE = True
except ImportError:
    SCIPY_SPARSE_AVAILABLE = False

try:
    import s3fs
    S3FS_AVAILABLE = True
except ImportError:
    S3FS_AVAILABLE = False

try:
    import fsspec
    FSSPEC_AVAILABLE = True
except ImportError:
    FSSPEC_AVAILABLE = False

# Set up logging
logger = logging.getLogger(__name__)

class ZarrReader:
    """
    Class for reading AnnData objects from zarr sources with lazy loading.
    
    This class provides methods to:
    1. Load zarr from different sources (local, URL, S3)
    2. Read metadata without loading full data
    3. Selectively load parts of the data
    4. Support multiple sparse matrix formats (CSR, CSC, COO)
    5. Support multiple datasets with dataset IDs
    6. Provide stateless access for improved concurrency
    
    The implementation emphasizes:
    - Efficient memory usage through lazy loading
    - Support for sparse matrices
    - Robust error handling
    - Clean separation of concerns
    """
    
    def __init__(self, max_memory_mb=1000, enable_caching=True, cache_limit=10):
        """
        Initialize the ZarrReader.
        
        Args:
            max_memory_mb: Maximum memory usage in MB for internal caching
            enable_caching: Whether to enable caching of data
            cache_limit: Maximum number of datasets to keep in memory
        """
        # Initialize the cache manager
        self.cache = DatasetCache(max_memory_mb=max_memory_mb, 
                                 enable_caching=enable_caching, 
                                 cache_limit=cache_limit)
        
        # Keep reference to cache settings for backwards compatibility
        self.max_memory_mb = max_memory_mb
        self.enable_caching = enable_caching
        self.cache_limit = cache_limit
        
        # Optional initialization of backends
        self._check_backends()
    
    def _check_backends(self):
        """Check and log available optional backends."""
        backends = {
            "Dask": DASK_AVAILABLE,
            "SciPy Sparse": SCIPY_SPARSE_AVAILABLE,
            "S3FS": S3FS_AVAILABLE,
            "fsspec": FSSPEC_AVAILABLE
        }
        
        logger.info("Available backends:")
        for name, available in backends.items():
            logger.info(f"- {name}: {'Available' if available else 'Not available'}")
        
        # Check if sparse matrices can be supported
        if not SCIPY_SPARSE_AVAILABLE:
            logger.warning("SciPy sparse matrix support is not available. Sparse matrices will be converted to dense.")
            
    # Deprecated method - delegating to cache
    def _estimate_size_mb(self, obj):
        """Estimate the memory size of an object in MB."""
        return self.cache._estimate_memory_usage(obj)
    
    # Deprecated method - delegating to cache
    def _manage_cache_size(self):
        """Manage cache size by removing least recently used items when limits are exceeded."""
        self.cache._manage_cache_size()
    
    # Deprecated method - delegating to cache with dataset handling
    def _remove_dataset_from_cache(self, dataset_path):
        """Remove all cached items for a specific dataset."""
        logger.info(f"_REMOVE_DATASET: Removing all cache entries for {dataset_path}")
        # Use the cache manager to remove dataset from cache
        self.cache._remove_dataset_from_cache(dataset_path)
    
    # Deprecated method - delegating to cache
    def _add_to_cache(self, key, data, cache_type='matrix'):
        """Add an item to the appropriate cache with memory tracking."""
        # Log cache addition
        logger.info(f"_ADD_TO_CACHE: Adding to {cache_type} cache with key '{key}'")
        
        # Extract dataset_path from key if present
        # We expect keys in the format "path:encoded_dataset_path:..." where dataset_path is URL-encoded
        dataset_path = None
        if key.startswith("path:"):
            # Remove "path:" prefix and get the encoded dataset_path part
            parts = key[5:].split(":", 1)
            if len(parts) > 0:
                encoded_path = parts[0]
                # Decode the URL-encoded path
                import urllib.parse
                try:
                    dataset_path = urllib.parse.unquote(encoded_path)
                except Exception as e:
                    logger.warning(f"Error decoding dataset path from cache key: {e}")
                    dataset_path = encoded_path  # Use as-is as fallback
            
        # Use the cache manager to add item to cache
        self.cache._add_to_cache(key, data, dataset_path=dataset_path, cache_type=cache_type)
    
    # Deprecated method - delegating to cache
    def _get_from_cache(self, key, cache_type='matrix'):
        """Get an item from the appropriate cache and update access time."""
        return self.cache._get_from_cache(key, cache_type=cache_type)
    
    def get_cache_info(self):
        """
        Get information about the current cache state.
        
        Returns:
            dict: Information about the current cache
        """
        # Get cache info from cache manager
        cache_info = self.cache.get_cache_info()
        
        return cache_info
    
    def clear_cache(self, dataset_path=None):
        """
        Clear the internal data cache.
        
        Args:
            dataset_path: Optional dataset path to clear from cache.
                          If None, clears the entire cache.
                       
        Returns:
            dict: Information about the cleared cache
        """
        logger.info(f"CLEAR_CACHE: Called with dataset_path={dataset_path}")
        
        # Use the cache manager to clear cache
        result = self.cache.clear_cache(dataset_path=dataset_path)
                
        logger.info(f"CLEAR_CACHE: Cache cleared with result: {result}")
        return result
        
    
    @cached_method
    def open_dataset_by_path(self, dataset_path: str, metadata: bool=True, metadata_level: str='full', use_cache: bool=True) -> Tuple[zarr.Group, Dict[str, Any]]:
        """
        Open a dataset by path.

        Args:
            path: Path to the zarr directory or file
            metadata: If metadata should be returned (Default=True)
            metadata_level: Level of metadata detail to extract:
                'minimal' - Basic structure only (fastest)
                'standard' - Column names and embeddings (faster)
                'full' - Complete detailed metadata (default)
            use_cache: Whether to cache the results (Default=True)

        Returns:
            Tuple of (zarr root, metadata dict)
            
        Raises:
            ValueError: For invalid paths or dataset formats
            RuntimeError: For other operational errors
        """
        logger.info(f"OPEN_DATASET_BY_PATH: Called with path={dataset_path}, metadata={metadata}, "
                   f"metadata_level={metadata_level}, use_cache={use_cache}")
        
        try:
            # Get the root once
            root = self._get_root(dataset_path)
            
            # Check if we got a valid root
            if root is None:
                raise ValueError(f"Unable to open zarr dataset at path: {dataset_path}")
            
            if not metadata:
                return root, {}
            
            # Check basic AnnData structure
            basic_structure = []
            if 'X' not in root:
                basic_structure.append("X matrix")
            if 'obs' not in root:
                basic_structure.append("obs annotations")
            if 'var' not in root:
                basic_structure.append("var annotations")
                
            if basic_structure:
                missing = ", ".join(basic_structure)
                logger.warning(f"Dataset at {dataset_path} is missing key AnnData components: {missing}")
            
            # Extract metadata with the appropriate caching behavior, passing the existing root
            metadata_dict = self.get_metadata(
                root=root,
                detail_level=metadata_level,
                dataset_path = dataset_path
            )
            
            return root, metadata_dict
            
        except ValueError as e:
            # For invalid paths, propagate the error with the detailed message
            logger.error(f"Invalid dataset path or format: {dataset_path}: {e}")
            raise
        except Exception as e:
            # Log details for unexpected errors
            logger.error(f"Error opening dataset by path {dataset_path}: {e}")
            import traceback
            logger.error(traceback.format_exc())
            raise RuntimeError(f"Failed to open dataset: {str(e)}")
    
    def _get_root(self, dataset_path: str) -> Optional[zarr.Group]:
        """
        Get the root group for a dataset.
        
        Args:
            dataset_path: Path to the zarr dataset
        
        Returns:
            zarr.Group: The zarr root group, or None if not found
            
        Raises:
            ValueError: If the dataset_path is invalid or the dataset cannot be found
            RuntimeError: If there's an error opening the dataset
        """
        if dataset_path is None:
            logger.error("_get_root: No dataset_path provided")
            raise ValueError("No dataset path provided")
            
        logger.debug(f"_get_root: Loading root for path {dataset_path}")
        
        # Look for the root using the path
        try:
            if dataset_path.startswith("s3://"):
                if not S3FS_AVAILABLE:
                    raise ImportError("s3fs package required for S3 access")
                
                parts = dataset_path.replace("s3://", "").split("/", 1)
                bucket = parts[0]
                key = parts[1] if len(parts) > 1 else ""
                
                fs = s3fs.S3FileSystem(anon=True)
                store = zarr.storage.FSStore(f'{bucket}/{key}', fs=fs)
                return zarr.open_group(store, mode='r')
            
            elif dataset_path.startswith(("http://", "https://")):
                if FSSPEC_AVAILABLE:
                    store = fsspec.filesystem('http').get_mapper(dataset_path)
                else:
                    store = dataset_path
                return zarr.open_group(store, mode='r')
            
            else:
                # Local file access - do more thorough validation
                path_obj = Path(dataset_path)
                
                # Check if path exists
                if not path_obj.exists():
                    raise ValueError(f"Path does not exist: {dataset_path}")
                
                # Check if it's a directory
                if not path_obj.is_dir():
                    # Check if it's a zarr file
                    if not dataset_path.endswith(('.zarr', '.zr')):
                        raise ValueError(f"Path is not a directory or zarr file: {dataset_path}")
                
                # For directories, check if it appears to be a zarr directory
                # by looking for .zarray or .zgroup files
                if path_obj.is_dir() and not any((path_obj / file).exists() 
                                              for file in ['.zarray', '.zgroup']):
                    raise ValueError(f"Directory does not appear to be a zarr dataset: {dataset_path}")
                
                try:
                    # Use regular open_group for existing paths, which works better with various zarr formats
                    return zarr.open_group(dataset_path, mode='r')
                except Exception as e:
                    # Check the error message to identify specific error types
                    if "path not found" in str(e).lower():
                        raise ValueError(f"Not a valid zarr dataset: {dataset_path}")
                    else:
                        raise ValueError(f"Failed to open zarr dataset: {dataset_path}, error: {e}")
        
        except Exception as e:
            # Identify specific zarr errors by their message content
            error_msg = str(e).lower()
            if "path not found" in error_msg:
                err_msg = f"Path not found or is not a valid zarr dataset: {dataset_path}"
                logger.error(err_msg)
                raise ValueError(err_msg) from e
            elif "contains an array" in error_msg:
                err_msg = f"Path contains an array instead of a group: {dataset_path}"
                logger.error(err_msg)
                raise ValueError(err_msg) from e
            elif "contains a group" in error_msg:
                err_msg = f"Path contains a group instead of an array: {dataset_path}"
                logger.error(err_msg)
                raise ValueError(err_msg) from e
        except (ValueError, ImportError) as e:
            # Re-raise ValueErrors and ImportErrors directly
            logger.error(f"Error with dataset path {dataset_path}: {e}")
            raise
        except Exception as e:
            error_msg = f"Error opening dataset from path {dataset_path}: {e}"
            logger.error(error_msg)
            raise RuntimeError(error_msg) from e
    
    def _get_dataset_shape(self, root: zarr.Group) -> Optional[Tuple[int, int]]:
        """
        Get the shape of a dataset from a zarr root.
        
        Args:
            root: Zarr root group
            
        Returns:
            Tuple of (n_obs, n_vars) or None if shape cannot be determined
        """
        shape = None
        
        # Method 1: Get from X shape directly
        if 'X' in root and hasattr(root['X'], 'shape'):
            try:
                shape = root['X'].shape
                logger.info(f"Got shape from X.shape: {shape}")
                return shape
            except Exception as e:
                logger.debug(f"Could not get shape from X.shape: {e}")
        
        # Method 2: Get from X attributes (for sparse matrices)
        if 'X' in root and hasattr(root['X'], 'attrs') and 'shape' in root['X'].attrs:
            try:
                shape = tuple(root['X'].attrs['shape'])
                logger.info(f"Got shape from X.attrs: {shape}")
                return shape
            except Exception as e:
                logger.debug(f"Could not get shape from X.attrs: {e}")
        
        # Method 3: Infer from obs and var lengths
        try:
            n_obs = len(root['obs']['_index']) if 'obs' in root and '_index' in root['obs'] else 0
            n_vars = len(root['var']['_index']) if 'var' in root and '_index' in root['var'] else 0
            if n_obs > 0 and n_vars > 0:
                shape = (n_obs, n_vars)
                logger.info(f"Inferred shape from obs and var: {shape}")
                return shape
        except Exception as e:
            logger.debug(f"Could not infer shape from obs and var: {e}")
        
        # Method 4: Try other matrices (layers, etc.)
        if 'layers' in root and hasattr(root['layers'], 'keys'):
            for layer_name in root['layers'].keys():
                try:
                    layer = root['layers'][layer_name]
                    if hasattr(layer, 'shape'):
                        shape = layer.shape
                        logger.info(f"Got shape from layer {layer_name}: {shape}")
                        return shape
                    elif hasattr(layer, 'attrs') and 'shape' in layer.attrs:
                        shape = tuple(layer.attrs['shape'])
                        logger.info(f"Got shape from layer {layer_name} attrs: {shape}")
                        return shape
                except Exception as e:
                    logger.debug(f"Could not get shape from layer {layer_name}: {e}")
        
        logger.warning("Could not determine dataset shape")
        return None
    
    def _get_matrix_info(self, matrix) -> Dict[str, Any]:
        """
        Get information about a matrix.
        
        Args:
            matrix: Zarr array or group
            
        Returns:
            Dictionary of matrix information
        """
        info = {}
        
        # Regular array attributes
        if hasattr(matrix, 'shape'):
            info['shape'] = matrix.shape
        if hasattr(matrix, 'chunks'):
            info['chunks'] = matrix.chunks
        if hasattr(matrix, 'dtype'):
            info['dtype'] = str(matrix.dtype)
        
        # Get all attributes if available (including sparse format info)
        if hasattr(matrix, 'attrs'):
            # Copy all attributes
            for key, value in matrix.attrs.items():
                info[key] = value
            
            # Add shape from attributes if not already set
            if 'shape' in matrix.attrs and 'shape' not in info:
                info['shape'] = tuple(matrix.attrs['shape'])
                
            # Add encoding information for sparse matrices
            if 'encoding-type' in matrix.attrs:
                info['encoding-type'] = matrix.attrs['encoding-type']
                if 'encoding-version' in matrix.attrs:
                    info['encoding-version'] = matrix.attrs['encoding-version']
        
        return info
    
    def _is_dataframe(self, group) -> bool:
        """
        Check if a zarr group is a dataframe-encoded matrix.
        
        In AnnData zarr format, dataframes (obsm/varm) are encoded with special structure:
        - A group with encoding-type="dataframe" attribute
        - A column-order attribute listing the column names
        - Each column stored as a separate subgroup or dataset
        - Often an _index group for row names
        
        This method checks if a group has the essential attributes to be 
        identified as a dataframe.
        
        Args:
            group: Zarr group to check
            
        Returns:
            bool: True if the group is a dataframe-encoded matrix
        """
        if not hasattr(group, 'attrs'):
            return False
            
        # Check for dataframe encoding type
        return (
            'encoding-type' in group.attrs and 
            group.attrs['encoding-type'] == 'dataframe' and 
            'column-order' in group.attrs
        )

    def _get_dataframe_columns(self, group) -> List[str]:
        """
        Get column names for a dataframe-encoded group.
        
        Args:
            group: Zarr group containing dataframe data
            
        Returns:
            List of column names
        """
        if not self._is_dataframe(group):
            return []
            
        # Get column names from column-order attribute
        try:
            return list(group.attrs['column-order'])
        except Exception as e:
            logger.error(f"Error getting dataframe columns: {e}")
            return []
    
    def _get_dataframe_columns_info(self, group) -> Dict[str, Dict]:
        """
        Get detailed information about dataframe columns.
        
        Args:
            group: Zarr group containing dataframe data
            
        Returns:
            Dict mapping column names to their information
        """
        if not self._is_dataframe(group):
            return {}
        
        column_info = {}
        
        try:
            # Get basic column names from column-order
            column_names = self._get_dataframe_columns(group)
            
            # For each column, gather additional information if available
            for col_name in column_names:
                col_info = {
                    'name': col_name,
                }
                
                # If the column exists as a subgroup, get its info
                if col_name in group and hasattr(group[col_name], 'attrs'):
                    # Add shape info if available
                    if hasattr(group[col_name], 'shape'):
                        col_info['shape'] = group[col_name].shape
                    
                    # Add attribute info
                    for key, value in group[col_name].attrs.items():
                        col_info[key] = value
                
                column_info[col_name] = col_info
        
        except Exception as e:
            logger.error(f"Error getting dataframe column info: {e}")
        
        return column_info
                
    def get_basic_counts(self, path: str) -> Dict[str, int]:
        """
        Get only the cell and gene counts from a dataset without extracting full metadata.
        This is a faster alternative to open_dataset_by_path when only basic counts are needed.
        
        Args:
            path: Path to the zarr directory or file
            
        Returns:
            Dict with cell_count and gene_count
            
        Raises:
            ValueError: If the zarr store doesn't appear to be a valid AnnData structure
        """
        try:
            # Open the zarr store
            root = zarr.open_group(path, mode='r')
            
            # Initialize counts
            cell_count = 0
            gene_count = 0
            
            # Check if obs group exists
            if 'obs' in root:
                # Check for _index attribute in obs group to determine the column name
                index_column = '_index'
                if hasattr(root['obs'], 'attrs') and '_index' in root['obs'].attrs:
                    index_column = root['obs'].attrs['_index']
                    logger.debug(f"Using custom index column '{index_column}' for obs group from _index attribute")
                
                # Get cell count from index column shape
                if index_column in root['obs'] and hasattr(root['obs'][index_column], 'shape'):
                    cell_count = root['obs'][index_column].shape[0]
            
            # Check if var group exists
            if 'var' in root:
                # Check for _index attribute in var group to determine the column name
                index_column = '_index'
                if hasattr(root['var'], 'attrs') and '_index' in root['var'].attrs:
                    index_column = root['var'].attrs['_index']
                    logger.debug(f"Using custom index column '{index_column}' for var group from _index attribute")
                
                # Get gene count from index column shape
                if index_column in root['var'] and hasattr(root['var'][index_column], 'shape'):
                    gene_count = root['var'][index_column].shape[0]
            
            # If counts are not found, try to get them from X shape if available
            if (cell_count == 0 or gene_count == 0) and 'X' in root and hasattr(root['X'], 'shape'):
                shape = root['X'].shape
                if len(shape) >= 2:
                    cell_count = shape[0] if cell_count == 0 else cell_count
                    gene_count = shape[1] if gene_count == 0 else gene_count
            
            # If both cell_count and gene_count are still 0, this isn't a valid AnnData structure
            if cell_count == 0 and gene_count == 0:
                raise ValueError("No cell or gene counts found in zarr store, not a valid AnnData structure")
            
            return {
                'cell_count': cell_count,
                'gene_count': gene_count
            }
        except Exception as e:
            logger.error(f"Error getting basic counts from {path}: {e}")
            raise
    
    @cached_method
    def _extract_metadata(self, root: Optional[zarr.Group] = None, dataset_path: Optional[str] = None, 
                      detail_level: str = "full") -> Dict[str, Any]:
      """
      Extract metadata from a zarr root.

      Args:
          root: Zarr root group
          dataset_path: Path to the zarr dataset (used for caching)
          detail_level: Level of detail to extract ('minimal', 'standard', or 'full')

      Returns:
          Dict of metadata
      """
      # Use path-based extraction
      try:
          metadata = extract_metadata(dataset_path, root, detail_level=detail_level)
          return metadata
      except Exception as e:
          logger.error(f"Error in path-based metadata extraction: {e}")
          import traceback
          logger.error(traceback.print_exc())
          return {}

    
    @cached_method
    def get_metadata(self, dataset_path: str, detail_level: str = "full", root: Optional[zarr.Group] = None) -> Dict[str, Any]:
        """
        Get metadata for a dataset.
        
        Args:
            dataset_path: Path to the zarr dataset
            detail_level: Level of detail to extract ('minimal', 'standard', or 'full')
            root: Optional zarr root group, to avoid duplicate calls to _get_root
            
        Returns:
            Dict of metadata
        """
        logger.debug(f"GET_METADATA: Called with dataset_path={dataset_path}")
        
        # Extract metadata now that we have a root
        try:
            # Extract metadata
            if root is not None:
                metadata = self._extract_metadata(root=root, detail_level=detail_level)
            else:
                metadata = self._extract_metadata(dataset_path=dataset_path, detail_level=detail_level)
            
            return metadata
            
        except Exception as e:
            logger.error(f"GET_METADATA: Error extracting metadata: {e}")
            import traceback
            logger.info(traceback.print_exc())
            return {}
            
    def _get_shape_from_root(self, root) -> Tuple[int, int]:
        """
        Get the shape of a dataset from its root group.
        
        Args:
            root: Zarr root group
            
        Returns:
            Tuple of (n_obs, n_vars) representing the dataset shape
        """
        shape = None
        
        # Method 1: Get from X attributes (for sparse matrices)
        if 'X' in root and hasattr(root['X'], 'attrs') and 'shape' in root['X'].attrs:
            shape = tuple(root['X'].attrs['shape'])
            logger.debug(f"Got shape from X.attrs: {shape}")
        
        # Method 2: Get from X shape directly (without loading data)
        elif 'X' in root and hasattr(root['X'], 'shape'):
            shape = root['X'].shape
            logger.debug(f"Got shape from X.shape: {shape}")
        
        # Method 3: Infer from obs and var indices
        elif 'obs' in root and 'var' in root:
            # Check for _index attribute in obs group
            obs_index_column = '_index'
            if hasattr(root['obs'], 'attrs') and '_index' in root['obs'].attrs:
                obs_index_column = root['obs'].attrs['_index']
                
            # Check for _index attribute in var group
            var_index_column = '_index'
            if hasattr(root['var'], 'attrs') and '_index' in root['var'].attrs:
                var_index_column = root['var'].attrs['_index']
                
            # Use custom index columns if they exist
            if obs_index_column in root['obs'] and var_index_column in root['var']:
                n_obs = root['obs'][obs_index_column].shape[0]  # Just reads metadata
                n_vars = root['var'][var_index_column].shape[0]  # Just reads metadata
                shape = (n_obs, n_vars)
                logger.debug(f"Inferred shape from obs/var indices: {shape}")
        
        # Method 4: Try from layers
        elif 'layers' in root and list(root['layers'].keys()):
            layer_name = list(root['layers'].keys())[0]
            layer = root['layers'][layer_name]
            
            if hasattr(layer, 'attrs') and 'shape' in layer.attrs:
                shape = tuple(layer.attrs['shape'])
                logger.debug(f"Got shape from layer {layer_name} attrs: {shape}")
            elif hasattr(layer, 'shape'):
                shape = layer.shape
                logger.debug(f"Got shape from layer {layer_name} shape: {shape}")
        
        return shape if shape is not None else (0, 0)
        
    def _is_sparse_matrix(self, matrix) -> Tuple[bool, Optional[str]]:
        """
        Check if a zarr array is a sparse matrix.
        
        Args:
            matrix: Zarr array or group
            
        Returns:
            Tuple of (is_sparse, sparse_format)
            sparse_format can be 'csr_matrix', 'csc_matrix', 'coo_matrix', or None
        """
        if not hasattr(matrix, 'attrs'):
            return False, None
            
        # Check for encoding-type attribute
        if 'encoding-type' in matrix.attrs:
            encoding_type = matrix.attrs['encoding-type']
            if encoding_type in ['csr_matrix', 'csc_matrix', 'coo_matrix']:
                return True, encoding_type
                
        return False, None
    
    def _load_sparse_matrix(self, matrix, row_indices=None, col_indices=None) -> Optional[np.ndarray]:
        """
        Load a sparse matrix from a zarr group.
        
        Args:
            matrix: Zarr group containing sparse matrix components
            row_indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select
            
        Returns:
            numpy.ndarray or scipy.sparse matrix
        """
        if not SCIPY_SPARSE_AVAILABLE:
            logger.warning("SciPy sparse matrix support not available. Converting to dense.")
            return None  # Will fall back to dense conversion
            
        # Get sparse format
        is_sparse, sparse_format = self._is_sparse_matrix(matrix)
        if not is_sparse:
            return None
            
        # Get shape
        if 'shape' not in matrix.attrs:
            logger.error("Sparse matrix missing shape attribute")
            return None
            
        shape = tuple(matrix.attrs['shape'])
        
        try:
            # Handle CSR format
            if sparse_format == 'csr_matrix':
                if not all(k in matrix for k in ['data', 'indices', 'indptr']):
                    logger.error("Missing required components for CSR matrix")
                    return None
                    
                data = matrix['data'][:]
                indices = matrix['indices'][:]
                indptr = matrix['indptr'][:]
                
                # Create the sparse matrix
                sparse_matrix = sp.csr_matrix((data, indices, indptr), shape=shape)
                
                # Handle subsetting
                if row_indices is not None and col_indices is not None:
                    return sparse_matrix[row_indices, :][:, col_indices]
                elif row_indices is not None:
                    return sparse_matrix[row_indices, :]
                elif col_indices is not None:
                    return sparse_matrix[:, col_indices]
                else:
                    return sparse_matrix
                    
            # Handle CSC format
            elif sparse_format == 'csc_matrix':
                if not all(k in matrix for k in ['data', 'indices', 'indptr']):
                    logger.error("Missing required components for CSC matrix")
                    return None
                    
                data = matrix['data'][:]
                indices = matrix['indices'][:]
                indptr = matrix['indptr'][:]
                
                # Create the sparse matrix
                sparse_matrix = sp.csc_matrix((data, indices, indptr), shape=shape)
                
                # Handle subsetting
                if row_indices is not None and col_indices is not None:
                    return sparse_matrix[row_indices, :][:, col_indices]
                elif row_indices is not None:
                    return sparse_matrix[row_indices, :]
                elif col_indices is not None:
                    return sparse_matrix[:, col_indices]
                else:
                    return sparse_matrix
                    
            # Handle COO format
            elif sparse_format == 'coo_matrix':
                if not all(k in matrix for k in ['data', 'row', 'col']):
                    logger.error("Missing required components for COO matrix")
                    return None
                    
                data = matrix['data'][:]
                row = matrix['row'][:]
                col = matrix['col'][:]
                
                # Create the sparse matrix
                sparse_matrix = sp.coo_matrix((data, (row, col)), shape=shape)
                
                # Convert to CSR for subsetting (COO doesn't support indexing)
                sparse_matrix = sparse_matrix.tocsr()
                
                # Handle subsetting
                if row_indices is not None and col_indices is not None:
                    return sparse_matrix[row_indices, :][:, col_indices]
                elif row_indices is not None:
                    return sparse_matrix[row_indices, :]
                elif col_indices is not None:
                    return sparse_matrix[:, col_indices]
                else:
                    return sparse_matrix
            
            else:
                logger.warning(f"Unknown sparse matrix format: {sparse_format}")
                return None
                
        except Exception as e:
            logger.error(f"Error loading sparse matrix: {e}")
            return None
    
    def _get_dense_array(self, path: str, root: zarr.Group, row_indices=None, col_indices=None) -> np.ndarray:
        """
        Get a dense array from a zarr path, with optional subsetting.
        
        Args:
            path: Path to the zarr array within the root
            root: Zarr root group
            row_indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select
            
        Returns:
            numpy.ndarray: The requested data
        """
        if path not in root:
            return np.array([])
            
        try:
            array = root[path]
            
            # Check for empty array
            if getattr(array, 'size', 0) == 0:
                return np.array([])
            
            # Handle subsetting
            if row_indices is not None and col_indices is not None:
                if len(array.shape) != 2:
                    # For non-2D arrays, flatten indices won't work right
                    logger.warning(f"Array {path} is not 2D, ignoring col_indices for subsetting")
                    return array[row_indices]
                return array[row_indices, :][:, col_indices]
            elif row_indices is not None:
                return array[row_indices]
            elif col_indices is not None:
                if len(array.shape) != 2:
                    # For non-2D arrays, can't subset columns
                    logger.warning(f"Array {path} is not 2D, ignoring col_indices for subsetting")
                    return array[:]
                return array[:, col_indices]
            else:
                return array[:]
        except Exception as e:
            logger.error(f"Error getting dense array {path}: {e}")
            return np.array([])
    
    @cached_method
    def get_X(self, dataset_path: Optional[str] = None, row_indices: Optional[List[int]] = None, 
              col_indices: Optional[List[int]] = None, disable_caching: bool = False) -> np.ndarray:
        """
        Get the X matrix from a dataset.
        
        Args:
            dataset_path: Path to the dataset (stateless operation)
            row_indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select
            disable_caching: If True, don't use cache even if enabled
            
        Returns:
            numpy.ndarray: The X matrix data
        """
        root = self._get_root(dataset_path=dataset_path)
        
        if root is None or 'X' not in root:
            return np.array([])
        
        # Check if X is a sparse matrix
        is_sparse, _ = self._is_sparse_matrix(root['X'])
        if is_sparse:
            sparse_matrix = self._load_sparse_matrix(root['X'], row_indices, col_indices)
            if sparse_matrix is not None:
                # Convert to dense array for consistent return type
                return sparse_matrix.toarray()
        
        # Handle as dense array
        return self._get_dense_array('X', root, row_indices, col_indices)
    
    @cached_method
    def get_layer(self, layer_name: str, dataset_path: Optional[str] = None, 
                 row_indices: Optional[List[int]] = None, col_indices: Optional[List[int]] = None,
                 disable_caching: bool = False) -> np.ndarray:
        """
        Get a layer from a dataset.
        
        Args:
            layer_name: Name of the layer to get
            dataset_path: Path to the dataset (stateless operation)
            row_indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select
            disable_caching: If True, don't use cache even if enabled
            
        Returns:
            numpy.ndarray: The layer data
        """
        root = self._get_root(dataset_path=dataset_path)
        
        if root is None or 'layers' not in root or layer_name not in root['layers']:
            return np.array([])
        
        # Get the layer
        layer = root['layers'][layer_name]
        
        # Check if it's a sparse matrix
        is_sparse, _ = self._is_sparse_matrix(layer)
        if is_sparse:
            sparse_matrix = self._load_sparse_matrix(layer, row_indices, col_indices)
            if sparse_matrix is not None:
                # Convert to dense array for consistent return type
                return sparse_matrix.toarray()
        
        # Handle as dense array
        return self._get_dense_array(f'layers/{layer_name}', root, row_indices, col_indices)
    
    def _get_categorical_values(self, group, indices=None, return_categories=False):
        """
        Get values from a categorical data structure in AnnData.
        
        In AnnData zarr format, categorical data is stored as a group with:
        - 'codes': Array of category indices
        - 'categories': Array of category values
        
        Args:
            group: Zarr group containing categorical data
            indices: Optional list of row indices to select
            return_categories: If True, return a tuple of (values, categories)
            
        Returns:
            List of category values or tuple of (values, categories) if return_categories is True
        """
        try:
            # Check if this is a categorical encoding
            if (hasattr(group, 'attrs') and 
                'encoding-type' in group.attrs and 
                group.attrs['encoding-type'] == 'categorical' and
                'codes' in group and 'categories' in group):
                
                # Get codes and categories
                categories = group['categories'][:]
                if indices is not None:
                    codes = group['codes'][indices]
                else:
                    codes = group['codes'][:]
                
                # Map codes to categories using NumPy vectorization
                # Create a mask for valid codes
                valid_mask = (codes >= 0) & (codes < len(categories))
                
                # Initialize values array with None or empty
                values = np.array([None] * len(codes), dtype=object)
                
                # Update only valid indices using vectorized indexing
                values[valid_mask] = categories[codes[valid_mask]]
                
                # Return values and categories if requested
                if return_categories:
                    return values.tolist(), categories.tolist() if hasattr(categories, 'tolist') else list(categories)
                return values
            
            # Not a categorical, just return the array directly
            result = group[indices] if indices is not None else group[:]
            
            # For non-categorical data, return just the values
            if return_categories:
                return result, []
            return result
        except Exception as e:
            logger.error(f"Error processing categorical data: {e}")
            if return_categories:
                return [], []
            return []

    @cached_method
    def get_obs_var(self, entity = Literal["cells", "genes"], dataset_path: Optional[str] = None,
               indices: Optional[List[int]] = None, column_names: Optional[List[str]] = None,
               include_categories: bool = True) -> Dict[str, Any]:
        """
        Get observation annotations.
        
        Args:
            column_name: Optional specific column to get
            dataset_path: Path to the dataset (stateless operation)
            indices: Optional list of indices to select
            column_names: Optional list of column names to get
            include_categories: Include category lists for categorical columns
            root: Optional zarr root group, to avoid duplicate calls to _get_root
            
        Returns:
            Dict of column name -> list of values, or list of values for a specific column
        """
        root = self._get_root(dataset_path=dataset_path)
        obj = "obs" if entity == "cells" else "var"
        
        if root is None or obj not in root:
            return {}
        
        # Get multiple columns
        result = {'data': {}}
        categories_dict = {}
        
        # Determine which columns to get
        if column_names is not None:
            columns_to_get = [col for col in column_names if col in root[obj]]
        else:
            # Get the index column name from attributes or default to '_index'
            obs_index_column = '_index'
            if hasattr(root[obj], 'attrs') and '_index' in root[obj].attrs:
                obs_index_column = root[obj].attrs['_index']
                
            # Filter out the index column as it's a special key
            columns_to_get = [col for col in root[obj].keys() if col != obs_index_column]
            
            # Add _index as a column for backwards compatibility with tests
            if obs_index_column in root[obj]:
                try:
                    # Get cell names
                    cell_names = root[obj][obs_index_column][:]
                    result['data']['_index'] = cell_names.tolist() if hasattr(cell_names, 'tolist') else list(cell_names)
                except Exception as e:
                    logger.error(f"Error getting cell names: {e}")
                    result['data']['_index'] = []
        
        # Get each column
        for col in columns_to_get:
            try:
                # Check if it's a categorical
                col_data = root[obj][col]
                
                if include_categories:
                    # Get values and categories directly from the method
                    values, categories = self._get_categorical_values(col_data, indices, return_categories=True)
                    
                    # Convert to Python list for JSON serialization
                    result['data'][col] = values.tolist() if hasattr(values, 'tolist') else list(values)
                    
                    # Add categories info if available
                    if categories:
                        categories_dict[col] = categories
                else:
                    # Just get the values without categories
                    values = self._get_categorical_values(col_data, indices)
                    
                    # Convert to Python list for JSON serialization
                    result['data'][col] = values.tolist() if hasattr(values, 'tolist') else list(values)
            except Exception as e:
                logger.error(f"Error getting obs column {col}: {e}")
                result['data'][col] = []
        
        # Add categories if any were found
        if categories_dict and include_categories:
            result['categories'] = categories_dict
        
        return result
    
    def _get_dataframe_column(self, group, column_name: str, indices: Optional[List[int]] = None) -> np.ndarray:
        """
        Get a specific column from a dataframe-encoded group.
        
        Args:
            group: Zarr group containing dataframe data
            column_name: Name of the column to get
            indices: Optional list of row indices to select
            
        Returns:
            numpy.ndarray: The column data
        """
        if not self._is_dataframe(group):
            return np.array([])
            
        # Check if column exists
        if column_name not in group:
            logger.error(f"Column {column_name} not found in dataframe")
            return np.array([])
            
        # Get the column data
        try:
            column = group[column_name]
            
            # In zarr, the actual data is often stored in a dataset named '0'
            if '0' in column:
                data_array = column['0']
                
                # Handle subsetting with indices
                if indices is not None:
                    return data_array[indices]
                else:
                    return data_array[:]
            else:
                # Fallback to direct access if '0' is not found
                if indices is not None:
                    return column[indices]
                else:
                    return column[:]
        except Exception as e:
            logger.error(f"Error getting dataframe column {column_name}: {e}")
            return np.array([])
    
    @cached_method
    def get_obsm_varm(self, entity: Literal["cells", "genes"], key: str, dataset_path: Optional[str] = None,
                indices: Optional[List[int]] = None, col_indices: Optional[List[int]] = None,
                column_name: Optional[str] = None) -> np.ndarray:
        """
        Get observation multi-dimensional annotations.
        
        Args:
            obsm_key: Key in obsm to get
            dataset_path: Path to the dataset (stateless operation)
            indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select
            column_name: Optional column name for dataframe-encoded obsm
            
        Returns:
            numpy.ndarray: The obsm data
        """
        root = self._get_root(dataset_path=dataset_path)
        obj = "obsm" if entity == "cells" else "varm"
        
        if root is None or obj not in root or key not in root[obj]:
            return np.array([])
        
        # Check if this is a dataframe and column_name is specified
        is_dataframe = self._is_dataframe(root[obj][key])
        
        if is_dataframe and column_name is not None:
            # Get specific column from dataframe
            return self._get_dataframe_column(root[obj][key], column_name, indices)
        
        # Check if we're dealing with a regular array but requested a specific column
        if not is_dataframe and column_name is not None and hasattr(root[obj][key], 'shape'):
            # Try to interpret column_name as an integer index
            try:
                col_idx = int(column_name)
                arr = self._get_dense_array(f'{obj}/{key}', root, indices, None)
                if len(arr.shape) > 1 and col_idx < arr.shape[1]:
                    # Return specific column from the array
                    return arr[:, col_idx]
            except (ValueError, IndexError) as e:
                logger.error(f"Error extracting column {column_name} from array {obj}/{key}: {e}")
        
        # Get the obsm data as a regular array
        return self._get_dense_array(f'{obj}/{key}', root, indices, col_indices)
    
    @cached_method
    def get_obsp_varp(self, key: str, entity: Literal["cells", "genes"],
                 dataset_path: Optional[str] = None,
                 row_indices: Optional[List[int]] = None,
                 col_indices: Optional[List[int]] = None) -> np.ndarray:
        """
        Get observation-observation matrices.
    
        Args:
            obsp_key: Key in obsp to get.
            dataset_path: Path to the dataset (stateless operation).
            row_indices: Optional list of row indices to select.
            col_indices: Optional list of column indices to select.
    
        Returns:
            numpy.ndarray: The obsp data.
        """
        root = self._get_root(dataset_path=dataset_path)
        layer_to_get = "obsp" if entity == "cells" else "varp"
    
        if root is None or layer_to_get not in root or key not in root[layer_to_get]:
            return np.array([])
    
        obj = root[layer_to_get][key]
        is_sparse, _ = self._is_sparse_matrix(obj)
    
        if is_sparse:
            # For sparse matrices, pass distinct row and column indices.
            sparse_matrix = self._load_sparse_matrix(obj, row_indices, col_indices)
            if sparse_matrix is not None:
                return sparse_matrix.toarray()
    
        # For dense obsp matrices, allow separate row and column selection.
        try:
            # Use provided indices, or default to full slice if None.
            row_sel = row_indices if row_indices is not None else slice(None)
            col_sel = col_indices if col_indices is not None else slice(None)
            data = root[layer_to_get][key][row_sel, :][:, col_sel]
            return np.asarray(data)
        except Exception as e:
            logger.error(f"Error getting obsp data with row_indices {row_indices} and col_indices {col_indices}: {e}")
            return np.array([])
    
    def _downsample_array(self, path: str, max_size: int = 1000, dataset_path: Optional[str] = None) -> np.ndarray:
        """
        Downsample a large array to a manageable size.
        
        Args:
            path: Path to the zarr array
            max_size: Maximum number of elements in each dimension
            dataset_path: Path to the dataset
            
        Returns:
            numpy.ndarray: The downsampled data
        """
        # Get the root for the dataset
        root = self._get_root(dataset_path=dataset_path)
        if root is None or path not in root:
            return np.array([])
            
        try:
            array = root[path]
            shape = array.shape
            
            if len(shape) != 2:
                logger.warning(f"Downsampling only supported for 2D arrays, got shape {shape}")
                return array[:]
                
            # Calculate stride for each dimension
            row_stride = max(1, shape[0] // max_size)
            col_stride = max(1, shape[1] // max_size)
            
            # Create index arrays for strided access
            row_indices = np.arange(0, shape[0], row_stride)
            col_indices = np.arange(0, shape[1], col_stride)
            
            # Limit the number of indices if still too large
            if len(row_indices) > max_size:
                row_indices = row_indices[:max_size]
            if len(col_indices) > max_size:
                col_indices = col_indices[:max_size]
                
            # Load the downsampled data
            return array[row_indices[:, np.newaxis], col_indices]
            
        except Exception as e:
            logger.error(f"Error downsampling array {path} in dataset {dataset_path}: {e}")
            return np.array([])
    
    def _load_chunked_data(self, path: str, row_indices: Optional[List[int]] = None, 
                          col_indices: Optional[List[int]] = None,
                          dataset_path: Optional[str] = None) -> np.ndarray:
        """
        Load data using an optimized chunking strategy for large datasets.
        
        Args:
            path: Path to the zarr array
            row_indices: List of row indices to select
            col_indices: List of column indices to select
            dataset_path: Path to the dataset
            
        Returns:
            numpy.ndarray: The chunked data
        """
        # Get the root for the dataset
        root = self._get_root(dataset_path=dataset_path)
        if root is None or path not in root:
            return np.array([])
            
        try:
            array = root[path]
            chunks = getattr(array, 'chunks', None)
            
            # If chunks info is not available, fall back to regular loading
            if chunks is None:
                logger.warning(f"Chunk information not available for {path} in dataset {dataset_path}, using standard loading")
                if row_indices is not None and col_indices is not None:
                    return array[row_indices, :][:, col_indices]
                elif row_indices is not None:
                    return array[row_indices, :]
                elif col_indices is not None:
                    return array[:, col_indices]
                else:
                    return array[:]
            
            # Determine ranges to load
            if row_indices is not None:
                min_row = min(row_indices)
                max_row = max(row_indices)
                row_range = (min_row, max_row + 1)
            else:
                row_range = None
                
            if col_indices is not None:
                min_col = min(col_indices)
                max_col = max(col_indices)
                col_range = (min_col, max_col + 1)
            else:
                col_range = None
            
            # Calculate chunk boundaries for optimal loading
            if row_range and col_range:
                # Both dimensions have ranges defined
                chunk_row_start = (row_range[0] // chunks[0]) * chunks[0]
                chunk_row_end = ((row_range[1] + chunks[0] - 1) // chunks[0]) * chunks[0]
                
                chunk_col_start = (col_range[0] // chunks[1]) * chunks[1]
                chunk_col_end = ((col_range[1] + chunks[1] - 1) // chunks[1]) * chunks[1]
                
                # Adjust boundaries to array dimensions
                chunk_row_end = min(chunk_row_end, array.shape[0])
                chunk_col_end = min(chunk_col_end, array.shape[1])
                
                # Load data in chunks
                data_chunks = []
                for row_start in range(chunk_row_start, chunk_row_end, chunks[0]):
                    row_end = min(row_start + chunks[0], chunk_row_end)
                    row_data = []
                    
                    for col_start in range(chunk_col_start, chunk_col_end, chunks[1]):
                        col_end = min(col_start + chunks[1], chunk_col_end)
                        chunk = array[row_start:row_end, col_start:col_end]
                        row_data.append(chunk)
                    
                    if row_data:
                        data_chunks.append(np.concatenate(row_data, axis=1))
                
                if data_chunks:
                    full_data = np.concatenate(data_chunks, axis=0)
                    
                    # Now extract the exact indices requested
                    if row_indices is not None and col_indices is not None:
                        # Convert absolute indices to relative indices within the loaded chunk
                        rel_row_indices = [i - chunk_row_start for i in row_indices]
                        rel_col_indices = [i - chunk_col_start for i in col_indices]
                        return full_data[rel_row_indices, :][:, rel_col_indices]
                    
                    return full_data
            
            # Fall back to regular loading for simpler cases
            if row_indices is not None and col_indices is not None:
                return array[row_indices, :][:, col_indices]
            elif row_indices is not None:
                return array[row_indices, :]
            elif col_indices is not None:
                return array[:, col_indices]
            else:
                return array[:]
                
        except Exception as e:
            logger.error(f"Error loading chunked data for {path} in dataset {dataset_path}: {e}")
            return np.array([])
            
    def load_progressively(self, path: str, chunk_size: int = 1000, 
                          callback: Optional[callable] = None,
                          dataset_path: Optional[str] = None) -> np.ndarray:
        """
        Load data progressively with callback for progress updates.
        
        Args:
            path: Path to the zarr array
            chunk_size: Size of chunks to load at once
            callback: Callback function called with (chunk, progress)
            dataset_path: Path to the dataset
            
        Returns:
            numpy.ndarray: The complete loaded data
        """
        # Get the root for the specified dataset
        root = self._get_root(dataset_path=dataset_path)
        
        if root is None or path not in root:
            return np.array([])
            
        try:
            array = root[path]
            shape = array.shape
            
            # For 1D arrays
            if len(shape) == 1:
                data = np.zeros(shape, dtype=array.dtype)
                chunks = [(i, min(i + chunk_size, shape[0])) 
                         for i in range(0, shape[0], chunk_size)]
                
                for i, (start, end) in enumerate(chunks):
                    data[start:end] = array[start:end]
                    progress = (i + 1) / len(chunks)
                    
                    if callback:
                        callback(data.copy(), progress)
                        
                return data
                
            # For 2D arrays
            elif len(shape) == 2:
                data = np.zeros(shape, dtype=array.dtype)
                chunks = [(i, min(i + chunk_size, shape[0])) 
                         for i in range(0, shape[0], chunk_size)]
                
                for i, (start, end) in enumerate(chunks):
                    data[start:end, :] = array[start:end, :]
                    progress = (i + 1) / len(chunks)
                    
                    if callback:
                        callback(data.copy(), progress)
                        
                return data
                
            # For higher dimensional arrays, load all at once
            else:
                data = array[:]
                if callback:
                    callback(data, 1.0)
                return data
                
        except Exception as e:
            logger.error(f"Error loading data progressively from {path} for dataset {dataset_path}: {e}")
            return np.array([])
            
    def _get_paginated_data(self, data: np.ndarray, page: int, page_size: int) -> Tuple[np.ndarray, Dict[str, int]]:
        """
        Get a paginated subset of a data array.
        
        Args:
            data: The data array
            page: Page number (0-based)
            page_size: Number of items per page
            
        Returns:
            Tuple of (paginated data, pagination metadata)
        """
        try:
            # Calculate pagination
            total_rows = data.shape[0]
            total_pages = (total_rows + page_size - 1) // page_size
            
            # Adjust page if out of bounds
            page = max(0, min(page, total_pages - 1)) if total_pages > 0 else 0
            
            # Get the paginated subset
            start = page * page_size
            end = min(start + page_size, total_rows)
            
            paginated_data = data[start:end]
            
            # Pagination metadata
            pagination = {
                "page": page,
                "page_size": page_size,
                "total_rows": total_rows,
                "total_pages": total_pages
            }
            
            return paginated_data, pagination
        except Exception as e:
            logger.error(f"Error getting paginated data: {e}")
            return np.array([]), {
                "page": page,
                "page_size": page_size,
                "total_rows": 0,
                "total_pages": 0
            }
    
    def get_X_paginated(self, dataset_path: str, row_indices: Optional[List[int]] = None,
                       col_indices: Optional[List[int]] = None, page: int = 0, page_size: int = 100) -> Tuple[np.ndarray, Dict[str, int]]:
        """
        Get paginated X matrix data.
        
        Args:
            dataset_path: Path to the dataset
            row_indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select
            page: Page number (0-based)
            page_size: Number of items per page
            
        Returns:
            Tuple of (paginated data, pagination metadata)
        """
        # Get the data
        data = self.get_X(dataset_path=dataset_path, row_indices=row_indices, col_indices=col_indices)
        
        # Apply pagination
        return self._get_paginated_data(data, page, page_size)
    
    def get_layer_paginated(self, dataset_path: str, layer_name: str, row_indices: Optional[List[int]] = None,
                          col_indices: Optional[List[int]] = None, page: int = 0, page_size: int = 100) -> Tuple[np.ndarray, Dict[str, int]]:
        """
        Get paginated layer data.
        
        Args:
            dataset_path: Path to the dataset
            layer_name: Name of the layer to get
            row_indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select
            page: Page number (0-based)
            page_size: Number of items per page
            
        Returns:
            Tuple of (paginated data, pagination metadata)
        """
        # Get the data
        data = self.get_layer(layer_name, dataset_path=dataset_path, row_indices=row_indices, col_indices=col_indices)
        
        # Apply pagination
        return self._get_paginated_data(data, page, page_size)
    
    def get_obsm_paginated(self, dataset_path: str, obsm_key: str, row_indices: Optional[List[int]] = None,
                         col_indices: Optional[List[int]] = None, page: int = 0, page_size: int = 100,
                         column_name: Optional[str] = None) -> Tuple[np.ndarray, Dict[str, int]]:
        """
        Get paginated obsm data.
        
        Args:
            dataset_path: Path to the dataset
            obsm_key: Key in obsm to get
            row_indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select
            page: Page number (0-based)
            page_size: Number of items per page
            column_name: Optional column name for dataframe-encoded obsm
            
        Returns:
            Tuple of (paginated data, pagination metadata)
        """
        # Get the data
        data = self.get_obsm_varm(key = obsm_key, entity = "cells", dataset_path=dataset_path, indices=row_indices, 
                           col_indices=col_indices, column_name=column_name)
        
        # Apply pagination
        return self._get_paginated_data(data, page, page_size)
    
    def get_varm_paginated(self, dataset_path: str, varm_key: str, row_indices: Optional[List[int]] = None,
                         col_indices: Optional[List[int]] = None, page: int = 0, page_size: int = 100,
                         column_name: Optional[str] = None) -> Tuple[np.ndarray, Dict[str, int]]:
        """
        Get paginated varm data.
        
        Args:
            dataset_path: Path to the dataset
            varm_key: Key in varm to get
            row_indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select
            page: Page number (0-based)
            page_size: Number of items per page
            column_name: Optional column name for dataframe-encoded varm
            
        Returns:
            Tuple of (paginated data, pagination metadata)
        """
        # Get the data
        data = self.get_obsm_varm(key = varm_key, entity = "genes", dataset_path=dataset_path, indices=row_indices, 
                           col_indices=col_indices, column_name=column_name)
        
        # Apply pagination
        return self._get_paginated_data(data, page, page_size)
    
    def get_dataframe_column_names(self, component: str, key: str, dataset_path: Optional[str] = None) -> List[str]:
        """
        Get column names for a dataframe-encoded component.
        
        Args:
            component: Component name ('obsm' or 'varm')
            key: Key within the component
            dataset_path: Path to the dataset (stateless operation)
            
        Returns:
            List of column names
        """
        root = self._get_root(dataset_path=dataset_path)
        
        if root is None or component not in root or key not in root[component]:
            return []
        
        # Check if the component has dataframe encoding
        if self._is_dataframe(root[component][key]):
            return self._get_dataframe_columns(root[component][key])
            
        # Check if it's a regular array and generate numbered column names
        if hasattr(root[component][key], 'shape'):
            shape = root[component][key].shape
            if len(shape) > 1:  # Only process 2D arrays
                # Return numbered columns (0, 1, 2, ...)
                return [str(i) for i in range(shape[1])]
        
        # Direct extraction of column names from data structure without using metadata
        try:
            if component in {'obsm', 'varm'} and key in root[component]:
                # Try to check if there's a columns attribute directly on the array
                if hasattr(root[component][key], 'attrs') and 'columns' in root[component][key].attrs:
                    return list(root[component][key].attrs['columns'])
                
                # For regular 2D arrays, just return numbered columns as a fallback
                if hasattr(root[component][key], 'shape') and len(root[component][key].shape) > 1:
                    return [str(i) for i in range(root[component][key].shape[1])]
        except Exception as e:
            logger.error(f"Error extracting column names directly from structure: {e}")
        
        return []
    
    def get_obsm_dataframe_columns(self, obsm_key: str, dataset_path: Optional[str] = None) -> List[str]:
        """
        Get column names for a dataframe-encoded obsm key.
        
        Args:
            obsm_key: Key in obsm
            dataset_path: Path to the dataset (stateless operation)
            
        Returns:
            List of column names
        """
        return self.get_dataframe_column_names('obsm', obsm_key, dataset_path)
    
    def get_varm_dataframe_columns(self, varm_key: str, dataset_path: Optional[str] = None) -> List[str]:
        """
        Get column names for a dataframe-encoded varm key.
        
        Args:
            varm_key: Key in varm
            dataset_path: Path to the dataset (stateless operation)
            
        Returns:
            List of column names
        """
        return self.get_dataframe_column_names('varm', varm_key, dataset_path)
    
    def get_obsp_paginated(self, dataset_path: str, obsp_key: str, row_indices: Optional[List[int]] = None,
                         col_indices: Optional[List[int]] = None, page: int = 0, page_size: int = 100) -> Tuple[np.ndarray, Dict[str, int]]:
        """
        Get paginated obsp data.
        
        Args:
            dataset_path: Path to the dataset
            obsp_key: Key in obsp to get
            row_indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select (ignored, uses row_indices)
            page: Page number (0-based)
            page_size: Number of items per page
            
        Returns:
            Tuple of (paginated data, pagination metadata)
        """
        # Get the data
        data = self.get_obsp_varp(key = obsp_key, entity = "cells", dataset_path=dataset_path, indices=row_indices)
        
        # Apply pagination
        return self._get_paginated_data(data, page, page_size)
    
    def get_varp_paginated(self, dataset_path: str, varp_key: str, row_indices: Optional[List[int]] = None,
                         col_indices: Optional[List[int]] = None, page: int = 0, page_size: int = 100) -> Tuple[np.ndarray, Dict[str, int]]:
        """
        Get paginated varp data.
        
        Args:
            dataset_path: Path to the dataset
            varp_key: Key in varp to get
            row_indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select (ignored, uses row_indices)
            page: Page number (0-based)
            page_size: Number of items per page
            
        Returns:
            Tuple of (paginated data, pagination metadata)
        """
        # Get the data
        data = self.get_obsp_varp(key = varp_key, entity = "genes", dataset_path=dataset_path, indices=row_indices)
        
        # Apply pagination
        return self._get_paginated_data(data, page, page_size)
        
    def get_uns_keys(self, dataset_path: Optional[str] = None, use_cache: Optional[bool] = True) -> List[str]:
        """
        Get the keys in the uns section.
        
        Args:
            dataset_path: Path to the dataset (stateless operation)
            use_cache: Whether to use cached dataset if available
            
        Returns:
            List of keys in the uns section
        """
        root = self._get_root(dataset_path=dataset_path)
        
        if root is None or 'uns' not in root:
            return []
        
        # Return the keys in the uns section
        if hasattr(root['uns'], 'keys'):
            return list(root['uns'].keys())
        
        return []
    
    def get_uns_structure(self, dataset_path: Optional[str] = None) -> Dict[str, Any]:
        """
        Get the structure of the uns section including keys and their encoding types.
        
        Args:
            dataset_path: Path to the dataset (stateless operation)
            
        Returns:
            Dict with keys and their encoding types
        """
        root = self._get_root(dataset_path=dataset_path)
        
        if root is None or 'uns' not in root:
            return {}
        
        # Get the structure of the uns section
        uns_structure = {}
        
        for key in self.get_uns_keys(dataset_path):
            try:
                # Check if it has encoding-type attribute
                if hasattr(root['uns'][key], 'attrs') and 'encoding-type' in root['uns'][key].attrs:
                    encoding_type = root['uns'][key].attrs['encoding-type']
                else:
                    # Infer the type
                    if hasattr(root['uns'][key], 'shape'):
                        # It's a dataset/array
                        dtype = str(root['uns'][key].dtype)
                        shape = root['uns'][key].shape
                        encoding_type = f"array({dtype})"
                    elif hasattr(root['uns'][key], 'keys'):
                        # It's a group/dictionary
                        encoding_type = "dict"
                    else:
                        # Unknown
                        encoding_type = "unknown"
                
                uns_structure[key] = {"encoding-type": encoding_type}
                
                # Add shape information if available
                if hasattr(root['uns'][key], 'shape'):
                    uns_structure[key]["shape"] = root['uns'][key].shape
                
            except Exception as e:
                logger.error(f"Error getting encoding type for uns/{key}: {e}")
                uns_structure[key] = {"encoding-type": "error", "error": str(e)}
        
        return uns_structure
    
    @cached_method
    def get_uns(self, key: str, dataset_path: Optional[str] = None, disable_caching: bool = False) -> Any:
        """
        Get data from the uns section.
        
        Args:
            key: Key in uns to get
            dataset_path: Path to the dataset (stateless operation)
            disable_caching: If True, don't use cache even if enabled
            
        Returns:
            The data from the uns section. Could be a numpy array, dict, or other structure.
        """
        root = self._get_root(dataset_path=dataset_path)
        
        if root is None or 'uns' not in root or key not in root['uns']:
            return None
        
        try:
            # Check if it's a group (dict-like)
            if hasattr(root['uns'][key], 'keys'):
                # Create a dictionary representation
                result = {}
                for subkey in root['uns'][key].keys():
                    # Recursively convert zarr object to Python native type
                    if hasattr(root['uns'][key][subkey], 'keys'):
                        # It's a nested group
                        subresult = {}
                        for subsubkey in root['uns'][key][subkey].keys():
                            try:
                                value = root['uns'][key][subkey][subsubkey][:]
                                subresult[subsubkey] = value.tolist() if hasattr(value, 'tolist') else value
                            except Exception as e:
                                logger.warning(f"Error converting uns/{key}/{subkey}/{subsubkey}: {e}")
                                subresult[subsubkey] = str(root['uns'][key][subkey][subsubkey])
                        result[subkey] = subresult
                    else:
                        # It's a dataset
                        try:
                            value = root['uns'][key][subkey][:]
                            result[subkey] = value.tolist() if hasattr(value, 'tolist') else value
                        except Exception as e:
                            logger.warning(f"Error converting uns/{key}/{subkey}: {e}")
                            result[subkey] = str(root['uns'][key][subkey])
                return result
            else:
                # It's a dataset, get the data
                value = root['uns'][key][:]
                return value.tolist() if hasattr(value, 'tolist') else value
        except Exception as e:
            logger.error(f"Error getting uns data for {key}: {e}")
            return None

    def get_cell_gene_names(self, dataset_path: str, entity: Literal["cells", "genes"], use_cache: bool = False) -> List[str]:
        """
        Get list of gene names.
        
        Args:
            dataset_path: Path to the dataset (stateless operation)
            use_cache: Whether to cache the dataset for future use
            
        Returns:
            List of gene names
            
        Raises:
            ValueError: If the dataset path is invalid
            RuntimeError: If there's an error opening or processing the dataset
        """
        try:
            logger.info(f"GET_{'GENE' if entity == 'genes' else 'CELL'}_NAMES: Opening dataset {dataset_path} with use_cache={use_cache}")
            root = self._get_root(dataset_path=dataset_path)
            logger.info(f"GET_{'GENE' if entity == 'genes' else 'CELL'}_NAMES: Successfully opened dataset {dataset_path}")
        except (ValueError, RuntimeError) as e:
            # Re-raise these specific exceptions to be handled by the route
            logger.error(f"Error opening dataset from path {dataset_path}: {e}")
            raise
        except Exception as e:
            # Wrap other exceptions in a RuntimeError with a descriptive message
            error_msg = f"Unexpected error opening dataset {dataset_path}: {e}"
            logger.error(error_msg)
            raise RuntimeError(error_msg) from e
        
        if root is None:
            raise ValueError(f"Unable to access dataset at path: {dataset_path}")
        
        obj = 'var' if entity == 'genes' else 'obs'
        if obj not in root:
            # Return empty list for dataset without variables
            logger.warning(f"Dataset at {dataset_path} has no '{obj}' data")
            return []
            
        # Check for _index attribute in var group
        index_column = '_index'
        if hasattr(root[obj], 'attrs') and '_index' in root[obj].attrs:
            index_column = root[obj].attrs['_index']
            logger.debug(f"Using custom index column '{index_column}' for {obj} group from _index attribute")
        
        # Check if the index column exists
        if index_column not in root[obj]:
            logger.warning(f"Index column '{index_column}' not found in {obj} group")
            return []
        
        # Get gene names
        try:
            names = root[obj][index_column][:]
            return names.tolist() if hasattr(names, 'tolist') else list(names)
        except Exception as e:
            error_msg = f"Error getting {'gene' if obj == 'var' else 'cell'} names from dataset {dataset_path}: {e}"
            logger.error(error_msg)
            raise RuntimeError(error_msg) from e
    
    def get_obs_names(self, dataset_path: Optional[str] = None) -> List[str]:
        """
        Get observation names (alias for get_cell_names for backward compatibility).
        
        Args:
            dataset_path: Path to the dataset
            
        Returns:
            List of observation names
        """
        return self.get_cell_gene_names(dataset_path=dataset_path, entity="cells")

    def get_var_names(self, dataset_path: Optional[str] = None) -> List[str]:
        """
        Get variable names (alias for get_gene_names for backward compatibility).
        
        Args:
            dataset_path: Path to the dataset
            
        Returns:
            List of variable names
        """
        return self.get_cell_gene_names(dataset_path=dataset_path, entity="genes")
    
    def get_data_by_path(self, path: str, dataset_path: Optional[str] = None, 
                    indices: Optional[List[int]] = None, col_indices: Optional[List[int]] = None) -> np.ndarray:
        """
        Get data using a path notation like "varm/kompot_de_mean_lfc_Young_to_Old_groups/B cells".
        
        This allows accessing dataframe columns with their path directly. The path notation
        supports the following formats:
        
        - "X" - Get the X matrix
        - "obsm/key" - Get the obsm matrix with the given key
        - "varm/key" - Get the varm matrix with the given key
        - "obsm/key/column" - Get a specific column from a dataframe-encoded obsm matrix
        - "varm/key/column" - Get a specific column from a dataframe-encoded varm matrix
        - "layers/key" - Get a layer with the given key
        - "obsp/key" - Get an obsp matrix with the given key
        - "varp/key" - Get a varp matrix with the given key
        
        This method is particularly useful for accessing dataframe columns that may have spaces
        or special characters in their names.
        
        Args:
            path: Path notation (e.g. "varm/key/column" or "obsm/key")
            dataset_path: Path to the dataset (stateless operation)
            indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select
            
        Returns:
            numpy.ndarray: The requested data
        """
        parts = path.strip('/').split('/')
        
        # Handle invalid paths
        if len(parts) < 2:
            logger.error(f"Invalid path format: {path}. Expected format like 'varm/key' or 'varm/key/column'")
            return np.array([])
        
        component = parts[0]  # e.g., "varm", "obsm", "obsp", "layers"
        key = parts[1]        # e.g., "kompot_de_mean_lfc_Young_to_Old_groups"
        
        # Handle dataframe column access with 3-part path
        if len(parts) == 3 and (component == 'varm' or component == 'obsm'):
            column_name = parts[2]  # e.g., "B cells"
            
            if component == 'varm':
                return self.get_obsm_varm(key = key, entity= "genes", dataset_path=dataset_path, indices=indices, 
                                  col_indices=col_indices, column_name=column_name)
            elif component == 'obsm':
                return self.get_obsm_varm(key = key, entity = "cells", dataset_path=dataset_path, indices=indices, 
                                  col_indices=col_indices, column_name=column_name)
        
        # Handle regular 2-part path
        if component == 'X':
            return self.get_X(dataset_path=dataset_path, row_indices=indices, 
                           col_indices=col_indices)
        elif component == 'obsm':
            return self.get_obsm_varm(key = key, entity = "cells", dataset_path=dataset_path, indices=indices, 
                              col_indices=col_indices)
        elif component == 'varm':
            return self.get_obsm_varm(key = key, entity = "genes", dataset_path=dataset_path, indices=indices, 
                              col_indices=col_indices)
        elif component == 'layers':
            return self.get_layer(key, dataset_path=dataset_path, row_indices=indices, 
                               col_indices=col_indices)
        elif component == 'obsp':
            return self.get_obsp_varp(key = key, entity = "cells", dataset_path=dataset_path, indices=indices)
        elif component == 'varp':
            return self.get_obsp_varp(key= key, entity = "genes", dataset_path=dataset_path, indices=indices)
        else:
            logger.error(f"Unsupported component: {component} in path: {path}")
            return np.array([])
    
    def get_statistics(self, dataset_path: str, row_indices: Optional[List[int]] = None,
                     col_indices: Optional[List[int]] = None, data_path: Optional[str] = None) -> Dict[str, Any]:
        """
        Get basic statistics for a dataset.
        
        Args:
            dataset_path: Path to the dataset
            row_indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select
            data_path: Optional path to the data to analyze (e.g., "varm/kompot_de_mean_lfc_Young_to_Old_groups/B cells")
                      If not provided, uses X matrix.
            
        Returns:
            Dict of statistics
        """
        try:
            # Get the data
            if data_path:
                data = self.get_data_by_path(data_path, dataset_path=dataset_path, 
                                          indices=row_indices, col_indices=col_indices)
            else:
                data = self.get_X(dataset_path=dataset_path, row_indices=row_indices, col_indices=col_indices)
            
            if data.size == 0:
                return {
                    "min": 0,
                    "max": 0,
                    "mean": 0,
                    "median": 0,
                    "std": 0,
                    "sum": 0,
                    "count": 0,
                    "nonzero_count": 0,
                    "nonzero_fraction": 0
                }
            
            # Calculate statistics
            stats = {
                "min": float(np.min(data)),
                "max": float(np.max(data)),
                "mean": float(np.mean(data)),
                "median": float(np.median(data)),
                "std": float(np.std(data)),
                "sum": float(np.sum(data)),
                "count": int(data.size),
                "nonzero_count": int(np.count_nonzero(data)),
                "nonzero_fraction": float(np.count_nonzero(data) / data.size)
            }
            
            return stats
        except Exception as e:
            logger.error(f"Error calculating statistics: {e}")
            return {
                "error": str(e)
            }
    
    def get_anndata_structure(self, root: zarr.Group, metadata: Dict[str, Any]) -> Dict[str, Any]:
        """
        Create an AnnData-like structure from a zarr root.
        
        Args:
            root: Zarr root group
            metadata: Metadata dict from _extract_metadata
            
        Returns:
            Dict with AnnData-like structure
        """
        # Create structure
        result = {
            "n_obs": metadata.get("shape", (0, 0))[0],
            "n_vars": metadata.get("shape", (0, 0))[1],
            "var_names": [],
            "obs_names": [],
            "layers": [],
            "obsm": [],
            "varm": [],
            "obsp": [],
            "varp": [],
            "uns": [],
            "obs_columns_info": {},
            "var_columns_info": {},
            "obsm_info": {},
            "varm_info": {},
            "layers_info": {}
        }
        
        # Add variable names
        if metadata.get("has_var", False):
            # Check for _index attribute in var group to determine the column name
            var_index_column = '_index'
            if hasattr(root['var'], 'attrs') and '_index' in root['var'].attrs:
                var_index_column = root['var'].attrs['_index']
                logger.debug(f"Using custom index column '{var_index_column}' for var group from _index attribute")
            
            if var_index_column in root['var']:
                try:
                    var_names = root['var'][var_index_column][:10]  # Get first 10 for preview
                    result["var_names"] = var_names.tolist() if hasattr(var_names, 'tolist') else list(var_names)
                except Exception as e:
                    logger.error(f"Error getting var names: {e}")
        
        # Add observation names
        if metadata.get("has_obs", False):
            # Check for _index attribute in obs group to determine the column name
            obs_index_column = '_index'
            if hasattr(root['obs'], 'attrs') and '_index' in root['obs'].attrs:
                obs_index_column = root['obs'].attrs['_index']
                logger.debug(f"Using custom index column '{obs_index_column}' for obs group from _index attribute")
            
            if obs_index_column in root['obs']:
                try:
                    obs_names = root['obs'][obs_index_column][:10]  # Get first 10 for preview
                    result["obs_names"] = obs_names.tolist() if hasattr(obs_names, 'tolist') else list(obs_names)
                except Exception as e:
                    logger.error(f"Error getting obs names: {e}")
        
        # Add obs and var columns
        if metadata.get("has_obs", False):
            result["obs_columns"] = list(root['obs'].keys()) if hasattr(root['obs'], 'keys') else []
        
        if metadata.get("has_var", False):
            result["var_columns"] = list(root['var'].keys()) if hasattr(root['var'], 'keys') else []
        
        # Add layers
        if metadata.get("has_layers", False):
            result["layers"] = list(root['layers'].keys()) if hasattr(root['layers'], 'keys') else []
        
        # Add embeddings (obsm)
        if metadata.get("has_obsm", False):
            result["obsm"] = list(root['obsm'].keys()) if hasattr(root['obsm'], 'keys') else []
            
            # Add dataframe information for obsm
            if "obsm_dataframes" in metadata:
                result["obsm_dataframes"] = {}
                for key, df_info in metadata["obsm_dataframes"].items():
                    info_dict = {
                        "columns": df_info.get("columns", []),
                    }
                    
                    # Add array specific information if this is an array
                    if df_info.get("is_array", False):
                        info_dict["is_array"] = True
                        info_dict["array_shape"] = df_info.get("array_shape", ())
                        info_dict["array_dtype"] = df_info.get("array_dtype", "")
                    else:
                        # Add dataframe specific information
                        info_dict["encoding_type"] = df_info.get("encoding_type", "")
                        info_dict["encoding_version"] = df_info.get("encoding_version", "")
                    
                    result["obsm_dataframes"][key] = info_dict
        
        # Add varm
        if metadata.get("has_varm", False):
            result["varm"] = list(root['varm'].keys()) if hasattr(root['varm'], 'keys') else []
            
            # Add dataframe information for varm
            if "varm_dataframes" in metadata:
                result["varm_dataframes"] = {}
                for key, df_info in metadata["varm_dataframes"].items():
                    info_dict = {
                        "columns": df_info.get("columns", []),
                    }
                    
                    # Add array specific information if this is an array
                    if df_info.get("is_array", False):
                        info_dict["is_array"] = True
                        info_dict["array_shape"] = df_info.get("array_shape", ())
                        info_dict["array_dtype"] = df_info.get("array_dtype", "")
                    else:
                        # Add dataframe specific information
                        info_dict["encoding_type"] = df_info.get("encoding_type", "")
                        info_dict["encoding_version"] = df_info.get("encoding_version", "")
                    
                    result["varm_dataframes"][key] = info_dict
        
        # Add obsp
        if metadata.get("has_obsp", False):
            result["obsp"] = list(root['obsp'].keys()) if hasattr(root['obsp'], 'keys') else []
        
        # Add varp
        if metadata.get("has_varp", False):
            result["varp"] = list(root['varp'].keys()) if hasattr(root['varp'], 'keys') else []
        
        # Add uns
        if metadata.get("has_uns", False):
            result["uns"] = list(root['uns'].keys()) if hasattr(root['uns'], 'keys') else []
            
            # Add uns structure with encoding types directly from root
            uns_structure = {}
            for key in result["uns"]:
                try:
                    # Check if it has encoding-type attribute
                    if hasattr(root['uns'][key], 'attrs') and 'encoding-type' in root['uns'][key].attrs:
                        encoding_type = root['uns'][key].attrs['encoding-type']
                    else:
                        # Infer the type
                        if hasattr(root['uns'][key], 'shape'):
                            # It's a dataset/array
                            dtype = str(root['uns'][key].dtype)
                            shape = root['uns'][key].shape
                            encoding_type = f"array({dtype})"
                        elif hasattr(root['uns'][key], 'keys'):
                            # It's a group/dictionary
                            encoding_type = "dict"
                        else:
                            # Unknown
                            encoding_type = "unknown"
                    
                    uns_structure[key] = {"encoding-type": encoding_type}
                    
                    # Add shape information if available
                    if hasattr(root['uns'][key], 'shape'):
                        uns_structure[key]["shape"] = root['uns'][key].shape
                    
                except Exception as e:
                    logger.error(f"Error getting encoding type for uns/{key}: {e}")
                    uns_structure[key] = {"encoding-type": "error", "error": str(e)}
            
            if uns_structure:
                result["uns_structure"] = uns_structure
        
        # Add column type information
        if "obs_columns_info" in metadata:
            result["obs_columns_info"] = metadata["obs_columns_info"]
        
        if "var_columns_info" in metadata:
            result["var_columns_info"] = metadata["var_columns_info"]
        
        if "obsm_info" in metadata:
            result["obsm_info"] = metadata["obsm_info"]
        
        if "varm_info" in metadata:
            result["varm_info"] = metadata["varm_info"]
        
        if "layers_info" in metadata:
            result["layers_info"] = metadata["layers_info"]
        
        return result
    
    def validate_zarr_url(self, url: str) -> Tuple[bool, str]:
        """
        Validate if a URL points to a valid zarr archive.
        
        Args:
            url: URL to validate
            
        Returns:
            Tuple of (is_valid, message)
        """
        try:
            # Try to open the zarr store
            if FSSPEC_AVAILABLE:
                store = fsspec.filesystem('http').get_mapper(url)
            else:
                store = url
            
            root = zarr.open_group(store, mode='r')
            
            # Check if it has basic AnnData structure
            has_x = 'X' in root
            has_obs = 'obs' in root
            has_var = 'var' in root
            
            if has_x or (has_obs and has_var):
                return True, "Valid zarr archive with AnnData structure"
            else:
                return False, "Zarr archive found but missing AnnData structure"
        except Exception as e:
            return False, f"Error validating zarr URL: {str(e)}"

# Create a singleton instance
zarr_reader = ZarrReader()
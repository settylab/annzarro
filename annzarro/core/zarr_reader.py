"""
Zarr Reader - Handles loading AnnData in zarr format

This module provides functionality for loading zarr data from various sources:
- Local files (directory or archive)
- URL
- S3 bucket
"""

import os
import logging
import numpy as np
from typing import Dict, List, Tuple, Optional, Union, Any
import zarr
from collections import defaultdict

# Set up logging
logger = logging.getLogger(__name__)

class ZarrReader:
    """
    Class for reading AnnData objects from zarr sources with lazy loading.
    
    This class provides methods to:
    1. Load zarr from different sources (local, URL, S3)
    2. Read metadata without loading full data
    3. Selectively load parts of the data
    4. Convert zarr to AnnData-like structure
    """
    
    def __init__(self):
        """Initialize the ZarrReader."""
        self.store = None
        self.root = None
        self.anndata_structure = None
        self.loaded = False
        self.metadata = {}
    
    def load_zarr(self, path: str, mode: str = 'r') -> None:
        """
        Load a zarr store from a local path.
        
        Args:
            path: Path to the zarr directory or file
            mode: Access mode (default: read-only)
        """
        try:
            logger.info(f"Loading zarr from path: {path}")
            self.store = zarr.open_group(path, mode=mode)
            self.root = self.store
            self.loaded = True
            self.metadata = self._extract_metadata()
            logger.info(f"Zarr loaded successfully from {path}")
            return True
        except Exception as e:
            logger.error(f"Error loading zarr from {path}: {e}")
            self.loaded = False
            raise
            
    def load_zarr_from_url(self, url: str) -> None:
        """
        Load a zarr store from a URL.
        
        Args:
            url: URL to the zarr directory
        """
        try:
            logger.info(f"Loading zarr from URL: {url}")
            # Check if URL is a local path
            if url.startswith('data/') or url.startswith('/data/'):
                # For local paths, use direct file access
                logger.info(f"Treating URL as local path: {url}")
                return self.load_zarr(url)
                
            # For remote HTTP(S) URLs, use zarr's built-in HTTP support
            import zarr
            
            try:
                # Try importing fsspec which has better HTTP support
                import fsspec
                store = fsspec.filesystem('http').get_mapper(url)
            except (ImportError, Exception) as e:
                logger.warning(f"Falling back to basic URL handling: {e}")
                # Basic fallback - use a regular file store with path
                store = url
            
            # Open the zarr group
            self.store = zarr.open_group(store, mode='r')
            self.root = self.store
            self.loaded = True
            self.metadata = self._extract_metadata()
            logger.info(f"Zarr loaded successfully from URL: {url}")
            return True
        except Exception as e:
            logger.error(f"Error loading zarr from URL {url}: {e}")
            self.loaded = False
            raise
            
    def load_zarr_from_s3(self, bucket: str, key: str, region: str = 'us-east-1', 
                          anonymous: bool = True, **kwargs) -> None:
        """
        Load a zarr store from an S3 bucket.
        
        Args:
            bucket: S3 bucket name
            key: Path within the bucket to the zarr directory
            region: AWS region (default: us-east-1)
            anonymous: Whether to use anonymous access (default: True)
            **kwargs: Additional parameters for boto3 client
        """
        try:
            logger.info(f"Loading zarr from S3: {bucket}/{key}")
            
            # Try importing s3fs
            try:
                import s3fs
            except ImportError:
                logger.error("s3fs package not found. Install with 'pip install s3fs'.")
                raise ImportError("s3fs package required for S3 access")
                
            # Configure S3 filesystem
            s3_kwargs = {
                'anon': anonymous,
                'client_kwargs': {
                    'region_name': region
                }
            }
            
            # Add credentials if provided
            if not anonymous:
                if 'aws_access_key_id' in kwargs and 'aws_secret_access_key' in kwargs:
                    s3_kwargs['key'] = kwargs.get('aws_access_key_id')
                    s3_kwargs['secret'] = kwargs.get('aws_secret_access_key')
                else:
                    # Use default credentials
                    pass
                    
            # Create filesystem and map to zarr store
            fs = s3fs.S3FileSystem(**s3_kwargs)
            store = zarr.storage.FSStore(f'{bucket}/{key}', fs=fs)
            
            # Open the zarr group
            self.store = zarr.open_group(store, mode='r')
            self.root = self.store
            self.loaded = True
            self.metadata = self._extract_metadata()
            logger.info(f"Zarr loaded successfully from S3: {bucket}/{key}")
            return True
        except Exception as e:
            logger.error(f"Error loading zarr from S3 {bucket}/{key}: {e}")
            self.loaded = False
            raise
            
    def is_initialized(self) -> bool:
        """Check if a zarr store is loaded."""
        return self.loaded and self.store is not None
            
    def open_zarr(self, path: str, mode: str = 'r') -> None:
        """
        Open a zarr store from a local path.
        
        Args:
            path: Path to the zarr directory or file
            mode: Access mode (default: read-only)
        """
        try:
            self.store = zarr.open_group(path, mode=mode)
            self.root = self.store
            self.loaded = True
            self.metadata = self._extract_metadata()
            return True
        except Exception as e:
            logger.error(f"Error opening zarr at {path}: {e}")
            self.store = None
            
    def _extract_metadata(self) -> Dict[str, Any]:
        """
        Extract metadata from the zarr store.
        
        Returns:
            Dictionary of metadata
        """
        if not self.is_initialized():
            return {}
            
        metadata = {}
        
        try:
            # Get basic structure information
            metadata['components'] = list(self.root.keys())
            
            # Get shape information
            shape = None
            if 'X' in self.root:
                try:
                    shape = self.root['X'].shape
                    metadata['shape'] = shape
                except Exception as e:
                    logger.warning(f"Could not get shape from X: {e}")
                    # Try alternative methods to determine shape
                    try:
                        # Try getting shape from .zattrs
                        if hasattr(self.root['X'], 'attrs') and 'shape' in self.root['X'].attrs:
                            shape = tuple(self.root['X'].attrs['shape'])
                            metadata['shape'] = shape
                            logger.info(f"Got shape from X.attrs: {shape}")
                    except Exception as e_attr:
                        logger.warning(f"Could not get shape from X.attrs: {e_attr}")
                        
                    # If shape is still None, try to infer from obs and var
                    if shape is None:
                        try:
                            n_obs = len(self.root['obs']['_index']) if 'obs' in self.root and '_index' in self.root['obs'] else 0
                            n_vars = len(self.root['var']['_index']) if 'var' in self.root and '_index' in self.root['var'] else 0
                            if n_obs > 0 and n_vars > 0:
                                shape = (n_obs, n_vars)
                                metadata['shape'] = shape
                                logger.info(f"Inferred shape from obs and var: {shape}")
                        except Exception as e_infer:
                            logger.warning(f"Could not infer shape from obs and var: {e_infer}")
                
            # Check for X matrix
            if 'X' in self.root:
                metadata['X'] = {
                    'shape': self.root['X'].shape if hasattr(self.root['X'], 'shape') else None,
                    'chunks': self.root['X'].chunks if hasattr(self.root['X'], 'chunks') else None,
                    'dtype': str(self.root['X'].dtype) if hasattr(self.root['X'], 'dtype') else None
                }
                
            # Check for obs dataframe
            if 'obs' in self.root:
                metadata['obs'] = {
                    'columns': list(self.root['obs'].keys()) if hasattr(self.root['obs'], 'keys') else []
                }
                metadata['has_obs'] = True
                metadata['obs_columns'] = list(self.root['obs'].keys()) if hasattr(self.root['obs'], 'keys') else []
                
            # Check for var dataframe
            if 'var' in self.root:
                metadata['var'] = {
                    'columns': list(self.root['var'].keys()) if hasattr(self.root['var'], 'keys') else []
                }
                metadata['has_var'] = True
                metadata['var_columns'] = list(self.root['var'].keys()) if hasattr(self.root['var'], 'keys') else []
                
            # Check for obsm
            if 'obsm' in self.root:
                obsm_keys = list(self.root['obsm'].keys()) if hasattr(self.root['obsm'], 'keys') else []
                metadata['obsm'] = {
                    'keys': obsm_keys
                }
                metadata['has_obsm'] = True
                
                # Check for embeddings (keys starting with X_)
                metadata['embeddings'] = [key for key in obsm_keys if key.startswith('X_')]
                
            # Check for varm
            if 'varm' in self.root:
                metadata['varm'] = {
                    'keys': list(self.root['varm'].keys()) if hasattr(self.root['varm'], 'keys') else []
                }
                metadata['has_varm'] = True
                
            # Check for obsp (observation-observation matrices)
            if 'obsp' in self.root:
                metadata['obsp'] = {
                    'keys': list(self.root['obsp'].keys()) if hasattr(self.root['obsp'], 'keys') else []
                }
                metadata['has_obsp'] = True
                
            # Check for varp (variable-variable matrices)
            if 'varp' in self.root:
                metadata['varp'] = {
                    'keys': list(self.root['varp'].keys()) if hasattr(self.root['varp'], 'keys') else []
                }
                metadata['has_varp'] = True
                
            # Check for layers
            if 'layers' in self.root:
                layer_keys = list(self.root['layers'].keys()) if hasattr(self.root['layers'], 'keys') else []
                metadata['layers'] = {
                    'keys': layer_keys
                }
                metadata['has_layers'] = True
                
            # Check for uns
            if 'uns' in self.root:
                metadata['uns'] = {
                    'keys': list(self.root['uns'].keys()) if hasattr(self.root['uns'], 'keys') else []
                }
                metadata['has_uns'] = True
                
            return metadata
        except Exception as e:
            logger.error(f"Error extracting metadata: {e}")
            return {}
            
    def get_array(self, path: str, selection: Optional[List] = None) -> np.ndarray:
        """
        Get array data from a specific path.
        
        Args:
            path: Path to the array within the zarr hierarchy
            selection: Selection indices (start, stop) or None for all data
            
        Returns:
            NumPy array with the requested data
        """
        if not self.is_initialized():
            raise ValueError("No zarr dataset loaded")
            
        try:
            # Get the array from the zarr hierarchy (handle paths with slashes)
            array = None
            path_parts = path.split('/')
            
            # Navigate the zarr hierarchy
            current = self.root
            for part in path_parts:
                if not part:
                    continue
                if part in current:
                    current = current[part]
                else:
                    raise ValueError(f"Path component '{part}' not found in zarr hierarchy")
            
            # Current should now be the zarr array we want
            array = current
            
            # Apply selection if provided
            if selection is not None:
                return array[tuple(slice(*sel) if sel else slice(None) for sel in selection)]
            else:
                return array[:]
        except Exception as e:
            logger.error(f"Error getting array data from {path}: {e}")
            raise
            
    def load_chunked_data(self, path: str, selection: Optional[List] = None) -> np.ndarray:
        """
        Load data using an optimized chunking strategy.
        
        Args:
            path: Path to the array within the zarr hierarchy
            selection: Selection indices [[rowStart, rowStop], [colStart, colStop]] or None for all
            
        Returns:
            NumPy array with the requested data
        """
        if not self.is_initialized():
            raise ValueError("No zarr dataset loaded")
            
        try:
            # Get the array object
            array = None
            path_parts = path.split('/')
            
            # Navigate the zarr hierarchy
            current = self.root
            for part in path_parts:
                if not part:
                    continue
                if part in current:
                    current = current[part]
                else:
                    raise ValueError(f"Path component '{part}' not found in zarr hierarchy")
            
            # Current should now be the zarr array we want
            array = current
            
            # If no selection, return the whole array
            if selection is None:
                return array[:]
                
            # Get chunk information
            chunks = array.chunks
            
            # If the array doesn't have chunks, just use normal selection
            if chunks is None:
                return array[tuple(slice(*sel) if sel else slice(None) for sel in selection)]
                
            # Parse selection
            row_sel = selection[0] if len(selection) > 0 else None
            col_sel = selection[1] if len(selection) > 1 else None
            
            row_start = row_sel[0] if row_sel else 0
            row_stop = row_sel[1] if row_sel else array.shape[0]
            col_start = col_sel[0] if col_sel else 0
            col_stop = col_sel[1] if col_sel else array.shape[1] if len(array.shape) > 1 else None
            
            # For 1D arrays, just return the data
            if len(array.shape) == 1 or col_stop is None:
                return array[row_start:row_stop]
                
            # For 2D arrays, optimize the chunking
            # Calculate chunk indices
            row_chunk_start = row_start // chunks[0]
            row_chunk_stop = (row_stop + chunks[0] - 1) // chunks[0]
            col_chunk_start = col_start // chunks[1]
            col_chunk_stop = (col_stop + chunks[1] - 1) // chunks[1]
            
            # Allocate result array
            result_shape = (row_stop - row_start, col_stop - col_start)
            result = np.zeros(result_shape, dtype=array.dtype)
            
            # Read data in chunks
            for row_chunk in range(row_chunk_start, row_chunk_stop):
                for col_chunk in range(col_chunk_start, col_chunk_stop):
                    # Calculate chunk boundaries in array coordinates
                    chunk_row_start = row_chunk * chunks[0]
                    chunk_row_stop = min((row_chunk + 1) * chunks[0], array.shape[0])
                    chunk_col_start = col_chunk * chunks[1]
                    chunk_col_stop = min((col_chunk + 1) * chunks[1], array.shape[1])
                    
                    # Intersect with selection
                    intersect_row_start = max(chunk_row_start, row_start)
                    intersect_row_stop = min(chunk_row_stop, row_stop)
                    intersect_col_start = max(chunk_col_start, col_start)
                    intersect_col_stop = min(chunk_col_stop, col_stop)
                    
                    # Skip if no intersection
                    if intersect_row_start >= intersect_row_stop or intersect_col_start >= intersect_col_stop:
                        continue
                    
                    # Read chunk
                    chunk_data = array[
                        intersect_row_start:intersect_row_stop,
                        intersect_col_start:intersect_col_stop
                    ]
                    
                    # Calculate destination indices in result array
                    dest_row_start = intersect_row_start - row_start
                    dest_row_stop = intersect_row_stop - row_start
                    dest_col_start = intersect_col_start - col_start
                    dest_col_stop = intersect_col_stop - col_start
                    
                    # Copy data to result array
                    result[
                        dest_row_start:dest_row_stop,
                        dest_col_start:dest_col_stop
                    ] = chunk_data
            
            return result
        except Exception as e:
            logger.error(f"Error loading chunked data from {path}: {e}")
            raise
            
    def get_array_info(self, path: str) -> Dict[str, Any]:
        """
        Get information about an array.
        
        Args:
            path: Path to the array within the zarr hierarchy
            
        Returns:
            Dictionary with array information
        """
        if not self.is_initialized():
            raise ValueError("No zarr dataset loaded")
            
        try:
            # Get the array from the zarr hierarchy (handle paths with slashes)
            array = None
            path_parts = path.split('/')
            
            # Navigate the zarr hierarchy
            current = self.root
            for part in path_parts:
                if not part:
                    continue
                if part in current:
                    current = current[part]
                else:
                    raise ValueError(f"Path component '{part}' not found in zarr hierarchy")
            
            # Current should now be the zarr array we want
            array = current
            
            # Get array information
            info = {
                'shape': array.shape if hasattr(array, 'shape') else None,
                'chunks': array.chunks if hasattr(array, 'chunks') else None,
                'dtype': str(array.dtype) if hasattr(array, 'dtype') else None,
                'compressor': array.compressor.get_config() if hasattr(array, 'compressor') and array.compressor else None,
                'dimension_separator': array.dimension_separator if hasattr(array, 'dimension_separator') else None,
                'fill_value': array.fill_value if hasattr(array, 'fill_value') else None
            }
            
            return info
        except Exception as e:
            logger.error(f"Error getting array info from {path}: {e}")
            raise
    
    def open_zarr_url(self, url: str) -> bool:
        """
        Open a zarr store from a URL.
        
        Args:
            url: URL to the zarr store
        
        Returns:
            bool: Success status
        """
        try:
            # In newer versions of zarr, URLs can be opened directly
            self.store = zarr.open_group(url, mode='r')
            self.root = self.store
            self.loaded = True
            self._initialize_metadata()
            return True
        except Exception as e:
            logger.error(f"Error opening zarr from URL {url}: {e}")
            self.store = None
            self.loaded = False
            return False
    
    def open_zarr_s3(self, bucket: str, key: str, 
                    region: str = 'us-east-1',
                    anonymous: bool = False,
                    access_key: Optional[str] = None,
                    secret_key: Optional[str] = None) -> bool:
        """
        Open a zarr store from an S3 bucket.
        
        Args:
            bucket: S3 bucket name
            key: Path within the bucket
            region: AWS region
            anonymous: Whether to use anonymous access
            access_key: AWS access key ID (required if not anonymous)
            secret_key: AWS secret access key (required if not anonymous)
        
        Returns:
            bool: Success status
        """
        try:
            import s3fs
            
            # Create S3 filesystem
            if anonymous:
                s3 = s3fs.S3FileSystem(anon=True, client_kwargs={'region_name': region})
            else:
                if not access_key or not secret_key:
                    raise ValueError("Access key and secret key are required for non-anonymous access")
                
                s3 = s3fs.S3FileSystem(
                    key=access_key,
                    secret=secret_key,
                    client_kwargs={'region_name': region}
                )
            
            # Create store
            store = s3fs.S3Map(root=f'{bucket}/{key}', s3=s3)
            self.store = zarr.open_group(store, mode='r')
            self.root = self.store
            self.loaded = True
            self._initialize_metadata()
            return True
        except Exception as e:
            logger.error(f"Error opening zarr from S3 {bucket}/{key}: {e}")
            self.store = None
            self.loaded = False
            return False
    
    def _initialize_metadata(self) -> None:
        """Extract basic metadata about the AnnData object."""
        if not self.loaded:
            return
        
        try:
            # Basic shape information
            self.metadata['shape'] = self._get_shape('X')
            
            # Component availability
            components = ['obs', 'var', 'obsm', 'varm', 'layers', 'uns', 'obsp', 'varp']
            for component in components:
                self.metadata[f'has_{component}'] = component in self.root
            
            # Get available layers if present
            if self.metadata.get('has_layers', False):
                self.metadata['layers'] = list(self.root['layers'].keys())
            else:
                self.metadata['layers'] = []
            
            # Get embeddings if present (obsm keys starting with 'X_')
            if self.metadata.get('has_obsm', False):
                self.metadata['embeddings'] = [
                    key for key in self.root['obsm'].keys() 
                    if key.startswith('X_')
                ]
            else:
                self.metadata['embeddings'] = []
                
            # Get obs columns
            if self.metadata.get('has_obs', False):
                self.metadata['obs_columns'] = [
                    key for key in self.root['obs'].keys()
                    if key != '_index'
                ]
            else:
                self.metadata['obs_columns'] = []
                
            # Get var columns
            if self.metadata.get('has_var', False):
                self.metadata['var_columns'] = [
                    key for key in self.root['var'].keys()
                    if key != '_index'
                ]
            else:
                self.metadata['var_columns'] = []

            # Check for kompot data
            if self.metadata.get('has_uns', False):
                self.metadata['has_kompot_de'] = 'kompot_de' in self.root['uns']
                self.metadata['has_kompot_da'] = 'kompot_da' in self.root['uns']
            else:
                self.metadata['has_kompot_de'] = False
                self.metadata['has_kompot_da'] = False
                
        except Exception as e:
            logger.error(f"Error initializing metadata: {e}")
            # Set default values for essential metadata
            self.metadata = {
                'shape': (0, 0),
                'has_X': False,
                'has_obs': False,
                'has_var': False,
                'layers': [],
                'embeddings': [],
                'obs_columns': [],
                'var_columns': []
            }
    
    def _get_shape(self, path: str) -> Tuple[int, int]:
        """
        Get the shape of a dataset.
        
        Args:
            path: Path to the dataset
            
        Returns:
            tuple: Shape of the dataset
        """
        try:
            # First try getting shape directly
            if path in self.root:
                try:
                    if hasattr(self.root[path], 'shape'):
                        return self.root[path].shape
                    elif 'shape' in self.root[path]:
                        return tuple(self.root[path]['shape'][()])
                except Exception as e:
                    logger.warning(f"Could not get shape directly for {path}: {e}")
                    
                # Try getting shape from attributes
                try:
                    if hasattr(self.root[path], 'attrs') and 'shape' in self.root[path].attrs:
                        return tuple(self.root[path].attrs['shape'])
                except Exception as e:
                    logger.warning(f"Could not get shape from attrs for {path}: {e}")
                    
                # For X matrix, try to infer shape from obs and var
                if path == 'X':
                    try:
                        n_obs = len(self.root['obs']['_index']) if 'obs' in self.root and '_index' in self.root['obs'] else 0
                        n_vars = len(self.root['var']['_index']) if 'var' in self.root and '_index' in self.root['var'] else 0
                        if n_obs > 0 and n_vars > 0:
                            logger.info(f"Inferred shape ({n_obs}, {n_vars}) for {path}")
                            return (n_obs, n_vars)
                    except Exception as e:
                        logger.warning(f"Could not infer shape from obs and var for {path}: {e}")
                
            # Look in the metadata if we already have it
            if hasattr(self, 'metadata') and 'shape' in self.metadata:
                return self.metadata['shape']
                
            # If we still don't have a shape, check if we can read the size of obs and var
            try:
                if 'obs' in self.root and 'var' in self.root:
                    n_obs = len(list(self.root['obs'].keys())) - 1  # Subtract 1 for '_index'
                    n_vars = len(list(self.root['var'].keys())) - 1  # Subtract 1 for '_index'
                    if n_obs > 0 and n_vars > 0:
                        logger.info(f"Estimated shape ({n_obs}, {n_vars}) for {path}")
                        return (n_obs, n_vars)
            except Exception as e:
                logger.warning(f"Could not estimate shape for {path}: {e}")
                
            # Return empty shape as last resort
            return (0, 0)
        except Exception as e:
            logger.error(f"Error getting shape for {path}: {e}")
            return (0, 0)
    
    def get_metadata(self) -> Dict[str, Any]:
        """
        Get metadata about the loaded AnnData object.
        
        Returns:
            dict: Metadata dictionary
        """
        return self.metadata
    
    def get_obs_names(self) -> List[str]:
        """
        Get the observation (cell) names.
        
        Returns:
            list: List of observation names
        """
        if not self.loaded or not self.metadata.get('has_obs', False):
            return []
        
        try:
            if '_index' in self.root['obs']:
                index = self.root['obs']['_index'][:]
                return [str(x) for x in index]
            else:
                # If no explicit index, use numbered indices
                shape = self.metadata.get('shape', (0, 0))
                return [f"Cell_{i}" for i in range(shape[0])]
        except Exception as e:
            logger.error(f"Error getting obs names: {e}")
            return []
    
    def get_var_names(self, column: Optional[str] = None) -> List[str]:
        """
        Get the variable (gene) names.
        
        Args:
            column: Optional name of the column containing gene names.
                   If provided, this column will be used instead of '_index'.
                   If the column doesn't exist, falls back to '_index'.
        
        Returns:
            list: List of variable names
        """
        if not self.loaded or not self.metadata.get('has_var', False):
            return []
            
        try:
            # If a specific column is requested and exists, use it
            if column and column in self.root['var']:
                logger.info(f"Using custom gene name column: {column}")
                gene_names = self.root['var'][column][:]
                return [str(x) for x in gene_names]
            # Otherwise use the default _index
            elif '_index' in self.root['var']:
                index = self.root['var']['_index'][:]
                return [str(x) for x in index]
            else:
                # If no explicit index, use numbered indices
                shape = self.metadata.get('shape', (0, 0))
                return [f"Gene_{i}" for i in range(shape[1])]
        except Exception as e:
            logger.error(f"Error getting var names from column {column}: {e}")
            return []
    
    def get_X(self, row_indices: Optional[List[int]] = None, 
             col_indices: Optional[List[int]] = None) -> np.ndarray:
        """
        Get the X matrix or a subset of it.
        
        Args:
            row_indices: List of row indices to select
            col_indices: List of column indices to select
            
        Returns:
            numpy.ndarray: The requested data
        """
        if not self.loaded or 'X' not in self.root:
            return np.array([])
        
        try:
            # If row or column indices represent a large selection, use optimized chunking
            if (row_indices is not None and len(row_indices) > 1000) or \
               (col_indices is not None and len(col_indices) > 1000):
                return self._load_chunked_data('X', row_indices, col_indices)
            
            # Handle selection
            if row_indices is not None and col_indices is not None:
                # Both row and column indices provided
                return self.root['X'][row_indices, :][:, col_indices]
            elif row_indices is not None:
                # Only row indices provided
                return self.root['X'][row_indices, :]
            elif col_indices is not None:
                # Only column indices provided
                return self.root['X'][:, col_indices]
            else:
                # No selection, return everything
                shape = self.root['X'].shape
                # For very large matrices, return a sampled subset with warning
                if shape[0] * shape[1] > 1e8:  # More than 100M elements
                    logger.warning(f"X matrix is very large ({shape}). Returning downsampled data.")
                    return self._downsample_array('X')
                return self.root['X'][:]
        except Exception as e:
            logger.error(f"Error getting X data: {e}")
            return np.array([])
    
    def get_layer(self, layer_name: str,
                 row_indices: Optional[List[int]] = None,
                 col_indices: Optional[List[int]] = None) -> np.ndarray:
        """
        Get a layer matrix or a subset of it.
        
        Args:
            layer_name: Name of the layer
            row_indices: List of row indices to select
            col_indices: List of column indices to select
            
        Returns:
            numpy.ndarray: The requested data
        """
        if not self.loaded or 'layers' not in self.root or layer_name not in self.root['layers']:
            return np.array([])
        
        try:
            # Get the layer
            layer = self.root['layers'][layer_name]
            
            # Handle selection
            if row_indices is not None and col_indices is not None:
                # Both row and column indices provided
                return layer[row_indices, :][:, col_indices]
            elif row_indices is not None:
                # Only row indices provided
                return layer[row_indices, :]
            elif col_indices is not None:
                # Only column indices provided
                return layer[:, col_indices]
            else:
                # No selection, return everything
                return layer[:]
        except Exception as e:
            logger.error(f"Error getting layer {layer_name} data: {e}")
            return np.array([])
    
    def get_obs(self, column_name: Optional[str] = None,
               indices: Optional[List[int]] = None) -> Union[Dict[str, np.ndarray], np.ndarray]:
        """
        Get observation annotations.
        
        Args:
            column_name: Name of the column to retrieve, or None for all columns
            indices: List of indices to select, or None for all
            
        Returns:
            dict or numpy.ndarray: The requested data
        """
        if not self.loaded or 'obs' not in self.root:
            return {} if column_name is None else np.array([])
        
        try:
            if column_name is not None:
                # Get a specific column
                if column_name not in self.root['obs']:
                    return np.array([])
                
                if indices is not None:
                    return self.root['obs'][column_name][indices]
                else:
                    return self.root['obs'][column_name][:]
            else:
                # Get all columns
                result = {}
                
                # Get index if available
                if '_index' in self.root['obs']:
                    if indices is not None:
                        result['_index'] = self.root['obs']['_index'][indices]
                    else:
                        result['_index'] = self.root['obs']['_index'][:]
                
                # Get all columns
                for column in self.metadata.get('obs_columns', []):
                    if indices is not None:
                        result[column] = self.root['obs'][column][indices]
                    else:
                        result[column] = self.root['obs'][column][:]
                
                return result
        except Exception as e:
            logger.error(f"Error getting obs data for column {column_name}: {e}")
            return {} if column_name is None else np.array([])
    
    def get_var(self, column_name: Optional[str] = None,
               indices: Optional[List[int]] = None) -> Union[Dict[str, np.ndarray], np.ndarray]:
        """
        Get variable annotations.
        
        Args:
            column_name: Name of the column to retrieve, or None for all columns
            indices: List of indices to select, or None for all
            
        Returns:
            dict or numpy.ndarray: The requested data
        """
        if not self.loaded or 'var' not in self.root:
            return {} if column_name is None else np.array([])
        
        try:
            if column_name is not None:
                # Get a specific column
                if column_name not in self.root['var']:
                    return np.array([])
                
                if indices is not None:
                    return self.root['var'][column_name][indices]
                else:
                    return self.root['var'][column_name][:]
            else:
                # Get all columns
                result = {}
                
                # Get index if available
                if '_index' in self.root['var']:
                    if indices is not None:
                        result['_index'] = self.root['var']['_index'][indices]
                    else:
                        result['_index'] = self.root['var']['_index'][:]
                
                # Get all columns
                for column in self.metadata.get('var_columns', []):
                    if indices is not None:
                        result[column] = self.root['var'][column][indices]
                    else:
                        result[column] = self.root['var'][column][:]
                
                return result
        except Exception as e:
            logger.error(f"Error getting var data for column {column_name}: {e}")
            return {} if column_name is None else np.array([])
    
    def get_obsm(self, obsm_key: str,
                indices: Optional[List[int]] = None) -> np.ndarray:
        """
        Get observation multi-dimensional annotations.
        
        Args:
            obsm_key: Key of the obsm entry to retrieve
            indices: List of indices to select, or None for all
            
        Returns:
            numpy.ndarray: The requested data
        """
        if not self.loaded or 'obsm' not in self.root or obsm_key not in self.root['obsm']:
            return np.array([])
        
        try:
            if indices is not None:
                return self.root['obsm'][obsm_key][indices]
            else:
                return self.root['obsm'][obsm_key][:]
        except Exception as e:
            logger.error(f"Error getting obsm data for key {obsm_key}: {e}")
            return np.array([])
    
    def get_varm(self, varm_key: str,
                indices: Optional[List[int]] = None) -> np.ndarray:
        """
        Get variable multi-dimensional annotations.
        
        Args:
            varm_key: Key of the varm entry to retrieve
            indices: List of indices to select, or None for all
            
        Returns:
            numpy.ndarray: The requested data
        """
        if not self.loaded or 'varm' not in self.root or varm_key not in self.root['varm']:
            return np.array([])
        
        try:
            if indices is not None:
                return self.root['varm'][varm_key][indices]
            else:
                return self.root['varm'][varm_key][:]
        except Exception as e:
            logger.error(f"Error getting varm data for key {varm_key}: {e}")
            return np.array([])
    
    def get_uns(self, uns_key: str) -> Any:
        """
        Get unstructured annotation.
        
        Args:
            uns_key: Key of the uns entry to retrieve
            
        Returns:
            The requested data
        """
        if not self.loaded or 'uns' not in self.root or uns_key not in self.root['uns']:
            return None
        
        try:
            return self.root['uns'][uns_key][:]
        except Exception as e:
            logger.error(f"Error getting uns data for key {uns_key}: {e}")
            return None
    
    def get_obsp(self, obsp_key: str,
                indices: Optional[List[int]] = None) -> np.ndarray:
        """
        Get observation-observation (cell-cell) matrices.
        
        Args:
            obsp_key: Key of the obsp entry to retrieve
            indices: List of indices to select, or None for all
            
        Returns:
            numpy.ndarray: The requested data
        """
        if not self.loaded or 'obsp' not in self.root or obsp_key not in self.root['obsp']:
            return np.array([])
        
        try:
            if indices is not None:
                return self.root['obsp'][obsp_key][indices, :][:, indices]
            else:
                return self.root['obsp'][obsp_key][:]
        except Exception as e:
            logger.error(f"Error getting obsp data for key {obsp_key}: {e}")
            return np.array([])
    
    def get_varp(self, varp_key: str,
                indices: Optional[List[int]] = None) -> np.ndarray:
        """
        Get variable-variable (gene-gene) matrices.
        
        Args:
            varp_key: Key of the varp entry to retrieve
            indices: List of indices to select, or None for all
            
        Returns:
            numpy.ndarray: The requested data
        """
        if not self.loaded or 'varp' not in self.root or varp_key not in self.root['varp']:
            return np.array([])
        
        try:
            if indices is not None:
                return self.root['varp'][varp_key][indices, :][:, indices]
            else:
                return self.root['varp'][varp_key][:]
        except Exception as e:
            logger.error(f"Error getting varp data for key {varp_key}: {e}")
            return np.array([])
            
    def _load_chunked_data(self, path: str, row_indices: Optional[List[int]] = None, 
                          col_indices: Optional[List[int]] = None) -> np.ndarray:
        """
        Load data using an optimized chunking strategy for large datasets.
        
        Args:
            path: Path to the zarr array
            row_indices: List of row indices to select
            col_indices: List of column indices to select
            
        Returns:
            numpy.ndarray: The chunked data
        """
        if not self.loaded:
            return np.array([])
            
        try:
            array = self.root[path]
            chunks = getattr(array, 'chunks', None)
            
            # If chunks info is not available, fall back to regular loading
            if chunks is None:
                logger.warning(f"Chunk information not available for {path}, using standard loading")
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
            logger.error(f"Error loading chunked data for {path}: {e}")
            return np.array([])
            
    def _downsample_array(self, path: str, max_size: int = 1000) -> np.ndarray:
        """
        Downsample a large array to a manageable size.
        
        Args:
            path: Path to the zarr array
            max_size: Maximum number of elements in each dimension
            
        Returns:
            numpy.ndarray: The downsampled data
        """
        if not self.loaded or path not in self.root:
            return np.array([])
            
        try:
            array = self.root[path]
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
            logger.error(f"Error downsampling array {path}: {e}")
            return np.array([])
            
    def load_progressively(self, path: str, chunk_size: int = 1000, 
                          callback: Optional[callable] = None) -> np.ndarray:
        """
        Load data progressively with callback for progress updates.
        
        Args:
            path: Path to the zarr array
            chunk_size: Size of chunks to load at once
            callback: Callback function called with (chunk, progress)
            
        Returns:
            numpy.ndarray: The complete loaded data
        """
        if not self.loaded or path not in self.root:
            return np.array([])
            
        try:
            array = self.root[path]
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
            logger.error(f"Error loading data progressively from {path}: {e}")
            return np.array([])
    
    def get_available_data(self) -> Dict[str, Any]:
        """
        Get a comprehensive dictionary of available data in the AnnData object.
        
        Returns:
            dict: Dictionary of available data
        """
        if not self.loaded:
            return {}
            
        # Start with the metadata
        result = dict(self.metadata)
        
        # Add more detailed information
        if self.metadata.get('has_obs', False):
            result['obs_sample'] = self.get_obs(indices=list(range(min(10, self.metadata['shape'][0]))))
            
        if self.metadata.get('has_var', False):
            result['var_sample'] = self.get_var(indices=list(range(min(10, self.metadata['shape'][1]))))
            
        if self.metadata.get('has_obsm', False) and self.metadata.get('embeddings', []):
            # Get a sample of the first embedding
            embedding_key = self.metadata['embeddings'][0]
            result['obsm_sample'] = {
                embedding_key: self.get_obsm(embedding_key, 
                                            indices=list(range(min(10, self.metadata['shape'][0]))))
            }
            
        # Add varm sample if available
        if self.metadata.get('has_varm', False) and self.metadata.get('varm', {}).get('keys', []):
            varm_keys = self.metadata['varm']['keys']
            if varm_keys:
                # Get a sample of the first varm matrix
                varm_key = varm_keys[0]
                result['varm_sample'] = {
                    varm_key: self.get_varm(varm_key, 
                                           indices=list(range(min(10, self.metadata['shape'][1]))))
                }
                
        # Add obsp sample if available
        if self.metadata.get('has_obsp', False) and self.metadata.get('obsp', {}).get('keys', []):
            obsp_keys = self.metadata['obsp']['keys']
            if obsp_keys:
                # Get a sample of the first obsp matrix
                obsp_key = obsp_keys[0]
                sample_indices = list(range(min(5, self.metadata['shape'][0])))
                result['obsp_sample'] = {
                    obsp_key: self.get_obsp(obsp_key, indices=sample_indices)
                }
                
        # Add varp sample if available
        if self.metadata.get('has_varp', False) and self.metadata.get('varp', {}).get('keys', []):
            varp_keys = self.metadata['varp']['keys']
            if varp_keys:
                # Get a sample of the first varp matrix
                varp_key = varp_keys[0]
                sample_indices = list(range(min(5, self.metadata['shape'][1])))
                result['varp_sample'] = {
                    varp_key: self.get_varp(varp_key, indices=sample_indices)
                }
            
        return result

# Create a singleton instance
zarr_reader = ZarrReader()
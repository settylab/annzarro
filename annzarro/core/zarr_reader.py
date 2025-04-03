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
            self._initialize_metadata()
            return True
        except Exception as e:
            logger.error(f"Error opening zarr at {path}: {e}")
            self.store = None
            self.loaded = False
            return False
    
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
            if path in self.root:
                if hasattr(self.root[path], 'shape'):
                    return self.root[path].shape
                elif 'shape' in self.root[path]:
                    return tuple(self.root[path]['shape'][()])
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
    
    def get_var_names(self) -> List[str]:
        """
        Get the variable (gene) names.
        
        Returns:
            list: List of variable names
        """
        if not self.loaded or not self.metadata.get('has_var', False):
            return []
            
        try:
            if '_index' in self.root['var']:
                index = self.root['var']['_index'][:]
                return [str(x) for x in index]
            else:
                # If no explicit index, use numbered indices
                shape = self.metadata.get('shape', (0, 0))
                return [f"Gene_{i}" for i in range(shape[1])]
        except Exception as e:
            logger.error(f"Error getting var names: {e}")
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
            
        return result

# Create a singleton instance
zarr_reader = ZarrReader()
"""
Data Manager - Manages the Zarr data and provides access to its components

This module is responsible for:
1. Discovering available zarr datasets
2. Loading zarr data via the ZarrReader
3. Providing a high-level API for accessing data components
4. Managing selections and data caching
"""

import os
import glob
import re
import logging
from typing import Dict, List, Tuple, Optional, Union, Any, Set
import numpy as np
from pathlib import Path
import os.path as osp
from datetime import datetime

from ..core.zarr_reader import zarr_reader

logger = logging.getLogger(__name__)

class DataManager:
    """
    Class for managing zarr datasets and providing data access.
    
    This class is responsible for:
    1. Dataset discovery and management
    2. Data selection (cells, genes)
    3. Caching for better performance
    4. Event handling
    """
    
    def __init__(self):
        """Initialize the DataManager."""
        self.current_dataset = None
        self.datasets = {}
        self.selected_cells = set()
        self.selected_genes = set()
        self.focused_cell = None
        self.focused_gene = None
        self.taxonomy_id = 9606  # Default: Homo sapiens
        self.species = "Homo sapiens"
        self.cache = {}
        self.cache_max_size = 50
        self.dataset_path = None
        self.dataset_name = None
        
    def load_from_zarr(self, zarr_reader, dataset_id=None) -> bool:
        """
        Load data from an initialized zarr reader.
        
        Args:
            zarr_reader: A ZarrReader instance
            dataset_id: Optional dataset ID to use
            
        Returns:
            True if successful, False otherwise
        """
        try:
            logger.info(f"Loading data from zarr reader, dataset_id: {dataset_id}")
            
            # For stateless operation, we just need to verify the dataset exists
            # and return the identifier
            if dataset_id is None:
                # This is for backward compatibility - when using the new
                # dataset-id approach, we should always have a dataset_id
                if not zarr_reader.is_initialized():
                    logger.error("ZarrReader is not initialized and no dataset_id provided")
                    return False
                
                # Use active dataset ID from zarr_reader if available
                dataset_id = zarr_reader.get_active_dataset()
                if not dataset_id:
                    # Legacy approach - deprecated
                    if hasattr(zarr_reader, 'store') and hasattr(zarr_reader.store, 'path'):
                        self.dataset_path = zarr_reader.store.path
                        self.dataset_name = osp.basename(self.dataset_path)
                        
                        # Create a simple dataset ID from the path
                        dataset_id = osp.basename(self.dataset_path)
            
            # Initialize client-side dataset tracking
            if dataset_id:
                # Get metadata for the dataset
                metadata = zarr_reader.get_metadata(dataset_id)
                
                # Use path if available
                path = None
                if hasattr(zarr_reader, 'dataset_paths') and dataset_id in zarr_reader.dataset_paths:
                    path = zarr_reader.dataset_paths.get(dataset_id)
                
                # Get shape if available
                shape = metadata.get('shape', (0, 0))
                
                # Store minimal dataset info for future reference
                self.datasets[dataset_id] = {
                    'metadata': metadata,
                    'shape': shape,
                    'path': path,
                    'name': path and osp.basename(path) or dataset_id
                }
                
                # For backward compatibility, also set current_dataset
                self.current_dataset = self.datasets[dataset_id]
                
                logger.info(f"Data registered successfully: {dataset_id}")
                return True
            else:
                logger.error("No dataset ID available")
                return False
            
        except Exception as e:
            logger.error(f"Error loading data from zarr: {e}")
            return False
            
    def get_shape(self) -> Optional[Tuple[int, int]]:
        """
        Get the shape of the current dataset.
        
        Returns:
            Tuple (n_obs, n_vars) or None if not available
        """
        if self.current_dataset and 'shape' in self.current_dataset:
            return self.current_dataset['shape']
        return None
        
    def get_anndata_dict(self) -> Dict[str, Any]:
        """
        Get a dictionary representation of the AnnData structure.
        
        Returns:
            Dictionary with AnnData structure
        """
        if not self.current_dataset:
            return {}
            
        # Create an object with AnnData-like properties
        class AnndataLike:
            def __init__(self, manager):
                self.shape = manager.get_shape() or (0, 0)
                self.X = np.zeros((1, 1))  # Placeholder
                self.obs = {}
                self.var = {}
                self.obsm = {}
                self.layers = {}
                
        # Create the AnnData-like object        
        result = AnndataLike(self)
        
        # Return the object
        return result
        
    def discover_datasets(self, data_dir: Union[str, Path] = "data", recursive: bool = True, follow_symlinks: bool = True) -> List[Dict[str, str]]:
        """
        Discover available zarr datasets in the specified directory.
        
        Args:
            data_dir: Directory to search for datasets
            recursive: Whether to scan directories recursively
            follow_symlinks: Whether to follow symbolic links
            
        Returns:
            List of dataset information dictionaries
        """
        data_dir = Path(data_dir)
        
        if not data_dir.exists() or not data_dir.is_dir():
            return []
            
        # Find all .zarr directories
        zarr_dirs = []
        
        # Build the pattern based on recursion level
        if recursive:
            # Use rglob for fully recursive search
            for zarr_path in data_dir.rglob("*.zarr"):
                # Check if it's a directory (zarr stores are directories)
                if zarr_path.is_dir() and (follow_symlinks or not zarr_path.is_symlink()):
                    zarr_dirs.append(str(zarr_path))
        else:
            # Limited search - only current directory and immediate subdirectories
            zarr_dirs.extend(glob.glob(str(data_dir / "*.zarr"), recursive=False))
            zarr_dirs.extend(glob.glob(str(data_dir / "*" / "*.zarr"), recursive=False))
            
            # Filter symlinks if not following them
            if not follow_symlinks:
                zarr_dirs = [d for d in zarr_dirs if not Path(d).is_symlink()]
        
        # Create dataset info
        dataset_info = []
        for zarr_dir in zarr_dirs:
            path = Path(zarr_dir)
            dataset_info.append({
                "id": path.stem,
                "name": path.stem.replace("_", " ").title(),
                "path": str(path),
                "type": "zarr",
                "is_symlink": path.is_symlink()
            })
            
        # Sort by name
        dataset_info.sort(key=lambda x: x["name"])
        
        # Store for later use
        self.datasets = {ds["id"]: ds for ds in dataset_info}
        
        return dataset_info
        
    def list_datasets(self, directory: Optional[str] = None, recursive: bool = True, follow_symlinks: bool = True) -> List[Dict[str, str]]:
        """
        List available datasets, optionally from a specific directory.
        
        Args:
            directory: Directory to search (if None, use cached list or default 'data' dir)
            recursive: Whether to scan directories recursively
            follow_symlinks: Whether to follow symbolic links
            
        Returns:
            List of dataset information dictionaries
        """
        if directory:
            return self.discover_datasets(directory, recursive=recursive, follow_symlinks=follow_symlinks)
        elif self.datasets:
            return list(self.datasets.values())
        else:
            return self.discover_datasets(recursive=recursive, follow_symlinks=follow_symlinks)
            
    def get_dataset_info(self, dataset_path: str) -> Dict[str, Any]:
        """
        Get information about a dataset.
        
        Args:
            dataset_path: Path to the dataset
            
        Returns:
            Dictionary with dataset information
        """
        # First try to open the dataset
        success = zarr_reader.open_zarr(dataset_path)
        if not success:
            return {"error": "Failed to open dataset"}
        
        # Make sure metadata is initialized
        if hasattr(zarr_reader, '_initialize_metadata'):
            zarr_reader._initialize_metadata()
            
        # Get basic information
        metadata = zarr_reader.get_metadata()
        
        # Add human-readable information
        info = {
            "path": dataset_path,
            "name": Path(dataset_path).stem.replace("_", " ").title(),
            "shape": metadata.get("shape", (0, 0)),
            "n_obs": metadata.get("shape", (0, 0))[0],
            "n_vars": metadata.get("shape", (0, 0))[1],
            "obs_columns": metadata.get("obs_columns", []),
            "var_columns": metadata.get("var_columns", []),
            "layers": metadata.get("layers", []),
            "embeddings": metadata.get("embeddings", []),
            "has_kompot_data": metadata.get("has_kompot_de", False) or metadata.get("has_kompot_da", False)
        }
        
        # Sample obs and var names for verification
        obs_names = zarr_reader.get_obs_names()[:10] if metadata.get("has_obs", False) else []
        var_names = zarr_reader.get_var_names()[:10] if metadata.get("has_var", False) else []
        
        info["obs_names_sample"] = obs_names
        info["var_names_sample"] = var_names
        
        return info
    
    def load_dataset(self, dataset_path: str) -> bool:
        """
        Load a dataset by path.
        
        Args:
            dataset_path: Path to the dataset
            
        Returns:
            Success status
        """
        # Reset current state
        self.selected_cells = set()
        self.selected_genes = set()
        self.focused_cell = None
        self.focused_gene = None
        self.cache = {}
        
        # Open the dataset
        success = zarr_reader.open_zarr(dataset_path)
        if not success:
            return False
        
        # Make sure metadata is properly initialized
        if hasattr(zarr_reader, '_initialize_metadata'):
            zarr_reader._initialize_metadata()
        
        # Get metadata and set current dataset information
        metadata = zarr_reader.get_metadata()
        shape = None
        
        # Get shape if available from metadata or directly from X
        if 'shape' in metadata:
            shape = metadata['shape']
        elif 'X' in zarr_reader.root and hasattr(zarr_reader.root['X'], 'shape'):
            shape = zarr_reader.root['X'].shape
            
        # Set dataset attributes
        self.dataset_path = dataset_path
        self.dataset_name = Path(dataset_path).stem.replace("_", " ").title()
            
        # Create the current dataset object with complete information
        self.current_dataset = {
            "path": dataset_path,
            "name": self.dataset_name,
            "metadata": metadata,
            "shape": shape,
            "reader": zarr_reader
        }
        
        return True
    
    def get_basic_info(self) -> Dict[str, Any]:
        """
        Get basic information about the loaded dataset.
        
        Returns:
            Dictionary with basic information
        """
        if not self.current_dataset:
            return {"error": "No dataset loaded"}
            
        metadata = zarr_reader.get_metadata()
        
        # Get dataset information, including proper shape
        shape = self.current_dataset.get('shape', metadata.get('shape', (0, 0)))
        n_obs = shape[0] if shape and len(shape) > 0 else 0
        n_vars = shape[1] if shape and len(shape) > 1 else 0
        
        return {
            "name": self.current_dataset.get("name", ""),
            "path": self.current_dataset.get("path", ""),
            "shape": shape,
            "n_obs": n_obs,
            "n_vars": n_vars,
            "has_obs": metadata.get("has_obs", False),
            "has_var": metadata.get("has_var", False),
            "has_obsm": metadata.get("has_obsm", False),
            "has_varm": metadata.get("has_varm", False),
            "has_layers": metadata.get("has_layers", False),
            "has_uns": metadata.get("has_uns", False),
            "layers": metadata.get("layers", []),
            "embeddings": metadata.get("embeddings", []),
            "obs_columns": metadata.get("obs_columns", []),
            "var_columns": metadata.get("var_columns", [])
        }
    
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
        if not self.current_dataset:
            return np.array([])
            
        # Generate cache key
        cache_key = f"X_{row_indices}_{col_indices}"
        if cache_key in self.cache:
            return self.cache[cache_key]
            
        # Get the data
        data = zarr_reader.get_X(row_indices, col_indices)
        
        # Cache the result
        self._add_to_cache(cache_key, data)
        
        return data
    
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
        if not self.current_dataset:
            return np.array([])
            
        # Generate cache key
        cache_key = f"layer_{layer_name}_{row_indices}_{col_indices}"
        if cache_key in self.cache:
            return self.cache[cache_key]
            
        # Get the data
        data = zarr_reader.get_layer(layer_name, row_indices, col_indices)
        
        # Cache the result
        self._add_to_cache(cache_key, data)
        
        return data
    
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
        if not self.current_dataset:
            return {} if column_name is None else np.array([])
            
        # Generate cache key
        cache_key = f"obs_{column_name}_{indices}"
        if cache_key in self.cache:
            return self.cache[cache_key]
            
        # Get the data
        data = zarr_reader.get_obs(column_name, indices)
        
        # Cache the result
        self._add_to_cache(cache_key, data)
        
        return data
    
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
        if not self.current_dataset:
            return {} if column_name is None else np.array([])
            
        # Generate cache key
        cache_key = f"var_{column_name}_{indices}"
        if cache_key in self.cache:
            return self.cache[cache_key]
            
        # Get the data
        data = zarr_reader.get_var(column_name, indices)
        
        # Cache the result
        self._add_to_cache(cache_key, data)
        
        return data
    
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
        if not self.current_dataset:
            return np.array([])
            
        # Generate cache key
        cache_key = f"obsm_{obsm_key}_{indices}"
        if cache_key in self.cache:
            return self.cache[cache_key]
            
        # Get the data
        data = zarr_reader.get_obsm(obsm_key, indices)
        
        # Cache the result
        self._add_to_cache(cache_key, data)
        
        return data
    
    def get_obs_names(self) -> List[str]:
        """
        Get the observation (cell) names.
        
        Returns:
            list: List of observation names
        """
        if not self.current_dataset:
            return []
            
        return zarr_reader.get_obs_names()
    
    def get_var_names(self, column=None) -> List[str]:
        """
        Get the variable (gene) names.
        
        Args:
            column: Optional name of the column containing gene names
            
        Returns:
            list: List of variable names
        """
        if not self.current_dataset:
            return []
            
        return zarr_reader.get_var_names(column)
    
    def get_layers(self) -> List[str]:
        """
        Get available layers.
        
        Returns:
            list: List of layer names
        """
        if not self.current_dataset:
            return []
            
        metadata = zarr_reader.get_metadata()
        
        # Handle both old and new metadata structure
        if isinstance(metadata.get("layers"), dict) and "keys" in metadata.get("layers", {}):
            return metadata.get("layers", {}).get("keys", [])
        elif isinstance(metadata.get("layers"), list):
            return metadata.get("layers", [])
        else:
            # If layers key exists but structure is unexpected, explore directly
            if 'layers' in zarr_reader.root and hasattr(zarr_reader.root['layers'], 'keys'):
                return list(zarr_reader.root['layers'].keys())
            return []
    
    def get_embeddings(self) -> List[str]:
        """
        Get available embeddings.
        
        Returns:
            list: List of embedding names
        """
        if not self.current_dataset:
            return []
            
        metadata = zarr_reader.get_metadata()
        return metadata.get("embeddings", [])
    
    def set_selected_cells(self, cells: Union[List[str], Set[str]]) -> None:
        """
        Set the selected cells.
        
        Args:
            cells: List or set of cell names to select
        """
        self.selected_cells = set(cells)
    
    def add_selected_cells(self, cells: Union[List[str], Set[str]]) -> None:
        """
        Add cells to the selection.
        
        Args:
            cells: List or set of cell names to add
        """
        self.selected_cells.update(cells)
    
    def remove_selected_cells(self, cells: Union[List[str], Set[str]]) -> None:
        """
        Remove cells from the selection.
        
        Args:
            cells: List or set of cell names to remove
        """
        self.selected_cells.difference_update(cells)
    
    def clear_selected_cells(self) -> None:
        """Clear all selected cells."""
        self.selected_cells.clear()
    
    def get_selected_cells(self) -> Set[str]:
        """
        Get the selected cells.
        
        Returns:
            set: Set of selected cell names
        """
        return self.selected_cells
    
    def set_selected_genes(self, genes: Union[List[str], Set[str]]) -> None:
        """
        Set the selected genes.
        
        Args:
            genes: List or set of gene names to select
        """
        self.selected_genes = set(genes)
    
    def add_selected_genes(self, genes: Union[List[str], Set[str]]) -> None:
        """
        Add genes to the selection.
        
        Args:
            genes: List or set of gene names to add
        """
        self.selected_genes.update(genes)
    
    def remove_selected_genes(self, genes: Union[List[str], Set[str]]) -> None:
        """
        Remove genes from the selection.
        
        Args:
            genes: List or set of gene names to remove
        """
        self.selected_genes.difference_update(genes)
    
    def clear_selected_genes(self) -> None:
        """Clear all selected genes."""
        self.selected_genes.clear()
    
    def get_selected_genes(self) -> Set[str]:
        """
        Get the selected genes.
        
        Returns:
            set: Set of selected gene names
        """
        return self.selected_genes
    
    def set_focused_cell(self, cell: Optional[str]) -> None:
        """
        Set the focused cell.
        
        Args:
            cell: Cell name to focus, or None to clear focus
        """
        self.focused_cell = cell
    
    def get_focused_cell(self) -> Optional[str]:
        """
        Get the focused cell.
        
        Returns:
            str or None: The focused cell name, or None if no cell is focused
        """
        return self.focused_cell
    
    def set_focused_gene(self, gene: Optional[str]) -> None:
        """
        Set the focused gene.
        
        Args:
            gene: Gene name to focus, or None to clear focus
        """
        self.focused_gene = gene
    
    def get_focused_gene(self) -> Optional[str]:
        """
        Get the focused gene.
        
        Returns:
            str or None: The focused gene name, or None if no gene is focused
        """
        return self.focused_gene
    
    def set_taxonomy_info(self, taxonomy_id: int, species: str) -> None:
        """
        Set the taxonomy information.
        
        Args:
            taxonomy_id: NCBI taxonomy ID
            species: Species name
        """
        self.taxonomy_id = taxonomy_id
        self.species = species
    
    def get_taxonomy_info(self) -> Dict[str, Any]:
        """
        Get the taxonomy information.
        
        Returns:
            dict: Dictionary with taxonomy information
        """
        return {
            "taxonomy_id": self.taxonomy_id,
            "species": self.species
        }
        
    def calculate_statistics(self, data: np.ndarray) -> Dict[str, Any]:
        """
        Calculate comprehensive statistics for numerical data.
        
        Args:
            data: Array of numerical data
            
        Returns:
            dict: Dictionary of statistics
        """
        # Handle edge cases
        if data is None or len(data) == 0:
            return {
                "count": 0,
                "min": None,
                "max": None,
                "mean": None,
                "std": None,
                "median": None
            }
            
        # Filter out non-finite values
        valid_data = data[np.isfinite(data)]
        if len(valid_data) == 0:
            return {
                "count": 0,
                "min": None,
                "max": None,
                "mean": None,
                "std": None,
                "median": None
            }
            
        # Calculate basic statistics
        stats = {
            "count": len(valid_data),
            "min": float(np.min(valid_data)),
            "max": float(np.max(valid_data)),
            "mean": float(np.mean(valid_data)),
            "std": float(np.std(valid_data)),
            "median": float(np.median(valid_data)),
            "sum": float(np.sum(valid_data)),
            "variance": float(np.var(valid_data))
        }
        
        # Calculate percentiles
        percentiles = [0, 1, 5, 10, 25, 50, 75, 90, 95, 99, 100]
        stats["percentiles"] = {
            f"p{p}": float(np.percentile(valid_data, p)) for p in percentiles
        }
        
        # Count zeros and non-zeros
        stats["zero_count"] = int(np.sum(valid_data == 0))
        stats["non_zero_count"] = int(np.sum(valid_data != 0))
        stats["zero_fraction"] = float(stats["zero_count"] / stats["count"]) if stats["count"] > 0 else 0
        
        # Count negative, positive values
        stats["negative_count"] = int(np.sum(valid_data < 0))
        stats["positive_count"] = int(np.sum(valid_data > 0))
        
        # Check for non-finite values in original data
        stats["nan_count"] = int(np.sum(np.isnan(data)))
        stats["inf_count"] = int(np.sum(np.isinf(data)))
        
        return stats
        
    def analyze_expression_data(self, gene_indices: Optional[List[int]] = None, 
                               cell_indices: Optional[List[int]] = None,
                               layer: Optional[str] = None) -> Dict[str, Any]:
        """
        Analyze expression data to produce summary statistics.
        
        Args:
            gene_indices: Indices of genes to analyze
            cell_indices: Indices of cells to analyze
            layer: Layer to analyze, or None for X
            
        Returns:
            dict: Dictionary of analysis results
        """
        if not self.current_dataset:
            return {"error": "No dataset loaded"}
            
        # Load the data
        if layer:
            data = self.get_layer(layer, cell_indices, gene_indices)
        else:
            data = self.get_X(cell_indices, gene_indices)
            
        if data is None or data.size == 0:
            return {"error": "No data available for the specified indices"}
            
        # Get overall statistics
        overall_stats = self.calculate_statistics(data.flatten())
        
        # Get per-gene statistics if applicable
        gene_stats = {}
        if len(data.shape) > 1 and data.shape[1] > 0:
            # If there are multiple genes, calculate stats for each
            if gene_indices is not None and len(gene_indices) < 100:
                gene_names = self.get_var_names()
                for i, gene_idx in enumerate(gene_indices):
                    gene_name = gene_names[gene_idx] if gene_idx < len(gene_names) else f"Gene_{gene_idx}"
                    gene_stats[gene_name] = self.calculate_statistics(data[:, i])
                    
        # Get per-cell statistics if applicable
        cell_stats = {}
        if len(data.shape) > 0 and data.shape[0] > 0:
            # If there are multiple cells, calculate stats for each
            if cell_indices is not None and len(cell_indices) < 100:
                cell_names = self.get_obs_names()
                for i, cell_idx in enumerate(cell_indices):
                    cell_name = cell_names[cell_idx] if cell_idx < len(cell_names) else f"Cell_{cell_idx}"
                    cell_stats[cell_name] = self.calculate_statistics(data[i, :])
                    
        # Return the combined results
        return {
            "overall": overall_stats,
            "genes": gene_stats,
            "cells": cell_stats,
            "shape": data.shape,
            "sparsity": overall_stats["zero_fraction"] if "zero_fraction" in overall_stats else None
        }
        
    def downsample_cells(self, n_samples: int = 1000, 
                        method: str = 'random', 
                        seed: int = 42) -> List[int]:
        """
        Downsample cells for visualization or analysis.
        
        Args:
            n_samples: Number of cells to sample
            method: Downsampling method ('random', 'stratified', or 'kmeans')
            seed: Random seed
            
        Returns:
            list: List of cell indices
        """
        if not self.current_dataset:
            return []
            
        metadata = zarr_reader.get_metadata()
        n_cells = metadata.get("shape", (0, 0))[0]
        
        if n_cells <= n_samples:
            # Return all cells if we have fewer than requested samples
            return list(range(n_cells))
            
        if method == 'random':
            # Simple random sampling
            np.random.seed(seed)
            return sorted(np.random.choice(n_cells, n_samples, replace=False).tolist())
            
        elif method == 'stratified':
            # Stratified sampling based on cell types if available
            if metadata.get("has_obs", False) and "cell_type" in metadata.get("obs_columns", []):
                # Get cell types
                cell_types = zarr_reader.get_obs("cell_type")
                
                if cell_types is not None and len(cell_types) > 0:
                    unique_types = np.unique(cell_types)
                    n_types = len(unique_types)
                    
                    # Allocate samples proportionally
                    samples_per_type = min(n_samples // n_types, 1)
                    remainder = n_samples - (samples_per_type * n_types)
                    
                    # Sample from each cell type
                    indices = []
                    np.random.seed(seed)
                    
                    for cell_type in unique_types:
                        type_indices = np.where(cell_types == cell_type)[0]
                        n_to_sample = min(len(type_indices), samples_per_type)
                        
                        if n_to_sample > 0:
                            sampled = np.random.choice(type_indices, n_to_sample, replace=False)
                            indices.extend(sampled.tolist())
                    
                    # Sample remaining indices randomly
                    if remainder > 0 and n_cells > len(indices):
                        remaining_indices = list(set(range(n_cells)) - set(indices))
                        additional = np.random.choice(remaining_indices, 
                                                     min(remainder, len(remaining_indices)), 
                                                     replace=False)
                        indices.extend(additional.tolist())
                    
                    return sorted(indices)
            
            # Fall back to random sampling
            return self.downsample_cells(n_samples, 'random', seed)
            
        elif method == 'kmeans':
            # K-means clustering based downsampling if embeddings available
            embeddings = self.get_embeddings()
            if embeddings and embeddings[0]:
                try:
                    # Use the first embedding
                    embedding_data = zarr_reader.get_obsm(embeddings[0])
                    
                    if embedding_data is not None and embedding_data.shape[0] == n_cells:
                        from sklearn.cluster import MiniBatchKMeans
                        
                        # Apply K-means clustering
                        n_clusters = min(n_samples, n_cells)
                        kmeans = MiniBatchKMeans(n_clusters=n_clusters, random_state=seed)
                        labels = kmeans.fit_predict(embedding_data)
                        
                        # Select cells closest to cluster centers
                        indices = []
                        for i in range(n_clusters):
                            cluster_indices = np.where(labels == i)[0]
                            if len(cluster_indices) > 0:
                                # Find the cell closest to the cluster center
                                cluster_points = embedding_data[cluster_indices]
                                center = kmeans.cluster_centers_[i]
                                distances = np.linalg.norm(cluster_points - center, axis=1)
                                closest_idx = cluster_indices[np.argmin(distances)]
                                indices.append(closest_idx)
                        
                        return sorted(indices)
                except Exception as e:
                    logger.error(f"Error in k-means downsampling: {e}")
            
            # Fall back to random sampling
            return self.downsample_cells(n_samples, 'random', seed)
        
        else:
            # Unknown method, fall back to random sampling
            logger.warning(f"Unknown downsampling method: {method}, falling back to random")
            return self.downsample_cells(n_samples, 'random', seed)
    
    def _add_to_cache(self, key: str, value: Any) -> None:
        """
        Add an item to the cache with LRU eviction.
        
        Args:
            key: Cache key
            value: Value to cache
        """
        # If the cache is full, remove the oldest item
        if len(self.cache) >= self.cache_max_size:
            oldest_key = next(iter(self.cache.keys()))
            del self.cache[oldest_key]
            
        # Add the new item
        self.cache[key] = value

# Create a singleton instance
data_manager = DataManager()
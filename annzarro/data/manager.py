"""
Dataset discovery for the server's dataset routes.

``list_datasets`` (``/api/v1/core/datasets``) and ``get_dataset_info``
(``/api/v1/datasets/<path>``) are what the server uses. The class used to
also hold a stateful dataset session (load_dataset, get_X/obs/var/obsm,
selections, focus, downsampling) built on a ZarrReader API removed in
a5c1aed; nothing in the server or the frontend called it, and every call
raised AttributeError, so it was removed rather than kept as a trap.
"""

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from ..core.zarr_reader import zarr_reader
from .scan import DEFAULT_MAX_ENTRIES, scan_stores
from ..utils.paths import default_data_dir

__all__ = [
    "DataManager",
    "data_manager",
]


logger = logging.getLogger(__name__)


class DataManager:
    """Finds datasets under a directory and summarises one dataset."""

    def __init__(self):
        """Create a manager; it holds no dataset, only the configuration of its scans."""
        # id -> dataset entry from the last discovery
        self.datasets = {}
        # whether the last discovery stopped before it had seen everything
        self.truncated = False

    def discover_datasets(self, data_dir: Union[str, Path, None] = None, recursive: bool = True, follow_symlinks: bool = True,
                          max_entries: int = DEFAULT_MAX_ENTRIES) -> List[Dict[str, str]]:
        """
        Discover available zarr datasets in the specified directory.
        
        Args:
            data_dir: Directory to search for datasets
            recursive: Whether to scan directories recursively
            follow_symlinks: Whether to follow symbolic links
            max_entries: Directory entries to read before stopping (``self.truncated`` says it did)
            
        Returns:
            List of dataset information dictionaries
        """
        data_dir = Path(data_dir) if data_dir else Path(default_data_dir())
        
        if not data_dir.exists() or not data_dir.is_dir():
            return []
            
        # Find the .zarr directories, never walking a store's own chunks (data/scan.py)
        zarr_dirs, self.truncated = scan_stores(str(data_dir), recursive=recursive,
                                                follow_symlinks=follow_symlinks, max_entries=max_entries)
        if self.truncated:
            logger.warning("Dataset scan of %s stopped after %s directory entries (server.dataset_scan_max_entries)",
                           data_dir, max_entries)
        
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
        
    def list_datasets(self, directory: Optional[str] = None, recursive: bool = True, follow_symlinks: bool = True,
                      max_entries: int = DEFAULT_MAX_ENTRIES) -> List[Dict[str, str]]:
        """
        List available datasets, optionally from a specific directory.
        
        Args:
            directory: Directory to search (if None, the cached list or the default data directory)
            recursive: Whether to scan directories recursively
            follow_symlinks: Whether to follow symbolic links
            
        Returns:
            List of dataset information dictionaries
        """
        if directory:
            return self.discover_datasets(directory, recursive=recursive, follow_symlinks=follow_symlinks,
                                          max_entries=max_entries)
        elif self.datasets:
            return list(self.datasets.values())
        else:
            return self.discover_datasets(recursive=recursive, follow_symlinks=follow_symlinks, max_entries=max_entries)
            
    def get_dataset_info(self, dataset_path: str) -> Dict[str, Any]:
        """
        Get information about a dataset.
        
        Args:
            dataset_path: Path to the dataset
            
        Returns:
            Dictionary with dataset information
        """
        # First try to open the dataset. ZarrReader is stateless: opening
        # returns (root, metadata) and raises on failure rather than
        # reporting success as a bool.
        try:
            _root, metadata = zarr_reader.open_dataset_by_path(dataset_path)
        except (ValueError, RuntimeError) as e:
            logger.error(f"Failed to open dataset {dataset_path}: {e}")
            return {"error": "Failed to open dataset", "message": str(e)}

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
        obs_names = zarr_reader.get_obs_names(dataset_path)[:10] if metadata.get("has_obs", False) else []
        var_names = zarr_reader.get_var_names(dataset_path)[:10] if metadata.get("has_var", False) else []
        
        info["obs_names_sample"] = obs_names
        info["var_names_sample"] = var_names
        
        return info


# Create a singleton instance
data_manager = DataManager()

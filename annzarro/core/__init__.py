"""Core functionality for Annzarro."""

from pathlib import Path

# Import zarr reader class
from .zarr_reader import ZarrReader
from .h5ad_reader import h5adReader

# Create a reader instance with default settings
# This will be configured later by the server settings
zarr_reader = ZarrReader()
h5ad_reader_obj = h5adReader()

def get_reader(path):
    dataset_path = Path(path)

    # Check if path exists
    if not dataset_path.exists():
        raise FileNotFoundError(f"Dataset path does not exist: {path}")

    suffix = dataset_path.suffix

    if suffix == ".zarr":
        return zarr_reader
    elif suffix == ".h5ad":
        return h5ad_reader_obj
    else:
        raise ValueError(f"Unknown file type '{suffix}'. Must be .zarr or .h5ad")

# Function to configure the reader based on settings
def configure_zarr_reader(config):
    """
    Configure the zarr reader singleton with the provided config

    Args:
        config: Configuration dictionary with cache settings
    """
    global zarr_reader

    # Get cache settings from config
    max_memory_mb = config.get('cache_memory_mb', 1000)
    enable_caching = config.get('cache_enabled', True)
    cache_limit = config.get('cache_dataset_limit', 10)

    # Create a new reader with the configured settings
    zarr_reader = ZarrReader(
        max_memory_mb=max_memory_mb,
        enable_caching=enable_caching,
        cache_limit=cache_limit
    )

    return zarr_reader

def configure_h5ad_reader(config):
    """
    Configure the h5ad reader singleton with the provided config

    Args:
        config: Configuration dictionary with cache settings
    """
    global h5ad_reader_obj

    # Get cache settings from config
    max_memory_mb = config.get('cache_memory_mb', 1000)
    enable_caching = config.get('cache_enabled', True)
    cache_limit = config.get('cache_dataset_limit', 10)

    # Create a new reader with the configured settings
    h5ad_reader_obj = h5adReader(
        max_memory_mb=max_memory_mb,
        enable_caching=enable_caching,
        cache_limit=cache_limit
    )

    return h5ad_reader_obj

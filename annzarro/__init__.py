"""
Annzarro: Python-based Single-Cell Data Visualization Tool
---------------------------------------------------------

A Python-centric tool for visualizing and analyzing single-cell data stored in zarr format.
Provides both a Python API and a web interface for data exploration.

Core components:
- Data management with Python's zarr library for efficient data access
- REST API for frontend-backend communication
- Web interface for interactive visualization
"""

__version__ = "0.5.4"

# Import version from package metadata if available, otherwise use the hardcoded value above
try:
    import importlib.metadata
    __version__ = importlib.metadata.version("annzarro")
except (ImportError, importlib.metadata.PackageNotFoundError):
    pass  # Keep using the hardcoded version

# Import and expose core modules
from .core.zarr_reader import (
    ZarrReader, zarr_reader, UnsupportedEncodingError, ZarrFormatError, StoreReadError, MissingKeyError,
)
from .core.store_check import check_store, StoreCheckError

# Import and expose data management
from .data.manager import DataManager
from .data import data_manager

# Import and expose server functionality
from .server.core import create_app
from .server.server import run_server
from .server.wsgi import create_wsgi_app

# Figures made with ``annzarro export`` carry the view that drew them
from .export import read_recipe, ExportError

# The public Python API: documented in docs/reference/python-api.md, which a test
# (annzarro/tests/test_public_api.py) holds to this list. Anything else is internal.
__all__ = [
    "__version__",
    # reading a store
    "ZarrReader",
    "zarr_reader",
    "UnsupportedEncodingError",
    "ZarrFormatError",
    "StoreReadError",
    "MissingKeyError",
    # listing datasets
    "DataManager",
    "data_manager",
    # checking a store's layout
    "check_store",
    "StoreCheckError",
    # serving
    "run_server",
    "create_app",
    "create_wsgi_app",
    # figures
    "read_recipe",
    "ExportError",
]

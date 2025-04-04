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

__version__ = "0.1.0"

# Import version from package metadata if available, otherwise use the hardcoded value above
try:
    import importlib.metadata
    __version__ = importlib.metadata.version("annzarro")
except (ImportError, importlib.metadata.PackageNotFoundError):
    pass  # Keep using the hardcoded version

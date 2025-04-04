"""
Routes module for the Annzarro server.

This package contains all the routes for the Annzarro server,
organized by functionality.
"""

from .core import register_core_routes
from .data_routes import register_data_routes
from .zarr_routes import register_zarr_routes
from .static_routes import register_static_routes

__all__ = [
    'register_core_routes',
    'register_data_routes', 
    'register_zarr_routes',
    'register_static_routes'
]
# Library Files for Annzarro

This directory contains essential library files that may be required for the application.

## Legacy Libraries (No Longer Used)

- ~~`zarr.umd.js`~~ - The JavaScript zarr library is no longer used. The application now exclusively uses the Python zarr implementation via the unified server for all zarr operations.

## Note on Architecture Change

As of the latest version, Annzarro has migrated to a unified server architecture that uses Python's zarr library exclusively for all zarr operations. The JavaScript zarr.js library is no longer required or used.

All zarr operations are now handled by:
1. The Python backend API endpoints
2. The zarr-loader.js module that communicates with these endpoints

This change provides better performance, improved memory management, and better support for large datasets through lazy loading.
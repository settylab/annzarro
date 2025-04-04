"""
Core routes for the Annzarro server.

This module contains core routes for server configuration, status, and dataset listing.
"""

import os
import psutil
import time
import platform
import logging
from datetime import datetime, timedelta
from pathlib import Path
from flask import request, jsonify, current_app as app

from annzarro.data.manager import data_manager

logger = logging.getLogger(__name__)

def register_core_routes(app, api_version):
    """
    Register core routes with the Flask app.
    
    Args:
        app: Flask application instance
        api_version: API version string
    """
    
    @app.route(f"/api/{api_version}/datasets", methods=["GET"])
    def list_datasets():
        """
        List available datasets.
        
        Returns:
            JSON response with dataset list
        """
        # Get data directory from config
        data_dir = app.config.get("data_dir", "data")
        
        # Override from query parameter if provided
        if "dir" in request.args:
            data_dir = request.args.get("dir")
            
            # Handle "." as current directory by converting to os.getcwd()
            if data_dir == ".":
                data_dir = os.getcwd()
        
        # Add option to scan recursively
        recursive = request.args.get("recursive", "true").lower() == "true"
        
        # Add option to follow symlinks
        follow_symlinks = request.args.get("follow_symlinks", "true").lower() == "true"
        
        # List datasets with new options
        datasets = data_manager.list_datasets(data_dir, recursive=recursive, follow_symlinks=follow_symlinks)
        
        return jsonify({"datasets": datasets})

    @app.route(f"/api/{api_version}/config", methods=["GET"])
    def get_config():
        """
        Get server configuration.
        
        Returns:
            JSON response with configuration (limited to what clients need to know)
        """
        # Only return necessary configuration
        client_config = {
            "host": app.config.get("host", "127.0.0.1"),
            "port": app.config.get("port", 8000),
            "data_dir": app.config.get("data_dir", "data")
        }
        
        return jsonify(client_config)
        
    @app.route(f"/api/{api_version}/status", methods=["GET"])
    def get_status():
        """
        Get server status information.
        
        Returns:
            JSON response with server status information
        """
        try:
            # Get process information
            process = psutil.Process(os.getpid())
            
            # Calculate uptime
            start_time = datetime.fromtimestamp(process.create_time())
            uptime = datetime.now() - start_time
            
            # Format uptime
            days, remainder = divmod(uptime.total_seconds(), 86400)
            hours, remainder = divmod(remainder, 3600)
            minutes, seconds = divmod(remainder, 60)
            uptime_str = f"{int(days)}d {int(hours)}h {int(minutes)}m {int(seconds)}s"
            
            # Get memory usage
            memory_info = process.memory_info()
            memory_usage_mb = memory_info.rss / (1024 * 1024)  # Convert to MB
            
            # Get load information
            cpu_load = process.cpu_percent(interval=0.1)
            system_load = psutil.cpu_percent(interval=0.1)
            
            # Get connection count
            try:
                # Use net_connections instead of connections which is deprecated
                connections_count = len(process.net_connections())
            except Exception:
                # Fallback in case of permission issues
                connections_count = 0
            
            # Check data directory
            data_dir = app.config.get("data_dir", "data")
            data_dir_exists = os.path.exists(data_dir)
            data_dir_is_readable = os.access(data_dir, os.R_OK)
            data_dir_is_writable = os.access(data_dir, os.W_OK)
            
            # Count files in data directory
            zarr_count = 0
            if data_dir_exists and data_dir_is_readable:
                for root, dirs, files in os.walk(data_dir):
                    if '.zgroup' in files:
                        zarr_count += 1
            
            # Get version from the package
            try:
                from annzarro import __version__
                version = __version__
            except ImportError:
                version = "0.1.0"  # Fallback version
                
            # Build status information
            status = {
                "server": {
                    "status": "running",
                    "version": version,
                    "start_time": start_time.isoformat(),
                    "uptime": uptime_str,
                    "uptime_seconds": int(uptime.total_seconds()),
                    "pid": process.pid,
                    "python_version": platform.python_version(),
                    "platform": platform.platform(),
                    "hostname": platform.node()
                },
                "config": {
                    "host": app.config.get("host", "127.0.0.1"),
                    "port": app.config.get("port", 8000),
                    "data_dir": data_dir,
                    "static_dir": app.config.get("static_dir"),
                    "unified_server": app.config.get("unified_server", True)
                },
                "resources": {
                    "memory_usage_mb": round(memory_usage_mb, 2),
                    "cpu_load": round(cpu_load, 2),
                    "system_load": round(system_load, 2),
                    "connections": connections_count
                },
                "data": {
                    "data_dir_exists": data_dir_exists,
                    "data_dir_readable": data_dir_is_readable,
                    "data_dir_writable": data_dir_is_writable,
                    "zarr_file_count": zarr_count
                }
            }
            
            return jsonify(status)
        except Exception as e:
            logger.error(f"Error in get_status: {e}")
            return jsonify({
                "server": {
                    "status": "error",
                    "error": str(e)
                }
            }), 500

    @app.route(f"/api/{api_version}/datasets/<path:dataset_path>", methods=["GET"])
    def get_dataset_info(dataset_path: str):
        """
        Get information about a dataset.
        
        Args:
            dataset_path: Path to the dataset
            
        Returns:
            JSON response with dataset information
        """
        # Get dataset info
        info = data_manager.get_dataset_info(dataset_path)
        
        return jsonify(info)
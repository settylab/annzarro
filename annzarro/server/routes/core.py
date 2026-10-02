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

from ...data.manager import data_manager

logger = logging.getLogger(__name__)

def register_core_routes(app, api_version):
    """
    Register core routes with the Flask app.
    
    Args:
        app: Flask application instance
        api_version: API version string
    """
    
    @app.route(f"/api/{api_version}/core/datasets", methods=["GET"])
    def list_legacy_datasets():
        """
        List available datasets (legacy endpoint).
        
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
        # Not offered when hosted: anything a link leads to outside the roots
        from ..confinement import listable
        datasets = [d for d in datasets
                    if not isinstance(d, dict) or not d.get("path") or listable(app.config, d["path"])]
        
        return jsonify({"datasets": datasets})

    @app.route(f"/api/{api_version}/config", methods=["GET"])
    def get_config():
        """
        Get server configuration.
        
        Returns:
            JSON response with configuration (limited to what clients need to know)
        """
        try:
            # Check if we have access to the config manager
            from annzarro.utils.config_manager import config_manager
            
            # Try to get filtered configuration
            filtered_config = config_manager.get_filtered_config("public")
            
            # If filtered config exists, return it
            if filtered_config:
                # Add a few basic connection parameters that might not be in the filtered config
                # but are needed by the frontend
                if "host" not in filtered_config and "server" in filtered_config:
                    filtered_config["host"] = filtered_config.get("server", {}).get("host", app.config.get("host", "127.0.0.1"))
                    
                if "port" not in filtered_config and "server" in filtered_config:
                    filtered_config["port"] = filtered_config.get("server", {}).get("port", app.config.get("port", 8000))
                    
                if "data_dir" not in filtered_config and "server" in filtered_config:
                    filtered_config["data_dir"] = filtered_config.get("server", {}).get("data_dir", app.config.get("data_dir", "data"))
                
                # Add environment flags
                filtered_config["electron_mode"] = os.environ.get("ANNZARRO_ELECTRON_MODE", "0") == "1"
                filtered_config["local_mode"] = os.environ.get("ANNZARRO_LOCAL_MODE", "0") == "1"
                
                logger.debug(f"Sending environment flags to frontend: electron_mode={filtered_config['electron_mode']}, local_mode={filtered_config['local_mode']}")
                
                return jsonify(filtered_config)
        except ImportError:
            # Config manager not available, fall back to default filtering
            logger.warning("Config manager not available, using default security filtering")
        except Exception as e:
            # Something went wrong, fall back to default filtering
            logger.error(f"Error filtering configuration: {e}")
        
        # Fall back to default filtering approach
        client_config = {
            # Basic connectivity info the frontend needs
            "host": app.config.get("host", "127.0.0.1"),
            "port": app.config.get("port", 8000),
            "data_dir": app.config.get("data_dir", "data"),
            
            # UI/application information
            "app_name": app.config.get("app_name", "Annzarro"),
            "project_description": app.config.get("project_description", "Zarr-based AnnData Visualization Tool"),
            
            # Contact info - explicitly extract only what's needed
            "contact_info": {
                "lab_name": app.config.get("contact_info", {}).get("lab_name"),
                "lab_url": app.config.get("contact_info", {}).get("lab_url"),
                "email": app.config.get("contact_info", {}).get("email"),
                "custom_html": app.config.get("contact_info", {}).get("custom_html")
            },
            
            # Feature flags and limits - only sharing safe values
            "max_cells_per_request": app.config.get("max_cells_per_request", 10000),
            "max_genes_per_request": app.config.get("max_genes_per_request", 10000),
            
            # UI settings
            "ui_max_cells": app.config.get("ui_max_cells", None),
            "ui_max_genes": app.config.get("ui_max_genes", None),
            "ui_point_size": app.config.get("ui_point_size", None),
            "ui_point_opacity": app.config.get("ui_point_opacity", None),
            "ui_color_scale": app.config.get("ui_color_scale", None),
            "ui_taxonomy_id": app.config.get("ui_taxonomy_id", None),
            "enabled_panel_types": app.config.get("enabled_panel_types", None),
            
            # Environment flags
            "electron_mode": os.environ.get("ANNZARRO_ELECTRON_MODE", "0") == "1",
            "local_mode": os.environ.get("ANNZARRO_LOCAL_MODE", "0") == "1"
        }
        
        # Log the environment mode flags
        logger.debug(f"Sending environment flags to frontend: electron_mode={client_config['electron_mode']}, local_mode={client_config['local_mode']}")
        
        # Never share sensitive values
        return jsonify(client_config)
        
    @app.route(f"/api/{api_version}/auth/me", methods=["GET"])
    def get_current_user():
        """
        Who the requester is and what they may change.

        Registered whether or not login is enabled, so the client can ask one
        question in both modes. ``exposed`` is true when the server listens
        beyond this machine with login disabled -- anyone who can reach it can
        then edit and delete every shared panel set.

        Returns:
            JSON ``{auth_enabled, username, is_admin, exposed}``
        """
        from .. import permissions
        username, is_admin = permissions.current_user()
        return jsonify({
            "auth_enabled": permissions.auth_enabled(),
            "username": username,
            "is_admin": is_admin,
            "exposed": permissions.is_exposed(app.config),
        })

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
                    "unified_server": app.config.get("unified_server", True)
                    # static_dir removed - no need to expose internal file paths
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
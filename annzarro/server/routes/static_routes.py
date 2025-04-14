"""
Static file routes for the Annzarro server.

This module contains routes for serving static files for the web UI.
"""

import os
import logging
from pathlib import Path
from flask import send_file, send_from_directory, current_app as app, render_template

logger = logging.getLogger(__name__)

def register_static_routes(app, api_version):
    """
    Register static file routes with the Flask app.
    
    Args:
        app: Flask application instance
        api_version: API version string
    """
    
    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_static(path: str):
        """
        Serve static files for the web UI.
        
        This function handles all non-API routes and serves static files from the configured
        static directory or the repository root by default. It makes the Flask server act 
        as both an API server and a static file server, eliminating the need for a separate
        frontend server.
        
        Args:
            path: Path to the requested file
            
        Returns:
            Flask response
        """
        from annzarro.server.core import require_auth
        
        # Skip API routes - they will be handled by the API endpoints
        if path.startswith(f"api/{api_version}") or path.startswith(f"api"):
            return {"error": "Not found"}, 404
            
        # Authentication check for static files except login page
        if path != "login" and app.config.get("auth_enabled", False):
            # Import functions rather than decorating to avoid circular import
            from flask import session, redirect
            if "user_id" not in session:
                logger.warning(f"Unauthenticated access attempt to /{path}")
                return redirect("/login")
        
        # Get static directory from config
        static_dir = app.config.get("static_dir")
        
        if not static_dir:
            # Use repository root as default
            static_dir = Path(__file__).resolve().parent.parent.parent.parent
        
        # Normalize the path
        static_dir = os.path.abspath(static_dir)
        logger.debug(f"Serving static content from: {static_dir}")
        
        # If path is empty or a directory, render index template
        full_path = os.path.join(static_dir, path)
        if not path or (os.path.exists(full_path) and os.path.isdir(full_path)):
            logger.debug(f"Rendering index.html template")
            return render_template(
                "index.html",
                app_name=app.config.get("app_name", "Annzarro"),
                project_description=app.config.get("project_description", "Zarr-based AnnData Visualization")
            )
        
        # Check if the file exists
        if os.path.exists(full_path) and os.path.isfile(full_path):
            logger.debug(f"Serving file: {full_path}")
            try:
                return send_from_directory(static_dir, path)
            except Exception as e:
                logger.error(f"Error serving file {path}: {e}")
                return {"error": "Error serving file"}, 500
        else:
            # File not found - for single page apps, render the index template for client-side routing
            logger.debug(f"File not found: {full_path}, rendering index.html template for client-side routing")
            return render_template(
                "index.html",
                app_name=app.config.get("app_name", "Annzarro"),
                project_description=app.config.get("project_description", "Zarr-based AnnData Visualization")
            )
"""
Unified Server module for Annzarro

This module provides a Flask-based web server for the Annzarro application.
It serves both the web UI static content and the API endpoints for data access
through a single unified server on one port.
"""

import os
import json
import logging
from pathlib import Path
from typing import Dict, Any, Optional

from flask import Flask, current_app

from .core import create_app, DEFAULT_CONFIG, load_config_from_file

# Set up logging
logger = logging.getLogger(__name__)

# Global app instance to maintain context
_app_instance = None

def run_server(
    config_file: Optional[str] = None,
    config: Optional[Dict[str, Any]] = None,
    debug: Optional[bool] = None,
    port: Optional[int] = None,
    host: Optional[str] = None,
    data_dir: Optional[str] = None,
    static_dir: Optional[str] = None,
    detach: bool = False
) -> None:
    """
    Run the Annzarro server.
    
    Args:
        config_file: Path to configuration file or config dictionary (optional)
        config: Configuration dictionary (optional)
        debug: Enable debug mode (optional)
        port: Port to run the server on (optional)
        host: Host to bind to (optional)
        data_dir: Directory to use for data storage (optional)
        static_dir: Directory containing static files (optional)
        detach: Run server in detached mode (optional)
    """
    global _app_instance
    
    # Get configuration from config_file (which can be a dict from config_manager)
    final_config = load_config_from_file(config_file) if config_file else {}
    
    # Update with provided config dictionary if any
    if config:
        final_config.update(config)
    
    # Override with function parameters if provided
    if host:
        final_config["host"] = host
    
    if port:
        final_config["port"] = port
    
    if debug is not None:
        final_config["debug"] = debug
    
    if data_dir:
        final_config["data_dir"] = data_dir
    
    if static_dir:
        final_config["static_dir"] = static_dir
    
    # Create and configure the Flask app
    app = create_app(final_config)
    _app_instance = app
    
    # Push application context to make it available globally
    # This allows imports and code executed at module level to access current_app
    ctx = app.app_context()
    ctx.push()
    
    # Ensure data directory exists
    data_dir = final_config.get("data_dir", "data")
    os.makedirs(data_dir, exist_ok=True)
    
    # Log configuration
    host = final_config.get("host", "127.0.0.1")
    port = final_config.get("port", 8000)
    debug = final_config.get("debug", False)
    
    logger.info(f"Starting Annzarro server on {host}:{port}")
    logger.info(f"Data directory: {data_dir}")
    logger.info(f"Static directory: {final_config.get('static_dir', 'project root')}")
    logger.info(f"Debug mode: {debug}")
    
    # Handle detached mode if requested
    if detach:
        import subprocess
        import sys
        import time
        from pathlib import Path
        
        # Create a new process for running the server
        logger.info("Starting server in detached mode")
        
        # Prepare command for detached process
        cmd = [
            sys.executable, "-m", "annzarro.cli", "start",
            "--host", host,
            "--port", str(port),
            "--data-dir", data_dir
        ]
        
        if final_config.get("debug", False):
            cmd.append("--debug")
        
        # Start detached process
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True
        )
        
        # Wait briefly to check if process started successfully
        time.sleep(1)
        if proc.poll() is not None:
            # Process exited immediately - there was an error
            stdout, stderr = proc.communicate()
            logger.error(f"Failed to start server in detached mode: {stderr.decode('utf-8')}")
            return
            
        # Server started successfully in background
        logger.info(f"Server started in detached mode (PID: {proc.pid})")
        
        # Store PID for later management
        pid_dir = Path.home() / ".annzarro"
        pid_dir.mkdir(exist_ok=True)
        with open(pid_dir / "server.pid", "w") as f:
            f.write(str(proc.pid))
            
    else:
        try:
            # Run the server in foreground
            ssl_context = None
            if final_config.get("https_enabled", False):
                # Check if cert and key files exist
                cert_file = final_config.get("cert_file")
                key_file = final_config.get("key_file")
                
                if cert_file and key_file and os.path.exists(cert_file) and os.path.exists(key_file):
                    ssl_context = (cert_file, key_file)
                    logger.info(f"HTTPS enabled with certificate: {cert_file} and key: {key_file}")
                else:
                    logger.warning("HTTPS is enabled but certificate or key file is missing or invalid.")
                    logger.warning(f"Certificate file: {cert_file}")
                    logger.warning(f"Key file: {key_file}")
                    logger.warning("Falling back to HTTP.")
            
            app.run(
                host=final_config.get("host", "127.0.0.1"),
                port=final_config.get("port", 8000),
                debug=final_config.get("debug", False),
                threaded=True,
                ssl_context=ssl_context
            )
        finally:
            # Pop the context when server stops
            ctx.pop()
        
# Helper function to get the current app instance
def get_app_instance():
    """Get the current Flask application instance."""
    global _app_instance
    if _app_instance is None:
        raise RuntimeError(
            "No application instance available. "
            "Make sure run_server() has been called."
        )
    return _app_instance
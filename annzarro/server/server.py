"""
Unified Server module for Annzarro

This module provides a Flask-based web server for the Annzarro application.
It serves both the web UI static content and the API endpoints for data access
through a single unified server on one port.
"""

import os
import sys
import json
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional

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
    detach: bool = False,
    no_browser: bool = False,
    detach_args: Optional[List[str]] = None
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
        no_browser: Don't open a browser automatically (optional)
        detach_args: Extra CLI arguments (e.g. --config) for the detached child
    """
    global _app_instance
    
    # Get configuration from config_file (which can be a dict from config_manager)
    final_config = load_config_from_file(config_file) if config_file else {}
    
    # Debug output to check what configuration we're receiving
    logger.info(f"Configuration host value: {final_config.get('host', 'NOT FOUND')}")
    
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
    
    # Log configuration with full details
    host = final_config.get("host", "127.0.0.1")
    port = final_config.get("port", 8000)
    debug = final_config.get("debug", False)
    
    logger.info(f"Starting Annzarro server on {host}:{port}")
    logger.info(f"Data directory: {data_dir}")
    logger.info(f"Static directory: {final_config.get('static_dir') or 'frontend static/'}")
    logger.info(f"Debug mode: {debug}")
    
    # Show the full server configuration section for debugging
    if "server" in final_config:
        logger.info("Server configuration details:")
        for key, value in final_config.items():
            if key.startswith("__"):
                continue
            logger.info(f"  - {key}: {value}")
    
    # Handle detached mode if requested
    if detach:
        import subprocess
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
        ] + list(detach_args or [])
        
        # server.debug reaches the child through the same configuration
        # (--config / --development in detach_args). Appending `--debug` here
        # was a parse error: it is a global option and cannot follow `start`.

        # Pass auth settings to detached process
        if "auth_enabled" in final_config:
            if not final_config.get("auth_enabled"):
                cmd.append("--auth-disabled")
                logger.info("Passing --auth-disabled flag to detached process")
            else:
                logger.info("Authentication is enabled for detached process")
            
        # Always use --no-browser for detached process
        # The detached process will handle opening its own browser
        if "--no-browser" not in cmd:
            cmd.append("--no-browser")
            logger.info("Using --no-browser flag for detached process")
        
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
        # Standard location in home directory with a fallback if access fails
        from annzarro.utils.paths import pid_file
        pid_dir = pid_file().parent
        try:
            # Create the directory if it doesn't exist
            pid_dir.mkdir(parents=True, exist_ok=True)
            
            # Try to write the PID file
            with open(pid_dir / "server.pid", "w") as f:
                f.write(str(proc.pid))
                
            logger.info(f"PID file written to {pid_dir / 'server.pid'}")
        except (PermissionError, OSError) as e:
            # If we can't write to the home directory, try the temp directory
            logger.warning(f"Failed to write PID to home directory: {e}")
            try:
                import tempfile
                pid_dir = Path(tempfile.gettempdir()) / "annzarro"
                pid_dir.mkdir(exist_ok=True)
                with open(pid_dir / "server.pid", "w") as f:
                    f.write(str(proc.pid))
                logger.info(f"PID file written to alternative location: {pid_dir / 'server.pid'}")
            except Exception as e2:
                logger.error(f"Failed to write PID file to alternative location: {e2}")
            
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
            
            # Determine server parameters
            use_host = final_config.get("host", "127.0.0.1")
            use_port = final_config.get("port", 8000)
            
            # Determine if we should try to open a browser and if we're in headless mode
            should_open_browser = not no_browser
            if os.environ.get('ANNZARRO_ELECTRON_APP', 'false') in ['true', '1']:
                logger.info("Should not open browser inside electron app")
                should_open_browser = False
            
            
            # Infer headless mode if environment variable not set
            is_headless = False
            if os.environ.get('ANNZARRO_HEADLESS') is not None:
                is_headless = True
                logger.debug("Headless mode detected via environment variable")
            else:
                # Try to infer if we're in a headless environment
                try:
                    # Check for common headless environment indicators
                    if 'SSH_CONNECTION' in os.environ or 'SSH_TTY' in os.environ:
                        logger.debug("Headless mode inferred via SSH environment")
                        is_headless = True
                    elif  not os.environ.get('DISPLAY') and not sys.platform.startswith('win') and not sys.platform.startswith('darwin'):
                        # No display on Linux usually means headless
                        logger.debug("Headless mode inferred via missing DISPLAY on Linux")
                        is_headless = True
                    elif 'CI' in os.environ or 'CONTINUOUS_INTEGRATION' in os.environ:
                        # CI environments are usually headless
                        logger.debug("Headless mode inferred via CI environment")
                        is_headless = True
                except Exception as e:
                    logger.debug(f"Error inferring headless mode: {e}")
                    is_headless = True
                
            # Don't open browser in headless mode
            if is_headless:
                should_open_browser = False
                logger.debug("Browser opening disabled due to headless environment")
            
            # Set local mode environment variable if we have a browser
            if should_open_browser:
                os.environ['ANNZARRO_LOCAL_MODE'] = '1'
                logger.info("Setting ANNZARRO_LOCAL_MODE=1 for frontend detection")
            
            # Try to open browser if requested and not in headless mode
            if should_open_browser:
                import threading
                import webbrowser
                import time
                
                def open_browser():
                    # Wait for the server to start
                    time.sleep(1.5)
                    # Determine protocol (http or https)
                    protocol = "https" if ssl_context else "http"
                    # Open browser to the local server
                    from annzarro.server.core import normalize_url_prefix
                    prefix = normalize_url_prefix(final_config.get("url_prefix"))
                    url = f"{protocol}://127.0.0.1:{use_port}{prefix}/"
                    logger.info(f"Opening browser to {url}")
                    try:
                        if not webbrowser.open(url):
                            logger.warning("Failed to open browser automatically")
                    except Exception as e:
                        logger.warning(f"Error opening browser: {e}")
                
                # Start browser in a separate thread to not block server startup
                threading.Thread(target=open_browser).start()
            
            app.run(
                host=use_host,
                port=use_port,
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
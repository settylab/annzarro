"""
Core module for the Annzarro server.

This module contains core functionality for the Annzarro server,
including configuration, initialization, and routing.
"""

import os
import json
import logging
from pathlib import Path
from typing import Dict, Any, Optional
from functools import wraps
import time

from flask import Flask, request, jsonify, session, redirect, url_for, current_app
from flask_cors import CORS
from werkzeug.middleware.proxy_fix import ProxyFix

logger = logging.getLogger(__name__)

# Default configuration
DEFAULT_CONFIG = {
    "host": "127.0.0.1",
    "port": 8000,
    "debug": False,
    "cors_enabled": False,  # Not needed for unified server but kept for backward compatibility
    "cors_origins": "*",
    "https_enabled": False,
    "cert_file": None,
    "key_file": None,
    "data_dir": "data",
    "static_dir": None,  # Will default to project root directory
    "log_file": "annzarro_server.log",
    "log_level": "INFO",
    "auth_enabled": False,
    "user_file": "users.json",
    "unified_server": True,  # New flag to indicate we're using the unified server approach
    "max_response_elements": 1000000,  # Maximum number of elements in array responses
    "max_cells_per_request": 10000,    # Maximum number of cells in a single request
    "max_genes_per_request": 10000,    # Maximum number of genes in a single request
    "max_embedding_dims": 50,          # Maximum number of dimensions in embedding requests
    "secret_key": "change-this-in-production"  # Secret key for sessions
}

def require_auth(f):
    """
    Decorator for routes that require authentication.
    
    Args:
        f: Function to decorate
        
    Returns:
        Decorated function
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Check if auth is enabled in the application config
        if not current_app.config.get("auth_enabled", False):
            return f(*args, **kwargs)
            
        # Check if user is logged in (in session)
        if "user_id" not in session:
            # For API routes, return 401 Unauthorized
            if request.path.startswith("/api/"):
                return jsonify({"error": "Authentication required"}), 401
            # For UI routes, redirect to login page
            return redirect("/login")
            
        # User is authenticated, proceed with the original function
        return f(*args, **kwargs)
    return decorated_function

def create_app(config: Dict[str, Any] = None) -> Flask:
    """
    Create and configure the Flask application.
    
    Args:
        config: Optional configuration dictionary to override defaults
        
    Returns:
        Configured Flask application
    """
    # Create Flask app
    app = Flask(__name__)
    
    # Enable CORS by default for all routes - important during development
    CORS(app)
    
    # Set default configuration
    app.config.update(DEFAULT_CONFIG)
    
    # Check environment variables before applying provided config
    if os.environ.get("ANNZARRO_HOST"):
        app.config["host"] = os.environ.get("ANNZARRO_HOST")
    
    if os.environ.get("ANNZARRO_PORT"):
        try:
            app.config["port"] = int(os.environ.get("ANNZARRO_PORT"))
        except ValueError:
            logger.warning(f"Invalid port in environment variable: {os.environ.get('ANNZARRO_PORT')}")
    
    if os.environ.get("ANNZARRO_DATA_DIR"):
        app.config["data_dir"] = os.environ.get("ANNZARRO_DATA_DIR")
    
    if os.environ.get("ANNZARRO_STATIC_DIR"):
        app.config["static_dir"] = os.environ.get("ANNZARRO_STATIC_DIR")
    
    if os.environ.get("ANNZARRO_DEBUG"):
        app.config["debug"] = os.environ.get("ANNZARRO_DEBUG").lower() in ("true", "1", "yes")
        
    if os.environ.get("ANNZARRO_AUTH_ENABLED"):
        app.config["auth_enabled"] = os.environ.get("ANNZARRO_AUTH_ENABLED").lower() in ("true", "1", "yes")
        
    if os.environ.get("ANNZARRO_SECRET_KEY"):
        app.config["secret_key"] = os.environ.get("ANNZARRO_SECRET_KEY")
    
    # Update with provided config if any (allowing it to override environment variables)
    if config:
        app.config.update(config)
    
    # Configure the app
    configure_app(app, app.config)
    
    # Setup logging
    setup_logging(app.config)
    
    # Set up authentication if enabled
    if app.config.get("auth_enabled", False):
        # Set up Flask session secret key
        app.secret_key = app.config.get("secret_key", os.urandom(24))
        
        # Import after app is created to avoid circular imports
        from annzarro.server.auth import AuthManager
        
        # Create auth manager
        user_file = app.config.get("user_file", "users.json")
        auth_manager = AuthManager(user_file=user_file)
        
        # Store auth manager in app for access in routes
        app.auth_manager = auth_manager
        
        logger.info(f"Authentication enabled, using user file: {user_file}")
    
    # Set up routes
    register_routes(app)
    
    return app

def configure_app(app: Flask, config: Dict[str, Any]) -> None:
    """
    Configure the Flask app with the given config.
    
    Args:
        app: Flask application instance
        config: Configuration dictionary
    """
    # Enable CORS if configured
    if config.get("cors_enabled", False):
        CORS(app, resources={r"/api/*": {"origins": config.get("cors_origins", "*")}})
    
    # Enable proxy fix if needed
    if config.get("proxy_count", 0) > 0:
        app.wsgi_app = ProxyFix(
            app.wsgi_app,
            x_for=config.get("proxy_count", 0),
            x_proto=config.get("proxy_count", 0),
            x_host=config.get("proxy_count", 0)
        )

def setup_logging(config: Dict[str, Any]) -> None:
    """
    Set up logging configuration.
    
    Args:
        config: Configuration dictionary
    """
    log_file = config.get("log_file", "annzarro_server.log")
    log_level_str = config.get("log_level", "INFO")
    
    # Convert string log level to numeric value
    log_level = getattr(logging, log_level_str.upper(), logging.INFO)
    
    # Create logs directory if it doesn't exist
    log_dir = os.path.dirname(log_file)
    if log_dir and not os.path.exists(log_dir):
        os.makedirs(log_dir)
    
    # Configure logging
    logging.basicConfig(
        filename=log_file,
        level=log_level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )
    
    # Add console handler
    console = logging.StreamHandler()
    console.setLevel(log_level)
    console.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s"))
    logging.getLogger("").addHandler(console)

def register_routes(app: Flask) -> None:
    """
    Register all routes with the Flask app.
    
    Args:
        app: Flask application instance
    """
    # Import route modules here to avoid circular imports
    from annzarro.server.routes import (
        register_core_routes,
        register_data_routes,
        register_zarr_routes, 
        register_static_routes
    )
    
    # API version
    api_version = "v1"
    
    # Register routes from each module
    register_core_routes(app, api_version)
    register_data_routes(app, api_version)
    register_zarr_routes(app, api_version)
    register_static_routes(app, api_version)
    
    # Register authentication routes if auth is enabled
    if app.config.get("auth_enabled", False):
        register_auth_routes(app, api_version)
    
    logger.info(f"Registered all routes for API version {api_version}")
    
def register_auth_routes(app: Flask, api_version: str) -> None:
    """
    Register authentication routes with the Flask app.
    
    Args:
        app: Flask application instance
        api_version: API version string
    """
    @app.route("/login", methods=["GET"])
    def login_page():
        """Login page"""
        login_html = """
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Annzarro Login</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                    background-color: #f5f5f5;
                    margin: 0;
                    padding: 0;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                }
                .login-container {
                    background-color: white;
                    border-radius: 8px;
                    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
                    padding: 40px;
                    width: 100%;
                    max-width: 400px;
                }
                h1 {
                    margin-top: 0;
                    color: #333;
                    font-size: 24px;
                    margin-bottom: 20px;
                }
                .form-group {
                    margin-bottom: 20px;
                }
                label {
                    display: block;
                    margin-bottom: 8px;
                    font-weight: 500;
                    color: #333;
                }
                input {
                    width: 100%;
                    padding: 10px;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                    font-size: 16px;
                    box-sizing: border-box;
                }
                button {
                    background-color: #4285f4;
                    color: white;
                    border: none;
                    padding: 12px 20px;
                    border-radius: 4px;
                    font-size: 16px;
                    cursor: pointer;
                    width: 100%;
                    font-weight: 500;
                }
                button:hover {
                    background-color: #3b78e7;
                }
                .error-message {
                    color: #d32f2f;
                    margin-bottom: 20px;
                    font-size: 14px;
                }
                .logo {
                    text-align: center;
                    margin-bottom: 20px;
                }
                .logo img {
                    height: 60px;
                }
            </style>
        </head>
        <body>
            <div class="login-container">
                <div class="logo">
                    <h2>Annzarro</h2>
                </div>
                <h1>Sign in</h1>
                <form action="/login" method="POST">
                    <div class="form-group">
                        <label for="username">Username</label>
                        <input type="text" id="username" name="username" required autofocus>
                    </div>
                    <div class="form-group">
                        <label for="password">Password</label>
                        <input type="password" id="password" name="password" required>
                    </div>
                    <button type="submit">Sign in</button>
                </form>
            </div>
        </body>
        </html>
        """
        return login_html
    
    @app.route("/login", methods=["POST"])
    def login():
        """Handle login POST request"""
        username = request.form.get("username")
        password = request.form.get("password")
        
        # Validate credentials using auth manager
        if app.auth_manager.authenticate(username, password):
            # Set session variables
            session["user_id"] = username
            session["is_admin"] = app.auth_manager.get_user(username).is_admin
            session["last_activity"] = time.time()
            
            # Create authentication token
            token = app.auth_manager.create_token(username)
            
            # Redirect to home page
            return redirect("/")
        else:
            # Return login page with error
            login_html_with_error = """
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Annzarro Login</title>
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                        background-color: #f5f5f5;
                        margin: 0;
                        padding: 0;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                    }
                    .login-container {
                        background-color: white;
                        border-radius: 8px;
                        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
                        padding: 40px;
                        width: 100%;
                        max-width: 400px;
                    }
                    h1 {
                        margin-top: 0;
                        color: #333;
                        font-size: 24px;
                        margin-bottom: 20px;
                    }
                    .form-group {
                        margin-bottom: 20px;
                    }
                    label {
                        display: block;
                        margin-bottom: 8px;
                        font-weight: 500;
                        color: #333;
                    }
                    input {
                        width: 100%;
                        padding: 10px;
                        border: 1px solid #ddd;
                        border-radius: 4px;
                        font-size: 16px;
                        box-sizing: border-box;
                    }
                    button {
                        background-color: #4285f4;
                        color: white;
                        border: none;
                        padding: 12px 20px;
                        border-radius: 4px;
                        font-size: 16px;
                        cursor: pointer;
                        width: 100%;
                        font-weight: 500;
                    }
                    button:hover {
                        background-color: #3b78e7;
                    }
                    .error-message {
                        color: #d32f2f;
                        margin-bottom: 20px;
                        font-size: 14px;
                    }
                    .logo {
                        text-align: center;
                        margin-bottom: 20px;
                    }
                    .logo img {
                        height: 60px;
                    }
                </style>
            </head>
            <body>
                <div class="login-container">
                    <div class="logo">
                        <h2>Annzarro</h2>
                    </div>
                    <h1>Sign in</h1>
                    <div class="error-message">Invalid username or password. Please try again.</div>
                    <form action="/login" method="POST">
                        <div class="form-group">
                            <label for="username">Username</label>
                            <input type="text" id="username" name="username" required autofocus>
                        </div>
                        <div class="form-group">
                            <label for="password">Password</label>
                            <input type="password" id="password" name="password" required>
                        </div>
                        <button type="submit">Sign in</button>
                    </form>
                </div>
            </body>
            </html>
            """
            return login_html_with_error
    
    @app.route("/logout", methods=["GET"])
    def logout():
        """Handle logout request"""
        # Clear session
        session.clear()
        # Redirect to login page
        return redirect("/login")
    
    @app.route(f"/api/{api_version}/auth/token", methods=["POST"])
    def get_auth_token():
        """API endpoint to get an authentication token"""
        username = request.json.get("username")
        password = request.json.get("password")
        
        # Validate credentials using auth manager
        if app.auth_manager.authenticate(username, password):
            # Create authentication token
            token = app.auth_manager.create_token(username)
            return jsonify({"token": token})
        else:
            return jsonify({"error": "Invalid credentials"}), 401
    
    # Apply the require_auth decorator to all appropriate routes
    for endpoint in [rule.endpoint for rule in app.url_map.iter_rules()]:
        if not endpoint.startswith("login") and not endpoint.startswith("logout") and not endpoint.startswith("static"):
            view_func = app.view_functions[endpoint]
            app.view_functions[endpoint] = require_auth(view_func)
    
    logger.info("Registered authentication routes")

def load_config_from_file(config_file: str) -> Dict[str, Any]:
    """
    Load configuration from a JSON file.
    
    Args:
        config_file: Path to the configuration file
        
    Returns:
        Configuration dictionary
    """
    try:
        with open(config_file, 'r') as f:
            config = json.load(f)
        return config
    except Exception as e:
        logger.error(f"Error loading config file {config_file}: {e}")
        return {}
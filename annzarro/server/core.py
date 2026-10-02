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
from urllib.parse import quote, urlsplit

from flask import Flask, request, jsonify, session, redirect, url_for, current_app, render_template
from ..utils.json_utils import NumpyJSONEncoder
from flask_cors import CORS
from flask.sessions import SecureCookieSessionInterface
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
    "static_dir": None,  # None = the frontend static directory (paths.frontend_dir)
    "log_file": None,  # None = ~/.annzarro/logs/annzarro_server.log
    "log_level": "INFO",
    "auth_enabled": False,
    "user_file": "users.json",
    "unified_server": True,  # New flag to indicate we're using the unified server approach
    "max_response_elements": 1000000,  # Maximum number of elements in array responses
    "max_cells_per_request": 10000,    # Maximum number of cells in a single request
    "max_genes_per_request": 10000,    # Maximum number of genes in a single request
    "max_embedding_dims": 50,          # Maximum number of dimensions in embedding requests
    "secret_key": None,                # Login cookie key; None = generated and stored beside user_file
    "cache_memory_mb": 1000,           # Maximum memory in MB for backend caching
    "cache_enabled": True,             # Whether to enable backend caching
    "cache_dataset_limit": 10,         # Maximum number of datasets to keep in memory
    "remote_stores": "auto",           # auto | allow | deny -- s3://, gs://, http(s):// datasets
    "remote_allowlist": [],            # URL prefixes remote datasets must start with
    "remote_credentials": "anonymous", # anonymous | environment (AWS/GCP credential chain)
    "remote_connect_timeout_s": 10,    # seconds to connect to a remote store
    "remote_read_timeout_s": 30,       # seconds between bytes before a 504
    "remote_chunk_cache_mb": 256,      # raw-bytes LRU per open remote store; 0 = off
    "app_name": "Annzarro",            # Application name shown on login page
    "project_description": "Zarr-based AnnData Visualization Tool",  # Project description shown on login page
    "contact_info": {                  # Contact information shown on login page
        "email": None,                 # Contact email address
        "lab_name": None,              # Name of the lab or organization
        "lab_url": None,               # Lab/organization website URL
        "custom_html": None            # Custom HTML content for additional contact info
    }
}

#: Default seconds of inactivity before a login expires (auth.session_timeout).
DEFAULT_SESSION_TIMEOUT = 8 * 3600


def is_logged_in() -> bool:
    """Whether the current request carries a live login session.

    A session idle for longer than ``session_timeout`` seconds (0 = never)
    is cleared. The idle clock lives in the signed cookie, so it cannot be
    reset by the client; it is refreshed at most once a minute to avoid
    re-sending the cookie on every request.
    """
    if "user_id" not in session:
        return False
    timeout = current_app.config.get("session_timeout", DEFAULT_SESSION_TIMEOUT)
    now = time.time()
    try:
        last = float(session.get("last_activity", 0))
    except (TypeError, ValueError):
        last = 0.0
    if timeout and now - last > float(timeout):
        logger.info(f"Login session of {session.get('user_id')!r} expired after {timeout}s idle")
        session.clear()
        return False
    # A removed user, or a login from before a password change, no longer counts
    manager = getattr(current_app, "auth_manager", None)
    if manager is not None and not manager.session_is_current(
            session["user_id"], session.get("login_at", 0)):
        logger.info(f"Login session of {session.get('user_id')!r} revoked "
                    "(user removed or password changed)")
        session.clear()
        return False
    if now - last > 60:
        session["last_activity"] = now
    return True


def safe_next(target: Optional[str]) -> str:
    """``target`` if it is a path on this server, else ``/``.

    Only a relative path that starts with a single ``/`` is accepted, so a
    crafted ``/login?next=//evil.example`` or ``next=https://...`` cannot send
    a user who just signed in to another site.
    """
    if not target or not isinstance(target, str):
        return "/"
    if any(c in target for c in "\r\n\\") or any(ord(c) < 0x20 for c in target):
        return "/"
    if not target.startswith("/") or target.startswith("//"):
        return "/"
    parts = urlsplit(target)
    if parts.scheme or parts.netloc:
        return "/"
    if parts.path.startswith("/login") or parts.path.startswith("/logout"):
        return "/"
    return target


def safe_fragment(fragment: Optional[str]) -> str:
    """A URL fragment (``#view=...``) to re-attach after login, or ``""``."""
    if not fragment or not isinstance(fragment, str):
        return ""
    fragment = fragment.lstrip("#")
    if not fragment or any(ord(c) < 0x20 for c in fragment):
        return ""
    return "#" + fragment


def login_required_response():
    """What a request that needs login gets without one: 401 for the API,
    a redirect to the login page for everything else.

    The redirect carries the page asked for (path and query) as ``next``, so
    a shared link survives signing in. Its ``#view=`` fragment never reaches
    the server; the browser keeps it across this redirect and the login page
    posts it back (see templates/login.html).
    """
    if request.path.startswith("/api/"):
        return jsonify({"error": "Authentication required"}), 401
    target = request.full_path.rstrip("?") if request.query_string else request.path
    if safe_next(target) == "/":
        return redirect("/login")
    return redirect("/login?next=" + quote(target, safe="/"))


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
        from flask import current_app
        
        # Check if auth is enabled in the application config
        if not current_app.config.get("auth_enabled", False):
            logger.debug(f"Auth disabled in config, allowing access to {request.path}")
            return f(*args, **kwargs)
            
        # Check if user is logged in (in session)
        if not is_logged_in():
            logger.warning(f"Unauthenticated access attempt to {request.path}")
            return login_required_response()
            
        # User is authenticated, proceed with the original function
        logger.debug(f"Authenticated access to {request.path} by {session['user_id']}")
        return f(*args, **kwargs)
    return decorated_function

class _LoginCookieInterface(SecureCookieSessionInterface):
    """Flask's signed-cookie sessions with ``cookie_secure: auto``: the login
    cookie is marked Secure exactly when the request came over HTTPS (as
    reported by the trusted proxies, see ``proxy_count``)."""

    def get_cookie_secure(self, app):
        mode = app.config.get("cookie_secure", "auto")
        if isinstance(mode, str) and mode.strip().lower() == "auto":
            return request.is_secure
        if isinstance(mode, str):
            return mode.strip().lower() in ("true", "yes", "1", "on")
        return bool(mode)


def create_app(config: Dict[str, Any] = None) -> Flask:
    """
    Create and configure the Flask application.
    
    Args:
        config: Optional configuration dictionary to override defaults
        
    Returns:
        Configured Flask application
    """
    # Create Flask app with custom template folder
    from annzarro.utils.paths import frontend_dir
    template_folder = str(frontend_dir("templates"))
    
    # Check for static folder with favicon
    static_folder = str(frontend_dir("static"))
    if os.path.exists(static_folder) and (
        os.path.exists(os.path.join(static_folder, "favicon.ico")) or
        os.path.exists(os.path.join(static_folder, "favicon.png"))
    ):
        app = Flask(__name__, template_folder=template_folder, static_folder=static_folder)
        logger.info(f"Using static folder at {static_folder}")
    else:
        app = Flask(__name__, template_folder=template_folder)
    
    # Set custom JSON encoder that handles NaN values
    app.json_encoder = NumpyJSONEncoder
    logger.info("Using custom JSON encoder to handle NaN/Infinity values")
    
    # CORS is configured in configure_app() from cors_enabled/cors_origins
    # (off by default). An unconditional CORS(app) here used to answer every
    # route with Access-Control-Allow-Origin: *, whatever the configuration.

    # Apply configuration
    if config and isinstance(config, dict):
        config_copy = dict(config)
        # Remove the marker if it exists before adding to Flask config
        if "__using_config_manager" in config_copy:
            del config_copy["__using_config_manager"]
        app.config.update(config_copy)
        logger.info("Using configuration from configuration manager")
    else:
        # Fallback if no config was provided
        logger.warning("No configuration provided, using default configuration")
        app.config.update(DEFAULT_CONFIG)
    
    # Login cookie: not sent on cross-site subrequests or form posts (Lax),
    # Secure per cookie_secure, never readable from JavaScript.
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    app.session_interface = _LoginCookieInterface()

    # Configure the app
    configure_app(app, app.config)
    
    # Setup logging
    setup_logging(app.config)
    warn_about_exposure(app.config)
    
    # A shared server only opens paths inside its data directory (see confinement.py)
    from annzarro.server import confinement
    confinement.warn_about_escaping_links(app.config)
    app.before_request(confinement.enforce)

    # Initialize zarr reader with cache settings from config
    from annzarro.core import configure_zarr_reader, configure_h5ad_reader
    configure_zarr_reader(app.config)
    logger.info(f"Zarr reader configured with: cache_memory_mb={app.config.get('cache_memory_mb')}, "
               f"cache_enabled={app.config.get('cache_enabled')}, "
               f"cache_dataset_limit={app.config.get('cache_dataset_limit')}")

    # Initialize h5ad reader with cache settings from config
    configure_h5ad_reader(app.config)
    logger.info(f"H5AD reader configured with: cache_memory_mb={app.config.get('cache_memory_mb')}, "
               f"cache_enabled={app.config.get('cache_enabled')}, "
               f"cache_dataset_limit={app.config.get('cache_dataset_limit')}")
    
    # Decide whether this server may open remote (s3/gs/http) datasets. This
    # must see the final auth/host/proxy settings, so it runs after config.
    from annzarro.core.remote import configure_remote_policy
    configure_remote_policy(app.config)

    # Set up authentication if enabled
    if app.config.get("auth_enabled", False):
        # Import after app is created to avoid circular imports
        from annzarro.server.auth import AuthManager, resolve_user_file
        from annzarro.server.secret_key import resolve_secret_key
        
        # Create auth manager with proper path handling
        user_file = app.config.get("user_file", "users.json")
        
        # Sign login cookies with a key nobody else has: the configured one
        # unless it is a shipped placeholder, else one generated and kept
        # beside the users file (see secret_key.py)
        app.secret_key = resolve_secret_key(app.config.get("secret_key"),
                                            resolve_user_file(user_file))

        auth_manager = AuthManager(user_file=user_file)
        
        # Store auth manager in app for access in routes
        app.auth_manager = auth_manager
    
    # Set up routes
    register_routes(app)
    
    return app

def _exposure_where(config: Dict[str, Any]) -> str:
    """How we know the server is shared, for the warning text."""
    if config.get("hosted") is not None:
        return "server.hosted is set"
    return f"listening on {config.get('host')}"


def warn_about_exposure(config: Dict[str, Any]) -> None:
    """Say loudly, at startup, when the server is reachable by people it can't tell apart.

    Listening beyond localhost with login disabled looks fine from the
    outside and is not: anyone who can reach the port can edit or delete
    every shared panel set. It is logged at WARNING inside a banner, because
    an INFO line in a scrolling log is exactly how a deployment ran
    unprotected unnoticed. (A placeholder ``secret_key`` is no longer a
    risk to warn about: it is never used, see ``secret_key.py``.)
    """
    from .permissions import is_exposed

    problems = []
    if is_exposed(config):
        problems.append(
            f"Serving as a shared server ({_exposure_where(config)}) with login "
            "DISABLED. Anyone who can "
            "reach this port can open every dataset under the data directory "
            "and edit or delete every shared panel set. Remove --auth-disabled / "
            "ANNZARRO_AUTH_DISABLED and add users with `annzarro user add`, or "
            "bind to 127.0.0.1."
        )
    if not problems:
        return
    bar = "!" * 78
    logger.warning(bar)
    for problem in problems:
        logger.warning("SECURITY: %s", problem)
    logger.warning(bar)


def configure_app(app: Flask, config: Dict[str, Any]) -> None:
    """
    Configure the Flask app with the given config.
    
    Args:
        app: Flask application instance
        config: Configuration dictionary
    """
    # Cross-origin API access only when configured. Never with credentials:
    # the login cookie must not authorize requests from other sites.
    if config.get("cors_enabled", False):
        CORS(app, resources={r"/api/*": {"origins": config.get("cors_origins", "*")}},
             supports_credentials=False)
    
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
    from annzarro.utils.paths import default_log_file
    log_file = str(config.get("log_file") or default_log_file())
    log_level_str = config.get("log_level", "INFO")
    
    # Convert string log level to numeric value
    log_level = getattr(logging, log_level_str.upper(), logging.INFO)
    
    # Create logs directory if it doesn't exist
    log_dir = os.path.dirname(log_file)
    if log_dir:
        os.makedirs(log_dir, exist_ok=True)
    
    # Reset the root logger to avoid duplicate handlers
    root_logger = logging.getLogger("")
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)
    
    # Create a formatter
    formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s", 
                                 datefmt="%Y-%m-%d %H:%M:%S")
    
    # File handler
    file_handler = logging.FileHandler(log_file)
    file_handler.setLevel(log_level)
    file_handler.setFormatter(formatter)
    
    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setLevel(log_level)
    console_handler.setFormatter(formatter)
    
    # Configure root logger
    root_logger.setLevel(log_level)
    root_logger.addHandler(file_handler)
    root_logger.addHandler(console_handler)
    
    # Reduce verbosity of Flask and Werkzeug loggers
    logging.getLogger("werkzeug").setLevel(logging.WARNING)
    logging.getLogger("flask").setLevel(logging.WARNING)

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
    def render_login(**extra):
        return render_template(
            "login.html",
            app_name=app.config.get("app_name", "AnnZarro"),
            project_description=app.config.get("project_description", ""),
            contact_info=app.config.get("contact_info", {}),
            **extra
        )

    @app.route("/login", methods=["GET"])
    def login_page():
        """Login page"""
        return render_login(next_url=safe_next(request.args.get("next")), fragment="")
    
    @app.route("/login", methods=["POST"])
    def login():
        """Handle login POST request"""
        username = request.form.get("username")
        password = request.form.get("password")
        next_url = safe_next(request.form.get("next"))
        fragment = safe_fragment(request.form.get("fragment"))
        
        # Validate credentials using auth manager
        if app.auth_manager.authenticate(username, password):
            # A fresh session: nothing from before login carries over
            session.clear()
            session["user_id"] = username
            session["is_admin"] = app.auth_manager.get_user(username).is_admin
            session["last_activity"] = session["login_at"] = time.time()
            
            # Back to the page that asked for login, view included
            return redirect(next_url + fragment)
        else:
            # Return login page with error, keeping where to go afterwards
            return render_login(
                next_url=next_url,
                fragment=fragment,
                error="Invalid username or password. Please try again."
            )
    
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
    Load configuration from a JSON file or dictionary.
    
    Args:
        config_file: Path to the configuration file or configuration dictionary
        
    Returns:
        Configuration dictionary
    """
    # Handle dictionary input
    if isinstance(config_file, dict):
        config_copy = dict(config_file)
        # Remove the marker if it exists
        if "__using_config_manager" in config_copy:
            del config_copy["__using_config_manager"]
        return config_copy
        
    # Load from file if it's a string path
    try:
        with open(config_file, 'r') as f:
            # Determine file format by extension
            if config_file.endswith(('.yaml', '.yml')):
                import yaml
                config = yaml.safe_load(f)
            else:
                config = json.load(f)
        return config
    except Exception as e:
        logger.error(f"Error loading config file {config_file}: {e}")
        return {}
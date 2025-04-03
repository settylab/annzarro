#!/usr/bin/env python3
"""
Annzarro Server
--------------
A production-ready web server for serving Annzarro applications.
Features:
- Strong authentication
- HTTPS support
- Rate limiting
- CSRF protection
- Configurable for high-demand scenarios
"""

import os
import sys
import base64
import logging
import secrets
import socket
import hashlib
import argparse
import time
from urllib.parse import parse_qs, urlparse
from functools import wraps
from pathlib import Path

try:
    from flask import Flask, request, send_from_directory, jsonify, Response
    from flask import session, render_template_string, redirect, url_for
    from flask_limiter import Limiter
    from flask_limiter.util import get_remote_address
    from flask_cors import CORS
    from werkzeug.middleware.proxy_fix import ProxyFix
    from werkzeug.security import generate_password_hash, check_password_hash
except ImportError:
    print("Error: Required packages not installed. Please run:")
    print("pip install flask flask-limiter flask-cors werkzeug")
    sys.exit(1)

# Import the auth module
from auth import AuthManager, User, TOKEN_EXPIRY_HOURS

# Base directory for the application
BASE_DIR = Path(__file__).resolve().parent.parent

class AnnzarroServer:
    """
    Main server class for Annzarro application
    """
    def __init__(self, config):
        """
        Initialize the server with the provided configuration
        
        Args:
            config (dict): Server configuration
        """
        self.config = config
        self.app = Flask(__name__, 
                        static_folder=str(BASE_DIR),
                        static_url_path='')
        
        # Set up CORS if enabled
        if config.get('cors_enabled', False):
            CORS(self.app)
            
        # Configure app
        self.configure_app()
        
        # Set up auth manager
        self.auth_manager = AuthManager(
            user_file=config.get('user_file'),
            token_secret=config.get('token_secret') or secrets.token_hex(32),
            session_timeout=config.get('session_timeout', 3600)
        )
        
        # Set up rate limiting
        self.limiter = Limiter(
            get_remote_address,
            app=self.app,
            default_limits=config.get('rate_limits', ["60 per minute", "5 per second"]),
            storage_uri=config.get('rate_limit_storage', "memory://")
        )
        
        # Register routes
        self.register_routes()
        
        # Set up logging
        self.setup_logging()
    
    def configure_app(self):
        """Configure Flask application"""
        # Generate a secure secret key for sessions if not provided
        self.app.config['SECRET_KEY'] = self.config.get('secret_key', secrets.token_hex(32))
        
        # Set max upload size (100 MB by default)
        self.app.config['MAX_CONTENT_LENGTH'] = self.config.get('max_upload_size', 100) * 1024 * 1024
        
        # Session configuration
        self.app.config['SESSION_COOKIE_SECURE'] = self.config.get('https_enabled', True)
        self.app.config['SESSION_COOKIE_HTTPONLY'] = True
        self.app.config['SESSION_COOKIE_SAMESITE'] = 'Strict'
        self.app.config['PERMANENT_SESSION_LIFETIME'] = self.config.get('session_timeout', 3600)
        
        # Configure proxy settings if behind a reverse proxy
        if self.config.get('behind_proxy', False):
            self.app.wsgi_app = ProxyFix(
                self.app.wsgi_app, 
                x_for=self.config.get('proxy_x_for', 1),
                x_proto=self.config.get('proxy_x_proto', 1),
                x_host=self.config.get('proxy_x_host', 1)
            )
    
    def setup_logging(self):
        """Configure logging"""
        log_file = self.config.get('log_file', 'annzarro_server.log')
        log_level = getattr(logging, self.config.get('log_level', 'INFO'))
        
        logging.basicConfig(
            level=log_level,
            format='%(asctime)s [%(levelname)s] %(message)s',
            handlers=[
                logging.FileHandler(log_file),
                logging.StreamHandler(sys.stdout)
            ]
        )
    
    def login_required(self, f):
        """Decorator to require login for routes"""
        @wraps(f)
        def decorated_function(*args, **kwargs):
            # Check for API token in header
            auth_header = request.headers.get('Authorization')
            if auth_header and auth_header.startswith('Bearer '):
                token = auth_header.split(' ')[1]
                if self.auth_manager.validate_token(token):
                    # Valid token, proceed
                    return f(*args, **kwargs)
            
            # Check if user is logged in via session
            if 'user_id' in session and self.auth_manager.validate_session():
                # User is logged in, proceed
                return f(*args, **kwargs)
                
            # Not authenticated
            if request.headers.get('Accept') == 'application/json':
                return jsonify({"error": "Authentication required"}), 401
            
            # Redirect to login page
            return redirect(f"/login?next={request.path}")
        
        return decorated_function
    
    def register_routes(self):
        """Register all application routes"""
        app = self.app
        
        # Home page
        @app.route('/')
        @self.login_required
        def index():
            return send_from_directory(str(BASE_DIR), 'index.html')
        
        # Login page
        @app.route('/login', methods=['GET', 'POST'])
        @self.limiter.limit("10 per minute")
        def login():
            if request.method == 'POST':
                username = request.form.get('username')
                password = request.form.get('password')
                
                if self.auth_manager.authenticate(username, password):
                    # Create session
                    user = self.auth_manager.get_user(username)
                    session['user_id'] = user.id
                    session['username'] = user.username
                    session['last_activity'] = time.time()
                    
                    # Set up CSRF token
                    session['csrf_token'] = secrets.token_hex(16)
                    
                    # Redirect to next page or home
                    next_page = request.args.get('next', '/')
                    return redirect(next_page)
                
                # Failed login
                error_message = "Invalid username or password"
                return self.render_login_page(error=error_message)
            
            # GET request, show login form
            return self.render_login_page()
        
        # API token generation
        @app.route('/api/token', methods=['POST'])
        @self.login_required
        @self.limiter.limit("5 per minute")
        def get_token():
            if not request.is_json:
                return jsonify({"error": "Missing JSON"}), 400
            
            # Check CSRF token
            csrf_token = request.json.get('csrf_token')
            if csrf_token != session.get('csrf_token'):
                return jsonify({"error": "Invalid CSRF token"}), 403
            
            # Generate a new token
            username = session.get('username')
            token = self.auth_manager.create_token(username)
            
            return jsonify({
                "token": token,
                "expires_in": TOKEN_EXPIRY_HOURS * 3600,
                "token_type": "Bearer"
            })
        
        # Logout
        @app.route('/logout')
        def logout():
            # Clear session
            session.clear()
            return redirect('/login')
        
        # Static file serving
        @app.route('/<path:filename>')
        @self.login_required
        def serve_static(filename):
            return send_from_directory(str(BASE_DIR), filename)
        
        # Health check endpoint
        @app.route('/health')
        def health_check():
            return jsonify({
                "status": "ok",
                "timestamp": time.time()
            })
    
    def render_login_page(self, error=None):
        """Render the login page"""
        login_html = """
        <!DOCTYPE html>
        <html>
        <head>
            <title>Annzarro - Login</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body {
                    font-family: Arial, sans-serif;
                    margin: 0;
                    padding: 20px;
                    background-color: #f5f5f5;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                }
                .auth-container {
                    background-color: white;
                    border-radius: 8px;
                    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
                    padding: 30px;
                    max-width: 400px;
                    width: 100%;
                }
                h1 {
                    color: #333;
                    margin-top: 0;
                    font-size: 24px;
                }
                .form-group {
                    margin-bottom: 20px;
                }
                label {
                    display: block;
                    margin-bottom: 8px;
                    font-weight: bold;
                }
                input[type="text"],
                input[type="password"] {
                    width: 100%;
                    padding: 10px;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                    font-size: 16px;
                }
                button {
                    background-color: #4CAF50;
                    color: white;
                    border: none;
                    padding: 10px 15px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 16px;
                }
                button:hover {
                    background-color: #45a049;
                }
                .error {
                    color: red;
                    margin-bottom: 15px;
                }
            </style>
        </head>
        <body>
            <div class="auth-container">
                <h1>Annzarro Authentication</h1>
                <p>Please log in to access the application.</p>
                {% if error %}
                <div class="error">{{ error }}</div>
                {% endif %}
                <form id="loginForm" method="POST" action="/login{% if request.args.get('next') %}?next={{ request.args.get('next') }}{% endif %}">
                    <div class="form-group">
                        <label for="username">Username:</label>
                        <input type="text" id="username" name="username" required autofocus>
                    </div>
                    <div class="form-group">
                        <label for="password">Password:</label>
                        <input type="password" id="password" name="password" required>
                    </div>
                    <button type="submit">Login</button>
                </form>
            </div>
        </body>
        </html>
        """
        return render_template_string(login_html, error=error, request=request)
    
    def run(self):
        """Run the server"""
        ssl_context = None
        if self.config.get('https_enabled', True):
            cert_file = self.config.get('cert_file')
            key_file = self.config.get('key_file')
            
            if cert_file and key_file and os.path.exists(cert_file) and os.path.exists(key_file):
                ssl_context = (cert_file, key_file)
            else:
                # Create a self-signed certificate if files don't exist
                logging.warning("SSL certificate files not found. Creating self-signed certificate.")
                try:
                    from OpenSSL import crypto
                    from cryptography.hazmat.primitives import serialization
                    self._create_self_signed_cert()
                    ssl_context = ('server.crt', 'server.key')
                except ImportError:
                    logging.error("Could not create self-signed certificate. Install pyOpenSSL and cryptography.")
                    ssl_context = 'adhoc'  # Use Flask's built-in adhoc certs
        
        # Print server information
        host = self.config.get('host', '0.0.0.0')
        port = self.config.get('port', 8000)
        
        protocol = "https" if ssl_context else "http"
        local_url = f"{protocol}://localhost:{port}"
        
        print("\n" + "="*70)
        print(f"🚀 Annzarro server starting on {host}:{port}")
        print(f"📊 Access URLs:")
        print(f"   - Local access: {local_url}")
        
        try:
            hostname = socket.gethostname()
            ip_address = socket.gethostbyname(hostname)
            print(f"   - Network IP: {protocol}://{ip_address}:{port}")
            print(f"   - Hostname: {protocol}://{hostname}:{port}")
        except Exception:
            pass
            
        print("\n🔐 Authentication:")
        print(f"   - User accounts required")
        if self.config.get('admin_user'):
            print(f"   - Default admin user: {self.config.get('admin_user')}")
            
        print("\n⚙️  Performance:")
        if self.config.get('workers'):
            print(f"   - Running with {self.config.get('workers')} worker processes")
        print(f"   - Rate limiting: {', '.join(self.config.get('rate_limits', ['60 per minute', '5 per second']))}")
        
        print("\n🔒 Security:")
        if ssl_context:
            print(f"   - HTTPS enabled")
        else:
            print(f"   - WARNING: HTTPS disabled, not recommended for production")
        
        print("="*70)
        print("")
        
        # Start the server
        if self.config.get('use_gunicorn', False):
            self._run_with_gunicorn()
        else:
            self.app.run(
                host=host,
                port=port,
                debug=self.config.get('debug', False),
                ssl_context=ssl_context,
                threaded=True
            )
    
    def _run_with_gunicorn(self):
        """Run the server using Gunicorn for production"""
        try:
            import gunicorn.app.base
            
            class GunicornApp(gunicorn.app.base.BaseApplication):
                def __init__(self, app, options=None):
                    self.application = app
                    self.options = options or {}
                    super().__init__()
                
                def load_config(self):
                    for key, value in self.options.items():
                        if key in self.cfg.settings and value is not None:
                            self.cfg.set(key.lower(), value)
                
                def load(self):
                    return self.application
            
            # Configure Gunicorn options
            options = {
                'bind': f"{self.config.get('host', '0.0.0.0')}:{self.config.get('port', 8000)}",
                'workers': self.config.get('workers', os.cpu_count() * 2 + 1),
                'worker_class': 'gthread',
                'threads': self.config.get('threads', 4),
                'timeout': self.config.get('timeout', 30),
                'accesslog': '-',
                'errorlog': '-',
                'loglevel': self.config.get('log_level', 'info').lower(),
                'capture_output': True,
                'preload_app': True,
            }
            
            # Add SSL options if enabled
            if self.config.get('https_enabled', True):
                cert_file = self.config.get('cert_file')
                key_file = self.config.get('key_file')
                
                if cert_file and key_file and os.path.exists(cert_file) and os.path.exists(key_file):
                    options['certfile'] = cert_file
                    options['keyfile'] = key_file
            
            # Start Gunicorn
            GunicornApp(self.app, options).run()
            
        except ImportError:
            logging.error("Gunicorn not installed. Please install it with: pip install gunicorn")
            logging.error("Falling back to Flask development server")
            self.app.run(
                host=self.config.get('host', '0.0.0.0'),
                port=self.config.get('port', 8000),
                debug=self.config.get('debug', False)
            )
    
    def _create_self_signed_cert(self):
        """Create a self-signed certificate for HTTPS"""
        from OpenSSL import crypto
        
        # Create a key pair
        key = crypto.PKey()
        key.generate_key(crypto.TYPE_RSA, 2048)
        
        # Create a self-signed cert
        cert = crypto.X509()
        cert.get_subject().C = "US"
        cert.get_subject().ST = "California"
        cert.get_subject().L = "San Francisco"
        cert.get_subject().O = "Annzarro"
        cert.get_subject().OU = "Development"
        cert.get_subject().CN = socket.gethostname()
        
        cert.set_serial_number(1000)
        cert.gmtime_adj_notBefore(0)
        cert.gmtime_adj_notAfter(10*365*24*60*60)  # 10 years
        cert.set_issuer(cert.get_subject())
        cert.set_pubkey(key)
        cert.sign(key, 'sha256')
        
        # Save certificate and key
        with open('server.crt', 'wb') as f:
            f.write(crypto.dump_certificate(crypto.FILETYPE_PEM, cert))
            
        with open('server.key', 'wb') as f:
            f.write(crypto.dump_privatekey(crypto.FILETYPE_PEM, key))
            
        logging.info("Self-signed certificate created successfully.")

def main():
    """Main function to start the server"""
    parser = argparse.ArgumentParser(description="Annzarro Server")
    parser.add_argument("-c", "--config", type=str, help="Path to configuration file")
    parser.add_argument("-p", "--port", type=int, default=8000, help="Server port")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Server host")
    parser.add_argument("--workers", type=int, help="Number of worker processes")
    parser.add_argument("--user-file", type=str, help="Path to user credentials file")
    parser.add_argument("--log-file", type=str, help="Path to log file")
    parser.add_argument("--https", action="store_true", help="Enable HTTPS")
    parser.add_argument("--cert", type=str, help="Path to SSL certificate")
    parser.add_argument("--key", type=str, help="Path to SSL private key")
    parser.add_argument("--admin-user", type=str, help="Create admin user with this username")
    parser.add_argument("--admin-password", type=str, help="Password for admin user")
    parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    parser.add_argument("--cors", action="store_true", help="Enable CORS")
    parser.add_argument("--gunicorn", action="store_true", help="Use Gunicorn server")
    
    args = parser.parse_args()
    
    # Read config file if provided
    config = {}
    if args.config:
        import json
        try:
            with open(args.config, 'r') as f:
                config = json.load(f)
        except Exception as e:
            print(f"Error reading config file: {e}")
            sys.exit(1)
    
    # Override with command line arguments
    if args.port:
        config['port'] = args.port
    if args.host:
        config['host'] = args.host
    if args.workers:
        config['workers'] = args.workers
    if args.user_file:
        config['user_file'] = args.user_file
    if args.log_file:
        config['log_file'] = args.log_file
    if args.https:
        config['https_enabled'] = True
    if args.cert:
        config['cert_file'] = args.cert
    if args.key:
        config['key_file'] = args.key
    if args.admin_user:
        config['admin_user'] = args.admin_user
    if args.admin_password:
        config['admin_password'] = args.admin_password
    if args.debug:
        config['debug'] = True
    if args.cors:
        config['cors_enabled'] = True
    if args.gunicorn:
        config['use_gunicorn'] = True
    
    # Set default number of workers if not specified
    if 'workers' not in config:
        # Use 2x CPU cores + 1 as a good starting point
        config['workers'] = os.cpu_count() * 2 + 1
    
    # Create server
    server = AnnzarroServer(config)
    
    # Create admin user if requested
    if config.get('admin_user') and config.get('admin_password'):
        username = config['admin_user']
        password = config['admin_password']
        server.auth_manager.create_user(username, password, is_admin=True)
        print(f"Admin user '{username}' created successfully.")
    
    # Start server
    server.run()

if __name__ == "__main__":
    main()
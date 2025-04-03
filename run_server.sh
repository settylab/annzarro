#!/bin/bash

# Annzarro Server Launcher
# This script starts the Annzarro server for hosting the visualization tool
# with appropriate data access capabilities

echo "==============================================================="
echo "Annzarro Server Launcher (Legacy Mode)"
echo "This script launches the server in compatibility mode."
echo "For advanced features, use ./run_annzarro.py instead."
echo "==============================================================="

# Default values
DEFAULT_PORT=8000
DEFAULT_PASSWORD="annzarropass"
TOKEN_LENGTH=16
LOG_FILE="annzarro_server.log"

# Parse command line options
PORT=$DEFAULT_PORT
PASSWORD=$DEFAULT_PASSWORD
ENABLE_PASSWORD=true

function show_help {
    echo "Annzarro Server Launcher (Legacy Mode)"
    echo "Usage: ./run_server.sh [options]"
    echo ""
    echo "Options:"
    echo "  -p, --port PORT         Set server port (default: $DEFAULT_PORT)"
    echo "  -pw, --password PASS    Set authentication password (default: $DEFAULT_PASSWORD)"
    echo "  --no-password           Disable password authentication (not recommended)"
    echo "  -h, --help              Show this help message"
    echo ""
    echo "For advanced features, use the new server architecture:"
    echo "  ./run_annzarro.py --help"
    exit 0
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    key="$1"
    case $key in
        -p|--port)
            PORT="$2"
            shift
            shift
            ;;
        -pw|--password)
            PASSWORD="$2"
            shift
            shift
            ;;
        --no-password)
            ENABLE_PASSWORD=false
            shift
            ;;
        -h|--help)
            show_help
            ;;
        *)
            echo "Unknown option: $1"
            show_help
            ;;
    esac
done

# Check if Python 3 is installed
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
else
    echo "ERROR: Python 3 is required but not found. Please install Python 3."
    exit 1
fi

# Check for new server infrastructure
if [ -f "server/annzarro_server.py" ]; then
    echo "Detected new server infrastructure."
    echo "Creating a temporary compatibility configuration..."
    
    # Create a temporary config file
    CONFIG_FILE=$(mktemp)
    cat > "$CONFIG_FILE" << EOF
{
  "port": $PORT,
  "host": "0.0.0.0",
  "https_enabled": false,
  "user_file": "server/temp_users.json",
  "log_file": "$LOG_FILE",
  "session_timeout": 3600,
  "cors_enabled": false,
  "debug": false
}
EOF
    
    # Create a temporary user for compatibility
    mkdir -p server
    if [ ! -f "server/temp_users.json" ] || [ "$ENABLE_PASSWORD" = true ]; then
        echo "Setting up temporary user authentication..."
        
        cat > server/temp_auth.py << 'EOF'
#!/usr/bin/env python3
import sys
import os
import json
from werkzeug.security import generate_password_hash

# Create user file with default user
username = "annzarro"
password = sys.argv[1]
is_admin = True

user_data = {
    username: {
        "id": "legacy-user-id",
        "username": username,
        "password_hash": generate_password_hash(password),
        "is_admin": is_admin,
        "tokens": {},
        "last_login": None,
        "login_attempts": 0,
        "locked_until": None
    }
}

# Write to user file
with open("server/temp_users.json", "w") as f:
    json.dump(user_data, f, indent=2)

print(f"Created temporary user '{username}' with provided password.")
EOF
        
        # Create the user
        $PYTHON_CMD server/temp_auth.py "$PASSWORD"
    fi
    
    echo "Starting server in compatibility mode..."
    $PYTHON_CMD run_annzarro.py --start --config "$CONFIG_FILE"
    
    # Clean up
    rm -f "$CONFIG_FILE" server/temp_auth.py
    exit 0
fi

# If we get here, fall back to the legacy embedded server

echo "WARNING: Using legacy embedded server. Consider upgrading to the new server architecture."
echo "Run ./setup_server.sh to set up the new server."

# Generate a random access token
TOKEN=$(LC_ALL=C tr -dc 'a-zA-Z0-9' < /dev/urandom | head -c $TOKEN_LENGTH)

# Create a temporary auth file
AUTH_FILE=$(mktemp)
if $ENABLE_PASSWORD; then
    # Check if htpasswd is available
    if command -v htpasswd &> /dev/null; then
        htpasswd -bc "$AUTH_FILE" "annzarro" "$PASSWORD" > /dev/null 2>&1
    else
        # If htpasswd is not available, create a simple password file
        echo "annzarro:$PASSWORD" > "$AUTH_FILE"
    fi
    AUTH_ARG="-P $AUTH_FILE"
    AUTH_MSG="Password authentication is ENABLED (username: annzarro, password: $PASSWORD)"
    PYTHON_PASSWORD_ENABLE="True"
else
    AUTH_ARG=""
    AUTH_MSG="Password authentication is DISABLED"
    PYTHON_PASSWORD_ENABLE="False"
fi

# Create Python server script
SERVER_SCRIPT=$(mktemp)
cat > "$SERVER_SCRIPT" << 'PYTHON_SCRIPT'
#!/usr/bin/env python3
import http.server
import socketserver
import os
import sys
import base64
import hashlib
import time
import re
from urllib.parse import parse_qs, urlparse
import logging

# These variables will be replaced by the shell script
PORT = None
TOKEN = None
AUTH_FILE = None
ENABLE_PASSWORD = None
AUTH_MSG = None

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler("annzarro_server.log"),
        logging.StreamHandler(sys.stdout)
    ]
)

class AnnzarroRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.getcwd(), **kwargs)
        
    def is_valid_token(self, token):
        """Validate token - only allow alphanumeric characters"""
        return bool(token and re.match(r'^[a-zA-Z0-9]+$', token) and token == TOKEN)
    
    def do_GET(self):
        # Parse query parameters to check for token
        query = urlparse(self.path).query
        query_components = parse_qs(query)
        
        # Security check: protect all paths with authentication
        
        # Check token authentication first - only accept token from query parameters
        path_token = query_components.get('token', [''])[0]
        if self.is_valid_token(path_token):
            # If valid token is present in query parameters, allow access without password
            logging.info(f"Access granted via token authentication")
            super().do_GET()
            return
        
        # Special case for login page and favicon
        if self.path == '/login':
            self.send_login_page()
            return
            
        if self.path == '/favicon.ico':
            # Just return 404 for favicon to avoid unnecessary auth checks
            self.send_response(404)
            self.end_headers()
            return
        
        # If password auth is disabled, deny access immediately
        if not ENABLE_PASSWORD:
            logging.info(f"Access denied - password authentication is disabled")
            self.serve_access_denied()
            return
        
        # Check basic auth
        auth_success = self.check_basic_auth()
        if auth_success:
            # Authentication successful
            logging.info(f"Access granted via password authentication")
            super().do_GET()
            return
        
        # If we get here, user is not authenticated 
        logging.info(f"Access denied - authentication failed")
        self.send_login_page(error="Authentication required")
        return
        
    def send_login_page(self, error=None):
        """Send a direct login page without redirects"""
        self.send_response(200)
        self.send_header('Content-type', 'text/html')
        self.end_headers()
        
        # Create login page HTML
        login_page = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>Annzarro - Authentication</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body {{
                    font-family: Arial, sans-serif;
                    margin: 0;
                    padding: 20px;
                    background-color: #f5f5f5;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                }}
                .auth-container {{
                    background-color: white;
                    border-radius: 8px;
                    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
                    padding: 30px;
                    max-width: 400px;
                    width: 100%;
                }}
                h1 {{
                    color: #333;
                    margin-top: 0;
                    font-size: 24px;
                }}
                .form-group {{
                    margin-bottom: 20px;
                }}
                label {{
                    display: block;
                    margin-bottom: 8px;
                    font-weight: bold;
                }}
                input[type="password"] {{
                    width: 100%;
                    padding: 10px;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                    font-size: 16px;
                }}
                button {{
                    background-color: #4CAF50;
                    color: white;
                    border: none;
                    padding: 10px 15px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 16px;
                }}
                button:hover {{
                    background-color: #45a049;
                }}
                .error {{
                    color: red;
                    margin-bottom: 15px;
                }}
                .token-option {{
                    margin-top: 20px;
                    padding-top: 20px;
                    border-top: 1px solid #eee;
                }}
            </style>
        </head>
        <body>
            <div class="auth-container">
                <h1>Annzarro Authentication</h1>
                <p>You must authenticate to access this application.</p>
                {f'<div class="error">{error}</div>' if error else ''}
                <form id="passwordForm" method="POST" action="/login">
                    <div class="form-group">
                        <label for="password">Password:</label>
                        <input type="password" id="password" name="password" required autofocus>
                    </div>
                    <button type="submit">Login</button>
                </form>
                
                <div class="token-option">
                    <p>Or use this secure token URL for direct access:</p>
                    <a href="/?token={TOKEN}">Access with token</a>
                    <p><small>This token is valid until server restart.</small></p>
                </div>
            </div>
        </body>
        </html>
        """
        
        self.wfile.write(login_page.encode('utf-8'))
    
    def serve_access_denied(self):
        """Serve an access denied page when authentication is required but disabled"""
        self.send_response(403)
        self.send_header('Content-type', 'text/html')
        self.end_headers()
        
        access_denied_page = """
        <!DOCTYPE html>
        <html>
        <head>
            <title>Annzarro - Access Denied</title>
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
                .container {
                    background-color: white;
                    border-radius: 8px;
                    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
                    padding: 30px;
                    max-width: 400px;
                    width: 100%;
                }
                h1 {
                    color: #d32f2f;
                    margin-top: 0;
                    font-size: 24px;
                }
                p {
                    color: #333;
                    line-height: 1.5;
                }
                .back-link {
                    margin-top: 20px;
                    display: inline-block;
                    color: #2196F3;
                    text-decoration: none;
                }
                .back-link:hover {
                    text-decoration: underline;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Access Denied</h1>
                <p>Authentication is required to access this resource, but password authentication is disabled.</p>
                <p>You need a valid access token in the URL to access this application.</p>
            </div>
        </body>
        </html>
        """
        
        self.wfile.write(access_denied_page.encode('utf-8'))
    
    def do_POST(self):
        # Handle login form submission
        if self.path == '/login':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length).decode('utf-8')
            
            # Parse form data
            form_data = {}
            for field in post_data.split('&'):
                key, value = field.split('=')
                form_data[key] = value
                
            # Check if password is correct
            if 'password' in form_data and self.check_password(form_data['password']):
                # Set auth cookie and redirect
                self.send_response(302)
                self.send_header('Set-Cookie', f'auth={base64.b64encode(f"annzarro:{form_data["password"]}".encode()).decode()}; Path=/; Max-Age=86400')
                self.send_header('Location', '/')
                self.end_headers()
            else:
                # Password is incorrect, show error
                self.send_login_page(error="Invalid password. Please try again.")
            return
        
        # Default handler for other POST requests
        self.send_response(405)  # Method Not Allowed
        self.end_headers()
    
    def check_basic_auth(self):
        # Check for auth cookie first
        cookie_header = self.headers.get('Cookie', '')
        if cookie_header:
            cookies = {}
            for cookie in cookie_header.split(';'):
                if '=' in cookie:
                    name, value = cookie.strip().split('=', 1)
                    cookies[name] = value
            
            if 'auth' in cookies:
                try:
                    decoded_auth = base64.b64decode(cookies['auth']).decode('utf-8')
                    username, password = decoded_auth.split(':', 1)
                    if username == "annzarro" and self.check_password(password):
                        return True
                except Exception as e:
                    logging.error(f"Cookie auth error: {e}")
        
        # Check for Authorization header
        auth_header = self.headers.get('Authorization')
        if not auth_header:
            return False
        
        try:
            auth_type, auth_data = auth_header.split(' ', 1)
            if auth_type.lower() != 'basic':
                return False
            
            decoded_auth = base64.b64decode(auth_data).decode('utf-8')
            username, password = decoded_auth.split(':', 1)
            
            # Simple auth check
            if username == "annzarro" and self.check_password(password):
                return True
            return False
        except Exception as e:
            logging.error(f"Auth error: {e}")
            return False
    
    def check_password(self, password):
        # Simple password check for demo purposes
        return password == PASSWORD
    
    def log_message(self, format, *args):
        # Override to customize logging
        client_addr = self.client_address[0]
        
        # Sanitize log message to remove token if present
        log_message = format % args
        if TOKEN in log_message:
            # Replace token with [REDACTED]
            log_message = log_message.replace(TOKEN, "[REDACTED]")
        
        logging.info(f"{client_addr} - {log_message}")

# Main execution block
if __name__ == "__main__":
    # Start the server
    handler = AnnzarroRequestHandler
    httpd = socketserver.TCPServer(("", PORT), handler)

    print("======================================================================")
    print(f"🚀 Annzarro server starting on port {PORT}")
    print(f"📊 Access URLs with token (no password prompt):")
    print(f"   - Local access: http://localhost:{PORT}/?token={TOKEN}")
    try:
        import socket
        hostname = socket.gethostname()
        ip_address = socket.gethostbyname(hostname)
        print(f"   - Network IP: http://{ip_address}:{PORT}/?token={TOKEN}")
        print(f"   - Hostname: http://{hostname}:{PORT}/?token={TOKEN}")
    except Exception as e:
        # Don't show error if we can't get network info
        pass
    print(f"🔐 Authentication options:")
    print(f"   - Token authentication: Always enabled and preferred")
    print(f"   - Password authentication: {AUTH_MSG}")
    print("")
    print(f"⚠️  IMPORTANT: Use the token URL for direct access without password prompts")
    print(f"   The token is generated randomly each time the server starts")
    print("======================================================================")
    print("")
    print("Access logs will be saved to annzarro_server.log")
    print("Press Ctrl+C to stop the server")
    print("")
    print("PLEASE NOTE: This is the legacy server. For improved security and performance,")
    print("consider using the new server architecture:")
    print("  ./setup_server.sh      (setup)")
    print("  ./run_annzarro.py      (run)")
    print("")

    logging.info(f"Annzarro server started on port {PORT}")
    logging.info(f"Access token: {TOKEN}")
    logging.info(f"Authentication status: {AUTH_MSG}")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        logging.info("Server shutdown initiated")
        httpd.server_close()
        logging.info("Server stopped")
PYTHON_SCRIPT

# Modify the Python script to set the variables
sed -i.bak "s/PORT = None/PORT = $PORT/" "$SERVER_SCRIPT"
sed -i.bak "s/TOKEN = None/TOKEN = \"$TOKEN\"/" "$SERVER_SCRIPT"
sed -i.bak "s/AUTH_FILE = None/AUTH_FILE = \"$AUTH_FILE\"/" "$SERVER_SCRIPT"
sed -i.bak "s/ENABLE_PASSWORD = None/ENABLE_PASSWORD = $PYTHON_PASSWORD_ENABLE/" "$SERVER_SCRIPT"
sed -i.bak "s/AUTH_MSG = None/AUTH_MSG = \"$AUTH_MSG\"/" "$SERVER_SCRIPT"

# Make the Python script executable
chmod +x "$SERVER_SCRIPT"

# Run the server
echo "Starting Annzarro server (legacy mode)..."
"$PYTHON_CMD" "$SERVER_SCRIPT"

# Clean up temporary files on exit
function cleanup {
    rm -f "$AUTH_FILE" "$SERVER_SCRIPT" "$SERVER_SCRIPT.bak"
    echo -e "\nCleaned up temporary files"
}
trap cleanup EXIT
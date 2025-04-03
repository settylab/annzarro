#!/bin/bash

# Annzarro Server Launcher
# This script starts a simple HTTP server for Annzarro with token and password authentication

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
    echo "Annzarro Server Launcher"
    echo "Usage: ./run_server.sh [options]"
    echo ""
    echo "Options:"
    echo "  -p, --port PORT         Set server port (default: $DEFAULT_PORT)"
    echo "  -pw, --password PASS    Set authentication password (default: $DEFAULT_PASSWORD)"
    echo "  --no-password           Disable password authentication (not recommended)"
    echo "  -h, --help              Show this help message"
    echo ""
    echo "Authentication:"
    echo "  - Access via token is always enabled and shown when server starts"
    echo "  - Password authentication is used only if no valid token is provided"
    echo "  - With the token URL, no password is needed regardless of settings"
    echo ""
    echo "Example:"
    echo "  ./run_server.sh --port 8888 --password my_secure_password"
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

# Check if Python 3 is installed
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
else
    echo "ERROR: Python 3 is required but not found. Please install Python 3."
    exit 1
fi

# Create Python server script
SERVER_SCRIPT=$(mktemp)
cat > "$SERVER_SCRIPT" << PYTHON_SCRIPT
#!/usr/bin/env python3
import http.server
import socketserver
import os
import sys
import base64
import hashlib
import time
from urllib.parse import parse_qs, urlparse
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler("$LOG_FILE"),
        logging.StreamHandler(sys.stdout)
    ]
)

# Server configuration
PORT = $PORT
TOKEN = "$TOKEN"
AUTH_FILE = "$AUTH_FILE"
ENABLE_PASSWORD = $PYTHON_PASSWORD_ENABLE
AUTH_MSG = """$AUTH_MSG"""

class AnnzarroRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.getcwd(), **kwargs)
    
    def do_GET(self):
        # Parse query parameters to check for token
        query = urlparse(self.path).query
        query_components = parse_qs(query)
        
        # Check token authentication first
        path_token = query_components.get('token', [''])[0]
        if path_token == TOKEN or 'token=' + TOKEN in self.path:
            # If valid token is present, allow access without password
            super().do_GET()
            return
            
        # If no valid token, check for basic auth if enabled
        if ENABLE_PASSWORD:
            if not self.check_basic_auth():
                self.send_authentication_challenge()
                return
        else:
            # If password auth is disabled and no valid token, deny access
            self.send_authentication_challenge()
            return
        
        # If authentication is successful, serve the request
        super().do_GET()
    
    def check_basic_auth(self):
        auth_header = self.headers.get('Authorization')
        if not auth_header:
            return False
        
        try:
            auth_type, auth_data = auth_header.split(' ', 1)
            if auth_type.lower() != 'basic':
                return False
            
            decoded_auth = base64.b64decode(auth_data).decode('utf-8')
            username, password = decoded_auth.split(':', 1)
            
            # Very simple auth check (replace with better auth method in production)
            if username == "annzarro" and self.check_password(password):
                return True
            return False
        except Exception as e:
            logging.error(f"Auth error: {e}")
            return False
    
    def check_password(self, password):
        # In a real application, use a secure password verification method
        # This is a simple check for demonstration purposes
        return password == """$PASSWORD"""
    
    def send_authentication_challenge(self):
        self.send_response(401)
        self.send_header('WWW-Authenticate', 'Basic realm="Annzarro Authentication"')
        self.send_header('Content-type', 'text/html')
        self.end_headers()
        self.wfile.write(b'Authentication required')

    def log_message(self, format, *args):
        # Override to customize logging
        client_addr = self.client_address[0]
        logging.info(f"{client_addr} - {format % args}")

# Start the server
handler = AnnzarroRequestHandler
httpd = socketserver.TCPServer(("", PORT), handler)

print("======================================================================")
print(f"🚀 Annzarro server starting on port {PORT}")
print(f"📊 Access URLs with token (no password needed):")
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
print(f"🔐 Fallback authentication: {AUTH_MSG}")
print("======================================================================")
print("")
print("Access logs will be saved to $LOG_FILE")
print("Press Ctrl+C to stop the server")
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

# Make the Python script executable
chmod +x "$SERVER_SCRIPT"

# Run the server
echo "Starting Annzarro server..."
"$PYTHON_CMD" "$SERVER_SCRIPT"

# Clean up temporary files on exit
function cleanup {
    rm -f "$AUTH_FILE" "$SERVER_SCRIPT"
    echo -e "\nCleaned up temporary files"
}
trap cleanup EXIT
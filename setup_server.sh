#!/bin/bash

# Annzarro Server Setup Script
# This script sets up the environment for the Annzarro server
# It creates necessary directories, sets permissions, and installs required packages

# Exit on error
set -e

# Check Python version
echo "Checking Python version..."
if command -v python3 &>/dev/null; then
    PYTHON_CMD="python3"
else
    echo "Error: Python 3 is required. Please install Python 3 and try again."
    exit 1
fi

# Print Python version
$PYTHON_CMD --version

# Create necessary directories
echo "Creating server directories..."
mkdir -p server
mkdir -p logs
mkdir -p data

# Make scripts executable
echo "Setting permissions..."
chmod +x run_annzarro.py
chmod +x server/annzarro_server.py

# Install required packages
echo "Installing required Python packages..."
$PYTHON_CMD -m pip install --user flask flask-limiter flask-cors gunicorn pyjwt cryptography wheel

# Create a first admin user
echo "Would you like to create an admin user? (y/n)"
read -r CREATE_ADMIN

if [[ "$CREATE_ADMIN" == "y" ]]; then
    echo "Enter admin username:"
    read -r ADMIN_USER
    
    # Use Python script to create user securely
    $PYTHON_CMD run_annzarro.py --create-user --username "$ADMIN_USER" --admin
fi

# Install SSL certificate if needed
echo "Would you like to set up HTTPS with a self-signed certificate? (y/n)"
read -r SETUP_HTTPS

if [[ "$SETUP_HTTPS" == "y" ]]; then
    if command -v openssl &>/dev/null; then
        echo "Generating self-signed certificate..."
        mkdir -p server/ssl
        openssl req -x509 -newkey rsa:2048 -keyout server/ssl/server.key -out server/ssl/server.crt -days 365 -nodes
        
        # Update config to use these certificates
        sed -i.bak 's/"cert_file": null/"cert_file": "server\/ssl\/server.crt"/' server/config.json
        sed -i.bak 's/"key_file": null/"key_file": "server\/ssl\/server.key"/' server/config.json
        rm -f server/config.json.bak
        
        echo "SSL certificates generated successfully."
    else
        echo "OpenSSL not found. Skipping certificate generation."
        echo "HTTPS will use Flask's built-in adhoc certificates."
    fi
fi

# Configure workers based on CPU cores
CORES=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)
WORKERS=$((CORES * 2 + 1))

echo "Detected $CORES CPU cores, setting worker count to $WORKERS"
sed -i.bak "s/\"workers\": [0-9]*,/\"workers\": $WORKERS,/" server/config.json
rm -f server/config.json.bak

echo "==============================================================="
echo "Annzarro Server setup completed successfully!"
echo ""
echo "To start the server:"
echo "  ./run_annzarro.py --start"
echo ""
echo "To stop the server:"
echo "  ./run_annzarro.py --stop"
echo ""
echo "To create additional users:"
echo "  ./run_annzarro.py --create-user"
echo ""
echo "For more options:"
echo "  ./run_annzarro.py --help"
echo "==============================================================="
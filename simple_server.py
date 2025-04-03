#!/usr/bin/env python3
"""
Simple HTTP server for Annzarro

This script provides a simple HTTP server for the Annzarro application
"""

import os
import sys
import json
import argparse
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler

class AnnzarroHandler(SimpleHTTPRequestHandler):
    """Custom handler for Annzarro"""
    
    def end_headers(self):
        """Add CORS headers"""
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type')
        SimpleHTTPRequestHandler.end_headers(self)
    
    def do_OPTIONS(self):
        """Handle OPTIONS requests for CORS"""
        self.send_response(200)
        self.end_headers()
    
    def log_message(self, format, *args):
        """Custom log format"""
        sys.stdout.write("%s - %s\n" % (self.address_string(), format % args))

def run_server(port=8000, directory=None):
    """
    Run the HTTP server
    
    Args:
        port: Port number to listen on
        directory: Directory to serve files from
    """
    # Set the directory to serve files from
    if directory:
        os.chdir(directory)
    
    server_address = ('', port)
    httpd = HTTPServer(server_address, AnnzarroHandler)
    
    print("="*70)
    print(f"Annzarro Simple Server")
    print(f"Serving directory: {os.getcwd()}")
    print(f"Server running at http://localhost:{port}")
    print("="*70)
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        httpd.server_close()
        print("Server stopped.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Annzarro Simple Server")
    parser.add_argument("-p", "--port", type=int, default=8000, help="Port to run server on")
    parser.add_argument("-d", "--directory", type=str, help="Directory to serve files from")
    
    args = parser.parse_args()
    run_server(port=args.port, directory=args.directory)
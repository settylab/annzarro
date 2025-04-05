"""Main module for running the unified server directly."""

import sys
import argparse
import os
from .server import run_server

def main():
    """Main entry point when module is run directly."""
    parser = argparse.ArgumentParser(description="Annzarro Unified Server")
    parser.add_argument("-c", "--config", type=str, help="Path to config file")
    parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    parser.add_argument("--port", type=int, help="Port to run the server on")
    parser.add_argument("--data-dir", type=str, help="Directory to use for data storage")
    parser.add_argument("--static-dir", type=str, help="Directory containing static files (default: repository root)")
    
    args = parser.parse_args()
    
    # If data_dir is provided, validate and expand it
    data_dir = None
    if args.data_dir:
        data_dir = os.path.expanduser(args.data_dir)
        if not os.path.isabs(data_dir):
            data_dir = os.path.abspath(data_dir)
    
    # If static_dir is provided, validate and expand it
    static_dir = None
    if args.static_dir:
        static_dir = os.path.expanduser(args.static_dir)
        if not os.path.isabs(static_dir):
            static_dir = os.path.abspath(static_dir)
    
    try:
        run_server(
            config_file=args.config,
            debug=args.debug,
            port=args.port,
            data_dir=data_dir,
            static_dir=static_dir
        )
    except KeyboardInterrupt:
        print("\nServer stopped.")
        sys.exit(0)
    except Exception as e:
        print(f"Error starting server: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
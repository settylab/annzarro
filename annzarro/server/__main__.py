"""Main module for running the server directly."""

import sys
import argparse
from annzarro.server.server import run_server

def main():
    """Main entry point when module is run directly."""
    parser = argparse.ArgumentParser(description="Annzarro Server")
    parser.add_argument("-c", "--config", type=str, help="Path to config file")
    parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    parser.add_argument("--port", type=int, help="Port to run the server on")
    
    args = parser.parse_args()
    
    try:
        run_server(
            config_file=args.config,
            debug=args.debug,
            port=args.port
        )
    except KeyboardInterrupt:
        print("\nServer stopped.")
        sys.exit(0)
    except Exception as e:
        print(f"Error starting server: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
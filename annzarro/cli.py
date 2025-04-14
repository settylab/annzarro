#!/usr/bin/env python3
"""
Command-line interface for Annzarro

This module provides the main entry point for the Annzarro CLI.
"""

import argparse
import logging
import sys
import os
from pathlib import Path
from typing import List, Optional, Dict, Any

from .data.manager import data_manager
from .server import run_server

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)

logger = logging.getLogger("annzarro")

def main(args: Optional[List[str]] = None) -> int:
    """
    Main entry point for the CLI
    
    Args:
        args: Command line arguments
        
    Returns:
        Exit code
    """
    parser = argparse.ArgumentParser(
        description="Annzarro: Python-based Single-Cell Data Visualization Tool"
    )
    
    # Create subparsers for commands
    subparsers = parser.add_subparsers(dest="command", help="Command to execute")
    
    # Server command
    server_parser = subparsers.add_parser("server", help="Start the web server")
    server_parser.add_argument("--host", type=str, default="127.0.0.1", help="Host to bind to")
    server_parser.add_argument("-p", "--port", type=int, default=8000, help="Port to listen on")
    server_parser.add_argument("-c", "--config", type=str, help="Path to config file")
    server_parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    server_parser.add_argument("--data-dir", type=str, default="data", help="Directory containing data files")
    
    # Data command
    data_parser = subparsers.add_parser("data", help="Data management commands")
    data_subparsers = data_parser.add_subparsers(dest="data_command", help="Data command to execute")
    
    # List datasets command
    list_parser = data_subparsers.add_parser("list", help="List available datasets")
    list_parser.add_argument("-d", "--directory", type=str, default="data", 
                             help="Directory containing datasets")
    
    # Dataset info command
    info_parser = data_subparsers.add_parser("info", help="Get dataset information")
    info_parser.add_argument("path", type=str, help="Path to dataset")
    
    # Parse arguments
    if args is None:
        args = sys.argv[1:]
    parsed_args = parser.parse_args(args)
    
    # Execute command
    if parsed_args.command == "server":
        # Start the server
        try:
            run_server(
                config_file=parsed_args.config,
                debug=parsed_args.debug,
                port=parsed_args.port
            )
            return 0
        except Exception as e:
            logger.error(f"Error starting server: {e}")
            return 1
    
    elif parsed_args.command == "data":
        if parsed_args.data_command == "list":
            # List datasets
            try:
                datasets = data_manager.list_datasets(parsed_args.directory)
                
                # Print dataset information
                print(f"Found {len(datasets)} datasets:")
                for i, dataset in enumerate(datasets, 1):
                    print(f"{i}. {dataset['name']} ({dataset['path']})")
                
                return 0
            except Exception as e:
                logger.error(f"Error listing datasets: {e}")
                return 1
                
        elif parsed_args.data_command == "info":
            # Get dataset information
            try:
                info = data_manager.get_dataset_info(parsed_args.path)
                
                # Check if there was an error
                if "error" in info:
                    print(f"Error: {info['error']}")
                    return 1
                
                # Print dataset information
                print(f"Dataset: {info['name']}")
                print(f"Path: {info['path']}")
                print(f"Shape: {info['shape']} (n_obs: {info['n_obs']}, n_vars: {info['n_vars']})")
                print(f"Obs columns: {', '.join(info['obs_columns']) if info['obs_columns'] else 'None'}")
                print(f"Var columns: {', '.join(info['var_columns']) if info['var_columns'] else 'None'}")
                print(f"Layers: {', '.join(info['layers']) if info['layers'] else 'None'}")
                print(f"Embeddings: {', '.join(info['embeddings']) if info['embeddings'] else 'None'}")
                
                # Print sample data if available
                if "obs_names_sample" in info and info["obs_names_sample"]:
                    print(f"\nSample observation names: {', '.join(info['obs_names_sample'][:5])}...")
                
                if "var_names_sample" in info and info["var_names_sample"]:
                    print(f"Sample variable names: {', '.join(info['var_names_sample'][:5])}...")
                
                return 0
            except Exception as e:
                logger.error(f"Error getting dataset info: {e}")
                return 1
        else:
            # Unknown data command
            data_parser.print_help()
            return 1
    else:
        # No command specified
        parser.print_help()
        return 1

if __name__ == "__main__":
    sys.exit(main())
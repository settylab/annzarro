#!/usr/bin/env python3
"""
Command-line interface for Annzarro

This module provides the main entry point for the Annzarro CLI.
"""

import argparse
import logging
import sys
import os
import json
import getpass
import signal
import time
import subprocess
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

def start_server(args: argparse.Namespace) -> int:
    """
    Start the Annzarro server
    
    Args:
        args: Command line arguments
        
    Returns:
        Exit code
    """
    # Prepare configuration
    config = {}
    
    # Set cache options if provided
    if args.cache_memory is not None:
        config["cache_memory_mb"] = args.cache_memory
        
    if args.cache_datasets is not None:
        config["cache_dataset_limit"] = args.cache_datasets
    
    if args.no_cache:
        config["cache_enabled"] = False
        
    # Enable authentication by default unless explicitly disabled
    config["auth_enabled"] = not args.no_auth
    
    # Try to start the server in-process
    try:
        if args.detach:
            # Start server in a separate process
            cmd = [sys.executable, "-m", "annzarro.server"]
            
            # Add arguments
            if args.host:
                cmd.extend(["--host", args.host])
            if args.port:
                cmd.extend(["--port", str(args.port)])
            if args.config:
                cmd.extend(["--config", args.config])
            if args.debug:
                cmd.append("--debug")
            if args.data_dir:
                # Expand user directory (~/path) if present
                expanded_data_dir = os.path.expanduser(args.data_dir)
                # Convert to absolute path if it's relative
                if not os.path.isabs(expanded_data_dir):
                    expanded_data_dir = os.path.abspath(expanded_data_dir)
                cmd.extend(["--data-dir", expanded_data_dir])
                
            # Add cache options as environment variables
            env = os.environ.copy()
            if args.cache_memory is not None:
                env["ANNZARRO_CACHE_MEMORY_MB"] = str(args.cache_memory)
            if args.cache_datasets is not None:
                env["ANNZARRO_CACHE_DATASET_LIMIT"] = str(args.cache_datasets)
            if args.no_cache:
                env["ANNZARRO_CACHE_ENABLED"] = "false"
                
            # Set authentication based on arguments
            env["ANNZARRO_AUTH_ENABLED"] = "false" if args.no_auth else "true"
            
            # Start the server as a detached process
            logger.info(f"Starting server in detached mode: {' '.join(cmd)}")
            server_process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env,
                preexec_fn=os.setpgrp if hasattr(os, 'setpgrp') else None
            )
            
            # Save PID
            with open("annzarro_pid.txt", "w") as f:
                f.write(str(server_process.pid))
                
            logger.info(f"Server started with PID {server_process.pid}")
            
            # Display cache settings if specified
            if args.cache_memory or args.cache_datasets or args.no_cache:
                print("Cache settings:")
                if args.no_cache:
                    print("- Caching: Disabled")
                else:
                    print(f"- Memory limit: {args.cache_memory or 1000} MB")
                    print(f"- Dataset limit: {args.cache_datasets or 10} datasets")
            
            # Display access URL
            if args.host == "0.0.0.0":
                try:
                    import socket
                    hostname = socket.gethostname()
                    ip_address = socket.gethostbyname(hostname)
                    print(f"Server available at:")
                    print(f"- Local:     http://localhost:{args.port}")
                    print(f"- Network:   http://{ip_address}:{args.port}")
                except:
                    print(f"Server available at: http://localhost:{args.port}")
            else:
                print(f"Server available at: http://{args.host}:{args.port}")
                
            return 0
        else:
            # Start the server in this process
            logger.info("Starting server...")
            run_server(
                config_file=args.config,
                debug=args.debug,
                port=args.port,
                host=args.host,
                data_dir=args.data_dir,
                config=config
            )
            return 0
    except KeyboardInterrupt:
        logger.info("Server interrupted by user")
        return 0
    except Exception as e:
        logger.error(f"Error starting server: {e}")
        return 1

def stop_server(args: argparse.Namespace) -> int:
    """
    Stop the Annzarro server
    
    Args:
        args: Command line arguments
        
    Returns:
        Exit code
    """
    logger.info("Stopping server...")
    
    # Try to read PID from file
    try:
        if os.path.exists("annzarro_pid.txt"):
            with open("annzarro_pid.txt", "r") as f:
                pid = int(f.read().strip())
                
            logger.info(f"Found server PID: {pid}")
            
            # Try to terminate the process
            try:
                os.kill(pid, signal.SIGTERM)
                
                # Wait for process to exit
                for _ in range(5):
                    time.sleep(1)
                    try:
                        # Check if process still exists
                        os.kill(pid, 0)
                    except OSError:
                        # Process has stopped
                        break
                else:
                    # Process didn't stop, try SIGKILL
                    try:
                        os.kill(pid, signal.SIGKILL)
                        logger.info(f"Force-killed server process")
                    except OSError:
                        pass
                        
                logger.info("Server stopped")
                os.remove("annzarro_pid.txt")
                print("Server stopped successfully")
                return 0
                
            except OSError as e:
                if e.errno == 3:  # No such process
                    logger.warning(f"No server running with PID {pid}")
                    os.remove("annzarro_pid.txt")
                    print("No server running with that PID. Removed PID file.")
                    return 0
                else:
                    logger.error(f"Error stopping server: {e}")
                    print(f"Error stopping server: {e}")
                    return 1
        else:
            logger.warning("No server PID file found")
            print("No server PID file found. Server might not be running.")
            return 0
            
    except Exception as e:
        logger.error(f"Error stopping server: {e}")
        print(f"Error stopping server: {e}")
        return 1

def create_user(args: argparse.Namespace) -> int:
    """
    Create a new user
    
    Args:
        args: Command line arguments
        
    Returns:
        Exit code
    """
    try:
        from .server.auth import AuthManager
    except ImportError:
        logger.error("Failed to import AuthManager")
        print("Error: Authentication module not found. Make sure the server is correctly installed.")
        return 1
    
    # Get username
    username = args.username
    if not username:
        username = input("Enter username: ").strip()
        if not username:
            print("Error: Username cannot be empty")
            return 1
            
    # Get password
    password = args.password
    if not password:
        password = getpass.getpass("Enter password: ")
        password_confirm = getpass.getpass("Confirm password: ")
        
        if password != password_confirm:
            print("Error: Passwords do not match")
            return 1
            
        if not password:
            print("Error: Password cannot be empty")
            return 1
            
    # Find config file and user_file path
    root_dir = Path(__file__).resolve().parent.parent
    config_file = root_dir / "annzarro" / "server" / "config.json"
    user_file = "annzarro/server/users.json"  # Default
    
    if config_file.exists():
        try:
            with open(config_file, 'r') as f:
                config = json.load(f)
                user_file = config.get('user_file', user_file)
        except Exception as e:
            logger.warning(f"Could not read config file: {e}")
            
    # Ensure user file path is absolute
    if not os.path.isabs(user_file):
        user_file = os.path.join(root_dir, user_file)
    
    # Ensure directory exists
    os.makedirs(os.path.dirname(user_file), exist_ok=True)
    
    # Create user
    is_admin = args.admin
    try:
        auth_manager = AuthManager(user_file=user_file)
        if auth_manager.create_user(username, password, is_admin=is_admin):
            print(f"User '{username}' created successfully")
            if is_admin:
                print("User has admin privileges")
            return 0
        else:
            print(f"Error: Failed to create user '{username}'. Username may already exist.")
            return 1
    except Exception as e:
        logger.error(f"Error creating user: {e}")
        print(f"Error creating user: {e}")
        return 1

def list_users(args: argparse.Namespace) -> int:
    """
    List all users
    
    Args:
        args: Command line arguments
        
    Returns:
        Exit code
    """
    # Find config file and user_file path
    root_dir = Path(__file__).resolve().parent.parent
    config_file = root_dir / "annzarro" / "server" / "config.json"
    user_file = "annzarro/server/users.json"  # Default
    
    if config_file.exists():
        try:
            with open(config_file, 'r') as f:
                config = json.load(f)
                user_file = config.get('user_file', user_file)
        except Exception as e:
            logger.warning(f"Could not read config file: {e}")
            
    # Ensure user file path is absolute
    if not os.path.isabs(user_file):
        user_file = os.path.join(root_dir, user_file)
    
    # Check if user file exists
    if not os.path.exists(user_file):
        print(f"User file not found: {user_file}")
        return 1
    
    # Read user file
    try:
        with open(user_file, 'r') as f:
            users = json.load(f)
        
        if not users:
            print("No users found")
            return 0
        
        print(f"User file: {user_file}")
        print(f"Found {len(users)} users:")
        print("-" * 50)
        
        format_str = "{:<20} {:<10} {:<30}"
        print(format_str.format("USERNAME", "ADMIN", "ID"))
        print("-" * 50)
        
        for username, user_data in users.items():
            is_admin = user_data.get("is_admin", False)
            user_id = user_data.get("id", "N/A")
            print(format_str.format(username, "Yes" if is_admin else "No", user_id))
        
        return 0
    except Exception as e:
        logger.error(f"Error listing users: {e}")
        print(f"Error listing users: {e}")
        return 1

def remove_user(args: argparse.Namespace) -> int:
    """
    Remove a user
    
    Args:
        args: Command line arguments
        
    Returns:
        Exit code
    """
    # Find config file and user_file path
    root_dir = Path(__file__).resolve().parent.parent
    config_file = root_dir / "annzarro" / "server" / "config.json"
    user_file = "annzarro/server/users.json"  # Default
    
    if config_file.exists():
        try:
            with open(config_file, 'r') as f:
                config = json.load(f)
                user_file = config.get('user_file', user_file)
        except Exception as e:
            logger.warning(f"Could not read config file: {e}")
            
    # Ensure user file path is absolute
    if not os.path.isabs(user_file):
        user_file = os.path.join(root_dir, user_file)
    
    # Check if user file exists
    if not os.path.exists(user_file):
        print(f"User file not found: {user_file}")
        return 1
    
    # Get username
    username = args.username
    if not username:
        username = input("Enter username to remove: ").strip()
        if not username:
            print("Error: Username cannot be empty")
            return 1
    
    # Read user file
    try:
        with open(user_file, 'r') as f:
            users = json.load(f)
        
        # Check if user exists
        if username not in users:
            print(f"Error: User '{username}' not found")
            return 1
        
        # Confirm removal
        if not args.force:
            confirm = input(f"Are you sure you want to remove user '{username}'? (y/n): ").lower()
            if confirm not in ('y', 'yes'):
                print("User removal cancelled")
                return 0
        
        # Remove user
        del users[username]
        
        # Write updated user file
        with open(user_file, 'w') as f:
            json.dump(users, f, indent=2)
        
        print(f"User '{username}' removed successfully")
        return 0
    except Exception as e:
        logger.error(f"Error removing user: {e}")
        print(f"Error removing user: {e}")
        return 1

def install_requirements(args: argparse.Namespace) -> int:
    """
    Install requirements
    
    Args:
        args: Command line arguments
        
    Returns:
        Exit code
    """
    reqs = [
        "flask",
        "flask-cors",
        "flask-limiter",
        "werkzeug",
        "gunicorn",
        "pyjwt",
        "cryptography",
        "zarr",
        "numpy",
        "pandas",
        "matplotlib",
        "numba",
        "requests",
        "psutil"
    ]
    
    if args.dev:
        reqs.extend([
            "pytest",
            "pytest-cov",
            "black",
            "isort",
            "pylint",
            "mypy"
        ])
    
    # Install packages
    cmd = [sys.executable, "-m", "pip", "install"]
    if args.user:
        cmd.append("--user")
    cmd.extend(reqs)
    
    print(f"Installing {len(reqs)} packages...")
    try:
        subprocess.check_call(cmd)
        print("Installation completed successfully")
        return 0
    except subprocess.CalledProcessError as e:
        print(f"Installation failed: {e}")
        return 1

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
    
    # Start command
    start_parser = subparsers.add_parser("start", help="Start the server")
    start_parser.add_argument("--host", type=str, default="0.0.0.0", help="Host to bind to (default: 0.0.0.0)")
    start_parser.add_argument("-p", "--port", type=int, default=8000, help="Port to listen on")
    start_parser.add_argument("-c", "--config", type=str, help="Path to config file")
    start_parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    start_parser.add_argument("--data-dir", type=str, default="data", help="Directory containing data files")
    start_parser.add_argument("--detach", action="store_true", help="Run server in the background")
    
    # Authentication options
    start_parser.add_argument("--no-auth", action="store_true", help="Disable authentication")
    
    # Cache options
    start_parser.add_argument("--cache-memory", type=int, help="Maximum memory in MB for backend caching (default: 1000)")
    start_parser.add_argument("--cache-datasets", type=int, help="Maximum number of datasets to keep in memory (default: 10)")
    start_parser.add_argument("--no-cache", action="store_true", help="Disable caching for memory-constrained environments")
    
    # Stop command
    stop_parser = subparsers.add_parser("stop", help="Stop the server")
    
    # User commands
    user_parser = subparsers.add_parser("user", help="User management")
    user_subparsers = user_parser.add_subparsers(dest="user_command", help="User command to execute")
    
    # Add user command
    add_parser = user_subparsers.add_parser("add", help="Add a new user")
    add_parser.add_argument("-u", "--username", type=str, help="Username")
    add_parser.add_argument("-p", "--password", type=str, help="Password")
    add_parser.add_argument("-a", "--admin", action="store_true", help="Create user with admin privileges")
    
    # List users command
    list_parser = user_subparsers.add_parser("list", help="List all users")
    
    # Remove user command
    remove_parser = user_subparsers.add_parser("remove", help="Remove a user")
    remove_parser.add_argument("-u", "--username", type=str, help="Username to remove")
    remove_parser.add_argument("-f", "--force", action="store_true", help="Force removal without confirmation")
    
    # Install command
    install_parser = subparsers.add_parser("install", help="Install requirements")
    install_parser.add_argument("--user", action="store_true", help="Install for current user only")
    install_parser.add_argument("--dev", action="store_true", help="Install development requirements")
    
    # Data command
    data_parser = subparsers.add_parser("data", help="Data management commands")
    data_subparsers = data_parser.add_subparsers(dest="data_command", help="Data command to execute")
    
    # List datasets command
    list_datasets_parser = data_subparsers.add_parser("list", help="List available datasets")
    list_datasets_parser.add_argument("-d", "--directory", type=str, default="data", 
                              help="Directory containing datasets")
    
    # Dataset info command
    info_parser = data_subparsers.add_parser("info", help="Get dataset information")
    info_parser.add_argument("path", type=str, help="Path to dataset")
    
    # Parse arguments
    if args is None:
        args = sys.argv[1:]
    parsed_args = parser.parse_args(args)
    
    # Execute command
    if parsed_args.command == "start":
        return start_server(parsed_args)
    elif parsed_args.command == "stop":
        return stop_server(parsed_args)
    elif parsed_args.command == "user":
        if parsed_args.user_command == "add":
            return create_user(parsed_args)
        elif parsed_args.user_command == "list":
            return list_users(parsed_args)
        elif parsed_args.user_command == "remove":
            return remove_user(parsed_args)
        else:
            user_parser.print_help()
            return 1
    elif parsed_args.command == "install":
        return install_requirements(parsed_args)
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
        return 0

if __name__ == "__main__":
    sys.exit(main())
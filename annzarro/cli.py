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
import yaml
import getpass
import signal
import time
import subprocess
from pathlib import Path
from typing import List, Optional, Dict, Any, Tuple

from .data.manager import data_manager
from .server import run_server
from .utils.config_manager import config_manager

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)

logger = logging.getLogger("annzarro")

def load_config(
    config_path: Optional[str] = None,
    env: str = "development",
    cli_args: Optional[argparse.Namespace] = None
) -> Dict[str, Any]:
    """
    Load configuration using the configuration manager.
    
    Args:
        config_path: Path to configuration file (optional)
        env: Environment name (development, production)
        cli_args: Command line arguments
        
    Returns:
        Configuration dictionary
    """
    # Load configuration using the manager
    config = config_manager.load_config(env=env, config_path=config_path, cli_args=cli_args)
    
    # Validate configuration
    is_valid, errors = config_manager.validate_config()
    if not is_valid:
        for error in errors:
            logger.error(f"Configuration error: {error}")
        logger.error("Configuration is invalid. Exiting.")
        sys.exit(1)
    
    # Log configuration source information
    config_info = config_manager.get_config_info()
    if config_info["sources"]:
        logger.info(f"Configuration loaded from: {', '.join(config_info['sources'].keys())}")
    
    return config

def start_server(args: argparse.Namespace) -> int:
    """
    Start the Annzarro server
    
    Args:
        args: Command line arguments
        
    Returns:
        Exit code
    """
    # Load configuration
    env = "production" if getattr(args, "production", False) else "development"
    config = load_config(
        config_path=args.config,
        env=env,
        cli_args=args
    )
    
    # Convert to flat structure for the server
    flask_config = config_manager.to_flask_config()
    
    # Start the server
    run_server(flask_config, args.detach)
    
    return 0

def stop_server(args: argparse.Namespace) -> int:
    """
    Stop the Annzarro server
    
    Args:
        args: Command line arguments
        
    Returns:
        Exit code
    """
    try:
        pid_file = Path.home() / ".annzarro" / "server.pid"
        if not pid_file.exists():
            logger.error("Server is not running (PID file not found)")
            return 1
            
        with open(pid_file, 'r') as f:
            pid = int(f.read().strip())
            
        logger.info(f"Stopping Annzarro server (PID: {pid})")
        
        try:
            os.kill(pid, signal.SIGTERM)
            
            # Wait for process to terminate
            for _ in range(10):  # Try for 5 seconds
                time.sleep(0.5)
                try:
                    # If this doesn't raise an exception, the process is still running
                    os.kill(pid, 0)
                except OSError:
                    # Process has terminated
                    break
            else:
                logger.warning("Server did not terminate gracefully, sending SIGKILL")
                try:
                    os.kill(pid, signal.SIGKILL)
                except OSError:
                    # Process already terminated
                    pass
            
            # Remove PID file
            pid_file.unlink()
            logger.info("Server stopped successfully")
            
        except ProcessLookupError:
            logger.warning(f"Process with PID {pid} not found, removing stale PID file")
            pid_file.unlink()
            
        return 0
            
    except Exception as e:
        logger.error(f"Error stopping server: {e}")
        return 1

def manage_users(args: argparse.Namespace) -> int:
    """
    Manage users for the Annzarro server
    
    Args:
        args: Command line arguments
        
    Returns:
        Exit code
    """
    from .server.auth import AuthManager
    
    # Load configuration to get user file path
    config = load_config(config_path=args.config)
    
    # Extract user file path from full config
    if "auth" in config and "user_file" in config["auth"]:
        user_file = config["auth"]["user_file"]
    else:
        user_file = "users.json"
    
    # Ensure user file directory exists
    user_file_dir = os.path.dirname(user_file)
    if user_file_dir and not os.path.exists(user_file_dir):
        os.makedirs(user_file_dir)
    
    # Initialize auth manager
    auth_manager = AuthManager(user_file=user_file)
    
    if args.user_command == "add":
        # Get username
        username = args.username
        if not username:
            username = input("Username: ").strip()
            
        # Check if user already exists
        if auth_manager.get_user(username):
            logger.error(f"User '{username}' already exists")
            return 1
            
        # Get password securely
        password = args.password
        if not password:
            password = getpass.getpass("Password: ")
            password_confirm = getpass.getpass("Confirm password: ")
            
            if password != password_confirm:
                logger.error("Passwords do not match")
                return 1
                
        # Add user
        auth_manager.add_user(username, password, is_admin=args.admin)
        logger.info(f"User '{username}' added successfully")
        
    elif args.user_command == "remove":
        # Get username
        username = args.username
        if not username:
            username = input("Username to remove: ").strip()
            
        # Check if user exists
        if not auth_manager.get_user(username):
            logger.error(f"User '{username}' does not exist")
            return 1
            
        # Remove user
        auth_manager.remove_user(username)
        logger.info(f"User '{username}' removed successfully")
        
    elif args.user_command == "list":
        # List users
        users = auth_manager.get_users()
        if not users:
            logger.info("No users found")
            return 0
            
        # Print user information
        print("\nUsers:")
        print("=" * 40)
        for username, user in users.items():
            print(f"Username: {username}")
            print(f"Admin: {'Yes' if user.is_admin else 'No'}")
            print("-" * 40)
            
    return 0

def install_dependencies(args: argparse.Namespace) -> int:
    """
    Install dependencies for the Annzarro server
    
    Args:
        args: Command line arguments
        
    Returns:
        Exit code
    """
    try:
        # Install Python dependencies
        logger.info("Installing Python dependencies...")
        requirements_file = os.path.join(os.path.dirname(__file__), "server", "requirements.txt")
        
        if not os.path.exists(requirements_file):
            logger.error(f"Requirements file not found: {requirements_file}")
            return 1
            
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", requirements_file])
        logger.info("Python dependencies installed successfully")
        
        return 0
        
    except Exception as e:
        logger.error(f"Error installing dependencies: {e}")
        return 1

def config_command(args: argparse.Namespace) -> int:
    """
    Handle configuration-related commands
    
    Args:
        args: Command line arguments
        
    Returns:
        Exit code
    """
    if args.config_command == "show":
        # Load and show configuration
        env = args.env or "development"
        config = load_config(config_path=args.config, env=env)
        
        # Print configuration
        if args.format == "json":
            print(json.dumps(config, indent=2))
        else:  # yaml
            if 'yaml' not in sys.modules:
                logger.warning("PyYAML is not installed. Falling back to JSON output.")
                print(json.dumps(config, indent=2))
            else:
                import yaml
                print(yaml.dump(config, default_flow_style=False))
            
    elif args.config_command == "init":
        # Initialize a new configuration file
        output_path = args.output
        if not output_path:
            output_path = "config.yaml"
            
        # Check if file already exists
        if os.path.exists(output_path) and not args.force:
            logger.error(f"Configuration file already exists: {output_path}")
            logger.error("Use --force to overwrite")
            return 1
            
        # Check for YAML support
        if 'yaml' not in sys.modules:
            logger.error("PyYAML is not installed. Cannot initialize YAML configuration.")
            logger.error("Please install PyYAML using: pip install pyyaml")
            return 1
                
        # Load base configuration
        base_config_path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            "config", 
            "base.yaml"
        )
        
        try:
            import yaml
            with open(base_config_path, 'r') as f:
                config = yaml.safe_load(f)
                
            # Write to output file
            with open(output_path, 'w') as f:
                yaml.dump(config, f, default_flow_style=False)
                
            logger.info(f"Configuration file initialized: {output_path}")
            
        except Exception as e:
            logger.error(f"Error initializing configuration: {e}")
            return 1
            
    elif args.config_command == "validate":
        # Validate configuration
        env = args.env or "development"
        config = load_config(config_path=args.config, env=env)
        
        # Configuration validation is performed in load_config
        logger.info("Configuration is valid")
        
    elif args.config_command == "info":
        # Show configuration source information
        env = args.env or "development"
        load_config(config_path=args.config, env=env)
        
        # Get configuration info
        config_info = config_manager.get_config_info()
        
        # Print information
        print("\nConfiguration Sources:")
        print("======================")
        for source_name, source_path in config_info["sources"].items():
            print(f"{source_name}: {source_path}")
            
        print("\nEnvironment Variables:")
        print("======================")
        for name, value in config_info["environment_variables"].items():
            print(f"{name}={value}")
            
        print("\nCommand Line Arguments:")
        print("======================")
        for arg in config_info["command_line_args"]:
            print(arg)
            
    return 0

def main(argv: List[str] = None) -> int:
    """
    Main entry point for the Annzarro CLI
    
    Args:
        argv: Command line arguments
        
    Returns:
        Exit code
    """
    parser = argparse.ArgumentParser(description="Annzarro - Zarr-based AnnData Visualization")
    
    # Global options
    parser.add_argument('--config', help="Path to configuration file")
    parser.add_argument('--debug', action='store_true', help="Enable debug logging")
    
    # Create subcommands
    subparsers = parser.add_subparsers(dest='command', help="Command to run")
    
    # Start command
    start_parser = subparsers.add_parser('start', help="Start the Annzarro server")
    start_parser.add_argument('--host', help="Host to bind to")
    start_parser.add_argument('--port', type=int, help="Port to bind to")
    start_parser.add_argument('--data-dir', help="Data directory")
    start_parser.add_argument('--detach', action='store_true', help="Run server in background")
    start_parser.add_argument('--production', action='store_true', help="Run in production mode")
    start_parser.set_defaults(func=start_server)
    
    # Stop command
    stop_parser = subparsers.add_parser('stop', help="Stop the Annzarro server")
    stop_parser.set_defaults(func=stop_server)
    
    # User management command
    user_parser = subparsers.add_parser('user', help="Manage users")
    user_subparsers = user_parser.add_subparsers(dest='user_command', help="User management command")
    
    # User add command
    user_add_parser = user_subparsers.add_parser('add', help="Add a new user")
    user_add_parser.add_argument('--username', help="Username")
    user_add_parser.add_argument('--password', help="Password")
    user_add_parser.add_argument('--admin', action='store_true', help="Make user an admin")
    
    # User remove command
    user_remove_parser = user_subparsers.add_parser('remove', help="Remove a user")
    user_remove_parser.add_argument('--username', help="Username")
    
    # User list command
    user_list_parser = user_subparsers.add_parser('list', help="List users")
    
    user_parser.set_defaults(func=manage_users)
    
    # Install command
    install_parser = subparsers.add_parser('install', help="Install dependencies")
    install_parser.set_defaults(func=install_dependencies)
    
    # Configuration command
    config_parser = subparsers.add_parser('config', help="Manage configuration")
    config_subparsers = config_parser.add_subparsers(dest='config_command', help="Configuration command")
    
    # Config show command
    config_show_parser = config_subparsers.add_parser('show', help="Show current configuration")
    config_show_parser.add_argument('--format', choices=['json', 'yaml'], default='yaml', help="Output format")
    config_show_parser.add_argument('--env', choices=['development', 'production'], help="Environment")
    
    # Config init command
    config_init_parser = config_subparsers.add_parser('init', help="Initialize a new configuration file")
    config_init_parser.add_argument('--output', help="Output file path")
    config_init_parser.add_argument('--force', action='store_true', help="Overwrite existing file")
    
    # Config validate command
    config_validate_parser = config_subparsers.add_parser('validate', help="Validate configuration")
    config_validate_parser.add_argument('--env', choices=['development', 'production'], help="Environment")
    
    # Config info command
    config_info_parser = config_subparsers.add_parser('info', help="Show configuration source information")
    config_info_parser.add_argument('--env', choices=['development', 'production'], help="Environment")
    
    config_parser.set_defaults(func=config_command)
    
    # Parse arguments
    args = parser.parse_args(argv)
    
    # Set up logging
    if args.debug:
        logging.getLogger().setLevel(logging.DEBUG)
        
    # Run the appropriate function
    if hasattr(args, 'func'):
        try:
            return args.func(args)
        except KeyboardInterrupt:
            logger.info("Operation cancelled by user")
            return 1
        except Exception as e:
            logger.error(f"Error: {e}")
            if args.debug:
                import traceback
                traceback.print_exc()
            return 1
    else:
        parser.print_help()
        return 1

if __name__ == "__main__":
    sys.exit(main())
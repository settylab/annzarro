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
    # Process venv_path if specified
    venv_path = getattr(args, 'venv_path', None)
    if venv_path:
        logger.info(f"Using custom virtual environment: {venv_path}")
        # If venv_path is specified, set the Python path for the process
        # This is a no-op for now as we're not using the venv in the server process itself
        # but we're accepting the parameter to avoid argument parsing errors
    
    # Load configuration - default to production for security, use development only when explicitly requested
    env = "development" if getattr(args, "development", False) else "production"
    logger.info(f"Starting server in {env} mode")
    config = load_config(
        config_path=args.config,
        env=env,
        cli_args=args
    )
    
    # Override with command-line arguments
    if args.host:
        config.setdefault('server', {})['host'] = args.host
    if args.port:
        config.setdefault('server', {})['port'] = args.port
    if args.data_dir:
        config.setdefault('server', {})['data_dir'] = args.data_dir
    
    # Authentication is disabled by default for the desktop app
    if getattr(args, 'auth_disabled', False):
        config.setdefault('auth', {})['enabled'] = False
        logger.info("Authentication disabled by command line flag")
    
    # Check for ANNZARRO_AUTH_DISABLED environment variable
    if os.environ.get('ANNZARRO_AUTH_DISABLED'):
        config.setdefault('auth', {})['enabled'] = False
        logger.info("Authentication disabled by ANNZARRO_AUTH_DISABLED environment variable")
    
    # Log the auth configuration before flattening
    logger.info(f"Auth configuration before flattening: enabled={config.get('auth', {}).get('enabled', False)}")
    
    # Convert to flat structure for the server
    logger.info(f"Server host before flattening: {config.get('server', {}).get('host', 'NOT SET')}")
    flask_config = config_manager.to_flask_config()
    
    # Log the flattened auth configuration 
    logger.info(f"Auth configuration after flattening: auth_enabled={flask_config.get('auth_enabled', False)}")
    logger.info(flask_config)
    
    # Start the server with the configuration from the config manager
    # Pass config as config_file to handle the special case
    run_server(config_file=flask_config, detach=args.detach)
    
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
        # Look in the standard location first
        pid_file = Path.home() / ".annzarro" / "server.pid"
        
        # If the PID file doesn't exist in the home directory, try the temp directory
        if not pid_file.exists():
            import tempfile
            temp_pid_file = Path(tempfile.gettempdir()) / "annzarro" / "server.pid"
            if temp_pid_file.exists():
                pid_file = temp_pid_file
                logger.info(f"Using alternative PID file location: {pid_file}")
            else:
                logger.error("Server is not running (PID file not found in any location)")
                return 1
        
        logger.info(f"Found PID file at: {pid_file}")
            
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
        # Determine if we should use a virtual environment (default is True unless no_venv is specified)
        use_venv = not getattr(args, 'no_venv', False)
        venv_path = getattr(args, 'venv_path', 'venv')
        
        # Try to use uv for faster dependency installation
        use_uv = getattr(args, 'use_uv', True) and not getattr(args, 'no_uv', False)
        upgrade = getattr(args, 'upgrade', False)
        
        # Find the requirements file
        requirements_file = os.path.join(os.path.dirname(__file__), "server", "requirements.txt")
        
        if not os.path.exists(requirements_file):
            logger.error(f"Requirements file not found: {requirements_file}")
            return 1
        
        # Try to find uv executable if requested
        uv_executable = None
        if use_uv:
            uv_executable = find_uv_executable()
            if not uv_executable:
                logger.warning("UV not found, falling back to pip")
                use_uv = False
            else:
                logger.info(f"Using UV from {uv_executable} for fast dependency installation")
        
        if use_venv:
            logger.info(f"Setting up virtual environment at {venv_path}")
            
            # Create venv directory if it doesn't exist
            if not os.path.exists(venv_path):
                os.makedirs(venv_path, exist_ok=True)
            
            # Create virtual environment
            if use_uv:
                logger.info("Creating virtual environment with UV")
                subprocess.check_call([uv_executable, 'venv', venv_path])
            else:
                logger.info("Creating virtual environment with standard venv module")
                subprocess.check_call([sys.executable, '-m', 'venv', venv_path])
            
            # Get the Python executable from the virtual environment
            if os.name == 'nt':  # Windows
                python_executable = os.path.join(venv_path, 'Scripts', 'python.exe')
                pip_executable = os.path.join(venv_path, 'Scripts', 'pip.exe')
            else:  # Unix-like
                python_executable = os.path.join(venv_path, 'bin', 'python')
                pip_executable = os.path.join(venv_path, 'bin', 'pip')
            
            # Setup environment for UV to use the virtual environment
            env = os.environ.copy()
            if os.name == 'nt':  # Windows
                env["VIRTUAL_ENV"] = os.path.abspath(venv_path)
                env["PATH"] = os.path.join(venv_path, "Scripts") + os.pathsep + env["PATH"]
            else:  # Unix-like
                env["VIRTUAL_ENV"] = os.path.abspath(venv_path)
                env["PATH"] = os.path.join(venv_path, "bin") + os.pathsep + env["PATH"]
            
            # Install dependencies in the virtual environment
            if use_uv:
                logger.info("Installing dependencies with UV in virtual environment")
                pip_cmd = [uv_executable, 'pip', 'install', '-r', requirements_file]
                if upgrade:
                    pip_cmd.append('--upgrade')
                subprocess.check_call(pip_cmd, env=env)
            else:
                logger.info("Upgrading pip in virtual environment")
                subprocess.check_call([python_executable, '-m', 'pip', 'install', '--upgrade', 'pip'])
                
                # Install dependencies in virtual environment
                logger.info("Installing dependencies in virtual environment")
                pip_cmd = [python_executable, '-m', 'pip', 'install', '-r', requirements_file]
                if upgrade:
                    pip_cmd.append('--upgrade')
                subprocess.check_call(pip_cmd)
            
            # Install annzarro in development mode
            logger.info("Installing AnnZarro in development mode in virtual environment")
            project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            if use_uv:
                subprocess.check_call([uv_executable, 'pip', 'install', '-e', project_root], env=env)
            else:
                subprocess.check_call([python_executable, '-m', 'pip', 'install', '-e', project_root])
            
            logger.info(f"Virtual environment setup complete at {venv_path}")
            logger.info(f"Activate with: source {os.path.join(venv_path, 'bin', 'activate')} (Unix) or {os.path.join(venv_path, 'Scripts', 'activate')} (Windows)")
        
        else:
            # Install dependencies directly in current Python environment
            logger.info("Installing Python dependencies...")
            
            if use_uv:
                # Install with UV
                pip_cmd = [uv_executable, 'pip', 'install', '-r', requirements_file]
                if upgrade:
                    pip_cmd.append('--upgrade')
                subprocess.check_call(pip_cmd)
            else:
                # Install with pip
                pip_cmd = [sys.executable, "-m", "pip", "install", "-r", requirements_file]
                if upgrade:
                    pip_cmd.append('--upgrade')
                subprocess.check_call(pip_cmd)
            
            logger.info("Python dependencies installed successfully")
        
        return 0
        
    except Exception as e:
        logger.error(f"Error installing dependencies: {e}")
        if getattr(args, 'debug', False):
            import traceback
            traceback.print_exc()
        return 1


def find_uv_executable() -> str:
    """
    Find the uv executable on the system
    
    Returns:
        Path to uv executable or None if not found
    """
    # First, check the desktop directory for bundled uv
    try:
        desktop_dir = os.path.join(os.path.dirname(__file__), "desktop", "electron", "bin")
        
        # Determine platform directory
        import platform
        system = platform.system().lower()
        machine = platform.machine().lower()
        
        # Map to directory name
        if system == 'darwin':  # macOS
            if 'arm64' in machine or 'aarch64' in machine:
                platform_dir = 'darwin-arm64'
            else:
                platform_dir = 'darwin-x64'
        elif system == 'windows' or system == 'win32':
            platform_dir = 'win32-x64'
        elif system == 'linux':
            platform_dir = 'linux-x64'
        else:
            platform_dir = None
        
        # Check for platform-specific uv
        if platform_dir:
            uv_name = 'uv.exe' if system == 'windows' or system == 'win32' else 'uv'
            uv_path = os.path.join(desktop_dir, platform_dir, uv_name)
            
            if os.path.exists(uv_path):
                # Make sure it's executable on Unix
                if system != 'windows' and system != 'win32':
                    os.chmod(uv_path, 0o755)
                return uv_path
    except Exception as e:
        logger.debug(f"Error looking for bundled uv: {e}")
    
    # Next, check common system locations
    common_paths = []
    
    if os.name == 'nt':  # Windows
        common_paths.extend([
            os.path.expanduser('~/.cargo/bin/uv.exe'),
            'C:\\ProgramData\\uv\\uv.exe',
            'C:\\Program Files\\uv\\uv.exe',
            'C:\\Program Files (x86)\\uv\\uv.exe'
        ])
    else:  # Unix-like
        common_paths.extend([
            '/usr/local/bin/uv',
            '/usr/bin/uv',
            '/opt/homebrew/bin/uv',
            os.path.expanduser('~/.cargo/bin/uv')
        ])
    
    for path in common_paths:
        if os.path.exists(path):
            return path
    
    # Finally, check if uv is in PATH
    try:
        if os.name == 'nt':  # Windows
            # Check with where command
            output = subprocess.check_output(['where', 'uv'], stderr=subprocess.STDOUT, text=True)
            if output:
                return output.split('\n')[0].strip()
        else:  # Unix-like
            # Check with which command
            output = subprocess.check_output(['which', 'uv'], stderr=subprocess.STDOUT, text=True)
            if output:
                return output.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass
    
    # UV not found
    return None

def desktop_command(args: argparse.Namespace) -> int:
    """
    Handle desktop application-related commands
    
    Args:
        args: Command line arguments
        
    Returns:
        Exit code
    """
    # Import here to avoid circular imports
    try:
        from .desktop.builder import build_desktop_app, run_desktop_app
    except ImportError as e:
        logger.error(f"Failed to import desktop builder: {e}")
        logger.error("Please ensure the desktop module is installed.")
        return 1
        
    # Run desktop app in development mode
    if args.desktop_command == "run":
        logger.info("Running desktop application in development mode")
        
        if run_desktop_app(icon_source=args.icon):
            logger.info("Desktop application started successfully")
            return 0
        else:
            logger.error("Failed to start desktop application")
            return 1
            
    # Build desktop application
    elif args.desktop_command == "build":
        platform = args.platform
        rebuild = args.rebuild
        bundle_venv = args.bundle_venv
        venv_path = args.venv_path
        
        logger.info(f"Building desktop application for {platform or 'all platforms'}")
        if bundle_venv:
            logger.info(f"Will bundle Python virtual environment{' at ' + venv_path if venv_path else ''}")
        
        if build_desktop_app(platform, rebuild, icon_source=args.icon, 
                             bundle_venv=bundle_venv, venv_path=venv_path):
            logger.info("Desktop application built successfully")
            return 0
        else:
            logger.error("Failed to build desktop application")
            return 1
            
    # Generate favicons for both desktop and web
    elif args.desktop_command == "icons":
        if not args.icon:
            logger.error("No source icon provided. Use --icon to specify a source icon file.")
            return 1
            
        logger.info(f"Generating icons from {args.icon}")
        
        try:
            # Import icon generator
            from .desktop.icon_generator import generate_desktop_icons, generate_web_favicons
            
            success = True
            
            # Generate desktop icons if requested
            if args.desktop_icons or args.all:
                logger.info("Generating desktop application icons")
                if generate_desktop_icons(args.icon):
                    logger.info("Desktop icons generated successfully")
                else:
                    logger.error("Failed to generate desktop icons")
                    success = False
                    
            # Generate web favicons if requested
            if args.web_icons or args.all:
                logger.info("Generating web server favicons")
                if generate_web_favicons(args.icon):
                    logger.info("Web favicons generated successfully")
                else:
                    logger.error("Failed to generate web favicons")
                    success = False
                    
            return 0 if success else 1
                
        except ImportError as e:
            logger.error(f"Failed to import icon generator: {e}")
            logger.error("Make sure Pillow is installed: pip install Pillow")
            return 1
            
    else:
        logger.error(f"Unknown desktop command: {args.desktop_command}")
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
        env = args.env  # Default already set to production
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
        if args.file:
            # Validate a specific file
            logger.info(f"Validating configuration file: {args.file}")
            if not os.path.exists(args.file):
                logger.error(f"File not found: {args.file}")
                return 1
                
            try:
                # Create a new config manager instance for file validation
                from annzarro.utils.config_manager import ConfigManager
                validator = ConfigManager()
                
                # Load just the file to validate
                validator._load_yaml_config(args.file, "file_to_validate")
                
                # Check for validation errors
                is_valid, errors = validator.validate_config()
                
                if is_valid:
                    logger.info(f"Configuration file {args.file} is valid")
                    return 0
                else:
                    logger.error(f"Configuration file {args.file} has validation errors:")
                    for error in errors:
                        logger.error(f"  - {error}")
                    return 1
            except Exception as e:
                logger.error(f"Error validating configuration file: {e}")
                if args.debug:
                    import traceback
                    traceback.print_exc()
                return 1
        else:
            # Validate full configuration
            env = args.env  # Default already set to production
            config = load_config(config_path=args.config, env=env)
            
            # Check validation result
            is_valid, errors = config_manager.validate_config()
            
            if is_valid:
                logger.info("Configuration is valid")
                return 0
            else:
                logger.error("Configuration validation failed:")
                for error in errors:
                    logger.error(f"  - {error}")
                return 1
        
    elif args.config_command == "info":
        # Show configuration source information
        env = args.env  # Default already set to production
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
    start_parser.add_argument('--development', action='store_true', help="Run in development mode (less secure)")
    start_parser.add_argument('--config', help="Path to configuration file")
    start_parser.add_argument('--venv-path', help="Path to Python virtual environment")
    start_parser.add_argument('--auth-disabled', action='store_true', help="Disable authentication")
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
    venv_group = install_parser.add_mutually_exclusive_group()
    venv_group.add_argument('--venv', action='store_true', help="Create and use a virtual environment (default)")
    venv_group.add_argument('--no-venv', action='store_true', help="Don't use a virtual environment")
    install_parser.add_argument('--venv-path', type=str, default='venv', help="Path for virtual environment (default: venv)")
    install_parser.add_argument('--no-uv', action='store_true', help="Disable UV and use pip instead")
    install_parser.add_argument('--upgrade', action='store_true', help="Upgrade existing packages")
    install_parser.set_defaults(func=install_dependencies, use_uv=True)
    
    # Configuration command
    config_parser = subparsers.add_parser('config', help="Manage configuration")
    config_subparsers = config_parser.add_subparsers(dest='config_command', help="Configuration command")
    
    # Config show command
    config_show_parser = config_subparsers.add_parser('show', help="Show current configuration")
    config_show_parser.add_argument('--format', choices=['json', 'yaml'], default='yaml', help="Output format")
    config_show_parser.add_argument('--env', choices=['development', 'production'], default='production', help="Environment")
    
    # Config init command
    config_init_parser = config_subparsers.add_parser('init', help="Initialize a new configuration file")
    config_init_parser.add_argument('--output', help="Output file path")
    config_init_parser.add_argument('--force', action='store_true', help="Overwrite existing file")
    
    # Config validate command
    config_validate_parser = config_subparsers.add_parser('validate', help="Validate configuration")
    config_validate_parser.add_argument('--env', choices=['development', 'production'], default='production', help="Environment")
    config_validate_parser.add_argument('--file', help="Validate a specific configuration file")
    
    # Config info command
    config_info_parser = config_subparsers.add_parser('info', help="Show configuration source information")
    config_info_parser.add_argument('--env', choices=['development', 'production'], default='production', help="Environment")
    
    config_parser.set_defaults(func=config_command)
    
    # Desktop application command
    desktop_parser = subparsers.add_parser('desktop', help="Desktop application tools")
    desktop_subparsers = desktop_parser.add_subparsers(dest='desktop_command', help="Desktop command")
    
    # Icon argument for all desktop commands
    desktop_parser.add_argument('--icon', type=str, help="Path to source icon file for icon generation")
    
    # Desktop run command
    desktop_run_parser = desktop_subparsers.add_parser('run', help="Run desktop application in development mode")
    desktop_run_parser.add_argument('--icon', type=str, help="Path to source icon file for icon generation")
    
    # Desktop build command
    desktop_build_parser = desktop_subparsers.add_parser('build', help="Build desktop application")
    desktop_build_parser.add_argument('--platform', choices=['windows', 'win', 'mac', 'macos', 'linux', 'all'], 
                                     help="Target platform (default: current platform)")
    desktop_build_parser.add_argument('--rebuild', action='store_true', help="Force rebuild dependencies")
    desktop_build_parser.add_argument('--icon', type=str, help="Path to source icon file for icon generation")
    desktop_build_parser.add_argument('--bundle-venv', action='store_true', default=True, 
                                     help="Bundle Python virtual environment with the application (default: True)")
    desktop_build_parser.add_argument('--no-bundle-venv', action='store_false', dest='bundle_venv',
                                     help="Don't bundle Python virtual environment")
    desktop_build_parser.add_argument('--venv-path', type=str, help="Custom path for the Python virtual environment")
    
    # Desktop icons command
    desktop_icons_parser = desktop_subparsers.add_parser('icons', help="Generate application icons")
    desktop_icons_parser.add_argument('--icon', type=str, required=True, help="Path to source icon file (high-res PNG)")
    desktop_icons_parser.add_argument('--desktop-icons', action='store_true', help="Generate desktop application icons")
    desktop_icons_parser.add_argument('--web-icons', action='store_true', help="Generate web server favicons")
    desktop_icons_parser.add_argument('--all', action='store_true', help="Generate all icon types")
    
    desktop_parser.set_defaults(func=desktop_command)
    
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
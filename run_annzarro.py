#!/usr/bin/env python3
"""
Annzarro: Python-based Single-Cell Data Visualization Tool
---------------------------------------------------------
Main entry point for launching the Annzarro application.
"""

import os
import sys
import argparse
import subprocess
import signal
import logging
import json
import getpass
import time
from pathlib import Path

# Root directory
ROOT_DIR = Path(__file__).resolve().parent

def install_requirements():
    """Install required Python packages"""
    print("Installing required packages...")
    requirements = [
        "flask",
        "flask-limiter",
        "flask-cors",
        "werkzeug",
        "gunicorn",
        "pyjwt",
        "cryptography",
        "zarr",
        "numpy",
        "pandas",
        "matplotlib",
        "numba",  # For faster zarr operations
        "requests"
    ]
    
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--user"] + requirements)
        print("Requirements installed successfully.")
        return True
    except subprocess.CalledProcessError as e:
        print(f"Error installing requirements: {e}")
        print("Please install the following packages manually:")
        for req in requirements:
            print(f"  - {req}")
        return False

def install_dev_requirements():
    """Install development requirements"""
    print("Installing development packages...")
    dev_requirements = [
        "pytest",
        "pytest-cov",
        "black",
        "isort",
        "mypy",
        "pylint"
    ]
    
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--user"] + dev_requirements)
        print("Development requirements installed successfully.")
        return True
    except subprocess.CalledProcessError as e:
        print(f"Error installing development requirements: {e}")
        return False

def create_user(username=None, password=None, admin=False):
    """Create a new user"""
    # Import here to avoid import errors if packages are not installed
    try:
        from annzarro.server.auth import AuthManager
    except ImportError:
        print("Error: Server module not found. Make sure annzarro/server/auth.py exists.")
        return False
    
    if not username:
        username = input("Enter username: ")
        
    if not password:
        password = getpass.getpass("Enter password: ")
        confirm = getpass.getpass("Confirm password: ")
        
        if password != confirm:
            print("Passwords do not match.")
            return False
    
    try:
        # Use the default user file path from config
        config_file = ROOT_DIR / "annzarro" / "server" / "config.json"
        if config_file.exists():
            with open(config_file, 'r') as f:
                config = json.load(f)
                user_file = config.get('user_file', 'annzarro/server/users.json')
        else:
            user_file = 'annzarro/server/users.json'
            
        auth_manager = AuthManager(user_file=user_file)
        
        if auth_manager.create_user(username, password, is_admin=admin):
            print(f"User '{username}' created successfully.")
            if admin:
                print("User has admin privileges.")
            return True
        else:
            print(f"Failed to create user '{username}'. Username may already exist.")
            return False
    except Exception as e:
        print(f"Error creating user: {e}")
        return False

def start_server(config_file=None, debug=False):
    """Start the Annzarro server"""
    try:
        cmd = [sys.executable, "-m", "annzarro.server"]
        
        if config_file:
            cmd.extend(["-c", config_file])
            
        if debug:
            cmd.append("--debug")
            
        # Start the server
        print("Starting Annzarro server...")
        process = subprocess.Popen(cmd)
        
        # Save the PID to a file
        with open("server_pid.txt", "w") as f:
            f.write(str(process.pid))
            
        print(f"Server started with PID {process.pid}")
        print("To stop the server, press Ctrl+C or run: python run_annzarro.py --stop")
        
        # Wait for termination
        try:
            process.wait()
        except KeyboardInterrupt:
            print("\nShutting down server...")
            process.terminate()
            process.wait(timeout=5)
            print("Server stopped.")
            
    except Exception as e:
        print(f"Error starting server: {e}")
        return False
        
    return True

def stop_server():
    """Stop the Annzarro server"""
    try:
        if os.path.exists("server_pid.txt"):
            with open("server_pid.txt", "r") as f:
                pid = int(f.read().strip())
                
            try:
                os.kill(pid, signal.SIGTERM)
                print(f"Sent termination signal to server (PID {pid})")
                
                # Wait for process to stop
                import time
                for _ in range(5):
                    time.sleep(1)
                    try:
                        os.kill(pid, 0)  # Check if process exists
                    except OSError:
                        # Process has stopped
                        break
                else:
                    # Process didn't stop, try SIGKILL
                    try:
                        os.kill(pid, signal.SIGKILL)
                        print(f"Sent SIGKILL to server (PID {pid})")
                    except OSError:
                        pass
                
                os.remove("server_pid.txt")
                print("Server stopped.")
                
            except OSError as e:
                if e.errno == 3:  # No such process
                    print(f"Server (PID {pid}) is not running.")
                    os.remove("server_pid.txt")
                else:
                    print(f"Error stopping server: {e}")
        else:
            print("No running server found.")
            
    except Exception as e:
        print(f"Error: {e}")
        return False
        
    return True

def initialize_project():
    """Initialize the project structure for pip installation"""
    print("Initializing Annzarro project structure...")
    
    # Create directory structure if it doesn't exist
    directories = [
        "annzarro",
        "annzarro/core",
        "annzarro/data",
        "annzarro/server",
        "annzarro/utils",
        "annzarro/ui",
        "tests",
        "tests/unit",
        "tests/integration",
        "docs"
    ]
    
    for directory in directories:
        os.makedirs(directory, exist_ok=True)
        init_file = os.path.join(directory, "__init__.py")
        if not os.path.exists(init_file):
            with open(init_file, "w") as f:
                f.write('"""Annzarro package."""\n')
    
    # Create setup.py if it doesn't exist
    if not os.path.exists("setup.py"):
        with open("setup.py", "w") as f:
            f.write("""from setuptools import setup, find_packages

setup(
    name="annzarro",
    version="1.0.0",
    packages=find_packages(),
    install_requires=[
        "flask>=2.0.0",
        "flask-limiter>=2.0.0",
        "flask-cors>=3.0.0",
        "werkzeug>=2.0.0",
        "gunicorn>=20.0.0",
        "pyjwt>=2.0.0",
        "cryptography>=3.0.0",
        "zarr>=2.0.0",
        "numpy>=1.20.0",
        "pandas>=1.3.0",
        "matplotlib>=3.4.0",
        "numba>=0.53.0",
        "requests>=2.25.0"
    ],
    package_data={
        "annzarro": ["static/*", "templates/*"],
    },
    python_requires=">=3.7",
    entry_points={
        "console_scripts": [
            "annzarro=annzarro.cli:main",
        ],
    },
    author="",
    author_email="",
    description="Python-based Single-Cell Data Visualization Tool",
    keywords="bioinformatics, single-cell, zarr, anndata, visualization",
    url="",
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Science/Research",
        "Topic :: Scientific/Engineering :: Bio-Informatics",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.7",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
    ],
)
""")
    
    # Create pyproject.toml
    if not os.path.exists("pyproject.toml"):
        with open("pyproject.toml", "w") as f:
            f.write("""[build-system]
requires = ["setuptools>=42", "wheel"]
build-backend = "setuptools.build_meta"

[tool.black]
line-length = 88
target-version = ['py37', 'py38', 'py39']

[tool.isort]
profile = "black"
""")
    
    # Create CLI module
    cli_file = "annzarro/cli.py"
    if not os.path.exists(cli_file):
        with open(cli_file, "w") as f:
            f.write("""#!/usr/bin/env python3
\"\"\"
Command-line interface for Annzarro
\"\"\"

import argparse
import sys
from pathlib import Path

def main():
    \"\"\"Main CLI entry point\"\"\"
    parser = argparse.ArgumentParser(description="Annzarro: Python-based Single-Cell Data Visualization Tool")
    subparsers = parser.add_subparsers(dest="command", help="Command to run")
    
    # Server command
    server_parser = subparsers.add_parser("server", help="Start the Annzarro server")
    server_parser.add_argument("-c", "--config", type=str, help="Path to config file")
    server_parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    server_parser.add_argument("-p", "--port", type=int, default=8000, help="Port to run the server on")
    
    # Data command
    data_parser = subparsers.add_parser("data", help="Data management commands")
    data_subparsers = data_parser.add_subparsers(dest="data_command", help="Data command to run")
    
    # Data list command
    list_parser = data_subparsers.add_parser("list", help="List available datasets")
    list_parser.add_argument("-d", "--directory", type=str, help="Directory containing datasets")
    
    # Data info command
    info_parser = data_subparsers.add_parser("info", help="Get information about a dataset")
    info_parser.add_argument("path", type=str, help="Path to the dataset")
    
    # Parse arguments
    args = parser.parse_args()
    
    # Execute command
    if args.command == "server":
        from annzarro.server import run_server
        run_server(config_file=args.config, debug=args.debug, port=args.port)
    elif args.command == "data":
        if args.data_command == "list":
            from annzarro.data.manager import list_datasets
            datasets = list_datasets(args.directory)
            for ds in datasets:
                print(f"{ds['name']} - {ds['path']}")
        elif args.data_command == "info":
            from annzarro.data.manager import get_dataset_info
            info = get_dataset_info(args.path)
            for key, value in info.items():
                print(f"{key}: {value}")
        else:
            data_parser.print_help()
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
""")
    
    print("Project initialized successfully.")
    return True

def main():
    """Main function"""
    parser = argparse.ArgumentParser(description="Annzarro Application Manager")
    
    # Command options
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--start", action="store_true", help="Start the server")
    group.add_argument("--stop", action="store_true", help="Stop the server")
    group.add_argument("--restart", action="store_true", help="Restart the server")
    group.add_argument("--create-user", action="store_true", help="Create a new user")
    group.add_argument("--install", action="store_true", help="Install required packages")
    group.add_argument("--install-dev", action="store_true", help="Install development packages")
    group.add_argument("--init", action="store_true", help="Initialize project structure")
    
    # Server options
    parser.add_argument("-c", "--config", type=str, default="annzarro/server/config.json", help="Path to config file")
    parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    
    # User options
    parser.add_argument("-u", "--username", type=str, help="Username (for user creation)")
    parser.add_argument("-p", "--password", type=str, help="Password (for user creation)")
    parser.add_argument("--admin", action="store_true", help="Create user with admin privileges")
    
    args = parser.parse_args()
    
    if args.install:
        install_requirements()
        return
    
    if args.install_dev:
        install_dev_requirements()
        return
    
    if args.init:
        initialize_project()
        return
        
    if args.create_user:
        create_user(args.username, args.password, args.admin)
        return
        
    if args.stop or args.restart:
        stop_server()
        if args.stop:
            return
    
    if args.start or args.restart:
        start_server(args.config, args.debug)

if __name__ == "__main__":
    main()
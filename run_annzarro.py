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

def start_server(config_file=None, debug=False, frontend_only=False, backend_only=False):
    """Start the Annzarro server"""
    processes = []
    
    try:
        # Start backend server if requested
        if not frontend_only:
            cmd = [sys.executable, "-m", "annzarro.server"]
            
            if config_file:
                cmd.extend(["-c", config_file])
                
            if debug:
                cmd.append("--debug")
                
            # Start the backend server
            print("Starting Annzarro backend server...")
            backend_process = subprocess.Popen(cmd)
            processes.append(('backend', backend_process))
            
            # Save the backend PID to a file
            with open("backend_pid.txt", "w") as f:
                f.write(str(backend_process.pid))
                
            print(f"Backend server started with PID {backend_process.pid}")
        
        # Start frontend server if requested
        if not backend_only:
            # Choose HTTP server based on Python version
            if sys.version_info >= (3, 7):
                # Use Python's built-in HTTP server
                frontend_cmd = [sys.executable, "-m", "http.server", "8080"]
            else:
                # Fallback for older Python versions
                frontend_cmd = [sys.executable, "-m", "SimpleHTTPServer", "8080"]
            
            # Start the frontend server
            print("Starting frontend server...")
            frontend_process = subprocess.Popen(frontend_cmd)
            processes.append(('frontend', frontend_process))
            
            # Save the frontend PID to a file
            with open("frontend_pid.txt", "w") as f:
                f.write(str(frontend_process.pid))
                
            print(f"Frontend server started with PID {frontend_process.pid}")
        
        # Combine PIDs into a single file for easier management
        with open("server_pids.txt", "w") as f:
            for name, process in processes:
                f.write(f"{name},{process.pid}\n")
        
        print("\nServers are now running!")
        print("- Backend API:  http://localhost:8000/api/v1")
        print("- Frontend UI:  http://localhost:8080")
        print("\nTo stop the servers, press Ctrl+C or run: python run_annzarro.py --stop")
        
        # Wait for termination
        try:
            # Wait for all processes
            for _, process in processes:
                process.wait()
        except KeyboardInterrupt:
            print("\nShutting down servers...")
            for name, process in processes:
                print(f"Stopping {name} server (PID {process.pid})...")
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    print(f"Forcing shutdown of {name} server...")
                    process.kill()
            print("All servers stopped.")
            
    except Exception as e:
        print(f"Error starting servers: {e}")
        # Try to clean up any running processes
        for _, process in processes:
            try:
                process.terminate()
            except:
                pass
        return False
        
    return True

def stop_server():
    """Stop the Annzarro server"""
    servers_stopped = False
    
    # Check for the combined PIDs file first
    if os.path.exists("server_pids.txt"):
        try:
            with open("server_pids.txt", "r") as f:
                server_entries = [line.strip().split(',') for line in f if line.strip()]
                
            print(f"Found {len(server_entries)} servers to stop")
            
            for server_type, pid_str in server_entries:
                try:
                    pid = int(pid_str)
                    print(f"Stopping {server_type} server (PID {pid})...")
                    
                    # Try to terminate the process
                    try:
                        os.kill(pid, signal.SIGTERM)
                        
                        # Wait for process to stop
                        for _ in range(5):
                            time.sleep(1)
                            try:
                                os.kill(pid, 0)  # Check if process exists
                            except OSError:
                                # Process has stopped
                                print(f"- {server_type} server stopped successfully")
                                break
                        else:
                            # Process didn't stop, try SIGKILL
                            try:
                                os.kill(pid, signal.SIGKILL)
                                print(f"- Forced {server_type} server shutdown with SIGKILL")
                            except OSError:
                                pass
                            
                    except OSError as e:
                        if e.errno == 3:  # No such process
                            print(f"- {server_type} server (PID {pid}) is not running")
                        else:
                            print(f"- Error stopping {server_type} server: {e}")
                except ValueError:
                    print(f"Invalid PID format for {server_type}: {pid_str}")
            
            # Remove PID files
            os.remove("server_pids.txt")
            for file in ["frontend_pid.txt", "backend_pid.txt", "server_pid.txt"]:
                if os.path.exists(file):
                    os.remove(file)
                    
            servers_stopped = True
            print("All servers stopped")
            
        except Exception as e:
            print(f"Error processing server_pids.txt: {e}")
    
    # Fallback to individual PID files
    if not servers_stopped:
        pid_files = [
            ("backend", "backend_pid.txt"),
            ("frontend", "frontend_pid.txt"),
            ("server", "server_pid.txt")  # Legacy support
        ]
        
        servers_stopped = False
        for server_type, pid_file in pid_files:
            if os.path.exists(pid_file):
                try:
                    with open(pid_file, "r") as f:
                        pid = int(f.read().strip())
                        
                    print(f"Stopping {server_type} server (PID {pid})...")
                    
                    # Try to terminate the process
                    try:
                        os.kill(pid, signal.SIGTERM)
                        
                        # Wait for process to stop
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
                                print(f"Forced {server_type} server shutdown with SIGKILL")
                            except OSError:
                                pass
                        
                        os.remove(pid_file)
                        servers_stopped = True
                        print(f"{server_type.capitalize()} server stopped")
                        
                    except OSError as e:
                        if e.errno == 3:  # No such process
                            print(f"{server_type.capitalize()} server (PID {pid}) is not running")
                            os.remove(pid_file)
                            servers_stopped = True
                        else:
                            print(f"Error stopping {server_type} server: {e}")
                            
                except Exception as e:
                    print(f"Error processing {pid_file}: {e}")
    
    if not servers_stopped:
        print("No running servers found")
            
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
    group.add_argument("--start", action="store_true", help="Start the servers (both backend and frontend)")
    group.add_argument("--stop", action="store_true", help="Stop the servers")
    group.add_argument("--restart", action="store_true", help="Restart the servers")
    group.add_argument("--start-backend", action="store_true", help="Start only the backend server")
    group.add_argument("--start-frontend", action="store_true", help="Start only the frontend server")
    group.add_argument("--create-user", action="store_true", help="Create a new user")
    group.add_argument("--install", action="store_true", help="Install required packages")
    group.add_argument("--install-dev", action="store_true", help="Install development packages")
    group.add_argument("--init", action="store_true", help="Initialize project structure")
    
    # Server options
    parser.add_argument("-c", "--config", type=str, default="annzarro/server/config.json", help="Path to config file")
    parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    parser.add_argument("--backend-port", type=int, default=8000, help="Port for the backend server (default: 8000)")
    parser.add_argument("--frontend-port", type=int, default=8080, help="Port for the frontend server (default: 8080)")
    
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
    
    if args.start:
        # Start both servers
        start_server(args.config, args.debug)
    elif args.start_backend:
        # Start only backend server
        start_server(args.config, args.debug, frontend_only=False, backend_only=True)
    elif args.start_frontend:
        # Start only frontend server
        start_server(args.config, args.debug, frontend_only=True, backend_only=False)
    elif args.restart:
        # Restart both servers
        start_server(args.config, args.debug)

if __name__ == "__main__":
    main()
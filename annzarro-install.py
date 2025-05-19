#!/usr/bin/env python3
"""
Standalone installation script for AnnZarro that doesn't require any dependencies.
This script is designed to bootstrap the installation of AnnZarro and its dependencies.
"""

import os
import sys

# Check Python version
if sys.version_info < (3, 7):
    print("Error: Python 3.7 or newer is required for AnnZarro")
    print(f"Current Python version: {sys.version}")
    print("Please upgrade your Python installation or use a different Python executable.")
    sys.exit(1)

import subprocess
import argparse
import logging
import traceback
import platform
import urllib.request
import json
import re
import shutil
from pathlib import Path

# Configure basic logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("annzarro-install")

# External resources to download for electron packaging
EXTERNAL_RESOURCES = [
    # CSS files
    {"url": "https://cdn.jsdelivr.net/npm/bootstrap@5.2.3/dist/css/bootstrap.min.css", "type": "css"},
    {"url": "https://cdn.datatables.net/1.13.4/css/jquery.dataTables.min.css", "type": "css"},
    {"url": "https://cdn.datatables.net/searchbuilder/1.4.2/css/searchBuilder.dataTables.min.css", "type": "css"},
    {"url": "https://cdn.datatables.net/select/1.6.2/css/select.dataTables.min.css", "type": "css"},
    {"url": "https://cdn.datatables.net/buttons/2.3.6/css/buttons.dataTables.min.css", "type": "css"},
    {"url": "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css", "type": "css"},
    {"url": "https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css", "type": "css"},
    
    # JavaScript files - Core libraries
    {"url": "https://code.jquery.com/jquery-3.6.4.min.js", "type": "js"},
    {"url": "https://cdn.jsdelivr.net/npm/bootstrap@5.2.3/dist/js/bootstrap.bundle.min.js", "type": "js"},
    {"url": "https://cdn.plot.ly/plotly-2.20.0.min.js", "type": "js"},
    
    # DataTables core and extensions (replacing the builder URL with direct CDN links)
    {"url": "https://cdn.datatables.net/1.13.4/js/jquery.dataTables.min.js", "type": "js"},
    {"url": "https://cdn.datatables.net/1.13.4/js/dataTables.bootstrap5.min.js", "type": "js"},
    {"url": "https://cdn.datatables.net/1.13.4/css/dataTables.bootstrap5.min.css", "type": "css"},
    {"url": "https://cdn.datatables.net/buttons/2.3.6/js/dataTables.buttons.min.js", "type": "js"},
    {"url": "https://cdn.datatables.net/buttons/2.3.6/js/buttons.bootstrap5.min.js", "type": "js"},
    {"url": "https://cdn.datatables.net/buttons/2.3.6/css/buttons.bootstrap5.min.css", "type": "css"},
    {"url": "https://cdn.datatables.net/buttons/2.3.6/js/buttons.html5.min.js", "type": "js"},
    {"url": "https://cdn.datatables.net/searchbuilder/1.4.2/js/dataTables.searchBuilder.min.js", "type": "js"},
    {"url": "https://cdn.datatables.net/searchbuilder/1.4.2/js/searchBuilder.bootstrap5.min.js", "type": "js"},
    {"url": "https://cdn.datatables.net/searchbuilder/1.4.2/css/searchBuilder.bootstrap5.min.css", "type": "css"},
    {"url": "https://cdn.datatables.net/select/1.6.2/js/dataTables.select.min.js", "type": "js"},
    {"url": "https://cdn.datatables.net/select/1.6.2/css/select.bootstrap5.min.css", "type": "css"},
    {"url": "https://cdn.datatables.net/fixedheader/3.3.2/js/dataTables.fixedHeader.min.js", "type": "js"},
    {"url": "https://cdn.datatables.net/fixedheader/3.3.2/css/fixedHeader.bootstrap5.min.css", "type": "css"},
    {"url": "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js", "type": "js"},
    {"url": "https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/pdfmake.min.js", "type": "js"},
    {"url": "https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/vfs_fonts.js", "type": "js"},
    
    # Other libraries
    {"url": "https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js", "type": "js"},
    {"url": "https://cdn.jsdelivr.net/npm/chroma-js@2.4.2/chroma.min.js", "type": "js"},
]

# FontAwesome has additional CSS and web font files we need to download
FONTAWESOME_RESOURCES = [
    {"url": "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-brands-400.woff2", "type": "font"},
    {"url": "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.woff2", "type": "font"},
    {"url": "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2", "type": "font"},
    {"url": "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-v4compatibility.woff2", "type": "font"},
]

def download_external_resources(repo_root, args):
    """
    Download external CSS and JavaScript resources for offline use in the Electron app
    
    Args:
        repo_root: Root directory of the repository
        args: Command line arguments
    
    Returns:
        True if successful, False otherwise
    """
    # Always download resources by default with --all, or if explicitly requested
    # Can be disabled with --no-electron-resources
    if hasattr(args, 'no_electron_resources') and args.no_electron_resources:
        logger.debug("Skipping external resources download (disabled by flag)")
        return True
    
    logger.info("Downloading external resources for offline use in Electron app")
    
    # Ensure DataTables directory exists in vendor
    datatables_dir = os.path.join(repo_root, "static", "vendor", "DataTables")
    os.makedirs(datatables_dir, exist_ok=True)
    logger.info(f"Created DataTables directory: {datatables_dir}")
    
    # Create static directory structure for all assets
    static_dir = os.path.join(repo_root, "static")
    if not os.path.exists(static_dir):
        logger.info(f"Creating static directory: {static_dir}")
        os.makedirs(static_dir, exist_ok=True)
        
    # Set up CSS directory
    static_css_dir = os.path.join(static_dir, "css")
    logger.info(f"Creating static/css directory: {static_css_dir}")
    os.makedirs(static_css_dir, exist_ok=True)
    
    # Create or ensure styles.css exists
    styles_path = os.path.join(static_css_dir, "styles.css")
    if not os.path.exists(styles_path):
        logger.info(f"Creating empty styles.css in static/css")
        with open(styles_path, 'w') as f:
            f.write("/* AnnZarro custom styles */\n")
    
    # Set up JavaScript directories
    static_js_dir = os.path.join(static_dir, "js")
    logger.info(f"Creating static/js directory: {static_js_dir}")
    os.makedirs(static_js_dir, exist_ok=True)
    
    # Create panels directory in static/js
    static_panels_dir = os.path.join(static_js_dir, "panels")
    logger.info(f"Creating static/js/panels directory: {static_panels_dir}")
    os.makedirs(static_panels_dir, exist_ok=True)
    
    # JS files are now directly in static/js - no need to copy from js/ directory
    logger.info("Using JS files directly from static/js directory")
    
    # Create directories for storing resources
    static_dir = os.path.join(repo_root, "static")
    vendor_dir = os.path.join(static_dir, "vendor")
    
    # Create subdirectories for different resource types
    css_dir = os.path.join(vendor_dir, "css")
    js_dir = os.path.join(vendor_dir, "js")
    fonts_dir = os.path.join(vendor_dir, "webfonts")
    
    for directory in [static_dir, vendor_dir, css_dir, js_dir, fonts_dir]:
        os.makedirs(directory, exist_ok=True)
        logger.debug(f"Created directory: {directory}")
    
    # Download each resource
    success_count = 0
    
    all_resources = EXTERNAL_RESOURCES + FONTAWESOME_RESOURCES
    total_resources = len(all_resources)
    
    for i, resource in enumerate(all_resources, 1):
        url = resource["url"]
        res_type = resource["type"]
        
        # Extract filename from URL
        filename = url.split("/")[-1]
        
        # Determine target directory based on resource type
        if res_type == "css":
            target_dir = css_dir
        elif res_type == "js":
            target_dir = js_dir
        elif res_type == "font":
            target_dir = fonts_dir
        else:
            target_dir = vendor_dir
        
        # Check if a custom destination path is specified
        if "dest" in resource:
            # Use the custom destination path
            dest_parts = resource["dest"].split("/")
            if len(dest_parts) > 1:
                # If the dest has a directory, create it if needed
                dest_dir = os.path.join(vendor_dir, *dest_parts[:-1])
                os.makedirs(dest_dir, exist_ok=True)
                target_path = os.path.join(vendor_dir, resource["dest"])
            else:
                target_path = os.path.join(target_dir, resource["dest"])
        else:
            target_path = os.path.join(target_dir, filename)
        
        try:
            logger.info(f"Downloading [{i}/{total_resources}]: {filename}")
            # Add User-Agent header to avoid 403 Forbidden errors
            opener = urllib.request.build_opener()
            opener.addheaders = [('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')]
            urllib.request.install_opener(opener)
            urllib.request.urlretrieve(url, target_path)
            logger.debug(f"Downloaded {url} to {target_path}")
            success_count += 1
        except Exception as e:
            logger.error(f"Failed to download {url}: {e}")
    
    if success_count == total_resources:
        logger.info(f"Successfully downloaded all {total_resources} external resources")
        
        # Verify that the template directory exists
        template_dir = os.path.join(repo_root, "templates")
        index_path = os.path.join(template_dir, "index.html")
        
        if not os.path.exists(index_path):
            logger.error(f"Index template not found: {index_path}")
            return False
        
        # All resources downloaded successfully and template exists
        logger.info("All resources downloaded for offline use")
        return True
    else:
        logger.error(f"Only downloaded {success_count}/{total_resources} resources")
        return False

def find_uv_executable():
    """
    Find the uv executable on the system
    
    Returns:
        Path to uv executable or None if not found
    """
    # First, check the desktop directory for bundled uv
    try:
        desktop_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 
                                  "annzarro", "desktop", "electron", "bin")
        
        # Determine platform directory
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

def install_dependencies(args):
    """
    Install dependencies for AnnZarro using a standalone approach
    
    Args:
        args: Command line arguments
    
    Returns:
        Exit code
    """
    try:
        # Determine if we should use a virtual environment (default is True unless no_venv is specified)
        use_venv = not args.no_venv
        venv_path = args.venv_path
        
        # Try to use uv for faster dependency installation
        use_uv = args.use_uv or not args.no_uv
        upgrade = args.upgrade
        
        # Find the requirements files
        repo_root = os.path.dirname(os.path.abspath(__file__))
        requirements_file = os.path.join(repo_root, "annzarro", "server", "requirements.txt")
        extras_file = os.path.join(repo_root, "annzarro", "server", "requirements-extras.txt")
        
        # We'll download external resources after setting up the environment to use proper Python
        download_resources = not hasattr(args, 'no_electron_resources') or not args.no_electron_resources
        
        if not os.path.exists(requirements_file):
            logger.error(f"Requirements file not found: {requirements_file}")
            return 1
            
        # Check if extras file exists, create if not
        if not os.path.exists(extras_file):
            logger.info(f"Creating extras requirements file: {extras_file}")
            with open(extras_file, 'w') as f:
                f.write("""# Essential computational libraries
scipy>=1.8.0          # For sparse matrices and scientific computing
fsspec>=2022.1.0      # Filesystem interfaces
dask>=2022.1.0        # Parallel processing
h5py>=3.6.0           # HDF5 file support
plotly>=5.6.0         # Interactive visualization

# S3 and remote storage support
s3fs>=2022.1.0        # S3 bucket access

# The following are optional and can be commented out if not needed
# scikit-learn>=1.0.0  # Machine learning algorithms 
# umap-learn>=0.5.3    # Dimensionality reduction
# seaborn>=0.11.2      # Statistical visualizations
# scanpy>=1.9.0        # Single-cell analysis
# statsmodels>=0.13.0  # Statistical models
# anndata>=0.8.0       # AnnData format support
""")
                
        # Include extras unless specifically excluded
        include_extras = not args.no_extras
        
        # Try to find uv executable if requested
        uv_executable = None
        
        # Check if a specific UV path was provided
        if args.uv_path:
            if os.path.exists(args.uv_path):
                uv_executable = args.uv_path
                logger.info(f"Using specified UV executable at {uv_executable}")
                use_uv = True
            else:
                logger.warning(f"Specified UV executable not found at {args.uv_path}, falling back to search")
                
        # If not provided or not found, search for UV if enabled
        if use_uv and not uv_executable:
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
            
            # Function to clean up existing virtual environment if needed
            def clean_existing_venv():
                import shutil
                logger.info(f"Removing existing virtual environment at {venv_path}")
                try:
                    shutil.rmtree(venv_path)
                    os.makedirs(venv_path, exist_ok=True)
                except Exception as e:
                    logger.error(f"Failed to clean up existing virtual environment: {e}")
                    return False
                return True
            
            # Function to try multiple venv creation methods
            def try_create_venv():
                nonlocal use_venv
                
                # First try with UV if available
                if use_uv:
                    logger.info("Creating virtual environment with UV")
                    try:
                        subprocess.check_call([uv_executable, 'venv', venv_path])
                        return True
                    except subprocess.CalledProcessError as e:
                        logger.error(f"Failed to create virtual environment with UV: {e}")
                
                # Next try with standard venv module
                logger.info("Trying with standard venv module")
                try:
                    subprocess.check_call([sys.executable, '-m', 'venv', venv_path])
                    return True
                except subprocess.CalledProcessError as e:
                    logger.error(f"Failed to create virtual environment with standard venv: {e}")
                
                # Try with venv module directly
                try:
                    import venv
                    logger.info("Creating virtual environment with venv module directly")
                    venv.create(venv_path, with_pip=True)
                    return True
                except Exception as e2:
                    logger.error(f"Failed to create virtual environment with venv module: {e2}")
                
                # Try with virtualenv
                logger.info("Trying virtualenv as a last resort...")
                try:
                    # Try to install virtualenv if it's not available
                    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'virtualenv'])
                    # Create virtualenv
                    subprocess.check_call([sys.executable, '-m', 'virtualenv', venv_path])
                    return True
                except Exception as e3:
                    logger.error(f"All virtual environment creation methods failed: {e3}")
                    logger.info("Installing in system Python instead...")
                    use_venv = False
                    return False
            
            # Handle existing venv
            if os.path.exists(venv_path) and os.path.isdir(venv_path):
                if args.clean or args.force_clean:
                    clean_existing_venv()
                else:
                    venv_files = os.listdir(venv_path)
                    if venv_files:  # Directory is not empty
                        logger.warning(f"Virtual environment directory {venv_path} already exists.")
                        logger.warning("Use --clean to remove the existing environment, or --no-venv to skip virtual environment creation.")
                        logger.info("Cleaning up problematic virtual environment...")
                        clean_existing_venv()
            
            # Create the virtual environment
            if not try_create_venv() and args.clean:
                # If creation failed and --clean is specified, try cleaning up and recreating
                logger.info("First attempt failed, cleaning up and trying again...")
                if clean_existing_venv():
                    try_create_venv()
            
            # Now proceed with installation in the virtual environment, if we're still using it
            if use_venv:
                # Get the Python executable from the virtual environment
                if os.name == 'nt':  # Windows
                    python_executable = os.path.join(venv_path, 'Scripts', 'python.exe')
                    pip_executable = os.path.join(venv_path, 'Scripts', 'pip.exe')
                else:  # Unix-like
                    python_executable = os.path.join(venv_path, 'bin', 'python')
                    pip_executable = os.path.join(venv_path, 'bin', 'pip')
                
                # Check if the Python executable exists
                if not os.path.exists(python_executable):
                    logger.error(f"Python executable not found in virtual environment: {python_executable}")
                    logger.info("Falling back to system Python installation...")
                    use_venv = False
                else:
                    # Setup environment for UV to use the virtual environment
                    env = os.environ.copy()
                    if os.name == 'nt':  # Windows
                        env["VIRTUAL_ENV"] = os.path.abspath(venv_path)
                        env["PATH"] = os.path.join(venv_path, "Scripts") + os.pathsep + env["PATH"]
                    else:  # Unix-like
                        env["VIRTUAL_ENV"] = os.path.abspath(venv_path)
                        env["PATH"] = os.path.join(venv_path, "bin") + os.pathsep + env["PATH"]
                    
                    try:
                        # Install dependencies in the virtual environment
                        if use_uv:
                            logger.info("Installing dependencies with UV in virtual environment")
                            pip_cmd = [uv_executable, 'pip', 'install', '-r', requirements_file]
                            if include_extras and os.path.exists(extras_file):
                                logger.info("Including optional dependencies")
                                pip_cmd.extend(['-r', extras_file])
                            if upgrade:
                                pip_cmd.append('--upgrade')
                            subprocess.check_call(pip_cmd, env=env)
                        else:
                            # First check if pip is working
                            try:
                                logger.info("Checking pip in virtual environment")
                                # Run a simple pip command to check if it works
                                subprocess.check_call([python_executable, '-m', 'pip', '--version'])
                                
                                logger.info("Upgrading pip in virtual environment")
                                subprocess.check_call([python_executable, '-m', 'pip', 'install', '--upgrade', 'pip'])
                                
                                # Install dependencies in virtual environment
                                logger.info("Installing dependencies in virtual environment")
                                pip_cmd = [python_executable, '-m', 'pip', 'install', '-r', requirements_file]
                                if include_extras and os.path.exists(extras_file):
                                    logger.info("Including optional dependencies")
                                    pip_cmd.extend(['-r', extras_file])
                                if upgrade:
                                    pip_cmd.append('--upgrade')
                                subprocess.check_call(pip_cmd)
                            except subprocess.CalledProcessError as e:
                                logger.error(f"Error with pip in virtual environment: {e}")
                                logger.info("Falling back to system Python installation...")
                                use_venv = False
                        
                        if use_venv:
                            # Install annzarro in development mode
                            logger.info("Installing AnnZarro in development mode in virtual environment")
                            if use_uv:
                                subprocess.check_call([uv_executable, 'pip', 'install', '-e', repo_root], env=env)
                            else:
                                subprocess.check_call([python_executable, '-m', 'pip', 'install', '-e', repo_root])
                                
                            # Create a pth file to ensure annzarro modules can be found
                            site_packages_dir = None
                            if os.name == 'nt':  # Windows
                                site_packages_dirs = [
                                    os.path.join(venv_path, 'Lib', 'site-packages'),
                                    os.path.join(venv_path, 'lib', 'site-packages')
                                ]
                            else:  # Unix-like
                                # Try various Python versions
                                site_packages_dirs = []
                                for i in range(7, 13):  # Python 3.7 through 3.12
                                    site_packages_dirs.append(
                                        os.path.join(venv_path, 'lib', f'python3.{i}', 'site-packages')
                                    )
                            
                            # Find the site-packages directory
                            for dir_path in site_packages_dirs:
                                if os.path.exists(dir_path):
                                    site_packages_dir = dir_path
                                    break
                            
                            # Create a .pth file to add the repository root to Python path
                            if site_packages_dir:
                                logger.info(f"Creating .pth file in {site_packages_dir}")
                                try:
                                    with open(os.path.join(site_packages_dir, 'annzarro_repo.pth'), 'w') as f:
                                        f.write(repo_root)
                                except Exception as e:
                                    logger.error(f"Error creating .pth file: {e}")
                            else:
                                logger.warning("Could not find site-packages directory in virtual environment")
                            
                            logger.info(f"Virtual environment setup complete at {venv_path}")
                            if os.name == 'nt':  # Windows
                                activate_path = os.path.join(venv_path, 'Scripts', 'activate')
                            else:  # Unix-like
                                activate_path = os.path.join(venv_path, 'bin', 'activate')
                            logger.info(f"Activate with: source {activate_path}")
                    except Exception as e:
                        logger.error(f"Error installing in virtual environment: {e}")
                        logger.info("Falling back to system Python installation...")
                        use_venv = False
        
        else:
            # Install dependencies directly in current Python environment
            logger.info("Installing Python dependencies...")
            
            if use_uv:
                # Install with UV
                pip_cmd = [uv_executable, 'pip', 'install', '-r', requirements_file]
                if include_extras and os.path.exists(extras_file):
                    logger.info("Including optional dependencies")
                    pip_cmd.extend(['-r', extras_file])
                if upgrade:
                    pip_cmd.append('--upgrade')
                subprocess.check_call(pip_cmd)
            else:
                # Install with pip
                pip_cmd = [sys.executable, "-m", "pip", "install", "-r", requirements_file]
                if include_extras and os.path.exists(extras_file):
                    logger.info("Including optional dependencies")
                    pip_cmd.extend(['-r', extras_file])
                if upgrade:
                    pip_cmd.append('--upgrade')
                subprocess.check_call(pip_cmd)
            
            # Install annzarro in development mode
            logger.info("Installing AnnZarro in development mode")
            if use_uv:
                subprocess.check_call([uv_executable, 'pip', 'install', '-e', repo_root])
            else:
                subprocess.check_call([sys.executable, "-m", "pip", "install", '-e', repo_root])
                
            # For system Python, make sure PYTHONPATH will include the repository
            logger.info("Note: To run AnnZarro, you may need to set PYTHONPATH:")
            logger.info(f"  PYTHONPATH={repo_root} python -m annzarro.cli [command]")
            
            logger.info("Python dependencies installed successfully")
        
        # Now download external resources using the proper environment if needed
        if download_resources:
            # Determine which Python executable to use
            if use_venv:
                if os.name == 'nt':  # Windows
                    python_executable = os.path.join(venv_path, 'Scripts', 'python.exe')
                else:  # Unix-like
                    python_executable = os.path.join(venv_path, 'bin', 'python')
                
                if os.path.exists(python_executable):
                    # Use the virtual environment's Python for downloading
                    logger.info("Using virtual environment Python for external resource downloads")
                    env = os.environ.copy()
                    if os.name == 'nt':  # Windows
                        env["VIRTUAL_ENV"] = os.path.abspath(venv_path)
                        env["PATH"] = os.path.join(venv_path, "Scripts") + os.pathsep + env["PATH"]
                    else:  # Unix-like
                        env["VIRTUAL_ENV"] = os.path.abspath(venv_path)
                        env["PATH"] = os.path.join(venv_path, "bin") + os.pathsep + env["PATH"]
                    
                    # Call the script itself with the proper Python
                    script_path = os.path.abspath(__file__)
                    download_cmd = [python_executable, script_path, "--download-only"]
                    logger.info(f"Running: {' '.join(download_cmd)}")
                    try:
                        subprocess.check_call(download_cmd, env=env)
                    except subprocess.CalledProcessError as e:
                        logger.error(f"Error downloading resources with venv Python: {e}")
                        # Fall back to direct download
                        if not download_external_resources(repo_root, args):
                            logger.warning("Failed to download some external resources for Electron app")
                else:
                    logger.warning(f"Virtual environment Python not found at {python_executable}")
                    # Fall back to direct download
                    if not download_external_resources(repo_root, args):
                        logger.warning("Failed to download some external resources for Electron app")
            else:
                # Fall back to direct download if not using venv
                if not download_external_resources(repo_root, args):
                    logger.warning("Failed to download some external resources for Electron app")
        
        return 0
        
    except Exception as e:
        logger.error(f"Error installing dependencies: {e}")
        if args.debug:
            traceback.print_exc()
        return 1

def main():
    """
    Main entry point for the standalone installation script
    
    Returns:
        Exit code
    """
    parser = argparse.ArgumentParser(description="AnnZarro Standalone Installer")
    
    # Installation options
    venv_group = parser.add_mutually_exclusive_group()
    venv_group.add_argument('--venv', action='store_true', help="Create and use a virtual environment (default)")
    venv_group.add_argument('--no-venv', action='store_true', help="Don't use a virtual environment")
    parser.add_argument('--venv-path', type=str, default='venv', help="Path for virtual environment (default: venv)")
    parser.add_argument('--clean', action='store_true', help="Clean existing virtual environment if it exists")
    parser.add_argument('--force-clean', action='store_true', help="Force clean existing virtual environment without asking")
    parser.add_argument('--no-uv', action='store_true', help="Disable UV and use pip instead")
    parser.add_argument('--use-uv', action='store_true', help="Force enable UV")
    parser.add_argument('--uv-path', type=str, help="Path to UV executable")
    parser.add_argument('--no-extras', action='store_true', help="Skip installing optional dependencies")
    parser.add_argument('--upgrade', action='store_true', help="Upgrade existing packages")
    parser.add_argument('--debug', action='store_true', help="Enable debug logging")
    
    # Electron app options
    parser.add_argument('--no-electron-resources', action='store_true', 
                        help="Skip downloading external CSS/JS resources for offline use in Electron app")
    parser.add_argument('--all', action='store_true', 
                        help="Full installation including all extras")
    parser.add_argument('--download-only', action='store_true',
                        help="Only download external resources without installing dependencies")
    
    args = parser.parse_args()
    
    # Set up logging
    if args.debug:
        logging.getLogger().setLevel(logging.DEBUG)
        
    try:
        # If download-only flag is set, just download resources
        if args.download_only:
            logger.info("Running in download-only mode")
            repo_root = os.path.dirname(os.path.abspath(__file__))
            success = download_external_resources(repo_root, args)
            return 0 if success else 1
        else:
            return install_dependencies(args)
    except KeyboardInterrupt:
        logger.info("Operation cancelled by user")
        return 1
    except Exception as e:
        logger.error(f"Error: {e}")
        if args.debug:
            traceback.print_exc()
        return 1

if __name__ == "__main__":
    sys.exit(main())
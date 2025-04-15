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

# Configure basic logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("annzarro-install")

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
        
        if not os.path.exists(requirements_file):
            logger.error(f"Requirements file not found: {requirements_file}")
            return 1
            
        # Check if extras file exists, create if not
        if not os.path.exists(extras_file):
            logger.info(f"Creating extras requirements file: {extras_file}")
            with open(extras_file, 'w') as f:
                f.write("""scipy>=1.8.0  # Includes sparse matrices
scikit-learn>=1.0.0
h5py>=3.6.0
plotly>=5.6.0
seaborn>=0.11.2
scanpy>=1.9.0
statsmodels>=0.13.0
umap-learn>=0.5.3
numba>=0.55.0
pandas>=1.4.0
anndata>=0.8.0
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
    
    args = parser.parse_args()
    
    # Set up logging
    if args.debug:
        logging.getLogger().setLevel(logging.DEBUG)
        
    try:
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
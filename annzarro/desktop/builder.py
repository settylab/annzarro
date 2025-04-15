"""
Desktop Application Builder for AnnZarro

This module provides functionality to build desktop applications for AnnZarro
using Electron.
"""

import os
import sys
import logging
import subprocess
import platform
import shutil
import tempfile
from pathlib import Path
from typing import Optional, List, Dict, Any, Union

logger = logging.getLogger(__name__)

class ElectronBuilder:
    """Builder for Electron-based desktop applications."""
    
    def __init__(self, app_root: str = None):
        """
        Initialize the Electron builder.
        
        Args:
            app_root: Root directory of the application (optional)
        """
        if app_root:
            self.app_root = Path(app_root)
        else:
            # Default to the root of the project
            self.app_root = Path(__file__).parent.parent.parent
            
        # Path to the Electron application
        self.electron_dir = self.app_root / "annzarro" / "desktop" / "electron"
        
        # Path to store build artifacts
        self.build_dir = self.electron_dir / "dist"
        
        # Detect platform
        self.platform = platform.system().lower()
        
    def check_requirements(self) -> bool:
        """
        Check if all requirements are met to build the desktop application.
        
        Returns:
            True if all requirements are met, False otherwise
        """
        # Check if Node.js is installed
        try:
            subprocess.run(['node', '--version'], check=True, capture_output=True, text=True)
            logger.info("Node.js is installed")
        except (subprocess.SubprocessError, FileNotFoundError):
            logger.error("Node.js is not installed. Please install Node.js to build the desktop application.")
            return False
            
        # Check if npm is installed
        try:
            subprocess.run(['npm', '--version'], check=True, capture_output=True, text=True)
            logger.info("npm is installed")
        except (subprocess.SubprocessError, FileNotFoundError):
            logger.error("npm is not installed. Please install npm to build the desktop application.")
            return False
        
        # Check if electron-builder is installed
        try:
            result = subprocess.run(
                ['npm', 'list', '--depth=0', 'electron-builder'], 
                cwd=self.electron_dir,
                capture_output=True, 
                text=True,
                check=False  # Don't fail if not installed
            )
            if "electron-builder" not in result.stdout:
                logger.warning("electron-builder is not installed in the project. Will install dependencies.")
        except (subprocess.SubprocessError, FileNotFoundError):
            logger.warning("Failed to check if electron-builder is installed. Will attempt to install dependencies.")
        
        return True
        
    def _run_npm(self, args: List[str], cwd: Union[str, Path] = None) -> subprocess.CompletedProcess:
        """
        Run an npm command.
        
        Args:
            args: Arguments to pass to npm
            cwd: Working directory (optional)
            
        Returns:
            CompletedProcess instance
        """
        if cwd is None:
            cwd = self.electron_dir
            
        logger.info(f"Running npm {' '.join(args)}")
        
        return subprocess.run(
            ['npm'] + args,
            cwd=cwd,
            check=True,
            capture_output=True,
            text=True
        )
        
    def install_dependencies(self) -> bool:
        """
        Install the necessary npm dependencies for the Electron application.
        
        Returns:
            True if successful, False otherwise
        """
        try:
            self._run_npm(['install'])
            logger.info("Successfully installed npm dependencies")
            return True
        except subprocess.SubprocessError as e:
            logger.error(f"Failed to install npm dependencies: {e}")
            logger.error(f"Error output: {e.stderr if hasattr(e, 'stderr') else 'No error output'}")
            return False
            
    def build(self, platform: str = None, rebuild: bool = False) -> bool:
        """
        Build the desktop application.
        
        Args:
            platform: Target platform (windows, mac, linux, or all)
            rebuild: Force rebuilding dependencies before build
            
        Returns:
            True if successful, False otherwise
        """
        if not self.check_requirements():
            return False
            
        # Install or update dependencies
        if rebuild or not (self.electron_dir / "node_modules").exists():
            if not self.install_dependencies():
                return False
        
        # Determine build command based on platform
        build_cmd = ['run', 'build']
        
        if platform:
            platform = platform.lower()
            if platform == 'windows' or platform == 'win':
                build_cmd = ['run', 'build:win']
            elif platform == 'mac' or platform == 'macos' or platform == 'darwin':
                build_cmd = ['run', 'build:mac']
            elif platform == 'linux':
                build_cmd = ['run', 'build:linux']
            # 'all' uses the default build command
        
        # Run the build
        try:
            # Run the npm command but capture output in real-time
            process = subprocess.Popen(
                ['npm'] + build_cmd,
                cwd=self.electron_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1
            )
            
            # Capture and log stdout in real-time
            stdout_output = ""
            for line in process.stdout:
                line = line.strip()
                if line:
                    logger.info(f"npm: {line}")
                    stdout_output += line + "\n"
            
            # Capture stderr
            stderr_output, _ = process.communicate()
            
            # Check the return code
            if process.returncode != 0:
                logger.error(f"Build failed with exit code {process.returncode}")
                if stderr_output:
                    logger.error(f"Error output:\n{stderr_output}")
                return False
                
            logger.info("Build successful")
            return True
        except Exception as e:
            logger.error(f"Build failed: {e}")
            return False
            
    def run_dev(self) -> bool:
        """
        Run the application in development mode.
        
        Returns:
            True if successful, False otherwise
        """
        if not self.check_requirements():
            return False
            
        # Install dependencies if needed
        if not (self.electron_dir / "node_modules").exists():
            if not self.install_dependencies():
                return False
        
        # Run the app in development mode
        try:
            # Uses subprocess.Popen instead of run to not block
            process = subprocess.Popen(
                ['npm', 'start'],
                cwd=self.electron_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            
            logger.info(f"Started Electron app in development mode (PID: {process.pid})")
            
            # We don't wait for it to complete, it will run until closed
            return True
        except subprocess.SubprocessError as e:
            logger.error(f"Failed to start application: {e}")
            return False
            
    def get_output_directory(self) -> Path:
        """
        Get the directory where the built application is located.
        
        Returns:
            Path to the output directory
        """
        return self.build_dir
        
    def bundle_python(self, target_dir: Union[str, Path] = None) -> bool:
        """
        Bundle Python with the application by creating a virtual environment.
        Uses the annzarro-cli to create and set up the Python environment.
        
        Args:
            target_dir: Directory to place bundled Python (optional)
            
        Returns:
            True if successful, False otherwise
        """
        if not target_dir:
            target_dir = self.electron_dir / "python"
        
        target_dir = Path(target_dir)
        
        # Create target directory if it doesn't exist
        if not target_dir.exists():
            target_dir.mkdir(parents=True, exist_ok=True)
            
        logger.info(f"Bundling Python environment to {target_dir}")
        
        # Find the CLI script
        cli_script = self._find_cli_script()
        if not cli_script:
            logger.error("Could not find annzarro-cli script")
            return False
            
        try:
            # Make CLI executable on Unix systems
            if os.name != 'nt':
                try:
                    os.chmod(cli_script, 0o755)
                except Exception as e:
                    logger.warning(f"Could not make CLI executable: {e}")
            
            # Use the CLI to create a clean virtual environment
            logger.info("Creating Python virtual environment...")
            install_cmd = [
                cli_script,
                "install",
                "--clean",
                "--venv-path", str(target_dir)
            ]
            
            logger.info(f"Running: {' '.join(install_cmd)}")
            result = subprocess.run(
                install_cmd,
                check=True,
                capture_output=True,
                text=True
            )
            
            logger.info("Python virtual environment created successfully")
            logger.info(result.stdout)
            
            return True
            
        except subprocess.SubprocessError as e:
            logger.error(f"Failed to create Python environment: {e}")
            logger.error(f"Error output: {e.stderr if hasattr(e, 'stderr') else 'No error output'}")
            return False
        except Exception as e:
            logger.error(f"Error bundling Python: {e}")
            return False
            
    def _find_cli_script(self) -> Optional[str]:
        """
        Find the annzarro-cli script.
        
        Returns:
            Path to the CLI script or None if not found
        """
        # Look in various places for the CLI script
        possible_paths = [
            self.app_root / "annzarro-cli",
            self.app_root / "bin" / "annzarro-cli",
            self.app_root / "annzarro" / "bin" / "annzarro-cli"
        ]
        
        for p in possible_paths:
            if p.exists():
                return str(p)
                
        return None
        
def build_desktop_app(platform: str = None, rebuild: bool = False, icon_source: str = None,
                  bundle_venv: bool = True, venv_path: str = None) -> bool:
    """
    Build the desktop application.
    
    Args:
        platform: Target platform (windows, mac, linux, or all)
        rebuild: Force rebuilding dependencies before build
        icon_source: Path to source icon for generating app icons (optional)
        bundle_venv: Whether to bundle a Python virtual environment (default: True)
        venv_path: Custom path for the Python virtual environment (optional)
        
    Returns:
        True if successful, False otherwise
    """
    builder = ElectronBuilder()
    
    # Generate icons if source is provided
    if icon_source:
        try:
            from .icon_generator import generate_desktop_icons
            logger.info(f"Generating desktop icons from {icon_source}")
            generate_desktop_icons(icon_source)
        except ImportError as e:
            logger.error(f"Failed to import icon generator: {e}")
            logger.error("Make sure Pillow is installed: pip install Pillow")
            return False
        except Exception as e:
            logger.error(f"Error generating icons: {e}")
            # Continue with the build even if icon generation fails
    
    # Bundle Python environment if requested
    if bundle_venv:
        logger.info("Bundling Python virtual environment...")
        if not builder.bundle_python(target_dir=venv_path):
            logger.error("Failed to bundle Python environment")
            # Continue with the build even if Python bundling fails
            logger.warning("Continuing with build without bundled Python")
    
    return builder.build(platform, rebuild)
    
def run_desktop_app(icon_source: str = None) -> bool:
    """
    Run the desktop application in development mode.
    
    Args:
        icon_source: Path to source icon for generating app icons (optional)
        
    Returns:
        True if successful, False otherwise
    """
    # Generate icons if source is provided
    if icon_source:
        try:
            from .icon_generator import generate_desktop_icons
            logger.info(f"Generating desktop icons from {icon_source}")
            generate_desktop_icons(icon_source)
        except ImportError as e:
            logger.error(f"Failed to import icon generator: {e}")
            logger.error("Make sure Pillow is installed: pip install Pillow")
            return False
        except Exception as e:
            logger.error(f"Error generating icons: {e}")
            # Continue running even if icon generation fails
    
    builder = ElectronBuilder()
    return builder.run_dev()
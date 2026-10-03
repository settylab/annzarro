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

#: Where the desktop commands send someone running from a pip install.
RELEASES_URL = "https://github.com/settylab/annzarro/releases"


def electron_project_problem(app_root=None) -> Optional[str]:
    """Why ``annzarro desktop`` cannot work here, or None.

    The Electron project (annzarro/desktop/electron) lives in the source
    repository only; a pip-installed annzarro has this module but not the
    project it drives, and used to fail deep inside npm with a missing
    package.json.
    """
    root = Path(app_root) if app_root else Path(__file__).parent.parent.parent
    if (root / "annzarro" / "desktop" / "electron" / "package.json").is_file():
        return None
    return ("`annzarro desktop` builds and runs the desktop app from a source checkout "
            "(git clone https://github.com/settylab/annzarro), and this annzarro is an "
            "installed package without the Electron project. Download a ready-built "
            f"desktop app from {RELEASES_URL}, or run the commands from a checkout.")


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
            self._run_npm(['ci'])
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
            
        # Install dependencies (npm ci: the lock file pins the Electron toolchain)
        if rebuild or not (self.electron_dir / "node_modules").exists():
            if not self.install_dependencies():
                return False
        
        # electron-builder for the current platform unless one is named
        build_cmd = ['exec', '--', 'electron-builder', '--publish', 'never']
        if platform:
            platform = platform.lower()
            if platform in ('windows', 'win'):
                build_cmd.append('--win')
            elif platform in ('mac', 'macos', 'darwin'):
                build_cmd.append('--mac')
            elif platform == 'linux':
                build_cmd.append('--linux')
            # 'all' builds every platform's targets the host can build

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
        
    def build_server(self) -> bool:
        """
        Freeze the server with PyInstaller (scripts/build_server.py) into
        electron/server/, where electron-builder picks it up. Runs with the
        current Python, which the frozen server then embeds.

        Returns:
            True if successful, False otherwise
        """
        script = self.app_root / "annzarro" / "desktop" / "scripts" / "build_server.py"
        logger.info(f"Freezing the server with {sys.executable}")
        try:
            subprocess.run([sys.executable, str(script)], check=True)
            return True
        except subprocess.SubprocessError as e:
            logger.error(f"Failed to freeze the server: {e}")
            return False

def build_desktop_app(platform: str = None, rebuild: bool = False, icon_source: str = None,
                      build_server: bool = True) -> bool:
    """
    Build the desktop application.

    Args:
        platform: Target platform (windows, mac, linux, or all). The frozen
            server only runs on the platform it was built on, so a release
            builds each platform on that platform (see .github/workflows/build.yml).
        rebuild: Force rebuilding dependencies before build
        icon_source: Path to source icon for generating app icons (optional)
        build_server: Freeze the server first (default); False reuses the one
            already in electron/server/

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

    if build_server and not builder.build_server():
        return False

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
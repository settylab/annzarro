"""
Icon Generator Module for AnnZarro

This module provides functionality to generate icons for the AnnZarro desktop 
application and web server using PIL (Pillow).
"""

import os
import sys
import logging
from pathlib import Path
from typing import List, Tuple, Optional, Union

try:
    from PIL import Image
except ImportError:
    print("Pillow is required for icon generation. Install it with: pip install Pillow")
    sys.exit(1)

logger = logging.getLogger(__name__)

class IconGenerator:
    """Generate icons for desktop application and web server."""
    
    def __init__(self, source_icon: Union[str, Path]):
        """
        Initialize the icon generator.
        
        Args:
            source_icon: Path to the source icon file (high-resolution PNG)
        """
        self.source_path = Path(source_icon)
        if not self.source_path.exists():
            raise FileNotFoundError(f"Source icon not found: {self.source_path}")
        
        self.source_image = Image.open(self.source_path)
        
    def generate_favicon_ico(self, output_path: Union[str, Path], 
                           sizes: List[int] = [16, 32, 48, 64, 128, 256]) -> Path:
        """
        Generate a Windows .ico file with multiple sizes.
        
        Args:
            output_path: Path to save the .ico file
            sizes: List of icon sizes to include
            
        Returns:
            Path to the generated .ico file
        """
        output_path = Path(output_path)
        images = []
        
        for size in sizes:
            # Resize the image with antialiasing
            img = self.source_image.resize((size, size), Image.LANCZOS)
            images.append(img)
        
        # Ensure output directory exists
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Save as ICO file
        images[0].save(
            output_path,
            format='ICO',
            sizes=[(img.width, img.height) for img in images]
        )
        
        logger.info(f"Generated Windows icon: {output_path}")
        return output_path
    
    def generate_macos_icns(self, output_path: Union[str, Path]) -> Path:
        """
        Generate a macOS .icns file.
        
        This method requires macOS and the IconUtil tool.
        
        Args:
            output_path: Path to save the .icns file
            
        Returns:
            Path to the generated .icns file
        """
        output_path = Path(output_path)
        
        # Create temporary iconset directory
        iconset_dir = output_path.parent / f"{output_path.stem}.iconset"
        iconset_dir.mkdir(parents=True, exist_ok=True)
        
        # Generate sizes required for macOS iconsets
        icon_sizes = [
            ("icon_16x16.png", 16),
            ("icon_16x16@2x.png", 32),
            ("icon_32x32.png", 32),
            ("icon_32x32@2x.png", 64),
            ("icon_128x128.png", 128),
            ("icon_128x128@2x.png", 256),
            ("icon_256x256.png", 256),
            ("icon_256x256@2x.png", 512),
            ("icon_512x512.png", 512),
            ("icon_512x512@2x.png", 1024)
        ]
        
        for filename, size in icon_sizes:
            if size > self.source_image.width:
                logger.warning(
                    f"Source image is too small for {size}x{size} icon. "
                    f"Image will be upscaled, which may result in quality loss."
                )
            
            img = self.source_image.resize((size, size), Image.LANCZOS)
            img.save(iconset_dir / filename)
            
        # Use iconutil to convert the iconset to icns (macOS only)
        if sys.platform == 'darwin':
            import subprocess
            try:
                subprocess.run([
                    'iconutil', 
                    '-c', 'icns', 
                    str(iconset_dir)
                ], check=True)
                
                logger.info(f"Generated macOS icon: {output_path}")
                return output_path
            except (subprocess.SubprocessError, FileNotFoundError) as e:
                logger.error(f"Failed to run iconutil: {e}")
                logger.error("Falling back to keeping the .iconset directory")
                return iconset_dir
        else:
            logger.warning("ICNS generation requires macOS. Keeping the .iconset directory instead.")
            return iconset_dir
    
    def generate_linux_icons(self, output_dir: Union[str, Path],
                           sizes: List[int] = [16, 22, 24, 32, 48, 64, 128, 256, 512]) -> List[Path]:
        """
        Generate Linux icons in various sizes.
        
        Args:
            output_dir: Directory to save the icons
            sizes: List of icon sizes to generate
            
        Returns:
            List of paths to the generated icons
        """
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        
        output_paths = []
        
        for size in sizes:
            output_path = output_dir / f"{size}x{size}.png"
            
            # Resize the image with antialiasing
            img = self.source_image.resize((size, size), Image.LANCZOS)
            img.save(output_path)
            
            output_paths.append(output_path)
            
        logger.info(f"Generated {len(output_paths)} Linux icons in {output_dir}")
        return output_paths
    
    def generate_favicon_png(self, output_path: Union[str, Path], size: int = 32) -> Path:
        """
        Generate a PNG favicon.
        
        Args:
            output_path: Path to save the PNG favicon
            size: Size of the favicon
            
        Returns:
            Path to the generated PNG favicon
        """
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Resize the image with antialiasing
        img = self.source_image.resize((size, size), Image.LANCZOS)
        img.save(output_path)
        
        logger.info(f"Generated PNG favicon: {output_path}")
        return output_path
    
    def generate_all_desktop_icons(self, output_dir: Union[str, Path]) -> Tuple[Path, Path, List[Path]]:
        """
        Generate all necessary icons for desktop applications.
        
        Args:
            output_dir: Directory to save the icons
            
        Returns:
            Tuple containing:
            - Path to Windows .ico file
            - Path to macOS .icns file
            - List of paths to Linux PNG files
        """
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Generate Windows .ico
        ico_path = self.generate_favicon_ico(output_dir / "icon.ico")
        
        # Generate macOS .icns
        icns_path = self.generate_macos_icns(output_dir / "icon.icns")
        
        # Generate Linux PNGs
        linux_paths = self.generate_linux_icons(output_dir)
        
        # Generate main PNG for use in Electron
        self.source_image.save(output_dir / "icon.png")
        
        return ico_path, icns_path, linux_paths
    
    def generate_web_favicons(self, output_dir: Union[str, Path]) -> Tuple[Path, Path]:
        """
        Generate favicons for the web server.
        
        Args:
            output_dir: Directory to save the favicons
            
        Returns:
            Tuple containing:
            - Path to .ico favicon
            - Path to .png favicon
        """
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Generate favicon.ico
        ico_path = self.generate_favicon_ico(output_dir / "favicon.ico", sizes=[16, 32, 48, 64])
        
        # Generate favicon.png
        png_path = self.generate_favicon_png(output_dir / "favicon.png", size=32)
        
        return ico_path, png_path

def generate_desktop_icons(source_icon: Union[str, Path]) -> bool:
    """
    Generate desktop application icons from a source image.
    
    Args:
        source_icon: Path to the source icon file
        
    Returns:
        True if successful, False otherwise
    """
    try:
        generator = IconGenerator(source_icon)
        
        # Get path to the Electron icons directory
        electron_dir = Path(__file__).parent / "electron" / "icons"
        
        # Generate all desktop icons
        ico_path, icns_path, linux_paths = generator.generate_all_desktop_icons(electron_dir)
        
        logger.info(f"Successfully generated all desktop icons in {electron_dir}")
        return True
    except Exception as e:
        logger.error(f"Failed to generate desktop icons: {e}")
        return False

def generate_web_favicons(source_icon: Union[str, Path]) -> bool:
    """
    Generate web server favicons from a source image.
    
    Args:
        source_icon: Path to the source icon file
        
    Returns:
        True if successful, False otherwise
    """
    try:
        generator = IconGenerator(source_icon)
        
        # Get path to the static files directory
        static_dir = Path(__file__).parent.parent.parent / "static"
        if not static_dir.exists():
            static_dir.mkdir(parents=True, exist_ok=True)
        
        # Generate web favicons
        ico_path, png_path = generator.generate_web_favicons(static_dir)
        
        logger.info(f"Successfully generated web favicons in {static_dir}")
        return True
    except Exception as e:
        logger.error(f"Failed to generate web favicons: {e}")
        return False

if __name__ == "__main__":
    # Simple CLI for testing
    import argparse
    
    parser = argparse.ArgumentParser(description="Generate icons for AnnZarro")
    parser.add_argument("source", help="Path to source icon (high-resolution PNG)")
    parser.add_argument("--desktop", action="store_true", help="Generate desktop application icons")
    parser.add_argument("--web", action="store_true", help="Generate web server favicons")
    parser.add_argument("--all", action="store_true", help="Generate all icons")
    
    args = parser.parse_args()
    
    if args.all or args.desktop:
        generate_desktop_icons(args.source)
    
    if args.all or args.web:
        generate_web_favicons(args.source)
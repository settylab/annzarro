#!/usr/bin/env python3
"""
Version bumping script for Annzarro

This script updates the version number in all relevant files:
- annzarro/__init__.py
- pyproject.toml
- annzarro/desktop/electron/package.json

Usage:
  python bump_version.py [major|minor|patch]
  python bump_version.py <specific-version>

Examples:
  python bump_version.py patch     # Increment patch version (0.1.0 -> 0.1.1)
  python bump_version.py minor     # Increment minor version (0.1.0 -> 0.2.0)
  python bump_version.py major     # Increment major version (0.1.0 -> 1.0.0)
  python bump_version.py 0.2.0     # Set specific version (0.1.0 -> 0.2.0)
"""

import os
import re
import sys
import json
from pathlib import Path

def get_current_version():
    """Get the current version from __init__.py"""
    init_path = Path(__file__).parent / "annzarro" / "__init__.py"
    with open(init_path, "r") as f:
        content = f.read()
        match = re.search(r'__version__\s*=\s*["\']([^"\']+)["\']', content)
        if match:
            return match.group(1)
    raise ValueError("Could not find version in __init__.py")

def calculate_new_version(current_version, bump_type):
    """Calculate the new version based on the bump type"""
    if bump_type in ["major", "minor", "patch"]:
        major, minor, patch = map(int, current_version.split("."))
        if bump_type == "major":
            return f"{major + 1}.0.0"
        elif bump_type == "minor":
            return f"{major}.{minor + 1}.0"
        elif bump_type == "patch":
            return f"{major}.{minor}.{patch + 1}"
    else:
        # Assume bump_type is a specific version
        # Validate it's a proper semver
        if not re.match(r'^\d+\.\d+\.\d+$', bump_type):
            raise ValueError(f"Invalid version format: {bump_type}. Expected format: X.Y.Z")
        return bump_type

def update_python_init(new_version):
    """Update the version in __init__.py"""
    init_path = Path(__file__).parent / "annzarro" / "__init__.py"
    with open(init_path, "r") as f:
        content = f.read()
    
    new_content = re.sub(
        r'__version__\s*=\s*["\']([^"\']+)["\']',
        f'__version__ = "{new_version}"',
        content
    )
    
    with open(init_path, "w") as f:
        f.write(new_content)
    
    print(f"Updated version in {init_path}")

def update_pyproject_toml(new_version):
    """Update the version in pyproject.toml"""
    path = Path(__file__).parent / "pyproject.toml"
    with open(path, "r") as f:
        content = f.read()
    
    new_content = re.sub(
        r'version\s*=\s*["\']([^"\']+)["\']',
        f'version = "{new_version}"',
        content
    )
    
    with open(path, "w") as f:
        f.write(new_content)
    
    print(f"Updated version in {path}")

def update_package_json(new_version):
    """Update the version in package.json"""
    path = Path(__file__).parent / "annzarro" / "desktop" / "electron" / "package.json"
    with open(path, "r") as f:
        data = json.load(f)
    
    data["version"] = new_version
    
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    
    print(f"Updated version in {path}")

def main():
    # Check arguments
    if len(sys.argv) != 2:
        print(__doc__)
        return 1
    
    bump_type = sys.argv[1].lower()
    
    try:
        # Get current version
        current_version = get_current_version()
        print(f"Current version: {current_version}")
        
        # Calculate new version
        new_version = calculate_new_version(current_version, bump_type)
        print(f"New version: {new_version}")
        
        # Update files
        update_python_init(new_version)
        update_pyproject_toml(new_version)
        update_package_json(new_version)
        
        print("\nVersion bump complete!")
        print(f"Don't forget to commit these changes: git commit -m \"Bump version to {new_version}\"")
        
        return 0
        
    except Exception as e:
        print(f"Error: {e}")
        return 1

if __name__ == "__main__":
    sys.exit(main())
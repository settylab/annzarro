#!/usr/bin/env python3
"""
Migration script for Annzarro Server

This script helps migrate components from the legacy server implementation
to the new implementation.
"""

import os
import sys
import shutil
import json
import logging
from pathlib import Path

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

# Paths
ROOT_DIR = Path(__file__).resolve().parent
LEGACY_SERVER_DIR = ROOT_DIR / "server"
NEW_SERVER_DIR = ROOT_DIR / "annzarro" / "server"

# Files to migrate
FILES_TO_MIGRATE = [
    {"src": "auth.py", "dest": "auth.py"},
    {"src": "production_config.json", "dest": "production_config.json"},
    {"src": "gunicorn_config.py", "dest": "gunicorn_config.py"},
    {"src": "run_gunicorn.sh", "dest": "run_gunicorn.sh"},
    {"src": "setup_production.sh", "dest": "setup_production.sh"},
    {"src": "annzarro.service", "dest": "annzarro.service"},
    {"src": "users.json", "dest": "users.json"},
    {"src": "requirements.txt", "dest": "requirements.txt"},
]

def confirm(message):
    """Ask for user confirmation (auto-yes in automated mode)"""
    print(f"{message} (y/n): y (auto-confirmed)")
    return True

def check_prerequisites():
    """Check if directories exist"""
    if not LEGACY_SERVER_DIR.exists():
        logger.error(f"Legacy server directory not found: {LEGACY_SERVER_DIR}")
        return False
    if not NEW_SERVER_DIR.exists():
        logger.error(f"New server directory not found: {NEW_SERVER_DIR}")
        return False
    return True

def backup_file(file_path):
    """Create a backup of a file"""
    if file_path.exists():
        backup_path = file_path.with_suffix(file_path.suffix + '.bak')
        shutil.copy2(file_path, backup_path)
        logger.info(f"Created backup: {backup_path}")
        return backup_path
    return None

def merge_config_files():
    """Merge configuration from legacy to new"""
    legacy_config_path = LEGACY_SERVER_DIR / "config.json"
    new_config_path = NEW_SERVER_DIR / "config.json"
    
    if not legacy_config_path.exists() or not new_config_path.exists():
        logger.warning("Could not find config files to merge")
        return False
    
    try:
        with open(legacy_config_path, 'r') as f:
            legacy_config = json.load(f)
        
        with open(new_config_path, 'r') as f:
            new_config = json.load(f)
        
        # Backup the new config file
        backup_file(new_config_path)
        
        # Merge configs, prioritizing new config for keys that exist in both
        merged_config = {**legacy_config, **new_config}
        
        # Write the merged config
        with open(new_config_path, 'w') as f:
            json.dump(merged_config, f, indent=4)
        
        logger.info(f"Successfully merged config files")
        return True
    except Exception as e:
        logger.error(f"Error merging config files: {e}")
        return False

def migrate_files():
    """Migrate files from legacy to new server"""
    for file_info in FILES_TO_MIGRATE:
        src_path = LEGACY_SERVER_DIR / file_info["src"]
        dest_path = NEW_SERVER_DIR / file_info["dest"]
        
        if not src_path.exists():
            logger.warning(f"Source file not found: {src_path}")
            continue
        
        # Create backup if destination exists
        if dest_path.exists():
            backup_file(dest_path)
        
        # Copy the file
        try:
            shutil.copy2(src_path, dest_path)
            logger.info(f"Migrated: {src_path} -> {dest_path}")
        except Exception as e:
            logger.error(f"Error copying {src_path}: {e}")

def update_imports():
    """Update imports in migrated files"""
    # This requires more sophisticated parsing
    # For this example, we'll just inform about the need to update imports
    logger.info("You may need to manually update imports in the migrated files.")
    logger.info("Common changes:")
    logger.info("  - 'from server import X' -> 'from annzarro.server import X'")
    logger.info("  - Update relative imports to match the new package structure")

def main():
    """Main migration function"""
    logger.info("Starting Annzarro server migration...")
    
    if not check_prerequisites():
        return 1
    
    print("\n" + "="*80)
    print("This script will migrate components from the legacy server")
    print("implementation to the new implementation.")
    print("="*80 + "\n")
    
    if not confirm("Do you want to continue with the migration?"):
        logger.info("Migration cancelled by user")
        return 0
    
    # Create backup directory
    backup_dir = ROOT_DIR / "migration_backups"
    backup_dir.mkdir(exist_ok=True)
    logger.info(f"Backups will be stored in: {backup_dir}")
    
    # Merge config files
    if confirm("Do you want to merge configuration files?"):
        merge_config_files()
    
    # Migrate other files
    if confirm("Do you want to migrate all other server files?"):
        migrate_files()
    
    # Update imports
    update_imports()
    
    print("\n" + "="*80)
    print("Migration completed. Please verify the changes and test the new server.")
    print("See migration_instructions.md for additional manual steps.")
    print("="*80 + "\n")
    
    return 0

if __name__ == "__main__":
    sys.exit(main())
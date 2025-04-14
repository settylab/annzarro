"""
Configuration manager for Annzarro.

This module provides a configuration manager class that handles loading,
merging, and validating configurations from different sources.
"""

import os
import sys
import json
import logging
import argparse

# Try to import YAML library
try:
    import yaml
except ImportError:
    yaml = None
    logging.warning("PyYAML is not installed. YAML configuration files will not be supported.")
    logging.warning("Please install PyYAML using: pip install pyyaml>=6.0.0")
from pathlib import Path
from typing import Dict, Any, List, Optional, Union, Tuple
from copy import deepcopy

logger = logging.getLogger(__name__)

class ConfigManager:
    """
    Configuration manager for Annzarro.
    
    This class handles loading, merging, and validating configurations from
    different sources including default values, configuration files, environment
    variables, and command line arguments.
    """
    
    # Configuration file search paths
    SYSTEM_CONFIG_PATH = "/etc/annzarro/config.yaml"
    USER_CONFIG_PATH = os.path.expanduser("~/.config/annzarro/config.yaml")
    
    # Schema file path
    SCHEMA_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "config", "schema.yaml")
    
    # Environment variable prefix
    ENV_PREFIX = "ANNZARRO_"
    
    # Security levels
    SECURITY_LEVELS = {
        "public": 0,    # Information that can be shared with clients
        "internal": 1,  # Internal server information
        "sensitive": 2  # Security-critical information
    }
    
    def __init__(self):
        """Initialize the configuration manager."""
        # Initial configuration with default values
        self.config = {}
        
        # Track configuration sources for debugging
        self.sources = {}
        
        # Store original command line arguments
        self.argv = list(sys.argv)
        
        # Schema cache
        self._schema = None
        self._security_metadata = {} # Path -> security level mapping
        
    def load_config(self, env: str = "development", config_path: Optional[str] = None,
                   cli_args: Optional[argparse.Namespace] = None) -> Dict[str, Any]:
        """
        Load configuration from all sources.
        
        Args:
            env: Environment to load configuration for (development, production)
            config_path: Optional path to a configuration file
            cli_args: Optional command line arguments
            
        Returns:
            Merged configuration dictionary
        """
        # Step 1: Load base configuration
        self._load_yaml_config("config/base.yaml", "base_defaults")
        
        # Step 2: Load environment-specific configuration
        env_file = f"config/{env}.yaml"
        self._load_yaml_config(env_file, f"{env}_defaults")
        
        # Step 3: Load system-wide configuration if available
        self._load_yaml_config(self.SYSTEM_CONFIG_PATH, "system")
        
        # Step 4: Load user configuration if available
        self._load_yaml_config(self.USER_CONFIG_PATH, "user")
        
        # Step 5: Load project configuration if available
        self._load_yaml_config("config.yaml", "project")
        
        # Step 6: Load configuration from specified path if provided
        if config_path:
            self._load_yaml_config(config_path, "explicit")
        
        # Step 7: Apply environment variable overrides
        self._apply_environment_variables()
        
        # Step 8: Apply command line argument overrides
        if cli_args:
            self._apply_cli_args(cli_args)
        
        # Log configuration sources
        logger.debug(f"Configuration loaded from sources: {', '.join(self.sources.keys())}")
        
        return self.config
    
    def _load_yaml_config(self, config_path: str, source_name: str) -> None:
        """
        Load configuration from a YAML file.
        
        Args:
            config_path: Path to the YAML configuration file
            source_name: Name of the configuration source for tracking
        """
        # Check if YAML support is available
        if yaml is None and config_path.endswith(('.yaml', '.yml')):
            logger.warning(f"Cannot load YAML configuration {config_path}: PyYAML is not installed")
            return
            
        path = Path(config_path)
        if not path.exists():
            logger.debug(f"Configuration file not found: {config_path}")
            return
        
        try:
            with open(path, 'r') as f:
                # Load based on file extension
                if config_path.endswith(('.yaml', '.yml')):
                    config_data = yaml.safe_load(f)
                elif config_path.endswith('.json'):
                    config_data = json.load(f)
                else:
                    logger.warning(f"Unknown configuration file format: {config_path}")
                    return
                
            if not config_data:
                logger.warning(f"Empty configuration file: {config_path}")
                return
                
            # Merge configuration
            self._deep_update(self.config, config_data)
            
            # Record source
            self.sources[source_name] = config_path
            logger.debug(f"Loaded configuration from {config_path}")
        except Exception as e:
            logger.error(f"Error loading configuration from {config_path}: {e}")
    
    def _apply_environment_variables(self) -> None:
        """Apply environment variable overrides to the configuration."""
        env_vars = {k: v for k, v in os.environ.items() if k.startswith(self.ENV_PREFIX)}
        
        if not env_vars:
            return
            
        # Process each environment variable
        for env_var, value in env_vars.items():
            # Remove prefix and convert to lowercase
            key = env_var[len(self.ENV_PREFIX):].lower()
            
            # Convert nested keys (e.g., SERVER_HOST to server.host)
            path = key.split('_')
            
            # Apply the environment variable
            self._set_nested_value(self.config, path, self._convert_value(value))
            
            # Record source
            self.sources[f"env_var_{key}"] = env_var
            
        logger.debug(f"Applied {len(env_vars)} environment variable overrides")
    
    def _apply_cli_args(self, args: argparse.Namespace) -> None:
        """
        Apply command line argument overrides to the configuration.
        
        Args:
            args: Command line arguments
        """
        # Convert Namespace to dictionary
        args_dict = vars(args)
        
        # Remove None values and special arguments
        args_dict = {k: v for k, v in args_dict.items() 
                    if v is not None and k not in ('func', 'command')}
        
        if not args_dict:
            return
            
        # Process each argument
        for arg, value in args_dict.items():
            # Convert kebab-case to snake_case
            key = arg.replace('-', '_')
            
            # Convert to path components (e.g., data_dir to ['data_dir'])
            path = key.split('_')
            
            # Apply the argument
            self._set_nested_value(self.config, path, value)
            
            # Record source
            self.sources[f"cli_arg_{key}"] = arg
            
        logger.debug(f"Applied {len(args_dict)} command line argument overrides")
    
    def _deep_update(self, target: Dict[str, Any], source: Dict[str, Any]) -> None:
        """
        Recursively update a dictionary with another dictionary.
        
        Args:
            target: Target dictionary to update
            source: Source dictionary with values to apply
        """
        for key, value in source.items():
            if key in target and isinstance(target[key], dict) and isinstance(value, dict):
                # Recursively update nested dictionaries
                self._deep_update(target[key], value)
            else:
                # Replace or add value
                target[key] = deepcopy(value)
    
    def _set_nested_value(self, config: Dict[str, Any], path: List[str], value: Any) -> None:
        """
        Set a value in a nested dictionary based on a path.
        
        Args:
            config: Configuration dictionary
            path: List of keys forming a path to the value
            value: Value to set
        """
        current = config
        
        # Navigate to the correct location
        for i, key in enumerate(path[:-1]):
            # Create nested dictionaries if they don't exist
            if key not in current or not isinstance(current[key], dict):
                current[key] = {}
            current = current[key]
        
        # Set the value at the final location
        current[path[-1]] = value
    
    def _convert_value(self, value: str) -> Any:
        """
        Convert a string value to an appropriate type.
        
        Args:
            value: String value to convert
            
        Returns:
            Converted value
        """
        # Check for boolean values
        if value.lower() in ('true', 'yes', '1'):
            return True
        elif value.lower() in ('false', 'no', '0'):
            return False
            
        # Check for numeric values
        try:
            if '.' in value:
                return float(value)
            else:
                return int(value)
        except ValueError:
            # It's a string
            return value
    
    def get_config_info(self) -> Dict[str, Dict[str, Any]]:
        """
        Get information about the configuration sources and values.
        
        Returns:
            Dictionary containing configuration source information
        """
        result = {
            "sources": self.sources,
            "environment_variables": {
                k: v for k, v in os.environ.items() 
                if k.startswith(self.ENV_PREFIX)
            },
            "command_line_args": self.argv[1:] if len(self.argv) > 1 else []
        }
        
        return result
    
    def validate_config(self) -> Tuple[bool, List[str]]:
        """
        Validate the configuration.
        
        Returns:
            Tuple of (is_valid, error_messages)
        """
        # Basic validation for now
        errors = []
        
        # Check required fields
        required_fields = [
            ("server", "host"),
            ("server", "port"),
            ("server", "data_dir")
        ]
        
        for section, field in required_fields:
            if section not in self.config or field not in self.config[section]:
                errors.append(f"Missing required configuration: {section}.{field}")
        
        # Validate auth configuration
        if self.config.get("auth", {}).get("enabled", False):
            if not self.config.get("auth", {}).get("secret_key"):
                errors.append("Authentication is enabled but no secret_key is set")
                
            if not self.config.get("auth", {}).get("user_file"):
                errors.append("Authentication is enabled but no user_file is set")
        
        # TODO: Add more validation as needed
        
        return len(errors) == 0, errors
    
    def to_flask_config(self) -> Dict[str, Any]:
        """
        Convert hierarchical configuration to flat Flask configuration.
        
        Returns:
            Flattened configuration dictionary for Flask
        """
        flask_config = {
            # Mark this as coming from the config manager
            "__using_config_manager": True
        }
        
        # Server section
        if "server" in self.config:
            for key, value in self.config["server"].items():
                flask_config[key] = value
        
        # Auth section
        if "auth" in self.config:
            auth_config = self.config["auth"]
            flask_config["auth_enabled"] = auth_config.get("enabled", False)
            flask_config["user_file"] = auth_config.get("user_file", "users.json")
            flask_config["secret_key"] = auth_config.get("secret_key", "change-this-in-production")
        
        # Branding section
        if "branding" in self.config:
            branding = self.config["branding"]
            flask_config["app_name"] = branding.get("app_name", "Annzarro")
            flask_config["project_description"] = branding.get(
                "project_description", "Zarr-based AnnData Visualization Tool"
            )
            flask_config["contact_info"] = branding.get("contact_info", {})
        
        # UI defaults
        if "ui" in self.config and "defaults" in self.config["ui"]:
            for key, value in self.config["ui"]["defaults"].items():
                flask_config[f"ui_{key}"] = value
                
        # UI panel types
        if "ui" in self.config and "enabled_panel_types" in self.config["ui"]:
            flask_config["enabled_panel_types"] = self.config["ui"]["enabled_panel_types"]
        
        # Cache configuration
        if "ui" in self.config and "cache" in self.config["ui"]:
            cache_config = self.config["ui"]["cache"]
            flask_config["ui_cache_max_entries"] = cache_config.get("max_entries", 1000)
            flask_config["ui_cache_max_size_mb"] = cache_config.get("max_size_mb", 1024)
            
        # Autosave configuration
        if "ui" in self.config and "autosave" in self.config["ui"]:
            autosave_config = self.config["ui"]["autosave"]
            flask_config["ui_autosave_enabled"] = autosave_config.get("enabled", True)
            flask_config["ui_autosave_interval_ms"] = autosave_config.get("interval_ms", 10000)
            flask_config["ui_autosave_storage_key"] = autosave_config.get("storage_key", "annzarro_autosave")
            flask_config["ui_autosave_session_name"] = autosave_config.get("session_name", "Autosave")
            flask_config["ui_autosave_show_in_list"] = autosave_config.get("show_in_list", False)
            flask_config["ui_autosave_auto_restore"] = autosave_config.get("auto_restore", True)
            
        # External integrations
        if "integrations" in self.config:
            flask_config["integrations"] = self.config["integrations"]
        
        return flask_config


    def _load_schema(self) -> Dict[str, Any]:
        """
        Load and parse the schema file.
        
        Returns:
            Schema dictionary or empty dict if schema could not be loaded
        """
        if self._schema is not None:
            return self._schema
            
        if yaml is None:
            logger.warning("PyYAML is not installed. Schema validation not available.")
            return {}
            
        try:
            if not os.path.exists(self.SCHEMA_PATH):
                logger.warning(f"Schema file not found: {self.SCHEMA_PATH}")
                return {}
                
            with open(self.SCHEMA_PATH, 'r') as f:
                schema = yaml.safe_load(f)
                
            # Cache schema
            self._schema = schema
            
            # Parse security metadata from schema
            self._parse_security_metadata(schema)
            
            return schema
        except Exception as e:
            logger.error(f"Error loading schema: {e}")
            return {}
    
    def _parse_security_metadata(self, schema: Dict[str, Any], path: str = "") -> None:
        """
        Parse security metadata from schema.
        
        Args:
            schema: Schema dictionary
            path: Current path in the schema
        """
        if not isinstance(schema, dict):
            return
            
        # Check if this is a property with security metadata
        if "security" in schema and "type" in schema:
            security_level = schema.get("security", "internal")  # Default to internal
            self._security_metadata[path] = security_level
            return
            
        # Skip schema metadata
        if path == "" and "__security_levels" in schema:
            return
            
        # Recurse into nested objects
        for key, value in schema.items():
            # Skip metadata keys
            if key.startswith("__"):
                continue
                
            # Skip type and required keys at the property level
            if key in ("type", "properties", "required", "items", "description", "default"):
                continue
                
            new_path = f"{path}.{key}" if path else key
            
            # Check for properties in objects
            if isinstance(value, dict):
                # If this is an object with properties, recurse into properties
                if "properties" in value:
                    for prop_name, prop_schema in value.get("properties", {}).items():
                        prop_path = f"{new_path}.{prop_name}"
                        if "security" in prop_schema:
                            self._security_metadata[prop_path] = prop_schema["security"]
                        self._parse_security_metadata(prop_schema, prop_path)
                else:
                    # Regular nested object
                    self._parse_security_metadata(value, new_path)
    
    def get_filtered_config(self, security_level: str = "public") -> Dict[str, Any]:
        """
        Get a filtered view of the configuration based on security level.
        
        Args:
            security_level: Minimum security level to include
            
        Returns:
            Filtered configuration dictionary
        """
        # Load schema if not already loaded
        if not self._security_metadata:
            self._load_schema()
            
        # If no security metadata, use a default filter
        if not self._security_metadata:
            return self._default_filtered_config(security_level)
            
        # Get numerical security level
        level_value = self.SECURITY_LEVELS.get(security_level, 0)
        
        # Create a copy of the configuration
        filtered_config = {}
        
        # Filter configuration based on security level
        for config_path, config_value in self._flatten_config(self.config).items():
            # Check security level for this path
            path_security = self._get_security_level(config_path)
            
            # If security level is lower or equal to requested level, include it
            if self.SECURITY_LEVELS.get(path_security, 1) <= level_value:
                self._set_nested_value(filtered_config, config_path.split('.'), config_value)
                
        return filtered_config
    
    def _flatten_config(self, config: Dict[str, Any], prefix: str = "") -> Dict[str, Any]:
        """
        Flatten a nested configuration dictionary into a flat dictionary with dotted keys.
        
        Args:
            config: Configuration dictionary
            prefix: Prefix for keys
            
        Returns:
            Flat dictionary with dotted keys
        """
        flat_config = {}
        
        for key, value in config.items():
            # Create the new key with prefix
            new_key = f"{prefix}.{key}" if prefix else key
            
            # If value is a dictionary, recurse
            if isinstance(value, dict):
                flat_config.update(self._flatten_config(value, new_key))
            else:
                # Add the key-value pair to the flat dictionary
                flat_config[new_key] = value
                
        return flat_config
    
    def _get_security_level(self, path: str) -> str:
        """
        Get the security level for a path.
        
        Args:
            path: Configuration path
            
        Returns:
            Security level (public, internal, sensitive)
        """
        # Try exact match first
        if path in self._security_metadata:
            return self._security_metadata[path]
            
        # Try to match parent paths
        parts = path.split('.')
        for i in range(len(parts), 0, -1):
            parent_path = '.'.join(parts[:i])
            if parent_path in self._security_metadata:
                return self._security_metadata[parent_path]
                
        # Default to internal
        return "internal"
    
    def _default_filtered_config(self, security_level: str) -> Dict[str, Any]:
        """
        Apply a default filter to the configuration when no schema is available.
        
        Args:
            security_level: Security level to filter by
            
        Returns:
            Filtered configuration
        """
        # If security level is not public, return everything
        if security_level != "public":
            return deepcopy(self.config)
            
        # Create a copy of the configuration
        filtered_config = deepcopy(self.config)
        
        # Remove sensitive keys by convention
        sensitive_keys = [
            "secret_key", "auth.secret_key", "server.secret_key", 
            "server.cert_file", "server.key_file"
        ]
        
        # Remove sensitive keys
        for key in sensitive_keys:
            parts = key.split('.')
            current = filtered_config
            
            for part in parts[:-1]:
                if part not in current:
                    break
                current = current[part]
                
            last_part = parts[-1]
            if last_part in current:
                del current[last_part]
                
        return filtered_config


# Singleton instance for easier imports
config_manager = ConfigManager()
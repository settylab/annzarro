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

from annzarro.utils import paths

logger = logging.getLogger(__name__)

_MISSING = object()


class ConfigManager:
    """
    Configuration manager for Annzarro.

    Layers, lowest to highest precedence (later layers win):

    1. built-in defaults: ``annzarro/config/base.yaml`` then ``<env>.yaml``
       (package data, independent of the working directory)
    2. system file ``/etc/annzarro/config.yaml``
    3. user file ``~/.config/annzarro/config.yaml`` (``$XDG_CONFIG_HOME`` honoured)
    4. project file ``./config.yaml`` in the directory annzarro is started from
    5. the file passed with ``--config`` (must exist)
    6. ``ANNZARRO_<SECTION>_<KEY>`` environment variables
    7. command-line flags (``--host``, ``--port``, ``--data-dir``, ``--auth-disabled``)

    Validation runs on the fully merged result. Every value's origin is
    recorded so ``annzarro config show`` can say where it came from.
    """

    # Configuration file search paths
    SYSTEM_CONFIG_PATH = "/etc/annzarro/config.yaml"
    PROJECT_CONFIG_PATH = "config.yaml"

    # Built-in defaults ship inside the package, so they are found the same way
    # from a source checkout, an editable install or a wheel, whatever the CWD.
    DEFAULTS_DIR = str(paths.DEFAULTS_DIR)
    SCHEMA_PATH = os.path.join(DEFAULTS_DIR, "schema.yaml")

    # Environment variable prefix
    ENV_PREFIX = "ANNZARRO_"

    # ANNZARRO_* variables that are switches, not configuration keys.
    NON_CONFIG_ENV_VARS = {
        "ANNZARRO_HOME", "ANNZARRO_HEADLESS", "ANNZARRO_AUTH_DISABLED",
        "ANNZARRO_ELECTRON_APP", "ANNZARRO_ELECTRON_MODE", "ANNZARRO_LOCAL_MODE",
    }

    # Command-line flag (argparse dest) -> configuration key path. Only these
    # flags touch the configuration; everything else on the command line
    # (--detach, --no-browser, --format, ...) is an instruction to the CLI.
    CLI_OVERRIDES = {
        "host": ("server", "host"),
        "port": ("server", "port"),
        "data_dir": ("server", "data_dir"),
    }

    # Security levels
    SECURITY_LEVELS = {
        "public": 0,    # Information that can be shared with clients
        "internal": 1,  # Internal server information
        "sensitive": 2  # Security-critical information
    }

    @property
    def USER_CONFIG_PATH(self) -> str:
        return str(paths.user_config_path())

    def __init__(self):
        """Initialize the configuration manager."""
        self._reset()

        # Store original command line arguments
        self.argv = list(sys.argv)

        # Schema cache
        self._schema = None
        self._security_metadata = {} # Path -> security level mapping

    def _reset(self) -> None:
        """Forget everything loaded so far, so load_config() can be called again."""
        self.config = {}
        # Loaded sources, name -> path (kept for backward compatibility)
        self.sources = {}
        # Every source considered, in precedence order, with its outcome
        self.layers = []
        # Dotted key -> name of the layer that set its current value
        self.origins = {}
        self.environment = None
        self._duplicate_keys = {}

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

        Raises:
            FileNotFoundError: ``config_path`` was given but does not exist.
            ValueError: ``config_path`` exists but cannot be parsed.
        """
        self._reset()
        self.environment = env

        # Step 1-2: built-in defaults (package data)
        self._load_yaml_config(os.path.join(self.DEFAULTS_DIR, "base.yaml"), "defaults:base")
        env_file = os.path.join(self.DEFAULTS_DIR, f"{env}.yaml")
        if not os.path.exists(env_file):
            raise ValueError(f"Unknown environment {env!r}: no built-in {env}.yaml")
        self._load_yaml_config(env_file, f"defaults:{env}")

        # Step 3-5: system, user and project files, each optional
        self._load_yaml_config(self.SYSTEM_CONFIG_PATH, "system")
        self._load_yaml_config(self.USER_CONFIG_PATH, "user")
        self._load_yaml_config(os.path.abspath(self.PROJECT_CONFIG_PATH), "project")

        # Step 6: the file named with --config is not optional
        if config_path:
            self._load_yaml_config(os.path.abspath(os.path.expanduser(config_path)),
                                   "--config", required=True)

        # Step 7: environment variables
        self._apply_environment_variables()

        # Step 8: command line flags
        if cli_args is not None:
            self._apply_cli_args(cli_args)

        # Step 9: values that follow from the merged result
        self._finalize()

        logger.debug(f"Configuration loaded from sources: {', '.join(self.sources.keys())}")
        return self.config

    def _record(self, name: str, path: Optional[str], status: str, detail: str = "") -> None:
        self.layers.append({"name": name, "path": path, "status": status, "detail": detail})

    def _merge(self, data: Dict[str, Any], source_name: str) -> None:
        """Deep-merge ``data`` into the configuration and record each key's origin."""
        self._deep_update(self.config, data)
        for key in self._flatten_config(data):
            self.origins[key] = source_name
        # A dict replaced by a scalar (or vice versa) orphans the old sub-keys.
        for key in list(self.origins):
            if self._get_nested(key.split(".")) is _MISSING:
                del self.origins[key]

    def _set_override(self, path: List[str], value: Any, source_name: str) -> None:
        self._set_nested_value(self.config, path, value)
        self.origins[".".join(path)] = source_name

    def _get_nested(self, path: List[str]) -> Any:
        current = self.config
        for key in path:
            if not isinstance(current, dict) or key not in current:
                return _MISSING
            current = current[key]
        return current

    def _load_yaml_config(self, config_path: str, source_name: str,
                          required: bool = False) -> None:
        """
        Load configuration from a YAML (or JSON) file and merge it.

        Args:
            config_path: Path to the configuration file
            source_name: Name of the configuration source for tracking
            required: Raise instead of skipping when the file is missing or broken
        """
        # Check if YAML support is available
        if yaml is None and config_path.endswith(('.yaml', '.yml')):
            logger.warning(f"Cannot load YAML configuration {config_path}: PyYAML is not installed")
            self._record(source_name, config_path, "skipped", "PyYAML not installed")
            return

        path = Path(config_path)
        if not path.is_file():
            logger.debug(f"Configuration file not found: {config_path}")
            self._record(source_name, config_path, "not found")
            if required:
                raise FileNotFoundError(f"Configuration file not found: {config_path}")
            return

        try:
            with open(path, 'r') as f:
                file_content = f.read()

            # Check for duplicate top-level keys in YAML files: the parser
            # silently keeps only the last one.
            if config_path.endswith(('.yaml', '.yml')):
                top_level_keys = []
                duplicate_keys = []
                for line_num, line in enumerate(file_content.split('\n')):
                    if line.strip().startswith('#') or not line.strip():
                        continue
                    if not line.startswith(' ') and not line.startswith('\t') and ':' in line:
                        key = line.split(':', 1)[0].strip()
                        if key in top_level_keys:
                            duplicate_keys.append((key, line_num + 1))
                            logger.warning(f"Warning: Duplicate top-level key '{key}' found in {config_path} at line {line_num + 1}")
                            logger.warning(f"This will override previous settings and can lead to unexpected configuration behavior!")
                        else:
                            top_level_keys.append(key)
                if duplicate_keys:
                    self._duplicate_keys[config_path] = duplicate_keys

            if config_path.endswith(('.yaml', '.yml')):
                config_data = yaml.safe_load(file_content)
            elif config_path.endswith('.json'):
                config_data = json.loads(file_content)
            else:
                raise ValueError("unknown format (expected .yaml, .yml or .json)")
        except Exception as e:
            logger.error(f"Error loading configuration from {config_path}: {e}")
            self._record(source_name, config_path, "error", str(e))
            if required:
                raise ValueError(f"Cannot load configuration file {config_path}: {e}") from e
            return

        if not config_data:
            logger.warning(f"Empty configuration file: {config_path}")
            self._record(source_name, config_path, "empty")
            return
        if not isinstance(config_data, dict):
            msg = f"top level must be a mapping, got {type(config_data).__name__}"
            self._record(source_name, config_path, "error", msg)
            if required:
                raise ValueError(f"Cannot load configuration file {config_path}: {msg}")
            logger.error(f"Ignoring configuration file {config_path}: {msg}")
            return

        self._merge(config_data, source_name)
        self.sources[source_name] = config_path
        self._record(source_name, config_path, "loaded")
        logger.debug(f"Loaded configuration from {config_path}")

    def _match_key_path(self, tokens: List[str], tree: Any) -> Optional[List[str]]:
        """Map ``['server', 'data', 'dir']`` onto an existing key path such as
        ``['server', 'data_dir']``. Keys may themselves contain underscores, so
        the longest existing key wins at each level. None when nothing matches."""
        if not isinstance(tree, dict):
            return None
        for n in range(len(tokens), 0, -1):
            key = "_".join(tokens[:n])
            if key not in tree:
                continue
            rest = tokens[n:]
            if not rest:
                return [key]
            sub = self._match_key_path(rest, tree[key])
            if sub is not None:
                return [key] + sub
        return None

    def _apply_environment_variables(self) -> None:
        """Apply ``ANNZARRO_<SECTION>_<KEY>`` overrides to known keys.

        ``ANNZARRO_SERVER_DATA_DIR`` sets ``server.data_dir``. A variable that
        names no known key is ignored (and reported by ``config show``) rather
        than inventing a key nobody reads.
        """
        applied = []
        for env_var in sorted(os.environ):
            if not env_var.startswith(self.ENV_PREFIX) or env_var in self.NON_CONFIG_ENV_VARS:
                continue
            tokens = env_var[len(self.ENV_PREFIX):].lower().split('_')
            key_path = self._match_key_path(tokens, self.config)
            if key_path is None:
                logger.debug(f"Ignoring {env_var}: it names no configuration key")
                self._record("env", env_var, "ignored", "names no configuration key")
                continue
            self._set_override(key_path, self._convert_value(os.environ[env_var]), f"env:{env_var}")
            self.sources[f"env_var_{'_'.join(key_path)}"] = env_var
            applied.append(env_var)

        if applied:
            self._record("env", ", ".join(applied), "loaded")
            logger.debug(f"Applied {len(applied)} environment variable overrides")

    def _apply_cli_args(self, args: argparse.Namespace) -> None:
        """
        Apply command line flag overrides to the configuration.

        Only the flags in ``CLI_OVERRIDES`` plus ``--auth-disabled`` are
        configuration; ``--data-dir`` sets ``server.data_dir``, not
        ``data.dir``.
        """
        applied = []
        for dest, key_path in self.CLI_OVERRIDES.items():
            value = getattr(args, dest, None)
            if value is None:
                continue
            self._set_override(list(key_path), value, f"cli:--{dest.replace('_', '-')}")
            applied.append(f"--{dest.replace('_', '-')}")

        if getattr(args, "auth_disabled", False):
            self._set_override(["auth", "enabled"], False, "cli:--auth-disabled")
            applied.append("--auth-disabled")

        for flag in applied:
            self.sources[f"cli_arg_{flag.lstrip('-').replace('-', '_')}"] = flag
        if applied:
            self._record("cli", " ".join(applied), "loaded")
            logger.debug(f"Applied {len(applied)} command line argument overrides")

    def _finalize(self) -> None:
        """Derive values that depend on the merged result."""
        server = self.config.setdefault("server", {})
        auth = self.config.setdefault("auth", {})

        if isinstance(server.get("data_dir"), str):
            server["data_dir"] = os.path.expanduser(server["data_dir"])

        # Runtime state never lands in the package directory, and only lands in
        # the working directory when a relative path is configured explicitly.
        if not server.get("log_file"):
            self._set_override(["server", "log_file"], str(paths.default_log_file()),
                               "derived:user state dir")
        else:
            server["log_file"] = os.path.expanduser(str(server["log_file"]))

        user_file = auth.get("user_file")
        if not user_file:
            checkout = paths.source_checkout_root()
            legacy = checkout / "config" / "auth" / "users.json" if checkout else None
            if legacy is not None and legacy.is_file():
                self._set_override(["auth", "user_file"], str(legacy),
                                   "derived:source checkout (legacy location)")
            else:
                self._set_override(["auth", "user_file"],
                                   str(paths.user_state_dir() / "auth" / "users.json"),
                                   "derived:user state dir")
        else:
            user_file = os.path.expanduser(str(user_file))
            if not os.path.isabs(user_file):
                # Historical behaviour (AuthManager) resolved relative paths
                # against the checkout root; outside a checkout that would be
                # site-packages, so use the state directory instead.
                anchor = paths.source_checkout_root() or paths.user_state_dir()
                user_file = str(Path(anchor) / user_file)
            auth["user_file"] = user_file

        # A server reachable from other machines requires login, unless
        # explicitly disabled with --auth-disabled or ANNZARRO_AUTH_DISABLED.
        host = server.get("host")
        env_disabled = self._convert_value(os.environ.get("ANNZARRO_AUTH_DISABLED", "") or "false")
        if env_disabled is True:
            self._set_override(["auth", "enabled"], False, "env:ANNZARRO_AUTH_DISABLED")
        elif (host and str(host) not in ("127.0.0.1", "localhost", "::1")
              and self.origins.get("auth.enabled") != "cli:--auth-disabled"):
            if not auth.get("enabled"):
                self._set_override(["auth", "enabled"], True, "derived:non-loopback host")
                logger.info("Authentication enabled by default for non-localhost host")

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
    
    def get_config_info(self) -> Dict[str, Any]:
        """
        Get information about the configuration sources and values.

        Returns:
            ``sources`` (loaded sources, name -> path), ``layers`` (every source
            considered, in precedence order, with its outcome), ``origins``
            (dotted key -> source that set it), plus the raw environment and argv.
        """
        return {
            "environment": self.environment,
            "sources": dict(self.sources),
            "layers": [dict(layer) for layer in self.layers],
            "origins": dict(self.origins),
            "environment_variables": {
                k: v for k, v in os.environ.items()
                if k.startswith(self.ENV_PREFIX)
            },
            "command_line_args": self.argv[1:] if len(self.argv) > 1 else []
        }

    def validate_config(self) -> Tuple[bool, List[str]]:
        """
        Validate the merged configuration.

        Returns:
            Tuple of (is_valid, error_messages)
        """
        errors = []
        warnings = []

        # Check required fields
        required_fields = [
            ("server", "host"),
            ("server", "port"),
            ("server", "data_dir")
        ]

        for section, field in required_fields:
            value = self.config.get(section, {}).get(field) if isinstance(self.config.get(section), dict) else None
            if value is None or value == "":
                errors.append(f"Missing required configuration: {section}.{field}")

        port = self.config.get("server", {}).get("port") if isinstance(self.config.get("server"), dict) else None
        if port is not None and (isinstance(port, bool) or not isinstance(port, int) or not 0 < port < 65536):
            errors.append(f"Invalid server.port: {port!r} (expected an integer 1-65535)")

        # Validate auth configuration
        if self.config.get("auth", {}).get("enabled", False):
            if not self.config.get("auth", {}).get("secret_key"):
                errors.append("Authentication is enabled but no secret_key is set")

            if not self.config.get("auth", {}).get("user_file"):
                errors.append("Authentication is enabled but no user_file is set")

        # Check for duplicate keys in YAML files
        for file_path, duplicates in self._duplicate_keys.items():
            for key, line_num in duplicates:
                warning = f"Duplicate key '{key}' in {file_path} (line {line_num}) - later values will override earlier ones"
                warnings.append(warning)
                errors.append(warning)  # Treat as an error for validation

        # Log warnings
        for warning in warnings:
            logger.warning(f"Configuration warning: {warning}")

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
            logger.info(f"Server host in nested config: {self.config['server'].get('host', 'NOT FOUND')}")
            for key, value in self.config["server"].items():
                flask_config[key] = value
            
        logger.info(f"Final flattened host: {flask_config.get('host', 'NOT FOUND')}")
        
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
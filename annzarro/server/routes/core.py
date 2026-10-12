"""
Core routes for the Annzarro server.

This module contains core routes for server configuration, status, and dataset listing.
"""

import os
import psutil
import time
import platform
import logging
from datetime import datetime, timedelta
from pathlib import Path
from flask import request, jsonify, current_app as app

from .. import access
from . import dataset_folders
from ...data.manager import data_manager
from ...data.scan import DEFAULT_MAX_ENTRIES as DEFAULT_SCAN_ENTRIES, count_stores

logger = logging.getLogger(__name__)

#: Seconds /status reuses its count of the data directory's stores
STATUS_COUNT_TTL_S = 30

def register_core_routes(app, api_version):
    """
    Register core routes with the Flask app.
    
    Args:
        app: Flask application instance
        api_version: API version string
    """
    
    def _scan_limit():
        return int(app.config.get("dataset_scan_max_entries") or DEFAULT_SCAN_ENTRIES)

    @app.route(f"/api/{api_version}/core/datasets", methods=["GET"])
    @access.gate("listing")
    def list_legacy_datasets():
        """
        List available datasets (legacy endpoint).
        
        Returns:
            JSON response with dataset list
        """
        # Get data directory from config
        data_dir = app.config.get("data_dir")
        
        # Override from query parameter if provided
        if "dir" in request.args:
            data_dir = request.args.get("dir")
            
            # Handle "." as current directory by converting to os.getcwd()
            if data_dir == ".":
                data_dir = os.getcwd()
        
        # Add option to scan recursively
        recursive = request.args.get("recursive", "true").lower() == "true"
        
        # Add option to follow symlinks
        follow_symlinks = request.args.get("follow_symlinks", "true").lower() == "true"
        
        # List datasets with new options
        restricted = access.restricted_user()
        if restricted and "dir" not in request.args:
            # no folder named: what the user is granted, never the data directory
            datasets, truncated = _granted_datasets(restricted, recursive, follow_symlinks)
        else:
            datasets = data_manager.list_datasets(data_dir, recursive=recursive, follow_symlinks=follow_symlinks,
                                                  max_entries=_scan_limit())
            truncated = data_manager.truncated
        # Not offered when hosted: anything a link leads to outside the roots
        from ..confinement import listable
        datasets = [d for d in datasets
                    if not isinstance(d, dict) or not d.get("path") or listable(app.config, d["path"])]
        datasets = access.filter_entries(datasets)
        
        reply = {"datasets": datasets}
        if truncated:
            reply.update({"truncated": True, "reason": "scan_limit",
                          "note": f"The directory has more than {_scan_limit():,} entries "
                                  "(server.dataset_scan_max_entries); only the stores found before that are listed."})
        return jsonify(reply)

    def _granted_datasets(user, recursive, follow_symlinks):
        """The stores a restricted user is granted: each granted store, and those found under each granted folder."""
        found, truncated, seen = [], False, set()
        for grant in access.grants_of(user).active():
            real = grant["real"]
            if os.path.isdir(real) and not dataset_folders.is_store_dir(real, grant["name"]):
                stores = data_manager.discover_datasets(real, recursive=recursive, follow_symlinks=follow_symlinks,
                                                        max_entries=_scan_limit())
                truncated = truncated or data_manager.truncated
            elif os.path.isdir(real) or (real.endswith(".h5ad") and os.path.isfile(real)):
                stores = [{"id": Path(real).stem, "name": Path(real).stem.replace("_", " ").title(),
                           "path": real, "type": "zarr" if os.path.isdir(real) else "h5ad", "is_symlink": False}]
            else:
                continue
            for store in stores:
                if store["path"] not in seen:
                    seen.add(store["path"])
                    found.append(store)
        found.sort(key=lambda d: d["name"])
        return found, truncated

    @app.route(f"/api/{api_version}/config", methods=["GET"])
    @access.gate("public")
    def get_config():
        """
        The configuration the browser may see.

        Exactly the keys schema.yaml marks ``security: public`` (directly or
        through their section), plus the flat ``ui_*`` / ``app_name`` /
        ``integrations`` keys static/js/config.js reads -- derived from those
        public keys only -- and two environment flags. Nothing else: no
        internal key (data_dir, log_file, user_file, cors_origins ...) and
        never a sensitive one. The tiers used to be ignored (issue #32) and
        this route fell back to a hand-written list that published data_dir.

        Returns:
            JSON response with the public configuration
        """
        from annzarro.utils.config_manager import ConfigManager
        manager = ConfigManager()
        tree = app.config.get("config_tree")
        if not tree:
            # create_app() given a flat config directly: nest it the way a
            # flat config file is nested. Flask's own UPPERCASE settings are
            # not configuration.
            from annzarro.server.core import DEFAULT_CONFIG
            flat = dict(DEFAULT_CONFIG)
            flat.update({k: v for k, v in app.config.items() if k == k.lower()})
            tree = manager._nest_flat_config(flat)
        public = manager.filter_by_level(tree, "public")
        client = dict(public)
        client.update(manager.client_keys(public))
        # host/port also at the top level, where clients read them before
        for key in ("host", "port"):
            if key in public.get("server", {}):
                client[key] = public["server"][key]
        # The gene set panel's external requests (integrations.external_requests),
        # forced by the environment where a deployment (the desktop app, an
        # offline install) must not depend on a config file
        forced = os.environ.get("ANNZARRO_EXTERNAL_REQUESTS", "").strip().lower()
        if forced in ("ask", "on", "off", "none"):
            integrations = dict(client.get("integrations") or {})
            integrations["external_requests"] = forced
            client["integrations"] = integrations
        client["electron_mode"] = os.environ.get("ANNZARRO_ELECTRON_MODE", "0") == "1"
        client["local_mode"] = os.environ.get("ANNZARRO_LOCAL_MODE", "0") == "1"
        # One user on this machine (loopback, login off, no proxy, not
        # hosted): the decision remote_stores: auto makes, from the same
        # function. The client spends server memory ahead of need only then
        # (the cell-name index prewarm).
        from annzarro.core.remote import hosted_reasons
        client["single_user"] = not hosted_reasons(app.config)
        # The browser memory guard budgets a tab from the computer's memory,
        # which a browser cannot see. A browser on this computer (a loopback
        # request that no proxy forwarded) gets this computer's RAM; any
        # other gets none and the guard's default for a remote browser.
        host_memory = _host_memory_bytes()
        if host_memory:
            ui = dict(client.get("ui") or {})
            memory = dict(ui.get("memory") or {})
            memory["host_memory_bytes"] = host_memory
            ui["memory"] = memory
            client["ui"] = ui
        # recorded in saved views and exported figures (same version, same
        # rendering; another version says it may differ)
        from annzarro import __version__
        client["annzarro_version"] = __version__
        return jsonify(client)

    def _host_memory_bytes():
        """This computer's RAM in bytes for a browser on it, else None."""
        import ipaddress
        try:
            local = ipaddress.ip_address(request.remote_addr or "").is_loopback
        except ValueError:
            local = False
        if not local or request.headers.get("X-Forwarded-For") or request.headers.get("Forwarded"):
            return None
        try:
            return int(psutil.virtual_memory().total)
        except Exception:  # psutil missing or failing: the remote default applies
            return None
        
    @app.route(f"/api/{api_version}/auth/me", methods=["GET"])
    @access.gate("public")
    def get_current_user():
        """
        Who the requester is and what they may change.

        Registered whether or not login is enabled, so the client can ask one
        question in both modes. ``exposed`` is true when the server listens
        beyond this machine with login disabled -- anyone who can reach it can
        then edit and delete every shared panel set.

        ``may_open_any_path`` says whether this requester may open dataset
        paths outside the data directories (``server.arbitrary_paths``).
        ``remote_stores`` says whether this server opens remote store URLs at
        all (``server.remote_stores``, ``remote_allowlist``): the dataset
        picker mentions a URL only when it can work.

        Returns:
            JSON ``{auth_enabled, username, is_admin, exposed, may_open_any_path, remote_stores, restricted}``.
            ``restricted`` is true for a user who sees only the datasets they are granted.
        """
        from .. import confinement, permissions
        from ...core.remote import get_remote_policy
        username, is_admin = permissions.current_user()
        from .. import csrf
        from ..core import is_logged_in
        response = jsonify({
            # the token of this login, for a page that was open before it changed (utils/csrf.js)
            "csrf": csrf.csrf_token() if permissions.auth_enabled() and is_logged_in() else "",
            "auth_enabled": permissions.auth_enabled(),
            "username": username,
            "is_admin": is_admin,
            "exposed": permissions.is_exposed(app.config),
            "may_open_any_path": confinement.may_open_any_path(app.config),
            "remote_stores": bool(get_remote_policy().enabled),
            "restricted": access.is_restricted_requester(),
        })
        response.headers["Cache-Control"] = "no-store"   # it carries the login's token
        return response

    def _version():
        try:
            from annzarro import __version__
            return __version__
        except ImportError:
            return "0.1.0"  # Fallback version

    _count_cache = {}

    def _store_count(data_dir):
        """(stores under the data directory, whether the count was cut short),
        counted at most every STATUS_COUNT_TTL_S: /status is open to every
        client, and the walk visits up to dataset_scan_max_entries entries."""
        now = time.monotonic()
        hit = _count_cache.get(data_dir)
        if hit is not None and now - hit[0] < STATUS_COUNT_TTL_S:
            return hit[1]
        result = count_stores(data_dir, _scan_limit())
        _count_cache[data_dir] = (now, result)
        return result

    @app.route(f"/api/{api_version}/status", methods=["GET"])
    @access.gate("admin")
    def get_status():
        """
        Get server status information.
        
        Returns:
            JSON response with server status information

        On a shared server only an admin gets the host, the process and the
        data directory (and the other users' datasets they imply); everybody
        else gets whether the server is up, for a load balancer's probe.
        """
        from .. import permissions
        if not permissions.may_see_server_details(app.config):
            return jsonify({"server": {"status": "running", "version": _version()}})
        try:
            # Get process information
            process = psutil.Process(os.getpid())
            
            # Calculate uptime
            start_time = datetime.fromtimestamp(process.create_time())
            uptime = datetime.now() - start_time
            
            # Format uptime
            days, remainder = divmod(uptime.total_seconds(), 86400)
            hours, remainder = divmod(remainder, 3600)
            minutes, seconds = divmod(remainder, 60)
            uptime_str = f"{int(days)}d {int(hours)}h {int(minutes)}m {int(seconds)}s"
            
            # Get memory usage
            memory_info = process.memory_info()
            memory_usage_mb = memory_info.rss / (1024 * 1024)  # Convert to MB
            
            # Get load information
            # since the previous call: a blocking sample would hold a thread
            # for 0.2 s per request, and /status is open to every client
            cpu_load = process.cpu_percent(interval=None)
            system_load = psutil.cpu_percent(interval=None)
            
            # Get connection count
            try:
                # Use net_connections instead of connections which is deprecated
                connections_count = len(process.net_connections())
            except Exception:
                # Fallback in case of permission issues
                connections_count = 0
            
            # Check data directory
            data_dir = app.config.get("data_dir")
            data_dir_exists = os.path.exists(data_dir)
            data_dir_is_readable = os.access(data_dir, os.R_OK)
            data_dir_is_writable = os.access(data_dir, os.W_OK)
            
            # Count files in data directory
            zarr_count, count_truncated = (0, False)
            if data_dir_exists and data_dir_is_readable:
                zarr_count, count_truncated = _store_count(data_dir)
            
            version = _version()

            # Build status information
            status = {
                "server": {
                    "status": "running",
                    "version": version,
                    "start_time": start_time.isoformat(),
                    "uptime": uptime_str,
                    "uptime_seconds": int(uptime.total_seconds()),
                    "pid": process.pid,
                    "python_version": platform.python_version(),
                    "platform": platform.platform(),
                    "hostname": platform.node()
                },
                "config": {
                    "host": app.config.get("host", "127.0.0.1"),
                    "port": app.config.get("port", 8000),
                    "data_dir": data_dir,
                    "unified_server": app.config.get("unified_server", True)
                    # static_dir removed - no need to expose internal file paths
                },
                "resources": {
                    "memory_usage_mb": round(memory_usage_mb, 2),
                    "cpu_load": round(cpu_load, 2),
                    "system_load": round(system_load, 2),
                    "connections": connections_count
                },
                "data": {
                    "data_dir_exists": data_dir_exists,
                    "data_dir_readable": data_dir_is_readable,
                    "data_dir_writable": data_dir_is_writable,
                    "zarr_file_count": zarr_count,
                    "zarr_file_count_truncated": count_truncated
                }
            }
            
            return jsonify(status)
        except Exception as e:
            logger.error(f"Error in get_status: {e}")
            return jsonify({
                "server": {
                    "status": "error",
                    "error": str(e)
                }
            }), 500

    @app.route(f"/api/{api_version}/datasets/<path:dataset_path>", methods=["GET"])
    @access.gate("dataset")
    def get_dataset_info(dataset_path: str):
        """
        Get information about a dataset.
        
        Args:
            dataset_path: Path to the dataset
            
        Returns:
            JSON response with dataset information
        """
        # Get dataset info
        info = data_manager.get_dataset_info(dataset_path)
        if isinstance(info, dict) and "error" in info:
            # It exists (checked before the route) but cannot be opened
            return jsonify(dict(info, reason="unsupported_type")), 400
        
        return jsonify(info)
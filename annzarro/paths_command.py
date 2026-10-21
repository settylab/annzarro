"""``annzarro paths``: where annzarro reads and writes, and why each location is what it is.

    annzarro paths
    annzarro paths --config /etc/annzarro/site.yaml --state-dir /var/lib/annzarro

Lists the configuration files in effect, the data directory, and the places annzarro writes
(state, users and admin state, log, PID file, panel sets, cache). Each line names its origin:
a flag, an environment variable, a configuration key (with its file), or the default. Exit 1
when a location is refused at start-up, for example a state directory inside a data root.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

from annzarro.utils import paths
from annzarro.utils.config_manager import ConfigManager


def add_parser(subparsers, overrides) -> None:
    parser = subparsers.add_parser(
        "paths", parents=[overrides], help="Show where annzarro keeps its data, state and logs, and why",
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--env", choices=("production", "development"), default="production",
                        help="Configuration environment (default production)")
    parser.add_argument("--format", choices=("text", "json"), default="text", help="Output format")
    parser.set_defaults(func=paths_command)


def describe_origin(manager, key: str) -> str:
    """Why ``key`` has its value: flag, environment variable, config key and file, or default."""
    origin = manager.origins.get(key, "")
    if origin.startswith("cli:"):
        return f"flag {origin[4:]}"
    if origin.startswith("env:"):
        return f"environment variable {origin[4:]}"
    if origin.startswith("derived:"):
        return f"default ({origin[8:]})"
    if origin in ("system", "user", "project", "--config"):
        return f"config key {key} in {manager.sources.get(origin, origin)}"
    return "default"


def panel_sets_entry(manager, server) -> dict:
    """Where panel sets are kept; a legacy location says so, with the reason."""
    from annzarro.server import panel_sets

    location = panel_sets.resolve(manager.to_flask_config())
    if location.mode == panel_sets.LEGACY:
        return {"label": "panel sets", "path": location.path, "legacy": True,
                "why": "legacy location: " + location.note}
    why = describe_origin(manager, "server.panel_sets_dir")
    if location.note:
        why += "; " + location.note
    return {"label": "panel sets", "path": location.path, "legacy": False, "why": why}


def collect(manager) -> dict:
    """The report as data: config files, then one entry per location."""
    from annzarro.server.admin import STATE_DIR_NAME

    server = manager.config.get("server", {})
    auth = manager.config.get("auth", {})
    state = server["state_dir"]
    user_file = auth["user_file"]

    def entry(label, path, why):
        return {"label": label, "path": path, "why": why}

    files = [{"layer": layer["name"], "path": layer["path"], "found": layer["status"] in ("loaded", "empty")}
             for layer in manager.layers if layer["path"] and not layer["name"] in ("env", "cli")]
    locations = [
        entry("data directory", server.get("data_dir"), describe_origin(manager, "server.data_dir")),
        entry("state directory", state, describe_origin(manager, "server.state_dir")),
        entry("users file", user_file, describe_origin(manager, "auth.user_file")),
        entry("admin state", os.path.join(os.path.dirname(user_file), STATE_DIR_NAME), "beside the users file"),
        entry("log file", server.get("log_file"), describe_origin(manager, "server.log_file")),
        entry("PID file", str(paths.pid_file()), "in the state directory"),
        panel_sets_entry(manager, server),
        entry("cache", server["cache_dir"], describe_origin(manager, "server.cache_dir")),
    ]
    for extra in server.get("allowed_dirs") or []:
        locations.insert(1, entry("extra data directory", extra, describe_origin(manager, "server.allowed_dirs")))
    return {"config_files": files, "locations": locations, "problems": paths.state_dir_problems(server)}


def render(report: dict) -> str:
    lines = ["Configuration files (later ones win):"]
    for f in report["config_files"]:
        note = "" if f["found"] else "  (not found)"
        if f["found"] and f["layer"] == "project":
            note = "  (deprecated: stops working in 0.8; use --config or ANNZARRO_CONFIG)"
        lines.append(f"  {f['layer']:<10} {f['path']}{note}")
    lines += ["", "Locations:"]
    width = max(len(loc["label"]) for loc in report["locations"])
    for loc in report["locations"]:
        lines.append(f"  {loc['label']:<{width}}  {loc['path']}")
        lines.append(f"  {'':<{width}}    {loc['why']}")
    if report["problems"]:
        lines += ["", "Problems (the server refuses to start):"] + [f"  {p}" for p in report["problems"]]
    return "\n".join(lines)


def paths_command(args: argparse.Namespace) -> int:
    manager = ConfigManager()
    try:
        manager.load_config(env=args.env, config_path=getattr(args, "config", None), cli_args=args)
    except (FileNotFoundError, ValueError) as e:
        print(f"Configuration error: {e}", file=sys.stderr)
        return 1
    report = collect(manager)
    print(json.dumps(report, indent=2) if args.format == "json" else render(report))
    return 1 if report["problems"] else 0

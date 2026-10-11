"""``annzarro store``: look at a store's layout.

    annzarro store check data/atlas.zarr
    annzarro store check https://host/atlas.zarr --json --fail-on warning

``check`` reports what in the layout makes AnnZarro slow (core/store_check.py),
from metadata only. Exit status: 0 when no finding is at or above ``--fail-on``
(default ``slow``), 1 when one is, 2 when the store cannot be opened.
"""
from __future__ import annotations

import argparse
import json
import sys

from annzarro.core import layout_thresholds as thresholds
from annzarro.core import store_check


def add_parser(subparsers) -> None:
    parser = subparsers.add_parser("store", help="Inspect a store's layout",
                                   description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    store_subparsers = parser.add_subparsers(dest="store_command", help="Store command")
    check = store_subparsers.add_parser(
        "check", help="Report layout problems that make AnnZarro slow (metadata only)",
        description=store_check.__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    check.add_argument("store", help="A zarr store: a local directory or an s3://, gs://, http(s):// URL")
    check.add_argument("--json", action="store_true", help="Print the report as JSON")
    check.add_argument("--fail-on", choices=(*thresholds.SEVERITIES, "never"), default="slow",
                       help="Exit 1 when a finding is at or above this severity (default slow)")
    check.add_argument("--config", default=argparse.SUPPRESS,
                       help="Configuration file: its server.max_read_mb is the read limit to judge against")
    check.add_argument("--max-read-mb", type=float, default=None,
                       help="The server's read limit for obsp/varp rows; overrides server.max_read_mb "
                            "of --config; default: the server's own default for this machine")
    check.set_defaults(func=store_check_command)
    parser.set_defaults(func=lambda args: (parser.print_help(), 1)[1])


def _config_max_read_mb(path):
    """server.max_read_mb of the configuration (``--config`` or ANNZARRO_CONFIG), or None."""
    if not path:
        return None
    from annzarro.cli import load_config
    config = load_config(config_path=path, env="production", exit_on_invalid=False)
    return (config.get("server") or {}).get("max_read_mb") or None


def store_check_command(args) -> int:
    max_read_mb = args.max_read_mb or _config_max_read_mb(getattr(args, "config", None))
    try:
        report = store_check.check_store(args.store, max_read_mb=max_read_mb)
    except store_check.StoreCheckError as exc:
        print(f"annzarro store check: {exc}", file=sys.stderr)
        return 2
    failed = store_check.exceeds(report, args.fail_on)
    report["fail_on"] = args.fail_on
    report["failed"] = failed
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(store_check.format_report(report))
    return 1 if failed else 0

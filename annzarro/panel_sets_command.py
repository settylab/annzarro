"""``annzarro panel-sets migrate``: copy panel sets from ``<data_dir>/sessions`` to the state directory.

    annzarro panel-sets migrate --dry-run
    annzarro panel-sets migrate --config /etc/annzarro/site.yaml

Panel sets used to live in ``<data_dir>/sessions``. An install that still has them there keeps
using that folder until you run this. The command copies every panel set to
``server.panel_sets_dir`` (by default ``<state_dir>/panel-sets``), compares each copy byte for
byte with its original, and reports. It writes nothing into the data directory, never overwrites
a different file already in the target and never deletes anything; run it again and it reports the
same files as already copied. Once the new folder holds panel sets, the server uses it.
"""
from __future__ import annotations

import argparse
import sys

from annzarro.server import panel_sets
from annzarro.utils.config_manager import ConfigManager


def add_parser(subparsers, overrides) -> None:
    parser = subparsers.add_parser(
        "panel-sets", help="Manage where panel sets are kept",
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="panel_sets_command", required=True)
    migrate = sub.add_parser("migrate", parents=[overrides],
                             help="Copy panel sets from <data_dir>/sessions to the panel-sets directory",
                             description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    migrate.add_argument("--env", choices=("production", "development"), default="production",
                         help="Configuration environment (default production)")
    migrate.add_argument("--dry-run", action="store_true", help="Report what would be copied; write nothing")
    migrate.set_defaults(func=panel_sets_command)


def panel_sets_command(args: argparse.Namespace) -> int:
    manager = ConfigManager()
    try:
        manager.load_config(env=getattr(args, "env", "production"), config_path=getattr(args, "config", None),
                            cli_args=args)
    except (FileNotFoundError, ValueError) as e:
        print(f"Configuration error: {e}", file=sys.stderr)
        return 1
    flat = manager.to_flask_config()
    try:
        report = panel_sets.migrate(flat, dry_run=args.dry_run)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    return print_report(report)


def print_report(report) -> int:
    verb = "Would copy" if report.dry_run else "Copied"
    print(f"From {report.source}\nTo   {report.target}")
    if not report.locked:
        print("Note: the source folder is read-only, so it was not locked; stop the server first if it is running.")
    print(f"{verb} {len(report.copied)} panel set(s); {len(report.identical)} already there and identical.")
    for name in report.conflicts:
        print(f"  CONFLICT {name}: a different file of that name is in the target; left untouched")
    for name in report.failed:
        print(f"  FAILED   {name}: not copied")
    if report.conflicts or report.failed:
        print("Resolve the files named above and run the command again.")
        return 1
    if not report.dry_run and (report.copied or report.identical):
        print(f"You can now delete {report.source} (this command never deletes anything).")
    return 0

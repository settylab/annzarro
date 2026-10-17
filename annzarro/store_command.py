"""``annzarro store``: look at a store's layout, and record its attribution.

    annzarro store check data/atlas.zarr
    annzarro store check https://host/atlas.zarr --json --fail-on warning
    annzarro store annotate data/atlas.zarr --license CC-BY-4.0 --doi 10.1234/abcd --readme README.md

``check`` reports what in the layout makes AnnZarro slow (core/store_check.py),
from metadata only. Exit status: 0 when no finding is at or above ``--fail-on``
(default ``slow``), 1 when one is, 2 when the store cannot be opened.

``annotate`` writes ``uns["annzarro"]`` and ``uns["README"]`` into a local zarr store (see
core/dataset_annotate.py).
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
    annotate = store_subparsers.add_parser(
        "annotate", help="Record a dataset's attribution and README in the store (uns)",
        description="Write uns['annzarro'] (title, license, doi, ...) and uns['README'] into a local zarr "
                    "store. AnnZarro shows them behind the dataset's information button and in the dataset "
                    "browser. Only the fields given are written.")
    annotate.add_argument("store", help="A local zarr store (a directory)")
    for flag, dest, text in (("--title", "title", "A short title"),
                             ("--description", "description", "One or two sentences about the data"),
                             ("--license", "license", "An SPDX identifier (CC-BY-4.0) or the licence text"),
                             ("--license-url", "license_url", "A link to the licence"),
                             ("--citation", "citation", "How to cite the data"),
                             ("--doi", "doi", "The DOI of the data or its paper (10.xxxx/...)"),
                             ("--source-url", "source_url", "Where the data came from"),
                             ("--contact", "contact", "An email address or a link"),
                             ("--attribution", "attribution", "Credit the licence asks for")):
        annotate.add_argument(flag, dest=dest, default=None, help=text)
    annotate.add_argument("--author", dest="authors", action="append", default=None,
                          help="An author; repeat for several")
    annotate.add_argument("--readme", default=None, metavar="FILE", help="A Markdown file to store as uns['README']")
    annotate.set_defaults(func=store_annotate_command)
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


def store_annotate_command(args) -> int:
    from annzarro.core import dataset_annotate
    fields = {name: getattr(args, name) for name in dataset_annotate.FIELDS}
    readme = None
    if args.readme:
        try:
            with open(args.readme, encoding="utf-8") as fh:
                readme = fh.read()
        except (OSError, UnicodeDecodeError) as exc:
            print(f"annzarro store annotate: cannot read {args.readme}: {exc}", file=sys.stderr)
            return 2
    try:
        written = dataset_annotate.annotate_store(args.store, fields, readme)
    except dataset_annotate.AnnotateError as exc:
        print(f"annzarro store annotate: {exc}", file=sys.stderr)
        return 2
    for item in written:
        print(f"wrote {item}")
    return 0

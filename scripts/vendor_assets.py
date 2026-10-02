#!/usr/bin/env python3
"""
Install the pinned third-party frontend assets into ``static/vendor/``.

The list lives in ``scripts/vendor-assets.json``: for every file its upstream
URL, SHA-256 and SPDX license, grouped by component. Nothing is written to the
destination unless its checksum matches the manifest, so a compromised CDN or a
silently changed upstream file fails the build instead of shipping.

Used by:

* ``setup.py`` -- every wheel/sdist build calls :func:`ensure`, so the assets
  ship inside the package (``annzarro/static/vendor``) and a pip-installed
  AnnZarro serves a working UI offline;
* ``annzarro-install.py`` -- provisioning a source checkout;
* maintainers, directly::

    python scripts/vendor_assets.py            # fetch missing, verify all
    python scripts/vendor_assets.py --check    # verify only, never download
    python scripts/vendor_assets.py --notice   # regenerate THIRD_PARTY_LICENSES/README.md

Standard library only: this runs inside isolated build environments and before
any dependency is installed.
"""

import argparse
import hashlib
import json
import os
import sys
import tempfile
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
MANIFEST = os.path.join(HERE, "vendor-assets.json")
DEFAULT_DEST = os.path.join(REPO_ROOT, "static", "vendor")
LICENSES_DIR = os.path.join(REPO_ROOT, "annzarro", "THIRD_PARTY_LICENSES")
NOTICE = os.path.join(LICENSES_DIR, "README.md")

USER_AGENT = "annzarro-vendor-assets/1 (+https://github.com/settylab/annzarro)"


class VendorError(RuntimeError):
    """A vendored asset is missing, cannot be fetched, or fails its checksum."""


def load_manifest(path=MANIFEST):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def iter_files(manifest):
    """Yield every file entry, annotated with its component's name/version/license."""
    for comp in manifest["components"]:
        for entry in comp["files"]:
            item = dict(entry)
            item["component"] = comp["name"]
            item["version"] = comp["version"]
            item.setdefault("license", comp["license"])
            yield item


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def verify(dest=DEFAULT_DEST, manifest=None):
    """Return ``(missing, mismatched)`` lists of manifest paths."""
    manifest = manifest or load_manifest()
    missing, mismatched = [], []
    for item in iter_files(manifest):
        target = os.path.join(dest, item["path"])
        if not os.path.isfile(target):
            missing.append(item["path"])
        elif sha256_of(target) != item["sha256"]:
            mismatched.append(item["path"])
    return missing, mismatched


def _download(item, target, timeout=60):
    req = urllib.request.Request(item["url"], headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read()
    except Exception as e:  # network, HTTP, TLS
        raise VendorError(f"cannot download {item['url']}: {e}") from e
    digest = hashlib.sha256(data).hexdigest()
    if digest != item["sha256"]:
        raise VendorError(
            f"checksum mismatch for {item['url']}: expected {item['sha256']}, got {digest}. "
            "Refusing to install it. If upstream really changed, review the new file and "
            "update scripts/vendor-assets.json deliberately."
        )
    os.makedirs(os.path.dirname(target), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(target), prefix=".vendor-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, target)  # never leave a half-written asset behind
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def ensure(dest=DEFAULT_DEST, download=True, replace_mismatched=False, log=print):
    """Make ``dest`` contain every manifest file with the pinned checksum.

    Missing files are downloaded (when ``download``) and verified before they
    are written. A present file with the wrong checksum is an error unless
    ``replace_mismatched``. Files in ``dest`` that are not in the manifest are
    left alone; they are not shipped (the wheel lists vendor files explicitly).
    """
    manifest = load_manifest()
    missing, mismatched = verify(dest, manifest)
    if mismatched and not replace_mismatched:
        raise VendorError(
            "vendored assets do not match scripts/vendor-assets.json: "
            + ", ".join(mismatched)
            + f" (in {dest}). Delete them to re-download, or re-run with --replace."
        )
    todo = set(missing) | (set(mismatched) if replace_mismatched else set())
    if todo and not download:
        raise VendorError(f"missing vendored assets in {dest}: {', '.join(sorted(todo))}")
    for item in iter_files(manifest):
        if item["path"] in todo:
            log(f"vendor: fetching {item['path']} ({item['component']} {item['version']})")
            _download(item, os.path.join(dest, item["path"]))
    total = sum(1 for _ in iter_files(manifest))
    log(f"vendor: {total} assets verified in {dest}")
    return sorted(todo)


def render_notice(manifest=None):
    """The per-asset notice shipped as THIRD_PARTY_LICENSES/README.md."""
    manifest = manifest or load_manifest()
    lines = [
        "# Third-party components",
        "",
        "<!-- Generated by `python scripts/vendor_assets.py --notice` from",
        "     scripts/vendor-assets.json. Do not edit by hand. -->",
        "",
        "AnnZarro's web interface ships the following third-party files, unmodified,",
        "under `annzarro/static/vendor/`. Each file keeps its original copyright",
        "header. The full license texts are in this directory.",
        "",
        "| Component | Version | License (SPDX) | License text |",
        "|---|---|---|---|",
    ]
    for comp in manifest["components"]:
        texts = ", ".join(f"[{t}]({t})" for t in comp["license_files"])
        lines.append(f"| [{comp['name']}]({comp['homepage']}) | {comp['version']} | "
                     f"`{comp['license']}` | {texts} |")
    lines += ["", "## Files", ""]
    for comp in manifest["components"]:
        lines.append(f"### {comp['name']} {comp['version']}")
        lines.append("")
        if comp.get("notes"):
            lines += [comp["notes"], ""]
        for entry in comp["files"]:
            lic = entry.get("license", comp["license"])
            lines.append(f"- `vendor/{entry['path']}` (`{lic}`), from <{entry['url']}>, "
                         f"sha256 `{entry['sha256']}`")
        lines.append("")
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dest", default=DEFAULT_DEST, help="target directory (default: static/vendor)")
    parser.add_argument("--check", action="store_true", help="verify only, never download")
    parser.add_argument("--replace", action="store_true", help="re-download files whose checksum differs")
    parser.add_argument("--notice", action="store_true", help=f"regenerate {os.path.relpath(NOTICE, REPO_ROOT)}")
    args = parser.parse_args(argv)
    if args.notice:
        with open(NOTICE, "w", encoding="utf-8") as f:
            f.write(render_notice())
        print(f"wrote {NOTICE}")
        return 0
    try:
        ensure(args.dest, download=not args.check, replace_mismatched=args.replace)
    except VendorError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

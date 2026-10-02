"""Vendor-provisioning guards for BUG #1 (missing ``static/vendor/`` -> UI 404s).

These are pure static checks -- no server, no assets, no network -- so they run
everywhere and pin the two halves of the fix:

  1. *Manifest completeness*: every ``vendor/...`` file ``index.html`` references
     must have an entry in ``scripts/vendor-assets.json`` (the pinned manifest
     both ``annzarro-install.py`` and the wheel build install from). If the
     template grows a new bundle but the manifest is never taught about it, the
     asset 404s in every deploy and is missing from every wheel -- exactly the
     silent gap behind bug #1. (Catches drift the runtime smoke test only
     catches once a deploy is already broken.)

  2. *Supervisor self-provisioning*: ``run-supervised.sh`` must self-provision
     vendor assets on a fresh clone (the gitignored tree is empty there), guarded
     by a sentinel, so a pilot deploy can't silently come up bundle-less.
"""
import importlib.util
import json
import os
import re

import pytest

_THIS = os.path.abspath(__file__)
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(_THIS))))
INDEX_HTML = os.path.join(REPO_ROOT, "templates", "index.html")
MANIFEST = os.path.join(REPO_ROOT, "scripts", "vendor-assets.json")
LICENSES_DIR = os.path.join(REPO_ROOT, "annzarro", "THIRD_PARTY_LICENSES")
SUPERVISOR = os.path.join(REPO_ROOT, "run-supervised.sh")
VENDOR_DIR = os.path.join(REPO_ROOT, "static", "vendor")
# main.js sets up a bootstrap.Modal at boot; this bundle missing == "bootstrap is
# not defined" == "Initialization failed". It is the canonical sentinel.
VENDOR_SENTINEL = os.path.join(VENDOR_DIR, "js", "bootstrap.bundle.min.js")


def _referenced_vendor_files():
    html = open(INDEX_HTML).read()
    refs = set(re.findall(r"filename='vendor/([^']+)'", html))
    return refs


def _manifest():
    with open(MANIFEST) as f:
        return json.load(f)


def _manifest_paths():
    return {entry["path"] for comp in _manifest()["components"] for entry in comp["files"]}


def _vendor_tool():
    spec = importlib.util.spec_from_file_location(
        "_vendor_assets_under_test", os.path.join(REPO_ROOT, "scripts", "vendor_assets.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_every_referenced_vendor_file_is_in_install_manifest():
    """index.html must reference nothing the manifest doesn't provide (BUG #1)."""
    referenced = _referenced_vendor_files()
    assert referenced, "parsed no vendor references from index.html"
    missing = sorted(referenced - _manifest_paths())
    assert not missing, (
        "index.html references vendor assets that scripts/vendor-assets.json does "
        f"not pin -> they will 404 in every deploy and every wheel: {missing}"
    )


def test_manifest_ships_nothing_the_ui_does_not_load():
    """The reverse direction: every pinned file is referenced by index.html,
    or is a web font that a referenced stylesheet loads. Unused bundles cost
    every install megabytes (pdfmake + vfs_fonts alone were 2.1 MB) and add
    licenses to track for nothing."""
    referenced = _referenced_vendor_files()
    fonts = {p for p in _manifest_paths() if p.startswith("webfonts/")}
    css_text = ""
    for rel in referenced:
        if rel.endswith(".css"):
            css_text += open(os.path.join(REPO_ROOT, "static", "vendor", rel)).read() \
                if os.path.isfile(os.path.join(REPO_ROOT, "static", "vendor", rel)) else ""
    unused = sorted(_manifest_paths() - referenced - fonts)
    assert not unused, f"pinned but never loaded by index.html: {unused}"
    if css_text:  # provisioned: the fonts must actually be loaded by some CSS
        orphans = sorted(f for f in fonts if os.path.basename(f) not in css_text)
        assert not orphans, f"pinned web fonts no stylesheet loads: {orphans}"


def test_manifest_entries_are_pinned_and_licensed():
    """Every vendored file has a URL, a SHA-256 and an SPDX license, and every
    license text the manifest cites ships in THIRD_PARTY_LICENSES."""
    for comp in _manifest()["components"]:
        assert comp["license"] and comp["version"], comp["name"]
        for text in comp["license_files"]:
            assert os.path.isfile(os.path.join(LICENSES_DIR, text)), (comp["name"], text)
        for entry in comp["files"]:
            assert re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]), entry["path"]
            assert entry["url"].startswith("https://"), entry["path"]


def test_third_party_notice_is_generated_from_the_manifest():
    """THIRD_PARTY_LICENSES/README.md must not drift from the manifest."""
    with open(os.path.join(LICENSES_DIR, "README.md")) as f:
        committed = f.read()
    assert committed == _vendor_tool().render_notice(), (
        "run `python scripts/vendor_assets.py --notice` and commit the result"
    )


def test_provisioned_vendor_files_match_their_checksums():
    """A provisioned static/vendor/ must hold exactly the pinned bytes."""
    if not os.path.isdir(VENDOR_DIR):
        pytest.skip("static/vendor/ not provisioned in this environment")
    missing, mismatched = _vendor_tool().verify(VENDOR_DIR)
    assert not mismatched, f"vendored files differ from the pinned SHA-256: {mismatched}"
    assert not missing, f"vendored files missing (run scripts/vendor_assets.py): {missing}"


def test_supervisor_self_provisions_vendor():
    """run-supervised.sh must fetch vendor assets if absent (operational BUG #1 fix)."""
    if not os.path.isfile(SUPERVISOR):
        pytest.skip("run-supervised.sh not present in this checkout")
    sh = open(SUPERVISOR).read()
    assert "download_external_resources" in sh, (
        "run-supervised.sh does not drive annzarro-install.py's vendor download "
        "-- a fresh pilot clone would come up with an unprovisioned static/vendor/"
    )
    assert "VENDOR_SENTINEL" in sh or "bootstrap.bundle.min.js" in sh, (
        "run-supervised.sh has no vendor sentinel guard"
    )


def test_vendor_sentinel_present_when_dir_exists():
    """A populated static/vendor/ must include the critical bootstrap bundle.

    Skips when vendor isn't provisioned at all (e.g. a CI job that hasn't run the
    fetch step) so this doesn't false-fail; it exists to catch a *partial* vendor
    tree -- the failure mode where some bundles are present and the load-bearing
    one is not.
    """
    if not os.path.isdir(VENDOR_DIR):
        pytest.skip("static/vendor/ not provisioned in this environment")
    assert os.path.isfile(VENDOR_SENTINEL), (
        f"static/vendor/ exists but the critical bundle is missing: {VENDOR_SENTINEL}"
    )


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))

"""Vendor-provisioning guards for BUG #1 (missing ``static/vendor/`` -> UI 404s).

These are pure static checks -- no server, no assets, no network -- so they run
everywhere and pin the two halves of the fix:

  1. *Manifest completeness*: every ``vendor/...`` file ``index.html`` references
     must have a download entry in ``annzarro-install.py``. If the template grows
     a new bundle but the fetcher is never taught to fetch it, the asset 404s in
     every deploy -- exactly the silent gap behind bug #1. (Catches drift the
     runtime smoke test only catches once a deploy is already broken.)

  2. *Supervisor self-provisioning*: ``run-supervised.sh`` must self-provision
     vendor assets on a fresh clone (the gitignored tree is empty there), guarded
     by a sentinel, so a pilot deploy can't silently come up bundle-less.
"""
import os
import re

import pytest

_THIS = os.path.abspath(__file__)
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(_THIS))))
INDEX_HTML = os.path.join(REPO_ROOT, "templates", "index.html")
INSTALL_PY = os.path.join(REPO_ROOT, "annzarro-install.py")
SUPERVISOR = os.path.join(REPO_ROOT, "run-supervised.sh")
VENDOR_DIR = os.path.join(REPO_ROOT, "static", "vendor")
# main.js sets up a bootstrap.Modal at boot; this bundle missing == "bootstrap is
# not defined" == "Initialization failed". It is the canonical sentinel.
VENDOR_SENTINEL = os.path.join(VENDOR_DIR, "js", "bootstrap.bundle.min.js")


def _referenced_vendor_files():
    html = open(INDEX_HTML).read()
    refs = set(re.findall(r"filename='vendor/([^']+)'", html))
    return refs


def _manifest_basenames():
    src = open(INSTALL_PY).read()
    urls = re.findall(r'"url":\s*"([^"]+)"', src)
    return {os.path.basename(u) for u in urls}


def test_every_referenced_vendor_file_is_in_install_manifest():
    """index.html must reference nothing the fetcher doesn't provide (BUG #1)."""
    referenced = _referenced_vendor_files()
    assert referenced, "parsed no vendor references from index.html"
    manifest = _manifest_basenames()
    missing = sorted(
        rel for rel in referenced if os.path.basename(rel) not in manifest
    )
    assert not missing, (
        "index.html references vendor assets that annzarro-install.py never "
        f"downloads -> they will 404 in every deploy: {missing}"
    )


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

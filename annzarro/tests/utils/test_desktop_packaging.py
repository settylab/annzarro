"""
The desktop app ships the server frozen with PyInstaller
(annzarro/desktop/server/annzarro-server.spec), which takes its file lists
from annzarro.desktop.freeze. An earlier copy-the-repository approach left out
annzarro/config/*.yaml, without which the server refuses to start ("no
built-in production.yaml"), and the third-party licenses. These tests check
the lists without running PyInstaller; CI builds and smoke-tests the real
binary (.github/workflows/build.yml).
"""
import json
import os
import re
import subprocess
import sys

import pytest

from annzarro.desktop import freeze

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
ELECTRON = os.path.join(ROOT, "annzarro", "desktop", "electron")


@pytest.fixture(scope="module")
def bundled():
    """Destination path of every bundled data file, as the frozen app sees it."""
    return {os.path.join(dest, os.path.basename(src)).replace(os.sep, "/")
            for src, dest in freeze.datas()}


def test_built_in_config_defaults_are_bundled(bundled):
    for name in ("base.yaml", "production.yaml", "development.yaml", "schema.yaml"):
        assert f"annzarro/config/{name}" in bundled


def test_third_party_licenses_and_license_are_bundled(bundled):
    assert "annzarro/THIRD_PARTY_LICENSES/README.md" in bundled
    assert "./LICENSE" in bundled


def test_frontend_is_bundled_where_the_server_looks(bundled):
    assert "annzarro/templates/index.html" in bundled
    assert "annzarro/static/js/config.js" in bundled
    assert any(p.startswith("annzarro/static/vendor/") for p in bundled)


def test_no_tests_or_secrets_are_bundled(bundled):
    assert not any("/tests/" in p or "users.json" in p for p in bundled)


def test_hidden_imports_cover_the_server_but_not_tests_or_desktop():
    names = freeze.hiddenimports()
    for module in ("annzarro.cli", "annzarro.server.core",
                   "annzarro.server.routes.data_routes", "annzarro.core.h5ad_reader"):
        assert module in names
    assert not [n for n in names if n.startswith(freeze.EXCLUDED_SUBPACKAGES)]


def test_server_does_not_import_the_excluded_packages():
    """EXCLUDES drops numba, cryptography, most of scipy ... from the bundle;
    that only works while the server never imports them, also lazily while
    serving requests. (numpy.testing and numpy.f2py looked unused but scipy
    imports them through its array-API shim.)"""
    modules = [n for n in freeze.hiddenimports() if n != "annzarro.server.gunicorn_config"]
    data = os.path.join(ROOT, "annzarro", "tests", "data")
    # The bundle has no optional extras (dask, the [remote] stores); hide
    # them as the bundle would, or the readers' optional imports pull in
    # scipy.fft, linalg ... through dask.
    code = f"""
import importlib, json, os, sys, urllib.parse
for m in ("dask", "fsspec", "s3fs", "gcsfs", "aiohttp"):
    sys.modules[m] = None
for m in {modules!r}:
    importlib.import_module(m)
from annzarro.server.core import create_app
client = create_app({{"TESTING": True, "data_dir": {data!r}}}).test_client()
for store in ("fixture_small.zarr", "fixture_small_v3.zarr"):
    q = urllib.parse.quote(os.path.join({data!r}, store), safe="")
    for url in ("/api/v1/datasets", f"/api/v1/data/info?dataset_path={{q}}",
                f"/api/v1/data/genes?dataset_path={{q}}", f"/api/v1/data/cells?dataset_path={{q}}",
                f"/api/v1/data/X?dataset_path={{q}}&cols=0,1", f"/api/v1/data/X?dataset_path={{q}}&rows=0",
                f"/api/v1/data/obs?dataset_path={{q}}", f"/api/v1/data/var?dataset_path={{q}}",
                f"/api/v1/data/dataset_structure?dataset_path={{q}}"):
        r = client.get(url)
        assert r.status_code == 200, (url, r.status_code, r.get_data()[:300])
excluded = {freeze.EXCLUDES!r}
print(json.dumps(sorted({{m for m in sys.modules for e in excluded
                         if m == e or m.startswith(e + ".")}})))
"""
    out = subprocess.run([sys.executable, "-c", code], cwd=ROOT, capture_output=True,
                         text=True, timeout=300)
    assert out.returncode == 0, out.stderr[-3000:]
    assert json.loads(out.stdout.strip().splitlines()[-1]) == [], out.stdout


def test_app_version_follows_the_python_package():
    """The release workflow names assets after package.json's version and
    checks it against the tag; bump_version.py keeps both in step."""
    with open(os.path.join(ROOT, "pyproject.toml")) as f:
        py_version = re.search(r'^version\s*=\s*"([^"]+)"', f.read(), re.M).group(1)
    with open(os.path.join(ELECTRON, "package.json")) as f:
        assert json.load(f)["version"] == py_version


def test_electron_ships_the_frozen_server_and_starts_it_on_loopback():
    with open(os.path.join(ELECTRON, "package.json")) as f:
        build = json.load(f)["build"]
    assert {"from": "server/annzarro-server", "to": "server", "filter": ["**/*"]} \
        in build["extraResources"]
    with open(os.path.join(ELECTRON, "main.js")) as f:
        main = f.read()
    assert "const HOST = '127.0.0.1';" in main
    for arg in ("'--host', HOST", "'--auth-disabled'", "'--no-browser'"):
        assert arg in main


def test_windows_icon_has_a_256px_image():
    """electron-builder refuses a Windows icon without a 256x256 image; the
    committed one used to hold only 16x16."""
    with open(os.path.join(ELECTRON, "icons", "icon.ico"), "rb") as f:
        data = f.read()
    count = int.from_bytes(data[4:6], "little")
    widths = [data[6 + 16 * i] or 256 for i in range(count)]  # 0 means 256
    assert 256 in widths, widths


def test_electron_build_is_trimmed():
    """One locale, maximum compression, only the app's own files in app.asar
    (devDependencies such as playwright-core never are)."""
    with open(os.path.join(ELECTRON, "package.json")) as f:
        build = json.load(f)["build"]
    assert build["electronLanguages"] == ["en-US"]
    assert build["compression"] == "maximum"
    assert build["asar"] is True
    assert not [p for p in build["files"] if "node_modules" in p or p.startswith("test")]


def test_server_tags_responses_with_the_desktop_instance(monkeypatch, tmp_path):
    """The desktop app trusts only the server that carries its launch token:
    two launches that pick the same free port at once must not adopt each
    other's server."""
    from annzarro.server.core import create_app
    config = {"TESTING": True, "data_dir": str(tmp_path)}
    monkeypatch.setenv("ANNZARRO_INSTANCE_ID", "launch-123")
    tagged = create_app(config).test_client().get("/api/v1/datasets")
    assert tagged.headers.get("X-AnnZarro-Instance") == "launch-123"
    monkeypatch.delenv("ANNZARRO_INSTANCE_ID")
    plain = create_app(config).test_client().get("/api/v1/datasets")
    assert "X-AnnZarro-Instance" not in plain.headers

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
    # zarr 2 cannot read the v3 fixture (the bundle ships zarr 3).
    import zarr
    stores = ["fixture_small.zarr"]
    if int(zarr.__version__.split(".")[0]) >= 3:
        stores.append("fixture_small_v3.zarr")
    # The bundle has no optional extras (dask, the [remote] stores); hide
    # them as the bundle would, or the readers' optional imports pull in
    # scipy.fft, linalg ... through dask.
    code = f"""
import importlib, json, os, sys, urllib.parse
for m in ("dask", "fsspec", "s3fs", "gcsfs", "aiohttp"):
    sys.modules[m] = None
excluded = {freeze.EXCLUDES!r}
def loaded():
    return {{m for m in sys.modules for e in excluded if m == e or m.startswith(e + ".")}}
# What scipy itself imports with scipy.sparse depends on its version (scipy
# before 1.15, as on Python 3.9, loads csgraph and linalg eagerly). The bundle
# is built with a current scipy and the frozen-server smoke test runs it; here
# only what annzarro's own code adds counts.
import scipy.sparse
baseline = loaded()
for m in {modules!r}:
    importlib.import_module(m)
from annzarro.server.core import create_app
client = create_app({{"TESTING": True, "data_dir": {data!r}}}).test_client()
for store in {stores!r}:
    q = urllib.parse.quote(os.path.join({data!r}, store), safe="")
    for url in ("/api/v1/datasets", f"/api/v1/data/info?dataset_path={{q}}",
                f"/api/v1/data/genes?dataset_path={{q}}", f"/api/v1/data/cells?dataset_path={{q}}",
                f"/api/v1/data/X?dataset_path={{q}}&cols=0,1", f"/api/v1/data/X?dataset_path={{q}}&rows=0",
                f"/api/v1/data/obs?dataset_path={{q}}", f"/api/v1/data/var?dataset_path={{q}}",
                f"/api/v1/data/dataset_structure?dataset_path={{q}}"):
        r = client.get(url)
        assert r.status_code == 200, (url, r.status_code, r.get_data()[:300])
print(json.dumps(sorted(loaded() - baseline)))
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


# --- Licences -------------------------------------------------------------

def _notices():
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "annzarro_desktop_notices", os.path.join(ROOT, "annzarro", "desktop", "scripts", "notices.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_readline_is_excluded_from_the_frozen_server():
    """The Linux v0.4.0 bundle shipped GNU Readline (GPL-3.0), pulled in by
    PyInstaller through Python's readline module (only `flask shell` imports
    it). Excluding the modules keeps libreadline and libtinfo out."""
    assert {"readline", "rlcompleter"} <= set(freeze.EXCLUDES)


def test_gpl_and_unknown_native_libraries_stop_the_build(tmp_path):
    notices = _notices()
    for name in ("libreadline.so.8", "libtinfo.so.6", "libncursesw.so.6", "libhistory.so.8",
                 "readline.cpython-311-x86_64-linux-gnu.so"):
        assert notices.forbidden(name), name
    for name in ("libssl.so.3", "libcrypto-3.dll", "libffi.so.8", "libz.1.3.2.dylib",
                 "libbz2.so.1.0", "liblzma.so.5", "libuuid.so.1", "libstdc++.so.6",
                 "libgcc_s.so.1", "libpython3.11.so.1.0", "python311.dll", "VCRUNTIME140.dll",
                 "api-ms-win-crt-time-l1-1-0.dll", "libscipy_openblas64_-32a4b2a6.so",
                 "libaec-a27cf049.so.0.1.4", "libcrc32c-7ebc40c5.so.1.1.0"):
        assert not notices.forbidden(name), name
        entry = notices.native_entry(name)
        assert entry, name
        for f in entry[3]:
            assert (notices.NOTICES_SRC / f).is_file(), f

    # A frozen build that collected readline, or a library nobody knows.
    site = tmp_path / "site"
    site.mkdir()
    build = tmp_path / "build"
    build.mkdir()
    (build / "PYZ-00.toc").write_text("('x.pyz', [])")
    for lib, message in (("libreadline.so.8", "must not be bundled"),
                         ("libmystery.so.1", "no licence notice known")):
        (build / "COLLECT-00.toc").write_text(repr(("dist", [(lib, f"/usr/lib/{lib}", "BINARY")])))
        with pytest.raises(SystemExit, match=message):
            notices.write_notices(tmp_path / "server", build, site, tmp_path / "python")


def test_notices_collect_cpython_packages_and_native_libraries(tmp_path):
    notices = _notices()
    site = tmp_path / "site"
    info = site / "demo-1.2.dist-info"
    (info / "licenses").mkdir(parents=True)
    (info / "METADATA").write_text("Name: demo\nVersion: 1.2\nLicense-Expression: BSD-3-Clause\n")
    (info / "licenses" / "LICENSE.txt").write_text("demo licence\n")
    (site / "demo").mkdir()
    (site / "demo" / "__init__.py").write_text("")
    (site / "demo" / "_ext.so").write_text("")
    (info / "RECORD").write_text("demo/__init__.py,,\ndemo/_ext.so,,\n")
    prefix = tmp_path / "python"
    (prefix / "lib" / "python3.11" / "lib-dynload").mkdir(parents=True)
    (prefix / "lib" / "python3.11" / "LICENSE.txt").write_text("PSF licence\n")
    build = tmp_path / "build"
    build.mkdir()
    (build / "COLLECT-00.toc").write_text(repr(("dist", [
        # Windows TOCs name files with backslashes; the inventory uses '/'.
        ("demo\\_ext.so", str(site / "demo" / "_ext.so"), "EXTENSION"),
        ("libssl.so.3", "/usr/lib/libssl.so.3", "BINARY"),
        ("lib-dynload/_ssl.so", str(prefix / "lib" / "python3.11" / "lib-dynload" / "_ssl.so"),
         "EXTENSION"),
    ])))
    (build / "PYZ-00.toc").write_text(repr(("x.pyz", [
        ("demo", str(site / "demo" / "__init__.py"), "PYMODULE"),
    ])))
    out = tmp_path / "server"
    inventory = notices.write_notices(out, build, site, prefix, exe_name="annzarro-server")
    notes = out / notices.OUT_NAME
    assert (notes / "python" / "LICENSE.txt").read_text() == "PSF licence\n"
    assert (notes / "python-packages" / "demo-1.2" / "LICENSE.txt").read_text() == "demo licence\n"
    assert (notes / "native" / "openssl-LICENSE.txt").is_file()
    index = (notes / "README.txt").read_text()
    assert "demo 1.2" in index and "BSD-3-Clause" in index and "OpenSSL" in index
    by = {e["component"]: e for e in inventory}
    assert by["demo 1.2"]["files"] == ["_internal/demo/_ext.so", "annzarro-server:demo"]
    assert by["OpenSSL"]["files"] == ["_internal/libssl.so.3"]
    assert "_internal/lib-dynload/_ssl.so" in inventory[0]["files"]  # CPython
    assert json.loads((notes / "inventory.json").read_text()) == inventory


def test_build_writes_the_notices_and_mac_app_ships_electron_licences():
    with open(os.path.join(ROOT, "annzarro", "desktop", "scripts", "build_server.py")) as f:
        assert "notices.write_notices(" in f.read()
    with open(os.path.join(ELECTRON, "package.json")) as f:
        mac = json.load(f)["build"]["mac"]
    shipped = {r["to"] for r in mac["extraResources"]}
    assert {"LICENSE.electron.txt", "LICENSES.chromium.html", "LICENSES.macos-frameworks.txt"} <= shipped
    for r in mac["extraResources"]:
        assert os.path.exists(os.path.join(ELECTRON, r["from"])) or \
            r["from"].startswith("node_modules/electron/dist/"), r["from"]


def test_plotly_bundled_licences_are_complete():
    """plotly.min.js bundles BSD-3, ISC, BSD-2, Zlib and Unlicense modules,
    not only MIT ones (v0.4.0 said 'all MIT except ieee754')."""
    lic_dir = os.path.join(ROOT, "annzarro", "THIRD_PARTY_LICENSES")
    with open(os.path.join(lic_dir, "plotly-bundled.txt"), encoding="utf-8") as f:
        text = f.read()
    for package in ("mapbox-gl 1.10.1", "@plotly/d3 ", "d3-geo ", "pbf ", "@mapbox/vector-tile ",
                    "earcut ", "topojson-client ", "geojson-vt ", "supercluster ",
                    "@mapbox/tiny-sdf ", "@mapbox/unitbezier ", "gl-mat4 ", "mumath ", "ieee754 "):
        assert f"\n{package}" in text, package
    assert "Copyright (c) 2020, Mapbox" in text
    with open(os.path.join(ROOT, "scripts", "vendor-assets.json")) as f:
        plotly = [c for c in json.load(f)["components"] if c["name"] == "Plotly.js"][0]
    assert "all MIT except" not in plotly["notes"]
    for spdx in ("ISC", "BSD-3-Clause", "BSD-2-Clause", "Zlib", "Unlicense"):
        assert spdx in plotly["license"]


def _licence_check():
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "annzarro_licence_check",
        os.path.join(ROOT, "annzarro", "desktop", "scripts", "licence_check.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_licence_policy():
    lc = _licence_check()
    assert lc.classify("BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0") == "ok"
    assert lc.classify("PSF-2.0") == "ok"
    assert lc.classify("GPL-3.0-or-later WITH GCC-exception-3.1") == "exception"
    assert lc.classify("LGPL-2.1-or-later") == "lgpl"
    assert lc.classify("GPL-3.0-only") == "gpl"
    assert lc.classify("GNU General Public License v3 (GPLv3)") == "gpl"
    assert lc.classify("AGPL-3.0") == "gpl"
    assert lc.classify("") == "unknown"


def _fake_linux_app(tmp_path, extra_server_files=(), inventory=None):
    app = tmp_path / "AnnZarro"
    server = app / "resources" / "server"
    (server / "_internal").mkdir(parents=True)
    (server / "THIRD_PARTY_NOTICES").mkdir()
    (server / "THIRD_PARTY_NOTICES" / "README.txt").write_text("x")
    for name in ("LICENSE.electron.txt", "LICENSES.chromium.html"):
        (app / name).write_text("x")
    (app / "resources" / "LICENSE").write_text("x")
    elf = b"\x7fELF" + b"\0" * 64
    (app / "annzarro-desktop").write_bytes(elf)
    (app / "libffmpeg.so").write_bytes(elf)
    (server / "annzarro-server").write_bytes(elf)
    (server / "_internal" / "libz.so.1").write_bytes(elf)
    for name, data in extra_server_files:
        (server / "_internal" / name).write_bytes(data)
    inventory = inventory or [
        {"component": "zlib", "licence": "Zlib", "shipped": "separate shared library",
         "files": ["_internal/libz.so.1"]}]
    (server / "THIRD_PARTY_NOTICES" / "inventory.json").write_text(json.dumps(inventory))
    return app


def test_licence_check_passes_a_clean_app_and_catches_problems(tmp_path):
    lc = _licence_check()
    plat, rows, failures = lc.check(_fake_linux_app(tmp_path / "ok"))
    assert plat == "linux" and failures == []
    assert any(r[0].startswith("FFmpeg") and r[3] == "lgpl" for r in rows)

    elf = b"\x7fELF" + b"\0" * 64
    # A library nobody listed, one linking GNU Readline, and a GPL component.
    _, _, failures = lc.check(_fake_linux_app(
        tmp_path / "bad",
        extra_server_files=[("libmystery.so", elf),
                            ("readline.cpython-311-x86_64-linux-gnu.so",
                             elf + b"libreadline.so.8\0")],
        inventory=[{"component": "zlib", "licence": "Zlib", "shipped": "separate shared library",
                    "files": ["_internal/libz.so.1",
                              "_internal/readline.cpython-311-x86_64-linux-gnu.so"]},
                   {"component": "evil", "licence": "GPL-3.0-only", "shipped": "x", "files": []}]))
    text = "\n".join(failures)
    assert "libmystery.so (ELF) is not in the inventory" in text
    assert "refers to libreadline.so" in text
    assert "evil: licence 'GPL-3.0-only' is gpl" in text

    # A missing Chromium notice fails too.
    app = _fake_linux_app(tmp_path / "nonotice")
    (app / "LICENSES.chromium.html").unlink()
    _, _, failures = lc.check(app)
    assert any("LICENSES.chromium.html" in f for f in failures)


def test_static_lgpl_is_accepted_only_in_the_electron_executable(tmp_path, monkeypatch):
    """Operator decision 2026-10-07: Chromium's statically linked LGPL
    WebKit/Blink code is accepted in the Electron executable, nowhere else."""
    lc = _licence_check()
    _, rows, failures = lc.check(_fake_linux_app(tmp_path / "ok"))
    assert failures == []
    row = [r for r in rows if r[0] == "Electron / Chromium (app executable)"][0]
    assert row[3] == lc.LGPL_STATIC_VERDICT

    # The same licence on any other binary fails.
    app = _fake_linux_app(tmp_path / "other")
    (app / "chrome_crashpad_handler").write_bytes(b"\x7fELF" + b"\0" * 64)
    table = [("chrome_crashpad_handler", "Crashpad", lc.CHROMIUM, "separate executable")] + \
        [e for e in lc.ELECTRON if e[0] != "chrome_crashpad_handler"]
    monkeypatch.setattr(lc, "ELECTRON", table)
    _, _, failures = lc.check(app)
    assert any("Crashpad" in f and "not a separate shared library" in f for f in failures)

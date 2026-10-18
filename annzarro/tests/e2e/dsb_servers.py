"""Servers and a browser session for the dataset bar and dataset browser tests.

Not a test module: ``test_dataset_bar.py``, ``test_dataset_browser.py`` and
``browser/test_dataset_browser_a11y.py`` import its fixtures (``server``, ``single_server``,
``big_server``, ``hosted_server``) and ``Session``. Each starts a real ``annzarro start`` on a free
127.0.0.1 port, with the data directories below, and is shared by the tests of a module.

Needs Playwright with Chromium; the fixtures skip without it, or fail when ANNZARRO_REQUIRE_BROWSER=1.
"""
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

import pytest

REQUIRE = os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1"


def skip_or_fail(reason):
    if REQUIRE:
        pytest.fail(f"{reason} (ANNZARRO_REQUIRE_BROWSER=1)")
    pytest.skip(reason)


try:
    from playwright import sync_api
except ImportError:  # pragma: no cover - depends on the environment
    sync_api = None

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(os.path.dirname(HERE), "data", "fixture_small.zarr")
SHOTS = os.environ.get("DATASET_SHOTS")

LONG = "tahoe_panel_95.6M_plot_" + "liver-met_v3_sharded_csc_float32_" * 2 + "final.zarr"
# a name over 120 characters with no break point at all, and long ones with and without breaks
NAMES = ["short.zarr", "a_rather_long_dataset_name_" + "x" * 60 + "_final_v12.zarr",
         "BR_2453_v3layout_PILOT_not_for_annotation.zarr",
         "tahoe_panel_95.6M_plot_" + "liver-met_v3_sharded_csc_float32_" * 3 + "final.zarr",
         "x" * 130 + ".zarr"]
SUBSTORE = "projects/liver/2026-10_batch3/HSPC_Young_1_sharded_csc_float32.zarr"
SUBSTORE_LONG = ("projects/liver/2026-10_batch3/bm_aging_liver_hepatocyte_atlas_batch3_reprocessed_with_harmony_"
                 "integration_and_doublet_removal_final_v7_approved_for_sharing.zarr")
#: Stores of the browser tests' data directory beside NAMES: two stores of one name in different folders, an unreadable one
BROWSER_STORES = ("other_small.zarr", LONG, "projects/liver/deep_store.zarr", "projects/lung/lung_v2.zarr",
                  "projects/liver/short.zarr")


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start(tmp, data, *, extra=()):
    """``annzarro start`` on a free port with login off; returns (base URL, process)."""
    port = free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(tmp / "home"), ANNZARRO_HEADLESS="1")
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", str(data), "--no-browser", "--auth-disabled", *extra],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env, cwd=tmp)
    base = f"http://127.0.0.1:{port}"
    for _ in range(300):
        try:
            urllib.request.urlopen(base + "/api/v1/config", timeout=1)
            return base, proc
        except OSError:
            time.sleep(0.1)
    proc.kill()
    pytest.fail("server did not start")


def _copies(data, names):
    for rel in names:
        (data / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(FIXTURE, data / rel)


def _require():
    if sync_api is None:
        skip_or_fail("Playwright is not installed")
    if not os.path.isdir(os.path.join(os.path.dirname(os.path.dirname(HERE)), "..", "static", "vendor")):
        skip_or_fail("static/vendor is not provisioned")


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    """Several stores: the long names, two folders of stores, one of the same name twice, an unreadable one, one outside."""
    _require()
    tmp = tmp_path_factory.mktemp("dsb")
    data = tmp / "data"
    data.mkdir()
    _copies(data, NAMES + list(BROWSER_STORES) + [SUBSTORE, SUBSTORE_LONG])
    (data / "broken.zarr").mkdir()
    shutil.copytree(FIXTURE, tmp / "outside_store.zarr")
    base, proc = start(tmp, data)
    yield base, str(data)
    proc.terminate()
    proc.wait(20)


@pytest.fixture(scope="module")
def single_server(tmp_path_factory):
    """One store only: the first load opens it."""
    _require()
    tmp = tmp_path_factory.mktemp("dsb_single")
    data = tmp / "data"
    data.mkdir()
    _copies(data, ["only_one.zarr"])
    base, proc = start(tmp, data)
    yield base, str(data)
    proc.terminate()
    proc.wait(20)


@pytest.fixture(scope="module")
def empty_server(tmp_path_factory):
    _require()
    tmp = tmp_path_factory.mktemp("dsb_empty")
    data = tmp / "data"
    data.mkdir()
    base, proc = start(tmp, data)
    yield base, str(data)
    proc.terminate()
    proc.wait(20)


@pytest.fixture(scope="module")
def big_server(tmp_path_factory):
    """2,000 stores in one folder (symlinks to the fixture), more than a listing page (500)."""
    _require()
    tmp = tmp_path_factory.mktemp("dsb_big")
    data = tmp / "data"
    data.mkdir()
    for i in range(2000):
        os.symlink(FIXTURE, data / f"store_{i:04d}.zarr")
    base, proc = start(tmp, data)
    yield base, str(data)
    proc.terminate()
    proc.wait(20)


@pytest.fixture(scope="module")
def hosted_server(tmp_path_factory):
    """A server with login on (remote stores allowed): alice, an ordinary user, and root, an admin."""
    _require()
    tmp = tmp_path_factory.mktemp("dsb_hosted")
    data = tmp / "data"
    _copies(data, ["short.zarr", "other_small.zarr", "projects/liver/deep_store.zarr"])
    shutil.copytree(FIXTURE, tmp / "outside_store.zarr")
    port = free_port()
    (tmp / "site.yaml").write_text(f'server:\n  host: 127.0.0.1\n  port: {port}\n  data_dir: "{data}"\n'
                                   f'auth:\n  enabled: true\n  user_file: "{tmp / "users.json"}"\n')
    env = dict(os.environ, ANNZARRO_CONFIG=str(tmp / "site.yaml"), ANNZARRO_HOME=str(tmp / "home"),
               ANNZARRO_REMOTE_STORES="allow")
    for args in (["add", "--username", "alice", "--password", "alice-pw"],
                 ["add", "--username", "root", "--password", "root-pw", "--admin"]):
        subprocess.run([sys.executable, "-m", "annzarro.cli", "user", *args], env=env, check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1", "--port", str(port),
                             "--data-dir", str(data), "--no-browser"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env, cwd=tmp)
    base = f"http://127.0.0.1:{port}"
    for _ in range(300):
        try:
            urllib.request.urlopen(base + "/login", timeout=1)
            break
        except OSError:
            time.sleep(0.1)
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield base, str(data), str(tmp / "outside_store.zarr")
    proc.terminate()
    proc.wait(20)


class Session:
    """A headless page (Chromium, or ``engine="webkit"``, Safari's engine) on a server, started and (when ``login`` is given) signed in; ``page`` is ready when the page has started."""

    def __init__(self, base, width=1280, height=900, login=None, scheme=None, init_script=None, engine="chromium", **context_args):
        self.pw = sync_api.sync_playwright().start()
        try:
            self.browser = getattr(self.pw, engine).launch()
        except Exception as exc:  # no browser binary
            self.pw.stop()
            skip_or_fail(f"{engine} cannot start: {exc}")
        try:
            kwargs = dict(viewport={"width": width, "height": height}, **context_args)
            if scheme:
                kwargs["color_scheme"] = scheme
            self.context = self.browser.new_context(**kwargs)
            if init_script:
                self.context.add_init_script(init_script)
            self.page = self.context.new_page()
            self.errors = []
            self.page.on("pageerror", lambda e: self.errors.append(str(e)))
            self.page.goto(base + "/")
            if login:
                self.page.fill("#username", login[0])
                self.page.fill("#password", login[1])
                self.page.click("button[type=submit]")
            self.page.wait_for_function("() => window.annzarro && window.annzarro.getDataset", timeout=60_000)
            self.page.evaluate("() => window.annzarro.ready")      # the page has finished starting
            self.page.wait_for_timeout(300)
        except BaseException:
            self.close()
            raise

    def close(self):
        self.browser.close()
        self.pw.stop()


@pytest.fixture
def session(server):
    s = Session(server[0])
    yield s
    s.close()

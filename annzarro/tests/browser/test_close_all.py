"""The header's "Close all panels", and starting over as a first visit.

The browser now keeps the layout (autosave, closed panels), so the header
has one button to clear the screen. Its dialog closes every open panel;
they stay under "Duplicate or Reopen Panel", as with a panel's x. A checkbox
also clears everything this site stored in this browser (local and session
storage, IndexedDB, Cache Storage, service workers) and reloads the bare URL,
so the app starts as on a first visit. Cookies are not touched: the login
is a server-side session behind an HttpOnly cookie, and nothing of it is in
storage, so the user stays logged in.

1. Close all: no tile open, both panels listed closed.
2. With the checkbox: storage emptied (the autosave too, which used to be
   written back on the way out), the page reloaded without ?dataset_path or
   #view, nothing restored, the welcome screen shown.
3. With login on: still logged in after starting over.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import base64
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
FIXTURE = os.path.join(os.path.dirname(HERE), "data", "fixture_small.zarr")


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _start(tmp, extra_args=(), env_extra=None, ready="/api/v1/config"):
    home = tmp / "home"
    home.mkdir()
    data_dir = tmp / "data"
    data_dir.mkdir()
    shutil.copytree(FIXTURE, data_dir / "fixture_small.zarr")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""), **(env_extra or {}))
    env.pop("ANNZARRO_CONFIG", None)
    # this checkout's package, not whatever "annzarro" is installed
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", str(data_dir), "--no-browser", *extra_args],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for _ in range(120):
        try:
            urllib.request.urlopen(root + ready, timeout=1)
            break
        except OSError:
            time.sleep(0.25)
    else:
        proc.kill()
        pytest.fail("server did not start")
    return proc, root, str(data_dir / "fixture_small.zarr"), env


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    proc, root, store, _ = _start(tmp_path_factory.mktemp("open"), ["--auth-disabled"])
    yield root, store
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def login_server(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("login")
    cfg = tmp / "site.yaml"
    cfg.write_text(f"auth:\n  enabled: true\n  user_file: \"{tmp / 'users.json'}\"\n")
    env = dict(os.environ, PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    env.pop("ANNZARRO_CONFIG", None)
    env["ANNZARRO_HOME"] = str(tmp / "cli-home")
    subprocess.run([sys.executable, "-m", "annzarro.cli", "user", "--config", str(cfg), "add",
                    "--username", "alice", "--password", "pw-one"],
                   env=env, cwd=REPO, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    proc, root, store, _ = _start(tmp, ["--config", str(cfg)], ready="/login")
    yield root, store
    proc.terminate()
    proc.wait(10)


def _link(root, store):
    umap = lambda c: {"type": "obsm", "key": "X_umap", "column": str(c)}
    configs = {"cell-plot-A": {"id": "cell-plot-A", "x": umap(0), "y": umap(1), "color": {"type": "none"}},
               "cell-table-B": {"id": "cell-table-B"}}
    hierarchy = [{"type": "split", "direction": "horizontal",
                  "panes": [{"percentage": 50}, {"percentage": 50}],
                  "children": [{"type": "tile", "id": "cell-plot-A"}, {"type": "tile", "id": "cell-table-B"}]}]
    view = {"v": 1, "layout": {"v": 1, "hierarchy": hierarchy, "panelConfigs": configs}}
    payload = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={payload}"


OPEN = "() => [...document.querySelectorAll('.tile-container .tile[data-tile-id]')].map(t => t.dataset.tileId)"
CLOSED = "() => [...document.querySelectorAll('.source-panel-option.closed-panel')].map(e => e.dataset.id)"
WELCOME = """() => { const h = document.querySelector('.tile-container > .tile-selector .tile-selection-header h2');
    return !!h && h.offsetParent !== null && h.textContent.trim(); }"""


def _open_view(page, root, store):
    page.goto(_link(root, store))
    page.wait_for_selector(".tile[data-tile-id='cell-plot-A'] .js-plotly-plot", timeout=30000)
    page.wait_for_selector(".tile[data-tile-id='cell-table-B'] table", timeout=30000)
    page.wait_for_timeout(500)


def _dialog(page, clear):
    page.click("#btn-close-all")
    page.wait_for_selector("#close-all-modal", state="visible")
    if clear:
        page.check("#close-all-clear")


def test_close_all_lists_every_panel_closed(server, browser):
    root, store = server
    ctx = browser.new_context(viewport={"width": 1400, "height": 1000})
    try:
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        _open_view(page, root, store)
        _dialog(page, clear=False)
        text = page.inner_text("#close-all-modal .modal-content")
        assert "Close all panels?" in text
        assert "panel sets saved on the server, and your login" in text
        # Cancel leaves everything as it was
        page.click("#close-all-modal .modal-footer .btn-secondary")
        page.wait_for_selector("#close-all-modal", state="hidden")
        assert sorted(page.evaluate(OPEN)) == ["cell-plot-A", "cell-table-B"]

        _dialog(page, clear=False)
        page.click("#btn-confirm-close-all")
        page.wait_for_selector("#close-all-modal", state="hidden")
        page.wait_for_timeout(500)
        assert page.evaluate(OPEN) == []
        assert sorted(page.evaluate(CLOSED)) == ["cell-plot-A", "cell-table-B"]
        assert not errors, errors
    finally:
        ctx.close()


def _fill_storage(page):
    """The autosave as the app writes it, plus one item of every other kind."""
    page.wait_for_function("() => !!localStorage.getItem('annzarro_autosave')", timeout=30000)
    page.evaluate("""async () => {
        localStorage.setItem('close-all-test', '1');
        sessionStorage.setItem('close-all-test', '1');
        await new Promise(r => { const q = indexedDB.open('close-all-test'); q.onsuccess = () => { q.result.close(); r(); }; });
        await (await caches.open('close-all-test')).put('/close-all-test', new Response('x'));
    }""")


STORAGE = """async () => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
    idb: (await indexedDB.databases()).map(d => d.name),
    caches: await caches.keys()
})"""


def _start_over(page):
    _dialog(page, clear=True)
    with page.expect_navigation(timeout=30000):
        page.click("#btn-confirm-close-all")
    page.wait_for_load_state("load")


def test_clear_and_reload_starts_as_a_first_visit(server, browser):
    root, store = server
    ctx = browser.new_context(viewport={"width": 1400, "height": 1000})
    try:
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        _open_view(page, root, store)
        _fill_storage(page)
        _start_over(page)
        parts = urllib.parse.urlsplit(page.url)
        assert (parts.query, parts.fragment) == ("", "")
        page.wait_for_function(WELCOME, timeout=30000)
        page.wait_for_timeout(1500)        # time for an autosave restore, if one were left
        assert page.evaluate(WELCOME) == "Welcome to AnnZarro"
        assert page.evaluate(OPEN) == [] and page.evaluate(CLOSED) == []
        left = page.evaluate(STORAGE)
        assert "annzarro_autosave" not in left["local"] and "close-all-test" not in left["local"]
        assert "close-all-test" not in left["session"]
        assert "close-all-test" not in left["idb"]
        assert left["caches"] == []
        assert not errors, errors
    finally:
        ctx.close()


def test_starting_over_keeps_the_login(login_server, browser):
    root, store = login_server
    ctx = browser.new_context(viewport={"width": 1400, "height": 1000})
    try:
        page = ctx.new_page()
        page.goto(_link(root, store))
        page.wait_for_selector("#username")
        page.fill("#username", "alice")
        page.fill("#password", "pw-one")
        with page.expect_navigation(url=lambda u: urllib.parse.urlsplit(u).path != "/login", timeout=30000):
            page.click("button[type=submit]")
        page.wait_for_selector(".tile[data-tile-id='cell-plot-A'] .js-plotly-plot", timeout=30000)
        cookies_before = {c["name"] for c in ctx.cookies()}
        _start_over(page)
        assert urllib.parse.urlsplit(page.url).path != "/login"
        page.wait_for_function(WELCOME, timeout=30000)
        assert page.evaluate("() => fetch('api/v1/auth/me').then(r => r.status)") == 200
        assert {c["name"] for c in ctx.cookies()} == cookies_before
    finally:
        ctx.close()


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()

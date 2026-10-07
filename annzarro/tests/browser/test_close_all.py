"""Close all panels: the header button, its confirmation, and its tick box.

Since the browser autosaves the layout, there has to be a clear way to start
over. "Close all" in the header asks "Close all panels?" (Cancel, Close all):

1. Close all closes every open panel and lists each under Duplicate or Reopen
   Panel, as the panel's X does; Cancel changes nothing;
2. with the tick box "Also clear everything this site stored in this
   browser", it clears localStorage, sessionStorage, IndexedDB and Cache
   Storage, and reloads to the bare URL: no panel is restored from the
   autosave and the app shows the welcome screen, as on a first visit;
3. in login mode the same clear leaves the user logged in (cookies are not
   touched, and no auth state lives in web storage): the reload is not sent
   to /login and the API still answers.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import base64
import json
import os
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
DATA_DIR = os.path.join(os.path.dirname(HERE), "data")
STORE = os.path.join(DATA_DIR, "fixture_small.zarr")
SHOTS = os.environ.get("ANNZARRO_SHOTS")   # a directory: also write screenshots there

OPEN_TILES = "() => [...document.querySelectorAll('.tile-container .tile[data-tile-id]')].map(t => t.dataset.tileId)"
CLOSED_LISTED = """() => [...new Set([...document.querySelectorAll(
    '.tile-container > .tile-selector .source-panel-option.closed-panel, .panel-closed-btn')]
    .filter(e => e.offsetParent !== null).map(e => e.dataset.id))]"""
PROBE = """async () => {
  localStorage.setItem('probe-local', '1');
  sessionStorage.setItem('probe-session', '1');
  await new Promise((res, rej) => { const r = indexedDB.open('probe-db', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('s'); r.onsuccess = () => { r.result.close(); res(); };
    r.onerror = () => rej(r.error); });
  await caches.open('probe-cache');
  // the autosave writes the layout; force one now
  window.dispatchEvent(new Event('beforeunload'));
}"""
STORED = """async () => ({
  local: Object.keys(localStorage), session: Object.keys(sessionStorage),
  idb: (await indexedDB.databases()).map(d => d.name), caches: await caches.keys(),
  sw: (await navigator.serviceWorker.getRegistrations()).length })"""


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _start(tmp_path, extra, ready):
    home = tmp_path / "home"
    home.mkdir()
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    env.pop("ANNZARRO_CONFIG", None)
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", *extra[0], "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", DATA_DIR, "--no-browser", *extra[1]],
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
    return root, proc


@pytest.fixture
def server(tmp_path):
    root, proc = _start(tmp_path, ([], ["--auth-disabled"]), "/api/v1/config")
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture
def login_server(tmp_path):
    cfg = tmp_path / "site.yaml"
    cfg.write_text("auth:\n  enabled: true\n"
                   f"  user_file: \"{tmp_path / 'users.json'}\"\n")
    (tmp_path / "home").mkdir()
    env = dict(os.environ, ANNZARRO_HOME=str(tmp_path / "home"), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    env.pop("ANNZARRO_CONFIG", None)
    subprocess.run([sys.executable, "-m", "annzarro.cli", "user", "--config", str(cfg), "add",
                    "--username", "alice", "--password", "pw-one"],
                   env=env, cwd=REPO, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    port = _free_port()
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--config", str(cfg),
                             "--host", "127.0.0.1", "--port", str(port), "--data-dir", DATA_DIR,
                             "--no-browser"],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for _ in range(120):
        try:
            urllib.request.urlopen(root + "/login", timeout=1)
            break
        except OSError:
            time.sleep(0.25)
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield root
    proc.terminate()
    proc.wait(10)


def _link(root):
    def plot(i, y):
        return {"id": i, "x": {"type": "obsm", "key": "X_umap", "column": "0"},
                "y": {"type": "obsm", "key": "X_umap", "column": y}, "z": None,
                "color": {"type": "obs", "key": "cell_type", "column": ""}}
    ids = ["cell-plot-A", "cell-plot-B"]
    view = {"v": 1, "layout": {
        "v": 1, "hierarchy": [{"type": "tile", "id": i, "controlsVisible": True} for i in ids],
        "controlState": {i: True for i in ids},
        "panelConfigs": {"cell-plot-A": plot("cell-plot-A", "1"), "cell-plot-B": plot("cell-plot-B", "0")}}}
    payload = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={payload}", ids


def _open(page, root):
    url, ids = _link(root)
    page.goto(url)
    for i in ids:
        page.wait_for_selector(f".tile[data-tile-id='{i}'] .js-plotly-plot", timeout=60000)
    page.wait_for_timeout(800)
    return ids


def _shot(page, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        page.screenshot(path=os.path.join(SHOTS, name + ".png"))


def _ask(page):
    page.click("#btn-close-all")
    page.wait_for_selector(".notification-ask", timeout=5000)
    return page.locator(".notification-ask")


def _landed_first_visit(page):
    page.wait_for_function("() => !location.search && !location.hash && document.readyState === 'complete'",
                           timeout=30000)
    page.wait_for_timeout(1500)
    assert page.evaluate(OPEN_TILES) == []
    # the welcome screen: panel choices, none of the earlier panels
    assert page.locator(".tile-selector").first.is_visible()


def test_close_all_closes_every_panel_and_lists_them(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_context(viewport={"width": 1400, "height": 900}).new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            ids = _open(page, server)
            assert sorted(page.evaluate(OPEN_TILES)) == sorted(ids)

            # Cancel changes nothing
            ask = _ask(page)
            assert "Close all panels?" in ask.inner_text()
            assert "saved on the server" in ask.inner_text() and "login" in ask.inner_text()
            page.wait_for_timeout(700)   # the notice fades in
            _shot(page, "1-dialog")
            ask.get_by_role("button", name="Cancel").click()
            page.wait_for_selector(".notification-ask", state="detached")
            assert sorted(page.evaluate(OPEN_TILES)) == sorted(ids)

            # Close all
            ask = _ask(page)
            assert not ask.locator("input[type=checkbox]").is_checked()
            ask.get_by_role("button", name="Close all", exact=True).click()
            page.wait_for_function("() => document.querySelectorAll('.tile-container .tile[data-tile-id]').length === 0")
            page.wait_for_timeout(500)
            _shot(page, "2-closed")
            assert page.evaluate(OPEN_TILES) == []
            assert sorted(page.evaluate(CLOSED_LISTED)) == sorted(ids)
            # no reload, storage kept (the plain path keeps the autosave)
            assert page.evaluate("() => !!window.PanelManager.getAllPanels().length")
            assert not errors, errors
        finally:
            browser.close()


def test_clear_checkbox_empties_storage_and_starts_as_a_first_visit(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_context(viewport={"width": 1400, "height": 900}).new_page()
            ids = _open(page, server)
            page.evaluate(PROBE)
            before = page.evaluate(STORED)
            assert "probe-local" in before["local"] and "annzarro_autosave" in before["local"]
            assert "probe-db" in before["idb"] and "probe-cache" in before["caches"]

            ask = _ask(page)
            ask.locator("input[type=checkbox]").check()
            page.wait_for_timeout(700)
            _shot(page, "3-dialog-checked")
            with page.expect_navigation(timeout=30000):
                ask.get_by_role("button", name="Close all", exact=True).click()
            _landed_first_visit(page)
            _shot(page, "4-first-visit")

            after = page.evaluate(STORED)
            assert after["local"] == [], after
            assert after["session"] == [] and after["idb"] == [] and after["caches"] == [], after
            assert "annzarro_autosave" not in after["local"]
            # memory-guard writes on pagehide too: the page leaves nothing behind
            assert page.evaluate("() => [Object.keys(localStorage), Object.keys(sessionStorage)]") == [[], []]
            # a plain reload restores nothing either
            page.reload()
            _landed_first_visit(page)
        finally:
            browser.close()


def test_clear_option_reassures_and_keeps_server_panel_sets(server):
    """The tick box says plainly what it leaves alone, and that is true."""
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_context(viewport={"width": 1400, "height": 900}).new_page()
            _open(page, server)
            for name in ("keep-mine", "keep-theirs"):
                req = urllib.request.Request(
                    f"{server}/api/v1/sessions/save", method="POST",
                    data=json.dumps({"name": name, "dataset": STORE}).encode(),
                    headers={"Content-Type": "application/json"})
                urllib.request.urlopen(req, timeout=10).read()
            listing = lambda: sorted(s["name"] for s in json.loads(
                urllib.request.urlopen(f"{server}/api/v1/sessions/list", timeout=10).read()))
            assert {"keep-mine", "keep-theirs"} <= set(listing())

            ask = _ask(page)
            note = ask.locator(".notification-check-note")
            text = note.inner_text()
            assert "fresh start for this browser only" in text
            assert "Nothing is deleted" in text
            assert "panel sets (yours and other users" in text
            assert "datasets and files on the server are not touched" in text
            # neutral styling: not the red/danger look
            assert "notification-error" not in (ask.get_attribute("class") or "")
            ask.locator("input[type=checkbox]").check()
            page.wait_for_timeout(700)
            _shot(page, "7-dialog-reassurance")
            with page.expect_navigation(timeout=30000):
                ask.get_by_role("button", name="Close all", exact=True).click()
            _landed_first_visit(page)

            assert {"keep-mine", "keep-theirs"} <= set(listing())
            # and the app itself still lists them
            names = page.evaluate("async () => (await (await fetch('api/v1/sessions/list')).json()).map(s => s.name)")
            assert {"keep-mine", "keep-theirs"} <= set(names)
        finally:
            browser.close()


def test_clear_keeps_the_login(login_server):
    root = login_server
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            context = browser.new_context(viewport={"width": 1400, "height": 900})
            page = context.new_page()
            url, ids = _link(root)
            page.goto(url)
            page.wait_for_selector("#username")
            page.fill("#username", "alice")
            page.fill("#password", "pw-one")
            with page.expect_navigation(url=lambda u: urllib.parse.urlsplit(u).path != "/login", timeout=30000):
                page.click("button[type=submit]")
            for i in ids:
                page.wait_for_selector(f".tile[data-tile-id='{i}'] .js-plotly-plot", timeout=60000)
            page.wait_for_timeout(800)
            cookies = sorted(c["name"] for c in context.cookies())
            assert cookies

            page.evaluate(PROBE)
            ask = _ask(page)
            ask.locator("input[type=checkbox]").check()
            with page.expect_navigation(timeout=30000):
                ask.get_by_role("button", name="Close all", exact=True).click()
            _landed_first_visit(page)

            assert urllib.parse.urlsplit(page.url).path == "/", page.url
            assert sorted(c["name"] for c in context.cookies()) == cookies
            assert page.evaluate("async () => (await fetch('api/v1/auth/me')).status") == 200
            assert page.evaluate(STORED)["local"] == []
            _shot(page, "5-login-kept")
        finally:
            browser.close()


@pytest.mark.parametrize("width", [1400, 1000, 768, 400])
def test_button_fits_at_narrow_widths(server, width):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_context(viewport={"width": width, "height": 800}).new_page()
            _open(page, server)
            box = page.locator("#btn-close-all").bounding_box()
            assert box and box["x"] >= 0 and box["x"] + box["width"] <= width + 1, (box, width)
            assert page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), width
            siblings = ["#btn-save-session", "#btn-load-session", "#btn-share-link"]
            tops = {page.locator(s).bounding_box()["y"] for s in siblings + ["#btn-close-all"]}
            assert max(tops) - min(tops) < 5, tops   # one row, none wrapped under another
            _shot(page, f"6-header-{width}")
            ask = _ask(page)
            nb = ask.bounding_box()
            assert nb["x"] >= 0 and nb["x"] + nb["width"] <= width + 1, (nb, width)
            page.wait_for_timeout(700)
            _shot(page, f"6-width-{width}")
        finally:
            browser.close()

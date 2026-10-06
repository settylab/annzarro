"""A login that ends mid-session returns, after signing in again, to the
same dataset and the CURRENT view (static/js/utils/session-expiry.js).

Before, an expired login made every API call fail with 401 while the page
stayed put: plots stopped loading and nothing said why. Now the first such
401 encodes the current view and goes to /login?next=...#view=...; the login
page keeps the fragment and the server sends the browser back with it.

One headless Chromium session per way a login can end:
* the cookie is gone (the idle timeout, or the browser dropped it);
* the password was changed on the server (`annzarro user passwd`), which
  revokes every existing login.

Each opens the committed 200-cell fixture through the login page with a
link coloured by cell_type, recolours by leiden (so the current view is not
the link's), ends the login, triggers a request, signs in again and checks
that the plot is back on the same dataset, coloured by leiden.

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
TILE = '.tile[data-tile-id="cell-plot-K"] '


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _cli(env, cfg, *args):
    subprocess.run([sys.executable, "-m", "annzarro.cli", "user", "--config", str(cfg), *args],
                   env=env, cwd=REPO, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


@pytest.fixture
def server(tmp_path):
    home = tmp_path / "home"
    home.mkdir()
    cfg = tmp_path / "site.yaml"
    cfg.write_text("auth:\n  enabled: true\n"
                   f"  user_file: \"{tmp_path / 'users.json'}\"\n")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    env.pop("ANNZARRO_CONFIG", None)
    _cli(env, cfg, "add", "--username", "alice", "--password", "pw-one")
    # this checkout's package, not whatever "annzarro" is installed
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
    yield root, (lambda *args: _cli(env, cfg, *args))
    proc.terminate()
    proc.wait(10)


def _link(root):
    plot = {"id": "cell-plot-K",
            "x": {"type": "obsm", "key": "X_umap", "column": "0"},
            "y": {"type": "obsm", "key": "X_umap", "column": "1"},
            "z": None,
            "color": {"type": "obs", "key": "cell_type", "column": ""}}
    view = {"v": 1, "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": "cell-plot-K", "controlsVisible": True}],
                               "controlState": {"cell-plot-K": True}, "panelConfigs": {"cell-plot-K": plot}}}
    payload = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={payload}"


STATE = """() => {
  const g = document.querySelector('.tile[data-tile-id="cell-plot-K"] .js-plotly-plot');
  const busy = [...document.querySelectorAll('.loading-overlay, .spinner-border')]
      .filter(e => e.offsetParent !== null).length;
  const sel = document.querySelector('.tile[data-tile-id="cell-plot-K"] select.axis-key-select[data-axis="color"]');
  return {
    drawn: !!(g && g.data && g.data.length),
    busy,
    colour: sel ? sel.value : null,
    traces: g && g.data ? g.data.map(t => t.name || '').join('|') : '',
    dataset: (document.getElementById('dataset-path') || {}).textContent || ''
  };
}"""


def _settle(page, pred, timeout=60):
    end = time.time() + timeout
    s = None
    while time.time() < end:
        s = page.evaluate(STATE)
        if s["drawn"] and not s["busy"] and pred(s):
            page.wait_for_timeout(500)
            return page.evaluate(STATE)
        page.wait_for_timeout(200)
    pytest.fail(f"plot did not settle: {s}")


def _sign_in(page, password):
    page.wait_for_selector("#username")
    page.fill("#username", "alice")
    page.fill("#password", password)
    # Wait for the app page: evaluating STATE while the login page navigates
    # away throws "Execution context was destroyed".
    with page.expect_navigation(url=lambda u: urllib.parse.urlsplit(u).path != "/login", timeout=30000):
        page.click("button[type=submit]")


@pytest.mark.parametrize("how", ["cookie-gone", "password-changed"])
def test_expired_login_returns_to_the_current_view(server, how):
    root, cli = server
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            context = browser.new_context(viewport={"width": 1400, "height": 900})
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))

            # The link survives the first login (PR #45)
            page.goto(_link(root))
            assert "/login" in page.url and "#view=" in page.url
            _sign_in(page, "pw-one")
            s = _settle(page, lambda s: s["colour"] == "cell_type")
            assert s["dataset"] == "Fixture Small"

            # Change the view, so "current" differs from the link
            before = s["traces"]
            page.select_option(TILE + 'select.axis-key-select[data-axis="color"]', "leiden")
            s = _settle(page, lambda s: s["colour"] == "leiden" and s["traces"] != before)
            leiden_traces = s["traces"]

            # The login ends
            if how == "cookie-gone":
                context.clear_cookies()
                password = "pw-one"
            else:
                cli("passwd", "--username", "alice", "--password", "pw-two")
                password = "pw-two"

            # The next request finds out and goes to the login page. It used
            # to be awaited inside evaluate, under expect_navigation: under load
            # the redirect committed while evaluate still waited ("Execution
            # context was destroyed"), and a redirect already under way when
            # expect_navigation began would have been missed. The request is
            # now fired without waiting, and the test waits for the login URL,
            # which holds whichever request's 401 got there first.
            try:
                page.evaluate("() => { fetch('api/v1/auth/me'); }")
            except playwright.Error as e:
                if "Execution context was destroyed" not in str(e):
                    raise
            page.wait_for_url(lambda u: urllib.parse.urlsplit(u).path == "/login", timeout=15000)
            parts = urllib.parse.urlsplit(page.url)
            assert parts.path == "/login"
            assert "dataset_path" in urllib.parse.unquote(parts.query)
            assert parts.fragment.startswith("view="), page.url

            # Sign in again: same dataset, current view (leiden), not the link's
            _sign_in(page, password)
            s = _settle(page, lambda s: s["colour"] == "leiden")
            assert s["dataset"] == "Fixture Small"
            assert s["traces"] == leiden_traces
            assert urllib.parse.urlsplit(page.url).path == "/"
            assert not errors, errors
        finally:
            browser.close()

"""Copying works on a plain-http page that is not localhost (an insecure context).

The page is opened as http://annzarro.test:<port>, which Chromium maps to the local server
but does not treat as secure, so navigator.clipboard is undefined there. C over a point and
Share Link must still copy, through the textarea fallback. The text is read back in a second,
secure page (http://127.0.0.1) of the same browser, and from the copy event as a cross-check.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1 (set in CI).
"""
import base64
import collections
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
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(HERE), "data")
STORE = os.path.join(DATA_DIR, "fixture_small.zarr")
P1 = '.tile[data-tile-id="cell-plot-L"]'
P2 = '.tile[data-tile-id="cell-plot-M"]'
T = '.tile[data-tile-id="cell-table-L"]'


Served = collections.namedtuple("Served", "root kind")


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    home = tmp_path_factory.mktemp("home")
    cfg = home / "large.yaml"
    cfg.write_text("ui:\n  defaults:\n    large_plot_points: %d\n" % 10**9)
    port = _free_port()
    exe = shutil.which("annzarro", path=os.path.dirname(sys.executable)) or shutil.which("annzarro")
    if not exe:
        (pytest.fail if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1" else pytest.skip)(
            "annzarro console script not found")
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1")
    proc = subprocess.Popen([exe, "start", "--config", str(cfg), "--host", "127.0.0.1", "--port", str(port),
                             "--data-dir", DATA_DIR, "--no-browser", "--auth-disabled"],
                            env=env, cwd=home, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for _ in range(120):
        try:
            urllib.request.urlopen(root + "/api/v1/config", timeout=1)
            break
        except OSError:
            time.sleep(min(0.5, 0.1 * (_ + 1)))
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield Served(root, "regular")
    proc.terminate()
    proc.wait(10)



def _link(served, z=False):
    root = served.root
    x = {"type": "obsm", "key": "X_umap", "column": "0"}
    y = {"type": "obsm", "key": "X_umap", "column": "1"}
    plot = {"x": x, "y": y, "z": {"type": "obsm", "key": "X_umap", "column": "2"} if z else None,
            "pointSize": 12, "pointOpacity": 1}
    extra = {"hoverInfo": [{"type": "obs", "key": "cell_type"}]} if served.kind == "regular" else {}
    cfg = {"id": "cell-plot-L", "title": "L", **plot, "color": {"type": "obs", "key": "total_counts", "column": ""}, **extra}
    view = {"v": 1, "subset": None,
            "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": "cell-plot-L", "controlsVisible": True}],
                       "controlState": {"cell-plot-L": True}, "panelConfigs": {"cell-plot-L": cfg}}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={enc}"




GRAPH = ".tile[data-tile-id='cell-plot-L'] .js-plotly-plot"

SHOWING = """() => { const g = document.querySelector("%s");
  if (g.__largeState) { const t = document.querySelector('.large-plot-tip');
    return !!(g.__largeState.index && t && t.style.display !== 'none' && /^cell_\\d+$/.test(t.firstChild.textContent)
      && t.children.length >= 3); }
  const sc = g._fullLayout && g._fullLayout.scene && g._fullLayout.scene._scene;
  return !!((g._hoverdata && g._hoverdata.length) || (sc && sc.lastPickResult)); }""" % GRAPH


def _ready(page):
    page.wait_for_function("""g => { const e = document.querySelector(g);
      return !!(e && e._fullLayout && (e.__largeState ? e.__largeState.index : e.data && e.data.length)); }""",
                           arg=GRAPH, timeout=60000)


LARGE_POINT = """g => { const e = document.querySelector(g), idx = e.__largeState.index;
  const xa = e._fullLayout.xaxis, ya = e._fullLayout.yaxis, r = e.querySelector('.nsewdrag').getBoundingClientRect();
  const i = Math.floor(idx.X.length / 2);
  return [r.left + xa.l2p(idx.X[i]), r.top + ya.l2p(idx.Y[i])]; }"""


def _hover_a_point(page):
    """Put the pointer on a point and wait for its label; the pointer stays there."""
    if page.evaluate("g => !!document.querySelector(g).__largeState", GRAPH):
        x, y = page.evaluate(LARGE_POINT, GRAPH)
        page.mouse.move(x - 40, y - 40)
        page.mouse.move(x + 1, y + 1, steps=4)
        page.wait_for_function(SHOWING, timeout=15000)
        return
    box = page.evaluate("""g => { const r = (document.querySelector(g + ' .nsewdrag') || document.querySelector(g)).getBoundingClientRect();
                           return [r.left, r.top, r.width, r.height]; }""", GRAPH)
    for i in range(1, 24):
        for j in range(1, 24):
            page.mouse.move(box[0] + box[2] * i / 24, box[1] + box[3] * j / 24)
            page.wait_for_timeout(8)
            if page.evaluate(SHOWING):
                return
    page.wait_for_function(SHOWING, timeout=3000)


INSECURE_HOST = "annzarro.test"

COPY_SPY = """() => { window.__copied = []; document.addEventListener('copy', () => {
    const a = document.activeElement;
    window.__copied.push(a && a.tagName === 'TEXTAREA' ? a.value.substring(a.selectionStart, a.selectionEnd) : String(getSelection())); }, true); }"""


@pytest.fixture
def pages(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch(args=[f"--host-resolver-rules=MAP {INSECURE_HOST} 127.0.0.1"])
        try:
            ctx = browser.new_context(viewport={"width": 1300, "height": 800}, permissions=["clipboard-read", "clipboard-write"])
            page = ctx.new_page()
            page.errors = []
            page.on("pageerror", lambda e: page.errors.append(str(e)))
            reader = ctx.new_page()
            reader.goto(server.root + "/api/v1/config")
            yield page, reader
            assert not page.errors, page.errors
        finally:
            browser.close()


def _insecure_link(server):
    return _link(server).replace("127.0.0.1", INSECURE_HOST, 1)


def _read(reader):
    return reader.evaluate("navigator.clipboard.readText()")


def test_c_copies_on_plain_http(pages, server):
    page, reader = pages
    page.goto(_insecure_link(server))
    assert page.evaluate("window.isSecureContext") is False
    assert page.evaluate("typeof navigator.clipboard") == "undefined"
    _ready(page)
    page.evaluate(COPY_SPY)
    _hover_a_point(page)
    page.keyboard.press("c")
    page.wait_for_function("() => document.querySelector('.notification') && /Copied hover info/.test(document.querySelector('.notification').textContent)")
    copied = page.evaluate("window.__copied")
    assert len(copied) == 1 and copied[0].startswith("cell_"), copied
    assert _read(reader) == copied[0]
    assert "x: " in copied[0] and "cell_type: " in copied[0]
    # the hidden textarea is gone and the focus is where it was
    assert page.locator("textarea[readonly][aria-hidden]").count() == 0


def test_share_link_copies_on_plain_http(pages, server):
    page, reader = pages
    page.goto(_insecure_link(server))
    assert page.evaluate("window.isSecureContext") is False
    _ready(page)
    page.evaluate(COPY_SPY)
    page.click("#btn-share-link")
    page.wait_for_function("() => /Copied/.test(document.querySelector('#btn-share-link .btn-share-label').textContent)")
    assert page.locator("#share-link-fallback").is_hidden()
    copied = page.evaluate("window.__copied")
    assert len(copied) == 1 and copied[0].startswith(f"http://{INSECURE_HOST}:"), copied
    assert _read(reader) == copied[0]

"""A new Cell Plot on an embedding opens with Equal aspect on.

When a cell plot's x and y are both filled by the automatic default and come from
one embedding (obsm: UMAP, t-SNE, PCA, spatial), Equal aspect starts on, so the
embedding keeps its shape at any window size. It is never applied to a value the
user, a share link, a panel set or a session chose, to a link made before the
option existed (no ``equalAspect`` key), or to axes that are not one embedding.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
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
import zarr

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
FIXTURE = os.path.join(HERE, "..", "data", "fixture_small.zarr")
CELL = "cell-plot-A"
EMB = lambda key, column: {"type": "obsm", "key": key, "column": column}   # noqa: E731
OBS = lambda key: {"type": "obs", "key": key, "column": ""}                 # noqa: E731


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    data = tmp_path_factory.mktemp("data")
    shutil.copytree(FIXTURE, data / "umap.zarr")
    shutil.copytree(FIXTURE, data / "noobsm.zarr")
    shutil.rmtree(data / "noobsm.zarr" / "obsm" / "X_umap")
    zarr.consolidate_metadata(str(data / "noobsm.zarr"))
    home = tmp_path_factory.mktemp("home")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", str(data), "--no-browser", "--auth-disabled"],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for i in range(120):
        try:
            urllib.request.urlopen(root + "/api/v1/config", timeout=1)
            break
        except OSError:
            time.sleep(min(0.5, 0.1 * (i + 1)))
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield {"root": root, "umap": str(data / "umap.zarr"), "noobsm": str(data / "noobsm.zarr"), "home": home}
    proc.terminate()
    proc.wait(10)


def _app(server, store):
    return f"{server['root']}/?dataset_path={urllib.parse.quote(server[store], safe='/')}"


def _link(server, store, **fields):
    cfg = {"id": CELL, "title": "t", "z": None, "pointSize": 8, "pointOpacity": 1, "color": {"type": "none"}}
    cfg.update({k: v for k, v in fields.items() if v is not ABSENT})
    for k, v in fields.items():
        if v is ABSENT:
            cfg.pop(k, None)
    view = {"v": 1, "constants": {}, "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": CELL, "controlsVisible": True}],
            "controlState": {CELL: True}, "panelConfigs": {CELL: cfg}}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return _app(server, store) + f"#view={enc}"


ABSENT = object()
BUTTON = ".tile [id^='equal-aspect-']"      # one plot is open in every test
GD = "document.querySelector('.tile .js-plotly-plot')"
STATE = """() => {
  const gd = %s, fl = gd && gd._fullLayout;
  if (!fl || !fl.xaxis || !fl.xaxis._length || !gd.data || !gd.data.length) return null;
  const [x0, x1] = fl.xaxis.range, [y0, y1] = fl.yaxis.range;
  const cfg = PanelManager.saveLayout().panelConfigs;
  const mine = Object.values(cfg).find(c => c.id && c.id.startsWith('cell-plot')) || {};
  return {anchor: fl.yaxis.scaleanchor || null, saved: mine.equalAspect,
          perPixel: [(x1 - x0) / fl.xaxis._length, (y1 - y0) / fl.yaxis._length],
          size: [fl.xaxis._length, fl.yaxis._length],
          pressed: document.querySelector(%r).getAttribute('aria-pressed')};
}""" % (GD, BUTTON)


def _state(page, timeout=60):
    end = time.time() + timeout
    while time.time() < end:
        s = page.evaluate(STATE)
        if s:
            page.wait_for_timeout(1500)       # the first fit and its redraw settle
            return page.evaluate(STATE)
        page.wait_for_timeout(200)
    pytest.fail("the plot never drew")


def _new_plot(page):
    page.wait_for_selector(".panel-type-option[data-type='cell-plot']", timeout=30000)
    page.locator(".tile-selector .panel-type-option[data-type='cell-plot']").first.click()
    page.wait_for_selector(".tile .js-plotly-plot", timeout=30000)


def _run(server, body, size=(1400, 1000)):
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": size[0], "height": size[1]})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            body(page)
            assert not errors, errors
        finally:
            browser.close()


def _open_link(server, store, **fields):
    out = {}

    def body(page):
        page.goto(_link(server, store, **fields))
        page.wait_for_selector(".tile .js-plotly-plot", timeout=60000)
        out["s"] = _state(page)
    _run(server, body)
    return out["s"]


# --- a new plot ------------------------------------------------------------------------


def test_a_new_plot_on_an_embedding_opens_with_equal_aspect_at_any_size(server):
    def body(page):
        page.goto(_app(server, "umap"))
        _new_plot(page)
        s = _state(page)
        assert s["pressed"] == "true" and s["saved"] is True, s
        assert s["anchor"] == "x", s
        for size in ((1900, 700), (800, 1200), (1400, 1000)):
            page.set_viewport_size({"width": size[0], "height": size[1]})
            page.wait_for_timeout(2500)
            s = _state(page)
            assert s["anchor"] == "x", (size, s)
            assert abs(s["perPixel"][0] - s["perPixel"][1]) <= 0.02 * s["perPixel"][0], (size, "not 1:1", s)
    _run(server, body)


def test_a_new_plot_can_be_switched_off_and_stays_off(server):
    def body(page):
        page.goto(_app(server, "umap"))
        _new_plot(page)
        _state(page)
        page.click(BUTTON)
        page.wait_for_timeout(1000)
        s = page.evaluate(STATE)
        assert s["pressed"] == "false" and s["saved"] is False and s["anchor"] is None, s
    _run(server, body)


def test_a_dataset_without_an_embedding_does_not_turn_it_on(server):
    def body(page):
        page.goto(_app(server, "noobsm"))
        _new_plot(page)
        page.wait_for_timeout(3000)
        s = page.evaluate("""() => { const c = Object.values(PanelManager.saveLayout().panelConfigs)[0];
            const b = document.querySelector(".tile [id^='equal-aspect-']");
            return {x: c.x, y: c.y, saved: c.equalAspect, pressed: b.getAttribute('aria-pressed')}; }""")
        assert s["x"]["type"] == "obs" and s["y"]["type"] == "obs", s
        assert not s["saved"] and s["pressed"] == "false", s
    _run(server, body)


# --- links, saved panels, history ------------------------------------------------------


def test_a_link_with_equal_aspect_off_stays_off(server):
    s = _open_link(server, "umap", x=EMB("X_umap", "0"), y=EMB("X_umap", "1"), equalAspect=False)
    assert s["pressed"] == "false" and s["saved"] is False and s["anchor"] is None, s


def test_a_link_with_equal_aspect_on_stays_on(server):
    s = _open_link(server, "umap", x=EMB("X_umap", "0"), y=EMB("X_umap", "1"), equalAspect=True)
    assert s["pressed"] == "true" and s["anchor"] == "x", s


def test_an_old_link_without_the_key_opens_as_it_did(server):
    s = _open_link(server, "umap", x=EMB("X_umap", "0"), y=EMB("X_umap", "1"))
    assert s["pressed"] == "false" and not s["saved"] and s["anchor"] is None, s


def test_a_link_without_axes_or_key_is_not_given_equal_aspect_when_axes_differ(server):
    s = _open_link(server, "umap", x=EMB("X_umap", "0"), y=OBS("total_counts"))
    assert s["pressed"] == "false" and not s["saved"] and s["anchor"] is None, s


def test_changing_the_axes_does_not_flip_equal_aspect(server):
    def body(page):
        page.goto(_app(server, "umap"))
        _new_plot(page)
        assert _state(page)["pressed"] == "true"
        base = ".tile .axis-type-select[data-axis='y']"
        page.select_option(base, "obs")
        page.wait_for_timeout(1500)
        assert page.get_attribute(BUTTON, "aria-pressed") == "true"
    _run(server, body)


# --- panel set and link round trips ----------------------------------------------------


def test_a_panel_set_and_a_link_keep_the_state(server):
    def body(page):
        page.goto(_app(server, "umap"))
        _new_plot(page)
        _state(page)
        page.click("#btn-save-session")
        page.fill("#session-name", "aspect-set")
        page.click("#btn-confirm-session")
        page.wait_for_function("() => document.getElementById('session-modal').offsetParent === null")
        page.wait_for_selector(".modal-backdrop", state="detached")
        saved = [p for p in (server["home"] / "panel-sets").rglob("*.json")]
        text = "".join(p.read_text() for p in saved)
        assert '"equalAspect": true' in text or '"equalAspect":true' in text, text[:500]
        # the same layout through a link: the panel's saved config, as a view
        cfgs = page.evaluate("() => PanelManager.saveLayout().panelConfigs")
        (pid, cfg), = cfgs.items()
        assert cfg["equalAspect"] is True
        link = _link(server, "umap", **{k: v for k, v in cfg.items() if k != "id"})
        page.goto("about:blank")
        page.goto(link)
        page.wait_for_selector(".tile .js-plotly-plot", timeout=60000)
        page.wait_for_timeout(2500)
        assert page.get_attribute(BUTTON, "aria-pressed") == "true"
    _run(server, body)

"""A subset change while another is still loading, Close all in the middle, and the colour None.

The committed 200-cell fixture is served with ``ui.defaults.large_plot_points``
lowered to 100: all 200 cells draw large, a subset of 50 draws a regular plot.
The page's cell, obs and obsm reads are slowed (and honour an abort, as a real
request does), so a subset load stays in flight while the test acts.

1. A subset change made while the previous one is still loading shows at once:
   the header names the cells asked for before any of them is read, a later
   request replaces an earlier one's, and the plot ends on the last request's
   cells, never showing the earlier one's.
2. Close all while a subset load is in flight, then another subset change: no
   panel comes back, and the closed ones stay listed for Reopen.
3. The colour None is one colour in the regular and the large-plot mode, and it
   is not the grey of the points that are not in the table.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI).
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
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(HERE), "data")
STORE = os.path.join(DATA_DIR, "fixture_small.zarr")
TILE = '.tile[data-tile-id="cell-plot-a"]'
GD = TILE + " .js-plotly-plot"
SLOW_MS = 4000


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    home = tmp_path_factory.mktemp("home")
    cfg = home / "large.yaml"
    cfg.write_text("ui:\n  defaults:\n    large_plot_points: 100\n")
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
            time.sleep(0.25)
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield root
    proc.terminate()
    proc.wait(10)


def _link(root, color=None):
    plot = {"id": "cell-plot-a", "title": "A", "pointSize": 12, "pointOpacity": 1,
            "x": {"type": "obsm", "key": "X_umap", "column": "0"},
            "y": {"type": "obsm", "key": "X_umap", "column": "1"},
            "color": color or {"type": "none", "key": "", "column": ""}}
    hierarchy = [{"type": "tile", "id": "cell-plot-a", "controlsVisible": True}]
    view = {"v": 1, "subset": None,
            "layout": {"v": 1, "hierarchy": hierarchy, "controlState": {"cell-plot-a": True},
                       "panelConfigs": {"cell-plot-a": plot}}}
    enc = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={enc}"


# Slow the reads of the cells' data while __slow.on; an aborted one ends at once
SLOW = """(ms) => {
    const real = window.fetch;
    window.__slow = {on: false, ms, re: /\\/api\\/v1\\/data\\/(cells|obsm|obs|names)\\b/};
    window.fetch = function (url, init) {
        const sig = init && init.signal;
        if (!window.__slow.on || !window.__slow.re.test(String(url))) return real.apply(this, arguments);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => real.call(window, url, init).then(resolve, reject), window.__slow.ms);
            if (sig) sig.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')); }, {once: true});
        });
    };
}"""


@pytest.fixture
def page(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 900})
            page.errors = []
            page.on("pageerror", lambda e: page.errors.append(str(e)))
            page.add_init_script(f"({SLOW})({SLOW_MS})")
            yield page
            assert not page.errors, page.errors
        finally:
            browser.close()


LARGE_READY = """() => { const g = document.querySelector('%s');
  return !!(g && g.__isLarge && g._fullLayout && g.__largeState && g.__largeState.index); }""" % GD
POINTS = """() => { const g = document.querySelector('%s'); return g && g._fullLayout ? g._pointCount : null; }""" % GD
TILES = "() => [...document.querySelectorAll('.tile-container .tile[data-tile-id]')].map(t => t.dataset.tileId)"
CLOSED_LISTED = """() => [...new Set([...document.querySelectorAll(
    '.tile-container > .tile-selector .source-panel-option.closed-panel, .panel-closed-btn')]
    .filter(e => e.offsetParent !== null).map(e => e.dataset.id))]"""


def _open(page, root, color=None):
    page.goto(_link(root, color))
    page.wait_for_function(LARGE_READY, timeout=60000)


def _apply(page, n):
    """Apply the subset dialog with the size chip `n`; returns once the dialog is gone (the cells may still load)."""
    page.click("#subset-button")
    page.wait_for_selector("#subset-presets button.subset-preset", state="visible")
    page.click(f'#subset-presets button[data-n="{n}"]')
    page.wait_for_function("() => !document.getElementById('subset-apply').disabled", timeout=15000)
    page.click("#subset-apply")
    page.wait_for_selector("#subset-modal", state="hidden")
    page.wait_for_selector(".modal-backdrop", state="detached")


def _slow(page, on):
    page.evaluate("(on) => { window.__slow.on = on; }", on)


def _header(page):
    return page.evaluate("() => ({count: document.getElementById('cell-count').textContent.trim(),"
                         " badge: document.getElementById('subset-button').textContent.trim()})")


def test_a_later_subset_shows_at_once_and_replaces_the_earlier(page, server):
    _open(page, server)
    assert _header(page)["count"] == "200"
    page.evaluate("() => { window.__seen = new Set(); setInterval(() => {"
                  " const g = document.querySelector('%s'); if (g && g._pointCount) window.__seen.add(g._pointCount); }, 50); }" % GD)

    _slow(page, True)
    _apply(page, 100)
    # the 100 cells are asked for, none is read yet: the header names them already
    assert _header(page)["count"] == "100 of 200", _header(page)
    # asked for, not shown: marked as pending, and still pending while the cells load
    assert page.get_attribute("#subset-button", "aria-busy") == "true"
    assert page.get_attribute("#cell-count", "data-pending") == "true"
    page.wait_for_timeout(800)
    assert page.evaluate("() => document.querySelector('.subset-loading-pill')") is not None   # still loading

    _apply(page, 50)
    # at once, while the first is still in flight and the second has read nothing
    assert _header(page)["count"] == "50 of 200", _header(page)
    assert _header(page)["badge"].startswith("Subset"), _header(page)

    page.wait_for_function("() => { const g = document.querySelector('%s'); return !!(g && g._fullLayout && g._pointCount === 50); }" % GD,
                           timeout=40000)
    page.wait_for_function("() => !document.querySelector('.subset-loading-pill, .subset-loading')", timeout=20000)
    assert page.get_attribute("#subset-button", "aria-busy") == "false"
    assert page.get_attribute("#cell-count", "data-pending") == "false"
    page.wait_for_timeout(SLOW_MS + 1500)       # the earlier request's own time passes: its cells must not come
    assert page.evaluate(POINTS) == 50
    assert _header(page)["count"] == "50 of 200", _header(page)
    seen = page.evaluate("() => [...window.__seen]")
    assert 100 not in seen, f"the earlier subset's 100 cells were drawn: {seen}"


def test_close_all_mid_load_then_a_subset_change_opens_nothing(page, server):
    _open(page, server)
    _slow(page, True)
    _apply(page, 100)
    page.wait_for_timeout(800)
    _apply(page, 50)
    page.wait_for_timeout(300)

    page.click("#btn-close-all")
    page.wait_for_selector(".notification-ask", timeout=5000)
    page.locator(".notification-ask button", has_text="Close all").last.click()
    page.wait_for_function("() => document.querySelectorAll('.tile-container .tile[data-tile-id]').length === 0", timeout=5000)
    assert page.evaluate(CLOSED_LISTED) == ["cell-plot-a"]

    _apply(page, 100)
    deadline = time.time() + SLOW_MS / 1000 * 3 + 4
    while time.time() < deadline:
        assert page.evaluate(TILES) == [], "a closed panel came back"
        page.wait_for_timeout(250)
    assert page.evaluate(CLOSED_LISTED) == ["cell-plot-a"]
    # the header still follows the last request
    assert _header(page)["count"] == "100 of 200", _header(page)


# The colour of the data points of the plot, and of its table-filter grey
NONE_COLOUR = """() => { const g = document.querySelector('%s');
  const t = g.data.find(t => t.marker && typeof t.marker.color === 'string' && t.name !== 'Not in table');
  return t ? t.marker.color : null; }""" % GD


def test_colour_none_is_one_colour_in_both_modes(page, server):
    _open(page, server)
    # a plot opens on the dataset's default colour: choose None
    page.select_option("#color-type-select-cell-plot-a", "none")
    page.wait_for_function("() => PanelManager.getPanel('cell-plot-a').getConfig().color.type === 'none'", timeout=15000)
    page.wait_for_timeout(2500)
    page.wait_for_function(LARGE_READY, timeout=30000)
    large = page.evaluate(NONE_COLOUR)

    _apply(page, 50)
    page.wait_for_function("() => { const g = document.querySelector('%s'); return !!(g && g._fullLayout && !g.__isLarge && g._pointCount === 50); }" % GD,
                           timeout=30000)
    regular = page.evaluate(NONE_COLOUR)

    assert large == regular, f"large-plot mode draws None as {large}, the regular plot as {regular}"
    palette = page.evaluate("async () => (await import('/static/js/utils/plot-theme.js')).PLOT_PALETTES.light")
    assert regular == palette["noneColor"] == "#1f77b4", (regular, palette)
    assert regular != palette["notInTableColor"]
    assert regular not in ("rgba(150, 150, 150, 1.)", "rgba(150, 150, 150, 1.0)")

    # and in 3D
    page.click("#z-axis-toggle-cell-plot-a")
    page.wait_for_function("() => { const g = document.querySelector('%s'); return !!(g && g.data && g.data[0] && g.data[0].type === 'scatter3d'); }" % GD,
                           timeout=30000)
    assert page.evaluate(NONE_COLOUR) == "#1f77b4"


def test_a_reload_after_close_all_mid_load_restores_nothing(page, server):
    """A reload while the subset the panel was drawing is still loading (a crash looks the same) restores no closed panel."""
    _open(page, server)
    _slow(page, True)
    _apply(page, 100)
    page.wait_for_timeout(800)
    page.click("#btn-close-all")
    page.wait_for_selector(".notification-ask", timeout=5000)
    page.locator(".notification-ask button", has_text="Close all").last.click()
    page.wait_for_function("() => document.querySelectorAll('.tile-container .tile[data-tile-id]').length === 0", timeout=5000)
    page.wait_for_timeout(1500)
    page.reload()
    page.wait_for_selector(".panel-type-option", timeout=30000)
    page.wait_for_timeout(5000)
    assert page.evaluate(TILES) == [], "a reload after Close all brought back a closed panel"

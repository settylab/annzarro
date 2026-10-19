"""The session's default plot style: "Use as default for new cell plots" in Plot Options, Apply to other panels.

Two cell plots (A, B) on the 200-cell fixture. A is set up (font 18, four ticks) and made the default;
a plot made from the chooser then starts with that look, open plots and a Duplicate do not, a reload of
the tab keeps it, Close all clears it only with the cache tick, a panel set carries it and applies it
only when loaded with its panels open, and Reset ends it.

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
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
FIXTURE = os.path.join(os.path.dirname(HERE), "data", "fixture_small.zarr")
A, B = "cell-plot-A", "cell-plot-B"
TILES = "() => [...document.querySelectorAll('.tile-container .tile[data-tile-id]')].map(t => t.dataset.tileId)"
GD = """(id) => document.querySelector(`.tile[data-tile-id="${id}"] .js-plotly-plot`)"""
DRAWN = """(id) => { const gd = (%s)(id); return !!(gd && gd._fullLayout && gd.data && gd.data.some(t => t.x && t.x.length > 1)); }""" % GD


@pytest.fixture(scope="module")
def served(tmp_path_factory):
    """A server on its own copy of the store: saving a panel set writes <data dir>/sessions."""
    data = tmp_path_factory.mktemp("data")
    shutil.copytree(FIXTURE, data / "fixture_small.zarr")
    home = tmp_path_factory.mktemp("home")
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    env.pop("ANNZARRO_CONFIG", None)
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1", "--port", str(port),
                             "--data-dir", str(data), "--no-browser", "--auth-disabled"],
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
    yield root, str(data / "fixture_small.zarr")
    proc.terminate()
    proc.wait(10)


@pytest.fixture
def page(served):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_context(viewport={"width": 1500, "height": 1000}).new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            yield page
            assert not errors, errors
        finally:
            browser.close()


def _link(served):
    root, store = served
    x = {"type": "obsm", "key": "X_umap", "column": "0"}
    y = {"type": "obsm", "key": "X_umap", "column": "1"}
    cfgs = {i: {"id": i, "x": x, "y": y, "z": None, "color": {"type": "obs", "key": "cell_type", "column": ""}}
            for i in (A, B)}
    tiles = [{"type": "tile", "id": i, "controlsVisible": True} for i in (A, B)]
    layout = {"v": 1, "hierarchy": [{"type": "split", "direction": "horizontal",
                                      "panes": [{"percentage": 50}, {"percentage": 50}], "children": tiles}],
              "controlState": {i: True for i in (A, B)}, "panelConfigs": cfgs}
    enc = base64.urlsafe_b64encode(json.dumps({"v": 1, "subset": None, "layout": layout}).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}"


def _open(page, served):
    page.goto(_link(served))
    for pid in (A, B):
        page.wait_for_function(DRAWN, arg=pid, timeout=60000)
    page.wait_for_timeout(1000)


def _menu(page, pid, section):
    if not page.query_selector(f"details[data-panel='{pid}']"):
        page.click(f"#aesthetics-menu-btn-{pid}")
        page.wait_for_selector(f"details[data-panel='{pid}']", state="visible")
    d = page.query_selector(f"details[data-panel='{pid}'][data-section='{section}']")
    if not d.evaluate("e => e.open"):
        d.query_selector("summary").click()
    page.wait_for_function("(e) => e.open", arg=d)


def _change(page, selector, value):
    page.fill(selector, str(value))
    page.press(selector, "Tab")
    page.wait_for_timeout(400)


def _settings(page, pid):
    return page.evaluate("(id) => window.PanelManager.saveLayout().panelConfigs[id]", pid)


def _set_up_a_and_make_default(page):
    """A: font 18 and four ticks; Use as default."""
    _menu(page, A, "text")
    _change(page, f"#font-size-{A}", 18)
    _menu(page, A, "axes")
    _change(page, f"#tick-count-{A}", 4)
    _menu(page, A, "apply")
    assert not page.is_visible(f"#session-style-active-{A}")
    page.click(f"#session-style-set-{A}")
    page.wait_for_selector(f"#session-style-active-{A}", state="visible")
    assert "cell plots will start" in page.inner_text(f"#session-style-done-{A}")


def _new_plot(page):
    """A cell plot from the bottom chooser; its id."""
    before = set(page.evaluate(TILES))
    page.locator(".panel-type-option[data-type='cell-plot']").last.click()
    page.wait_for_function("(b) => [...document.querySelectorAll('.tile[data-tile-id]')].some(t => !b.includes(t.dataset.tileId))",
                           arg=sorted(before), timeout=30000)
    (new,) = set(page.evaluate(TILES)) - before
    return new


def _note_shown(page, pid):
    """Whether the menu of `pid`, opened afresh, says a session default is set."""
    if page.query_selector(f"details[data-panel='{pid}']"):
        page.click(f"#aesthetics-menu-btn-{pid}")
        page.wait_for_selector(f"details[data-panel='{pid}']", state="detached")
    _menu(page, pid, "apply")
    shown = page.is_visible(f"#session-style-active-{pid}")
    page.click(f"#aesthetics-menu-btn-{pid}")
    page.wait_for_selector(f"details[data-panel='{pid}']", state="detached")
    return shown


def _ask_close_all(page, clear):
    page.click("#btn-close-all")
    page.wait_for_selector(".notification-ask", timeout=5000)
    ask = page.locator(".notification-ask")
    if clear:
        ask.locator("input[type=checkbox]").check()
    page.wait_for_timeout(700)
    return ask


def test_new_plots_start_from_the_default_and_existing_ones_do_not(page, served):
    _open(page, served)
    built_in = _settings(page, B)
    assert built_in["fontSize"] == 12 and built_in["tickCount"] is None
    _set_up_a_and_make_default(page)
    assert _settings(page, B)["fontSize"] == 12                          # an open plot does not change

    new = _new_plot(page)
    page.wait_for_function(DRAWN, arg=new, timeout=60000)
    cfg = _settings(page, new)
    assert cfg["fontSize"] == 18 and cfg["tickCount"] == 4               # the look comes over
    assert page.evaluate("(id) => (%s)(id)._fullLayout.xaxis.nticks" % GD, new) == 4
    assert cfg["color"] != _settings(page, A)["color"] or cfg["x"] != _settings(page, A)["x"]   # what it shows is not copied
    assert _settings(page, B)["fontSize"] == 12

    # Duplicate keeps its source's look, whatever the default is
    before = set(page.evaluate(TILES))
    page.evaluate("(id) => setTimeout(() => document.querySelector(`.source-panel-option[data-id='${id}']`).click(), 0)", B)
    page.wait_for_function("(b) => [...document.querySelectorAll('.tile[data-tile-id]')].some(t => !b.includes(t.dataset.tileId))",
                           arg=sorted(before), timeout=30000)
    (dup,) = set(page.evaluate(TILES)) - before
    assert _settings(page, dup)["fontSize"] == 12 and _settings(page, dup)["tickCount"] is None

    # Reset to built-in default
    _menu(page, A, "apply")
    page.click(f"#session-style-reset-{A}")
    page.wait_for_selector(f"#session-style-active-{A}", state="hidden")
    again = _new_plot(page)
    assert _settings(page, again)["fontSize"] == 12 and _settings(page, again)["tickCount"] is None


def test_a_gene_plot_has_its_own_default(page, served):
    _open(page, served)
    _set_up_a_and_make_default(page)
    before = set(page.evaluate(TILES))
    page.locator(".panel-type-option[data-type='gene-plot']").last.click()
    page.wait_for_function("(b) => [...document.querySelectorAll('.tile[data-tile-id]')].some(t => !b.includes(t.dataset.tileId))",
                           arg=sorted(before), timeout=30000)
    (gene,) = set(page.evaluate(TILES)) - before
    assert _settings(page, gene)["fontSize"] == 12                       # the cell plots' default is theirs


def test_a_reload_of_the_tab_keeps_it_and_a_new_tab_does_not(page, served):
    _open(page, served)
    _set_up_a_and_make_default(page)
    assert page.evaluate("() => Object.keys(sessionStorage)").count("annzarro_session_style") == 1
    page.reload()
    for pid in (A, B):
        page.wait_for_function(DRAWN, arg=pid, timeout=60000)
    page.wait_for_timeout(1000)
    new = _new_plot(page)
    assert _settings(page, new)["fontSize"] == 18
    assert _note_shown(page, A)
    # a new tab: its own session storage, so no default
    other = page.context.new_page()
    _open(other, served)
    assert not _note_shown(other, A)
    assert _settings(other, _new_plot(other))["fontSize"] == 12


def test_close_all_keeps_it_without_the_tick_and_clears_it_with_the_tick(page, served):
    _open(page, served)
    _set_up_a_and_make_default(page)
    ask = _ask_close_all(page, clear=False)
    ask.get_by_role("button", name="Close all", exact=True).click()
    page.wait_for_function("() => document.querySelectorAll('.tile-container .tile[data-tile-id]').length === 0")
    page.wait_for_timeout(500)
    assert "annzarro_session_style" in page.evaluate("() => Object.keys(sessionStorage)")
    new = _new_plot(page)                                                # the welcome tile makes the first plot
    assert _settings(page, new)["fontSize"] == 18

    ask = _ask_close_all(page, clear=True)
    with page.expect_navigation(timeout=30000):
        ask.get_by_role("button", name="Close all", exact=True).click()
    page.wait_for_function("() => document.readyState === 'complete'")
    page.wait_for_timeout(1500)
    assert "annzarro_session_style" not in page.evaluate("() => Object.keys(sessionStorage)")
    _open(page, served)
    assert not _note_shown(page, A)
    assert _settings(page, _new_plot(page))["fontSize"] == 12


def test_a_panel_set_carries_it_and_applies_it_only_when_its_panels_open(page, served):
    _open(page, served)
    _set_up_a_and_make_default(page)
    saved = page.evaluate("(n) => window.sessionManager.saveSession(n)", "with-style")
    assert saved["status"] == "success", saved
    stored = page.evaluate("""async () => (await (await fetch('/api/v1/sessions/load?name=with-style')).json()).sessionStyles""")
    assert stored and stored["cell-plot"]["fontSize"] == 18 and "x" not in stored["cell-plot"]

    # a set saved with no default carries none, and loading it leaves the current one
    _menu(page, A, "apply")
    page.click(f"#session-style-reset-{A}")
    saved = page.evaluate("(n) => window.sessionManager.saveSession(n)", "without-style")
    assert saved["status"] == "success", saved
    old = page.evaluate("""async () => (await (await fetch('/api/v1/sessions/load?name=without-style')).json()).sessionStyles""")
    assert old is None

    # closed: the set's default stays out
    loaded = page.evaluate("(n) => window.sessionManager.loadSession(n, {mode: 'add'})", "with-style")
    assert loaded["status"] == "success", loaded
    page.wait_for_timeout(800)
    assert not _note_shown(page, A)
    assert _settings(page, _new_plot(page))["fontSize"] == 12

    # open: it replaces the current one
    loaded = page.evaluate("(n) => window.sessionManager.loadSession(n, {mode: 'current'})", "with-style")
    assert loaded["status"] == "success", loaded
    for _ in range(100):
        ids = page.evaluate(TILES)
        if ids and all(page.evaluate(DRAWN.replace("(id) =>", "(id) =>"), i) for i in ids[:1]):
            break
        page.wait_for_timeout(300)
    page.wait_for_timeout(1500)
    first = page.evaluate(TILES)[0]
    assert _note_shown(page, first)
    assert _settings(page, _new_plot(page))["fontSize"] == 18

    # an older set without the field leaves the default as it is
    loaded = page.evaluate("(n) => window.sessionManager.loadSession(n, {mode: 'current'})", "without-style")
    assert loaded["status"] == "success", loaded
    page.wait_for_timeout(2500)
    assert _settings(page, _new_plot(page))["fontSize"] == 18

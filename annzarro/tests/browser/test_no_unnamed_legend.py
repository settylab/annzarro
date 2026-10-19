"""A plot coloured by nothing has no legend: no grey "trace 0", however it was drawn.

Reported: "the legend still shows a grey 'trace 0' if there is no colouring,
e.g. switching datasets where the colour does not exist and then changing a
spatial axis. It often goes away, e.g. on refresh."

Two stores, the committed 200-cell fixture twice: ``has`` with every column
and an extra ``obsm/X_alt``, ``lacks`` without ``obs/leiden``. A Cell Plot
coloured by a column ``lacks`` does not have, or by nothing, is one grey
trace. The update after an axis change applied the plot options, whose legend
step gave that unnamed trace a legend entry and turned the legend on; a full
draw (the refresh) did not. Each sequence below checks the drawn figure after
every step: every legend entry has a real name (not Plotly's "trace N"),
there is no legend without an entry, and the guard where figures reach Plotly
(utils/legend-entries.js) had nothing to remove.

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
from annzarro.tests.ui_helpers import open_dataset

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.zarr_compat import drop_consolidated, has_consolidated  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
FIXTURE = os.path.join(os.path.dirname(HERE), "data", "fixture_small.zarr")
PID = "cell-plot-S"
TILE = f'.tile[data-tile-id="{PID}"]'

COLOURS = {
    "obs": {"type": "obs", "key": "leiden", "column": ""},
    "obsm": {"type": "obsm", "key": "X_alt", "column": "0"},
    "none": {"type": "none", "key": "", "column": ""},
}


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _stores(data):
    """``has`` (the fixture, plus obsm/X_alt) and ``lacks`` (the fixture without obs/leiden)."""
    has, lacks = os.path.join(data, "has.zarr"), os.path.join(data, "lacks.zarr")
    for path in (has, lacks):
        shutil.copytree(FIXTURE, path)
        if has_consolidated(path):
            drop_consolidated(path)
    shutil.copytree(os.path.join(has, "obsm", "X_umap"), os.path.join(has, "obsm", "X_alt"))
    shutil.rmtree(os.path.join(lacks, "obs", "leiden"))
    return has, lacks


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    home = tmp_path_factory.mktemp("home")
    data = str(tmp_path_factory.mktemp("data"))
    has, lacks = _stores(data)
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", data, "--no-browser", "--auth-disabled"],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
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
    yield root, has, lacks
    proc.terminate()
    proc.wait(10)


def _link(root, store, colour):
    cfg = {"id": PID, "x": {"type": "obsm", "key": "X_umap", "column": "0"},
           "y": {"type": "obsm", "key": "X_umap", "column": "1"}, "z": None, "color": colour}
    view = {"v": 1, "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": PID, "controlsVisible": True}],
                               "controlState": {PID: True}, "panelConfigs": {PID: cfg}}}
    payload = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={payload}"


LEGEND = """() => {
  const gd = document.querySelector('%s .js-plotly-plot');
  const busy = [...document.querySelectorAll('.loading-overlay, .spinner-border')]
      .filter(e => e.offsetParent !== null).length;
  if (!gd || !gd._fullData || !gd._fullLayout) return {busy: busy + 1};
  const real = n => typeof n === 'string' && n !== '' && !/^trace \\d+$/.test(n);
  const entries = gd._fullData.filter(t => t.visible !== false && t.showlegend).map(t => t.name);
  return {
    busy,
    x: gd._fullLayout.xaxis && gd._fullLayout.xaxis.title ? gd._fullLayout.xaxis.title.text : null,
    showlegend: !!gd._fullLayout.showlegend,
    entries,
    unnamed: entries.filter(n => !real(n)),
    drawn: [...gd.querySelectorAll('.legend .traces .legendtext')].map(t => t.textContent),
    colours: [...new Set(gd._fullData.filter(t => t.x && t.x.length > 1)
        .map(t => typeof t.marker.color === 'string' ? t.marker.color : 'per-point'))]
  };
}""" % TILE


def _settle(page, before=None, timeout=40):
    """The legend state once nothing is loading and (when `before` is given) the x axis changed."""
    end = time.time() + timeout
    s = None
    while time.time() < end:
        s = page.evaluate(LEGEND)
        if not s["busy"] and (before is None or s.get("x") != before.get("x")):
            page.wait_for_timeout(600)
            s2 = page.evaluate(LEGEND)
            if not s2["busy"] and s2 == s:
                return s2
        page.wait_for_timeout(100)
    return s


def _no_unnamed_entry(s, step, warnings):
    assert s["unnamed"] == [], f"{step}: unnamed legend entries {s['unnamed']} (legend {s['drawn']})"
    assert not any(t == "" or t.startswith("trace ") for t in s["drawn"]), f"{step}: legend shows {s['drawn']}"
    if not s["entries"]:
        assert not s["showlegend"], f"{step}: a legend with no entry"
    assert warnings == [], f"{step}: the legend guard had to remove an entry: {warnings}"


def _axis(page, axis, key, column):
    page.select_option(f'{TILE} .axis-key-select[data-axis="{axis}"]', key)
    col = f'{TILE} .axis-column-select[data-axis="{axis}"]'
    page.wait_for_function("([sel, v]) => [...document.querySelector(sel).options].some(o => o.value === v)",
                           arg=[col, column], timeout=15000)
    page.select_option(col, column)


def _run(browser, url, steps):
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    warnings, errors = [], []
    page.on("console", lambda m: warnings.append(m.text) if m.text.startswith("Legend:") else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_selector(f"{TILE} .js-plotly-plot", timeout=30000)
    s = _settle(page)
    _no_unnamed_entry(s, "open", warnings)
    for name, step in steps:
        before = s
        step(page)
        s = _settle(page, before if name.startswith("x") else None)
        _no_unnamed_entry(s, name, warnings)
    assert errors == [], errors
    return s


def _x_column(c):
    return (f"x -> X_umap.{c}", lambda page: page.select_option(f'{TILE} .axis-column-select[data-axis="x"]', c))


@pytest.mark.parametrize("which", ["obs", "obsm"])
def test_switch_to_a_dataset_without_the_colour_then_change_an_axis(server, which):
    """The reported sequence: colour column gone after a switch, then a new field on x, and back.

    (No colour is not a case here: a switch gives an uncoloured plot the new dataset's default colour.)
    """
    root, has, lacks = server
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            s = _run(browser, _link(root, has, COLOURS[which]), [
                ("switch", lambda page: open_dataset(page, lacks)),
                _x_column("1"),
                _x_column("0"),
                ("y -> X_umap.0", lambda page: _axis(page, "y", "X_umap", "0")),
                ("3D", lambda page: page.click(f"#z-axis-toggle-{PID}")),
                ("2D", lambda page: page.click(f"#z-axis-toggle-{PID}")),
                _x_column("1"),
            ])
            assert s["colours"] == ["rgba(150, 150, 150, 1.)"], s
            assert s["entries"] == [] and not s["showlegend"], s
        finally:
            browser.close()


@pytest.mark.parametrize("which", COLOURS)
def test_open_without_the_colour_then_change_an_axis(server, which):
    """Landing on the dataset that lacks the colour (a link, a saved view), then an axis change."""
    root, has, lacks = server
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            s = _run(browser, _link(root, lacks, COLOURS[which]), [_x_column("1"), _x_column("0")])
            assert s["entries"] == [] and not s["showlegend"], s
        finally:
            browser.close()


def test_a_categorical_legend_survives_an_axis_change(server):
    """The legend of a colour that is there keeps its categories, named, through the same steps."""
    root, has, lacks = server
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            s = _run(browser, _link(root, has, COLOURS["obs"]), [_x_column("1"), _x_column("0")])
            assert s["showlegend"] and len(s["entries"]) > 1, s
            assert sorted(s["drawn"]) == sorted(s["entries"]), s
        finally:
            browser.close()

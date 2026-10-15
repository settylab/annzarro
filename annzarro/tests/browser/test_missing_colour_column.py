"""A colour column the dataset does not have draws grey points and says so, whatever reloaded the plot.

Two stores, the committed 200-cell fixture twice: ``has`` with every column,
``lacks`` without ``obs/leiden`` (and ``has`` with an extra ``obsm/X_alt``).
A Cell Plot coloured by a column ``lacks`` does not have must give the same
answer however it came to be drawn:

1. the dataset was switched from ``has`` to ``lacks``;
2. the subset was changed in the dialog;
3. a part was stepped;
4. the panel's Refresh was pressed;
5. a saved view of ``lacks`` was opened.

The answer is grey points (nothing coloured by a column that is not there),
the panel's notice "<column>: not in this dataset", and no error box in place
of the plot. In the regular plot and in large-plot mode (above 40 points, so
the 200-cell dataset and its 60-cell parts are large). The large-plot mode
used to throw on the missing column, so the whole plot became "Some data
could not be read" while the regular plot drew grey.

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
SUBSET = {"n": 60, "seed": 1, "part": 0}
GREY = "rgba(150, 150, 150, 1.)"

COLOURS = {
    "obs": ({"type": "obs", "key": "leiden", "column": ""}, "obs.leiden"),
    "obsm": ({"type": "obsm", "key": "X_alt", "column": "0"}, "obsm.X_alt.0"),
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
        # consolidated metadata would list what the edits below remove
        if has_consolidated(path):
            drop_consolidated(path)
    shutil.copytree(os.path.join(has, "obsm", "X_umap"), os.path.join(has, "obsm", "X_alt"))
    shutil.rmtree(os.path.join(lacks, "obs", "leiden"))
    return has, lacks


@pytest.fixture(scope="module", params=[5_000_000, 40], ids=["regular", "large-plot"])
def server(request, tmp_path_factory):
    home = tmp_path_factory.mktemp("home")
    data = str(tmp_path_factory.mktemp("data"))
    has, lacks = _stores(data)
    cfg = home / "large.yaml"
    cfg.write_text(f"ui:\n  defaults:\n    large_plot_points: {request.param}\n")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    # this checkout's package, not whatever "annzarro" is installed
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--config", str(cfg), "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", data, "--no-browser", "--auth-disabled"],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
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
    yield root, has, lacks, request.param < 50
    proc.terminate()
    proc.wait(10)


def _link(root, store, colour, subset=None):
    x = {"type": "obsm", "key": "X_umap", "column": "0"}
    y = {"type": "obsm", "key": "X_umap", "column": "1"}
    cfg = {"id": PID, "x": x, "y": y, "z": None, "color": colour}
    view = {"v": 1, "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": PID, "controlsVisible": True}],
                               "controlState": {PID: True}, "panelConfigs": {PID: cfg}}}
    if subset is not None:
        view["subset"] = subset
    payload = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={payload}"


STATE = """() => {
  const tile = document.querySelector('.tile[data-tile-id="cell-plot-S"]');
  const g = tile && tile.querySelector('.js-plotly-plot');
  const busy = [...document.querySelectorAll('.loading-overlay, .spinner-border')]
      .filter(e => e.offsetParent !== null).length;
  const ph = tile && tile.querySelector('.coverage-placeholder');
  const drawn = g && g._fullData ? g._fullData.filter(t => t.x && t.x.length && t.name !== 'Focused Cell'
      && !(t.x.length === 1 && t.x[0] === null)) : [];
  const strip = tile && tile.querySelector('.plot-status');
  return {
    busy: busy + (g && g._fullLayout || ph ? 0 : 1),
    dataset: g && g.layout ? g.layout.uirevision : null,
    points: drawn.reduce((s, t) => s + t.x.length, 0),
    colours: [...new Set(drawn.map(t => typeof t.marker.color === 'string' ? t.marker.color : 'per-point'))],
    placeholder: ph ? ph.innerText : null,
    notice: g && g.layout ? (g.layout.annotations || []).map(a => a.text).join(' | ') : null,
    severity: strip ? [...strip.classList].find(c => c.startsWith('plot-status--')) : null,
    large: !!(tile && tile.querySelector('.ps-tag[data-tag="large"]'))
  };
}"""


def _settle(page, before=None, timeout=40):
    """The state once it is no longer busy and (when `before` is given) differs from it."""
    end = time.time() + timeout
    s = None
    while time.time() < end:
        s = page.evaluate(STATE)
        if not s["busy"] and (before is None or s != before):
            page.wait_for_timeout(800)
            s2 = page.evaluate(STATE)
            if not s2["busy"] and s2 == s:
                return s2
        page.wait_for_timeout(100)
    return s


def _open(browser, url):
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    page.goto(url)
    page.wait_for_selector(f'.tile[data-tile-id="{PID}"]', timeout=30000)
    return page, _settle(page)


def _grey_with_notice(s, label, large):
    assert s["placeholder"] is None, f"the plot became an error box: {s['placeholder']!r}"
    assert s["points"] > 0, s
    assert s["colours"] == [GREY], s["colours"]
    assert f"{label}: not in this dataset" in (s["notice"] or ""), s["notice"]
    assert s["severity"] == "plot-status--warning", s["severity"]
    assert s["large"] == large, s


def _set_subset(page, n):
    page.click("#subset-button")
    page.wait_for_selector("#subset-n", state="attached")
    page.wait_for_timeout(500)
    if not page.is_checked("#subset-enabled"):
        page.click("#subset-enabled")
    if page.is_checked("#subset-n-all"):
        page.click("#subset-n-all")
    page.fill("#subset-n", str(n))
    page.click("#subset-apply")
    page.wait_for_selector("#subset-modal", state="hidden")
    page.wait_for_selector(".modal-backdrop", state="detached")


@pytest.mark.parametrize("which", COLOURS)
def test_dataset_switch(server, which):
    root, has, lacks, large = server
    colour, label = COLOURS[which]
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page, s = _open(browser, _link(root, has, colour, SUBSET))
            assert "not in this dataset" not in (s["notice"] or ""), s
            open_dataset(page, lacks)
            s = _settle(page, s)
            _grey_with_notice(s, label, large)
        finally:
            browser.close()


@pytest.mark.parametrize("which", COLOURS)
def test_subset_change_in_the_dialog(server, which):
    root, has, lacks, large = server
    colour, label = COLOURS[which]
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page, s = _open(browser, _link(root, has, colour, SUBSET))
            open_dataset(page, lacks)
            s = _settle(page, s)
            _grey_with_notice(s, label, large)
            _set_subset(page, 70)
            s = _settle(page, s)
            _grey_with_notice(s, label, large)
            assert "of 200 cells shown" in s["notice"], s["notice"]
        finally:
            browser.close()


@pytest.mark.parametrize("which", COLOURS)
def test_part_step(server, which):
    root, has, lacks, large = server
    colour, label = COLOURS[which]
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page, s = _open(browser, _link(root, lacks, colour, SUBSET))
            _grey_with_notice(s, label, large)
            assert "not in part 1 of" in s["notice"], s["notice"]
            page.click("#subset-part-next")
            s = _settle(page, s)
            _grey_with_notice(s, label, large)
            assert "not in part 2 of" in s["notice"], s["notice"]
        finally:
            browser.close()


@pytest.mark.parametrize("which", COLOURS)
def test_panel_refresh(server, which):
    root, has, lacks, large = server
    colour, label = COLOURS[which]
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page, s = _open(browser, _link(root, lacks, colour, SUBSET))
            _grey_with_notice(s, label, large)
            page.click(f"#refresh-plot-{PID}")
            page.wait_for_timeout(1500)
            s = _settle(page)
            _grey_with_notice(s, label, large)
        finally:
            browser.close()


@pytest.mark.parametrize("which", COLOURS)
def test_opening_a_saved_view(server, which):
    root, has, lacks, large = server
    colour, label = COLOURS[which]
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            _, s = _open(browser, _link(root, lacks, colour, SUBSET))
            _grey_with_notice(s, label, large)
            _, s = _open(browser, _link(root, lacks, colour))
            _grey_with_notice(s, label, large)
        finally:
            browser.close()


TOASTS = """() => {
  window.__toasts = [];
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) {
      if (n.classList && n.classList.contains('notification')) {
        window.__toasts.push((n.querySelector('.notification-title') || {}).textContent);
      }
    }
  }).observe(document, {subtree: true, childList: true});
}"""


@pytest.mark.parametrize("which", COLOURS)
def test_a_known_gap_asks_for_nothing_and_warns_once(server, which):
    """The structure says the column is missing: no request for it, no console error, one toast per switch.

    The toast is about the colour menu, which a switch rebuilds; a subset
    change or a part step does not rebuild it, so does not say it again.
    """
    root, has, lacks, large = server
    colour, label = COLOURS[which]
    needle = colour["key"]
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 900})
            page.add_init_script(f"({TOASTS})()")
            asked, errors = [], []
            page.on("request", lambda r: asked.append(r.url) if needle in urllib.parse.unquote(r.url) else None)
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.goto(_link(root, has, colour, SUBSET))
            page.wait_for_selector(f'.tile[data-tile-id="{PID}"]', timeout=30000)
            s = _settle(page)
            asked.clear()
            open_dataset(page, lacks)
            s = _settle(page, s)
            _grey_with_notice(s, label, large)
            _set_subset(page, 70)
            s = _settle(page, s)
            page.click("#subset-part-next")
            s = _settle(page, s)
            _grey_with_notice(s, label, large)
            assert asked == [], f"asked for a column the dataset does not have: {asked}"
            assert errors == [], errors
            toasts = [t for t in page.evaluate("window.__toasts") if t == "Plot source not found"]
            assert len(toasts) == 1, toasts
        finally:
            browser.close()

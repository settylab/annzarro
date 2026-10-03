"""Large-plot mode in a real browser: on and off with the cell subset.

The committed 200-cell fixture is served with ``ui.defaults.large_plot_points``
lowered to 100, so every cell is "large" and a 50-cell subset is not. One
headless Chromium session then:

1. opens a Cell Plot on the 50-cell subset: the regular plot, hover and click
   work (a click focuses the cell under the pointer), every control enabled;
2. turns the subset off in the subset dialog: large-plot mode, the panel's
   notice, hover off, the obsp axis/colour types, 3D, Hover picker and table
   filter disabled with the tooltip;
3. turns the subset on again: back to 1.;
4. opens a link colouring by an obsp row with every cell: no plot is drawn
   (the regular path would run out of memory at real sizes) and the panel says
   what is not available and the ways out.

Needs Playwright with Chromium (``pip install playwright && playwright install
chromium``); skipped otherwise.
"""
import base64
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

import pytest

playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(HERE), "data")
STORE = os.path.join(DATA_DIR, "fixture_small.zarr")
TOOLTIP = "Not available above 100 points (large-plot mode); turn on a subset to use it"


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
        pytest.skip("annzarro console script not found")
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


def _link(root, colour, subset):
    x = {"type": "obsm", "key": "X_umap", "column": "0"}
    y = {"type": "obsm", "key": "X_umap", "column": "1"}
    cfg = {"cell-plot-L": {"id": "cell-plot-L", "title": "t", "x": x, "y": y, "z": None, "color": colour,
                           "pointSize": 8, "pointOpacity": 1}}
    view = {"v": 1, "subset": subset,
            "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": "cell-plot-L", "controlsVisible": True}],
                       "controlState": {"cell-plot-L": True}, "panelConfigs": cfg}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={STORE}#view={enc}"


STATE = """() => {
  const tile = document.querySelector('.tile[data-tile-id="cell-plot-L"]');
  if (!tile) return {points: 0, busy: 1, notice: null, placeholder: null};
  const g = tile && tile.querySelector('.js-plotly-plot');
  const notice = tile && tile.querySelector('.mode-notice .coverage-notice__headline');
  const sel = (s) => tile.querySelector(s);
  const opt = (axis, v) => { const o = sel(`select.axis-type-select[data-axis="${axis}"] option[value="${v}"]`);
                             return o ? {disabled: o.disabled, title: o.getAttribute('title')} : null; };
  const ctl = (s) => { const e = sel(s); return e ? {disabled: e.disabled, title: e.getAttribute('title')} : null; };
  const busy = [...document.querySelectorAll('.loading-overlay, .spinner-border')]
      .filter(e => e.offsetParent !== null).length;
  const placeholder = tile && tile.querySelector('.coverage-placeholder');
  return {
    points: g && g._fullData ? g._fullData.filter(t => !/Focused/.test(t.name || ''))
        .reduce((s, t) => s + (t.x ? t.x.length : 0), 0) : 0,
    hovermode: g && g._fullLayout ? g._fullLayout.hovermode : null,
    notice: notice ? notice.textContent.trim() : null,
    placeholder: placeholder ? placeholder.textContent.replace(/\\s+/g, ' ').trim() : null,
    colorObsp: opt('color', 'obsp'), xObsp: opt('x', 'obsp'), colorObs: opt('color', 'obs'),
    colorLayer: opt('color', 'layer'),
    hover: ctl('select.hover-columns-select'), table: ctl('select.table-filter-select'),
    z: ctl('button[id^="z-axis-toggle-"]'), highlight: ctl('button[id^="highlight-focused-cell-"]'),
    // the highlight toggle reads as on only when it is drawn in Bootstrap's primary blue
    highlightOn: (() => { const b = sel('button[id^="highlight-focused-cell-"]');
                          return b ? getComputedStyle(b).backgroundColor === 'rgb(13, 110, 253)' : null; })(),
    zeroline: g && g._fullLayout && g._fullLayout.xaxis ? g._fullLayout.xaxis.zeroline : null, busy
  };
}"""


def _wait(page, pred, timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        s = page.evaluate(STATE)
        if pred(s):
            return s
        time.sleep(0.25)
    pytest.fail(f"timed out; last state {s}")


def _set_subset(page, on):
    page.click("#subset-button")
    page.wait_for_selector("#subset-enabled", state="visible")
    if page.is_checked("#subset-enabled") != on:
        page.click("#subset-enabled")
    if on:
        if page.is_checked("#subset-n-all"):
            page.click("#subset-n-all")
        page.fill("#subset-n", "50")
    page.click("#subset-apply")
    # the dialog's backdrop fades out; until then it takes the clicks
    page.wait_for_selector("#subset-modal", state="hidden")
    page.wait_for_selector(".modal-backdrop", state="detached")


def _assert_regular(page, s):
    assert s["points"] == 50
    assert s["notice"] is None
    assert s["hovermode"] == "closest"
    for c in ("colorObsp", "xObsp", "hover", "table", "z", "highlight"):
        assert s[c]["disabled"] is False, c
        assert s[c]["title"] != TOOLTIP, c
    assert s["highlightOn"] is True
    # click a point that is not the focused cell: the focus moves to a cell
    # under the pointer (overlapping points are stepped through, so which one
    # is not pinned)
    before = page.input_value("#focused-cell")
    box = page.evaluate("""(focused) => {
      const g = document.querySelector('.tile[data-tile-id="cell-plot-L"] .js-plotly-plot');
      const t = g._fullData.find(d => d.x && d.x.length && d.customdata), xa = g._fullLayout.xaxis, ya = g._fullLayout.yaxis;
      const i = t.customdata.findIndex(n => n !== focused);
      const r = g.querySelector('.nsewdrag').getBoundingClientRect();
      return {x: r.left + xa.l2p(t.x[i]), y: r.top + ya.l2p(t.y[i])};
    }""", before)
    page.mouse.move(box["x"], box["y"])
    time.sleep(0.3)
    page.mouse.click(box["x"], box["y"])
    try:
        page.wait_for_function("b => { const v = document.getElementById('focused-cell').value; return v && v !== b; }",
                               arg=before, timeout=10000)
    except Exception:
        dbg = page.evaluate("""() => { const g = document.querySelector('.tile[data-tile-id="cell-plot-L"] .js-plotly-plot');
          return {hover: (g._hoverdata || []).length, value: document.getElementById('focused-cell').value,
                  clickHandler: !!g.__azClickHandler, n: g._fullData.length}; }""")
        pytest.fail(f"click did not focus: before={before!r} box={box} {dbg}")


def _assert_large(s):
    assert s["points"] == 200
    assert s["notice"] == ("Large-plot mode (200 points): hover, click and table filters are off; "
                           "use a subset for them")
    assert s["hovermode"] is False
    for c in ("colorObsp", "xObsp", "hover", "table", "z", "highlight"):
        assert s[c] == {"disabled": True, "title": TOOLTIP}, c
    assert s["highlightOn"] is False
    for c in ("colorObs", "colorLayer"):
        assert s[c]["disabled"] is False, c


def test_subset_switches_large_plot_mode(server):
    """Also: both modes take the same axis layout (zero lines as the regular plot draws them)."""
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1300, "height": 900})
            colour = {"type": "obs", "key": "cell_type", "column": ""}
            page.goto(_link(server, colour, {"n": 50, "seed": 0}))
            _assert_regular(page, _wait(page, lambda s: s["points"] == 50 and not s["busy"]))

            regular_zeroline = page.evaluate(STATE)["zeroline"]
            _set_subset(page, False)
            large = _wait(page, lambda s: s["points"] == 200 and s["notice"] and not s["busy"])
            _assert_large(large)
            assert large["zeroline"] == regular_zeroline

            _set_subset(page, True)
            _assert_regular(page, _wait(page, lambda s: s["points"] == 50 and s["notice"] is None
                                        and not s["busy"]))
        finally:
            browser.close()


def test_unsupported_colour_is_refused_not_drawn(server):
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1300, "height": 900})
            colour = {"type": "obsp", "key": "distances", "column": ""}
            page.goto(_link(server, colour, None))
            s = _wait(page, lambda s: s["placeholder"] and "not available" in s["placeholder"])
            assert s["points"] == 0
            assert ("Colour by an obsp column is not available for 200 points: turn on a subset, "
                    "or choose an obs column or a gene") in s["placeholder"]
        finally:
            browser.close()

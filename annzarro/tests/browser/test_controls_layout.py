"""The plot controls fit their panel at every width, in every state.

The controls lay their groups out by the width of the panel (container
queries in styles.css, "Plot controls grid"), and controls come and go with
the colour type, 3D and large-plot mode. For each state below, opened from a
link on the committed 200-cell fixture, and each panel width from a 4-way
split on a laptop (320 px) to a full-width panel (1600 px), the controls block
must have:

- no horizontal overflow, and no control outside the block;
- no two visible controls on top of each other;
- no select whose shown value is cut short.

Then a numerical colour is switched to a constant colour in place: the Colour
group goes and leaves no empty area behind.

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
import urllib.request

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(HERE), "data")
STORE = os.path.join(DATA_DIR, "fixture_small.zarr")
WIDTHS = (320, 600, 1000, 1600)

X = {"type": "obsm", "key": "X_umap", "column": "0"}
Y = {"type": "obsm", "key": "X_umap", "column": "1"}
NUM = {"type": "obs", "key": "total_counts", "column": ""}
CAT = {"type": "obs", "key": "leiden", "column": ""}
# state: (panel id, panel config, served in large-plot mode)
STATES = {
    "numeric": ("cell-plot-L", {"x": X, "y": Y, "z": None, "color": NUM}, False),
    "categorical": ("cell-plot-L", {"x": X, "y": Y, "z": None, "color": CAT}, False),
    "3d": ("cell-plot-L", {"x": X, "y": Y, "z": NUM, "color": NUM}, False),
    "gene": ("gene-plot-L", {"z": None}, False),
    "large": ("cell-plot-L", {"x": X, "y": Y, "z": None, "color": NUM}, True),
}


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _start(home, config_text):
    cfg = home / "c.yaml"
    cfg.write_text(config_text)
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
            return proc, root
        except OSError:
            time.sleep(0.25)
    proc.kill()
    pytest.fail("server did not start")


@pytest.fixture(scope="module")
def servers(tmp_path_factory):
    """A regular server and one in large-plot mode (every fixture cell is 'large')."""
    procs, roots = [], {}
    for large, text in ((False, "ui: {}\n"), (True, "ui:\n  defaults:\n    large_plot_points: 100\n")):
        proc, root = _start(tmp_path_factory.mktemp("large" if large else "regular"), text)
        procs.append(proc)
        roots[large] = root
    yield roots
    for proc in procs:
        proc.terminate()
        proc.wait(10)


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as pw:
        b = pw.chromium.launch()
        yield b
        b.close()


def _link(root, pid, cfg):
    panel = dict(id=pid, title="t", pointSize=8, pointOpacity=1, **cfg)
    view = {"v": 1, "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": pid, "controlsVisible": True}],
                               "controlState": {pid: True}, "panelConfigs": {pid: panel}}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={STORE}#view={enc}"


FIT = """(pid) => {
  const block = document.querySelector(`.tile[data-tile-id="${pid}"] .plot-controls`);
  const box = block.getBoundingClientRect();
  const shown = (e) => { const s = getComputedStyle(e), r = e.getBoundingClientRect();
                         return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const name = (e) => e.id || e.className.split(' ').find(c => /select|ctl-label/.test(c)) || e.tagName;
  const leaves = [...block.querySelectorAll('select, input, button, label')].filter(shown);
  const rects = leaves.map(e => e.getBoundingClientRect());
  const outside = leaves.filter((e, i) => rects[i].left < box.left - 0.5 || rects[i].right > box.right + 0.5)
      .map(name);
  const overlaps = [];
  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const a = rects[i], b = rects[j];
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 1 && h > 1) overlaps.push(`${name(leaves[i])} / ${name(leaves[j])}`);
    }
  }
  const ctx = document.createElement('canvas').getContext('2d');
  const truncated = [...block.querySelectorAll('select:not([multiple])')].filter(shown).filter(e => {
    const s = getComputedStyle(e);
    ctx.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    const text = e.selectedOptions[0] ? e.selectedOptions[0].text : '';
    return ctx.measureText(text).width > e.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) + 1;
  }).map(e => `${name(e)}[${e.dataset.axis || ''}]="${e.selectedOptions[0].text}"`);
  return {overflow: block.scrollWidth > block.clientWidth + 1, outside, overlaps, truncated,
          height: Math.round(box.height)};
}"""


def _open(page, root, pid, cfg):
    page.goto(_link(root, pid, cfg))
    page.wait_for_selector(f'.tile[data-tile-id="{pid}"] .js-plotly-plot', timeout=30000)
    # the axis and colour selects are filled once the dataset structure is in
    page.wait_for_function(
        """(pid) => { const s = document.querySelector(`.tile[data-tile-id="${pid}"] .axis-key-select[data-axis="x"]`);
                      return s && !s.disabled && s.value; }""", arg=pid, timeout=30000)


@pytest.mark.parametrize("state", list(STATES))
def test_controls_fit_every_width(servers, browser, state):
    pid, cfg, large = STATES[state]
    page = browser.new_page(viewport={"width": WIDTHS[0], "height": 1100})
    try:
        _open(page, servers[large], pid, cfg)
        problems = {}
        for width in WIDTHS:
            page.set_viewport_size({"width": width, "height": 1100})
            page.wait_for_timeout(300)
            fit = page.evaluate(FIT, pid)
            bad = {k: v for k, v in fit.items() if k != "height" and v}
            if bad:
                problems[width] = bad
        assert not problems, f"{state}: {problems}"
    finally:
        page.close()


def test_constant_colour_leaves_no_hole(servers, browser):
    pid, cfg, _ = STATES["numeric"]
    page = browser.new_page(viewport={"width": 1000, "height": 1100})
    try:
        _open(page, servers[False], pid, cfg)
        tile = f'.tile[data-tile-id="{pid}"]'
        assert page.locator(f"{tile} .ctl-colour").is_visible()
        before = page.evaluate(FIT, pid)["height"]
        page.select_option(f'{tile} .axis-type-select[data-axis="color"]', "none")
        page.wait_for_function(
            f"""() => document.querySelector('{tile} .ctl-grid').classList.contains('ctl-no-colour')""",
            timeout=15000)
        assert not page.locator(f"{tile} .ctl-colour").is_visible()
        # the remaining groups close up: Axes and Points side by side, no empty column
        cols = page.evaluate(f"""() => getComputedStyle(document.querySelector('{tile} .ctl-grid'))
                                      .gridTemplateColumns.split(' ').length""")
        assert cols == 2
        fit = page.evaluate(FIT, pid)
        assert not (fit["overflow"] or fit["outside"] or fit["overlaps"] or fit["truncated"]), fit
        assert fit["height"] <= before
    finally:
        page.close()

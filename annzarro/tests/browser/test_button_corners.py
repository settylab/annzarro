"""Buttons round the corners that face no neighbouring button, and only those.

The rule, measured on the page rather than read from the markup: for every
visible ``.btn``, a side where another visible button touches it (a joined
group such as Save / Load / Share) has square corners, and a free side has
rounded ones; a button on its own is rounded all round.

The colour toolbar of a Cell Plot used to be a Bootstrap ``.btn-group`` of
separate, spaced buttons: Bootstrap rounds a group's ends by
``:first-child``/``:last-child``, and with the Log box last every toggle had
square right corners. A hidden button still counts as a group's first or last
child too, so the test also hides the ends of a joined group and checks that
the ends that show are rounded.

One headless Chromium session on the committed 200-cell fixture checks the
rule at 600 and 1600 px, for a numerical colour, after switching to a
categorical one (most toggles hidden) and back, with 3D on, and with the
header's Save / Load / Share group missing its last and then its first button.

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
PID = "cell-plot-L"
TILE = f'.tile[data-tile-id="{PID}"]'


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    home = tmp_path_factory.mktemp("home")
    cfg = home / "c.yaml"
    cfg.write_text("ui: {}\n")
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


def _link(root):
    x = {"type": "obsm", "key": "X_umap", "column": "0"}
    y = {"type": "obsm", "key": "X_umap", "column": "1"}
    colour = {"type": "obs", "key": "total_counts", "column": ""}
    cfg = {PID: {"id": PID, "title": "t", "x": x, "y": y, "z": None, "color": colour}}
    view = {"v": 1, "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": PID, "controlsVisible": True}],
                               "controlState": {PID: True}, "panelConfigs": cfg}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={STORE}#view={enc}"


# Every visible .btn on the page whose corners break the rule, as
# "id: neighbours [left, right] radii [tl, tr, br, bl]"; also how many were checked.
CORNERS = """() => {
  const shown = (e) => { const s = getComputedStyle(e), r = e.getBoundingClientRect();
                         return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const btns = [...document.querySelectorAll('.btn')].filter(shown);
  const rects = btns.map(b => b.getBoundingClientRect());
  const touches = (i, side) => rects.some((r, j) => j !== i
      && Math.min(r.bottom, rects[i].bottom) - Math.max(r.top, rects[i].top) > 2
      && (side === 'left' ? Math.abs(r.right - rects[i].left) <= 1.5 : Math.abs(r.left - rects[i].right) <= 1.5));
  const bad = [];
  btns.forEach((b, i) => {
    const s = getComputedStyle(b), px = (k) => parseFloat(s[k]);
    const left = touches(i, 'left'), right = touches(i, 'right');
    const radii = [px('borderTopLeftRadius'), px('borderTopRightRadius'),
                   px('borderBottomRightRadius'), px('borderBottomLeftRadius')];
    const ok = (joined, r) => (joined ? r === 0 : r > 0);
    if (!(ok(left, radii[0]) && ok(left, radii[3]) && ok(right, radii[1]) && ok(right, radii[2]))) {
      bad.push(`${b.id || b.className}: neighbours [${+left}, ${+right}] radii [${radii}]`);
    }
  });
  return {checked: btns.length, bad};
}"""


def _assert_corners(page, when):
    res = page.evaluate(CORNERS)
    assert res["checked"] > 10, when
    assert not res["bad"], f"{when}: {res['bad']}"


@pytest.mark.parametrize("width", [600, 1600])
def test_buttons_round_only_their_free_corners(server, width):
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": width, "height": 1000})
        try:
            page.goto(_link(server))
            page.wait_for_selector(f"#plot-container-{PID} .main-svg", timeout=30000)
            page.wait_for_function(f"""() => {{
                const b = document.querySelector('#log-color-{PID}');
                return b && getComputedStyle(b).display !== 'none'; }}""", timeout=30000)
            _assert_corners(page, "numerical colour")

            key = f'{TILE} .axis-key-select[data-axis="color"]'
            page.select_option(key, "leiden")
            page.wait_for_function(f"() => getComputedStyle(document.querySelector('#log-color-{PID}')).display === 'none'",
                                   timeout=15000)
            _assert_corners(page, "categorical colour")
            page.select_option(key, "total_counts")
            page.wait_for_function(f"() => getComputedStyle(document.querySelector('#log-color-{PID}')).display !== 'none'",
                                   timeout=15000)
            _assert_corners(page, "numerical colour again")

            page.click(f"#z-axis-toggle-{PID}")
            page.wait_for_selector(f"#z-axis-container-{PID}", state="visible", timeout=15000)
            _assert_corners(page, "3D on")

            # A joined group missing its last button, then its first: the ends that show round.
            share, save = "#btn-share-link", "#btn-save-session"
            page.evaluate(f"() => {{ document.querySelector('{share}').style.display = 'none'; }}")
            _assert_corners(page, "Share Link hidden")
            radius = page.evaluate("""() => getComputedStyle(document.querySelector('#btn-load-session'))
                                          .borderTopRightRadius""")
            assert radius not in ("0px", ""), radius
            page.evaluate(f"""() => {{ document.querySelector('{share}').style.display = '';
                                       document.querySelector('{save}').hidden = true; }}""")
            _assert_corners(page, "Save Panel Set hidden")
            page.evaluate(f"() => {{ document.querySelector('{save}').hidden = false; }}")
            _assert_corners(page, "all shown again")
        finally:
            browser.close()

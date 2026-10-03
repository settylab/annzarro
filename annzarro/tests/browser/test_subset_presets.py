"""The subset dialog's size presets in a real browser.

One headless Chromium session per test opens the committed 200-cell fixture
with a Cell Plot and opens the subset dialog:

1. the presets are the ladder for 200 cells (20, 50, 100) and "All", each
   with its parts; clicking 50 sets the size, Apply shows a 50-cell subset in
   4 parts, and the reopened dialog marks 50 as the current size. The plot
   drawn meanwhile has been timed, so the estimates say they come from this
   session;
2. a filter (cell_type is one of <a category>) changes the eligible count,
   and every preset's parts follow it without applying;
3. at 360 px the dialog fits the viewport with no horizontal scrolling.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import base64
import json
import math
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


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    home = tmp_path_factory.mktemp("home")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    # this checkout's package, not whatever "annzarro" is installed
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", DATA_DIR, "--no-browser", "--auth-disabled"],
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
    yield root
    proc.terminate()
    proc.wait(10)


def _link(root):
    plot = {"id": "cell-plot-a",
            "x": {"type": "obsm", "key": "X_umap", "column": "0"},
            "y": {"type": "obsm", "key": "X_umap", "column": "1"},
            "color": {"type": "none"}}
    hierarchy = [{"type": "tile", "id": "cell-plot-a", "controlsVisible": False}]
    view = {"v": 1, "subset": None,
            "layout": {"v": 1, "hierarchy": hierarchy, "panelConfigs": {"cell-plot-a": plot}}}
    payload = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={payload}"


CHIPS = """() => [...document.querySelectorAll('#subset-presets .subset-preset')].map(c => ({
    n: c.dataset.n ? Number(c.dataset.n) : null,
    label: c.querySelector('.sp-n').textContent.trim(),
    parts: c.querySelector('.sp-parts').textContent.trim(),
    time: c.querySelector('.sp-time').textContent.trim(),
    pressed: c.getAttribute('aria-pressed') === 'true' || c.classList.contains('active')
}))"""


def _open(page, root, width):
    page.set_viewport_size({"width": width, "height": 800})
    page.goto(_link(root))
    page.wait_for_selector('.tile[data-tile-id="cell-plot-a"] .js-plotly-plot', timeout=30000)
    page.click("#subset-button")
    page.wait_for_selector("#subset-presets button.subset-preset", state="visible")


@pytest.fixture
def page(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            yield page
            assert not errors, errors
        finally:
            browser.close()


def test_preset_applies_its_size(server, page):
    _open(page, server, 1400)
    chips = page.evaluate(CHIPS)
    assert [(c["label"], c["parts"]) for c in chips] == [
        ("20", "10 parts"), ("50", "4 parts"), ("100", "2 parts"), ("All", "200")], chips
    assert all(c["time"] for c in chips), chips
    # the plot behind the dialog was drawn and timed in this session
    page.wait_for_function("() => /this session/.test(document.getElementById('subset-estimate-note').textContent)")

    page.click('#subset-presets button[data-n="50"]')
    assert page.is_checked("#subset-enabled")
    assert not page.is_checked("#subset-n-all")
    assert page.input_value("#subset-n") == "50"
    assert page.inner_text("#subset-n-parts").startswith("4 parts")
    assert [c["n"] for c in page.evaluate(CHIPS) if c["pressed"]] == [50]
    # the preview is the server's answer for the same size
    page.wait_for_function("() => /^50 of 200 cells will be shown/.test("
                           "document.getElementById('subset-preview').textContent)")
    assert "part 1 of 4;" in page.inner_text("#subset-preview")
    # a size off the ladder selects no chip
    page.fill("#subset-n", "60")
    assert [c for c in page.evaluate(CHIPS) if c["pressed"]] == []
    assert page.inner_text("#subset-n-parts").startswith("4 parts")
    page.click('#subset-presets button[data-n="50"]')

    page.wait_for_function("() => !document.getElementById('subset-apply').disabled")
    page.click("#subset-apply")
    page.wait_for_selector("#subset-modal", state="hidden")
    page.wait_for_selector(".modal-backdrop", state="detached")
    page.wait_for_function("() => document.getElementById('subset-part-count').textContent === '4'",
                           timeout=30000)
    assert "50" in page.inner_text("#cell-count")

    page.click("#subset-button")
    page.wait_for_selector("#subset-presets button.subset-preset", state="visible")
    assert [c["n"] for c in page.evaluate(CHIPS) if c["pressed"]] == [50]

    # "All" is the #subset-n-all checkbox
    page.click("#subset-preset-all")
    assert page.is_checked("#subset-n-all")
    assert [c["label"] for c in page.evaluate(CHIPS) if c["pressed"]] == ["All"]


def test_parts_follow_the_filter(server, page):
    _open(page, server, 1400)
    page.click("#subset-presets button[data-n='50']")
    page.click("#subset-add-condition")
    row = page.locator("#subset-conditions .subset-condition").first
    row.locator(".subset-col").select_option("cell_type")
    row = page.locator("#subset-conditions .subset-condition").first
    page.wait_for_function(
        "() => document.querySelector('#subset-conditions datalist') "
        "&& document.querySelector('#subset-conditions datalist').options.length > 1")
    category = page.evaluate("() => document.querySelector('#subset-conditions datalist').options[0].value")
    row.locator(".subset-value").fill(category)
    page.wait_for_function("() => /pass the filter/.test(document.getElementById('subset-total').textContent)",
                           timeout=15000)
    eligible = int(page.inner_text("#subset-total").split(" of ")[0].replace(",", ""))
    assert 0 < eligible < 200
    chips = page.evaluate(CHIPS)
    sizes = [c["n"] for c in chips if c["n"]]
    assert sizes and max(sizes) < eligible, (eligible, sizes)
    for c in chips:
        if c["n"]:
            k = math.ceil(eligible / c["n"])
            assert c["parts"] == f"{k} part{'' if k == 1 else 's'}", (eligible, c)


def test_dialog_fits_a_phone(server, page):
    _open(page, server, 360)
    g = page.evaluate("""() => {
        const content = document.querySelector('#subset-modal .modal-content').getBoundingClientRect();
        const body = document.querySelector('#subset-modal .modal-body');
        const chips = [...document.querySelectorAll('#subset-presets .subset-preset')]
            .map(c => c.getBoundingClientRect());
        return {left: content.left, right: content.right, width: innerWidth,
                overflow: body.scrollWidth - body.clientWidth,
                chipsInside: chips.every(r => r.left >= content.left && r.right <= content.right),
                apply: document.getElementById('subset-apply').getBoundingClientRect().bottom <= innerHeight};
    }""")
    assert g["left"] >= 0 and g["right"] <= g["width"], g
    assert g["overflow"] <= 0, g
    assert g["chipsInside"] and g["apply"], g

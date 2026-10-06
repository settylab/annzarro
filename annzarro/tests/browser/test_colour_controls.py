"""The numerical colour controls say what they do, in the units the user thinks in.

One headless Chromium session per test opens the committed 200-cell fixture
coloured by a numeric column and checks:

- the Map picker labels which way each sequential map runs, the labels agree
  with the loaded Plotly's own scales, and the swatch beside the picker
  follows Reverse (static/js/utils/color-scales.js).

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import base64
import json
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
PID = "cell-plot-a"
TILE = f'.tile[data-tile-id="{PID}"] '


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(tmp_path_factory.mktemp("home")), ANNZARRO_HEADLESS="1",
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


def _link(root, color=None, **extra):
    plot = {"id": PID,
            "x": {"type": "obsm", "key": "X_umap", "column": "0"},
            "y": {"type": "obsm", "key": "X_umap", "column": "1"},
            "color": color or {"type": "obs", "key": "total_counts", "column": ""}, **extra}
    hierarchy = [{"type": "tile", "id": PID, "controlsVisible": True}]
    view = {"v": 1, "layout": {"v": 1, "hierarchy": hierarchy, "panelConfigs": {PID: plot}}}
    payload = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
    store = os.path.join(DATA_DIR, "fixture_small.zarr")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={payload}"


def _open(browser, url):
    page = browser.new_page(viewport={"width": 1400, "height": 1100})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_selector(TILE + ".js-plotly-plot", timeout=30000)
    page.wait_for_timeout(800)
    return page, errors


# Plotly's own stops for every map the picker offers, and the luminance of their ends
ENDS = """async (names) => {
    const out = {};
    for (const name of names) {
        const div = document.createElement('div');
        document.body.appendChild(div);
        await Plotly.newPlot(div, [{type: 'scatter', x: [0], y: [0], marker: {color: [0], colorscale: name}}]);
        const stops = div._fullData[0].marker.colorscale;
        Plotly.purge(div); div.remove();
        const rgb = c => c.startsWith('#') ? [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)) : c.match(/\\d+/g).map(Number);
        const lum = c => { const [r, g, b] = rgb(c); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
        out[name] = [lum(stops[0][1]), lum(stops[stops.length - 1][1])];
    }
    return out;
}"""


def test_map_picker_labels_the_direction(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page, errors = _open(browser, _link(server, colorScale="Blues"))
            options = page.evaluate(f"""() => Object.fromEntries([...document.querySelectorAll('#color-scale-{PID} option')]
                .map(o => [o.value, o.textContent.trim()]))""")
            assert options["Blues"] == "Blues (dark → light)"
            assert options["Reds"] == "Reds (light → dark)"
            assert options["Portland"] == "Portland" and options["RdBu"] == "RdBu"

            # every label agrees with the scale Plotly draws: a dark end is the darker one
            ends = page.evaluate(ENDS, list(options))
            for name, text in options.items():
                lo, hi = ends[name]
                if "dark → light" in text:
                    assert lo < hi, (name, lo, hi)
                elif "light → dark" in text:
                    assert lo > hi, (name, lo, hi)
                else:
                    # unlabelled: diverging or rainbow, neither end the pale one by a margin
                    assert name in {"Bluered", "RdBu", "Picnic", "Rainbow", "Portland", "Jet"}, name

            # the swatch shows the map as drawn; Reverse flips it, and its tooltip says so
            swatch = f"#color-scale-preview-{PID}"
            page.wait_for_function(f"() => getComputedStyle(document.querySelector('{swatch}')).backgroundImage.includes('gradient')")
            drawn = page.evaluate(f"() => getComputedStyle(document.querySelector('{swatch}')).backgroundImage")
            assert drawn.startswith("linear-gradient(to right, rgb(5, 10, 172) 0%"), drawn
            assert "now dark → light" in page.get_attribute(f"#reverse-colormap-{PID}", "title")
            page.click(f"#reverse-colormap-{PID}")
            page.wait_for_function(f"() => getComputedStyle(document.querySelector('{swatch}')).backgroundImage"
                                   ".startsWith('linear-gradient(to right, rgb(220, 220, 220) 0%')")
            assert "now light → dark" in page.get_attribute(f"#reverse-colormap-{PID}", "title")
            assert page.locator(swatch).is_visible()

            # a categorical colour has no map: no swatch
            page.select_option(TILE + 'select.axis-key-select[data-axis="color"]', "leiden")
            page.wait_for_timeout(1500)
            assert not page.locator(swatch).is_visible()
            assert not errors, errors
            page.close()
        finally:
            browser.close()

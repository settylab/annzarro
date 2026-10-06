"""The numerical colour controls say what they do, in the units the user thinks in.

One headless Chromium session per test opens the committed 200-cell fixture
coloured by a numeric column and checks:

- the Map picker labels which way each sequential map runs, the labels agree
  with the loaded Plotly's own scales, and the swatch beside the picker
  follows Reverse (static/js/utils/color-scales.js);
- under Log, Min and Max are data values (typing 5000 draws up to 5000, not
  10^5000), values with no log10 are explained, the colour bar has 1-2-5
  ticks, saved views store data values and links saved before (log10 under
  Log) open with the range they had, in both drawing paths;
- a recolour that waits on the server (a remote store: seconds) shows the
  panel's busy state until the new colours are drawn, and the legend keeps
  the old title until then.

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
PID = "cell-plot-a"
TILE = f'.tile[data-tile-id="{PID}"] '


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _serve(home, *extra):
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    # this checkout's package, not whatever "annzarro" is installed
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", DATA_DIR, "--no-browser", "--auth-disabled", *extra],
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
    return proc, root


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    proc, root = _serve(tmp_path_factory.mktemp("home"))
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def large_server(tmp_path_factory):
    """The same fixture drawn by the large-plot path (binned colour traces)."""
    home = tmp_path_factory.mktemp("home-large")
    cfg = home / "large.yaml"
    cfg.write_text("ui:\n  defaults:\n    large_plot_points: 100\n")
    proc, root = _serve(home, "--config", str(cfg))
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


LOG = {"type": "obs", "key": "total_counts", "column": "", "log": True}   # 103 .. 9950

# the trace carrying the colour bar, i.e. the points (one invisible point in large-plot mode)
BAR = f"""() => {{
    const gd = document.querySelector('.tile[data-tile-id="{PID}"] .js-plotly-plot');
    const t = gd.data.find(t => t.marker && t.marker.colorbar && Array.isArray(t.marker.color));
    const cb = t.marker.colorbar;
    return {{ cmin: t.marker.cmin, cmax: t.marker.cmax, tickvals: cb.tickvals || null, ticktext: cb.ticktext || null }};
}}"""


def _type(page, sel, value):
    page.fill(sel, str(value))
    page.locator(sel).dispatch_event("change")
    page.wait_for_timeout(600)


def _notices(page):
    return page.evaluate("() => [...document.querySelectorAll('.notification')].map(n => n.textContent.replace(/\\s+/g, ' '))")


def _saved(page):
    return page.evaluate("() => window.PanelManager.saveLayout().panelConfigs['%s']" % PID)


def test_log_limits_are_data_values(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page, errors = _open(browser, _link(server, color=LOG))
            lo, hi = math.log10(102.97683205853679), math.log10(9949.681746793087)
            bar = page.evaluate(BAR)
            assert (bar["cmin"], bar["cmax"]) == (pytest.approx(lo), pytest.approx(hi))
            assert page.input_value(f"#color-min-{PID}") == "103"
            assert page.input_value(f"#color-max-{PID}") == "9950"
            # 1-2-5 ticks in data units (whole decades gave one tick, 1000, and Plotly's log10 labels)
            assert bar["ticktext"] == ["200", "500", "1000", "2000", "5000"]
            assert [10 ** v for v in bar["tickvals"]] == [pytest.approx(float(t)) for t in bar["ticktext"]]

            # typed values are data values
            _type(page, f"#color-max-{PID}", 5000)
            bar = page.evaluate(BAR)
            assert bar["cmax"] == pytest.approx(math.log10(5000))
            assert page.input_value(f"#color-max-{PID}") == "5000"
            assert bar["ticktext"] == ["200", "500", "1000", "2000", "5000"]
            # what links and panel sets store: data values, marked as such
            cfg = _saved(page)
            assert (cfg["colorMax"], cfg["colorRangeUnits"]) == (5000, "data")
            assert cfg["colorMin"] == pytest.approx(102.97683205853679)

            # at or below 0 there is no log: Min starts at the floor, Max is refused, both say why
            _type(page, f"#color-min-{PID}", 0)
            assert page.evaluate(BAR)["cmin"] == pytest.approx(lo)
            assert page.input_value(f"#color-min-{PID}") == "103"
            assert any("at or below 0" in n and "floor" in n for n in _notices(page)), _notices(page)
            _type(page, f"#color-max-{PID}", -1)
            assert page.evaluate(BAR)["cmax"] == pytest.approx(math.log10(5000)), "Max unchanged"
            assert page.input_value(f"#color-max-{PID}") == "5000"
            assert any("Max must be above 0" in n for n in _notices(page)), _notices(page)

            # a locked range keeps its data values when Log goes off and on again
            page.click(f"#lock-range-{PID}")
            page.click(f"#log-color-{PID}")
            page.wait_for_timeout(1000)
            bar = page.evaluate(BAR)
            assert (bar["cmin"], bar["cmax"]) == (pytest.approx(102.97683205853679), pytest.approx(5000))
            assert page.input_value(f"#color-max-{PID}") == "5000"
            page.click(f"#log-color-{PID}")
            page.wait_for_timeout(1000)
            assert page.evaluate(BAR)["cmax"] == pytest.approx(math.log10(5000))
            assert page.input_value(f"#color-max-{PID}") == "5000"
            assert not errors, errors
            page.close()
        finally:
            browser.close()


@pytest.mark.parametrize("mode", ["regular", "large"])
def test_log_limits_in_old_and_new_links(request, mode):
    """A link saved before 0.4 stored log10 bounds under Log; it opens with the range it had."""
    root = request.getfixturevalue("server" if mode == "regular" else "large_server")
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            old = dict(color=LOG, colorMin=2.5, colorMax=3.5, lockColorRange=True)            # no marker: log10
            new = dict(color=LOG, colorMin=316.2277660168379, colorMax=3162.2776601683795,
                       lockColorRange=True, colorRangeUnits="data")
            for extra in (old, new):
                page, errors = _open(browser, _link(root, **extra))
                bar = page.evaluate(BAR)
                assert (bar["cmin"], bar["cmax"]) == (pytest.approx(2.5), pytest.approx(3.5)), (mode, extra)
                assert page.input_value(f"#color-min-{PID}") == "316"
                assert page.input_value(f"#color-max-{PID}") == "3162"
                assert bar["ticktext"] == ["500", "1000", "2000"], bar
                cfg = _saved(page)
                assert (cfg["colorMin"], cfg["colorMax"]) == (pytest.approx(316.2277660168379), pytest.approx(3162.2776601683795))
                assert cfg["colorRangeUnits"] == "data"
                assert not errors, errors
                page.close()
        finally:
            browser.close()


LEGEND = f"""() => {{
    const gd = document.querySelector('.tile[data-tile-id="{PID}"] .js-plotly-plot');
    const busy = [...gd.querySelectorAll('.loading-overlay')].filter(e => e.offsetParent !== null).length;
    return {{ title: (gd.layout.legend && gd.layout.legend.title && gd.layout.legend.title.text) || null,
              // the colour traces; the focused-cell highlight comes and goes on its own
              names: gd.data.map(t => t.name || '').filter(n => !n.startsWith('Focused')).join('|'), busy }};
}}"""


@pytest.mark.parametrize("slow", ["column", "category colours"])
def test_slow_recolour_shows_busy(server, slow):
    """A remote store answers in seconds; until the new colours are drawn the panel says it is busy."""
    delay_ms = 3000
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 1100})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            if slow == "column":
                def column(route):
                    page.wait_for_timeout(delay_ms)
                    route.continue_()
                page.route(lambda u: "/api/v1/data/obs" in u and "leiden" in u, column)
            else:
                # the store has uns.leiden_colors (the fixture has none); reading them is slow
                def structure(route):
                    body = route.fetch().json()
                    body.setdefault("uns", {}).setdefault("keys", []).append("leiden_colors")
                    route.fulfill(json=body)
                page.route("**/api/v1/data/dataset_structure*", structure)

                def colours(route):
                    page.wait_for_timeout(delay_ms)
                    route.fulfill(json={"data": ["#%02x%02x%02x" % (40 * i % 256, 90, 200 - 9 * i) for i in range(20)],
                                        "uns_key": "leiden_colors"})
                page.route("**/api/v1/data/uns/leiden_colors*", colours)
            page.goto(_link(server, color={"type": "obs", "key": "cell_type", "column": ""}))
            page.wait_for_selector(TILE + ".js-plotly-plot", timeout=30000)
            page.wait_for_function(f"() => !document.querySelector('.tile[data-tile-id=\"{PID}\"] .loading-overlay')")
            page.wait_for_timeout(500)
            before = page.evaluate(LEGEND)
            assert before["title"] == "cell_type" and not before["busy"], before

            page.select_option(TILE + 'select.axis-key-select[data-axis="color"]', "leiden")
            page.wait_for_timeout(delay_ms // 2)
            during = page.evaluate(LEGEND)
            assert during["busy"], f"no busy state while the {slow} loads: {during}"
            assert during["title"] == "cell_type" and during["names"] == before["names"], \
                ("the legend changed before the colours arrived", during)

            page.wait_for_function(f"""() => {{
                const gd = document.querySelector('.tile[data-tile-id="{PID}"] .js-plotly-plot');
                return gd.layout.legend && gd.layout.legend.title && gd.layout.legend.title.text === 'leiden'
                    && !gd.querySelector('.loading-overlay');
            }}""", timeout=15000)
            after = page.evaluate(LEGEND)
            assert after["names"] != before["names"] and not after["busy"], after
            assert not errors, errors
            page.close()
        finally:
            browser.close()


SIGNED = {"type": "obsm", "key": "X_umap", "column": "0"}   # about -3.9 .. 2.4: both signs

ORDER = f"""() => {{
    const gd = document.querySelector('.tile[data-tile-id="{PID}"] .js-plotly-plot');
    // large-plot mode: one single-colour trace per colour step, drawn in trace order
    const lum = c => {{ const m = c.match(/[\\d.]+/g).map(Number); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; }};
    const steps = gd.data.filter(t => t.meta === 'az-points' && typeof t.marker.color === 'string'
                                      && t.marker.color.startsWith('rgb'));
    if (steps.length) return {{ lums: steps.map(t => lum(t.marker.color)) }};
    const t = gd.data.find(t => t.marker && Array.isArray(t.marker.color) && t.marker.colorscale !== undefined);
    return {{ values: t.marker.color }};
}}"""


@pytest.mark.parametrize("mode", ["regular", "large"])
def test_strong_on_top_follows_a_sequential_map(request, mode):
    """Blues with Reverse (pale = low), Min 0.3 locked: values far below 0.3 are clamped to the pale end
    and are drawn underneath; the strong blue ones (high) are on top. |value| put them over the blue."""
    server = request.getfixturevalue("server" if mode == "regular" else "large_server")
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            # large-plot mode bins over [Min, Max]: a Min below 0 puts pale bins on both sides of 0,
            # where |bin centre| drew the palest ones (near Min) over the middle ones
            page, errors = _open(browser, _link(server, color=SIGNED, colorScale="Blues", colorReversed=True,
                                                colorMin=0.3 if mode == "regular" else -2, colorMax=2.4,
                                                lockColorRange=True))
            got = page.evaluate(ORDER)
            if mode == "regular":
                v = [x for x in got["values"] if x is not None]
                below = [i for i, x in enumerate(v) if x <= 0.3]
                above = [i for i, x in enumerate(v) if x > 0.3]
                assert below and above and max(below) < min(above), "pale (clamped) points first, strong blue last"
                assert [v[i] for i in above] == sorted(v[i] for i in above)
                assert min(v) < -1 and v.index(min(v)) < min(above), "the most negative value is underneath"
            else:
                lums = got["lums"]
                assert len(lums) > 2 and all(a >= b - 1e-9 for a, b in zip(lums, lums[1:])), lums
            assert not errors, errors
            page.close()
        finally:
            browser.close()


def test_strong_on_top_centred_is_unchanged(server):
    """Center at 0: still |value| ascending (the strongest of either sign on top)."""
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page, errors = _open(browser, _link(server, color=SIGNED, colorScale="RdBu", centeringActive=True))
            v = [x for x in page.evaluate(ORDER)["values"] if x is not None]
            assert [abs(x) for x in v] == sorted(abs(x) for x in v)
            page.click(f"#color-scale-{PID}")                    # a sequential map, still centred: |value|
            page.select_option(f"#color-scale-{PID}", "Blues")
            page.wait_for_timeout(1000)
            v = [x for x in page.evaluate(ORDER)["values"] if x is not None]
            assert [abs(x) for x in v] == sorted(abs(x) for x in v)
            assert not errors, errors
            page.close()
        finally:
            browser.close()

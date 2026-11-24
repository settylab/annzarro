"""The colour stops a pie's slices are coloured from (static/js/utils/color-scale-stops.js) are the stops the loaded Plotly
resolves for each named map, so a pie of bins reads the same map as a trace's colour scale and its colour bar.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.loading_helpers import start_server  # noqa: E402


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    root, proc, _data = start_server(tmp_path_factory)
    yield root
    proc.terminate()
    proc.wait(10)


CHECK = """async () => {
  const { PLOTLY_SCALE_STOPS } = await import('/static/js/utils/color-scale-stops.js');
  const { plotlyColorscale } = await import('/static/js/utils/color-scales.js');
  const maps = (await import('/static/js/config.js')).Config.DEFAULTS.COLOR_SCALES;
  const div = document.createElement('div');
  div.style.cssText = 'position:absolute;left:-9999px;width:40px;height:40px';
  document.body.appendChild(div);
  const bad = [];
  for (const name of maps) {
    if (!(name in PLOTLY_SCALE_STOPS) && typeof plotlyColorscale(name) === 'string') { bad.push(`${name}: no stops`); continue; }
    if (!(name in PLOTLY_SCALE_STOPS)) continue;   // Inferno, Magma and Plasma are explicit stops in color-scales.js
    await Plotly.newPlot(div, [{ type: 'scatter', x: [0], y: [0], marker: { color: [0], colorscale: plotlyColorscale(name) } }], { width: 40, height: 40 }, { staticPlot: true });
    const got = JSON.stringify(div._fullData[0].marker.colorscale);
    if (got !== JSON.stringify(PLOTLY_SCALE_STOPS[name])) bad.push(`${name}: ${got}`);
    Plotly.purge(div);
  }
  return { bad, checked: maps.length };
}"""


def test_every_named_map_has_plotlys_own_stops(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page()
            page.goto(server)
            page.wait_for_function("() => typeof Plotly !== 'undefined'", timeout=30000)
            out = page.evaluate(CHECK)
            assert out["checked"] >= 18 and out["bad"] == [], out
        finally:
            browser.close()

"""A count plot's density figures draw and export in the real Plotly bundle (V3, CNT-10, CNT-23).

panels/cell-count/draw-density.js makes the curve of a density (with a split), and the contours and the image of a 2D
density. Node tests read the figure; this opens each one in the bundled Plotly, checks that every trace is drawn by its
own module, that the axis titles and the legend reach the page, and that PNG and SVG export work. It also takes the light
and dark screenshots when ``ANNZARRO_V3_SHOTS`` names a folder.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os
import urllib.parse

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.loading_helpers import start_server  # noqa: E402


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    root, proc, data = start_server(tmp_path_factory)
    yield root, str(data / "fixture_small.zarr")
    proc.terminate()
    proc.wait(10)


BUILD = """async (shots) => {
  const M = await import('/static/js/utils/count-plot-model.js');
  const D = await import('/static/js/panels/cell-count/draw-density.js');
  const X = await import('/static/js/utils/plot-export.js');
  const T = await import('/static/js/utils/plot-theme.js');
  const norm = (c) => M.normalizeCountPlot({version: 1, ...c}).config;
  const obs = (key) => ({source: {type: 'obs', key}});
  const gauss = (x, m, s) => Math.exp(-0.5 * ((x - m) / s) ** 2);
  const axis = (bins, lo, hi, sigma, n) => ({levels: Array.from({length: bins}, (_, i) => 'bin:' + i), n_outside: [3, 4],
    edges: Array.from({length: bins + 1}, (_, i) => lo + (i * (hi - lo)) / bins), bins_made: bins, degenerate: false,
    density: {n, sigma, bandwidth: sigma * n ** -0.2, quantiles: [lo, hi], range: [lo, hi]}});
  const read = (axes, counts, n) => M.readGrid({reply: {n_shown: n, n_counted: n, axes}, counts, measures: null});
  const one = () => {
    const config = norm({mode: 'density', x: obs('score'), split: obs('kind')});
    const axes = [axis(512, -4, 8, 1.6, 4000), {levels: ['c:T cell', 'c:B cell'], n_outside: [0, 0]}];
    const counts = [];
    for (let i = 0; i < 512; i++) { const x = -4 + (i + 0.5) * (12 / 512); counts.push(Math.round(1500 * gauss(x, 0, 1)), Math.round(900 * gauss(x, 3, 1.4))); }
    return {config, table: M.countTable(config, read(axes, counts, 4000), [{input: 'x'}, {input: 'split'}])};
  };
  const two = () => {
    const config = norm({mode: 'density2d', x: obs('a'), y: obs('b')});
    const axes = [axis(256, -3, 3, 1, 5000), axis(256, -3, 3, 1, 5000)];
    const counts = [];
    for (let i = 0; i < 256; i++) for (let j = 0; j < 256; j++) {
      const x = -3 + (i + 0.5) * (6 / 256), y = -3 + (j + 0.5) * (6 / 256);
      counts.push(Math.round(30 * (gauss(x, -1, 0.6) * gauss(y, -1, 0.6) + gauss(x, 1.2, 0.5) * gauss(y, 0.8, 0.9))));
    }
    return {config, table: M.countTable(config, read(axes, counts, 5000), [{input: 'x'}, {input: 'y'}])};
  };
  const cases = {curve: [one(), {}], contours: [two(), {style: 'contours'}], image: [two(), {style: 'image'}]};
  const out = {};
  for (const theme of ['light', 'dark']) {
    for (const [name, [{config, table}, options]] of Object.entries(cases)) {
      const fig = D.densityFigure(config, table, {options, inputNames: {x: 'score', y: 'depth', split: 'kind'},
        palette: ['#1b9e77', '#d95f02', '#7570b3'], theme: T.PLOT_PALETTES[theme]});
      const div = document.createElement('div');
      div.style.width = '600px'; div.style.height = '400px'; div.style.position = 'fixed'; div.style.left = '0'; div.style.top = '0'; div.style.zIndex = '99999'; div.style.background = T.PLOT_PALETTES[theme].bgColor;
      document.body.appendChild(div);
      await Plotly.newPlot(div, fig.data, fig.layout);
      const png = await X.exportImageData(div, 'full', {format: 'png', width: 600, height: 400, scale: 1});
      const svgRaw = String(await X.exportImageData(div, 'full', {format: 'svg', width: 600, height: 400, scale: 1}));
      const svg = svgRaw.startsWith('data:') ? decodeURIComponent(svgRaw.slice(svgRaw.indexOf(',') + 1)) : svgRaw;
      out[theme + '/' + name] = {asked: [...new Set(fig.data.map((t) => t.type))].sort(),
        drawn: [...new Set(div._fullData.map((t) => t._module && t._module.name))].sort(),
        png: String(png).startsWith('data:image/png') && String(png).length > 500, svg: svg.includes('<svg'),
        svgText: svg.replace(/<[^>]+>/g, ' '), notes: fig.notes};
      if (shots) { div.id = 'shot-' + theme + '-' + name; div.style.visibility = 'hidden'; } else { Plotly.purge(div); div.remove(); }
    }
  }
  return out;
}"""


def test_every_density_figure_draws_and_exports(server):
    root, store = server
    shots = os.environ.get("ANNZARRO_V3_SHOTS")
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 900, "height": 700})
            problems = []
            page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
            page.on("console", lambda m: problems.append(f"{m.type}: {m.text}") if m.type in ("warning", "error") else None)
            page.goto(root + "/?dataset_path=" + urllib.parse.quote(store, safe="/"))
            page.wait_for_function("typeof Plotly !== 'undefined'")
            got = page.evaluate(BUILD, bool(shots))
            want = {"curve": ["scatter"], "contours": ["contour"], "image": ["heatmap"]}
            for theme in ("light", "dark"):
                for name, types in want.items():
                    g = got[f"{theme}/{name}"]
                    assert g["drawn"] == types, (theme, name, g["drawn"])
                    assert g["png"] and g["svg"], (theme, name)
                assert "score" in got[f"{theme}/curve"]["svgText"] and "T cell" in got[f"{theme}/curve"]["svgText"]
                assert "depth" in got[f"{theme}/contours"]["svgText"]
            assert got["light/curve"]["notes"]["range"].endswith("7 cells outside are not counted.")
            if shots:
                os.makedirs(shots, exist_ok=True)
                for key in got:
                    shot = page.locator("#shot-" + key.replace("/", "-"))
                    shot.evaluate("el => { el.style.visibility = 'visible'; }")
                    shot.screenshot(path=os.path.join(shots, key.replace("/", "-") + ".png"))
                    shot.evaluate("el => { el.style.visibility = 'hidden'; }")
            bad = [m for m in problems if "nrecognized" in m or m.startswith(("pageerror", "error"))]
            bad = [m for m in bad if "favicon" not in m and "GPU stall" not in m]
            assert not bad, bad
        finally:
            browser.close()

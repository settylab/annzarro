"""A count plot's figures draw and export in the real Plotly bundle (C3, CNT-23).

panels/cell-count/draw.js makes the figure of a bar, a histogram, a 2D histogram, a heatmap and a pie. Node tests read
the figure; this opens each one in the bundled Plotly, checks that every trace is drawn by its own module, that the
printed values and the colored legend reach the page, that PNG and SVG export work, and that the CSV is the table.

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


BUILD = """async () => {
  const M = await import('/static/js/utils/count-plot-model.js');
  const D = await import('/static/js/panels/cell-count/draw.js');
  const X = await import('/static/js/utils/plot-export.js');
  const T = await import('/static/js/utils/plot-theme.js');
  const norm = (c) => M.normalizeCountPlot({version: 1, ...c}).config;
  const obs = (key, extra = {}) => ({source: {type: 'obs', key}, ...extra});
  const contract = ({counts, measure, ...r}) => ({reply: {n_shown: r.n_counted, ...r, axes: r.axes.map((a) => {
    const bins = a.levels.filter((id) => id.startsWith('bin:')).length;
    return {n_outside: [0, 0], ...(bins ? {edges: Array.from({length: bins + 1}, (_, k) => k * 10), bins_made: bins, degenerate: false} : {}), ...a};
  })}, counts, measures: measure || null});
  const make = (config, reply, inputs) => ({config, table: M.countTable(config, M.readGrid(contract(reply)), inputs.map((input) => ({input})))});
  const words = {count: 'Cell count', fill: 'Fill', hoverCount: 'Cells', hoverShare: 'Share', share: () => 'Share',
                 measure: () => 'Measure', topLevel: () => 'Top level'};
  const opts = (options) => ({options, words, inputNames: {x: 'kind', y: 'row', split: 'row', factor: 'f'},
    palette: ['#1b9e77', '#d95f02', '#7570b3'], theme: T.PLOT_PALETTES.light});
  const cases = {
    bar: make(norm({mode: 'bar', x: obs('k'), split: obs('s')}), {axes: [{levels: ['c:a', 'c:b']}, {levels: ['c:p', 'c:q']}], counts: [3, 4, 5, 6], n_counted: 18}, ['x', 'split']),
    histogram: make(norm({mode: 'histogram', x: obs('d', {binning: {method: 'equal_width', bins: 3}})}), {axes: [{levels: ['bin:0', 'bin:1', 'bin:2']}], counts: [3, 9, 4], n_counted: 16}, ['x']),
    hist2d: make(norm({mode: 'hist2d', x: obs('d', {binning: {method: 'equal_width', bins: 3}}), y: obs('e', {binning: {method: 'equal_width', bins: 2}})}),
                 {axes: [{levels: ['bin:0', 'bin:1', 'bin:2']}, {levels: ['bin:0', 'bin:1']}], counts: [1, 0, 2, 3, 4, 5], n_counted: 15}, ['x', 'y']),
    heatmap: make(norm({mode: 'heatmap', x: obs('a'), y: obs('b'), value: {kind: 'top_level', factor: obs('f')}}),
                  {axes: [{levels: ['c:p', 'c:q']}, {levels: ['c:u', 'c:v']}, {levels: ['c:A', 'c:B']}], counts: [3, 1, 1, 1, 0, 4, 2, 2], n_counted: 14}, ['x', 'y', 'factor']),
    pie: make(norm({mode: 'pie', x: obs('k')}), {axes: [{levels: ['c:a', 'c:b', 'c:c']}], counts: [30, 10, 60], n_counted: 100}, ['x']),
  };
  const out = {};
  for (const [name, {config, table}] of Object.entries(cases)) {
    const fig = D.countFigure(config, table, opts({labels: 'count', fade: true}));
    const div = document.createElement('div');
    div.style.width = '600px'; div.style.height = '400px';
    document.body.appendChild(div);
    await Plotly.newPlot(div, fig.data, fig.layout);
    const png = await X.exportImageData(div, 'full', {format: 'png', width: 600, height: 400, scale: 1});
    const svgRaw = String(await X.exportImageData(div, 'full', {format: 'svg', width: 600, height: 400, scale: 1}));
    const svg = svgRaw.startsWith('data:') ? decodeURIComponent(svgRaw.slice(svgRaw.indexOf(',') + 1)) : svgRaw;
    out[name] = {asked: [...new Set(fig.data.map((t) => t.type))].sort(), drawn: [...new Set(div._fullData.map((t) => t._module && t._module.name))].sort(),
                 png: String(png).startsWith('data:image/png') && String(png).length > 500,
                 svg: svg.includes('<svg'), svgText: svg.replace(/<[^>]+>/g, ' '),
                 pageText: div.textContent};
    Plotly.purge(div); div.remove();
  }
  const bar = cases.bar;
  out.csv = D.countCsv(bar.config, bar.table, {inputNames: {x: 'kind', split: 'row'}, headers: {count: 'Cells', share: 'Share'}});
  return out;
}"""


def test_every_count_figure_draws_and_exports(server):
    root, store = server
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 900, "height": 700})
            problems = []
            page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
            page.on("console", lambda m: problems.append(f"{m.type}: {m.text}") if m.type in ("warning", "error") else None)
            page.goto(root + "/?dataset_path=" + urllib.parse.quote(store, safe="/"))
            page.wait_for_function("typeof Plotly !== 'undefined'")
            got = page.evaluate(BUILD)
            want = {"bar": ["bar"], "histogram": ["bar"], "hist2d": ["heatmap"], "heatmap": ["heatmap", "scatter"], "pie": ["pie"]}
            for name, types in want.items():
                g = got[name]
                assert g["drawn"] == types, (name, g["drawn"])
                assert g["png"] and g["svg"], name
            for value in ("6", "9", "30", "60"):
                assert value in got["bar"]["svgText"] + got["histogram"]["svgText"] + got["pie"]["svgText"], value
            assert "5" in got["hist2d"]["svgText"].split() and "4" in got["hist2d"]["svgText"].split()
            assert " A " in got["heatmap"]["svgText"] and " B " in got["heatmap"]["svgText"]
            lines = got["csv"].split("\n")
            assert lines[0] == "kind,row,Cells,Share"
            assert len(lines) == 5 and lines[1].startswith("a,p,3,")
            bad = [m for m in problems if "nrecognized" in m or m.startswith(("pageerror", "error"))]
            bad = [m for m in bad if "favicon" not in m and "GPU stall" not in m]
            assert not bad, bad
        finally:
            browser.close()

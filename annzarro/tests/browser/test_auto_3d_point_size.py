"""The automatic dot size of a 3D plot is 0.6 of the 2D curve's value.

A new 3D Cell Plot (z on an obs column) draws scatter3d markers at that size; a
link that names a size keeps it. Needs Playwright with Chromium; skipped
otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import pytest

from annzarro.tests.browser.test_default_equal_aspect import (  # noqa: F401  (server is a fixture)
    ABSENT, EMB, OBS, _app, _link, _run, server, playwright)

Z = OBS("total_counts")
MARKERS = """async () => {
  const gd = document.querySelector('.tile .js-plotly-plot');
  const { autoPointStyle, REF_AREA } = await import('/static/js/utils/point-style.js');
  const { plotArea } = await import('/static/js/utils/view-point-style.js');
  const { pointStyleBase } = await import('/static/js/panels/plot-utilities/plot-make.js');
  const all = gd.data.filter(t => t.type === 'scatter3d' && t.x && t.x.length && t.marker);
  const traces = all.filter(t => t.x.length > 1);      // not the one-point focus markers
  const n = traces.reduce((s, t) => s + t.x.length, 0);
  const area = plotArea(gd);
  return {types: gd.data.map(t => t.type), sizes: [...new Set(traces.map(t => t.marker.size))], n,
          want3D: autoPointStyle(n, pointStyleBase(), true, area).size,
          want2D: autoPointStyle(n, pointStyleBase(), false, area).size};
}"""


def _markers(page):
    page.wait_for_selector(".tile .js-plotly-plot", timeout=60000)
    for _ in range(100):
        page.wait_for_timeout(300)
        m = page.evaluate(MARKERS)
        if m["n"]:
            # the first fit and its redraw end with no event of their own to wait for
            page.wait_for_timeout(1500)
            return page.evaluate(MARKERS)
    pytest.fail("no 3D markers were drawn")


def test_a_new_3d_plot_draws_the_reduced_automatic_size(server):
    def body(page):
        page.goto(_link(server, "umap", x=EMB("X_umap", "0"), y=EMB("X_umap", "1"), z=Z, equalAspect=False,
                          pointSize=ABSENT, pointOpacity=ABSENT))
        m = _markers(page)
        assert m["sizes"] == [m["want3D"]], m
        assert m["want3D"] < m["want2D"], m
        assert abs(m["want3D"] - 0.6 * m["want2D"]) <= 0.25, m   # the 2D size is snapped to scattergl steps
    _run(server, body)


def test_a_link_with_a_size_keeps_it_in_3d(server):
    def body(page):
        page.goto(_link(server, "umap", x=EMB("X_umap", "0"), y=EMB("X_umap", "1"), z=Z, equalAspect=False, pointSize=7))
        assert _markers(page)["sizes"] == [7], "the size the link names is not scaled"
    _run(server, body)

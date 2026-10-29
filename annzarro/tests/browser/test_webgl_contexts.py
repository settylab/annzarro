"""A 2D plot holds one WebGL context, a 3D plot one.

Safari allows about 16 live WebGL contexts and keeps a released one in its count until it is
garbage-collected, so every context a graph does not need is headroom for the other plots.
plotly.js makes a regl (a context) for its focus layer too, which only selection drawing uses;
AnnZarro has no selection, and scripts/plotly/patch-source.js leaves that layer without one.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import pytest

from annzarro.tests.browser.test_memory_guard import _serve  # noqa: E402
from annzarro.tests.browser.test_plot_options import A, _cfgs, page, server  # noqa: F401
from annzarro.tests.browser.test_url_history_layout import _drawn, _tile, _view_link

COUNT = """() => { const a = window.__gl.length; const gd = document.querySelector('.js-plotly-plot');
  let live = 0; if (gd && gd._fullLayout && gd._fullLayout._glcanvas) gd._fullLayout._glcanvas.each(d => { if (d && d.regl && !d.regl._gl.isContextLost()) live++; });
  return { created: a, live }; }"""
HOOK = """(() => { window.__gl = []; const g = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t) { const r = g.apply(this, arguments);
    if (/webgl/.test(t) && !this.__seen) { this.__seen = 1; window.__gl.push(this.className || 'canvas'); } return r; }; })()"""


@pytest.fixture(scope="module")
def large_server(tmp_path_factory):
    root, proc = _serve(tmp_path_factory, "ui:\n  defaults:\n    large_plot_points: 100\n")
    yield root
    proc.terminate()
    proc.wait(10)


def _open(page, root, z=None):
    page.add_init_script(HOOK)
    cfg = {**_cfgs()[A], "z": z}
    page.goto(_view_link(root, [_tile(A)], {A: cfg}))
    _drawn(page, A)
    page.wait_for_timeout(2500)
    return page.evaluate(COUNT)


def test_a_2d_plot_creates_one_webgl_context(page, server):
    c = _open(page, server)
    assert c["created"] == 1, c
    assert c["live"] == 1, c
    # drawn: the context layer holds the points
    assert page.evaluate("() => document.querySelector('.js-plotly-plot').data.some(t => t.type === 'scattergl')")


def test_a_2d_plot_in_large_mode_creates_one_webgl_context(page, large_server):
    c = _open(page, large_server)
    assert c["created"] == 1 and c["live"] == 1, c


def test_a_3d_plot_creates_one_webgl_context(page, server):
    c = _open(page, server, z={"type": "obs", "key": "total_counts", "column": ""})
    assert c["created"] == 1, c

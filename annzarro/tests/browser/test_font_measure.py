"""Plots measure their text when they are drawn (tick label room, legend columns, label room), so they must measure with the font
they will show. The bundled Open Sans (static/css/fonts.css) loads a moment after the page starts; the app waits for it before it
starts (main.js), so a plot drawn at once and one drawn after a slow font have the same layout.

The font file is held back with page.route; the layout of each kind is compared with the layout of a normal load.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os
import threading
import time

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_cell_gene_panel import served, page, _url, _plot, _sig, P, S1, GENES  # noqa: E402,F401
from annzarro.tests.browser.test_cell_gene_plot_options import _configs, CP, _drawn  # noqa: E402
from annzarro.tests.browser.test_cell_count_panel import CELL_TYPE, CONDITION  # noqa: E402
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

CC = "cell-count-A"
TILES = [CP, P, CC]
FONT = "**/OpenSans-latin-greek.woff2*"


def _config():
    configs = _configs("cell-plot", styleDefault=True)[0]
    configs[P] = _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=[{"source": S1, "rows": "genes"}], styleDefault=True)
    configs[S1] = _sig(S1, "Markers", GENES[:4])
    configs[CC] = {"id": CC, "title": "Count 1", "version": 1, "mode": "bar", "x": CONDITION, "split": CELL_TYPE}
    return configs


def _ready(page):
    _drawn(page, CP)
    until(page, "(id) => { const e = document.querySelector(`.tile[data-tile-id='${id}'] .cgene-panel`); return e && e.dataset.state === 'ready'; }", P, timeout=60)
    until(page, "(id) => { const r = document.querySelector(`.tile[data-tile-id='${id}'] .ccnt-panel`); return r && r.dataset.state === 'ready'; }", CC, timeout=60)
    page.evaluate("() => document.fonts.ready")


LAYOUT = """(ids) => Object.fromEntries(ids.map((id) => { const gd = document.querySelector(`.tile[data-tile-id="${id}"] .js-plotly-plot`);
    const L = gd._fullLayout; const s = L._size;
    return [id, { size: [s.l, s.r, s.t, s.b, s.w, s.h].map((v) => Math.round(v * 100) / 100), xdomain: L.xaxis ? L.xaxis.domain.map((v) => Math.round(v * 1e5) / 1e5) : null,
                  legend: (L.legend && L.legend.x) ?? null, family: L.font.family }]; })) """


def _layouts(page, served, delay=0.0, record=None):
    def slow(route):
        if record is not None:
            record.append(time.time())
        threading.Event().wait(delay)      # the font file is held back, on purpose
        route.continue_()
    if delay:
        page.route(FONT, slow)
    page.set_viewport_size({"width": 1500, "height": 1100})
    page.goto(_url(served, TILES + [S1][:0], _config()))
    _ready(page)
    got = page.evaluate(LAYOUT, TILES)
    page.unroute(FONT) if delay else None
    return got


def test_a_slow_font_does_not_change_the_layout(page, served):
    normal = _layouts(page, served)
    assert normal[CC]["family"].startswith('"Open Sans"')
    page.goto("about:blank")
    asked = []
    slow = _layouts(page, served, delay=1.5, record=asked)
    assert asked, "the font file was not asked for (the route did not hold it back)"
    assert slow == normal, {"normal": normal, "slow font": slow}
    assert page.evaluate("() => document.fonts.check('12px \"Open Sans\"')")

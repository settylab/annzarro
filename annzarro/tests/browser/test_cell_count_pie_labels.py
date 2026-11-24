"""A pie's numbers sit at one radius (operator, 0.8.0), in a real browser: every slice's number, the dominant slice's
included, is the same distance from the pie's centre (to 1 px), and Ring moves none of them. Measured on the drawn
page, from the bounding boxes Plotly made, before and after Ring, and after a resize.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import test_cell_count_panel as cc  # noqa: E402
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

served = cc.served
page = cc.page
CC, S = cc.CC, cc.S

# the pie's centre (its slices' box: a whole circle) and each printed number's place, in page pixels
MEASURE = """(s) => {
    const plot = document.querySelector(s + ' .ccnt-plot');
    const pie = plot.querySelector('.pielayer .trace').getBoundingClientRect();
    const cx = pie.left + pie.width / 2, cy = pie.top + pie.height / 2;
    // each number's place on the page: the middle of its box (an annotation is centred on its point; before 0.8.0,
    // Plotly's own slice text)
    const at = (t) => { const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    const texts = [...plot.querySelectorAll('.annotation-text-g text, .slicetext text')].filter((t) => t.textContent.trim())
        .map((t) => { const p = at(t); return { text: t.textContent, d: Math.hypot(p.x - cx, p.y - cy) }; });
    return { radius: pie.width / 2, texts };
}"""


def _measure(page):
    until(page, "(s) => [...document.querySelectorAll(s + ' .ccnt-plot .annotation-text-g text, ' + s + ' .ccnt-plot .slicetext')].some(t => t.textContent.trim())", S)
    return page.evaluate(MEASURE, S)


def _shot(page, name):
    folder = os.environ.get("ANNZARRO_SHOTS")
    if folder:
        os.makedirs(folder, exist_ok=True)
        page.locator(S).screenshot(path=os.path.join(folder, name))


def test_every_number_is_at_one_radius_and_ring_moves_none(page, served):
    # cell_type: B cell is the dominant slice (500 of 1,200)
    cc._open(page, served, {CC: cc._count(mode="pie", x={"source": {"type": "obs", "key": "cell_type"}}, labels="count")})
    cc._drawn(page, "pie")
    full = _measure(page)
    assert len(full["texts"]) >= 4, full
    # one radius for every number, to 1 px (Plotly places an annotation's box on whole pixels)
    assert all(abs(t["d"] - 0.75 * full["radius"]) <= 1 for t in full["texts"]), f"one radius for every number: {full['texts']}"
    _shot(page, "count-pie-labels.png")
    page.check(f"{S} .ccnt-ring")
    cc._drawn(page, "pie", "c.ring === true")
    ring = _measure(page)
    assert [t["text"] for t in ring["texts"]] == [t["text"] for t in full["texts"]]
    for a, b in zip(full["texts"], ring["texts"]):
        assert abs(a["d"] - b["d"]) <= 1, f"Ring moved {a['text']}: {a['d']:.1f} px, then {b['d']:.1f} px"
    assert all(abs(t["d"] - 0.75 * ring["radius"]) <= 1 for t in ring["texts"]), "the middle of the ring's band"
    _shot(page, "count-pie-labels-ring.png")
    # a resize keeps them together
    page.set_viewport_size({"width": 700, "height": 1000})
    until(page, "([s, r]) => Math.abs(document.querySelector(s + ' .ccnt-plot .pielayer .trace').getBoundingClientRect().width / 2 - r) > 2", [S, ring["radius"]])
    resized = _measure(page)
    assert all(abs(t["d"] - 0.75 * resized["radius"]) <= 1 for t in resized["texts"]), resized

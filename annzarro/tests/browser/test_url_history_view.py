"""Zoom, pan and the 3D camera are part of the view: one history entry per gesture, a step that
moves only the view is one relayout.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import pytest

from annzarro.tests.browser.test_memory_guard import _serve  # noqa: E402
from annzarro.tests.browser.test_plot_options import A, B, _cfgs, page, server  # noqa: F401
from annzarro.tests.browser.test_url_history import LENGTH, SETTLE_MS
from annzarro.tests.browser.test_url_history_layout import _drawn, _log_requests, _mark, _marked, _tile, _view_link

GD = f"document.querySelector(\".tile[data-tile-id='{A}'] .js-plotly-plot\")"
RANGES = f"""() => {{ const l = {GD}._fullLayout; return {{ x: l.xaxis.range.map(v => Math.round(v * 1e3) / 1e3), y: l.yaxis.range.map(v => Math.round(v * 1e3) / 1e3),
  auto: !!(l.xaxis.autorange || l.yaxis.autorange) }}; }}"""
DRAG = f"""() => {{ const r = {GD}.querySelector('.nsewdrag').getBoundingClientRect(); return {{ x: r.x, y: r.y, w: r.width, h: r.height }}; }}"""


def _start(page, server, cfgs=None, tiles=None):
    page.goto(_view_link(server, tiles or [_tile(A)], cfgs or {A: _cfgs()[A]}))
    _drawn(page, A)
    page.wait_for_timeout(SETTLE_MS)
    _mark(page, A)
    return page.evaluate(LENGTH)


def _gesture(page, dx0, dy0, dx1, dy1, mode="zoom"):
    """A drag over the plot area from (dx0, dy0) to (dx1, dy1), as fractions of it."""
    page.evaluate(f"(m) => window.Plotly.relayout({GD}, {{ dragmode: m }})", mode)
    r = page.evaluate(DRAG)
    page.mouse.move(r["x"] + r["w"] * dx0, r["y"] + r["h"] * dy0)
    page.mouse.down()
    page.mouse.move(r["x"] + r["w"] * dx1, r["y"] + r["h"] * dy1, steps=6)
    page.mouse.up()
    page.wait_for_timeout(SETTLE_MS)


def _same(a, b):
    return all(abs(p - q) < 2e-3 for k in ("x", "y") for p, q in zip(a[k], b[k]))


def test_zoom_then_back_and_forward_restore_the_ranges_exactly(page, server):
    base = _start(page, server)
    fitted = page.evaluate(RANGES)
    assert fitted["auto"]
    _gesture(page, 0.2, 0.2, 0.6, 0.6)
    zoomed = page.evaluate(RANGES)
    assert not zoomed["auto"] and zoomed["x"][1] - zoomed["x"][0] < fitted["x"][1] - fitted["x"][0]
    assert page.evaluate(LENGTH) == base + 1
    seen = _log_requests(page)
    page.go_back()
    page.wait_for_function(f"() => !!({GD}._fullLayout.xaxis.autorange)", timeout=30000)
    assert _same(page.evaluate(RANGES), fitted)
    assert _marked(page, A) == "mine"
    page.go_forward()
    page.wait_for_function(f"() => !{GD}._fullLayout.xaxis.autorange", timeout=30000)
    page.wait_for_timeout(500)
    assert _same(page.evaluate(RANGES), zoomed)
    assert _marked(page, A) == "mine"
    assert not seen, seen
    page.wait_for_timeout(SETTLE_MS)
    assert page.evaluate(LENGTH) == base + 1


def test_pan_back_forward(page, server):
    base = _start(page, server)
    _gesture(page, 0.3, 0.3, 0.6, 0.5, mode="zoom")
    zoomed = page.evaluate(RANGES)
    _gesture(page, 0.5, 0.5, 0.35, 0.6, mode="pan")
    panned = page.evaluate(RANGES)
    assert not _same(panned, zoomed)
    assert page.evaluate(LENGTH) == base + 2
    page.go_back()
    page.wait_for_function(f"(z) => Math.abs({GD}._fullLayout.xaxis.range[0] - z) < 2e-3", arg=zoomed["x"][0], timeout=30000)
    assert _same(page.evaluate(RANGES), zoomed)
    page.go_forward()
    page.wait_for_function(f"(z) => Math.abs({GD}._fullLayout.xaxis.range[0] - z) < 2e-3", arg=panned["x"][0], timeout=30000)
    assert _same(page.evaluate(RANGES), panned)
    assert _marked(page, A) == "mine"


C3 = {"type": "obs", "key": "total_counts", "column": ""}
EYE = f"""() => {{ const sc = {GD}._fullLayout.scene; const c = sc._scene && sc._scene.getCamera ? sc._scene.getCamera() : sc.camera;
  return [c.eye.x, c.eye.y, c.eye.z]; }}"""


def _start3d(page, server):
    cfg = {**_cfgs()[A], "z": C3}
    page.goto(_view_link(server, [_tile(A)], {A: cfg}))
    _drawn(page, A)
    page.wait_for_selector(f".tile[data-tile-id='{A}'] .js-plotly-plot .gl-container canvas", timeout=30000)
    page.wait_for_timeout(SETTLE_MS)
    _mark(page, A)
    return page.evaluate(LENGTH)


def _centre(page):
    r = page.evaluate(f"() => {{ const r = {GD}.querySelector('.svg-container').getBoundingClientRect(); return {{ x: r.x, y: r.y, w: r.width, h: r.height }}; }}")
    return r["x"] + r["w"] / 2, r["y"] + r["h"] / 2


def test_ten_wheel_events_in_3d_are_one_entry(page, server):
    base = _start3d(page, server)
    x, y = _centre(page)
    page.mouse.move(x, y)
    for _ in range(10):
        page.mouse.wheel(0, -120)
        page.wait_for_timeout(40)
    page.wait_for_timeout(SETTLE_MS)
    assert page.evaluate(LENGTH) == base + 1


def test_a_3d_rotation_is_one_entry_and_back_restores_the_camera(page, server):
    base = _start3d(page, server)
    before = page.evaluate(EYE)
    x, y = _centre(page)
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 120, y + 40, steps=10)
    page.mouse.up()
    page.wait_for_timeout(SETTLE_MS)
    turned = page.evaluate(EYE)
    assert turned != before
    assert page.evaluate(LENGTH) == base + 1
    page.go_back()
    page.wait_for_timeout(2500)
    assert page.evaluate(EYE) == pytest.approx(before, abs=2e-3)      # the entry keeps the camera rounded to 3 decimals
    assert _marked(page, A) == "mine"
    page.go_forward()
    page.wait_for_timeout(2500)
    assert page.evaluate(EYE) == pytest.approx(turned, abs=2e-3)


def test_a_link_with_ranges_reproduces_the_view_and_an_old_link_is_unchanged(page, server):
    cfg = {**_cfgs()[A], "equalAspect": False, "viewport2D": {"axes": "obsm.X_umap.0|obsm.X_umap.1|-", "xrange": [-1.5, 1.5], "yrange": [-1, 1]}}
    _start(page, server, cfgs={A: cfg})
    r = page.evaluate(RANGES)
    assert r["x"] == [-1.5, 1.5] and r["y"] == [-1, 1] or abs(r["x"][1] - r["x"][0] - 3) < 0.5
    page.goto(_view_link(server, [_tile(A)], {A: _cfgs()[A]}))
    _drawn(page, A)
    assert page.evaluate(RANGES)["auto"]


def test_a_zoom_a_second_after_another_action_is_its_own_entry(page, server):
    base = _start(page, server)
    page.locator(f".tile[data-tile-id='{A}'] .tile-title").first.click()
    _gesture(page, 0.2, 0.2, 0.6, 0.6)
    assert page.evaluate(LENGTH) == base + 1


@pytest.fixture(scope="module")
def large_server(tmp_path_factory):
    """200 cells count as a large plot (more than 100 points)."""
    root, proc = _serve(tmp_path_factory, "ui:\n  defaults:\n    large_plot_points: 100\n")
    yield root
    proc.terminate()
    proc.wait(10)


def test_back_over_a_zoom_in_large_plot_mode_asks_for_no_data(page, large_server):
    base = _start(page, large_server)
    assert page.evaluate(f"() => {GD}.data.some(t => t.type === 'scattergl')")
    fitted = page.evaluate(RANGES)
    _gesture(page, 0.2, 0.2, 0.6, 0.6)
    zoomed = page.evaluate(RANGES)
    assert not zoomed["auto"] and page.evaluate(LENGTH) == base + 1
    seen = _log_requests(page)
    page.go_back()
    page.wait_for_function(f"() => !!({GD}._fullLayout.xaxis.autorange)", timeout=30000)
    assert _same(page.evaluate(RANGES), fitted)
    page.go_forward()
    page.wait_for_function(f"() => !{GD}._fullLayout.xaxis.autorange", timeout=30000)
    page.wait_for_timeout(1000)
    assert _same(page.evaluate(RANGES), zoomed)
    assert _marked(page, A) == "mine"
    assert not seen, seen

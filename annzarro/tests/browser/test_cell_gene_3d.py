"""The Cell-Gene Plot in 3D, in a real browser against the real cell_groups route (WP-12, UX 6b).

The store is the grouping fixture (tests/core/grouping_store.py): cell_type with 6 levels, 40 genes, X signed,
``logged`` log-normalised and ``counts`` raw counts.

1.  The 3D toggle draws one mesh3d in a scene, shows Height and says in the strip what 3D leaves out; toggling back
    draws the 2D figure again. A Height on a new layer is one request for that layer's features.
2.  The camera turned by the user is stored without an undo step, survives a redraw and a reload of the link, and
    Reset camera clears it.
3.  Plot Options' Export greys SVG in 3D, with the reason; PNG stays.
4.  Over the bar cap (lowered for the test, `window.__azBars3dMax`) the 3D button is disabled with its reason, and a
    link stored in 3D is drawn in 2D with the strip saying why.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os
import re
import time

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_cell_gene_panel import (  # noqa: E402,F401
    GENES, P, S1, TP, _config, _drawn, _features, _open, _plot, _sig, _state, _url, page, served)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

OBS = {"type": "obs", "key": "cell_type"}
PLOT = f"{TP} .cgene-plot"
TYPES = "(s) => [...document.querySelector(s).data].map(t => t.type)"


def _types(page):
    return page.evaluate(TYPES, PLOT)


def _tag(page, key):
    return page.evaluate("([s, k]) => { const t = document.querySelector(`${s} .ps-tag[data-tag=\"${k}\"]`);"
                         " return t ? {text: t.textContent, title: t.getAttribute('title') || ''} : null; }", [TP, key])


def _open3d(page, served, genes=4, **fields):
    _open(page, served, {P: _plot(cellAxis=OBS, sections=[{"source": S1}], **fields), S1: _sig(S1, "Markers", GENES[:genes])},
          open_ids=(P, S1))
    return _drawn(page)


def _reopen(page, served, configs):
    """A link opened afresh: a goto that changes only the hash would race the app's own reload."""
    page.goto("about:blank")
    page.goto(_url(served, [P, S1], configs))
    page.wait_for_selector(f"{TP} .cgene-panel[data-state]", timeout=30000)


def _mesh_drawn(page):
    until(page, "(s) => { const g = document.querySelector(s); return !!g && !!g._fullLayout && !!g._fullLayout.scene"
                " && g.data.length === 1 && g.data[0].type === 'mesh3d'; }", PLOT, timeout=30)


def test_the_3d_toggle_draws_a_scene_and_toggling_back_restores_the_2d_figure(page, served):
    st = _open3d(page, served)
    two_d = _types(page)
    assert "mesh3d" not in two_d and two_d, two_d
    assert page.locator(f"{TP} .cgene-field--height").is_hidden(), "Height is shown only in 3D"
    undo = st["undo"]
    calls = len(page.calls)
    page.click(f"{TP} .cgene-3d-btn")
    _mesh_drawn(page)
    assert page.get_attribute(f"{TP} .cgene-3d-btn", "aria-pressed") == "true"
    assert _config(page)["view"] == "3d"
    assert _state(page)["undo"] == undo + 1, "the toggle is one undoable step"
    assert len(page.calls) == calls, "Same as Color reads nothing more"
    tag = _tag(page, "cgene-3d")
    assert tag and tag["text"] == "3D" and "dendrograms, strips, section brackets, totals or printed values" in tag["title"], tag
    assert page.locator(f"{TP} .cgene-field--height").is_visible()
    assert page.input_value(f"{TP} .cgene-height") == "__same_as_color__"
    assert page.locator(f"{TP} .cgene-height-layer").is_hidden(), "Same as Color reads Color's layer"
    hover = page.evaluate("(s) => document.querySelector(s).data[0].hovertext[0]", PLOT)
    assert hover.split("<br>")[-1] == "Height: as Color", hover
    # a Height of its own on a new layer: one request, each gene once on that layer
    page.select_option(f"{TP} .cgene-height", "mean")
    until(page, "(id) => (window.PanelManager.getPanel(id).getConfig().height || {}).stat === 'mean'", P)
    assert _config(page)["height"] == {"stat": "mean", "layer": "logged"}, "an own height starts on Color's layer"
    assert len(page.calls) == calls, "on Color's layer it reads nothing more"
    # ... and the values held are read with the new plan: every bar drawn, each with its own height
    until(page, "(s) => { const g = document.querySelector(s); const t = g.data[0]; return t.type === 'mesh3d'"
                " && t.x.length > 0 && (t.hovertext[0] || '').includes('Height · Mean · logged'); }", PLOT, timeout=30)
    page.select_option(f"{TP} .cgene-height-layer", "counts")
    until(page, "(id) => (window.PanelManager.getPanel(id).getConfig().height || {}).layer === 'counts'", P)
    until(page, "(s) => { const g = document.querySelector(s); return g.data[0].type === 'mesh3d'"
                " && g.data[0].hovertext[0].includes('Height · Mean · counts'); }", PLOT, timeout=30)
    new = page.calls[calls:]
    counts = [f for f in _features(new) if f.get("layer") == "counts"]
    assert sorted(f["name"] for f in counts) == sorted(GENES[:4]), counts
    # back to 2D: the 2D figure again, the Height kept for the next 3D
    page.click(f"{TP} .cgene-3d-btn")
    until(page, "(s) => { const g = document.querySelector(s); return !g._fullLayout.scene && g.data.every(t => t.type !== 'mesh3d'); }", PLOT, timeout=30)
    assert _types(page) == two_d
    assert "view" not in _config(page)
    assert _config(page)["height"] == {"stat": "mean", "layer": "counts"}
    assert page.locator(f"{TP} .cgene-field--height").is_hidden()
    assert _tag(page, "cgene-3d") is None


CAMERA = {"eye": {"x": 0.3, "y": -2, "z": 0.5}, "center": {"x": 0, "y": 0, "z": 0}, "up": {"x": 0, "y": 0, "z": 1}}


def _eye(page):
    return page.evaluate("(s) => document.querySelector(s)._fullLayout.scene.camera.eye", PLOT)


def test_the_camera_is_stored_without_an_undo_step_survives_a_redraw_and_reset_clears_it(page, served):
    _open3d(page, served, view="3d")
    _mesh_drawn(page)
    undo = _state(page)["undo"]
    page.evaluate("([s, c]) => window.Plotly.relayout(document.querySelector(s), {'scene.camera': c})", [PLOT, CAMERA])
    until(page, "(id) => { const c = window.PanelManager.getPanel(id).getConfig().camera; return !!c && Math.abs(c.eye.x - 0.3) < 1e-6; }", P)
    assert _state(page)["undo"] == undo, "a turn is no undo step"
    # a redraw (another scaling) keeps the camera
    page.select_option(f"{TP} .cgene-scale", "var")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().scale === 'var'", P)
    _mesh_drawn(page)
    page.wait_for_function("(s) => { const g = document.querySelector(s); return g.data[0].hovertext[0].includes('scaled 0 to 1'); }", arg=PLOT)
    eye = _eye(page)
    assert abs(eye["x"] - 0.3) < 1e-3 and abs(eye["y"] + 2) < 1e-3, eye
    # the link reopens the same view
    cfg = _config(page)
    _reopen(page, served, {P: {**cfg, "id": P}, S1: _sig(S1, "Markers", GENES[:4])})
    _drawn(page)
    _mesh_drawn(page)
    eye = _eye(page)
    assert abs(eye["x"] - 0.3) < 1e-3, eye
    # Reset camera: the default view, and no camera stored
    page.click(f"{TP} .modebar-btn[data-title='Reset camera']")
    until(page, "(id) => !('camera' in window.PanelManager.getPanel(id).getConfig())", P)
    until(page, "(s) => Math.abs(document.querySelector(s)._fullLayout.scene.camera.eye.x - 1.6) < 1e-3", PLOT)


def test_svg_export_is_disabled_in_3d_with_the_reason(page, served):
    _open3d(page, served)
    page.click(f"{TP} .cgene-options-btn")
    svg = "[data-popover='plot-options'] .cgene-export-btn[data-format='svg']"
    png = "[data-popover='plot-options'] .cgene-export-btn[data-format='png']"
    page.wait_for_selector(svg, state="visible")
    assert page.is_enabled(svg) and page.is_enabled(png), "2D exports SVG"
    page.keyboard.press("Escape")
    page.click(f"{TP} .cgene-3d-btn")
    _mesh_drawn(page)
    page.click(f"{TP} .cgene-options-btn")
    page.wait_for_selector(svg, state="visible")
    assert page.is_disabled(svg)
    assert page.get_attribute(svg, "title") == "3D exports as an image only."
    for fmt in ("png", "jpeg", "webp"):
        assert page.is_enabled(f"[data-popover='plot-options'] .cgene-export-btn[data-format='{fmt}']"), fmt


def test_over_the_cap_the_3d_button_is_disabled_and_a_stored_3d_is_drawn_in_2d(page, served):
    page.add_init_script("window.__azBars3dMax = 10;")
    st = _open3d(page, served)
    bars = st["groups"] * st["rows"]
    assert bars > 10, bars
    until(page, "(s) => document.querySelector(s + ' .cgene-3d-btn').disabled", TP)
    title = page.get_attribute(f"{TP} .cgene-3d-btn", "title")
    assert title == f"3D draws at most 10 bars; this plot has {bars:,}. Use fewer genes or groups.", title
    # a link stored in 3D over the cap: drawn in 2D, the strip says why, and the button turns 3D off
    _reopen(page, served, {P: _plot(cellAxis=OBS, sections=[{"source": S1}], view="3d"), S1: _sig(S1, "Markers", GENES[:4])})
    _drawn(page)
    until(page, "(s) => { const t = document.querySelector(s + ' .ps-tag[data-tag=\"cgene-3d\"]'); return !!t; }", TP)
    assert "mesh3d" not in _types(page)
    tag = _tag(page, "cgene-3d")
    assert tag["text"] == "2D" and re.match(r"3D draws at most 10 bars", tag["title"]), tag
    assert page.is_enabled(f"{TP} .cgene-3d-btn")
    assert page.get_attribute(f"{TP} .cgene-3d-btn", "aria-pressed") == "true"


# the labels on screen: each label's box, and the pixel of its tick on the box edge (Plotly's projection, _pdata)
LABEL_BOXES = """(s) => { const g = document.querySelector(s); const fl = g._fullLayout; const sz = fl._size; const d = fl.scene.domain;
  const svg = g.querySelector('.main-svg').getBoundingClientRect();
  return fl.scene.annotations.map((a, i) => { const p = a._pdata; const el = g.querySelector(`g.annotation-scene[data-index="${i}"] rect.bg`);
    if (!p || !el) return null; const r = el.getBoundingClientRect();
    return { name: a.name, text: a.text, xanchor: a.xanchor,
      tickX: sz.l + d.x[0] * sz.w + 0.5 * (1 + p[0] / p[3]) * sz.w * (d.x[1] - d.x[0]),
      tickY: sz.t + (1 - d.y[1]) * sz.h + 0.5 * (1 - p[1] / p[3]) * sz.h * (d.y[1] - d.y[0]),
      left: r.left - svg.left, right: r.right - svg.left, top: r.top - svg.top, bottom: r.bottom - svg.top,
      mid: (r.top + r.bottom) / 2 - svg.top }; }); }"""
TICK_PX = 6   # the label's gap from its tick (draw.js LABEL_GAP_PX, 4) and a little rounding


def _labels_of(page, selector):
    page.wait_for_function("(s) => { const g = document.querySelector(s); return g._fullLayout.scene.annotations.length > 0"
                           " && g._fullLayout.scene.annotations.every((a, i) => a._pdata"
                           " && g.querySelector(`g.annotation-scene[data-index=\"${i}\"] rect.bg`)); }", arg=selector)
    return page.evaluate(LABEL_BOXES, selector)


def _labels(page):
    return _labels_of(page, PLOT)


def _assert_anchored(boxes, gene_side, group_side):
    """A label on the right starts at its tick, one on the left ends there; never centred on it."""
    for b in (b for b in boxes if b["name"] in ("x label", "y label")):
        side = gene_side if b["name"] == "x label" else group_side
        edge = b["left"] if side == "right" else b["right"]
        assert abs(edge - b["tickX"]) <= TICK_PX, (side, b)
        assert abs((b["left"] + b["right"]) / 2 - b["tickX"]) > TICK_PX, ("centred", b)
        assert abs(b["mid"] - b["tickY"]) <= TICK_PX, ("not on its tick's line", b)


def _assert_titles_clear(boxes):
    """Each axis title over no label."""
    titles = [b for b in boxes if b["name"] in ("x title", "y title")]
    assert sorted(t["text"] for t in titles) == ["Genes", "Groups"]
    for t in titles:
        for b in (b for b in boxes if b["name"] in ("x label", "y label")):
            apart = t["right"] <= b["left"] or b["right"] <= t["left"] or t["bottom"] <= b["top"] or b["bottom"] <= t["top"]
            assert apart, ("title over a label", t, b)


def test_3d_labels_start_at_their_tick_on_the_right_and_end_there_on_the_left(page, served):
    _open3d(page, served, genes=6, view="3d")
    _mesh_drawn(page)
    boxes = _labels(page)
    assert sorted(b["text"] for b in boxes if b["name"] == "x label") == sorted(GENES[:6])
    assert len([b for b in boxes if b["name"] == "y label"]) == _state(page)["groups"]
    # the default camera: the genes along the front-left edge, the groups along the front-right edge
    assert {b["xanchor"] for b in boxes if b["name"] == "x label"} == {"right"}
    assert {b["xanchor"] for b in boxes if b["name"] == "y label"} == {"left"}
    _assert_anchored(boxes, gene_side="left", group_side="right")
    _assert_titles_clear(boxes)
    centre = page.evaluate("(s) => { const z = document.querySelector(s)._fullLayout._size; return z.l + z.w / 2; }", PLOT)
    assert all(b["tickX"] < centre for b in boxes if b["name"] == "x label")
    assert all(b["tickX"] > centre for b in boxes if b["name"] == "y label")
    # turned to look from (+x, +y): the genes move to the other edge, the right of the screen, and their anchor follows
    page.evaluate("([s, c]) => window.Plotly.relayout(document.querySelector(s), {'scene.camera': c})",
                  [PLOT, {"eye": {"x": 1.6, "y": 1.6, "z": 1.1}, "center": {"x": 0, "y": 0, "z": 0}, "up": {"x": 0, "y": 0, "z": 1}}])
    page.wait_for_function("(s) => document.querySelector(s)._fullLayout.scene.annotations.every(a => a.name !== 'x label' || a.xanchor === 'left')", arg=PLOT)
    # the labels are drawn at the camera's next frame: poll until they stand where the new anchors put them
    end = time.time() + 10
    while True:
        boxes = _labels(page)
        try:
            _assert_anchored(boxes, gene_side="right", group_side="left")
            _assert_titles_clear(boxes)
            break
        except AssertionError:
            if time.time() > end:
                raise
    eye = page.evaluate("(s) => document.querySelector(s)._fullLayout.scene.camera.eye", PLOT)
    assert abs(eye["x"] - 1.6) < 1e-3 and abs(eye["y"] - 1.6) < 1e-3, ("re-anchoring kept the camera", eye)


LONG = ["Interleukin_receptor_subunit_alpha_1", "TNF_receptor_superfamily_member_4", "Major_histocompatibility_DRB1"]
GROUPS = ["Young | Rnase6 < 0.391 & x", "Old | Rnase6 >= 0.391", "Young | \"quoted\" 'single'"]

# the figure draw.js builds, drawn in a page of the app: long gene names (a centred label would visibly miss its tick)
# and group names holding < > & " '
DRAW_MODEL = """async ([genes, groups, camera]) => {
  const D = await import('/static/js/panels/cell-gene/draw.js');
  const R = genes.length, G = groups.length;
  const colour = Float64Array.from({length: R * G}, (_, i) => 1 + (i % 5));
  const model = {mode: 'heatmap', view: '3d', groups: groups.map((label, g) => ({label, n: 10 * (g + 1)})),
    rows: genes.map((label) => ({label, section: {index: 0, title: 's'}})),
    color: {id: 'm', stat: 'mean', layer: 'X', scaling: 'none', values: colour, colorscale: 'Reds'},
    size: {none: ''}, height: {same: true, values: colour}, ...(camera ? {camera} : {})};
  const fig = D.buildFigure(model, {});
  let div = document.getElementById('az-test-3d');
  if (!div) { div = document.createElement('div'); div.id = 'az-test-3d'; document.body.prepend(div); }
  div.style.cssText = 'position:fixed;left:0;top:0;width:900px;height:700px;z-index:99999;background:#fff';
  await Plotly.newPlot(div, fig.data, fig.layout, fig.config);
  return true;
}"""


def test_long_gene_names_and_marked_up_group_names_in_3d(page, served):
    _open3d(page, served)
    for camera in (None, {"eye": {"x": 1.6, "y": 1.6, "z": 1.1}, "center": {"x": 0, "y": 0, "z": 0}, "up": {"x": 0, "y": 0, "z": 1}}):
        page.evaluate(DRAW_MODEL, [LONG, GROUPS, camera])
        gene_side, group_side = ("left", "right") if camera is None else ("right", "left")
        end = time.time() + 10
        while True:
            boxes = _labels_of(page, "#az-test-3d")
            try:
                assert sorted(b["text"] for b in boxes if b["name"] == "x label") == sorted(LONG)
                _assert_anchored(boxes, gene_side=gene_side, group_side=group_side)
                _assert_titles_clear(boxes)
                break
            except AssertionError:
                if time.time() > end:
                    raise
        assert all(b["right"] - b["left"] > 150 for b in boxes if b["name"] == "x label"), "long names, so a centred one would miss"
    # what is on screen is the name itself: a literal < > & " ', never an entity
    shown = page.eval_on_selector_all("#az-test-3d g.annotation-scene text", "ts => ts.map(t => t.textContent)")
    for name in GROUPS:
        assert name in shown, (name, shown)
    assert not any("&lt;" in t or "&amp;" in t for t in shown), shown
    # and in the hover (SVG text as the annotations are): the bar's hover text drawn as Plotly draws a hover label
    hover = page.evaluate("""() => { const g = document.getElementById('az-test-3d'); const t = g.data[0].hovertext.find(h => h.includes('Rnase6 &lt;'));
      const fl = g._fullLayout;
      Plotly.Fx.loneHover({x: 100, y: 100, text: t}, {container: fl._hoverlayer.node(), outerContainer: fl._paper.node(), gd: g});
      return [...fl._hoverlayer.node().querySelectorAll('text')].map(e => e.textContent).join('|'); }""")
    assert "Young | Rnase6 < 0.391 & x" in hover, hover


ANCHORS = """(s) => { const g = document.querySelector(s); const a = g._fullLayout.scene.annotations;
  const of = (n) => { const l = a.filter(x => x.name === n); return {edge: n === 'x label' ? l[0].y : l[0].x, xanchor: [...new Set(l.map(x => x.xanchor))].join()}; };
  return {genes: of('x label'), groups: of('y label')}; }"""


EYE = "(s) => document.querySelector(s)._fullLayout.scene._scene.getCamera().eye"


def _drag_until(page, reached, release=True):
    """A real mouse drag on the scene: down near its right edge, then leftward in small moves until `reached(eye)` (the
    camera lags the mouse and is damped, so the turn per pixel depends on the frames drawn), then up, or held."""
    box = page.locator(PLOT).bounding_box()
    x, y = box["x"] + box["width"] - 60, box["y"] + box["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    left = box["x"] + 40
    while x > left:
        x -= 6
        page.mouse.move(x, y)
        if reached(page.evaluate(EYE, PLOT)):
            break
    else:
        raise AssertionError(("the drag did not turn the camera there", page.evaluate(EYE, PLOT)))
    if release:
        page.mouse.up()


@pytest.mark.parametrize("mode", ["heatmap", "dots"])
def test_labels_switch_sides_while_the_scene_is_dragged(page, served, mode):
    _open3d(page, served, view="3d", mode=mode)
    _mesh_drawn(page)
    _labels(page)
    assert page.evaluate(ANCHORS, PLOT) == {"genes": {"edge": -0.5, "xanchor": "right"}, "groups": {"edge": 3.5, "xanchor": "left"}}
    # a quarter turn by mouse, still held: the camera now looks from +x, and the labels have already moved
    _drag_until(page, lambda eye: eye["y"] > 0.3, release=False)
    until(page, "([s, want]) => JSON.stringify((" + ANCHORS + ")(s)) === want",
          [PLOT, '{"genes":{"edge":5.5,"xanchor":"left"},"groups":{"edge":3.5,"xanchor":"right"}}'], timeout=10)
    page.mouse.up()
    # released, and the scene not reset: the camera stays turned, the labels where the drag put them
    eye = page.evaluate("(s) => document.querySelector(s)._fullLayout.scene._scene.getCamera().eye", PLOT)
    assert eye["y"] > 0, eye
    until(page, "(id) => { const c = window.PanelManager.getPanel(id).getConfig().camera; return !!c && c.eye.y > 0; }", P)
    assert page.evaluate(ANCHORS, PLOT)["genes"]["xanchor"] == "left"


def test_3d_label_options_side_and_justify_are_undoable_and_hidden_in_2d(page, served):
    st = _open3d(page, served, mode="heatmap")
    page.click(f"{TP} .cgene-options-btn")
    section = "[data-popover='plot-options'] .cgene-labels3d"
    page.wait_for_selector("[data-popover='plot-options']", state="visible")
    assert page.locator(section).is_hidden(), "only in 3D"
    page.keyboard.press("Escape")
    page.click(f"{TP} .cgene-3d-btn")
    _mesh_drawn(page)
    _labels(page)
    undo = _state(page)["undo"]
    page.click(f"{TP} .cgene-options-btn")
    page.wait_for_selector(section, state="visible")
    assert page.input_value(f"{section} [data-option='labels3dSide']") == "auto"
    assert page.input_value(f"{section} [data-option='labels3dJustify']") == "auto"
    page.select_option(f"{section} [data-option='labels3dJustify']", "center")
    until(page, "(id) => JSON.stringify(window.PanelManager.getPanel(id).getConfig().labels3d) === JSON.stringify({justify: 'center'})", P)
    until(page, "(s) => document.querySelector(s)._fullLayout.scene.annotations.filter(a => (a.name === 'x label' || a.name === 'y label')).every(a => a.xanchor === 'center')", PLOT)
    assert _state(page)["undo"] == undo + 1, "one undo step"
    # Fixed: the edges the labels are on now stay as the scene is dragged round
    page.select_option(f"{section} [data-option='labels3dSide']", "fixed")
    until(page, "(id) => (window.PanelManager.getPanel(id).getConfig().labels3d || {}).side === 'fixed'", P)
    assert _config(page)["labels3d"] == {"side": "fixed", "edges": {"x": "min", "y": "max"}, "justify": "center"}
    assert _state(page)["undo"] == undo + 2
    page.click("[data-popover='plot-options'] .az-popover-close")
    page.wait_for_selector("[data-popover='plot-options']", state="hidden")
    # dragged round until the camera looks from -x (the other side of the box)
    _drag_until(page, lambda eye: eye["x"] < -0.3)
    assert page.evaluate(ANCHORS, PLOT) == {"genes": {"edge": -0.5, "xanchor": "center"}, "groups": {"edge": 3.5, "xanchor": "center"}}
    # Undo, twice: back to Auto, where a drag moves the labels again
    page.click(f"{TP} .cgene-undo")
    page.click(f"{TP} .cgene-undo")
    until(page, "(id) => !('labels3d' in window.PanelManager.getPanel(id).getConfig())", P)
    assert st["rows"] > 0


AZIMUTH = "(s) => { const e = document.querySelector(s)._fullLayout.scene._scene.getCamera().eye; return Math.atan2(e.y, e.x) * 180 / Math.PI; }"
GENE_ANCHOR = "(s) => { const a = document.querySelector(s)._fullLayout.scene.annotations.find(x => x.name === 'x label'); return a.xanchor + '@' + a.y; }"


def test_labels_switch_live_and_the_camera_keeps_turning_through_the_switch(page, served):
    _open3d(page, served, view="3d", mode="heatmap")
    _mesh_drawn(page)
    _labels(page)
    box = page.locator(PLOT).bounding_box()
    x, y = box["x"] + box["width"] - 60, box["y"] + box["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    seen = []   # (azimuth, gene labels' anchor and edge) after each move, the mouse held throughout
    while x > box["x"] + 40 and len(seen) < 200:
        x -= 4
        page.mouse.move(x, y)
        page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
        seen.append((page.evaluate(AZIMUTH, PLOT), page.evaluate(GENE_ANCHOR, PLOT)))
        if len([s for s in seen if s[1] != seen[0][1]]) > 15:
            break
    page.mouse.up()
    switched = next((i for i, s in enumerate(seen) if s[1] != seen[0][1]), None)
    assert switched is not None, ("the labels did not switch while the mouse was held", seen[-1])
    assert seen[switched][1] == "left@5.5", seen[switched]
    # the camera turned on through the switch: the azimuth rises move after move, in small steps, never back
    around = [a for a, _ in seen[max(0, switched - 10):switched + 15]]
    steps = [b - a for a, b in zip(around, around[1:])]
    assert all(-0.5 <= d <= 15 for d in steps), steps
    assert sum(steps) > 10, ("the camera moved on", steps)


def _set_option(page, name, value, kind="select"):
    sel = f"[data-popover='plot-options'] [data-option='{name}']"
    if page.locator("[data-popover='plot-options']").count() == 0 or page.locator("[data-popover='plot-options']").is_hidden():
        page.click(f"{TP} .cgene-options-btn")
    page.wait_for_selector(sel, state="visible")
    if kind == "select":
        page.select_option(sel, value)
    elif kind == "check":
        page.set_checked(sel, value)
    else:
        page.fill(sel, str(value))
        page.press(sel, "Enter")


ROTATIONS = """(s) => { const g = document.querySelector(s);
  return g._fullLayout.scene.annotations.map((a, i) => { if (a.name !== 'x label') return null;
    const t = g.querySelector(`g.annotation-scene[data-index="${i}"] .annotation-text-g`);
    const m = t && /rotate\\(([-\\d.e]+)/.exec(t.getAttribute('transform') || ''); return m ? Number(m[1]) : null; }).filter(v => v !== null); }"""


def _edge_angle(boxes):
    """The gene edge's angle on screen (clockwise, -90 to 90), from its first and last ticks' pixels."""
    genes = [b for b in boxes if b["name"] == "x label"]
    a, b = genes[0], genes[-1]
    import math
    ang = math.degrees(math.atan2(b["tickY"] - a["tickY"], b["tickX"] - a["tickX"]))
    return ang - 180 if ang > 90 else ang + 180 if ang <= -90 else ang


def test_rotation_horizontal_angle_and_along_the_axis_as_rendered(page, served):
    _open3d(page, served, genes=8, view="3d", mode="dots")
    _mesh_drawn(page)
    _labels(page)
    assert set(page.evaluate(ROTATIONS, PLOT)) == {0}, "Horizontal by default"
    _set_option(page, "labels3dRotation", "angle")
    _set_option(page, "labels3dAngle", 30, kind="fill")
    until(page, "(id) => (window.PanelManager.getPanel(id).getConfig().labels3d || {}).rotation === 30", P)
    until(page, "([s, f]) => { const r = (" + ROTATIONS + ")(s); return r.length > 0 && r.every(v => v === 30); }", [PLOT, ""])
    _set_option(page, "labels3dRotation", "along")
    until(page, "(id) => (window.PanelManager.getPanel(id).getConfig().labels3d || {}).rotation === 'along'", P)
    for camera in (None, {"eye": {"x": 1.6, "y": 1.6, "z": 1.1}, "center": {"x": 0, "y": 0, "z": 0}, "up": {"x": 0, "y": 0, "z": 1}}):
        if camera:
            page.evaluate("([s, c]) => window.Plotly.relayout(document.querySelector(s), {'scene.camera': c})", [PLOT, camera])
        end = time.time() + 10
        while True:
            boxes = _labels(page)
            rendered = set(page.evaluate(ROTATIONS, PLOT))
            want = _edge_angle(boxes)
            if len(rendered) == 1 and abs(rendered.pop() - want) <= 6:
                break
            if time.time() > end:
                raise AssertionError(("not along the gene edge", page.evaluate(ROTATIONS, PLOT), want))
    # Across: square to the gene edge as drawn
    _set_option(page, "labels3dRotation", "across")
    until(page, "(id) => (window.PanelManager.getPanel(id).getConfig().labels3d || {}).rotation === 'across'", P)
    end = time.time() + 10
    while True:
        boxes = _labels(page)
        rendered = set(page.evaluate(ROTATIONS, PLOT))
        want = _edge_angle(boxes)
        if len(rendered) == 1 and abs(abs(rendered.pop() - want) - 90) <= 6:
            # names square to their edge stand side by side, so the titles must clear them
            _assert_titles_clear(boxes)
            break
        if time.time() > end:
            raise AssertionError(("not across the gene edge", page.evaluate(ROTATIONS, PLOT), want))
    _set_option(page, "labels3dRotation", "horizontal")
    until(page, "(id) => !('labels3d' in window.PanelManager.getPanel(id).getConfig())", P)


Z_CLEAR = [None,
           {"eye": {"x": 1.6, "y": 1.6, "z": 1.1}, "center": {"x": 0, "y": 0, "z": 0}, "up": {"x": 0, "y": 0, "z": 1}},
           {"eye": {"x": -1.2, "y": -1.9, "z": 0.9}, "center": {"x": 0, "y": 0, "z": 0}, "up": {"x": 0, "y": 0, "z": 1}}]


def test_no_height_label_meets_a_gene_or_group_label_at_any_camera(page, served):
    _open3d(page, served, genes=12, view="3d", mode="heatmap")
    _mesh_drawn(page)
    for camera in Z_CLEAR:
        if camera:
            page.evaluate("([s, c]) => window.Plotly.relayout(document.querySelector(s), {'scene.camera': c})", [PLOT, camera])
            page.wait_for_function("([s, x]) => Math.abs(document.querySelector(s)._fullLayout.scene._scene.getCamera().eye.x - x) < 1e-3",
                                   arg=[PLOT, camera["eye"]["x"]])
        end = time.time() + 10
        while True:
            boxes = _labels(page)
            z = [b for b in boxes if b["name"] == "z label"]
            cats = [b for b in boxes if b["name"] in ("x label", "y label")]
            hits = [(a["text"], b["text"]) for a in z for b in cats
                    if not (a["right"] <= b["left"] or b["right"] <= a["left"] or a["bottom"] <= b["top"] or b["bottom"] <= a["top"])]
            if z and not hits:
                break
            if time.time() > end:
                raise AssertionError(("height labels over category labels", camera, hits, len(z)))


def test_the_labels_switches_apply_in_3d_and_undo(page, served):
    _open3d(page, served, view="3d", mode="heatmap")
    _mesh_drawn(page)
    _labels(page)
    names = "(s) => [...new Set(document.querySelector(s)._fullLayout.scene.annotations.map(a => a.name))].sort().join()"
    assert page.evaluate(names, PLOT) == "x label,x title,y label,y title,z label,z title"
    undo = _state(page)["undo"]
    _set_option(page, "geneLabels", False, kind="check")
    until(page, "([s, want]) => (" + names + ")(s) === want", [PLOT, "y label,y title,z label,z title"])
    assert _state(page)["undo"] == undo + 1
    _set_option(page, "geneLabels", True, kind="check")
    until(page, "([s, want]) => (" + names + ")(s) === want", [PLOT, "x label,x title,y label,y title,z label,z title"])
    _set_option(page, "groupLabels", False, kind="check")
    until(page, "([s, want]) => (" + names + ")(s) === want", [PLOT, "x label,x title,z label,z title"])
    page.click("[data-popover='plot-options'] .az-popover-close")
    page.click(f"{TP} .cgene-undo")
    until(page, "([s, want]) => (" + names + ")(s) === want", [PLOT, "x label,x title,y label,y title,z label,z title"])


def test_padding_sets_the_gap_between_a_label_and_its_tick(page, served):
    _open3d(page, served, view="3d", mode="heatmap")
    _mesh_drawn(page)
    _set_option(page, "labels3dPadding", 14, kind="fill")
    until(page, "(id) => (window.PanelManager.getPanel(id).getConfig().labels3d || {}).padding === 14", P)
    end = time.time() + 10
    while True:
        boxes = [b for b in _labels(page) if b["name"] in ("x label", "y label")]
        gaps = [abs((b["left"] if b["xanchor"] == "left" else b["right"]) - b["tickX"]) for b in boxes]
        if gaps and all(12 <= g <= 17 for g in gaps):
            break
        if time.time() > end:
            raise AssertionError(("padding 14 not drawn", gaps))

"""
Tiles fill the window; the window does not grow with the tiles.

Measured headless at 1600x900 / 1600x1000 (see the commit that added this):
- A lone cell-plot tile 768 px tall drew Plotly's default 450 px graph and
  left the rest empty: the panel's ``height: 100%`` did not resolve inside
  ``.tile-content`` (a flex item without a definite height). Now 715 px,
  the whole content area.
- A 2x2 layout with a SearchBuilder table grew the page to 1372 px in a
  1000 px window (``body { min-height: 100vh }``); now 1000 px, each row 432 px.

These are CSS facts a browser computes, so this test pins the rules that
produce them; the measurements are in the headless check described above.
"""
import os
import re

CSS = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
    "static", "css", "styles.css",
)


def _rule(css, selector):
    m = re.search(r"(?m)^" + re.escape(selector) + r"\s*\{([^}]*)\}", css)
    assert m, f"no rule for {selector}"
    return m.group(1)


def test_page_is_exactly_the_window():
    css = open(CSS, encoding="utf-8").read()
    body = _rule(css, "body")
    assert re.search(r"(?m)^\s*height:\s*100vh", body)
    assert "min-height: 100vh" not in body
    assert re.search(r"min-height:\s*0", _rule(css, ".tile-container"))


def test_panels_fill_their_tile():
    css = open(CSS, encoding="utf-8").read()
    content = _rule(css, ".tile-content")
    assert "display: flex" in content and "flex-direction: column" in content
    fill = _rule(css, ".tile-content > .plot-panel,\n.tile-content > .table-panel")
    assert "flex: 1 1 auto" in fill and "min-height: 0" in fill


def test_small_selects_keep_room_for_their_arrow():
    """`.form-select-sm { padding: 0.25rem 0.5rem }` cleared Bootstrap's right
    padding, so the arrow was drawn over the value (obsm key 'X_umap' read
    'X_umaφ'). A later, more specific rule restores it."""
    css = open(CSS, encoding="utf-8").read()
    rule = _rule(css, ".form-select.form-select-sm")
    m = re.search(r"padding-right:\s*([\d.]+)rem", rule)
    assert m and float(m.group(1)) >= 1.5
    assert css.index(".form-select.form-select-sm {") > css.index(".form-control-sm, .form-select-sm {")


def test_header_actions_stay_on_one_row():
    """At 1100-1400 px the Save/Load/Share buttons wrapped ('Save / Panel /
    Set', 110 px tall) or dropped to a second header row. Headless after:
    one 79 px header row from 1100 px up. Pinned: the action column sizes
    to its buttons, labels never wrap, and narrow windows show icons."""
    css = open(CSS, encoding="utf-8").read()
    assert "white-space: nowrap" in _rule(css, ".header-actions .btn")
    assert ".header-actions .btn:not(.show-label) .btn-label" in css
    html = open(os.path.join(os.path.dirname(os.path.dirname(CSS)), "..", "templates", "index.html"), encoding="utf-8").read()
    assert 'class="col-auto header-actions"' in html
    for button in ("btn-save-session", "btn-load-session", "btn-share-link"):
        tag = re.search(r'<button id="%s"[^>]*>' % button, html).group(0)
        assert "title=" in tag, f"{button} needs a tooltip when its label is hidden"


def test_icon_content_is_a_css_escape_not_literal_text():
    """The upload dialog showed a literal '\\f15b' before the file name:
    `content: '\\\\f15b'` is a backslash followed by text, not the icon."""
    css = open(CSS, encoding="utf-8").read()
    assert not re.search(r"content:\s*'\\\\\\\\", css), "double backslash in a content: string"
    assert "content: '\\f15b'" in css


def test_axis_lock_buttons_have_no_shared_ids():
    """'lock-color' / 'refocus-x' ids repeated in every plot panel on the
    page (two panels: 2 x refocus-color, 2 x lock-color, seen headless).
    The buttons are found by class and data-axis now."""
    js_dir = os.path.join(os.path.dirname(os.path.dirname(CSS)), "js", "panels", "plot-utilities")
    for name in ("panel-ui-update.js", "listeners.js", "plot-update.js"):
        src = open(os.path.join(js_dir, name), encoding="utf-8").read()
        assert "id: `lock-${axis}`" not in src and "id: `refocus-${axis}`" not in src, name
        assert "#refocus-${axis}" not in src and "#lock-${axis}" not in src, name
        assert 'id^="lock-"' not in src and 'id^="refocus-"' not in src, name


def test_csv_export_uses_data_not_display():
    """CSV export wrote the displayed values (z-score '10.2103'); headless
    after: '10.210302257599338'. The button must ask for orthogonal data."""
    src = open(os.path.join(os.path.dirname(os.path.dirname(CSS)), "js", "panels", "table-utilities",
                            "table-data.js"), encoding="utf-8").read()
    block = src[src.index("extend: 'csv'"):src.index("extend: 'csv'") + 600]
    assert "exportOptions: { orthogonal: 'export' }" in block


def test_plot_area_keeps_a_drawable_height():
    """A single plot with its controls open at 1600x750 got a 94 px graph
    area (0 px at 600 px) and no plot: Plotly threw 'Something went wrong
    with axis scaling'. Headless after: 260 px, drawn, the tile scrolls."""
    css = open(CSS, encoding="utf-8").read()
    m = re.search(r"min-height:\s*(\d+)px", _rule(css, ".plot-container"))
    assert m and int(m.group(1)) >= 200

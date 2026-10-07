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
    # a panel body grows with its content and never scrolls inside: the tile
    # grows and the page scrolls (inner scrollers are the table body, Plotly
    # legends, the gene-set sections and multi-select lists)
    assert "overflow: visible" in content and "overflow: auto" not in content
    fill = _rule(css, ".tile-content > .plot-panel,\n.tile-content > .table-panel,\n.tile-content > .gs-panel")
    assert "flex: 1 0 auto" in fill
    wrap = _rule(css, ".panel-wrapper")
    assert "display: flex" in wrap and "height: auto" in wrap
    assert "var(--panel-height" in _rule(css, ".tile-container > .panel-wrapper")


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


def test_split_buttons_have_distinct_unambiguous_icons():
    """The vertical split used a rotated 'columns' icon that read as a
    floppy-disk Save. Both buttons now draw a box with a vertical or a
    horizontal divider and say what they do."""
    html = open(os.path.join(os.path.dirname(os.path.dirname(CSS)), "..", "templates", "index.html"), encoding="utf-8").read()
    h = re.search(r'<button[^>]*tile-split-h[^>]*>.*?</button>', html, re.S).group(0)
    v = re.search(r'<button[^>]*tile-split-v[^>]*>.*?</button>', html, re.S).group(0)
    assert "fa-rotate-90" not in v and "<svg" in h and "<svg" in v
    assert 'x1="8" y1="2" x2="8" y2="14"' in h and 'x1="2" y1="8" x2="14" y2="8"' in v


def test_status_strip_has_a_fixed_height_under_the_plot():
    """What a plot does not show is one strip under it (panel-surface.js), not
    a banner above it that pushed the plot down and a floating box over it.
    Its height is fixed (it never resizes the plot when its text changes), it
    does not shrink in the panel's column, and chips that do not fit drop
    whole rather than truncating the total."""
    css = open(CSS, encoding="utf-8").read()
    strip = _rule(css, ".plot-status")
    assert "height: calc(6 * var(--ps-u))" in strip and "flex: 0 0 calc(6 * var(--ps-u))" in strip
    chips = _rule(css, ".plot-status .ps-chips")
    assert "flex-wrap: wrap" in chips and "overflow: hidden" in chips
    assert "flex: none" in _rule(css, ".plot-status .ps-headline")
    for gone in (".datapoint-filter-widget", ".coverage-notice {", ".mode-notice"):
        assert gone not in css, gone
    js = open(os.path.join(os.path.dirname(CSS), "..", "js", "panels", "plot-utilities", "panel-ui-make.js"),
              encoding="utf-8").read()
    assert "Removed Datapoints" not in js


def test_bottom_chooser_keeps_a_usable_height():
    """Add a cell plot, split it, close one tile: the page-level chooser
    under the panels was 2 px tall, so closed panels could only be reached
    through a split. Headless after (1600x1000): chooser 320 px, its heading
    visible under the panel; the panel 811 px (the tile area less 5rem), not
    squeezed to make room for the chooser (a first fix gave it 567 px)."""
    css = open(CSS, encoding="utf-8").read()
    sel = _rule(css, ".tile-container > .tile-selector")
    assert re.search(r"min-height:\s*3\d\dpx", sel) and "flex: 1 0 auto" in sel
    assert "overflow: visible" in sel  # no scrolling inside the chooser
    wrap = _rule(css, ".tile-container > .panel-wrapper")
    assert "flex-shrink: 0" in wrap
    assert "max-height" not in wrap  # a cap made the height handle stop at the window


def test_header_is_one_row_down_to_tablet_width():
    """At 1000 px (and anything from 769 to 1099 px) the header wrapped: the
    Save/Load/Share icons dropped under the dataset picker and the header
    grew to 117 px (141 at 900). Headless after: one 79 px row at 800, 900,
    1000, 1050 and up, the pickers shrinking instead, no horizontal scroll,
    and the cell typeahead menu inside the window. At 768 px and below the
    existing mobile rule still stacks the controls."""
    css = open(CSS, encoding="utf-8").read()
    block = css[css.index("@media (min-width: 768.02px) {"):]
    block = block[:block.index("\n}\n")]
    assert ".global-controls > .row {" in block or ".global-controls > .row," in block
    assert "flex-wrap: nowrap" in block
    for sel in (".global-controls > .row > .col", ".global-controls .select2-container", ".global-controls .name-picker"):
        assert sel in block, sel
    assert "min-width: 0" in block
    assert re.search(r"#focused-cell \{\s*max-width: 100%", block)
    assert ".name-picker:has(#focused-cell) .name-picker-menu" in css

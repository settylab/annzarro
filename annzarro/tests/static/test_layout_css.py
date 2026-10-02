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
